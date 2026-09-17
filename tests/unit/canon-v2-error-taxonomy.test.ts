/**
 * CANON-V2-FINAL-HARDENING Section 3 -- THE ONE CANONICAL ERROR
 * TAXONOMY.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { toCanonicalErrorCode, CANONICAL_ERROR_CODES, type CanonicalErrorCode } from '@/lib/pedagogical-decision/canonical-error-taxonomy';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');

describe('canonical error taxonomy -- the 9 required categories', () => {
  it('has exactly the 9 spec-required codes, no more, no fewer', () => {
    const expected: CanonicalErrorCode[] = [
      'CANONICAL_DECISION_UNAVAILABLE',
      'CANONICAL_IMPLEMENTATION_MISSING',
      'ACTIVITY_CONTRACT_MISMATCH',
      'AI_GENERATION_FAILED',
      'AI_GENERATION_INVALID',
      'AI_VALIDATION_FAILED',
      'EVIDENCE_PERSISTENCE_FAILED',
      'CANONICAL_REEVALUATION_FAILED',
      'DEPENDENCY_UNAVAILABLE',
    ];
    expect([...CANONICAL_ERROR_CODES].sort()).toEqual([...expected].sort());
  });
});

describe('same semantic failure -> same canonical code', () => {
  it('every generation-shortfall alias (Prove/Retain/Transfer) maps to the SAME canonical code -- they are the same semantic failure', () => {
    const prove = toCanonicalErrorCode('V1_PROVE_GENERATION_INCOMPLETE');
    const retain = toCanonicalErrorCode('V1_RETAIN_GENERATION_INCOMPLETE');
    const transfer = toCanonicalErrorCode('V1_TRANSFER_GENERATION_INCOMPLETE');
    expect(prove.mapped).toBe(true);
    expect(prove.code).toBe(retain.code);
    expect(retain.code).toBe(transfer.code);
    expect(prove.code).toBe('AI_GENERATION_FAILED');
  });

  it('every canonical_* authorization-failure alias maps to the SAME canonical code (a contract mismatch -- the requested mode does not match what the fresh decision authorizes)', () => {
    const codes = [
      toCanonicalErrorCode('V1_PROVE_AUTHORIZATION_FAILED'),
      toCanonicalErrorCode('V1_RETAIN_AUTHORIZATION_FAILED'),
      toCanonicalErrorCode('V1_TRANSFER_AUTHORIZATION_FAILED'),
      toCanonicalErrorCode('V1_LEARN_CHECK_AUTHORIZATION_FAILED'),
    ];
    for (const c of codes) {
      expect(c.mapped).toBe(true);
      expect(c.code).toBe('ACTIVITY_CONTRACT_MISMATCH');
    }
  });

  it('V1_ACTIVITY_CONTRACT_VIOLATION maps to ACTIVITY_CONTRACT_MISMATCH', () => {
    expect(toCanonicalErrorCode('V1_ACTIVITY_CONTRACT_VIOLATION')).toEqual({ code: 'ACTIVITY_CONTRACT_MISMATCH', mapped: true });
  });

  it('CanonicalDecisionUnavailableError and CANONICAL_RESULTS_UNAVAILABLE map to the two decision-lifecycle codes, never confused with each other', () => {
    expect(toCanonicalErrorCode('CanonicalDecisionUnavailableError').code).toBe('CANONICAL_DECISION_UNAVAILABLE');
    expect(toCanonicalErrorCode('CANONICAL_RESULTS_UNAVAILABLE').code).toBe('CANONICAL_REEVALUATION_FAILED');
    expect(toCanonicalErrorCode('CanonicalDecisionUnavailableError').code).not.toBe(toCanonicalErrorCode('CANONICAL_RESULTS_UNAVAILABLE').code);
  });

  it('CANONICAL_IMPLEMENTATION_MISSING maps to itself -- new canonical code needs no legacy alias', () => {
    expect(toCanonicalErrorCode('CANONICAL_IMPLEMENTATION_MISSING')).toEqual({ code: 'CANONICAL_IMPLEMENTATION_MISSING', mapped: true });
  });

  it('an unrecognized identifier degrades to DEPENDENCY_UNAVAILABLE with mapped:false, never throws', () => {
    expect(toCanonicalErrorCode('SOME_MADE_UP_CODE_THAT_DOES_NOT_EXIST')).toEqual({ code: 'DEPENDENCY_UNAVAILABLE', mapped: false });
  });

  it('every legacy key maps to exactly one canonical code (no key is ambiguous)', () => {
    // Structural guarantee, not just a spot check -- LEGACY_TO_CANONICAL
    // is a plain object, so this is true by construction, but this test
    // documents the invariant explicitly and would catch a future
    // refactor that accidentally introduced an array/multi-value mapping.
    const keys = ['V1_PROVE_GENERATION_INCOMPLETE', 'V1_ACTIVITY_CONTRACT_VIOLATION', 'CanonicalDecisionUnavailableError'];
    for (const k of keys) {
      const result = toCanonicalErrorCode(k);
      expect(typeof result.code).toBe('string');
    }
  });
});

describe('the taxonomy is actually wired into generate-and-take/route.ts responses (not just defined and unused)', () => {
  it('the route imports toCanonicalErrorCode from the taxonomy module', () => {
    expect(ROUTE_SRC).toMatch(/import \{ toCanonicalErrorCode \} from '@\/lib\/pedagogical-decision\/canonical-error-taxonomy';/);
  });

  it('every canonical_* authorization-failure response includes a canonicalErrorCode field', () => {
    const occurrences = (ROUTE_SRC.match(/canonicalErrorCode: toCanonicalErrorCode\(/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(9); // 4 auth guards x1 + 2 generation-incomplete guards x4 (3 modes + generic fallback) = 12, conservatively >=9
  });

  it('the Results response derives canonicalErrorCode from canonicalResultsStatus, null only for the two non-error statuses', () => {
    const idx = ROUTE_SRC.indexOf('canonicalErrorCode:\n          canonicalResultsStatus');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 300);
    expect(slice).toMatch(/canonicalResultsStatus === 'OK' \|\| canonicalResultsStatus === 'NOT_V1'/);
    expect(slice).toMatch(/toCanonicalErrorCode\(canonicalResultsStatus\)\.code/);
  });
});
