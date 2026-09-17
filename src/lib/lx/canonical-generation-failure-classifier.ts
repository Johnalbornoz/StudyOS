/**
 * CANON-V2-PREVIEW-CERT Section 6/7/8 -- classifies a generation
 * shortfall into exactly one of the 3 generation-related canonical
 * error codes, using REAL diagnostic data already produced by the
 * generation services -- never a guess.
 *
 * The 3 codes are semantically distinct events (Section 8's own
 * requirement: "generation failure and validation failure are
 * different observability events"):
 *   - AI_GENERATION_FAILED: the provider call itself produced nothing
 *     usable at all (a timeout/network/provider error, or a call that
 *     returned zero candidates).
 *   - AI_GENERATION_INVALID: the provider returned candidates, but the
 *     final published set still doesn't satisfy the canonical
 *     structural contract (wrong count/depth/difficulty) for a reason
 *     OTHER than semantic quality rejection (e.g. novelty/duplicate
 *     filtering removed too many, or a structural check like Transfer's
 *     own difficulty-range filter rejected a candidate).
 *   - AI_VALIDATION_FAILED: candidates were structurally fine but the
 *     semantic/quality gate (question-quality-verifier.service.ts)
 *     rejected them -- `semanticRejectedCount > 0` is the direct,
 *     already-computed signal for this, not an inference.
 *
 * Priority when multiple signals are present: a semantic rejection is
 * the more specific, more diagnostic signal, so it wins over a bare
 * "some candidates missing" observation -- matching Section 8's own
 * example category list (ANSWER_INCORRECT/AMBIGUOUS/etc are ALL
 * semantic-gate reasons).
 */
import type { CanonicalErrorCode } from '@/lib/pedagogical-decision/canonical-error-taxonomy';

export interface GenerationDiagnosticsForClassification {
  /** Sum of `semanticRejectedCount` across every chunk/recovery invocation this generation attempt made. */
  totalSemanticRejectedCount: number;
  /** The final number of items actually accepted for publication. */
  finalQuestionCount: number;
  /** The canonical contract's own required count. */
  targetCount: number;
}

export function classifyProveRetainGenerationFailure(diagnostics: GenerationDiagnosticsForClassification): CanonicalErrorCode {
  if (diagnostics.finalQuestionCount >= diagnostics.targetCount) {
    throw new Error('classifyProveRetainGenerationFailure called with a non-failure (finalQuestionCount already meets targetCount)');
  }
  if (diagnostics.totalSemanticRejectedCount > 0) return 'AI_VALIDATION_FAILED';
  if (diagnostics.finalQuestionCount === 0) return 'AI_GENERATION_FAILED';
  return 'AI_GENERATION_INVALID';
}

export interface TransferChallengeDiagnosticForClassification {
  generated: boolean;
  difficultyInRange: boolean;
}

/**
 * Transfer's own generator (`canonical-transfer-generation.service.ts`)
 * doesn't run the shared quality-gate pipeline (it calls
 * `generateQuestionsForConcept` directly, per depth) -- so it has no
 * `AI_VALIDATION_FAILED` path of its own today; a missing challenge is
 * always either a bare generation failure or a structural
 * (difficulty-range) rejection.
 */
export function classifyTransferGenerationFailure(challengeDiagnostics: TransferChallengeDiagnosticForClassification[]): CanonicalErrorCode {
  const missing = challengeDiagnostics.filter((d) => !d.generated || !d.difficultyInRange);
  if (missing.length === 0) {
    throw new Error('classifyTransferGenerationFailure called with a non-failure (every challenge generated and in range)');
  }
  const anyStructurallyInvalid = missing.some((d) => d.generated && !d.difficultyInRange);
  if (anyStructurallyInvalid) return 'AI_GENERATION_INVALID';
  return 'AI_GENERATION_FAILED';
}
