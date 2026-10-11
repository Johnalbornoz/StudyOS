/**
 * L10-R1 -- the facts `shapeAttemptResultViewForScope` needs, read from the
 * modules that own them. Server-only (database reads).
 */
import { db } from '@/lib/db';
import { isAttemptDeletedFromHistory } from '@/lib/exam-core/history.service';
import { teacherSubjectScopeForLearner, type LearnerReadScope } from './index';
import { isOwnerScope, type ResultViewContext } from './learner-data-scope';

/**
 * Is this attempt's result visible to the Student today?
 *
 * The publication rules live in the exam core; this is the SAME test the
 * Student's own result page applies before it renders anything
 * (src/app/dashboard/exam-prep/attempt/[attemptId]/result/page.tsx):
 *   1. the attempt is COMPLETED (submitted) -- otherwise the Student is sent
 *      back to the attempt, there is no result page;
 *   2. the Student has not removed it from their history
 *      (`isAttemptDeletedFromHistory`: `hidden_at`, or its exam instance is
 *      DELETED) -- then it is hidden "from every visible surface".
 * Whether a result row exists yet, and whether it is SCORED or INVALIDATED,
 * does not change visibility: the Student sees "pending" or a flagged
 * invalidated result. The caller still requires the result row to exist.
 *
 * A unit test pins those two conditions against the page's source, so a
 * change to what the Student sees fails here until this follows it. A single
 * exported predicate in the exam core would be better (CR-L10-08 to L2).
 * Fails closed: any error reads as "not visible".
 */
export async function isAttemptResultVisibleToStudent(attempt: { id: string; status: string }): Promise<boolean> {
  if (attempt.status !== 'COMPLETED') return false;
  try {
    return !(await isAttemptDeletedFromHistory(attempt.id));
  } catch {
    return false;
  }
}

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

/** Builds the shaping context for one attempt view and one actor. */
export async function resolveResultViewContext(params: {
  actorUserId: string;
  scope: LearnerReadScope;
  attempt: { id: string; status: string; studentId: string };
  objectiveConceptIds: readonly string[];
}): Promise<ResultViewContext> {
  const { actorUserId, scope, attempt, objectiveConceptIds } = params;
  const submitted = attempt.status === 'COMPLETED';
  if (isOwnerScope(scope)) return { studentVisible: true, submitted, teacherConceptIds: new Set(), teacherSubjectIds: [] };
  const studentVisible = await isAttemptResultVisibleToStudent(attempt);
  const teacherOnly = scope.relationships.includes('TEACHER') && !scope.relationships.includes('PARENT') && !scope.relationships.includes('COORDINATOR');
  if (!teacherOnly || !studentVisible) return { studentVisible, submitted, teacherConceptIds: new Set(), teacherSubjectIds: [] };
  const teacherSubjectIds = await teacherSubjectScopeForLearner(actorUserId, attempt.studentId);
  const teacherConceptIds = await canonicalConceptsInSubjects(objectiveConceptIds, teacherSubjectIds);
  return { studentVisible, submitted, teacherConceptIds, teacherSubjectIds };
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
