/**
 * Track A -- the one place a class invitation is sent and its response is
 * reported back. Both the Institution Admin (any class of the institution)
 * and the class's own Teacher (only classes they teach) invite through
 * here; each route authorizes its actor BEFORE calling it. Enrollment stays
 * consent-based (`inviteStudentToClass`: PENDING grants nothing).
 */
import { db } from '@/lib/db';
import { getInstitutionById, inviteStudentToClass, type ClassInvitationOutcome } from '@/services/institution.service';
import { notifyUser } from '@/lib/notifications/role-notifications.service';
import { isTeacherOfClass } from '@/lib/teacher/class-assignment.service';

export async function inviteToClassAndNotify(
  institutionId: string,
  klass: { id: string; name: string },
  email: string,
  actorUserId: string
): Promise<ClassInvitationOutcome> {
  const result = await inviteStudentToClass(institutionId, klass.id, email, actorUserId);
  if (result.outcome === 'INVITED') {
    const institution = await getInstitutionById(institutionId);
    await notifyUser({
      recipientUserId: result.studentUserId,
      workspace: 'STUDENT',
      type: 'CLASS_ENROLLMENT_INVITE',
      title: 'Invitación a una clase',
      message: `${institution?.name ?? ''} te invitó a la clase ${klass.name}. Acepta o rechaza en tus notificaciones.`,
      payload: { institutionName: institution?.name ?? '', className: klass.name, enrollmentId: result.enrollmentId },
      actionHref: '/dashboard/notifications',
    });
  }
  return result;
}

/**
 * Tell whoever invited the Student how they answered. A Teacher who still
 * teaches the class is notified in the Teacher workspace (link to the
 * class); anyone else (the Institution Admin) in the Institution context.
 */
export async function notifyInviterOfResponse(
  response: { invitedByUserId: string | null; institutionId: string; classId: string; className: string },
  studentId: string,
  accepted: boolean
): Promise<void> {
  if (!response.invitedByUserId) return;
  const student = await db.query(`SELECT name, email FROM students WHERE id = $1`, [studentId]);
  const studentName = student.rows[0]?.name || student.rows[0]?.email || '';
  const asTeacher = await isTeacherOfClass(response.invitedByUserId, response.classId);
  await notifyUser({
    recipientUserId: response.invitedByUserId,
    workspace: asTeacher ? 'TEACHER' : 'INSTITUTION',
    type: accepted ? 'CLASS_ENROLLMENT_ACCEPTED' : 'CLASS_ENROLLMENT_DECLINED',
    title: accepted ? 'Invitación aceptada' : 'Invitación rechazada',
    message: accepted ? `${studentName} se unió a ${response.className}.` : `${studentName} no aceptó unirse a ${response.className}.`,
    payload: { studentName, className: response.className },
    actionHref: asTeacher ? `/dashboard/teacher/classes/${response.classId}` : `/dashboard/institution/${response.institutionId}/classes/${response.classId}`,
  });
}
