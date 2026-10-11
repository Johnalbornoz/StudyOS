/**
 * B5-R -- POST /api/assessments/learning/start
 *
 * The canonical start of a learning assessment. It hands the Student's launch INTENT (scope, intent, depth)
 * to the one start authority, which decides resume-or-new, asks the Blueprint Core, freezes the result and
 * creates the session. This route selects nothing, counts nothing and decides no attempt type.
 *
 * Available only when ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED is on; otherwise 404, and the existing
 * practice path is the only one that runs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { verifyAuth, getOrCreateStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { parseLaunchRequest } from '@/lib/assessment-experience/launch';
import { isSnapshotExecutionEnabled, startLearningAssessment } from '@/lib/assessment-execution/assessment-start.service';

async function handlePOST(request: NextRequest) {
  if (!isSnapshotExecutionEnabled()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const parsed = parseLaunchRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: 'INVALID_INPUT', issue: parsed.issue }, { status: 400 });
  if (parsed.request.family !== 'LEARNING') return NextResponse.json({ error: 'UNSUPPORTED_FAMILY' }, { status: 400 });

  // the Student is the signed-in one: a request cannot name another
  const studentId = await getOrCreateStudentId(authContext.userId);
  const { intent, depth, scope, availableMinutes } = parsed.request;
  const language = await getInterfaceLanguage(studentId).catch(() => 'es');
  const started = await startLearningAssessment({ studentId, request: { intent, depth, canonicalConceptIds: scope.canonicalConceptIds, learnerConceptIds: scope.learnerConceptIds, availableMinutes }, asOf: new Date().toISOString(), language });
  if (!started.ok) {
    // a governed state for the experience to render, never a 500
    return NextResponse.json({ success: false, reason: started.reason }, { status: started.reason === 'DISABLED' ? 404 : 409 });
  }
  return NextResponse.json({ success: true, data: { sessionId: started.record.id, snapshotId: started.snapshotId, questions: started.questions, resumed: started.resumed, executionAuthority: started.executionAuthority } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/assessments/learning/start', handlePOST);
