import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { resolveLearnerReadScope } from '@/lib/authorization';
import { isOwnerScope, isReleasedResult } from '@/lib/authorization/learner-data-scope';
import { getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { getSimulationScoreSummary } from '@/lib/simulation/scoring.service';
import { db } from '@/lib/db';
import { deriveExamLifecycle, getAttemptResult } from '@/lib/exam-core/results.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const attempt = await getSimulationAttempt(id);
  if (!attempt) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  // L10 SF-4 (D-1): the owner reads their own attempt in any state. Every
  // other relationship reads a RELEASED result as a summary only -- never the
  // attempt's working state, and nothing while it is unscored or invalidated.
  const scope = await resolveLearnerReadScope(actor.id, attempt.studentId);
  if (!scope.permissions.includes('LEARNER_ASSESSMENT_SUMMARY_VIEW')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const [scoreSummary, result, examRow] = await Promise.all([
    getSimulationScoreSummary(attempt.examAttemptId),
    getAttemptResult(attempt.examAttemptId),
    db.query(`SELECT status FROM exam_attempts WHERE id = $1`, [attempt.examAttemptId]),
  ]);
  const lifecycle = deriveExamLifecycle({ simulationStatus: attempt.status, examAttemptStatus: examRow.rows[0]?.status ?? null, resultStatus: result?.status ?? null });
  // The server-held navigation state carries answer keys -- never returned here.
  const { navigationState: _hidden, ...publicAttempt } = attempt;
  void _hidden;
  if (!isOwnerScope(scope)) {
    const released = isReleasedResult(result);
    const summaryAttempt = { id: attempt.id, studentId: attempt.studentId, status: attempt.status };
    return NextResponse.json({ success: true, data: { attempt: summaryAttempt, lifecycle, scoreSummary: released ? scoreSummary : null, result: released ? result : null } });
  }
  return NextResponse.json({ success: true, data: { attempt: publicAttempt, lifecycle, scoreSummary, result } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/simulation/attempts/[id]', handleGET);
