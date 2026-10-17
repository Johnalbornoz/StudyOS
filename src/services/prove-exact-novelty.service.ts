/**
 * D75 -- PROVE EXACT-ITEM NOVELTY: THE ONE exclusion set every PROVE
 * selection path filters against.
 *
 *   exact prior PRACTICE items  (unchanged since CANON-R6R1)
 * + exact prior PROVE items     (D75: a retry never re-administers one)
 *
 * Exact only -- the same normalized-text fingerprint as
 * exact-duplicate-novelty.ts. A near-identical (paraphrased) item is
 * ALLOWED by policy; nothing here detects meaning.
 *
 * Used by: live Prove generation (canonical-prove-generation.service),
 * the prepared-batch consumption re-check (canonical-prepared-activity
 * .service), bank assembly + bank-inventory consumption for PROVE
 * (activity-assembly.service / activity-delivery.service).
 */
import { loadPriorPracticeQuestionFingerprints, loadPriorProveQuestionFingerprints } from '@/services/quiz-persistence.service';

/** Machine-readable outcome when exact novelty cannot be met with the available supply. */
export const PROVE_EXACT_NOVELTY_SUPPLY_SHORTAGE = 'PROVE_EXACT_NOVELTY_SUPPLY_SHORTAGE' as const;

export interface ProveExactNoveltyExclusions {
  /** Union of both histories -- the set to filter against. */
  fingerprints: Set<string>;
  priorPracticeCount: number;
  priorProveCount: number;
}

export async function loadProveExactNoveltyExclusions(studentId: string, conceptId: string): Promise<ProveExactNoveltyExclusions> {
  const [practice, prove] = await Promise.all([
    loadPriorPracticeQuestionFingerprints(studentId, conceptId),
    loadPriorProveQuestionFingerprints(studentId, conceptId),
  ]);
  const practiceSet = practice ?? new Set<string>();
  const proveSet = prove ?? new Set<string>();
  return { fingerprints: new Set([...practiceSet, ...proveSet]), priorPracticeCount: practiceSet.size, priorProveCount: proveSet.size };
}
