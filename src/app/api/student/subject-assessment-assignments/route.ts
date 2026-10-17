/**
 * Overnight 2026-10-16 -- GET /api/student/subject-assessment-assignments
 * The Student's OWN teacher-assigned subject Tests / Mocks: window, attempts used / max, the action available now
 * (start / resume / none + reason), result = the latest completed attempt, attempt history. studentId is resolved
 * server-side from the actor's own identity -- never a request parameter.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, requireStudentId } from '@/lib/auth';
import { listStudentSubjectAssignments } from '@/lib/teacher/subject-assessment-assignment.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const studentId = await requireStudentId(authContext.userId);
  if (!studentId) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  return NextResponse.json({ success: true, data: { assignments: await listStudentSubjectAssignments(studentId) } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/student/subject-assessment-assignments', handleGET);
