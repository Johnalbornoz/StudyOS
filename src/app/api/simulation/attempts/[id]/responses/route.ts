/**
 * F9 -- POST /api/simulation/attempts/[id]/responses  (RETIRED for grading)
 *
 * Foundation (roles/exams shared): this route accepted a client-supplied
 * GeneratedQuestion -- answer key included -- and graded the student's answer
 * against it, then wrote EXAM_SIMULATION evidence through updateMastery. A
 * student could therefore forge a correct grade and spoof canonical mastery.
 * The only UI (ItemRunner) answers through GET/POST .../next-item, where the
 * question lives server-side (navigation_state.pendingQuestion) and cannot be
 * forged. The auth + ownership chain is kept unchanged (same 401/403
 * behaviour); an authorized caller now gets 410 and nothing is graded.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handlePOST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const attempt = await getSimulationAttempt(id);
  if (!attempt) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const allowed = await canAccessLearner(actor.id, attempt.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  // Never grade a client-supplied question (it carries its own answer key).
  return NextResponse.json(
    { error: 'GONE', message: 'Item responses are submitted through /api/simulation/attempts/[id]/next-item.' },
    { status: 410 }
  );
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/simulation/attempts/[id]/responses', handlePOST);
