/**
 * F3 -- GET /api/learning/session-eligibility?studentId=...
 *
 * THE genuine "authorized AND entitled" composition (§14 of the task):
 * `authorized = F2.canAccessLearner(actor, learner, 'LEARNER_PROGRESS_VIEW')`
 * `entitled  = F3.canUseCapability(actor, learner, 'LEARNING_FULL_ACCESS')`
 * `eligible  = authorized AND entitled`
 *
 * Deliberately a NEW, standalone route rather than a change to any
 * existing pedagogical route (session start, quiz generation, etc.) --
 * this phase must not touch Canonical V2 or its call sites
 * (INV-F3-12). It exists purely to prove the composition is real and
 * independently computed, not to replace any existing gate.
 *
 * For the realistic case (a student checking their own eligibility),
 * `authorized` is trivially true via F2's owner-permission branch;
 * `entitled` is the one that actually varies with subscription state.
 * The route still calls both services independently -- never
 * shortcuts one because the other looks sufficient.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { canUseCapability } from '@/lib/entitlements';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const [authorized, entitled] = await Promise.all([
    canAccessLearner(actor.id, studentId, 'LEARNER_PROGRESS_VIEW'),
    canUseCapability(actor.id, studentId, 'LEARNING_FULL_ACCESS'),
  ]);

  const eligible = authorized && entitled;
  return NextResponse.json({ success: true, data: { authorized, entitled, eligible } });
}
