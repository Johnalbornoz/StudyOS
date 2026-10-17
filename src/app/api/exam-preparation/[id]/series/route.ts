/**
 * FD Cambridge §18 -- GET / POST /api/exam-preparation/[id]/series
 *
 * The explicit series change of a frozen Cambridge preparation. GET: the frozen target, its calendar and the
 * series / years it may move to. POST: requires `confirm: true`; keeps the same preparation (progress, attempts
 * and evidence stay attached), updates the target, recomputes the calendar and appends an audit record.
 * Never a silent mutation. Owner-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { cambridgeFlowErrorStatus, CambridgeFlowError, cambridgeSeriesChangeView, changeCambridgeSeries } from '@/lib/exam-core/cambridge/creation.service';
import { studentGate, preparationErrorResponse } from '../../route-helpers';

const Id = z.string().uuid();
const Body = z.strictObject({
  examSeries: z.string().regex(/^[A-Z_]{2,20}$/),
  examYear: z.number().int().min(2000).max(2100),
  confirm: z.boolean(),
  reason: z.string().trim().max(200).nullable().optional(),
  syllabusChoice: z.string().regex(/^[0-9A-Za-z]{3,8}:[0-9A-Za-z._-]{1,20}$/).nullable().optional(),
});

const flowError = (err: unknown) =>
  err instanceof CambridgeFlowError ? NextResponse.json({ error: err.code, field: err.field, detail: err.detail ?? null }, { status: cambridgeFlowErrorStatus(err.code) }) : preparationErrorResponse(err);

async function handleGET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await studentGate();
  if (!gate.ok) return gate.res;
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    return NextResponse.json({ success: true, data: await cambridgeSeriesChangeView(gate.studentId, id.data) });
  } catch (err) {
    return flowError(err);
  }
}

async function handlePOST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await studentGate('/api/exam-preparation/series', 10);
  if (!gate.ok) return gate.res;
  const id = Id.safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const r = await changeCambridgeSeries(gate.studentId, id.data, parsed.data);
    return NextResponse.json({ success: true, data: { profile: { id: r.profile.id, targetExamSeries: r.profile.targetExamSeries ?? null, targetExamYear: r.profile.targetExamYear ?? null }, freeze: r.freeze, calendar: r.calendar } });
  } catch (err) {
    return flowError(err);
  }
}

export const GET = withAiRequestMetrics('GET /api/exam-preparation/[id]/series', handleGET);
export const POST = withAiRequestMetrics('POST /api/exam-preparation/[id]/series', handlePOST);
