/**
 * F8 -- GET/POST /api/admin/diagnostics/policy
 *
 * Minimal admin surface for the versioned diagnostic policy. Same
 * isAdminEmail gate as every other /api/admin/* route.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { getActiveDiagnosticPolicy, createDiagnosticPolicyVersion } from '@/lib/diagnostics/policy.service';

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
  const policy = await getActiveDiagnosticPolicy();
  return NextResponse.json({ success: true, data: { policy } });
}

const RulesSchema = z.object({
  knowledge: z.object({ minimumIndependentEvidenceCount: z.number(), minimumDistinctForms: z.number(), failureRateThreshold: z.number() }),
  skill: z.object({ minimumQualifyingEvidenceCount: z.number(), failureRateThreshold: z.number() }),
  technique: z.object({
    minimumSimpleFormEvidenceCount: z.number(),
    minimumComplexFormEvidenceCount: z.number(),
    knowledgeSoundThreshold: z.number(),
    failureRateThreshold: z.number(),
  }),
  speed: z.object({
    minimumValidTimingSampleCount: z.number(),
    minimumCorrectnessBaseline: z.number(),
    latencyRatioThreshold: z.number(),
    expectedResponseTimeMsByDifficultyBand: z.record(z.string(), z.number().nullable()),
  }),
  mixedGapPriority: z.array(z.enum(['KNOWLEDGE_GAP', 'SKILL_GAP', 'EXAM_TECHNIQUE_GAP', 'SPEED_FLUENCY_GAP'])),
  confidence: z.object({ baseConfidenceAtMinimumEvidence: z.number(), confidenceGainPerExtraEvidenceItem: z.number() }),
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

  const policy = await createDiagnosticPolicyVersion(rules);
  return NextResponse.json({ success: true, data: { policy } });
}
