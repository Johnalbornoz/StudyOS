/**
 * Cambridge AICE Diploma -- PATCH / DELETE /api/aice/plan/entries/[id]
 * Changes the level, the counted group (among the subject's eligible groups)
 * or the expected series of one subject in the Student's own plan, or removes
 * it from the plan (results are never touched). Owner only; another Student's
 * entry is 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { updatePlanEntry, removePlanEntry } from '@/lib/exam-core/aice/plan.service';
import { studentGate, planErrorResponse } from '@/lib/exam-core/aice/route-helpers';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const UUID = /^[0-9a-f-]{36}$/i;
const Series = z.strictObject({ year: z.number().int().min(2020).max(2100), month: z.union([z.literal(3), z.literal(6), z.literal(11)]) });
const Patch = z.strictObject({
  level: z.enum(['AS', 'A']).optional(),
  countedGroup: z.enum(['CORE', 'GROUP_1', 'GROUP_2', 'GROUP_3', 'GROUP_4']).nullable().optional(),
  expectedSeries: Series.nullable().optional(),
});

async function handlePATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await studentGate('/api/aice/plan:entries');
  if (!g.ok) return g.response;
  if (!UUID.test(id)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    await updatePlanEntry(g.studentId, id, parsed.data);
    return NextResponse.json({ success: true });
  } catch (err) {
    return planErrorResponse(err);
  }
}

async function handleDELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await studentGate('/api/aice/plan:entries');
  if (!g.ok) return g.response;
  if (!UUID.test(id)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    await removePlanEntry(g.studentId, id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return planErrorResponse(err);
  }
}

export const PATCH = withAiRequestMetrics('PATCH /api/aice/plan/entries/[id]', handlePATCH);
export const DELETE = withAiRequestMetrics('DELETE /api/aice/plan/entries/[id]', handleDELETE);
