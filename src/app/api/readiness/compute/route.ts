/**
 * F9 -- POST /api/readiness/compute
 *
 * Computes a new readiness snapshot (never rewrites a prior one).
 * LEARNER_INTERVENTION_CREATE (owner-only) since this triggers real
 * work (F8 diagnosis runs), matching F8's own precedent for
 * /api/diagnostics/run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { computeReadinessSnapshot } from '@/lib/readiness/readiness.service';

const ComputeSchema = z.object({
  studentId: z.string().uuid(),
  examProfileId: z.string().uuid(),
  examVersionId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  let validated;
  try {
    validated = ComputeSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const allowed = await canAccessLearner(actor.id, validated.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const snapshot = await computeReadinessSnapshot(validated);
  return NextResponse.json({ success: true, data: { snapshot } });
}
