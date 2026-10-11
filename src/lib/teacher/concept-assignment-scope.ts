/**
 * L8 -- write scope of a Teacher's concept reinforcement.
 *
 * Canonical rule: a Teacher may assign concept reinforcement only when the
 * concept is the learner's own, the learner is in a class the Teacher
 * teaches, and the concept belongs to the academic subject the Teacher holds
 * for THAT class. A Mathematics teacher must not assign a Reading concept
 * because the learner happens to have it.
 *
 * Ownership of the concept and the genuine-teacher chain stay where they
 * were (`assignTeacherIntervention`); this adds the class-subject bound in
 * front of it, on the shared L10 scope primitives:
 *   resolveTeacherClassScope          the actor teaches this class (never an
 *                                     institution admin) -> the class subject;
 *   canonicalSubjectOfLearnerConcept  the concept's subject through its
 *                                     MATCHED catalogue mapping (null when it
 *                                     has no confirmed counterpart: then it is
 *                                     in no teacher's subject).
 * Fails closed: no class subject, or no confirmed concept subject, is a refusal.
 */
import { db } from '@/lib/db';
import { resolveTeacherClassScope } from '@/lib/authorization';
import { canonicalSubjectOfLearnerConcept } from '@/lib/authorization/teacher-subject-scope';

export type ConceptAssignmentScope = 'IN_SCOPE' | 'NOT_TEACHER_OF_LEARNER_IN_CLASS' | 'CONCEPT_NOT_IN_CLASS_SUBJECT';

export async function checkConceptAssignmentScope(actorUserId: string, classId: string, studentId: string, learnerConceptId: string): Promise<ConceptAssignmentScope> {
  const scope = await resolveTeacherClassScope(actorUserId, classId);
  if (!scope) return 'NOT_TEACHER_OF_LEARNER_IN_CLASS';
  const enrolled = await db.query(`SELECT 1 FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'ACTIVE'`, [classId, studentId]);
  if (enrolled.rows.length === 0) return 'NOT_TEACHER_OF_LEARNER_IN_CLASS';
  if (!scope.canonicalSubjectId) return 'CONCEPT_NOT_IN_CLASS_SUBJECT';
  const conceptSubject = await canonicalSubjectOfLearnerConcept(learnerConceptId);
  return conceptSubject !== null && conceptSubject === scope.canonicalSubjectId ? 'IN_SCOPE' : 'CONCEPT_NOT_IN_CLASS_SUBJECT';
}
