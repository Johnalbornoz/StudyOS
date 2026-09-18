/**
 * F2 / §16 -- GET /api/learners/[id]/summary
 *
 * The one relationship-based (not ownership-based) read of a learner's
 * progress -- reachable by a Parent with an ACTIVE relationship OR a
 * Teacher with a matching ACTIVE assignment, through the SAME
 * canonical authorization call (`canAccessLearner`, permission
 * `LEARNER_PROGRESS_VIEW`). This is deliberately the proof surface for
 * F2's central authorization service (§11 of the task) -- existing
 * student-owned routes are untouched and keep using verifyStudentAccess
 * directly (§12: ownership stays the simplest path, never routed
 * through this).
 *
 * `learnerId` comes from the URL only; the actor coumes only from the
 * authenticated session. A caller with no qualifying relationship gets
 * the same 403 regardless of whether the learner exists, so a denied
 * request never confirms/denies a particular learner id (AC-F2-17).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { getChildOverview } from '@/services/parent.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: learnerId } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const allowed = await canAccessLearner(actor.id, learnerId, 'LEARNER_PROGRESS_VIEW');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const overview = await getChildOverview(learnerId);
  return NextResponse.json({ success: true, data: overview });
}
