/**
 * Exam preparation -- GET / PATCH /api/exam-preparation/[id]
 *
 * GET: the preparation home data (objective, capabilities, personalized plan,
 * next step). PATCH: the Student's own goal details (exam date, target
 * institution / qualification, purpose). Owner-only; another Student's
 * preparation does not exist for the caller (404).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPreparationView, updatePreparationDetails } from '@/lib/exam-core/objectives/preparation.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { studentGate, preparationErrorResponse } from '../route-helpers';

const Id = z.string().uuid();
const PatchSchema = z.strictObject({
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  purpose: z.string().trim().max(200).nullable().optional(),
  targetInstitutionName: z.string().trim().max(200).nullable().optional(),
  targetQualification: z.string().trim().max(200).nullable().optional(),
});

async function handleGET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await studentGate();
  if (!gate.ok) return gate.res;
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const view = await getPreparationView(gate.studentId, id.data, new URL(request.url).searchParams.get('lang') ?? 'es');
  if (!view) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: { ...view, objective: { key: view.objective.key, label: view.objective.label, framework: view.objective.framework, kind: view.objective.kind, context: view.objective.context } } });
}

async function handlePATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await studentGate('/api/exam-preparation:update', 30);
  if (!gate.ok) return gate.res;
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const profile = await updatePreparationDetails(gate.studentId, id.data, parsed.data);
    return NextResponse.json({ success: true, data: { profile: { id: profile.id, examDate: profile.examDate, targetInstitutionName: profile.targetInstitutionName, targetQualification: profile.targetQualification, purpose: profile.purpose } } });
  } catch (err) {
    return preparationErrorResponse(err);
  }
}

export const GET = withAiRequestMetrics('GET /api/exam-preparation/[id]', handleGET);
export const PATCH = withAiRequestMetrics('PATCH /api/exam-preparation/[id]', handlePATCH);
