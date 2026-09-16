/**
 * CANON-V2-ARCH-CLEANUP Section 10/11 -- THE ONE canonical Transfer
 * grading/diagnosis authority.
 *
 * Section 10 (grading): nearScore/contextualScore/higherScore are
 * persisted INDEPENDENTLY; overall is their mean; PASS only if
 * overall >= 80 AND every one of the 3 individually >= 70 (a single
 * weak challenge can never be masked by two strong ones).
 *
 * Section 11 (diagnosis, FAIL only): exactly ONE of
 * APPLICATION_CONTEXT_WEAKNESS / RETENTION_WEAKNESS /
 * FOUNDATIONAL_PROCEDURAL_FAILURE -- CRITICAL_MISCONCEPTION is
 * deliberately NOT decided here: it is already derived, independently
 * of this module, from the pre-existing global
 * `RawEvidenceItem.hasCriticalMisconception` signal at evidence-READ
 * time (`evidence-qualification.ts`'s own `qualifyEvidence`, which
 * checks it BEFORE ever consulting `transferFailureDiagnostic` --
 * Case D always wins regardless of what this module writes). This
 * module's job is only the OTHER three, non-misconception cases.
 *
 * Never infers a diagnosis from score alone (Section 11's own
 * requirement): the rule below combines each challenge's score with
 * its OWN graded `errorType` (from the existing, unmodified
 * `gradeAnswer` -- see quiz-generation.service.ts) -- never a bare
 * score-percent threshold in isolation.
 *
 *   - NEAR itself is weak (< 70) AND that grading run actually flagged
 *     an error type (not just a borderline score) -- the learner can't
 *     even reproduce the skill in a near-identical setting, which
 *     points at decayed RETENTION of the underlying skill rather than
 *     a transfer-specific gap (Case B: retry via RETAIN, the earlier
 *     Prove evidence itself remains valid).
 *   - Otherwise, if ANY challenge's error was classified PROCEDURAL --
 *     the core method itself broke down, not merely its application to
 *     an unfamiliar setting -- the failure is FOUNDATIONAL (Case C:
 *     roll back to PRACTICE).
 *   - Otherwise (NEAR holds, no procedural breakdown, but
 *     CONTEXTUAL/HIGHER still fall short) -- a genuine, narrower
 *     transfer gap: APPLICATION_CONTEXT_WEAKNESS (Case A: stay at
 *     Transfer, immediate retry).
 */
import type { TransferFailureDiagnostic } from '@/lib/pedagogical-engine';
import type { ErrorType } from '@/services/error-intelligence.service';

export type CanonicalTransferDepth = 'NEAR' | 'CONTEXTUAL' | 'HIGHER';

export interface CanonicalTransferChallengeGrade {
  depth: CanonicalTransferDepth;
  scorePercent: number;
  errorType: ErrorType | null;
  reasoningProvided: boolean;
}

export interface CanonicalTransferGradingResult {
  nearScore: number;
  contextualScore: number;
  higherScore: number;
  overallScore: number;
  passed: boolean;
  /** Present only when `passed` is false. */
  diagnostic: TransferFailureDiagnostic | null;
}

const PASS_OVERALL_THRESHOLD = 80;
const PASS_PER_CHALLENGE_THRESHOLD = 70;

function byDepth(challenges: CanonicalTransferChallengeGrade[], depth: CanonicalTransferDepth): CanonicalTransferChallengeGrade | undefined {
  return challenges.find((c) => c.depth === depth);
}

/**
 * `challenges` must contain exactly one entry per depth (NEAR,
 * CONTEXTUAL, HIGHER) -- the caller (generate-and-take/route.ts) only
 * ever calls this for a v1Qualifies canonical_transfer submission,
 * whose 3-challenge shape was already enforced at generation time
 * (canonical-transfer-generation.service.ts) and re-verified by the
 * universal exact-count contract-compliance check before this runs.
 */
export function gradeCanonicalTransferAttempt(challenges: CanonicalTransferChallengeGrade[]): CanonicalTransferGradingResult {
  const near = byDepth(challenges, 'NEAR');
  const contextual = byDepth(challenges, 'CONTEXTUAL');
  const higher = byDepth(challenges, 'HIGHER');
  const nearScore = near?.scorePercent ?? 0;
  const contextualScore = contextual?.scorePercent ?? 0;
  const higherScore = higher?.scorePercent ?? 0;
  const overallScore = Math.round((nearScore + contextualScore + higherScore) / 3);

  const passed =
    overallScore >= PASS_OVERALL_THRESHOLD &&
    nearScore >= PASS_PER_CHALLENGE_THRESHOLD &&
    contextualScore >= PASS_PER_CHALLENGE_THRESHOLD &&
    higherScore >= PASS_PER_CHALLENGE_THRESHOLD;

  if (passed) {
    return { nearScore, contextualScore, higherScore, overallScore, passed: true, diagnostic: null };
  }

  const nearIsWeakWithFlaggedError = nearScore < PASS_PER_CHALLENGE_THRESHOLD && !!near?.errorType;
  const anyProcedural = challenges.some((c) => c.errorType === 'PROCEDURAL');

  const diagnostic: TransferFailureDiagnostic = nearIsWeakWithFlaggedError
    ? 'RETENTION_WEAKNESS'
    : anyProcedural
    ? 'FOUNDATIONAL_PROCEDURAL_FAILURE'
    : 'APPLICATION_CONTEXT_WEAKNESS';

  return { nearScore, contextualScore, higherScore, overallScore, passed: false, diagnostic };
}
