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
import { verifyAuth, requireStudentId } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { parseLaunchRequest } from '@/lib/assessment-experience/launch';
import { isSnapshotExecutionEnabled, startLearningAssessment } from '@/lib/assessment-execution/assessment-start.service';
import { isAdHocExamIntent } from '@/lib/assessment-experience/ad-hoc-exam';
import { adHocExamReadiness } from '@/lib/assessment-experience/ad-hoc-exam.service';
import { getScheduledAdHocExam, isScheduledExamDue, markScheduledAdHocExamStarted } from '@/services/ad-hoc-exam-schedule.service';

async function handlePOST(request: NextRequest) {
  if (!isSnapshotExecutionEnabled()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const parsed = parseLaunchRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: 'INVALID_INPUT', issue: parsed.issue }, { status: 400 });
  if (parsed.request.family !== 'LEARNING') return NextResponse.json({ error: 'UNSUPPORTED_FAMILY' }, { status: 400 });

  // the Student is the signed-in one: a request cannot name another; an account without an ACTIVE Student role is refused
  const studentId = await requireStudentId(authContext.userId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const { intent, scope } = parsed.request;
  let { depth, availableMinutes } = parsed.request;
  // a difficulty is a choice of a Student's own partial exam only; on any other intent it is not read
  let difficultyBand = isAdHocExamIntent(intent) ? parsed.request.difficultyBand : null;
  const now = new Date();
  const asOf = now.toISOString();
  let canonicalConceptIds = scope.canonicalConceptIds;
  let learnerConceptIds = scope.learnerConceptIds;
  let scheduledAssessmentId: string | null = null;
  let verifiedScope: { subjectId: string; learnerConceptByCanonical: Record<string, string> } | undefined;
  // a schedule is only ever a Student's own partial exam
  if (scope.scheduledAssessmentId && !isAdHocExamIntent(intent)) return NextResponse.json({ success: false, reason: 'SCOPE_REJECTED' }, { status: 403 });
  if (isAdHocExamIntent(intent)) {
    // A Student's own partial exam. Whatever a page checked before, the start checks again, here: the Subject is
    // the Student's own, EVERY concept is one of its concepts, and already-eligible content meets every one of
    // them. Concepts are accepted only as the Student's own concept ids, never as catalogue ids or a node.
    if (scope.canonicalConceptIds.length > 0 || scope.node) return NextResponse.json({ success: false, reason: 'SCOPE_REJECTED' }, { status: 403 });
    let subjectId: unknown = scope.subjectId;
    let selected: readonly unknown[] = scope.learnerConceptIds;
    if (scope.scheduledAssessmentId) {
      // A scheduled exam starts with exactly what was scheduled: Subject, concepts, size, time and difficulty come from the
      // Student's own record, never from the request. Another Student's schedule does not exist here.
      const schedule = await getScheduledAdHocExam(studentId, scope.scheduledAssessmentId);
      if (!schedule) return NextResponse.json({ success: false, reason: 'SCOPE_REJECTED' }, { status: 403 });
      if (schedule.status !== 'SCHEDULED' || !schedule.scopeIntact) return NextResponse.json({ success: false, reason: 'SCHEDULE_NOT_STARTABLE' }, { status: 409 });
      // not before its moment: nothing is selected, frozen or created until then
      if (!isScheduledExamDue(schedule, now)) return NextResponse.json({ success: false, reason: 'ASSESSMENT_NOT_DUE', scheduledAt: schedule.scheduledAt }, { status: 409 });
      scheduledAssessmentId = schedule.id;
      subjectId = schedule.subjectId;
      selected = schedule.conceptIds;
      depth = schedule.depth;
      availableMinutes = schedule.availableMinutes;
      difficultyBand = schedule.difficultyBand;
    }
    // ...and the same authoritative check either way: ownership of the Subject, every concept, eligible content
    const ready = await adHocExamReadiness(studentId, { subjectId, learnerConceptIds: selected, depth, availableMinutes, difficultyBand }, asOf, { enabled: isSnapshotExecutionEnabled() });
    if (!ready.ok) {
      if (ready.reason === 'SCOPE_REJECTED') return NextResponse.json({ success: false, reason: 'SCOPE_REJECTED' }, { status: 403 });
      if (ready.reason === 'INSUFFICIENT_CERTIFIED_CONTENT') return NextResponse.json({ success: false, reason: ready.reason, unmetConceptIds: ready.unmetConceptIds }, { status: 409 });
      return NextResponse.json({ success: false, reason: ready.reason }, { status: ready.reason === 'DISABLED' ? 404 : 409 });
    }
    canonicalConceptIds = ready.canonicalConceptIds;
    // the Student's own concepts stay named: they are the instances the evidence need is read from
    learnerConceptIds = ready.learnerConceptIds;
    verifiedScope = { subjectId: ready.subjectId, learnerConceptByCanonical: ready.learnerConceptByCanonical };
  }
  const language = await getInterfaceLanguage(studentId).catch(() => 'es');
  const started = await startLearningAssessment({ studentId, request: { intent, depth, canonicalConceptIds, learnerConceptIds, availableMinutes, difficultyBand }, asOf, language, scope: verifiedScope });
  if (!started.ok) {
    // a governed state for the experience to render, never a 500
    return NextResponse.json({ success: false, reason: started.reason }, { status: started.reason === 'DISABLED' ? 404 : 409 });
  }
  // SCHEDULED -> STARTED, bound to the session that executes it
  if (scheduledAssessmentId) await markScheduledAdHocExamStarted(studentId, scheduledAssessmentId, started.record.id);
  return NextResponse.json({ success: true, data: { sessionId: started.record.id, snapshotId: started.snapshotId, questions: started.questions, resumed: started.resumed, executionAuthority: started.executionAuthority } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/assessments/learning/start', handlePOST);
