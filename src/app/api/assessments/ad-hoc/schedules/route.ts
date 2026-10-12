/**
 * A Student's own partial exam -- its schedules.
 *
 *   GET  ?subjectId=   the signed-in Student's open schedules (optionally of one Subject)
 *   POST               a new, independent schedule: Subject, exact concepts, size, time available, a moment
 *                      (date AND time, with its offset) and the Student's timezone
 *
 * The Student is the signed-in one: a request names no Student. The scope is checked here on every write.
 * A schedule holds no question and asks for none to be produced. Available only when
 * ASSESSMENT_SNAPSHOT_EXECUTION_ENABLED is on (the exam has no other path); otherwise 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { verifyAuth, requireStudentId } from '@/lib/auth';
import { isSnapshotExecutionEnabled } from '@/lib/assessment-execution/execution-flag';
import { AD_HOC_EXAM_MAX_CONCEPTS } from '@/lib/ad-hoc-exam/selection';
import { AD_HOC_SCHEDULE_DEPTHS, createScheduledAdHocExam, listScheduledAdHocExams } from '@/services/ad-hoc-exam-schedule.service';

const CreateSchema = z.strictObject({
  subjectId: z.string().min(1).max(200),
  conceptIds: z.array(z.string().min(1).max(200)).min(1).max(AD_HOC_EXAM_MAX_CONCEPTS),
  depth: z.enum(AD_HOC_SCHEDULE_DEPTHS),
  availableMinutes: z.number().int().min(1).max(240).nullable().default(null),
  scheduledAt: z.string().min(1).max(40),
  timezone: z.string().min(1).max(64),
});

async function student(): Promise<{ studentId: string } | NextResponse> {
  if (!isSnapshotExecutionEnabled()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(authContext.userId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  return { studentId };
}

async function handleGET(request: NextRequest) {
  const who = await student();
  if (who instanceof NextResponse) return who;
  const subjectId = request.nextUrl.searchParams.get('subjectId');
  return NextResponse.json({ success: true, data: { schedules: await listScheduledAdHocExams(who.studentId, { subjectId }) } });
}

async function handlePOST(request: NextRequest) {
  const who = await student();
  if (who instanceof NextResponse) return who;
  const body = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const created = await createScheduledAdHocExam(who.studentId, body.data);
  if (!created.ok) {
    const status = created.reason === 'SCOPE_REJECTED' ? 403 : created.reason === 'UNAVAILABLE' ? 503 : 400;
    return NextResponse.json({ success: false, reason: created.reason }, { status });
  }
  return NextResponse.json({ success: true, data: { schedule: created.schedule } }, { status: 201 });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts). These handlers call no model.
export const GET = withAiRequestMetrics('GET /api/assessments/ad-hoc/schedules', handleGET);
export const POST = withAiRequestMetrics('POST /api/assessments/ad-hoc/schedules', handlePOST);
