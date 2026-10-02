/**
 * Track A -- role-aware in-app notifications over the EXISTING
 * `notifications` table (no second notification architecture).
 *
 * Recipient model (migration 20261018_1000_track_a_roles_e2e):
 *  - every new notification is addressed to a canonical `users.id`
 *    (`recipient_user_id`) AND to the workspace it belongs to, so a
 *    Student+Parent account sees parent signals only in the Parent
 *    workspace and learning signals only in the Student workspace;
 *  - a STUDENT-workspace notification also carries `student_id`, so the
 *    Student shell's existing unread badge (`getUnreadNotifications`,
 *    keyed by students.id) keeps counting it unchanged;
 *  - legacy rows (student_id only) remain readable: a students.id row is
 *    the Student inbox, a parent profiles.id row is the Parent inbox.
 *
 * Messages are stored with a Spanish fallback title/message (the
 * historical convention) plus a typed `payload`; the UI renders the
 * reader's own locale from `notification_type` + payload.
 *
 * A notification is a signal only: it never grants access and never
 * carries protected learning data (names and counts only).
 */
import { db, type DbExecutor } from '@/lib/db';
import type { Workspace } from '@/lib/identity/types';

export type RoleNotificationType =
  | 'PARENT_LINK_REQUEST'
  | 'PARENT_LINK_ACCEPTED'
  | 'PARENT_LINK_DECLINED'
  | 'PARENT_INVITATION_ACCEPTED'
  | 'TEACHER_MEMBERSHIP_REQUESTED'
  | 'TEACHER_MEMBERSHIP_APPROVED'
  | 'TEACHER_MEMBERSHIP_REJECTED'
  | 'TEACHER_MEMBERSHIP_REVOKED'
  | 'TEACHER_CLASS_ASSIGNED'
  | 'CLASS_ENROLLMENT_INVITE'
  | 'CLASS_ENROLLMENT_ACCEPTED'
  | 'CLASS_ENROLLMENT_DECLINED'
  | 'ASSIGNMENT_PUBLISHED'
  | 'ROLE_ADDED'
  | 'ROLE_REVOKED'
  | 'COORDINATOR_ASSIGNED'
  | 'COORDINATOR_INVITATION_ACCEPTED'
  | 'CURRICULUM_SUPPLEMENTAL_CONCEPT'
  | 'CONCEPT_PROPOSAL_CREATED';

export type NotificationPayload = Record<string, string | number | null>;

export interface NotifyUserInput {
  recipientUserId: string;
  workspace: Workspace;
  type: RoleNotificationType;
  title: string;
  message: string;
  payload?: NotificationPayload;
  actionHref?: string | null;
}

async function resolveStudentRow(userId: string, client: DbExecutor): Promise<string | null> {
  const r = await client.query(`SELECT id FROM students WHERE user_id = $1 ORDER BY created_at ASC NULLS LAST LIMIT 1`, [userId]);
  return r.rows[0]?.id ?? null;
}

/** Write one notification. Never throws into the caller's business flow: a failed signal is logged, never a failed decision. */
export async function notifyUser(input: NotifyUserInput, client: DbExecutor = db): Promise<string | null> {
  try {
    const studentId = input.workspace === 'STUDENT' ? await resolveStudentRow(input.recipientUserId, client) : null;
    const r = await client.query(
      `INSERT INTO notifications (id, student_id, recipient_user_id, workspace, notification_type, title, message, payload, action_href, delivered_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id`,
      [studentId, input.recipientUserId, input.workspace, input.type, input.title, input.message, input.payload ? JSON.stringify(input.payload) : null, input.actionHref ?? null]
    );
    return r.rows[0]?.id ?? null;
  } catch (error) {
    console.error('[role-notifications] notifyUser failed', { type: input.type, workspace: input.workspace, error: (error as Error)?.message });
    return null;
  }
}

/** Notify every APPROVED INSTITUTION_ADMIN of one institution (institution workspace). */
export async function notifyInstitutionAdmins(
  institutionId: string,
  input: Omit<NotifyUserInput, 'recipientUserId' | 'workspace'>
): Promise<number> {
  const admins = await db.query(
    `SELECT user_id FROM institution_memberships WHERE institution_id = $1 AND membership_role = 'INSTITUTION_ADMIN' AND status = 'APPROVED'`,
    [institutionId]
  );
  let sent = 0;
  for (const row of admins.rows) {
    if (await notifyUser({ ...input, recipientUserId: row.user_id, workspace: 'INSTITUTION' })) sent += 1;
  }
  return sent;
}

export interface InboxNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  payload: NotificationPayload | null;
  actionHref: string | null;
  deliveredAt: string;
  readAt: string | null;
}

/**
 * The inbox scope of (user, workspace). Built server-side only from the
 * caller's own resolved identity -- never from a client-supplied id.
 */
async function inboxScope(userId: string, workspace: Workspace): Promise<{ where: string; params: unknown[] }> {
  if (workspace === 'STUDENT') {
    const studentId = await resolveStudentRow(userId, db);
    if (studentId) {
      return { where: `(n.student_id = $1 OR (n.recipient_user_id = $2 AND n.workspace = 'STUDENT'))`, params: [studentId, userId] };
    }
    return { where: `(n.recipient_user_id = $1 AND n.workspace = 'STUDENT')`, params: [userId] };
  }
  if (workspace === 'PARENT') {
    // Legacy parent rows are keyed by the parent's own profiles row.
    return {
      where: `((n.recipient_user_id = $1 AND n.workspace = 'PARENT')
               OR (n.recipient_user_id IS NULL AND n.student_id IN (SELECT id FROM profiles WHERE user_id = $1 AND user_type = 'parent')))`,
      params: [userId],
    };
  }
  return { where: `(n.recipient_user_id = $1 AND n.workspace = $2)`, params: [userId, workspace] };
}

function toInbox(row: any): InboxNotification {
  return {
    id: row.id,
    type: row.notification_type,
    title: row.title,
    message: row.message,
    payload: row.payload ?? null,
    actionHref: row.action_href ?? null,
    deliveredAt: row.delivered_at instanceof Date ? row.delivered_at.toISOString() : row.delivered_at,
    readAt: row.read_at instanceof Date ? row.read_at.toISOString() : row.read_at ?? null,
  };
}

export async function listInbox(userId: string, workspace: Workspace, limit = 50): Promise<InboxNotification[]> {
  const scope = await inboxScope(userId, workspace);
  const r = await db.query(
    `SELECT n.* FROM notifications n WHERE ${scope.where} ORDER BY n.delivered_at DESC NULLS LAST LIMIT ${Math.max(1, Math.min(200, Math.floor(limit)))}`,
    scope.params
  );
  return r.rows.map(toInbox);
}

export async function countUnread(userId: string, workspace: Workspace): Promise<number> {
  const scope = await inboxScope(userId, workspace);
  const r = await db.query(`SELECT COUNT(*)::int AS n FROM notifications n WHERE ${scope.where} AND n.read_at IS NULL`, scope.params);
  return r.rows[0]?.n ?? 0;
}

/**
 * Mark read -- only rows inside the caller's own inbox scope can ever be
 * touched (a spoofed notification id outside it updates nothing).
 * `ids` omitted = mark the whole inbox read.
 */
export async function markInboxRead(userId: string, workspace: Workspace, ids?: string[]): Promise<number> {
  const scope = await inboxScope(userId, workspace);
  const params = [...scope.params];
  let idFilter = '';
  if (ids && ids.length > 0) {
    params.push(ids);
    idFilter = ` AND n.id = ANY($${params.length}::uuid[])`;
  }
  const r = await db.query(`UPDATE notifications n SET read_at = NOW() WHERE ${scope.where} AND n.read_at IS NULL${idFilter}`, params);
  return r.rowCount ?? 0;
}

/**
 * Track A product amendment: ONE account inbox -- the persona's plus every
 * capability the account holds (institution / StudyUS administration), so
 * an institution request is never hidden because its admin is also, say, a
 * Teacher. Each part is still scoped by (user, workspace).
 */
export async function listAccountInbox(userId: string, workspaces: readonly Workspace[], limit = 50): Promise<Array<InboxNotification & { workspace: Workspace }>> {
  const parts = await Promise.all(workspaces.map(async (w) => (await listInbox(userId, w, limit)).map((n) => ({ ...n, workspace: w }))));
  const seen = new Set<string>();
  return parts
    .flat()
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .sort((a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime())
    .slice(0, limit);
}

export async function countAccountUnread(userId: string, workspaces: readonly Workspace[]): Promise<number> {
  const counts = await Promise.all(workspaces.map((w) => countUnread(userId, w)));
  return counts.reduce((a, b) => a + b, 0);
}

export async function markAccountInboxRead(userId: string, workspaces: readonly Workspace[], ids?: string[]): Promise<number> {
  const counts = await Promise.all(workspaces.map((w) => markInboxRead(userId, w, ids)));
  return counts.reduce((a, b) => a + b, 0);
}
