/**
 * Exam preparation -- POST /api/exam-preparation/[id]/concepts
 *
 * "Añadir a mi plan" for ONE requirement concept of this preparation (a
 * reviewed, PUBLISHED link). The concept joins the Student's own learning --
 * or, when already studied, is reused as it is (same learner state, nothing
 * reset). Never a bulk enrolment.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addConceptFromPreparation } from '@/lib/exam-core/objectives/preparation.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { studentGate, preparationErrorResponse } from '../../route-helpers';

const Body = z.strictObject({
  learningObjectiveId: z.string().uuid(),
  canonicalConceptId: z.string().uuid(),
  language: z.string().min(2).max(10).default('es'),
});

async function handlePOST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await studentGate('/api/exam-preparation:concept', 30);
  if (!gate.ok) return gate.res;
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await addConceptFromPreparation(gate.studentId, id.data, parsed.data) });
  } catch (err) {
    return preparationErrorResponse(err);
  }
}

export const POST = withAiRequestMetrics('POST /api/exam-preparation/[id]/concepts', handlePOST);
