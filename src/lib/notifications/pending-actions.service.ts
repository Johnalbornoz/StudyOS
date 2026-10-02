/**
 * Track A -- pending BUSINESS actions, deliberately separate from
 * notification read state. A notification can be READ while the action it
 * announced is still PENDING (e.g. a class invitation not yet answered);
 * the unread badge counts notifications only, never these.
 *
 * Read-only, scoped by the caller's own resolved identity:
 *  - STUDENT: class invitations (class_enrollments PENDING) and parent link
 *    requests (parent_student_relationships 'pending') addressed to them;
 *  - INSTITUTION: teacher membership requests (PENDING) of the institutions
 *    the user coordinates (APPROVED INSTITUTION_ADMIN, ACTIVE institution).
 */
import { db } from '@/lib/db';
import type { Workspace } from '@/lib/identity/types';
import type { InboxNotification } from './role-notifications.service';

export type PendingActionKind = 'CLASS_INVITATION' | 'PARENT_REQUEST' | 'TEACHER_REQUEST';

export interface PendingAction {
  kind: PendingActionKind;
  id: string;
  createdAt: string;
  /** Where the action is taken; null = on the notifications page itself (Accept / Decline panels). */
  href: string | null;
  className?: string;
  institutionName?: string;
  parentName?: string;
  teacherEmail?: string;
}

const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v));

export async function listPendingActions(userId: string, workspaces: readonly Workspace[]): Promise<PendingAction[]> {
  const out: PendingAction[] = [];
  if (workspaces.includes('STUDENT')) {
    const student = (await db.query(`SELECT id FROM students WHERE user_id = $1 ORDER BY created_at ASC NULLS LAST LIMIT 1`, [userId])).rows[0]?.id;
    if (student) {
      const [invites, parents] = await Promise.all([
        db.query(
          `SELECT ce.id, c.name AS class_name, i.name AS institution_name, ce.created_at
           FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN institutions i ON i.id = c.institution_id
           WHERE ce.student_id = $1 AND ce.status = 'PENDING' AND i.status = 'ACTIVE'`,
          [student]
        ),
        db.query(
          `SELECT psr.parent_id, p.full_name, psr.created_at FROM parent_student_relationships psr JOIN profiles p ON p.id = psr.parent_id
           WHERE psr.student_id = $1 AND psr.status = 'pending'`,
          [student]
        ),
      ]);
      for (const r of invites.rows) out.push({ kind: 'CLASS_INVITATION', id: r.id, createdAt: iso(r.created_at), href: null, className: r.class_name, institutionName: r.institution_name });
      for (const r of parents.rows) out.push({ kind: 'PARENT_REQUEST', id: r.parent_id, createdAt: iso(r.created_at), href: null, parentName: r.full_name ?? '' });
    }
  }
  if (workspaces.includes('INSTITUTION')) {
    const r = await db.query(
      `SELECT m.id, m.institution_id, i.name AS institution_name, u.email, m.created_at
       FROM institution_memberships m
       JOIN institutions i ON i.id = m.institution_id AND i.status = 'ACTIVE'
       JOIN users u ON u.id = m.user_id
       WHERE m.membership_role = 'TEACHER' AND m.status = 'PENDING'
         AND m.institution_id IN (SELECT institution_id FROM institution_memberships WHERE user_id = $1 AND membership_role = 'INSTITUTION_ADMIN' AND status = 'APPROVED')`,
      [userId]
    );
    for (const row of r.rows) {
      out.push({ kind: 'TEACHER_REQUEST', id: row.id, createdAt: iso(row.created_at), href: `/dashboard/institution/${row.institution_id}/requests`, institutionName: row.institution_name, teacherEmail: row.email ?? '' });
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Whether the business action a notification announced is still pending.
 * Exact id match when the payload carries it (new rows), otherwise the
 * names the payload always carried (older rows).
 */
export function isNotificationActionPending(n: Pick<InboxNotification, 'type' | 'payload'>, actions: PendingAction[]): boolean {
  const p = (n.payload ?? {}) as Record<string, unknown>;
  switch (n.type) {
    case 'CLASS_ENROLLMENT_INVITE':
      return actions.some((a) => a.kind === 'CLASS_INVITATION' && (p.enrollmentId ? p.enrollmentId === a.id : p.className === a.className && (!p.institutionName || p.institutionName === a.institutionName)));
    case 'PARENT_LINK_REQUEST':
      return actions.some((a) => a.kind === 'PARENT_REQUEST' && (p.parentId ? p.parentId === a.id : p.parentName === a.parentName));
    case 'TEACHER_MEMBERSHIP_REQUESTED':
      return actions.some((a) => a.kind === 'TEACHER_REQUEST' && (p.membershipId ? p.membershipId === a.id : p.teacherEmail === a.teacherEmail));
    default:
      return false;
  }
}
