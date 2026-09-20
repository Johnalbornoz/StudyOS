/**
 * F14 -- POST /api/simulation/attempts/[id]/abandon
 *
 * F9's `abandonSimulationAttempt` (attempt.service.ts) already existed
 * with no route exposing it -- the same "backend ready, no adapter"
 * gap this whole platform's UI phases keep finding. Mirrors the
 * existing pause/resume routes exactly: same auth, same permission,
 * same shape.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { getSimulationAttempt, abandonSimulationAttempt } from '@/lib/simulation/attempt.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const attempt = await getSimulationAttempt(id);
  if (!attempt) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const allowed = await canAccessLearner(actor.id, attempt.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  try {
    const abandoned = await abandonSimulationAttempt(id);
    return NextResponse.json({ success: true, data: { attempt: abandoned } });
  } catch (err) {
    return NextResponse.json({ error: 'ABANDON_NOT_ALLOWED', message: err instanceof Error ? err.message : undefined }, { status: 409 });
  }
}
