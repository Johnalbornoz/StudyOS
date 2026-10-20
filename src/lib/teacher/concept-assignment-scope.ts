/**
 * L8 -- write scope of a Teacher's assignments by target (concept; skill / competency).
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
import { resolveTeacherClassScope, type TeacherClassScope } from '@/lib/authorization';
import { canonicalSubjectOfLearnerConcept } from '@/lib/authorization/teacher-subject-scope';

export type ConceptAssignmentScope = 'IN_SCOPE' | 'NOT_TEACHER_OF_LEARNER_IN_CLASS' | 'CONCEPT_NOT_IN_CLASS_SUBJECT';

/**
 * The actor teaches this class (never an institution admin) and the learner
 * is ACTIVE in it: the scope the teacher holds there, or null. The
 * authorization half of every target check on the Teacher endpoint.
 */
export async function resolveTeacherScopeForLearnerInClass(actorUserId: string, classId: string, studentId: string): Promise<TeacherClassScope | null> {
  const scope = await resolveTeacherClassScope(actorUserId, classId);
  if (!scope) return null;
  const enrolled = await db.query(`SELECT 1 FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'ACTIVE'`, [classId, studentId]);
  return enrolled.rows.length === 0 ? null : scope;
}

export async function checkConceptAssignmentScope(actorUserId: string, classId: string, studentId: string, learnerConceptId: string): Promise<ConceptAssignmentScope> {
  const scope = await resolveTeacherScopeForLearnerInClass(actorUserId, classId, studentId);
  if (!scope) return 'NOT_TEACHER_OF_LEARNER_IN_CLASS';
  if (!scope.canonicalSubjectId) return 'CONCEPT_NOT_IN_CLASS_SUBJECT';
  const conceptSubject = await canonicalSubjectOfLearnerConcept(learnerConceptId);
  return conceptSubject !== null && conceptSubject === scope.canonicalSubjectId ? 'IN_SCOPE' : 'CONCEPT_NOT_IN_CLASS_SUBJECT';
}

/**
 * SKILL and COMPETENCY targets have NO governed relation to a canonical
 * subject: `skills` and `competencies` carry no subject, and the only links
 * (`skill_competencies`, `canonical_concept_competencies`) are many-to-many
 * through concepts of any subject -- inferring a subject from them would be
 * the "nearby concept" guess the release rule forbids. Every Teacher
 * academic assignment must be provably scoped to the class subject, so for
 * an otherwise authorized teacher / class / learner these targets FAIL
 * CLOSED. When a governed link exists, this is the one place to consult it.
 */
export type UnscopedTargetDecision = 'NOT_TEACHER_OF_LEARNER_IN_CLASS' | 'TARGET_NOT_SUBJECT_SCOPED';

export async function checkUnscopedTargetAssignment(actorUserId: string, classId: string, studentId: string): Promise<UnscopedTargetDecision> {
  return (await resolveTeacherScopeForLearnerInClass(actorUserId, classId, studentId)) ? 'TARGET_NOT_SUBJECT_SCOPED' : 'NOT_TEACHER_OF_LEARNER_IN_CLASS';
}
