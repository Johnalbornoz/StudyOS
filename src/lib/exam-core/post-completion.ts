/**
 * Preview integration (R2) -- the ONE post-completion flow every real exam
 * completion path runs (simulation submit, its replay / race branches, and
 * the result page's interrupted-scoring recovery):
 *
 *   completed attempt
 *     -> persist the authoritative result / evidence (scoreAndRecordAttemptResult:
 *        one exam_attempt_results row per attempt, idempotent)
 *     -> refreshExamGapRecommendations (idempotent: ON CONFLICT, never enrolls,
 *        never duplicates a concept; 1 student + 1 canonical concept = 1 learner state)
 *     -> finish
 *
 * A failed gap refresh never invalidates the exam result: it is recorded as a
 * retryable failure (pilot event) and is retried by the next completion call or
 * by any Learning Plan read that refreshes gaps (plan / exam plan / recommendations).
 */
import { scoreAndRecordAttemptResult } from '@/lib/exam-core/results.service';
import { refreshExamGapRecommendations } from '@/lib/learning-plan/exam-bridge.service';
import { logPilotEvent } from '@/lib/observability/pilot-events';

export type GapRefreshOutcome = 'REFRESHED' | 'RETRYABLE_FAILURE';

export async function finalizeExamCompletion(attemptId: string, studentId: string, route: string) {
  const result = await scoreAndRecordAttemptResult(attemptId);
  let gapRefresh: GapRefreshOutcome = 'REFRESHED';
  try {
    await refreshExamGapRecommendations(studentId);
  } catch (e) {
    gapRefresh = 'RETRYABLE_FAILURE';
    logPilotEvent('exam_gap_refresh_failed', { studentId, route, attemptId, retryable: true, domainErrorCode: (e as Error)?.message?.slice(0, 120) });
  }
  return { result, gapRefresh };
}
