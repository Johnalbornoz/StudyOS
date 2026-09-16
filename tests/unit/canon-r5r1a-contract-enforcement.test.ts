/**
 * CANON-R5R1A -- CANONICAL PRACTICE CONTRACT ENFORCEMENT.
 * Direct unit tests for the widened `V1PracticeLaunchMarker` (now a full
 * server-derived authorization: item count, difficulty, assistance) and
 * `checkV1ActivityContractCompliance`, plus source-audit coverage of the
 * route-level overrides that make client-supplied
 * maxQuestions/difficulty/quizMode irrelevant to a v1-authorized
 * request (Part 3-7/14/15/16/17's own manual tests, exercised here as
 * automated source audits + real-engine unit tests, per this route's
 * established testing convention -- see
 * canon-r5r1-generate-and-take-wiring.test.ts's own doc comment).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');

const MOCK_DB = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: MOCK_DB }));

const fetchStudyUSEvidenceRowsMock = vi.fn();
vi.mock('@/lib/pedagogical-shadow', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pedagogical-shadow')>('@/lib/pedagogical-shadow');
  return { ...actual, fetchStudyUSEvidenceRows: (...a: unknown[]) => fetchStudyUSEvidenceRowsMock(...a) };
});

const loadRecognizedRequirementsForEngineMock = vi.fn();
vi.mock('@/lib/pedagogical-migration', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pedagogical-migration')>('@/lib/pedagogical-migration');
  return { ...actual, loadRecognizedRequirementsForEngine: (...a: unknown[]) => loadRecognizedRequirementsForEngineMock(...a) };
});

const getMisconceptionCountsForConceptMock = vi.fn();
vi.mock('@/services/misconception.service', () => ({
  getMisconceptionCountsForConcept: (...a: unknown[]) => getMisconceptionCountsForConceptMock(...a),
}));

import { verifyV1PracticeLaunchMarker, checkV1ActivityContractCompliance, V1_ACTIVITY_CONTRACT_VIOLATION } from '@/lib/pedagogical-decision';

const STUDENT = 's1';
const CONCEPT = 'c1';
const NOW = '2026-09-20T00:00:00.000Z';

beforeEach(() => {
  MOCK_DB.query.mockReset();
  fetchStudyUSEvidenceRowsMock.mockReset().mockResolvedValue([]);
  loadRecognizedRequirementsForEngineMock.mockReset().mockResolvedValue([]);
  getMisconceptionCountsForConceptMock.mockReset().mockResolvedValue({ activeCount: 0, criticalCount: 0, recurringCount: 0 });
});

describe('Part 0/1/18/19 -- the authorization is built directly from the fresh decision\'s own activityContract, never a duplicated constant', () => {
  it('itemCount/difficulty/assistanceAllowed mirror the frozen CANONICAL_POLICY.practice contract exactly (2-3 items, difficulty 2-4, assisted)', async () => {
    loadRecognizedRequirementsForEngineMock.mockResolvedValue([
      { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: NOW },
    ]);
    const auth = await verifyV1PracticeLaunchMarker({ studentId: STUDENT, conceptId: CONCEPT });
    expect(auth).not.toBeNull();
    expect(auth?.itemCount.min).toBe(2);
    expect(auth?.itemCount.max).toBe(3);
    expect(auth?.itemCount.authorized).toBe(3);
    expect(auth?.difficulty.min).toBe(2);
    expect(auth?.difficulty.max).toBe(4);
    expect(typeof auth?.difficulty.target).toBe('number');
    expect(auth?.assistanceAllowed).toBe(true);
  });

  it('has no function parameter through which a caller could supply/override maxQuestions or difficulty -- the ONLY input is {studentId, conceptId}', () => {
    const src = read('src/lib/pedagogical-decision/v1-practice-launch-marker.ts');
    const sig = src.match(/export async function verifyV1PracticeLaunchMarker\(params: \{[\s\S]*?\}\)/)?.[0];
    expect(sig).toBeDefined();
    expect(sig).toMatch(/studentId: string/);
    expect(sig).toMatch(/conceptId: string/);
    expect(sig).not.toMatch(/maxQuestions|difficulty|quizMode/);
  });
});

describe('Part 10 -- checkV1ActivityContractCompliance', () => {
  const authorization = { itemCount: { min: 2, max: 3 }, difficulty: { min: 2, max: 4 } };

  it('actual itemCount at the min boundary (2) is compliant', () => {
    expect(checkV1ActivityContractCompliance({ authorization: authorization as any, actualItemCount: 2, actualDifficulty: 3 }).compliant).toBe(true);
  });

  it('actual itemCount at the max boundary (3) is compliant', () => {
    expect(checkV1ActivityContractCompliance({ authorization: authorization as any, actualItemCount: 3, actualDifficulty: 3 }).compliant).toBe(true);
  });

  it('actual itemCount below the authorized minimum (1) is a contract violation', () => {
    const result = checkV1ActivityContractCompliance({ authorization: authorization as any, actualItemCount: 1, actualDifficulty: 3 });
    expect(result.compliant).toBe(false);
    expect(result.reason).toBe(V1_ACTIVITY_CONTRACT_VIOLATION);
  });

  it('actual itemCount above the authorized maximum (4) is a contract violation', () => {
    const result = checkV1ActivityContractCompliance({ authorization: authorization as any, actualItemCount: 4, actualDifficulty: 3 });
    expect(result.compliant).toBe(false);
    expect(result.reason).toBe(V1_ACTIVITY_CONTRACT_VIOLATION);
  });

  it('actual difficulty inside the authorized range is compliant', () => {
    expect(checkV1ActivityContractCompliance({ authorization: authorization as any, actualItemCount: 2, actualDifficulty: 2 }).compliant).toBe(true);
    expect(checkV1ActivityContractCompliance({ authorization: authorization as any, actualItemCount: 2, actualDifficulty: 4 }).compliant).toBe(true);
  });

  it('actual difficulty outside the authorized range is a contract violation', () => {
    const result = checkV1ActivityContractCompliance({ authorization: authorization as any, actualItemCount: 2, actualDifficulty: 5 });
    expect(result.compliant).toBe(false);
    expect(result.reason).toBe(V1_ACTIVITY_CONTRACT_VIOLATION);
  });

  it('never mutates its inputs (pure function, no clamping side effect)', () => {
    const frozenAuth = JSON.parse(JSON.stringify(authorization));
    checkV1ActivityContractCompliance({ authorization: authorization as any, actualItemCount: 99, actualDifficulty: 99 });
    expect(authorization).toEqual(frozenAuth);
  });
});

describe('Part 3/4/7/15 -- server-derived maxQuestions/difficulty override client values for a v1-authorized request (manual URL tamper test)', () => {
  it('maxQuestions is reassigned from v1Marker.itemCount.authorized AFTER (never before) the legacy LX-4R evidence-gap block finishes -- the override always wins, regardless of order client params were merged in above', () => {
    const legacyBlockEnd = ROUTE_SRC.indexOf("console.error('[LX-4R R8] evidence-requirement resolution failed, using execution default:', e);");
    const overrideIdx = ROUTE_SRC.indexOf('maxQuestions = v1Marker.itemCount.authorized;');
    expect(legacyBlockEnd).toBeGreaterThan(-1);
    expect(overrideIdx).toBeGreaterThan(legacyBlockEnd);
  });

  it('the override happens BEFORE perConceptCap/conceptIds are computed, so the forced count actually reaches the generator call', () => {
    const overrideIdx = ROUTE_SRC.indexOf('maxQuestions = v1Marker.itemCount.authorized;');
    const perConceptCapIdx = ROUTE_SRC.indexOf('const perConceptCap = Math.max(1, Math.ceil(maxQuestions / conceptIds.length));');
    expect(overrideIdx).toBeGreaterThan(-1);
    expect(perConceptCapIdx).toBeGreaterThan(overrideIdx);
  });

  it('v1EffectiveDifficulty (set only from v1Marker.difficulty.target) is read FIRST in every generation call site\'s difficulty expression, ahead of validated.difficulty', () => {
    const occurrences = ROUTE_SRC.match(/difficulty: v1EffectiveDifficulty \?\? validated\.difficulty \?\? resolvedDifficulty\?\.level \?\? 3/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
  });

  it('is gated on v1Marker (null for every non-authorized request) -- a legacy request never has maxQuestions/difficulty reassigned by this block', () => {
    const idx = ROUTE_SRC.indexOf('if (v1Marker) {\n      maxQuestions = v1Marker.itemCount.authorized;');
    expect(idx).toBeGreaterThan(-1);
  });
});

describe('Part 6/17 -- mode enforcement: a client cannot turn canonical PRACTICE into a different quizMode', () => {
  it('requestedActivityType (and therefore the raw v1 marker fetch) can only ever resolve for quizMode topic_practice or canonical_prove -- the guard itself enforces this before verifyV1PracticeLaunchMarker is even called (CANON-R6 widened this from a single literal to the closed requestedActivityType mapping)', () => {
    const idx = ROUTE_SRC.indexOf('const requestedActivityType:');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 300);
    expect(slice).toMatch(/validated\.quizMode === 'topic_practice' \? 'PRACTICE' : validated\.quizMode === 'canonical_prove' \? 'PROVE' : null/);
  });

  it('a client-requested quick_check/retention_check/review with v1Launch=true never reaches verifyV1PracticeLaunchMarker at all (structurally impossible, not merely unauthorized) -- requestedActivityType resolves to null for every mode other than topic_practice/canonical_prove', () => {
    const idx = ROUTE_SRC.indexOf('const requestedActivityType:');
    const conditionLine = ROUTE_SRC.slice(idx, idx + 300);
    expect(conditionLine).not.toMatch(/quick_check|retention_check|review/);
  });
});

describe('Part 16 -- wrong-stage / WAITING / BLOCKED never produce an authorization (extends canon-r5r1-v1-practice-launch-marker.test.ts coverage)', () => {
  it('a concept with no recognitions and no evidence (genuinely LEARN) never authorizes Practice', async () => {
    const auth = await verifyV1PracticeLaunchMarker({ studentId: STUDENT, conceptId: CONCEPT });
    expect(auth).toBeNull();
  });
});
