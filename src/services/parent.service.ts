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
import { getStudentMastery } from './mastery.service';
import { getActiveDebts } from './learning-debt.service';
import { getUpcomingForStudent } from './assessment.service';
import { masteryToPercent, tryMasteryScore, averageMasteryScore } from '@/lib/mastery-format';

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
    `${parentName} quiere ver tu progreso en StudyUS. Puedes aceptar o rechazar en tus notificaciones.`
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
  return (result.rowCount ?? 0) > 0;
}

export async function getLinkedChildren(parentId: string): Promise<LinkedChild[]> {
  const result = await db.query(
    `
    SELECT s.id, s.name, s.email, psr.status
    FROM parent_student_relationships psr
    JOIN students s ON s.id = psr.student_id
    WHERE psr.parent_id = $1 AND psr.status != 'declined'
    ORDER BY psr.created_at ASC
    `,
    [parentId]
  );
  return result.rows.map((r) => ({ studentId: r.id, name: r.name || r.email, email: r.email, status: r.status }));
}

export async function verifyParentAccess(parentId: string, studentId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM parent_student_relationships WHERE parent_id = $1 AND student_id = $2 AND status = 'accepted'`,
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
): Promise<void> {
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
  if ((result.rowCount ?? 0) === 0) return;

  if (accept) {
    const studentRow = await db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]);
    const studentName = studentRow.rows[0]?.name || studentRow.rows[0]?.email || 'Your child';
    await notify(
      parentId,
      'PARENT_LINK_ACCEPTED',
      'Solicitud aceptada',
      `${studentName} aceptó tu solicitud. Ya puedes ver su progreso en Modo padre.`
    );
  }
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
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface ParentInvitation {
  id: string;
  studentId: string;
  invitedEmail: string;
  status: InvitationStatus;
  createdAt: string;
}

export interface PendingInvitationForParent {
  id: string;
  studentId: string;
  studentName: string;
  createdAt: string;
}

/** The student's own side: invite a parent/guardian/coach by email. Idempotent -- re-inviting an already-pending email is a no-op. */
export async function inviteParentByEmail(studentId: string, invitedEmail: string): Promise<ParentInvitation> {
  const result = await db.query(
    `
    INSERT INTO parent_invitations (student_id, invited_email, status)
    VALUES ($1, $2, 'pending')
    ON CONFLICT (student_id, lower(invited_email)) WHERE status = 'pending'
    DO UPDATE SET status = parent_invitations.status
    RETURNING id, student_id, invited_email, status, created_at
    `,
    [studentId, invitedEmail]
  );
  const row = result.rows[0];
  return { id: row.id, studentId: row.student_id, invitedEmail: row.invited_email, status: row.status, createdAt: row.created_at };
}

/** The student's own view of invitations they have sent (any status except revoked, most recent first). */
export async function listInvitationsSentByStudent(studentId: string): Promise<ParentInvitation[]> {
  const result = await db.query(
    `SELECT id, student_id, invited_email, status, created_at FROM parent_invitations WHERE student_id = $1 AND status != 'revoked' ORDER BY created_at DESC`,
    [studentId]
  );
  return result.rows.map((r: any) => ({ id: r.id, studentId: r.student_id, invitedEmail: r.invited_email, status: r.status, createdAt: r.created_at }));
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
 */
export async function listPendingInvitationsForEmail(verifiedEmail: string): Promise<PendingInvitationForParent[]> {
  const result = await db.query(
    `
    SELECT pi.id, pi.student_id, s.name, s.email, pi.created_at
    FROM parent_invitations pi
    JOIN students s ON s.id = pi.student_id
    WHERE lower(pi.invited_email) = lower($1) AND pi.status = 'pending'
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
 */
export async function acceptParentInvitation(invitationId: string, parentId: string, verifiedEmail: string): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const invitation = await client.query(
      `SELECT id, student_id, invited_email FROM parent_invitations WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [invitationId]
    );
    if (invitation.rows.length === 0 || invitation.rows[0].invited_email.toLowerCase() !== verifiedEmail.toLowerCase()) {
      await client.query('ROLLBACK');
      return false;
    }
    const studentId = invitation.rows[0].student_id;

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
