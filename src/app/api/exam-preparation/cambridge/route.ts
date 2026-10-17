/**
 * FD Cambridge -- GET / POST /api/exam-preparation/cambridge
 *
 * The Cambridge preparation creation flow: programme -> subject -> tier -> exam year -> exam series -> create.
 * GET: the flow state for a partial selection (query string), with the options of every step reached, the
 * syllabus auto-resolution (RESOLVED / CHOICE_REQUIRED / BLOCKED) and the step errors. Only valid series are
 * offered. POST: validates the complete selection on the server and creates the preparation with its frozen
 * target (qualification, subject, tier, examYear, examSeries, syllabusCode, syllabusVersion, preparationStartDate).
 * Owner-only (the Student's own preparation).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { cambridgeCreationState, cambridgeFlowErrorStatus, CambridgeFlowError, createCambridgePreparation } from '@/lib/exam-core/cambridge/creation.service';
import { studentGate, preparationErrorResponse } from '../route-helpers';

const Token = z.string().regex(/^[A-Z_]{2,40}$/);
const Selection = z.strictObject({
  programme: Token.optional(),
  subject: Token.optional(),
  tier: Token.nullable().optional(),
  examYear: z.coerce.number().int().min(2000).max(2100).optional(),
  examSeries: Token.optional(),
  syllabusChoice: z.string().regex(/^[0-9A-Za-z]{3,8}:[0-9A-Za-z._-]{1,20}$/).nullable().optional(),
});
const CreateSchema = Selection.extend({ timezone: z.string().max(100).optional() });

async function handleGET(request: NextRequest) {
  const gate = await studentGate();
  if (!gate.ok) return gate.res;
  const sp = new URL(request.url).searchParams;
  const raw: Record<string, string> = {};
  for (const k of ['programme', 'subject', 'tier', 'examYear', 'examSeries', 'syllabusChoice']) {
    const v = sp.get(k);
    if (v) raw[k] = v;
  }
  const parsed = Selection.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  const state = await cambridgeCreationState(gate.studentId, parsed.data, sp.get('lang') ?? 'es');
  return NextResponse.json({ success: true, data: state });
}

async function handlePOST(request: NextRequest) {
  const gate = await studentGate('/api/exam-preparation/cambridge:create', 20);
  if (!gate.ok) return gate.res;
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const r = await createCambridgePreparation(gate.studentId, parsed.data);
    return NextResponse.json(
      { success: true, data: { profile: { id: r.profile.id, objectiveKey: r.profile.objectiveKey, status: r.profile.status }, created: r.created, freeze: r.freeze, calendar: r.calendar, seriesDiffers: r.seriesDiffers, capabilities: r.capabilities } },
      { status: r.created ? 201 : 200 }
    );
  } catch (err) {
    if (err instanceof CambridgeFlowError) return NextResponse.json({ error: err.code, field: err.field, detail: err.detail ?? null }, { status: cambridgeFlowErrorStatus(err.code) });
    return preparationErrorResponse(err);
  }
}

export const GET = withAiRequestMetrics('GET /api/exam-preparation/cambridge', handleGET);
export const POST = withAiRequestMetrics('POST /api/exam-preparation/cambridge', handlePOST);
