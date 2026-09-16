/**
 * CANON-R5R1B -- BYPASS LEGACY ZERO-GAP AUTHORITY FOR VERIFIED v1
 * PRACTICE.
 *
 * LIVE Preview failure: `/api/learning/session/start` correctly
 * returned `authority: CANONICAL_ENGINE_V1, stage: PRACTICE,
 * actionState: EXECUTABLE`, but the follow-up
 * `POST /api/quizzes/generate-and-take` call (with `v1Launch: true`,
 * no client-supplied maxQuestions/difficulty) still hit the legacy
 * LX-4R zero-gap Practice guard and returned
 * `409 INVALID_GENERATION_CONTRACT / ZERO_GAP_PRACTICE_MISMATCH` --
 * two competing pedagogical authorities disagreeing, which CANON-R5's
 * own ONE AUTHORITY RULE forbids.
 *
 * Source-audit coverage follows this route's own established testing
 * convention (see canon-r5r1-generate-and-take-wiring.test.ts's doc
 * comment) -- a full HTTP-level invocation would require mocking the
 * AI generation pipeline this phase's firewall explicitly protects.
 * The one behavioral piece this phase actually changes in isolation
 * (`verifyV1PracticeLaunchMarker`) is exercised directly, against the
 * real, unmocked engine, using the exact live Preview fixture ids.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');

describe('Part 3/4 -- ordering and the ONE AUTHORITY RULE (source audit)', () => {
  it('v1Marker is computed before the legacy zero-gap block runs -- canonical verification is attempted first, never after a 409 has already been returned', () => {
    const v1MarkerIdx = ROUTE_SRC.indexOf('const v1Marker =');
    const zeroGapIdx = ROUTE_SRC.indexOf("reason: 'ZERO_GAP_PRACTICE_MISMATCH'");
    expect(v1MarkerIdx).toBeGreaterThan(-1);
    expect(zeroGapIdx).toBeGreaterThan(v1MarkerIdx);
  });

  it('1/2. the 409 return is gated on `!hasReinforceSignal && !v1Marker` -- present (v1Marker truthy) bypasses; absent (v1Marker null, the legacy shape) still blocks exactly as before', () => {
    const idx = ROUTE_SRC.indexOf('if (!hasReinforceSignal && !v1Marker) {');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 1500);
    expect(slice).toMatch(/reason: 'ZERO_GAP_PRACTICE_MISMATCH'/);
    expect(slice).toMatch(/status: 409/);
  });

  it('the legacy guard is never globally removed -- the ZERO_GAP_PRACTICE_MISMATCH branch, its 409 status, and its response shape are all still present verbatim', () => {
    expect(ROUTE_SRC).toMatch(/error: 'INVALID_GENERATION_CONTRACT', reason: 'ZERO_GAP_PRACTICE_MISMATCH'/);
    expect(ROUTE_SRC).toMatch(/status: 409/);
  });

  it('a v1-authorized bypass is diagnostics-only (logged), never silent, and clearly distinguished from the REINFORCE bypass path', () => {
    const idx = ROUTE_SRC.indexOf("reason: 'ZERO_GAP_LEGACY_AUTHORITY_BYPASSED_BY_V1'");
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx - 700, idx + 50);
    expect(slice).toMatch(/if \(v1Marker && !hasReinforceSignal\) \{/);
  });

  it('4/5 -- legacy data (KnowledgeState-derived hasReinforceSignal) may still be read/logged, but never re-enters as a veto once v1Marker exists: the `if (!hasReinforceSignal && !v1Marker)` guard is the ONLY early return in this block', () => {
    const blockStart = ROUTE_SRC.indexOf('if (zeroGapMismatch && (activityType');
    const blockEnd = ROUTE_SRC.indexOf('maxQuestions = resolved.count;', blockStart);
    const block = ROUTE_SRC.slice(blockStart, blockEnd);
    const returns = block.match(/return NextResponse\.json/g) ?? [];
    expect(returns.length).toBe(1);
  });
});

describe('3. v1Launch alone never bypasses -- v1Marker requires a full, independently-verified chain', () => {
  it('the rawV1Marker guard condition requires the feature gate, the intent flag, a resolvable requestedActivityType (topic_practice/canonical_prove only, CANON-R6), a conceptId, AND a successful fresh re-verification -- not v1Launch by itself', () => {
    const idx = ROUTE_SRC.indexOf('const rawV1Marker =');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 300);
    expect(slice).toMatch(/validated\.v1Launch === true/);
    expect(slice).toMatch(/isCanonicalEngineV1Enabled\(\)/);
    expect(slice).toMatch(/requestedActivityType/);
    expect(slice).toMatch(/validated\.conceptId/);
    expect(slice).toMatch(/verifyV1PracticeLaunchMarker\(/);
  });
});

describe('8/9/10 -- R5R1A\'s server-derived contract override is untouched and still runs after this block', () => {
  it('the maxQuestions/difficulty override block still exists, still gated on v1Marker, still positioned after the legacy LX-4R block finishes', () => {
    const legacyBlockEnd = ROUTE_SRC.indexOf("console.error('[LX-4R R8] evidence-requirement resolution failed, using execution default:', e);");
    const overrideIdx = ROUTE_SRC.indexOf('if (v1Marker) {\n      maxQuestions = v1Marker.itemCount.authorized;');
    expect(legacyBlockEnd).toBeGreaterThan(-1);
    expect(overrideIdx).toBeGreaterThan(legacyBlockEnd);
  });
});

describe('11/12/13 -- persistence, compliance validation, and policy-version stamping are untouched', () => {
  it('storeQuiz is still called with the (unmodified, save for CANON-R6R1\'s additive novelty-diagnostics merge) v1Marker', () => {
    const idx = ROUTE_SRC.indexOf('const quizId = await storeQuiz(');
    const slice = ROUTE_SRC.slice(idx, idx + 250);
    expect(slice).toMatch(/v1MarkerToPersist\s*\n?\s*\);/);
  });

  it('checkV1ActivityContractCompliance is still called at submission, before any v1 stamping', () => {
    expect(ROUTE_SRC).toMatch(/checkV1ActivityContractCompliance\(\{\s*\n\s*authorization: quizSession\.v1Marker!,\s*\n\s*actualItemCount: bucket\.total,\s*\n\s*actualDifficulty,/);
  });

  it('v1 metadata stamping is still gated on v1Qualifies (contract-compliant AND authorized), unchanged from R5R1A', () => {
    const idx = ROUTE_SRC.indexOf('...(v1Qualifies');
    expect(idx).toBeGreaterThan(-1);
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).toMatch(/pedagogicalPolicyVersion: quizSession\.v1Marker!\.pedagogicalPolicyVersion/);
  });
});

describe('12 -- firewall: no touch to the pedagogical engine, AI, Quality Gate, cache, mastery thresholds, difficulty policy, or migration recognitions', () => {
  it('generate-and-take/route.ts gained no new import from @/lib/pedagogical-engine, @/lib/ai/adapters, or @/lib/pedagogical-migration', () => {
    expect(ROUTE_SRC).not.toMatch(/from '@\/lib\/pedagogical-engine'/);
    expect(ROUTE_SRC).not.toMatch(/@\/lib\/ai\/adapters/);
    expect(ROUTE_SRC).not.toMatch(/from '@\/lib\/pedagogical-migration'/);
  });
});

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

import { verifyV1PracticeLaunchMarker } from '@/lib/pedagogical-decision';

const NOW = '2026-09-20T00:00:00.000Z';

beforeEach(() => {
  MOCK_DB.query.mockReset();
  fetchStudyUSEvidenceRowsMock.mockReset().mockResolvedValue([]);
  loadRecognizedRequirementsForEngineMock.mockReset().mockResolvedValue([]);
  getMisconceptionCountsForConceptMock.mockReset().mockResolvedValue({ activeCount: 0, criticalCount: 0, recurringCount: 0 });
});

describe('9 -- the LIVE Preview fixture (Part 9: IDs are a test fixture only, never hardcoded in production logic)', () => {
  // Exact ids from the live Preview failure this phase repairs.
  const LIVE_STUDENT_ID = 'ec77cac5-841c-41cc-b959-af8ec69ccec5';
  const LIVE_CONCEPT_ID = '1fb2b93c-0909-4127-9854-a91379825661';

  it('a fresh canonical decision for the exact live-failure (studentId, conceptId) pair -- a preexisting-concept LEARN recognition, no other evidence -- resolves to an EXECUTABLE PRACTICE v1 authorization, matching what session/start reported', async () => {
    loadRecognizedRequirementsForEngineMock.mockResolvedValue([
      { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: NOW },
    ]);
    const auth = await verifyV1PracticeLaunchMarker({ studentId: LIVE_STUDENT_ID, conceptId: LIVE_CONCEPT_ID });
    expect(auth).not.toBeNull();
    expect(auth?.canonicalStage).toBe('PRACTICE');
    expect(auth?.canonicalActivityType).toBe('PRACTICE');
  });

  it('when this authorization exists, the route\'s own bypass condition (`!hasReinforceSignal && !v1Marker`) is false regardless of hasReinforceSignal -- the exact fix for the live 409', async () => {
    loadRecognizedRequirementsForEngineMock.mockResolvedValue([
      { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: NOW },
    ]);
    const auth = await verifyV1PracticeLaunchMarker({ studentId: LIVE_STUDENT_ID, conceptId: LIVE_CONCEPT_ID });
    const v1Marker = auth; // exactly what the route binds to `v1Marker`
    const hasReinforceSignal = false; // the live failure's own KnowledgeState had no reinforce signal either
    expect(!hasReinforceSignal && !v1Marker).toBe(false);
  });
});

describe('6/7 -- WAITING and BLOCKED canonical states never produce a bypassable authorization', () => {
  it('a concept with no recognition and no evidence (LEARN, not PRACTICE) never authorizes -- v1Marker stays null, so the legacy guard\'s original behavior is fully preserved', async () => {
    const auth = await verifyV1PracticeLaunchMarker({ studentId: 's1', conceptId: 'c1' });
    expect(auth).toBeNull();
  });
});
