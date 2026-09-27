/**
 * PROVE_GENERATION_PERFORMANCE -- the ONE background trigger that keeps a
 * Prove batch prepared while PROVE is the learner's canonical next action.
 * Resolves the SAME generation context the live request uses (subject quiz
 * language, IB/DP/HL context, shared Prove guidance) and delegates to
 * `ensureCanonicalProvePrepared` (dedup, TTL, stale cleanup, certified
 * pipeline). Runs after the response (`after()`), never on the learner's
 * critical path, never throws.
 */
import type { CanonicalPedagogicalDecision } from '@/lib/pedagogical-engine/types';
import { CANONICAL_PROVE_GENERATION_CONFIG } from '@/lib/quiz/canonical-prove-config';
import { ensureCanonicalProvePrepared, type EnsureProvePreparedOutcome } from '@/services/canonical-prepared-activity.service';
import { getSubjectIBContext, resolveLanguageForSubject } from '@/services/subject-generation-context.service';

type Decision = Pick<CanonicalPedagogicalDecision, 'stage' | 'actionState' | 'activityContract' | 'policyVersion' | 'canonicalRevision'>;

/** Cheap, synchronous gate: only a PROVE-executable decision can ever need preparation. */
export function decisionMayNeedProvePreparation(decision: Decision | null | undefined): decision is Decision {
  return !!decision && decision.stage === 'PROVE' && decision.actionState === 'EXECUTABLE' && !!decision.activityContract;
}

export async function keepCanonicalProvePrepared(params: {
  studentId: string;
  subjectId: string;
  conceptId: string;
  decision: Decision;
}): Promise<EnsureProvePreparedOutcome> {
  try {
    if (!decisionMayNeedProvePreparation(params.decision)) return 'NOT_APPLICABLE';
    const [language, ibContext] = await Promise.all([
      resolveLanguageForSubject(params.subjectId, params.studentId),
      getSubjectIBContext(params.subjectId),
    ]);
    const outcome = await ensureCanonicalProvePrepared({
      ...params,
      language,
      ibContext,
      guidance: CANONICAL_PROVE_GENERATION_CONFIG.guidance,
      visualAidRate: CANONICAL_PROVE_GENERATION_CONFIG.visualAidRate,
    });
    console.log('prove_preparation_trigger', JSON.stringify({ conceptId: params.conceptId, outcome }));
    return outcome;
  } catch (error) {
    console.error('[prove-preparation-trigger] failed:', error);
    return 'FAILED';
  }
}
