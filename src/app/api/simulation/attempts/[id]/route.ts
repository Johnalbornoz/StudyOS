import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { resolveLearnerReadScope } from '@/lib/authorization';
import { isOwnerScope } from '@/lib/authorization/learner-data-scope';
import { isAttemptResultVisibleToStudent } from '@/lib/authorization/learner-result-scope';
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

  // L10 SF-4 (D-1 final rulings): the owner reads their own attempt in any state. A Parent or
  // Coordinator reads only a result the Student can see, as a summary -- never the attempt's working
  // state, never a draft. A Teacher reads nothing here: exam-wide scores cannot be attributed to the
  // teacher's subject; the subject slice is served by the result route.
  const scope = await resolveLearnerReadScope(actor.id, attempt.studentId);
  if (!scope.permissions.includes('LEARNER_ASSESSMENT_SUMMARY_VIEW')) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const owner = isOwnerScope(scope);
  const summaryReader = scope.relationships.includes('PARENT') || scope.relationships.includes('COORDINATOR');
  if (!owner && !summaryReader) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const visible = owner || (await isAttemptResultVisibleToStudent(attempt));

  const [scoreSummary, result, examRow] = await Promise.all([
    getSimulationScoreSummary(attempt.examAttemptId),
    getAttemptResult(attempt.examAttemptId),
    db.query(`SELECT status FROM exam_attempts WHERE id = $1`, [attempt.examAttemptId]),
  ]);
  const lifecycle = deriveExamLifecycle({ simulationStatus: attempt.status, examAttemptStatus: examRow.rows[0]?.status ?? null, resultStatus: result?.status ?? null });
  // The server-held navigation state carries answer keys -- never returned here.
  const { navigationState: _hidden, ...publicAttempt } = attempt;
  void _hidden;
  if (!owner) {
    const summaryAttempt = { id: attempt.id, studentId: attempt.studentId, status: attempt.status };
    const shown = visible && result !== null;
    return NextResponse.json({ success: true, data: { attempt: summaryAttempt, lifecycle: shown ? lifecycle : null, scoreSummary: shown ? scoreSummary : null, result: shown ? result : null } });
  }
  return NextResponse.json({ success: true, data: { attempt: publicAttempt, lifecycle, scoreSummary, result } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/simulation/attempts/[id]', handleGET);
