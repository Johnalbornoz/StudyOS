/**
 * L10-R1 / R2 -- the Teacher's SUBJECT boundary over learner data.
 *
 * Canonical rule (Orchestrator): Teacher learner data requires ALL of an
 * authorized Student, an authorized Class and an authorized Subject. A
 * Teacher must not receive another subject's academic data merely because
 * the learner belongs to their class; what cannot be sliced by subject is
 * refused to a Teacher rather than overexposed.
 *
 * Everything here is derived from `teacherSubjectScopeForLearner` (./index):
 * the canonical subjects of the ACTIVE classes, in an ACTIVE institution,
 * that the actor teaches and in which the learner is actively enrolled.
 *
 * Kept free of exam-core imports on purpose, so the plain read routes that
 * use it stay outside the AI import graph.
 */
import { db } from '@/lib/db';
import { resolveLearnerReadScope, teacherSubjectScopeForLearner } from './index';

/** Of these canonical concepts, the ones that belong to one of the given canonical subjects. Fails closed to none. */
export async function canonicalConceptsInSubjects(conceptIds: readonly string[], subjectIds: readonly string[]): Promise<Set<string>> {
  if (conceptIds.length === 0 || subjectIds.length === 0) return new Set();
  try {
    const r = await db.query(`SELECT id FROM canonical_concepts WHERE id = ANY($1::uuid[]) AND canonical_subject_id = ANY($2::uuid[])`, [[...new Set(conceptIds)], [...subjectIds]]);
    return new Set((r.rows ?? []).map((row: { id: string }) => row.id));
  } catch {
    return new Set();
  }
}

/**
 * The canonical subject of a LEARNER's own concept, through its published
 * catalogue match (`concept_catalog_mapping`, MATCHED only). Null when the
 * concept has no confirmed canonical counterpart: then it belongs to no
 * teacher's subject.
 */
export async function canonicalSubjectOfLearnerConcept(learnerConceptId: string): Promise<string | null> {
  try {
    const r = await db.query(
      `SELECT cc.canonical_subject_id
         FROM concept_catalog_mapping ccm JOIN canonical_concepts cc ON cc.id = ccm.canonical_concept_id
        WHERE ccm.learner_concept_id = $1 AND ccm.status = 'MATCHED' LIMIT 1`,
      [learnerConceptId]
    );
    return r.rows?.[0]?.canonical_subject_id ?? null;
  } catch {
    return null;
  }
}

/**
 * May this TEACHER read item-level detail about this learner's own concept?
 * Only when the concept's canonical subject is one the teacher is authorized
 * for with this learner (D-1 final ruling). A concept with no confirmed
 * canonical counterpart is in nobody's subject scope.
 */
export async function teacherMayReadLearnerConcept(actorUserId: string, learnerId: string, learnerConceptId: string | null | undefined): Promise<boolean> {
  if (!learnerConceptId) return false;
  const [subjectIds, conceptSubject] = await Promise.all([teacherSubjectScopeForLearner(actorUserId, learnerId), canonicalSubjectOfLearnerConcept(learnerConceptId)]);
  return conceptSubject !== null && subjectIds.includes(conceptSubject);
}

/**
 * L10-R2 -- the gate for the learner-wide ("whole-learner") read routes.
 *
 * Canonical rule (Orchestrator): Teacher learner data requires ALL of an
 * authorized Student, an authorized Class and an authorized SUBJECT. A
 * Teacher must not receive another subject's academic data merely because
 * the learner is in their class; a payload that cannot be sliced by subject
 * is refused to a Teacher rather than overexposed.
 *
 * `teacher` says what the route's payload is, for a reader who reaches the
 * learner ONLY as a Teacher (not as the owner and not as an accepted Parent):
 *   'DENY'                 learner-wide or exam-wide: it cannot be attributed
 *                          to one subject, so a Teacher is refused;
 *   { learnerConceptId }   about ONE concept of the learner: allowed when
 *                          that concept's canonical subject is one the
 *                          teacher is authorized for with this learner.
 * The owner and an accepted Parent are unaffected. A Coordinator never passes
 * (it does not hold the two permissions these routes ask for).
 */
export type TeacherRouteRule = 'DENY' | { learnerConceptId: string | null | undefined };

export async function canReadLearnerRoute(
  actorUserId: string,
  learnerId: string,
  permission: 'LEARNER_PROGRESS_VIEW' | 'LEARNER_PROFILE_VIEW',
  teacher: TeacherRouteRule
): Promise<boolean> {
  const scope = await resolveLearnerReadScope(actorUserId, learnerId);
  if (!scope.permissions.includes(permission)) return false;
  if (scope.relationships.includes('OWNER') || scope.relationships.includes('PARENT')) return true;
  if (!scope.relationships.includes('TEACHER')) return false;
  if (teacher === 'DENY') return false;
  return teacherMayReadLearnerConcept(actorUserId, learnerId, teacher.learnerConceptId);
}

/**
 * The learner's OWN concepts that fall inside the subject(s) this teacher is
 * authorized for with this learner (MATCHED catalogue mappings only). For a
 * Teacher read model that aggregates over a learner: it aggregates over this
 * set and nothing else. Empty when the teacher has no subject scope here.
 * Fails closed to the empty set.
 */
export async function learnerConceptsInTeacherSubjects(actorUserId: string, learnerId: string): Promise<{ subjectIds: string[]; conceptIds: Set<string> }> {
  const subjectIds = await teacherSubjectScopeForLearner(actorUserId, learnerId);
  if (subjectIds.length === 0) return { subjectIds, conceptIds: new Set() };
  try {
    const r = await db.query(
      `SELECT ccm.learner_concept_id
         FROM concept_catalog_mapping ccm
         JOIN canonical_concepts cc ON cc.id = ccm.canonical_concept_id
         JOIN concepts c ON c.id = ccm.learner_concept_id
         JOIN subjects s ON s.id = c.subject_id
        WHERE s.student_id = $1 AND ccm.status = 'MATCHED' AND cc.canonical_subject_id = ANY($2::uuid[])`,
      [learnerId, subjectIds]
    );
    return { subjectIds, conceptIds: new Set((r.rows ?? []).map((row: { learner_concept_id: string }) => row.learner_concept_id)) };
  } catch {
    return { subjectIds, conceptIds: new Set() };
  }
}
