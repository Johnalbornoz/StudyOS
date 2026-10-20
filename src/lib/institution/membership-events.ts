/**
 * Track A -- the side effects of an institutional membership decision,
 * shared by the institution-admin console and the StudyUs admin inbox so
 * both audit and signal identically: one admin_audit_log row (role
 * decisions are audited) and one notification to the teacher. Neither is a
 * gate: the decision is already committed when this runs.
 */
import { db } from '@/lib/db';
import { recordAdminAction, type AdminAuditAction } from '@/lib/admin/audit';
import { notifyUser, notifyInstitutionAdmins } from '@/lib/notifications/role-notifications.service';

type Decision = 'APPROVED' | 'REJECTED' | 'REVOKED';

const AUDIT: Record<Decision, AdminAuditAction> = {
  APPROVED: 'MEMBERSHIP_APPROVED',
  REJECTED: 'MEMBERSHIP_REJECTED',
  REVOKED: 'TEACHER_MEMBERSHIP_REVOKED',
};

export async function onTeacherMembershipDecided(membershipId: string, actorUserId: string, decision: Decision): Promise<void> {
  const row = await db.query(
    `SELECT im.user_id, im.institution_id, i.name AS institution_name FROM institution_memberships im JOIN institutions i ON i.id = im.institution_id WHERE im.id = $1`,
    [membershipId]
  );
  const m = row.rows[0];
  try {
    await recordAdminAction({
      actorUserId,
      action: AUDIT[decision],
      targetType: 'MEMBERSHIP',
      targetId: membershipId,
      newState: { status: decision, institutionId: m?.institution_id ?? null, userId: m?.user_id ?? null },
    });
  } catch (error) {
    console.error('[membership-events] audit write failed', (error as Error)?.message);
  }
  if (!m) return;
  const name: string = m.institution_name;
  const copy: Record<Decision, { type: 'TEACHER_MEMBERSHIP_APPROVED' | 'TEACHER_MEMBERSHIP_REJECTED' | 'TEACHER_MEMBERSHIP_REVOKED'; title: string; message: string }> = {
    APPROVED: { type: 'TEACHER_MEMBERSHIP_APPROVED', title: 'Solicitud aprobada', message: `${name} aprobó tu solicitud como docente.` },
    REJECTED: { type: 'TEACHER_MEMBERSHIP_REJECTED', title: 'Solicitud no aprobada', message: `${name} no aprobó tu solicitud como docente.` },
    REVOKED: { type: 'TEACHER_MEMBERSHIP_REVOKED', title: 'Acceso retirado', message: `${name} retiró tu acceso como docente.` },
  };
  await notifyUser({
    recipientUserId: m.user_id,
    workspace: 'TEACHER',
    ...copy[decision],
    payload: { institutionName: name },
    actionHref: '/dashboard/teacher',
  });
}

export async function onTeacherMembershipRequested(institutionId: string, teacherEmail: string | null): Promise<void> {
  await notifyInstitutionAdmins(institutionId, {
    type: 'TEACHER_MEMBERSHIP_REQUESTED',
    title: 'Nueva solicitud de docente',
    message: `${teacherEmail ?? 'Un docente'} pidió unirse a tu institución.`,
    payload: { teacherEmail: teacherEmail ?? '' },
    actionHref: `/dashboard/institution/${institutionId}/requests`,
  });
}
