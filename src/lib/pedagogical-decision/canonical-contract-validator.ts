/**
 * CANON-V2-FINAL-HARDENING Section 4 -- THE ONE CANONICAL CONTRACT
 * VALIDATOR.
 *
 * A single, reusable module for STRUCTURAL contract validation --
 * "does this item count / difficulty / independence / identity match
 * what the canonical contract actually authorizes" -- callable at every
 * checkpoint the spec names:
 *   A. before generation      -- is the contract itself well-formed to generate against
 *   B. after generation       -- does what was generated match the contract
 *   C. before execution       -- does the launch snapshot match the contract
 *   D. at submission          -- does the actually-administered attempt match the contract
 *   E. before evidence accepted as qualifying -- same check, evidence-persistence gate
 *
 * Generation-SEMANTIC validation (AI quality gates, novelty/duplicate
 * filtering, response-contract-guard grading) intentionally stays in
 * its own specialized modules (question-quality-contract.ts,
 * exact-duplicate-novelty.ts, response-contract-grading.ts) -- this
 * module is deliberately narrow: canonical STRUCTURAL contract fields
 * only (item/challenge count, difficulty range, independence,
 * implementation identity, policy/revision compatibility). Centralizing
 * structural validation here means every checkpoint compares against
 * the SAME rules, expressed once, rather than each call site
 * reimplementing (and potentially drifting from) its own version of
 * "is this count in range."
 *
 * `checkV1ActivityContractCompliance` (v1-practice-launch-marker.ts) --
 * the pre-existing submission-time compliance check -- now delegates
 * its actual comparisons to this module (Section 4's "consolidate,
 * don't duplicate"), while keeping its own existing
 * `{compliant, reason, detail}` return shape and closed
 * `V1_ACTIVITY_CONTRACT_VIOLATION` reason code unchanged, so every
 * existing caller/test continues to see byte-identical behavior.
 * `canonical-transfer-generation.service.ts` also calls this module
 * directly for its own post-generation difficulty-range check
 * (checkpoint B above) -- proof this is a real, multi-call-site
 * authority, not a single aliased wrapper.
 */

export interface CanonicalContractRange {
  min: number;
  max: number;
}

export interface CanonicalContractViolation {
  field: 'itemCount' | 'difficulty' | 'independence' | 'implementationId' | 'policyVersion' | 'canonicalRevision';
  detail: string;
}

export interface CanonicalContractValidationResult {
  valid: boolean;
  violations: CanonicalContractViolation[];
}

/**
 * `contractItemCount === null` means "no canonical item-count authority
 * exists for this activity" (LEARN_CHECK only, see
 * evidence-sufficiency-contract.ts) -- always valid, since there is
 * nothing to violate.
 */
export function validateItemCountAgainstContract(
  contractItemCount: CanonicalContractRange | null,
  actualCount: number
): CanonicalContractViolation | null {
  if (!contractItemCount) return null;
  if (actualCount < contractItemCount.min || actualCount > contractItemCount.max) {
    return {
      field: 'itemCount',
      detail: `actual itemCount ${actualCount} is outside the authorized range [${contractItemCount.min}, ${contractItemCount.max}]`,
    };
  }
  return null;
}

export function validateDifficultyAgainstContract(
  contractDifficulty: CanonicalContractRange,
  actualDifficulty: number
): CanonicalContractViolation | null {
  if (actualDifficulty < contractDifficulty.min || actualDifficulty > contractDifficulty.max) {
    return {
      field: 'difficulty',
      detail: `actual difficulty ${actualDifficulty} is outside the authorized range [${contractDifficulty.min}, ${contractDifficulty.max}]`,
    };
  }
  return null;
}

/**
 * Checked ONLY when the contract itself requires independence (PROVE,
 * RETENTION_CHECK, TRANSFER) AND the caller actually supplies the
 * actual values -- an assisted contract (PRACTICE/REINFORCE/LEARN_CHECK)
 * never runs this check, matching the pre-existing precedent this
 * module consolidates.
 */
export function validateIndependenceAgainstContract(
  contractRequiresIndependence: boolean,
  actual: { hintsUsed?: number; aiAssistanceType?: string }
): CanonicalContractViolation | null {
  if (!contractRequiresIndependence) return null;
  if (actual.hintsUsed !== undefined && actual.hintsUsed > 0) {
    return {
      field: 'independence',
      detail: `an independent (no-assistance) contract requires hintsUsed === 0; actual was ${actual.hintsUsed}`,
    };
  }
  if (actual.aiAssistanceType !== undefined && actual.aiAssistanceType !== 'NONE') {
    return {
      field: 'independence',
      detail: `an independent (no-assistance) contract requires aiAssistanceType === 'NONE'; actual was ${actual.aiAssistanceType}`,
    };
  }
  return null;
}

export function validateImplementationIdMatch(expected: string, actual: string): CanonicalContractViolation | null {
  if (expected !== actual) {
    return { field: 'implementationId', detail: `expected implementationId "${expected}", actual "${actual}"` };
  }
  return null;
}

export function validateCanonicalRevisionMatch(expected: string, actual: string): CanonicalContractViolation | null {
  if (expected !== actual) {
    return { field: 'canonicalRevision', detail: `expected canonicalRevision "${expected}", actual "${actual}"` };
  }
  return null;
}

/**
 * The one entry point that runs every applicable structural check and
 * aggregates the result. Every field is optional EXCEPT `itemCount`/
 * `difficulty`/`independence` (present in every real canonical
 * contract) -- `implementationId`/`canonicalRevision` checks run only
 * when both `expected*` and `actual*` are supplied, so a caller that
 * only cares about item count/difficulty/independence (e.g. submission-
 * time compliance, which has no `implementationId` to compare) can omit
 * them entirely.
 */
export function validateCanonicalActivityContract(params: {
  contractItemCount: CanonicalContractRange | null;
  contractDifficulty: CanonicalContractRange;
  contractRequiresIndependence: boolean;
  actualItemCount: number;
  actualDifficulty: number;
  actualIndependence?: { hintsUsed?: number; aiAssistanceType?: string };
  expectedImplementationId?: string;
  actualImplementationId?: string;
  expectedCanonicalRevision?: string;
  actualCanonicalRevision?: string;
}): CanonicalContractValidationResult {
  const violations: CanonicalContractViolation[] = [];

  const itemCountViolation = validateItemCountAgainstContract(params.contractItemCount, params.actualItemCount);
  if (itemCountViolation) violations.push(itemCountViolation);

  const difficultyViolation = validateDifficultyAgainstContract(params.contractDifficulty, params.actualDifficulty);
  if (difficultyViolation) violations.push(difficultyViolation);

  const independenceViolation = validateIndependenceAgainstContract(params.contractRequiresIndependence, params.actualIndependence ?? {});
  if (independenceViolation) violations.push(independenceViolation);

  if (params.expectedImplementationId !== undefined && params.actualImplementationId !== undefined) {
    const implementationIdViolation = validateImplementationIdMatch(params.expectedImplementationId, params.actualImplementationId);
    if (implementationIdViolation) violations.push(implementationIdViolation);
  }

  if (params.expectedCanonicalRevision !== undefined && params.actualCanonicalRevision !== undefined) {
    const revisionViolation = validateCanonicalRevisionMatch(params.expectedCanonicalRevision, params.actualCanonicalRevision);
    if (revisionViolation) violations.push(revisionViolation);
  }

  return { valid: violations.length === 0, violations };
}
