/**
 * Exam V2 -- GET/POST /api/admin/assessment/concept-proposals
 * Curator governance of LearningConceptProposals: list, and decide
 * (MAPPED_TO_EXISTING / MERGED need an existing canonical concept;
 * APPROVED_NEW records the decision -- the concept itself is created through
 * the normal concept tooling, never here; REJECTED). StudyUS admin only.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { decideConceptProposal, listConceptProposals } from '@/lib/exam-core/learning-bridge.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function requireAdmin() {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, status: 401, error: 'UNAUTHORIZED' };
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return { ok: false as const, status: 403, error: 'FORBIDDEN' };
  const actor = await getOrCreateCanonicalUser(userId, email);
  return { ok: true as const, actorId: actor.id };
}

async function handleGET(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const status = new URL(request.url).searchParams.get('status');
  const allowed = ['PROPOSED', 'MAPPED_TO_EXISTING', 'APPROVED_NEW', 'MERGED', 'REJECTED'];
  return NextResponse.json({ success: true, data: { proposals: await listConceptProposals(status && allowed.includes(status) ? (status as never) : status === 'ALL' ? null : 'PROPOSED') } });
}

const DecideSchema = z.strictObject({
  proposalId: z.string().uuid(),
  decision: z.enum(['MAPPED_TO_EXISTING', 'APPROVED_NEW', 'MERGED', 'REJECTED']),
  canonicalConceptId: z.string().uuid().optional(),
});

async function handlePOST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = DecideSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: await decideConceptProposal({ ...parsed.data, decidedBy: gate.actorId }) });
  } catch (err) {
    const code = (err as Error).message;
    if (['CANONICAL_CONCEPT_REQUIRED', 'CANONICAL_CONCEPT_NOT_FOUND', 'PROPOSAL_NOT_PENDING'].includes(code)) return NextResponse.json({ error: code }, { status: 409 });
    throw err;
  }
}

export const GET = withAiRequestMetrics('GET /api/admin/assessment/concept-proposals', handleGET);
export const POST = withAiRequestMetrics('POST /api/admin/assessment/concept-proposals', handlePOST);
