/**
 * L9 IN-3 -- the Student's own side of a class enrollment: see the classes they are in, and leave one.
 *
 * Leaving is the EXISTING transition ACTIVE -> ENDED through the existing `endClassEnrollment`
 * (soft, history kept, the class stops contributing to the learner's plan). The only new thing is
 * the actor: the Student, for their OWN enrollment. `student_id = $studentId` is the whole
 * authorization boundary, and `studentId` is always the caller's own resolved identity -- another
 * student's enrollment, an unknown id, a pending invitation and an already-ended enrollment are
 * all the same "nothing to leave" (null), so the route cannot be used as an existence oracle.
 */
import { db } from '@/lib/db';
import { endClassEnrollment } from '@/services/institution.service';
import { recordGovernanceEvent } from './academic-governance';

export interface OwnClassEnrollment {
  enrollmentId: string;
  classId: string;
  className: string;
  institutionName: string;
}

/** The caller's own ACTIVE class enrollments. */
export async function listOwnActiveEnrollments(studentId: string): Promise<OwnClassEnrollment[]> {
  const r = await db.query(
    `SELECT ce.id, c.id AS class_id, c.name AS class_name, COALESCE(i.display_name, i.name) AS institution_name
       FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN institutions i ON i.id = c.institution_id
      WHERE ce.student_id = $1 AND ce.status = 'ACTIVE'
      ORDER BY institution_name, c.name`,
    [studentId]
  );
  return r.rows.map((x: any) => ({ enrollmentId: x.id, classId: x.class_id, className: x.class_name, institutionName: x.institution_name }));
}

/** The Student ends their OWN ACTIVE enrollment. null = nothing of theirs to leave. */
export async function leaveClassAsStudent(studentId: string, enrollmentId: string): Promise<{ enrollmentId: string; classId: string; institutionId: string } | null> {
  const own = (await db.query(
    `SELECT ce.class_id, c.institution_id, s.user_id
       FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN students s ON s.id = ce.student_id
      WHERE ce.id = $1 AND ce.student_id = $2 AND ce.status = 'ACTIVE'`,
    [enrollmentId, studentId]
  )).rows[0];
  if (!own) return null;
  if (!(await endClassEnrollment(own.institution_id, own.class_id, enrollmentId))) return null;
  await recordGovernanceEvent({
    institutionId: own.institution_id,
    actorUserId: own.user_id ?? null,
    actorScope: 'STUDENT',
    objectType: 'ENROLLMENT',
    objectId: enrollmentId,
    action: 'STUDENT_LEFT_CLASS',
    fields: ['status'],
    oldValues: { status: 'ACTIVE' },
    newValues: { status: 'ENDED', classId: own.class_id, studentId },
  }).catch((e) => console.error('[institution] leave-class audit failed', (e as Error)?.message));
  return { enrollmentId, classId: own.class_id, institutionId: own.institution_id };
}
