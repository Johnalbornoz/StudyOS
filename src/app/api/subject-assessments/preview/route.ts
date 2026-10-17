/**
 * POST /api/subject-assessments/preview -- what StudyUs WOULD create for this selection (overnight 2026-10-16): question
 * count, per-concept distribution, rule, difficulty AUTO, timing. Nothing is generated or stored. The count is the
 * same plan the creation uses (planSubjectAssessment); the Mock's duration is fixed at creation from the frozen items.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { z } from 'zod';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { planSubjectAssessment } from '@/services/subject-assessment.service';

const PreviewSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  kind: z.enum(['TEST', 'MOCK']),
  conceptIds: z.array(z.string().uuid()).min(1).max(500),
});

async function handlePOST(request: NextRequest) {
  const auth = await verifyAuth();
  if (!auth) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: z.infer<typeof PreviewSchema>;
  try {
    body = PreviewSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  if (!(await verifyStudentAccess(auth.userId, body.studentId, auth.role))) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  const r = await planSubjectAssessment({ studentId: body.studentId, subjectId: body.subjectId, kind: body.kind, origin: 'STUDENT', conceptIds: body.conceptIds });
  if (!r.ok) return NextResponse.json({ error: r.error, message: r.message, ...(r.detail ? { detail: r.detail } : {}) }, { status: r.status });
  const { plan } = r;
  return NextResponse.json({
    success: true,
    data: {
      kind: plan.kind, questionCount: plan.questionCount, distribution: plan.distribution, rule: plan.rule,
      difficulty: 'AUTO', timed: plan.timed, durationRule: plan.timed ? 'NOMINAL_RESPONSE_TIME_SUM' : null,
      allSubject: plan.allSubject ?? false, mockBand: plan.mockBand ?? null,
    },
  });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/subject-assessments/preview', handlePOST);
