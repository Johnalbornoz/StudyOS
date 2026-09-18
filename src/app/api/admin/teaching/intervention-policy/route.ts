/**
 * F8 -- GET/POST /api/admin/teaching/intervention-policy
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { getActiveInterventionPolicy, createInterventionPolicyVersion } from '@/lib/teaching/intervention-policy.service';

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
  const policy = await getActiveInterventionPolicy();
  return NextResponse.json({ success: true, data: { policy } });
}

const INTERVENTION_TYPE_ENUM = z.enum(['EXPLAIN', 'WORKED_EXAMPLE', 'GUIDED_PRACTICE', 'CONTEXTUAL_HELP', 'INDEPENDENT_PRACTICE', 'PROVE']);
const GAP_TYPE_ENUM = z.enum(['KNOWLEDGE_GAP', 'SKILL_GAP', 'EXAM_TECHNIQUE_GAP', 'SPEED_FLUENCY_GAP']);

const RulesSchema = z.object({
  chains: z.record(GAP_TYPE_ENUM, z.array(INTERVENTION_TYPE_ENUM)),
  insufficientEvidenceChain: z.array(INTERVENTION_TYPE_ENUM),
  mixedTieBreakPriority: z.array(GAP_TYPE_ENUM),
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

  const policy = await createInterventionPolicyVersion(rules as any);
  return NextResponse.json({ success: true, data: { policy } });
}
