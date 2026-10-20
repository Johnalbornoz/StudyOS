/**
 * Platform Admin (STUDYUS_ADMIN) -- GET /api/admin/question-bank/review
 *
 * "Pending academic review": generated versions that passed automated validation and wait for a
 * human decision, with filters (exam, section, objective, difficulty, generated date, validation
 * result, usage, alignment). `status=ALL` lists every current version instead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { reviewQueue } from '@/lib/exam-core/question-bank/review-admin.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Q = z.object({
  examVersionId: z.string().uuid().optional(),
  sectionKey: z.string().regex(/^[a-z0-9._-]{1,80}$/).optional(),
  objectiveCode: z.string().regex(/^[a-z0-9._-]{1,80}$/).optional(),
  band: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  generatedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  generatedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  validation: z.enum(['PASS', 'FAIL']).optional(),
  usage: z.enum(['PRACTICE', 'DIAGNOSTIC', 'QUIZ', 'REDUCED_MOCK', 'FULL_MOCK', 'FORMAL_ASSESSMENT']).optional(),
  alignment: z.enum(['PRACTICE', 'EXAM_STYLE', 'MOCK_READY', 'OFFICIAL']).optional(),
  status: z.enum(['PENDING', 'ALL']).optional(),
});

async function handleGET(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.questionBank.review');
  if ('error' in guard) return guard.error;
  const parsed = Q.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  return NextResponse.json({ success: true, data: { items: await reviewQueue(parsed.data) } });
}

export const GET = withAiRequestMetrics('GET /api/admin/question-bank/review', handleGET);
