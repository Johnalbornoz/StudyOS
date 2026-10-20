/**
 * Exam V2 -- POST /api/exams/instances/[id]/start
 * Starts the instance's single attempt (a frozen Mock form is preset into the
 * attempt; nothing is generated). Returns the attempt id for the runner.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor, requireOwnerOf } from '@/lib/exam-core/route-auth';
import { getExamInstance, startExamInstance, toInstanceView, ExamInstanceError } from '@/lib/exam-core/exam-instance.service';
import { DeliveryPolicyConfigurationError, SimulationModeNotAllowedError } from '@/lib/simulation/attempt.service';
import { TimingConfigurationError } from '@/lib/simulation/plan.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const Schema = z.strictObject({ language: z.string().min(2).max(10), timezone: z.string().max(100).optional() });

async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireActor('/api/exams/instances:start', 20);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const instance = await getExamInstance(id);
  if (!instance || instance.status === 'DELETED') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const owner = await requireOwnerOf(gate.actorUserId, instance.studentId, { entitled: true });
  if (!owner.ok) return NextResponse.json({ error: owner.error === 'FORBIDDEN' ? 'NOT_FOUND' : owner.error }, { status: owner.error === 'FORBIDDEN' ? 404 : owner.status });
  try {
    const started = await startExamInstance(id, parsed.data);
    return NextResponse.json({ success: true, data: { instance: await toInstanceView(started) } });
  } catch (err) {
    if (err instanceof ExamInstanceError) return NextResponse.json({ error: err.code, detail: err.code === 'ATTEMPT_IN_PROGRESS' ? err.message.split(': ')[1] : undefined }, { status: 409 });
    if (err instanceof TimingConfigurationError) return NextResponse.json({ error: 'TIMING_NOT_CONFIGURED' }, { status: 409 });
    if (err instanceof SimulationModeNotAllowedError) return NextResponse.json({ error: 'SIMULATION_MODE_NOT_ALLOWED', reason: err.reason }, { status: 409 });
    if (err instanceof DeliveryPolicyConfigurationError) return NextResponse.json({ error: 'DELIVERY_POLICY_INVALID' }, { status: 409 });
    throw err;
  }
}

export const POST = withAiRequestMetrics('POST /api/exams/instances/[id]/start', handlePOST);
