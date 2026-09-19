import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { getActiveReadinessPolicy, createReadinessPolicyVersion } from '@/lib/readiness/policy.service';

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, status: 401, error: 'UNAUTHORIZED' };
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return { ok: false as const, status: 403, error: 'FORBIDDEN' };
  return { ok: true as const };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const policy = await getActiveReadinessPolicy();
  return NextResponse.json({ success: true, data: { policy } });
}

const RulesSchema = z.object({
  gapBasedDimensions: z.object({ minimumDiagnosedTargetsForConfidentStatus: z.number() }),
  coverage: z.object({ minimumEvidencedFractionForEarlyPreparation: z.number(), minimumEvidencedFractionForSimulationReady: z.number() }),
  evidenceSufficiency: z.object({
    minimumQualifyingEvidenceForSufficient: z.number(),
    minimumDistinctQuestionTypesForSufficient: z.number(),
    maxRecencyDaysForFresh: z.number(),
  }),
  simulationPerformance: z.object({ minimumCompletedAttemptsForConfidentStatus: z.number() }),
});

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  let rules;
  try {
    rules = RulesSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const policy = await createReadinessPolicyVersion(rules);
  return NextResponse.json({ success: true, data: { policy } });
}
