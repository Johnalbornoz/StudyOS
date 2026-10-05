/**
 * Platform Admin (STUDYUS_ADMIN) -- POST /api/admin/question-bank/questions/[versionId]/review
 *
 * The human certification of one version: APPROVED (with validated difficulty, usage and exam
 * alignment), CORRECTION_REQUESTED or REJECTED (notes required). The author / editor of a version
 * can never certify it; generated content cannot be OFFICIAL; mock usage needs MOCK_READY.
 * Server-authoritative; the DB re-checks the critical rules. Audited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { reviewVersion } from '@/lib/exam-core/question-bank/review.service';
import { ReviewError } from '@/lib/exam-core/question-bank/quality';
import { LifecycleTransitionError } from '@/lib/exam-core/question-bank/lifecycle';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Body = z.strictObject({
  decision: z.enum(['APPROVED', 'CORRECTION_REQUESTED', 'REJECTED']),
  notes: z.string().trim().max(1000).optional(),
  validatedDifficulty: z.number().int().min(1).max(5).optional(),
  usage: z.array(z.enum(['PRACTICE', 'DIAGNOSTIC', 'QUIZ', 'REDUCED_MOCK', 'FULL_MOCK', 'FORMAL_ASSESSMENT'])).min(1).max(6).optional(),
  alignment: z.enum(['PRACTICE', 'EXAM_STYLE', 'MOCK_READY', 'OFFICIAL']).optional(),
  /** A governed pilot's review checklist (key -> confirmed). */
  checklist: z.record(z.string().regex(/^[A-Z_]{2,40}$/), z.boolean()).optional(),
});

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.questionBank.reviewDecision');
  if ('error' in guard) return guard.error;
  const { versionId } = await params;
  if (!z.string().uuid().safeParse(versionId).success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  const b = parsed.data;
  try {
    const r = await reviewVersion({ versionId, reviewerUserId: guard.admin.actor.id, input: { decision: b.decision, notes: b.notes ?? null, validatedDifficulty: b.validatedDifficulty ?? null, usage: b.usage ?? null, alignment: b.alignment ?? null, checklist: b.checklist ?? null } });
    return NextResponse.json({ success: true, data: r });
  } catch (err) {
    if (err instanceof ReviewError) return NextResponse.json({ error: err.code }, { status: err.code === 'SELF_REVIEW' ? 403 : 409 });
    if (err instanceof LifecycleTransitionError) return NextResponse.json({ error: err.code }, { status: 409 });
    if ((err as any)?.code === '23514') return NextResponse.json({ error: 'RULE_VIOLATION', message: String((err as Error).message).split(':')[0] }, { status: 409 });
    throw err;
  }
}

export const POST = withAiRequestMetrics('POST /api/admin/question-bank/questions/[versionId]/review', handlePOST);
