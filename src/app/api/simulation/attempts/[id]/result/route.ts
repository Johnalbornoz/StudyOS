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
  // L10 SF-4 (D-1): a result is readable as a SUMMARY by every relationship
  // entitled to it; the item-level review only with LEARNER_ASSESSMENT_DETAIL_VIEW.
  const scope = await resolveLearnerReadScope(actor.id, attempt.studentId);
  if (!scope.permissions.includes('LEARNER_ASSESSMENT_SUMMARY_VIEW')) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const view = await getAttemptResultView(id);
  if (!view?.result) return NextResponse.json({ error: 'NO_RESULT_YET', data: { lifecycle: view?.lifecycle ?? null } }, { status: 409 });
  const shaped = shapeAttemptResultViewForScope(view, scope);
  if (!shaped) return NextResponse.json({ error: 'NO_RESULT_YET', data: { lifecycle: view.lifecycle } }, { status: 409 });
  return NextResponse.json({ success: true, data: shaped });
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const GET = withAiRequestMetrics('GET /api/simulation/attempts/[id]/result', handleGET);
