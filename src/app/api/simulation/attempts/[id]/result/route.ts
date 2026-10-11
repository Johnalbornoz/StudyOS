/**
 * Track B / B10 -- GET /api/simulation/attempts/[id]/result
 *
 * The attempt's result view (exam score, sections, objectives with the
 * canonical learning state of their mapped concepts, item review when the
 * frozen policy allows it). Authorized against the attempt's OWN student:
 * owner, or a reader holding LEARNER_PROGRESS_VIEW (accepted parent, scoped
 * teacher). A guessed id of another learner's attempt is 404, never 403, so
 * existence is not confirmed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { resolveLearnerReadScope } from '@/lib/authorization';
import { shapeAttemptResultViewForScope } from '@/lib/authorization/learner-data-scope';
import { resolveResultViewContext } from '@/lib/authorization/learner-result-scope';
import { getSimulationAttempt } from '@/lib/simulation/attempt.service';
import { getAttemptResultView } from '@/lib/exam-core/result-view.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

async function handleGET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const attempt = await getSimulationAttempt(id);
  if (!attempt) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  // L10 SF-4 (D-1 final rulings): the owner reads their own result. A Parent or Coordinator reads a
  // result the Student can see, as a summary. A Teacher reads only the slice inside their authorized
  // subject, of a submitted attempt. Nobody but the owner receives the item-level review here.
  const scope = await resolveLearnerReadScope(actor.id, attempt.studentId);
  if (!scope.permissions.includes('LEARNER_ASSESSMENT_SUMMARY_VIEW')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const view = await getAttemptResultView(id);
  if (!view?.result) return NextResponse.json({ error: 'NO_RESULT_YET', data: { lifecycle: view?.lifecycle ?? null } }, { status: 409 });
  const context = await resolveResultViewContext({
    actorUserId: actor.id,
    scope,
    attempt,
    objectiveConceptIds: view.objectives.flatMap((o) => o.concepts.map((c) => c.canonicalConceptId)),
  });
  const shaped = shapeAttemptResultViewForScope(view, scope, context);
  // Not visible to this reader: indistinguishable from an attempt that does not exist.
  if (!shaped) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: shaped });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/simulation/attempts/[id]/result', handleGET);
