/**
 * Exam history -- DELETE /api/exams/attempts/[id]  { confirm: true, reason? }
 * Removes one row of the Student's exam history (history.service.ts): the
 * exam instance's own rules when the attempt has one, otherwise a soft hide
 * (an in-progress attempt is cancelled first). Results, responses and
 * consolidated learning evidence are never deleted. Owner-only; a foreign id
 * is 404. Repeating the call returns the same outcome.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireActor, requireOwnerOf } from '@/lib/exam-core/route-auth';
import { getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { deleteAttemptFromHistory } from '@/lib/exam-core/history.service';
import { ExamInstanceError } from '@/lib/exam-core/exam-instance.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const UUID = /^[0-9a-f-]{36}$/i;
const DeleteSchema = z.strictObject({ confirm: z.boolean().default(false), reason: z.string().max(200).optional() });

async function handleDELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireActor('/api/exams/attempts:delete', 20);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!UUID.test(id)) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const parsed = DeleteSchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const attempt = await getSimulationAttempt(id);
  // 404, not 403: a guessed id never confirms another Student's exam exists.
  if (!attempt) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const owner = await requireOwnerOf(gate.actorUserId, attempt.studentId);
  if (!owner.ok) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    const out = await deleteAttemptFromHistory(attempt.id, { ...parsed.data, ownerStudentId: attempt.studentId });
    return NextResponse.json({ success: true, data: out });
  } catch (err) {
    if (err instanceof ExamInstanceError) return NextResponse.json({ error: err.code }, { status: err.code === 'NOT_FOUND' ? 404 : 409 });
    throw err;
  }
}

export const DELETE = withAiRequestMetrics('DELETE /api/exams/attempts/[id]', handleDELETE);
