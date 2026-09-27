/**
 * The generation-time novelty MARKER for canonical sessions, and the ONE
 * submission-time verdict derived from it. Kept separate from
 * `exact-duplicate-novelty.ts` (the filter itself) so that module stays
 * limited to its three filter exports.
 */
export const EXACT_DUPLICATE_NOVELTY_POLICY = 'EXACT_DUPLICATE_EXCLUSION_V1' as const;

/**
 * The novelty marker persisted on a canonical session's v1 contract
 * (`QuizSessionV1Marker.novelty`) -- counts only, never question text.
 * Written for every canonical activity whose questions were run through
 * `filterExactDuplicates` against a prior-history base: PROVE (prior
 * Practice) and RETAIN (prior Practice + Prove + Retain, via
 * `loadPriorCanonicalQuestionFingerprintsForRetain`).
 * `priorPracticeFingerprintCount` keeps its original (Prove-era) name
 * for stored-shape compatibility; for RETAIN it is the size of the
 * broader canonical base.
 */
export interface ExactDuplicateNoveltyMarker {
  priorPracticeFingerprintCount: number;
  rejectedExactDuplicateCount: number;
  acceptedNovelQuestionCount: number;
  noveltyPolicy: typeof EXACT_DUPLICATE_NOVELTY_POLICY;
}

export function buildExactDuplicateNoveltyMarker(params: {
  priorFingerprintCount: number;
  rejectedExactDuplicateCount: number;
  acceptedNovelQuestionCount: number;
}): ExactDuplicateNoveltyMarker {
  return {
    priorPracticeFingerprintCount: params.priorFingerprintCount,
    rejectedExactDuplicateCount: params.rejectedExactDuplicateCount,
    acceptedNovelQuestionCount: params.acceptedNovelQuestionCount,
    noveltyPolicy: EXACT_DUPLICATE_NOVELTY_POLICY,
  };
}

/**
 * THE ONE submission-time novelty verdict: an administered attempt is
 * `novel` only when its session carries a recognized novelty marker AND
 * every administered item was one the filter accepted as novel. A
 * missing marker (legacy / Practice / pre-fix sessions) is never novel
 * -- never inferred.
 */
export function isExactDuplicateNoveltyCertified(
  novelty: ExactDuplicateNoveltyMarker | null | undefined,
  administeredItemCount: number,
): boolean {
  return (
    !!novelty &&
    novelty.noveltyPolicy === EXACT_DUPLICATE_NOVELTY_POLICY &&
    administeredItemCount > 0 &&
    novelty.acceptedNovelQuestionCount === administeredItemCount
  );
}
