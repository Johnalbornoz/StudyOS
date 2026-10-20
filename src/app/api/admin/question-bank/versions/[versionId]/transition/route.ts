/**
 * Platform Admin (STUDYUS_ADMIN) -- POST /api/admin/question-bank/versions/[versionId]/transition
 *
 * A governed, audited lifecycle move of one item version taken by a human:
 * approve a reviewed item, promote PILOT -> ACTIVE, suspend, retire. The same
 * server-side transition table (and the database trigger) decides: an invalid
 * move fails, generated content can never skip PILOT, retirement never deletes
 * history. A reason is mandatory.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { transitionVersion, BankError } from '@/lib/exam-core/question-bank/bank.service';
import { LifecycleTransitionError } from '@/lib/exam-core/question-bank/lifecycle';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Body = z.strictObject({
  to: z.enum(['VALIDATED', 'PILOT', 'ACTIVE', 'SUSPENDED', 'RETIRED', 'REJECTED', 'REVIEW_REQUIRED']),
  reason: z.string().trim().min(5).max(300),
});

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.questionBank.transition');
  if ('error' in guard) return guard.error;
  const { versionId } = await params;
  if (!z.string().uuid().safeParse(versionId).success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  // ACTIVE is a certification: it goes through the human review (Approve), never a bare transition.
  if (parsed.data.to === 'ACTIVE') return NextResponse.json({ error: 'USE_REVIEW_TO_APPROVE' }, { status: 409 });
  try {
    const r = await transitionVersion({ versionId, to: parsed.data.to, reason: `ADMIN:${parsed.data.reason}`, actor: { kind: 'ADMIN', userId: guard.admin.actor.id } });
    return NextResponse.json({ success: true, data: r });
  } catch (err) {
    if (err instanceof LifecycleTransitionError) return NextResponse.json({ error: err.code }, { status: 409 });
    if (err instanceof BankError) return NextResponse.json({ error: err.code }, { status: err.code === 'NOT_FOUND' ? 404 : 409 });
    if ((err as any)?.code === '23514') return NextResponse.json({ error: 'INVALID_TRANSITION' }, { status: 409 });
    throw err;
  }
}

export const POST = withAiRequestMetrics('POST /api/admin/question-bank/versions/[versionId]/transition', handlePOST);
