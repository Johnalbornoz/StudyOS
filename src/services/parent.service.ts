/**
 * Parent access to a linked student's progress -- read-only, and only
 * for students who accepted the parent's link request. Linking is by
 * the student's account email, but it's a real invitation now: a new
 * link starts 'pending' and grants no access until the student accepts
 * it (verifyParentAccess only counts 'accepted' rows) -- previously a
 * parent could enter any student's email and see their data
 * immediately, with no consent step at all.
 *
 * Notifications for both sides go through the existing `notifications`
 * table directly (its student_id column is a FK to profiles(id), so it
 * already accepts a parent's profile row as a recipient too) rather
 * than through notifications.service.ts's sendNotification(), which
 * turned out to be dead code -- nothing in the app ever calls it, so
 * the whole in-app notification feed has silently never been populated.
 * That's a pre-existing gap worth fixing on its own; out of scope here.
 */

import { db } from '@/lib/db';
import { activeRoleSql } from '@/lib/identity/access-predicates';
import { getStudentMastery } from './mastery.service';
import { getActiveDebts } from './learning-debt.service';
import { getUpcomingForStudent } from './assessment.service';
import { masteryToPercent, tryMasteryScore, averageMasteryScore } from '@/lib/mastery-format';
import { notifyUser } from '@/lib/notifications/role-notifications.service';
import { recordAdminAction } from '@/lib/admin/audit';

export type LinkStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface LinkedChild {
  studentId: string;
  name: string;
  email: string;
  status: LinkStatus;
}

export interface PendingRequest {
  parentId: string;
  parentName: string;
  requestedAt: string;
}

async function notify(recipientProfileId: string, notificationType: string, title: string, message: string) {
  await db.query(
    `INSERT INTO notifications (id, student_id, notification_type, title, message, delivered_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
    [recipientProfileId, notificationType, title, message]
  );
}

/**
 * F10: throws NO_STUDENT_FOUND exactly as before -- the enumeration fix
 * lives at the route boundary (link-child/route.ts), which now returns
 * the same generic response whether or not this throws, rather than
 * here. This function's own contract (distinct success/not-found) is
 * still useful to callers that already hold an authorization context
 * (e.g. an admin tool), so it isn't changed.
 *
 * F10 also fixes a real bug: the previous `ON CONFLICT DO NOTHING`
 * against the (parent_id, student_id) primary key meant that once ANY
 * row existed for a pair -- pending, declined, or revoked -- a new
 * request could never be created again; the function still returned a
 * fake 'pending' success with no actual write. The upsert below only
 * resets a row back to 'pending' when it was 'declined' or 'revoked';
 * an already-'pending' or already-'accepted' row is left untouched
 * (never silently reset, never a duplicate active relationship).
 */
export async function linkChildByEmail(
  parentId: string,
  childEmail: string
): Promise<LinkedChild> {
  const studentResult = await db.query(
    `SELECT id, name, email FROM students WHERE lower(email) = lower($1)`,
    [childEmail]
  );
  const student = studentResult.rows[0];
  if (!student) {
    throw new Error('NO_STUDENT_FOUND');
  }

  await db.query(
    `INSERT INTO parent_student_relationships (parent_id, student_id, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (parent_id, student_id) DO UPDATE
       SET status = 'pending', responded_at = NULL
       WHERE parent_student_relationships.status IN ('declined', 'revoked')`,
    [parentId, student.id]
  );

  const parentRow = await db.query(`SELECT full_name FROM profiles WHERE id = $1`, [parentId]);
  const parentName = parentRow.rows[0]?.full_name || 'Someone';

  await notify(
    student.id,
    'PARENT_LINK_REQUEST',
    'Solicitud de acceso',
    `${parentName} quiere ver tu progreso en StudyUs. Puedes aceptar o rechazar en tus notificaciones.`
  );

  return { studentId: student.id, name: student.name || student.email, email: student.email, status: 'pending' };
}

/**
 * F2 / INV-F2-07/08: soft-revoke, never a hard DELETE. The relationship
 * row (and every fact it carries -- when it was created, when it was
 * accepted) is preserved with status='revoked' rather than destroyed --
 * the historical fact that this relationship once existed and was
 * later revoked must survive. Access is denied immediately regardless
 * (verifyParentAccess only ever counts status='accepted'), but nothing
 * about the learner's own Evidence/mastery/history is touched here or
 * anywhere in this file.
 */
export async function unlinkChild(parentId: string, studentId: string): Promise<void> {
  await db.query(
    `UPDATE parent_student_relationships SET status = 'revoked', responded_at = NOW() WHERE parent_id = $1 AND student_id = $2 AND status != 'revoked'`,
    [parentId, studentId]
  );
  await cancelPendingInvitationsToParent(studentId, parentId);
}

/**
 * L10 SF-7 (L4-07): ending a relationship also cancels every invitation the
 * learner still has pending for that parent's email. Without this, a
 * forgotten invitation let the parent re-grant themselves access after the
 * learner revoked it. Matches on the parent account's stored email
 * (normalized); `acceptParentInvitation` independently refuses to revive an
 * ended relationship from an older invitation, so the two checks do not
 * depend on each other.
 */
async function cancelPendingInvitationsToParent(studentId: string, parentId: string, client: { query: typeof db.query } = db): Promise<void> {
  await client.query(
    `UPDATE parent_invitations pi SET status = 'revoked', responded_at = NOW()
     FROM profiles p JOIN users u ON u.id = p.user_id
     WHERE p.id = $2 AND pi.student_id = $1 AND pi.status = 'pending'
       AND u.email IS NOT NULL AND lower(btrim(pi.invited_email)) = lower(btrim(u.email))`,
    [studentId, parentId]
  );
}

/**
 * F2 / §7: the learner's own side of revocation -- a student must be
 * able to revoke an ACTIVE ('accepted') relationship themselves, not
 * only accept/reject a pending one. Scoped by `WHERE student_id = $1`
 * so a caller can never revoke a relationship belonging to a different
 * student (the caller's own resolved studentId is always used, never
 * a client-supplied one -- enforced at the route boundary). Same
 * soft-revoke contract as unlinkChild.
 */
export async function revokeRelationshipByStudent(studentId: string, parentId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE parent_student_relationships SET status = 'revoked', responded_at = NOW() WHERE student_id = $1 AND parent_id = $2 AND status = 'accepted' RETURNING parent_id`,
    [studentId, parentId]
  );
  const revoked = (result.rowCount ?? 0) > 0;
  if (revoked) await cancelPendingInvitationsToParent(studentId, parentId);
  return revoked;
}

export class ParentRelationshipNotFoundError extends Error {
  constructor() {
    super('PARENT_RELATIONSHIP_NOT_FOUND');
    this.name = 'ParentRelationshipNotFoundError';
  }
}

/**
 * L10 SF-7 (P1-9 admin half, CR-04): a platform administrator ends a
 * parent-learner relationship. Until now no administrative path could: the
 * only levers were the two parties themselves or suspending the whole
 * account. Same soft-revoke contract as the other two (the row and its
 * history stay), plus who ended it and why; pending requests and
 * invitations between the pair are closed too. Audited as an admin action.
 * The caller must already have passed the STUDYUS_ADMIN gate.
 */
export async function endParentRelationshipByAdmin(actorUserId: string, parentId: string, studentId: string, reason: string): Promise<void> {
  const result = await db.query(
    `UPDATE parent_student_relationships
     SET status = 'revoked', responded_at = NOW(), ended_by_user_id = $3, ended_reason = $4
     WHERE parent_id = $1 AND student_id = $2 AND status IN ('accepted', 'pending')
     RETURNING status`,
    [parentId, studentId, actorUserId, reason]
  );
  if ((result.rowCount ?? 0) === 0) throw new ParentRelationshipNotFoundError();
  await cancelPendingInvitationsToParent(studentId, parentId);
  await recordAdminAction({
    actorUserId,
    action: 'PARENT_RELATIONSHIP_ENDED',
    targetType: 'PARENT_RELATIONSHIP',
    targetId: studentId,
    reason,
    newState: { parentId, studentId, status: 'revoked' },
  });
}

/**
 * Track A: ACCEPTED relationships only. A pending, declined or revoked
 * row must never expose the learner's name or email to the parent (a
 * pending request is not consent, and listing it would also turn the
 * request form into an account-existence oracle).
 */
export async function getLinkedChildren(parentId: string): Promise<LinkedChild[]> {
  const result = await db.query(
    `
    SELECT s.id, s.name, s.email, psr.status
    FROM parent_student_relationships psr
    JOIN students s ON s.id = psr.student_id
    WHERE psr.parent_id = $1 AND psr.status = 'accepted'
    ORDER BY psr.created_at ASC
    `,
    [parentId]
  );
  return result.rows.map((r) => ({ studentId: r.id, name: r.name || r.email, email: r.email, status: r.status }));
}

/**
 * L10 SF-1 (L4-04): an accepted relationship authorizes only while the
 * parent's account is ACTIVE and holds an ACTIVE PARENT role.
 */
export async function verifyParentAccess(parentId: string, studentId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM parent_student_relationships psr
     JOIN profiles p ON p.id = psr.parent_id
     WHERE psr.parent_id = $1 AND psr.student_id = $2 AND psr.status = 'accepted'
       AND ${activeRoleSql('p.user_id', 'PARENT')}`,
    [parentId, studentId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Pending link requests directed at a student, for them to accept/decline. */
export async function getPendingRequestsForStudent(studentId: string): Promise<PendingRequest[]> {
  const result = await db.query(
    `
    SELECT psr.parent_id, p.full_name, psr.created_at
    FROM parent_student_relationships psr
    JOIN profiles p ON p.id = psr.parent_id
    WHERE psr.student_id = $1 AND psr.status = 'pending'
    ORDER BY psr.created_at ASC
    `,
    [studentId]
  );
  return result.rows.map((r) => ({
    parentId: r.parent_id,
    parentName: r.full_name || 'Someone',
    requestedAt: r.created_at,
  }));
}

/** The student accepts or declines a parent's pending link request. */
export async function respondToRequest(
  studentId: string,
  parentId: string,
  accept: boolean
): Promise<boolean> {
  const status: LinkStatus = accept ? 'accepted' : 'declined';
  const result = await db.query(
    `
    UPDATE parent_student_relationships
    SET status = $1, responded_at = NOW()
    WHERE student_id = $2 AND parent_id = $3 AND status = 'pending'
    RETURNING parent_id
    `,
    [status, studentId, parentId]
  );
  if ((result.rowCount ?? 0) === 0) return false;
  // L10 SF-7 (L4-07): a decline also closes any invitation still pending for that parent.
  if (!accept) await cancelPendingInvitationsToParent(studentId, parentId);

  const [studentRow, parentRow] = await Promise.all([
    db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]),
    db.query(`SELECT user_id FROM profiles WHERE id = $1`, [parentId]),
  ]);
  const studentName = studentRow.rows[0]?.name || studentRow.rows[0]?.email || '';
  const parentUserId: string | null = parentRow.rows[0]?.user_id ?? null;
  if (parentUserId) {
    await notifyUser({
      recipientUserId: parentUserId,
      workspace: 'PARENT',
      type: accept ? 'PARENT_LINK_ACCEPTED' : 'PARENT_LINK_DECLINED',
      title: accept ? 'Solicitud aceptada' : 'Solicitud rechazada',
      message: accept
        ? `${studentName} aceptó tu solicitud. Ya puedes ver su progreso.`
        : 'Tu solicitud de vinculación no fue aceptada.',
      // A declined request never reveals who declined it beyond what the
      // parent typed; an accepted one names the child (consent given).
      payload: accept ? { studentName } : {},
      actionHref: '/dashboard/parent',
    });
  }
  return true;
}

export const MAX_PENDING_PARENT_REQUESTS = 10;
/** L10 SF-7 (L4-17): how many times one parent may ask the SAME learner for access (first request included). */
export const MAX_LINK_REQUESTS_PER_LEARNER = 3;

export type ChildLinkRequestOutcome = 'SUBMITTED' | 'RATE_LIMITED';

/**
 * Track A -- the PARENT-initiated direction, consent-first and with no
 * account-existence oracle:
 *  - the caller learns nothing about whether the email belongs to a
 *    StudyUs student (the route returns the same response for match,
 *    no match, already pending and already linked);
 *  - a match only ever creates a PENDING relationship, which grants no
 *    access (`isActiveParentOf` counts 'accepted' only) until the
 *    Student accepts it from their own notifications;
 *  - only an identity holding an ACTIVE STUDENT role can be matched,
 *    by the canonical users.email or the students.email of that row;
 *  - a parent can never be linked to themselves;
 *  - at most MAX_PENDING_PARENT_REQUESTS outstanding requests per parent
 *    (bounded fan-out of unsolicited requests).
 * Re-requesting after a decline/revoke resets that row to pending (the
 * Student decides again); an accepted or pending row is left untouched.
 * L10 SF-7 (L4-17): re-requests are bounded -- at most
 * MAX_LINK_REQUESTS_PER_LEARNER requests per learner in total -- and a
 * relationship an administrator ended is never reopened by the parent.
 * Both are silent (same 'SUBMITTED' response), so the limit is not an
 * account-existence oracle either.
 */
export async function requestChildLink(parentId: string, childEmail: string): Promise<ChildLinkRequestOutcome> {
  const email = childEmail.trim().toLowerCase();
  const pending = await db.query(
    `SELECT COUNT(*)::int AS n FROM parent_student_relationships WHERE parent_id = $1 AND status = 'pending'`,
    [parentId]
  );
  if ((pending.rows[0]?.n ?? 0) >= MAX_PENDING_PARENT_REQUESTS) return 'RATE_LIMITED';

  const match = await db.query(
    `
    SELECT s.id AS student_id, s.user_id
    FROM students s
    JOIN users u ON u.id = s.user_id
    JOIN user_roles r ON r.user_id = u.id AND r.role = 'STUDENT' AND r.status = 'ACTIVE'
    WHERE (lower(u.email) = $1 OR lower(s.email) = $1) AND u.status = 'ACTIVE'
    ORDER BY s.created_at ASC NULLS LAST
    LIMIT 1
    `,
    [email]
  );
  const student = match.rows[0];
  if (!student) return 'SUBMITTED';

  const parent = await db.query(`SELECT user_id, full_name FROM profiles WHERE id = $1`, [parentId]);
  const parentUserId: string | null = parent.rows[0]?.user_id ?? null;
  if (parentUserId && parentUserId === student.user_id) return 'SUBMITTED';

  const written = await db.query(
    `INSERT INTO parent_student_relationships (parent_id, student_id, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (parent_id, student_id) DO UPDATE
       SET status = 'pending', responded_at = NULL, request_count = parent_student_relationships.request_count + 1
       WHERE parent_student_relationships.status IN ('declined', 'revoked')
         AND parent_student_relationships.request_count < $3
         AND parent_student_relationships.ended_by_user_id IS NULL
     RETURNING status`,
    [parentId, student.student_id, MAX_LINK_REQUESTS_PER_LEARNER]
  );
  if ((written.rowCount ?? 0) === 0) return 'SUBMITTED';

  const parentName = parent.rows[0]?.full_name || '';
  await notifyUser({
    recipientUserId: student.user_id,
    workspace: 'STUDENT',
    type: 'PARENT_LINK_REQUEST',
    title: 'Solicitud de acceso',
    message: `${parentName || 'Un familiar'} quiere ver tu progreso en StudyUs. Puedes aceptar o rechazar en tus notificaciones.`,
    payload: { parentName, parentId },
    actionHref: '/dashboard/notifications',
  });
  return 'SUBMITTED';
}

/**
 * Onboarding/authorization rework (2026-09-21) -- student-initiated
 * parent invitations. This is now the ONLY way a parent-student link
 * can begin: the student names the parent's email; the parent can only
 * ever see invitations addressed to THEIR OWN verified Clerk email
 * (never search or browse by an arbitrary email -- see
 * `listPendingInvitationsForEmail`, always called with the caller's
 * own resolved email, never a client-supplied one). Replaces
 * `linkChildByEmail`'s parent-initiated direction (see
 * src/app/api/parent/link-child/route.ts, POST removed).
 */
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

/** L10 SF-7: an invitation is valid for this long after it is sent (the column default in 20261120_1000 is the same value). */
export const PARENT_INVITATION_TTL_DAYS = 30;

export interface ParentInvitation {
  id: string;
  studentId: string;
  invitedEmail: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt?: string | null;
}

export interface PendingInvitationForParent {
  id: string;
  studentId: string;
  studentName: string;
  createdAt: string;
}

/**
 * The canonical form an invited email is stored and compared in: trimmed and
 * lowercased -- the same normalization `resolveVerifiedPrimaryEmail` applies
 * to the Clerk address it is later matched against.
 */
export function normalizeInvitedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type ParentInvitationRefusal = 'OWN_EMAIL' | 'ALREADY_LINKED';

/** CR-L7-01: the invitation was refused; nothing was written. */
export class ParentInvitationRefusedError extends Error {
  constructor(public readonly code: ParentInvitationRefusal) {
    super(code);
    this.name = 'ParentInvitationRefusedError';
  }
}

export interface InviteParentResult extends ParentInvitation {
  /** False when an unexpired pending invitation to this email already existed and was returned unchanged. */
  created: boolean;
}

/** Marks the learner's pending invitations that are past their expiry. Idempotent. */
async function expireStaleInvitations(where: { studentId: string } | { email: string }): Promise<void> {
  if ('studentId' in where) {
    await db.query(`UPDATE parent_invitations SET status = 'expired', responded_at = NOW() WHERE student_id = $1 AND status = 'pending' AND expires_at <= NOW()`, [where.studentId]);
  } else {
    await db.query(`UPDATE parent_invitations SET status = 'expired', responded_at = NOW() WHERE lower(invited_email) = $1 AND status = 'pending' AND expires_at <= NOW()`, [where.email]);
  }
}

/**
 * The student's own side: invite a parent/guardian/coach by email.
 *
 * CR-L7-01 (Orchestrator, 2026-10-11) -- refused, with nothing written:
 *  - OWN_EMAIL       the email is the Student's own (the account's stored
 *                    primary email, or the learner row's email);
 *  - ALREADY_LINKED  an account with that email already holds accepted,
 *                    current access to this Student.
 * Deterministic for a repeat: an unexpired pending invitation to the same
 * email is returned as it is (`created: false`) -- never a second row, never
 * a second notification. The one-pending-per-(student, email) unique index
 * holds the same rule in the database under concurrency.
 *
 * L10 SF-7: the invitation expires after PARENT_INVITATION_TTL_DAYS, and an
 * invitee who already has a StudyUs Parent account is told in-app. (Email
 * delivery is decision D-10; there is no mail provider in the repository.)
 */
export async function inviteParentByEmail(studentId: string, invitedEmail: string): Promise<InviteParentResult> {
  const email = normalizeInvitedEmail(invitedEmail);

  const own = await db.query(
    `SELECT 1 FROM students s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND (lower(btrim(s.email)) = $2 OR lower(btrim(u.email)) = $2)
     LIMIT 1`,
    [studentId, email]
  );
  if ((own.rows?.length ?? 0) > 0) throw new ParentInvitationRefusedError('OWN_EMAIL');

  const linked = await db.query(
    `SELECT 1 FROM parent_student_relationships psr
     JOIN profiles p ON p.id = psr.parent_id
     JOIN users u ON u.id = p.user_id
     WHERE psr.student_id = $1 AND psr.status = 'accepted' AND lower(btrim(u.email)) = $2
     LIMIT 1`,
    [studentId, email]
  );
  if ((linked.rows?.length ?? 0) > 0) throw new ParentInvitationRefusedError('ALREADY_LINKED');

  await expireStaleInvitations({ studentId });

  const toInvitation = (row: any, created: boolean): InviteParentResult => ({
    id: row.id,
    studentId: row.student_id,
    invitedEmail: row.invited_email,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    created,
  });

  const inserted = await db.query(
    `
    INSERT INTO parent_invitations (student_id, invited_email, status, expires_at)
    VALUES ($1, $2, 'pending', NOW() + ($3 || ' days')::interval)
    ON CONFLICT (student_id, lower(invited_email)) WHERE status = 'pending'
    DO NOTHING
    RETURNING id, student_id, invited_email, status, created_at, expires_at
    `,
    [studentId, email, String(PARENT_INVITATION_TTL_DAYS)]
  );
  if ((inserted.rows?.length ?? 0) === 0) {
    const existing = await db.query(
      `SELECT id, student_id, invited_email, status, created_at, expires_at FROM parent_invitations
       WHERE student_id = $1 AND lower(invited_email) = $2 AND status = 'pending'`,
      [studentId, email]
    );
    return toInvitation(existing.rows[0], false);
  }

  await notifyInvitedParentIfKnown(studentId, email).catch((error) => {
    console.error('[parent] invitation notification failed', error instanceof Error ? error.message : error);
  });
  return toInvitation(inserted.rows[0], true);
}

/**
 * In-app notice for an invitee who already has an ACTIVE account holding an
 * ACTIVE PARENT role (the only accounts with a Parent inbox). Nothing is
 * returned to the inviting Student, so this is not an existence oracle.
 */
async function notifyInvitedParentIfKnown(studentId: string, email: string): Promise<void> {
  const invitee = await db.query(
    `SELECT u.id FROM users u
     JOIN user_roles r ON r.user_id = u.id AND r.role = 'PARENT' AND r.status = 'ACTIVE'
     WHERE lower(btrim(u.email)) = $1 AND u.status = 'ACTIVE' AND NOT u.is_system
     ORDER BY u.created_at LIMIT 1`,
    [email]
  );
  const recipientUserId: string | undefined = invitee.rows?.[0]?.id;
  if (!recipientUserId) return;
  const studentRow = await db.query(`SELECT name FROM students WHERE id = $1`, [studentId]);
  const studentName: string = studentRow.rows?.[0]?.name || '';
  await notifyUser({
    recipientUserId,
    workspace: 'PARENT',
    type: 'PARENT_INVITATION_RECEIVED',
    title: 'Invitación para ver el progreso',
    message: `${studentName || 'Un estudiante'} te invitó a ver su progreso en StudyUs. Puedes aceptar o rechazar la invitación.`,
    payload: { studentName },
    actionHref: '/dashboard/parent',
  });
}

/** The student's own view of invitations they have sent (any status except revoked, most recent first). */
export async function listInvitationsSentByStudent(studentId: string): Promise<ParentInvitation[]> {
  await expireStaleInvitations({ studentId });
  const result = await db.query(
    `SELECT id, student_id, invited_email, status, created_at, expires_at FROM parent_invitations WHERE student_id = $1 AND status != 'revoked' ORDER BY created_at DESC`,
    [studentId]
  );
  return result.rows.map((r: any) => ({ id: r.id, studentId: r.student_id, invitedEmail: r.invited_email, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at ?? null }));
}

/** The student cancels an invitation they sent, before it's been accepted. */
export async function revokeInvitationByStudent(studentId: string, invitationId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE parent_invitations SET status = 'revoked', responded_at = NOW() WHERE id = $1 AND student_id = $2 AND status = 'pending' RETURNING id`,
    [invitationId, studentId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * The parent's own side: invitations addressed to THEIR verified
 * email. `verifiedEmail` must always come from the authenticated
 * Clerk session at the route boundary -- never a request parameter --
 * so this can never become a lookup-by-arbitrary-email oracle.
 * L10 SF-7: an invitation past its expiry is never listed.
 */
export async function listPendingInvitationsForEmail(verifiedEmail: string): Promise<PendingInvitationForParent[]> {
  const result = await db.query(
    `
    SELECT pi.id, pi.student_id, s.name, s.email, pi.created_at
    FROM parent_invitations pi
    JOIN students s ON s.id = pi.student_id
    WHERE lower(pi.invited_email) = lower($1) AND pi.status = 'pending' AND pi.expires_at > NOW()
    ORDER BY pi.created_at ASC
    `,
    [verifiedEmail]
  );
  return result.rows.map((r: any) => ({ id: r.id, studentId: r.student_id, studentName: r.name || r.email, createdAt: r.created_at }));
}

/**
 * The parent accepts an invitation addressed to their own verified
 * email. Creates/activates the REAL `parent_student_relationships` row
 * (status='accepted') using the exact same table and semantics F10
 * already certified -- an invitation is never itself the access grant.
 * Fails closed (returns false, writes nothing) if the invitation
 * doesn't exist, isn't pending, or (checked explicitly, not merely
 * assumed from the caller's own claim) doesn't belong to the caller's
 * verified email.
 *
 * L10 SF-7 (L4-07) -- also fails closed when:
 *  - the invitation is past its expiry (it is marked 'expired');
 *  - the relationship between this parent and learner was ENDED (revoked or
 *    declined) at or after the moment the invitation was sent. An older
 *    invitation never revives an ended relationship; only one the learner
 *    sends afterwards does;
 *  - an administrator ended the relationship (never revived by invitation).
 */
export async function acceptParentInvitation(invitationId: string, parentId: string, verifiedEmail: string): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const invitation = await client.query(
      `SELECT id, student_id, invited_email, created_at, (expires_at <= NOW()) AS expired FROM parent_invitations WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [invitationId]
    );
    if (invitation.rows.length === 0 || normalizeInvitedEmail(invitation.rows[0].invited_email) !== normalizeInvitedEmail(verifiedEmail)) {
      await client.query('ROLLBACK');
      return false;
    }
    if (invitation.rows[0].expired === true) {
      await client.query(`UPDATE parent_invitations SET status = 'expired', responded_at = NOW() WHERE id = $1`, [invitationId]);
      await client.query('COMMIT');
      return false;
    }
    const studentId = invitation.rows[0].student_id;

    const existing = await client.query(
      `SELECT status, responded_at, ended_by_user_id FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2 FOR UPDATE`,
      [parentId, studentId]
    );
    const current = existing.rows[0];
    if (current && (current.status === 'revoked' || current.status === 'declined')) {
      const endedAt = current.responded_at ? new Date(current.responded_at).getTime() : Number.POSITIVE_INFINITY;
      const invitedAt = new Date(invitation.rows[0].created_at).getTime();
      if (current.ended_by_user_id || !(invitedAt > endedAt)) {
        // Stale: the invitation predates the ending. It is closed, and nothing is granted.
        await client.query(`UPDATE parent_invitations SET status = 'revoked', responded_at = NOW() WHERE id = $1`, [invitationId]);
        await client.query('COMMIT');
        return false;
      }
    }

    await client.query(
      `
      INSERT INTO parent_student_relationships (parent_id, student_id, status)
      VALUES ($1, $2, 'accepted')
      ON CONFLICT (parent_id, student_id) DO UPDATE SET status = 'accepted', responded_at = NOW()
      `,
      [parentId, studentId]
    );
    await client.query(`UPDATE parent_invitations SET status = 'accepted', responded_at = NOW() WHERE id = $1`, [invitationId]);
    await client.query('COMMIT');

    const studentRow = await db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]);
    const studentName = studentRow.rows[0]?.name || studentRow.rows[0]?.email || 'Tu hijo/a';
    await notify(studentId, 'PARENT_INVITATION_ACCEPTED', 'Invitación aceptada', `${studentName ? 'Un familiar' : 'Alguien'} aceptó tu invitación y ahora puede ver tu progreso.`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** The parent declines an invitation addressed to their own verified email. No relationship is ever created. */
export async function declineParentInvitation(invitationId: string, verifiedEmail: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE parent_invitations SET status = 'declined', responded_at = NOW() WHERE id = $1 AND status = 'pending' AND lower(invited_email) = lower($2) RETURNING id`,
    [invitationId, verifiedEmail]
  );
  return (result.rowCount ?? 0) > 0;
}

export interface ChildSubjectSummary {
  subjectId: string;
  name: string;
  avgMastery: number | null;
  conceptCount: number;
  activeDebtCount: number;
}

export interface ChildOverview {
  studentId: string;
  name: string;
  subjects: ChildSubjectSummary[];
  totalActiveDebt: number;
  upcomingExams: Array<{
    subjectId: string;
    subjectName?: string;
    scheduledDate: string;
    daysUntil: number;
    examReadiness: number | null;
  }>;
}

export async function getChildOverview(
  studentId: string,
  preferredLanguage: string = 'en'
): Promise<ChildOverview> {
  const [subjectsResult, debts, upcoming] = await Promise.all([
    db.query(`SELECT id, name FROM subjects WHERE student_id = $1 AND status = 'active' ORDER BY name`, [studentId]),
    getActiveDebts(studentId, undefined, preferredLanguage).catch(() => []),
    getUpcomingForStudent(studentId).catch(() => []),
  ]);

  const subjects: ChildSubjectSummary[] = await Promise.all(
    subjectsResult.rows.map(async (s: any) => {
      const records = await getStudentMastery(studentId, s.id, preferredLanguage).catch(() => []);
      // mastery_records.mastery_score is already 0-100 -- validate each
      // row against that domain (an out-of-range row is dropped and
      // logged, never silently reinterpreted), average the RAW values,
      // then round for display exactly once, here.
      const validScores = records.flatMap((r: any) => {
        const score = tryMasteryScore(r.mastery_score, `parent overview concept ${r.concept_id}`);
        return score !== null ? [score] : [];
      });
      const avgMastery = masteryToPercent(averageMasteryScore(validScores));
      const activeDebtCount = debts.filter((d: any) => d.subjectId === s.id).length;
      return { subjectId: s.id, name: s.name, avgMastery, conceptCount: records.length, activeDebtCount };
    })
  );

  const studentRow = await db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]);
  const name = studentRow.rows[0]?.name || studentRow.rows[0]?.email || '';

  return {
    studentId,
    name,
    subjects,
    totalActiveDebt: debts.length,
    upcomingExams: upcoming.map((o) => ({
      subjectId: o.subjectId,
      subjectName: o.subjectName,
      scheduledDate: o.scheduledDate,
      daysUntil: o.daysUntil,
      examReadiness: o.examReadiness,
    })),
  };
}

/** Track A -- the Student's own view of who can see their progress (ACCEPTED relationships only). `studentId` is always the caller's own resolved id. */
export async function listParentsForStudent(studentId: string): Promise<Array<{ parentId: string; name: string; since: string | null }>> {
  const result = await db.query(
    `SELECT psr.parent_id, p.full_name, u.email, psr.responded_at
     FROM parent_student_relationships psr
     JOIN profiles p ON p.id = psr.parent_id
     LEFT JOIN users u ON u.id = p.user_id
     WHERE psr.student_id = $1 AND psr.status = 'accepted'
     ORDER BY psr.responded_at ASC NULLS LAST`,
    [studentId]
  );
  return result.rows.map((r: any) => ({
    parentId: r.parent_id,
    name: r.full_name || r.email || '',
    since: r.responded_at instanceof Date ? r.responded_at.toISOString() : r.responded_at ?? null,
  }));
}
