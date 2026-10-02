/**
 * Cambridge AICE Diploma -- POST /api/aice/plan/entries
 * Adds a subject to the Student's own plan: syllabus code (from the sourced
 * catalogue), AS / A Level, the group it counts in (only among its eligible
 * groups) and the expected exam series. Credits are never sent -- the policy
 * derives them. Owner only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { addPlanEntry } from '@/lib/exam-core/aice/plan.service';
import { studentGate, planErrorResponse } from '@/lib/exam-core/aice/route-helpers';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Series = z.strictObject({ year: z.number().int().min(2020).max(2100), month: z.union([z.literal(3), z.literal(6), z.literal(11)]) });
const Schema = z.strictObject({
  syllabusCode: z.string().regex(/^\d{4}$/),
  level: z.enum(['AS', 'A']),
  countedGroup: z.enum(['CORE', 'GROUP_1', 'GROUP_2', 'GROUP_3', 'GROUP_4']).nullable().optional(),
  expectedSeries: Series.nullable().optional(),
});

async function handlePOST(request: NextRequest) {
  const g = await studentGate('/api/aice/plan:entries');
  if (!g.ok) return g.response;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await addPlanEntry(g.studentId, parsed.data) });
  } catch (err) {
    return planErrorResponse(err);
  }
}

export const POST = withAiRequestMetrics('POST /api/aice/plan/entries', handlePOST);
