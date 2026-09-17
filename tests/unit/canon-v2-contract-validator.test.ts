/**
 * CANON-V2-FINAL-HARDENING Section 4 -- THE ONE CANONICAL CONTRACT
 * VALIDATOR.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  validateCanonicalActivityContract,
  validateItemCountAgainstContract,
  validateDifficultyAgainstContract,
  validateIndependenceAgainstContract,
  validateImplementationIdMatch,
  validateContractVersionMatch,
  validateCanonicalRevisionMatch,
} from '@/lib/pedagogical-decision/canonical-contract-validator';
import { checkV1ActivityContractCompliance, V1_ACTIVITY_CONTRACT_VIOLATION } from '@/lib/pedagogical-decision/v1-practice-launch-marker';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

describe('individual structural checks', () => {
  it('validateItemCountAgainstContract: null contract itemCount (LEARN_CHECK) is always valid', () => {
    expect(validateItemCountAgainstContract(null, 5)).toBeNull();
    expect(validateItemCountAgainstContract(null, 999)).toBeNull();
  });

  it('validateItemCountAgainstContract: in-range passes, out-of-range fails with a descriptive violation', () => {
    expect(validateItemCountAgainstContract({ min: 10, max: 10 }, 10)).toBeNull();
    expect(validateItemCountAgainstContract({ min: 10, max: 10 }, 9)).toMatchObject({ field: 'itemCount' });
  });

  it('validateDifficultyAgainstContract: in-range passes, out-of-range fails', () => {
    expect(validateDifficultyAgainstContract({ min: 4, max: 5 }, 4)).toBeNull();
    expect(validateDifficultyAgainstContract({ min: 4, max: 5 }, 5)).toBeNull();
    expect(validateDifficultyAgainstContract({ min: 4, max: 5 }, 3)).toMatchObject({ field: 'difficulty' });
    expect(validateDifficultyAgainstContract({ min: 4, max: 5 }, 6)).toMatchObject({ field: 'difficulty' });
  });

  it('validateIndependenceAgainstContract: skipped entirely when the contract does not require independence', () => {
    expect(validateIndependenceAgainstContract(false, { hintsUsed: 5, aiAssistanceType: 'TUTOR_GUIDANCE' })).toBeNull();
  });

  it('validateIndependenceAgainstContract: flags hints used or non-NONE assistance when independence is required', () => {
    expect(validateIndependenceAgainstContract(true, { hintsUsed: 1 })).toMatchObject({ field: 'independence' });
    expect(validateIndependenceAgainstContract(true, { aiAssistanceType: 'HINT' })).toMatchObject({ field: 'independence' });
    expect(validateIndependenceAgainstContract(true, { hintsUsed: 0, aiAssistanceType: 'NONE' })).toBeNull();
    expect(validateIndependenceAgainstContract(true, {})).toBeNull();
  });

  it('validateImplementationIdMatch / validateContractVersionMatch / validateCanonicalRevisionMatch: identity checks', () => {
    expect(validateImplementationIdMatch('canonical_prove', 'canonical_prove')).toBeNull();
    expect(validateImplementationIdMatch('canonical_prove', 'canonical_retain')).toMatchObject({ field: 'implementationId' });
    expect(validateContractVersionMatch('v1', 'v1')).toBeNull();
    expect(validateContractVersionMatch('v1', 'v2')).toMatchObject({ field: 'contractVersion' });
    expect(validateCanonicalRevisionMatch('rev1', 'rev1')).toBeNull();
    expect(validateCanonicalRevisionMatch('rev1', 'rev2')).toMatchObject({ field: 'canonicalRevision' });
  });
});

describe('validateCanonicalActivityContract -- the one aggregate entry point', () => {
  const validParams = {
    contractItemCount: { min: 10, max: 10 },
    contractDifficulty: { min: 3, max: 4 },
    contractRequiresIndependence: true,
    actualItemCount: 10,
    actualDifficulty: 3,
    actualIndependence: { hintsUsed: 0, aiAssistanceType: 'NONE' },
  };

  it('a fully-compliant attempt is valid with zero violations', () => {
    const result = validateCanonicalActivityContract(validParams);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('reports EVERY violation found, not just the first, when multiple fields are wrong simultaneously', () => {
    const result = validateCanonicalActivityContract({ ...validParams, actualItemCount: 5, actualDifficulty: 9 });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBe(2);
    expect(result.violations.map((v) => v.field).sort()).toEqual(['difficulty', 'itemCount']);
  });

  it('implementationId/canonicalRevision checks run only when both expected and actual are supplied', () => {
    const result = validateCanonicalActivityContract(validParams); // no implementationId/canonicalRevision fields at all
    expect(result.valid).toBe(true);
    const mismatched = validateCanonicalActivityContract({
      ...validParams,
      expectedImplementationId: 'canonical_prove',
      actualImplementationId: 'canonical_retain',
    });
    expect(mismatched.valid).toBe(false);
    expect(mismatched.violations[0].field).toBe('implementationId');
  });
});

describe('checkV1ActivityContractCompliance delegates to the shared validator (Section 4: consolidate, do not duplicate)', () => {
  const authorization = { itemCount: { min: 10, max: 10, authorized: 10 }, difficulty: { min: 3, max: 4, target: 3 }, independence: true };

  it('a compliant attempt is reported compliant, same as before this refactor', () => {
    const result = checkV1ActivityContractCompliance({ authorization, actualItemCount: 10, actualDifficulty: 3 });
    expect(result).toEqual({ compliant: true, reason: null });
  });

  it('an itemCount violation still returns the closed V1_ACTIVITY_CONTRACT_VIOLATION reason with the same detail message shape', () => {
    const result = checkV1ActivityContractCompliance({ authorization, actualItemCount: 8, actualDifficulty: 3 });
    expect(result.compliant).toBe(false);
    expect(result.reason).toBe(V1_ACTIVITY_CONTRACT_VIOLATION);
    expect(result.detail).toMatch(/actual itemCount 8 is outside the authorized range \[10, 10\]/);
  });

  it('a null itemCount (LEARN_CHECK) authorization never flags itemCount, delegating correctly through the shared validator', () => {
    const learnCheckAuth = { itemCount: null, difficulty: { min: 1, max: 2, target: 1 }, independence: false };
    const result = checkV1ActivityContractCompliance({ authorization: learnCheckAuth, actualItemCount: 999, actualDifficulty: 1 });
    expect(result).toEqual({ compliant: true, reason: null });
  });

  it('an independence violation is still reported when the contract requires it', () => {
    const result = checkV1ActivityContractCompliance({ authorization, actualItemCount: 10, actualDifficulty: 3, actualHintsUsed: 2 });
    expect(result.compliant).toBe(false);
    expect(result.detail).toMatch(/hintsUsed/);
  });
});

describe('canonical-transfer-generation.service.ts uses the shared validator directly (a real second call site, not just an aliased wrapper)', () => {
  it('imports validateDifficultyAgainstContract from the shared validator module', () => {
    const src = read('src/services/canonical-transfer-generation.service.ts');
    expect(src).toMatch(/import \{ validateDifficultyAgainstContract \} from '@\/lib\/pedagogical-decision\/canonical-contract-validator';/);
    expect(src).toMatch(/validateDifficultyAgainstContract\(\{ min: minDifficulty, max: maxDifficulty \}, candidate\.difficulty\)/);
  });
});
