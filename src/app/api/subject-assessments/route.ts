/**
 * GET /api/subject-assessments?studentId=...&subjectId=... -- the Student's own subject Tests / Mocks (scheduled, in
 * progress, and recent completed / expired), for "Mis evaluaciones programadas". Owner only. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { listStudentSubjectAssessments } from '@/services/subject-assessment.service';

async function handleGET(request: NextRequest) {
  const studentId = request.nextUrl.searchParams.get('studentId');
  const subjectId = request.nextUrl.searchParams.get('subjectId');
  if (!studentId || !/^[0-9a-f-]{36}$/i.test(studentId) || (subjectId && !/^[0-9a-f-]{36}$/i.test(subjectId))) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const auth = await verifyAuth();
  if (!auth) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!(await verifyStudentAccess(auth.userId, studentId, auth.role))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const items = await listStudentSubjectAssessments(studentId, subjectId);
  return NextResponse.json({ success: true, data: { items } });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/subject-assessments', handleGET);
