/**
 * Exam preparation -- POST /api/exam-preparation/[id]/diagnostic
 *
 * "Diagnosticar mi preparación" (optional): a practice instance over the
 * practice-ready areas of the objective's exam. The server decides whether it
 * exists (capabilities from the persisted catalogue); no client flag is read.
 * An unfinished diagnostic is returned again instead of a second one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { startPreparationDiagnostic } from '@/lib/exam-core/objectives/preparation.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { studentGate, preparationErrorResponse } from '../../route-helpers';

async function handlePOST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await studentGate('/api/exam-preparation:diagnostic', 10);
  if (!gate.ok) return gate.res;
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const out = await startPreparationDiagnostic(gate.studentId, id.data);
    return NextResponse.json({ success: true, data: { instanceId: out.instanceId, reused: out.reused, simulationAttemptId: out.instance?.simulationAttemptId ?? null, status: out.instance?.status ?? null } }, { status: out.reused ? 200 : 201 });
  } catch (err) {
    return preparationErrorResponse(err);
  }
}

export const POST = withAiRequestMetrics('POST /api/exam-preparation/[id]/diagnostic', handlePOST);
