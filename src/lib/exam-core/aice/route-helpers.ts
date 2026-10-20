/**
 * Cambridge AICE -- route helpers: the acting Student (owner only) and the
 * mapping of plan errors to HTTP. A Parent / Teacher / Coordinator is never
 * the owner of a Student's Diploma plan.
 */
import { NextResponse } from 'next/server';
import { requireActor, requireOwnerOf, ownStudentId } from '@/lib/exam-core/route-auth';
import { AicePlanError } from './plan.service';

export async function studentGate(rateKey: string): Promise<{ ok: true; studentId: string; actorUserId: string } | { ok: false; response: NextResponse }> {
  const gate = await requireActor(rateKey, 60);
  if (!gate.ok) return { ok: false, response: NextResponse.json({ error: gate.error }, { status: gate.status }) };
  const studentId = await ownStudentId(gate.actorUserId);
  if (!studentId) return { ok: false, response: NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) };
  const owner = await requireOwnerOf(gate.actorUserId, studentId);
  if (!owner.ok) return { ok: false, response: NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 }) };
  return { ok: true, studentId, actorUserId: gate.actorUserId };
}

export function planErrorResponse(err: unknown): NextResponse {
  if (err instanceof AicePlanError) return NextResponse.json({ error: err.code }, { status: err.code === 'NOT_FOUND' || err.code === 'NO_PLAN' ? 404 : 409 });
  throw err;
}
