/**
 * F9 / Track B -- POST /api/simulation/attempts/[id]/complete
 *
 * Submission: commits autosaved drafts and marks every other open item
 * MISSING (finalizeOpenItemsForSubmission), completes the attempt, then SCORES
 * it with the scoring policy frozen on the attempt and records exactly one
 * result (exam_attempt_results, UNIQUE per attempt). Then runs F8's real
 * post-exam diagnosis, recomputes a readiness snapshot, and returns the
 * next-action recommendation.
 *
 * Idempotent: a retried submission of an already-submitted attempt returns
 * the SAME stored result (and never re-diagnoses, never re-scores, never
 * creates a second attempt or result). Owner-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { getSimulationAttempt, completeSimulationAttempt } from '@/lib/simulation/attempt.service';
import { finalizeOpenItemsForSubmission, SimulationItemNotActiveError } from '@/lib/simulation/item-resolution.service';
import { runPostExamDiagnosis } from '@/lib/simulation/post-exam-diagnosis.service';
import { computeReadinessSnapshot, getLatestReadinessSnapshot } from '@/lib/readiness/readiness.service';
import { determineNextAction } from '@/lib/simulation/next-action.service';
import { scoreAndRecordAttemptResult } from '@/lib/exam-core/results.service';
import { logPilotEvent } from '@/lib/observability/pilot-events';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const attempt = await getSimulationAttempt(id);
  if (!attempt) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const allowed = await canAccessLearner(actor.id, attempt.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  if (attempt.status === 'COMPLETED') {
    // Retry of a submission that already happened: same result, nothing re-run.
    const result = await scoreAndRecordAttemptResult(id);
    const readinessSnapshot = await getLatestReadinessSnapshot(attempt.examProfileId).catch(() => null);
    return NextResponse.json({ success: true, data: { attempt, result, readinessSnapshot, alreadySubmitted: true } });
  }
  if (attempt.status === 'ABANDONED') return NextResponse.json({ error: 'ALREADY_FINALIZED_OR_INVALID_STATUS' }, { status: 409 });

  try {
    await finalizeOpenItemsForSubmission(actor.id, id);
  } catch (err) {
    if (err instanceof SimulationItemNotActiveError) return NextResponse.json({ error: 'ALREADY_FINALIZED_OR_INVALID_STATUS' }, { status: 409 });
    throw err;
  }

  let completed;
  try {
    completed = await completeSimulationAttempt(id);
  } catch {
    // A concurrent submission won the race: return ITS result, never a second one.
    const current = await getSimulationAttempt(id);
    if (current?.status === 'COMPLETED') {
      const result = await scoreAndRecordAttemptResult(id);
      return NextResponse.json({ success: true, data: { attempt: current, result, alreadySubmitted: true } });
    }
    return NextResponse.json({ error: 'ALREADY_FINALIZED_OR_INVALID_STATUS' }, { status: 409 });
  }

  const result = await scoreAndRecordAttemptResult(id);
  const postExamDiagnosis = await runPostExamDiagnosis(attempt.examAttemptId, attempt.studentId, attempt.examVersionId);
  const readinessSnapshot = await computeReadinessSnapshot({ studentId: attempt.studentId, examProfileId: attempt.examProfileId, examVersionId: attempt.examVersionId });
  const nextAction = await determineNextAction({ postExamDiagnosis, readinessSnapshot, simulationType: attempt.simulationType });

  logPilotEvent('exam_completed', {
    route: '/api/simulation/attempts/complete',
    studentId: attempt.studentId,
    simulationType: attempt.simulationType,
    rawScore: result.rawScore,
    maxScore: result.maxScore,
    scoringStatus: result.scoringStatus,
  });

  return NextResponse.json({
    success: true,
    data: {
      attempt: completed,
      result,
      // Back-compat for older clients: the same raw marks the result recorded.
      scoreSummary: { rawScore: result.rawScore, maxScore: result.maxScore },
      postExamDiagnosis,
      readinessSnapshot,
      nextAction,
    },
  });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/simulation/attempts/[id]/complete', handlePOST);
