/**
 * F9 -- POST /api/simulation/attempts/[id]/complete
 *
 * Finalizes the attempt (idempotent -- completeSimulationAttempt only
 * transitions from ACTIVE/PAUSED, a second call fails controlled, task
 * §54), runs F8's real post-exam diagnosis, recomputes a fresh
 * readiness snapshot, and returns the next-action recommendation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { getSimulationAttempt, completeSimulationAttempt } from '@/lib/simulation/attempt.service';
import { runPostExamDiagnosis } from '@/lib/simulation/post-exam-diagnosis.service';
import { computeReadinessSnapshot } from '@/lib/readiness/readiness.service';
import { determineNextAction } from '@/lib/simulation/next-action.service';
import { getSimulationScoreSummary } from '@/lib/simulation/scoring.service';
import { logPilotEvent } from '@/lib/observability/pilot-events';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const attempt = await getSimulationAttempt(id);
  if (!attempt) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const allowed = await canAccessLearner(actor.id, attempt.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let completed;
  try {
    completed = await completeSimulationAttempt(id);
  } catch (err) {
    // Idempotent-or-safely-rejected (task §29/§54): a second finalization request never re-scores or re-diagnoses.
    return NextResponse.json({ error: 'ALREADY_FINALIZED_OR_INVALID_STATUS' }, { status: 409 });
  }

  const scoreSummary = await getSimulationScoreSummary(attempt.examAttemptId);
  const postExamDiagnosis = await runPostExamDiagnosis(attempt.examAttemptId, attempt.studentId, attempt.examVersionId);
  const readinessSnapshot = await computeReadinessSnapshot({ studentId: attempt.studentId, examProfileId: attempt.examProfileId, examVersionId: attempt.examVersionId });
  const nextAction = await determineNextAction({ postExamDiagnosis, readinessSnapshot, simulationType: attempt.simulationType });

  logPilotEvent('exam_completed', {
    route: '/api/simulation/attempts/complete',
    studentId: attempt.studentId,
    simulationType: attempt.simulationType,
    rawScore: scoreSummary.rawScore,
    maxScore: scoreSummary.maxScore,
  });

  return NextResponse.json({
    success: true,
    data: { attempt: completed, scoreSummary, postExamDiagnosis, readinessSnapshot, nextAction },
  });
}
