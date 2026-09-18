/**
 * F8 -- POST /api/diagnostics/run
 *
 * Runs a gap diagnosis for one (studentId, conceptId). Gated by
 * LEARNER_INTERVENTION_CREATE (owner-only, task §34) since a diagnosis
 * run is the entry point to the intervention flow, not passive
 * progress viewing -- LEARNER_PROGRESS_VIEW (also owner/parent/teacher)
 * covers reading a diagnosis already computed (see GET
 * /api/diagnostics).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { runDiagnosis } from '@/lib/diagnostics/diagnosis.service';

const RunSchema = z.object({
  studentId: z.string().uuid(),
  conceptId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  scope: z
    .object({
      skillId: z.string().uuid().optional(),
      learningObjectiveId: z.string().uuid().optional(),
      examVersionId: z.string().uuid().optional(),
      assessmentComponentId: z.string().uuid().optional(),
      commandTermId: z.string().uuid().optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  let validated;
  try {
    validated = RunSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const allowed = await canAccessLearner(actor.id, validated.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const diagnosis = await runDiagnosis(validated);
  return NextResponse.json({ success: true, data: { diagnosis } });
}
