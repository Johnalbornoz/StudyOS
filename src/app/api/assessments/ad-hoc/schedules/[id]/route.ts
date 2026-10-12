/**
 * A Student's own partial exam -- one schedule.
 *
 *   DELETE   cancels it (SCHEDULED -> CANCELLED). The row is kept as history; nothing is erased.
 *
 * Only the signed-in Student's own schedule: another Student's is "not found".
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { verifyAuth, requireStudentId } from '@/lib/auth';
import { isSnapshotExecutionEnabled } from '@/lib/assessment-execution/execution-flag';
import { cancelScheduledAdHocExam } from '@/services/ad-hoc-exam-schedule.service';

async function handleDELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSnapshotExecutionEnabled()) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(authContext.userId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const { id } = await params;
  const cancelled = await cancelScheduledAdHocExam(studentId, id);
  return cancelled ? NextResponse.json({ success: true }) : NextResponse.json({ success: false, reason: 'NOT_FOUND' }, { status: 404 });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts). This handler calls no model.
export const DELETE = withAiRequestMetrics('DELETE /api/assessments/ad-hoc/schedules/[id]', handleDELETE);
