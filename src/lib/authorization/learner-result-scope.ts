/**
 * L10-R1 -- the facts `shapeAttemptResultViewForScope` needs, read from the
 * modules that own them. Server-only (database reads).
 */
import { db } from '@/lib/db';
import { isAttemptDeletedFromHistory } from '@/lib/exam-core/history.service';
import { teacherSubjectScopeForLearner, type LearnerReadScope } from './index';
import { canonicalConceptsInSubjects } from './teacher-subject-scope';
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
