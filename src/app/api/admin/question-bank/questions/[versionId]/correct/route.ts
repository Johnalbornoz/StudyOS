/**
 * Platform Admin (STUDYUS_ADMIN) -- POST /api/admin/question-bank/questions/[versionId]/correct
 *
 * An editor's correction: creates a NEW version (never an overwrite), re-validated automatically,
 * which must be certified by someone other than its editor.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { correctVersion } from '@/lib/exam-core/question-bank/review.service';
import { ReviewError } from '@/lib/exam-core/question-bank/quality';
import { BankError } from '@/lib/exam-core/question-bank/bank.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Body = z.strictObject({
  notes: z.string().trim().min(5).max(500),
  question: z.string().trim().min(5).max(8000).optional(),
  options: z.array(z.strictObject({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(2000) })).min(2).max(6).optional(),
  correctAnswer: z.string().min(1).max(40).optional(),
  explanation: z.string().trim().min(15).max(4000).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
});

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.questionBank.correct');
  if ('error' in guard) return guard.error;
  const { versionId } = await params;
  if (!z.string().uuid().safeParse(versionId).success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  const { notes, ...patch } = parsed.data;
  try {
    return NextResponse.json({ success: true, data: await correctVersion({ versionId, editorUserId: guard.admin.actor.id, patch, notes }) });
  } catch (err) {
    if (err instanceof ReviewError || err instanceof BankError) return NextResponse.json({ error: err.code }, { status: 409 });
    throw err;
  }
}

export const POST = withAiRequestMetrics('POST /api/admin/question-bank/questions/[versionId]/correct', handlePOST);
