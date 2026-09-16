/**
 * CANON-R6R1 -- PROVE EXACT-DUPLICATE NOVELTY (MINIMUM SCOPE).
 *
 * This is deliberately the SMALLEST possible novelty policy: a v1 Prove
 * question is rejected only when its normalized prompt text is
 * byte-identical to a question already administered in a prior v1
 * Practice attempt for the same (student, concept), or to another
 * question already accepted earlier in the same Prove batch.
 *
 * This module explicitly does NOT implement, and must never be
 * extended in this phase to implement, semantic novelty: no embeddings,
 * no similarity model, no paraphrase detection. "Materially different
 * wording that means the same thing" is out of scope -- only exact
 * (post-normalization) text matches are excluded.
 */
import type { GeneratedQuestion } from '@/services/quiz-generation.service';

/**
 * Pure, deterministic. Normalizes only INCIDENTAL formatting
 * differences a human would never consider "a different question":
 * Unicode form, surrounding whitespace, runs of internal whitespace,
 * and letter case. Never strips mathematical symbols, punctuation that
 * changes meaning, or any other semantic content -- this is
 * exact-duplicate detection, not semantic novelty, and must stay that
 * conservative.
 */
export function normalizeQuestionForExactNovelty(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * CANON-R6R1 Part 5 -- the ONE field used for fingerprinting is
 * `question.question`: the always-populated prose prompt shown to the
 * learner for every question type, including structured types whose
 * OWN type contract documents `question` as holding the visible prompt
 * (e.g. fill_blank: "question holds the prose prompt", with
 * `blankTemplate` only the display template). Structured-answer fields
 * (`matchingPairs`/`orderingItems`/`classificationItems`/
 * `correctAnswer`) are answer-shape metadata, not the prompt the
 * learner reads, and are deliberately excluded from the fingerprint.
 * Volatile fields (`id`, `askConfidence`) are never included.
 */
export function fingerprintQuestion(question: Pick<GeneratedQuestion, 'question'>): string {
  return normalizeQuestionForExactNovelty(question.question);
}

export interface ExactDuplicateFilterResult {
  /** Candidates that were NOT an exact duplicate of anything in `excludeFingerprints` or of an earlier candidate in this same call. */
  accepted: GeneratedQuestion[];
  /** How many candidates were rejected as exact duplicates (prior-Practice OR intra/cross-batch). */
  rejectedCount: number;
  /** `excludeFingerprints` plus every fingerprint just accepted -- pass this back in as `excludeFingerprints` on the next call so a later batch is filtered against everything accepted so far too. */
  fingerprints: Set<string>;
}

/**
 * Pure. No IO. Never mutates `candidates` or `excludeFingerprints`.
 * Also deduplicates WITHIN `candidates` itself (CANON-R6R1 Part 6 step
 * 4): if two candidates in the same array normalize to the same
 * fingerprint, only the first is accepted.
 */
export function filterExactDuplicates(
  candidates: readonly GeneratedQuestion[],
  excludeFingerprints: ReadonlySet<string>
): ExactDuplicateFilterResult {
  const fingerprints = new Set(excludeFingerprints);
  const accepted: GeneratedQuestion[] = [];
  let rejectedCount = 0;

  for (const candidate of candidates) {
    const fp = fingerprintQuestion(candidate);
    if (fingerprints.has(fp)) {
      rejectedCount++;
      continue;
    }
    fingerprints.add(fp);
    accepted.push(candidate);
  }

  return { accepted, rejectedCount, fingerprints };
}
