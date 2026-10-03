/**
 * Exam preparation (objective first) -- shared gate and error mapping.
 * Owner-only: a Student acts on their OWN preparations; a Teacher or Parent
 * relationship never does. Choosing an exam goal needs no entitlement and no
 * institution (an independent Student can prepare for any exam).
 */
import { NextResponse } from 'next/server';
import { requireActor, requireOwnerOf, ownStudentId } from '@/lib/exam-core/route-auth';
import { PreparationError } from '@/lib/exam-core/objectives/preparation.service';
import { ExamInstanceError } from '@/lib/exam-core/exam-instance.service';

export async function studentGate(rateKey?: string, limit?: number): Promise<{ ok: true; studentId: string } | { ok: false; res: NextResponse }> {
  const gate = await requireActor(rateKey, limit);
  if (!gate.ok) return { ok: false, res: NextResponse.json({ error: gate.error }, { status: gate.status }) };
  const studentId = await ownStudentId(gate.actorUserId);
  if (!studentId) return { ok: false, res: NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) };
  const owner = await requireOwnerOf(gate.actorUserId, studentId);
  if (!owner.ok) return { ok: false, res: NextResponse.json({ error: owner.error }, { status: owner.status }) };
  return { ok: true, studentId };
}

export function preparationErrorResponse(err: unknown): NextResponse {
  if (err instanceof PreparationError) {
    const status = err.code === 'NOT_FOUND' || err.code === 'OBJECTIVE_NOT_FOUND' ? 404 : err.code === 'REQUIREMENT_NOT_IN_PREPARATION' ? 400 : 409;
    return NextResponse.json({ error: err.code }, { status });
  }
  if (err instanceof ExamInstanceError) return NextResponse.json({ error: err.code }, { status: 409 });
  throw err;
}
