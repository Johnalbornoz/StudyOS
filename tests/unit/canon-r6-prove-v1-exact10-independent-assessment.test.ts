/**
 * CANON-R6 -- PROVE v1: EXACT 10 INDEPENDENT ASSESSMENT.
 *
 * Covers the parts of the Part 30 test matrix not already exercised by
 * the (now-updated) CANON-R5/R5R1/R5R1A/R5R1B suites: real-engine
 * qualification/rollback semantics for PROVE (26-29), the distinct
 * `canonical_prove` mode's exact-10 generation wiring (6-13), the
 * independence enforcement chain (14-18), persistence of the widened
 * authorization (19-25), and the new Results UI wiring (31-33).
 * Route-level wiring is audited via source, following this route's own
 * established testing convention (see
 * canon-r5r1-generate-and-take-wiring.test.ts's doc comment).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateCanonicalLearningState, type RawEvidenceItem } from '@/lib/pedagogical-engine';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const QUIZ_PAGE_SRC = read('src/app/dashboard/quiz/page.tsx');

const NOW = '2026-09-25T00:00:00.000Z';
const STUDENT = 's1';
const CONCEPT = 'c1';

function practiceEvidence(overrides: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return {
    id: 'p1',
    activityType: 'PRACTICE',
    timestamp: '2026-09-20T00:00:00.000Z',
    itemCount: 3,
    correctCount: 3,
    scorePercent: 90,
    independent: false,
    difficulty: 3,
    hasCriticalMisconception: false,
    ...overrides,
  };
}

/**
 * CANON-V2-REMEDIATION Part 1A: PRACTICE now requires 2 of the last 3
 * valid attempts >=80% (AUDIT-001) -- a single qualifying attempt is no
 * longer sufficient to genuinely satisfy PRACTICE, so any fixture that
 * needs Prove/Retain to be REACHABLE (not merely premature) supplies
 * this second attempt alongside `practiceEvidence()`.
 */
function practiceEvidence2(overrides: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return practiceEvidence({ id: 'p2', timestamp: '2026-09-20T01:00:00.000Z', ...overrides });
}

function proveEvidence(overrides: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return {
    id: 'pr1',
    activityType: 'PROVE',
    timestamp: '2026-09-25T00:00:00.000Z',
    itemCount: 10,
    correctCount: 8,
    scorePercent: 80,
    independent: true,
    difficulty: 3,
    hasCriticalMisconception: false,
    ...overrides,
  };
}

// LEARN has no evidence-based satisfaction path exercised here (that is
// CANON-R2R1's own concern) -- recognized exactly like every other
// real-engine PRACTICE/PROVE test in this suite family (see
// canon-r5-canonical-decision-service.test.ts), so these tests exercise
// PRACTICE/PROVE qualification and rollback in isolation.
const LEARN_RECOGNIZED = [
  { requirement: 'LEARN' as const, basis: 'LEGACY_MIGRATION_BASELINE' as const, recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: '2026-09-01T00:00:00.000Z' },
];

describe('26/27 -- real-engine PROVE qualification: 8/10 (80%) passes, 7/10 (70%) fails', () => {
  it('26. a real, independent, exactly-10-item, difficulty-3, 80%-score PROVE attempt QUALIFIES and satisfies the PROVE requirement', () => {
    const decision = evaluateCanonicalLearningState({
      conceptId: CONCEPT,
      studentId: STUDENT,
      now: NOW,
      recognizedRequirements: LEARN_RECOGNIZED,
      evidence: [practiceEvidence(), practiceEvidence2(), proveEvidence({ correctCount: 8, scorePercent: 80 })],
      activeCriticalMisconception: false,
    });
    const prove = decision.requirements.find((r) => r.stage === 'PROVE');
    expect(prove?.status).toBe('SATISFIED');
  });

  it('27. the identical shape at 70% (7/10) does NOT qualify -- exact boundary, never a rounded/approximate count', () => {
    const decision = evaluateCanonicalLearningState({
      conceptId: CONCEPT,
      studentId: STUDENT,
      now: NOW,
      recognizedRequirements: LEARN_RECOGNIZED,
      evidence: [practiceEvidence(), proveEvidence({ correctCount: 7, scorePercent: 70 })],
      activeCriticalMisconception: false,
    });
    const prove = decision.requirements.find((r) => r.stage === 'PROVE');
    expect(prove?.status).not.toBe('SATISFIED');
  });

  it('an itemCount other than exactly 10 never qualifies as PROVE evidence, even with a passing score -- the frozen engine itself is a second, independent backstop behind the route\'s own contract-compliance check', () => {
    const decision = evaluateCanonicalLearningState({
      conceptId: CONCEPT,
      studentId: STUDENT,
      now: NOW,
      recognizedRequirements: LEARN_RECOGNIZED,
      evidence: [practiceEvidence(), proveEvidence({ itemCount: 8, correctCount: 8, scorePercent: 100 })],
      activeCriticalMisconception: false,
    });
    const prove = decision.requirements.find((r) => r.stage === 'PROVE');
    expect(prove?.status).not.toBe('SATISFIED');
  });

  it('a non-independent (assisted) attempt never qualifies as PROVE evidence regardless of score', () => {
    const decision = evaluateCanonicalLearningState({
      conceptId: CONCEPT,
      studentId: STUDENT,
      now: NOW,
      recognizedRequirements: LEARN_RECOGNIZED,
      evidence: [practiceEvidence(), proveEvidence({ independent: false, correctCount: 10, scorePercent: 100 })],
      activeCriticalMisconception: false,
    });
    const prove = decision.requirements.find((r) => r.stage === 'PROVE');
    expect(prove?.status).not.toBe('SATISFIED');
  });
});

describe('28 -- a valid PROVE pass advances to RETAIN, WAITING (the frozen 3-day policy), never bypassed', () => {
  it('stage becomes RETAIN with actionState WAITING immediately after a qualifying PROVE pass (no retention evidence yet)', () => {
    const decision = evaluateCanonicalLearningState({
      conceptId: CONCEPT,
      studentId: STUDENT,
      now: NOW,
      recognizedRequirements: LEARN_RECOGNIZED,
      evidence: [practiceEvidence(), practiceEvidence2(), proveEvidence({ correctCount: 8, scorePercent: 80 })],
      activeCriticalMisconception: false,
    });
    expect(decision.stage).toBe('RETAIN');
    expect(decision.actionState).toBe('WAITING');
  });
});

describe('29 -- a valid PROVE fail rolls back to PRACTICE, decided by the frozen engine, never by client/UI logic', () => {
  it('stage remains/returns to PRACTICE after a genuinely failed (70%) PROVE attempt', () => {
    const decision = evaluateCanonicalLearningState({
      conceptId: CONCEPT,
      studentId: STUDENT,
      now: NOW,
      recognizedRequirements: LEARN_RECOGNIZED,
      evidence: [practiceEvidence(), practiceEvidence2(), proveEvidence({ correctCount: 7, scorePercent: 70 })],
      activeCriticalMisconception: false,
    });
    expect(decision.stage).toBe('PRACTICE');
    expect(decision.rollback?.case).toBe('PROVE_FAILURE_RETURN_TO_PRACTICE');
  });

  it('the route never implements this rollback itself -- it only writes evidence, then re-fetches; no PRACTICE/RETAIN literal assignment exists anywhere near the submission response construction', () => {
    const canonicalResultsBlockIdx = ROUTE_SRC.indexOf('let canonicalResults:');
    const responseIdx = ROUTE_SRC.indexOf('return NextResponse.json({\n      success: true,\n      data: {\n        quizId: validated.quizId,');
    const block = ROUTE_SRC.slice(canonicalResultsBlockIdx, responseIdx);
    expect(block).not.toMatch(/stage\s*=\s*'PRACTICE'/);
    expect(block).not.toMatch(/stage\s*=\s*'RETAIN'/);
  });
});

describe('4/6 -- GENERATION MODE: canonical_prove is a distinct, server-only mode, never quick_check', () => {
  it('canonical_prove is mapped to SOLO_CHECK (the same real, existing ActivityType CANON-R3\'s adapter already treats as PROVE\'s analog) -- no new ActivityType invented', () => {
    const src = read('src/services/quiz-persistence.service.ts');
    expect(src).toMatch(/canonical_prove:\s*'SOLO_CHECK'/);
  });

  it('canonical_prove is NOT one of quick_check/topic_practice/review/retention_check\'s own dedicated fast paths, NOR does it share the generic multi-concept generateGatedQuestionBatch branch cumulative_assessment/exam_simulation/diagnostic_check use -- CANON-R6-PERF-R1 gives it its own dedicated concurrent-chunked branch instead', () => {
    const quickCheckIdx = ROUTE_SRC.indexOf("validated.quizMode === 'quick_check'\n        ? generateQuickCheckQuestions");
    // CANON-V2-ARCH-CLEANUP -- anchored on the generation-dispatch site's
    // own unique comment, not the bare 'canonical_prove' string (which
    // now also appears earlier in requestedActivityType's widened
    // ternary chain).
    const canonicalProveIdx = ROUTE_SRC.indexOf('CANON-R6-PERF-R2 -- FIRST:');
    const genericMultiConceptIdx = ROUTE_SRC.indexOf('Promise.all(', canonicalProveIdx);
    // canonical_prove's own branch is distinct from, and precedes, the
    // generic multi-concept branch -- it is never inside it.
    expect(quickCheckIdx).toBeGreaterThan(-1);
    expect(canonicalProveIdx).toBeGreaterThan(quickCheckIdx);
    expect(genericMultiConceptIdx).toBeGreaterThan(canonicalProveIdx);
    const canonicalProveBlock = ROUTE_SRC.slice(canonicalProveIdx, genericMultiConceptIdx);
    // CANON-R6-PERF-R2: canonical_prove's own branch calls the shared
    // certified generator (which internally uses
    // generateConcurrentChunkedBatch, CANON-R6-PERF-R1) -- never the
    // generic multi-concept branch's own generateGatedQuestionBatch.
    expect(canonicalProveBlock).toMatch(/generateCanonicalProveQuestions\(/);
    expect(canonicalProveBlock).not.toMatch(/generateGatedQuestionBatch\(/);
  });

  it('5. quick_check\'s own dedicated fast path is completely untouched -- still fixed, never conditioned on canonical_prove or v1Marker', () => {
    expect(ROUTE_SRC).toMatch(/quick_check: \{[\s\S]*?defaultMax: 6,/);
    const genService = read('src/services/quiz-generation.service.ts');
    expect(genService).toMatch(/RETENTION_REQUIRED_COUNT\s*=\s*6/);
  });
});

describe('6/7/9 -- exact-10 requested and administered, via the real exact-count-or-fail generator', () => {
  it('maxQuestions is forced from v1Marker.itemCount.authorized (10 for Prove) before perConceptCap/conceptIds are resolved -- the same override mechanism R5R1A already established for Practice, generalized', () => {
    const idx = ROUTE_SRC.indexOf('if (v1Marker) {');
    expect(idx).toBeGreaterThan(-1);
    const block = ROUTE_SRC.slice(idx, idx + 500);
    expect(block).toMatch(/if \(v1Marker\.itemCount\) maxQuestions = v1Marker\.itemCount\.authorized;/);
  });

  it('the multi-concept/gated-batch branch\'s own perConceptDifficulty ALSO prefers v1EffectiveDifficulty first -- the exact branch canonical_prove (a single-concept mode) falls through to', () => {
    const idx = ROUTE_SRC.indexOf('let perConceptDifficulty = v1EffectiveDifficulty ?? validated.difficulty ?? resolvedDifficulty?.level;');
    expect(idx).toBeGreaterThan(-1);
  });

  it('generateGatedQuestionBatch itself already guarantees exactly `count` or `[]` -- verified against its own real source (never modified by this phase)', () => {
    const src = read('src/services/gated-question-generation.service.ts');
    expect(src).toMatch(/if \(result\.insufficientCount\) \{[\s\S]*?return \[\];/);
    expect(src).toMatch(/return result\.accepted;/);
  });
});

describe('8 -- fewer than 10 is rejected, never silently administered as v1 Prove', () => {
  it('the universal short-of-maxQuestions guard (LX-9R6-R1) still runs before storeQuiz, unmodified in substance -- applies to canonical_prove exactly as it already does to cumulative_assessment/exam_simulation', () => {
    const idx = ROUTE_SRC.indexOf('if (questions.length > 0 && questions.length < maxQuestions) {');
    const storeIdx = ROUTE_SRC.indexOf('const quizId = await storeQuiz(');
    expect(idx).toBeGreaterThan(-1);
    expect(storeIdx).toBeGreaterThan(idx);
  });

  it('a canonical_prove-specific closed reason (V1_PROVE_GENERATION_INCOMPLETE) is returned instead of the generic message, for both the short-of-target and totally-empty cases', () => {
    // 2 in the JSON error response bodies + 2 (CANON-R6-PERF-I1) where
    // the SAME existing code is also passed as the observability
    // summary's `errorCode` at each of those two guards, + 2
    // (CANON-V2-FINAL-HARDENING Section 3) where the SAME code is also
    // passed to toCanonicalErrorCode(...) at each of those two guards
    // to derive the additive canonicalErrorCode field -- same code,
    // never a new/different one.
    const occurrences = (ROUTE_SRC.match(/V1_PROVE_GENERATION_INCOMPLETE/g) ?? []).length;
    expect(occurrences).toBe(6);
  });
});

describe('10/11/12 -- client difficulty/maxQuestions are ignored for a verified v1 Prove request', () => {
  it('every generation call site difficulty expression reads v1EffectiveDifficulty FIRST, ahead of validated.difficulty (client-supplied)', () => {
    const occurrences = (ROUTE_SRC.match(/difficulty: v1EffectiveDifficulty \?\? validated\.difficulty/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it('maxQuestions is reassigned from the authorization, never from validated.maxQuestions, once v1Marker exists', () => {
    const idx = ROUTE_SRC.indexOf('maxQuestions = v1Marker.itemCount.authorized;');
    expect(idx).toBeGreaterThan(-1);
  });
});

describe('14/15/16 -- INDEPENDENCE: hints/Tutor are structurally unavailable for canonical_prove, via existing, unmodified infrastructure', () => {
  it('14. the quiz page\'s coarse EvidenceMode mirror defaults to INDEPENDENT for any mode not explicitly PRACTICE/ASSESSMENT -- canonical_prove was never added to PRACTICE_EVIDENCE_MODES, so it falls through to INDEPENDENT automatically', () => {
    // CANON-V2-FINAL-HARDENING -- canonical_learn_check IS EvidenceMode
    // PRACTICE (assistance explicitly allowed, activity-taxonomy.ts) and
    // was deliberately added to this list so its Hint/Tutor UI matches
    // the server's real permission -- canonical_prove (INDEPENDENT) is
    // still never in it.
    expect(QUIZ_PAGE_SRC).toMatch(/const PRACTICE_EVIDENCE_MODES: readonly QuizMode\[\] = \['topic_practice', 'review', 'canonical_learn_check'\];/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/PRACTICE_EVIDENCE_MODES.*canonical_prove/);
  });

  it('16. the ContextualHelp (Tutor) surface is gated purely on PRACTICE_EVIDENCE_MODES.includes(quizMode) -- canonical_prove is never in that list, so Tutor is never rendered for it, with zero new gating logic', () => {
    const idx = QUIZ_PAGE_SRC.indexOf('PRACTICE_EVIDENCE_MODES.includes(quizMode) && studentId && quizId && (');
    expect(idx).toBeGreaterThan(-1);
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 150);
    expect(slice).toMatch(/<ContextualHelp/);
  });

  it('15. the server-side AI-permission policy denies every student-assistance feature (HINT included) for any evidenceMode other than PRACTICE -- unmodified, and canonical_prove\'s SOLO_CHECK activity type maps to INDEPENDENT', () => {
    const policySrc = read('src/lib/ai-permission-policy.ts');
    expect(policySrc).toMatch(/return evidenceMode === 'PRACTICE';/);
    const taxonomySrc = read('src/lib/activity-taxonomy.ts');
    expect(taxonomySrc).toMatch(/SOLO_CHECK: 'INDEPENDENT'/);
  });

  it('17/18 -- checkV1ActivityContractCompliance enforces hintsUsed===0 and aiAssistanceType===NONE for an independent (Prove) contract, defense-in-depth behind the source-level denial above', () => {
    const routeCompliance = ROUTE_SRC.slice(ROUTE_SRC.indexOf('checkV1ActivityContractCompliance({'), ROUTE_SRC.indexOf('checkV1ActivityContractCompliance({') + 300);
    expect(routeCompliance).toMatch(/actualHintsUsed: hintsUsed/);
    expect(routeCompliance).toMatch(/actualAiAssistanceType/);
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

import { verifyV1PracticeLaunchMarker, checkV1ActivityContractCompliance } from '@/lib/pedagogical-decision';

beforeEach(() => {
  MOCK_DB.query.mockReset();
  fetchStudyUSEvidenceRowsMock.mockReset().mockResolvedValue([]);
  loadRecognizedRequirementsForEngineMock.mockReset().mockResolvedValue([]);
  getMisconceptionCountsForConceptMock.mockReset().mockResolvedValue({ activeCount: 0, criticalCount: 0, recurringCount: 0 });
});

describe('19-25 -- PERSISTENCE: the full v1 Prove authorization, built from the real engine', () => {
  it('19-25. a real fresh PROVE/EXECUTABLE decision produces an authorization with itemCount 10, difficulty 3-4, independence true, supportLevel NONE, minimumScorePercent 80, and the real canonicalRevision/canonicalStage', async () => {
    loadRecognizedRequirementsForEngineMock.mockResolvedValue([
      { requirement: 'LEARN', basis: 'LEGACY_MIGRATION_BASELINE', recognitionId: 'r1', reasonCode: 'PREEXISTING_LEARNER_CONCEPT_BEFORE_V1', recognizedAt: NOW },
      { requirement: 'PRACTICE', basis: 'LEGACY_POLICY_RECOGNITION', recognitionId: 'r2', reasonCode: 'LEGACY_PRACTICE_EVIDENCE_SUFFICIENT_AND_UNDERSTANDING_OK', recognizedAt: NOW },
    ]);
    const auth = await verifyV1PracticeLaunchMarker({ studentId: STUDENT, conceptId: CONCEPT });
    expect(auth).not.toBeNull();
    expect(auth?.canonicalStage).toBe('PROVE');
    expect(auth?.canonicalActivityType).toBe('PROVE');
    expect(auth?.itemCount).toEqual({ min: 10, max: 10, authorized: 10 });
    expect(auth?.difficulty.min).toBe(3);
    expect(auth?.difficulty.max).toBe(4);
    expect(auth?.independence).toBe(true);
    expect(auth?.supportLevel).toBe('NONE');
    expect(auth?.minimumScorePercent).toBe(80);
    expect(typeof auth?.canonicalRevision).toBe('string');
  });

  it('the JSONB persistence blob (storeQuiz) includes independence/supportLevel/minimumScorePercent/novelty for a Prove authorization, round-tripped through getQuizSession', async () => {
    const { storeQuiz, getQuizSession } = await import('@/services/quiz-persistence.service');
    const marker = {
      pedagogicalPolicyVersion: 'studyus-canonical-v1',
      canonicalRevision: 'rev-prove',
      canonicalStage: 'PROVE',
      canonicalActivityType: 'PROVE',
      itemCount: { min: 10, max: 10, authorized: 10 },
      difficulty: { min: 3, max: 4, target: 3 },
      assistanceAllowed: false,
      independence: true,
      supportLevel: 'NONE' as const,
      minimumScorePercent: 80,
      novelty: {
        priorPracticeFingerprintCount: 3,
        rejectedExactDuplicateCount: 1,
        acceptedNovelQuestionCount: 10,
        noveltyPolicy: 'EXACT_DUPLICATE_EXCLUSION_V1' as const,
      },
    };
    MOCK_DB.query.mockResolvedValueOnce({ rows: [] });
    await storeQuiz('s1', 'c1', 'subj1', [{ conceptId: 'c1' } as any], 'en', 'canonical_prove', [], marker);
    const insertParams = MOCK_DB.query.mock.calls[0][1] as any[];
    const contract = JSON.parse(insertParams[insertParams.length - 3]); // F11-C2/F11-C3 appended target_skill_ids/target_competency_ids after canonical_activity_contract
    expect(contract.independence).toBe(true);
    expect(contract.supportLevel).toBe('NONE');
    expect(contract.minimumScorePercent).toBe(80);
    expect(contract.novelty).toEqual(marker.novelty);

    MOCK_DB.query.mockReset().mockResolvedValueOnce({
      rows: [{
        id: 'quiz-1', student_id: 's1', concept_id: 'c1', subject_id: 'subj1', questions: [], language: 'en',
        status: 'active', created_at: new Date(), expires_at: new Date(Date.now() + 1000000), quiz_mode: 'canonical_prove',
        concept_ids: ['c1'], hints_used_questions: [], activity_type: 'SOLO_CHECK', evidence_mode: 'INDEPENDENT',
        pedagogical_policy_version: marker.pedagogicalPolicyVersion, canonical_revision: marker.canonicalRevision,
        canonical_stage: marker.canonicalStage, canonical_activity_contract: JSON.stringify({
          canonicalActivityType: marker.canonicalActivityType, itemCount: marker.itemCount, difficulty: marker.difficulty,
          assistanceAllowed: marker.assistanceAllowed, independence: marker.independence, supportLevel: marker.supportLevel,
          minimumScorePercent: marker.minimumScorePercent, novelty: marker.novelty,
        }),
      }],
    });
    const session = await getQuizSession('quiz-1');
    expect(session?.v1Marker).toEqual(marker);
  });

  it('a Prove marker persisted with no novelty diagnostics (a hypothetical pre-R6R1 row) reloads novelty: null -- never reconstructed, never omitted', async () => {
    const { storeQuiz, getQuizSession } = await import('@/services/quiz-persistence.service');
    const marker = {
      pedagogicalPolicyVersion: 'studyus-canonical-v1',
      canonicalRevision: 'rev-prove-2',
      canonicalStage: 'PROVE',
      canonicalActivityType: 'PROVE',
      itemCount: { min: 10, max: 10, authorized: 10 },
      difficulty: { min: 3, max: 4, target: 3 },
      assistanceAllowed: false,
      independence: true,
      supportLevel: 'NONE' as const,
      minimumScorePercent: 80,
    };
    MOCK_DB.query.mockResolvedValueOnce({ rows: [] });
    await storeQuiz('s1', 'c1', 'subj1', [{ conceptId: 'c1' } as any], 'en', 'canonical_prove', [], marker as any);
    const insertParams = MOCK_DB.query.mock.calls[0][1] as any[];
    const contract = JSON.parse(insertParams[insertParams.length - 3]); // F11-C2/F11-C3 appended target_skill_ids/target_competency_ids after canonical_activity_contract
    expect(contract.novelty).toBeUndefined();

    MOCK_DB.query.mockReset().mockResolvedValueOnce({
      rows: [{
        id: 'quiz-1', student_id: 's1', concept_id: 'c1', subject_id: 'subj1', questions: [], language: 'en',
        status: 'active', created_at: new Date(), expires_at: new Date(Date.now() + 1000000), quiz_mode: 'canonical_prove',
        concept_ids: ['c1'], hints_used_questions: [], activity_type: 'SOLO_CHECK', evidence_mode: 'INDEPENDENT',
        pedagogical_policy_version: marker.pedagogicalPolicyVersion, canonical_revision: marker.canonicalRevision,
        canonical_stage: marker.canonicalStage, canonical_activity_contract: JSON.stringify({
          canonicalActivityType: marker.canonicalActivityType, itemCount: marker.itemCount, difficulty: marker.difficulty,
          assistanceAllowed: marker.assistanceAllowed, independence: marker.independence, supportLevel: marker.supportLevel,
          minimumScorePercent: marker.minimumScorePercent,
        }),
      }],
    });
    const session = await getQuizSession('quiz-1');
    expect(session?.v1Marker?.novelty).toBeNull();
  });

  it('canonical_activity_type is stamped into learning_evidence.metadata alongside policyVersion/canonicalRevision/canonicalStage (additive, R6)', () => {
    const idx = ROUTE_SRC.indexOf('canonicalActivityType: quizSession.v1Marker!.canonicalActivityType,');
    expect(idx).toBeGreaterThan(-1);
  });
});

describe('30 -- a contract violation never qualifies, regardless of activity type', () => {
  it('a Prove-shaped authorization with a violating actual itemCount (e.g. 8) is never compliant', () => {
    const authorization = { itemCount: { min: 10, max: 10, authorized: 10 }, difficulty: { min: 3, max: 4, target: 3 }, independence: true };
    const result = checkV1ActivityContractCompliance({ authorization, actualItemCount: 8, actualDifficulty: 3 });
    expect(result.compliant).toBe(false);
  });

  it('a Prove-shaped authorization with real hints used is never compliant, even with a correct item count/difficulty', () => {
    const authorization = { itemCount: { min: 10, max: 10, authorized: 10 }, difficulty: { min: 3, max: 4, target: 3 }, independence: true };
    const result = checkV1ActivityContractCompliance({ authorization, actualItemCount: 10, actualDifficulty: 3, actualHintsUsed: 1, actualAiAssistanceType: 'HINT' });
    expect(result.compliant).toBe(false);
  });
});

describe('31/32/33 -- RESULTS: canonical re-fetch and the new Results UI wiring', () => {
  it('31. the canonical re-fetch is unconditionally gated on v1Qualifies -- unchanged ordering/logic from R5R1/R5R1A, generalized automatically to Prove since it uses the SAME quizSession.v1Marker/v1Qualifies mechanism (no Prove-specific branch was needed)', () => {
    const idx = ROUTE_SRC.indexOf('quizSession.v1Marker && authorizedResult?.v1Qualifies && quizSession.conceptId');
    expect(idx).toBeGreaterThan(-1);
  });

  it('32. the quiz page renders a canonicalResults-driven block, gated on canonicalResultsStatus === OK, never inferring from score/quizMode', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("results.canonicalResultsStatus === 'OK' && results.canonicalResults");
    expect(idx).toBeGreaterThan(-1);
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 1200);
    expect(slice).toMatch(/quiz\.canonicalNextStepTitle/);
    expect(slice).toMatch(/results\.canonicalResults\.stage === 'PROVE'/);
    expect(slice).toMatch(/results\.canonicalResults\.stage === 'PRACTICE'/);
    expect(slice).toMatch(/results\.canonicalResults\.actionState === 'WAITING'/);
  });

  it('a contract-violation-status attempt renders the dedicated violation message, never the canonical next-step block', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("results.canonicalResultsStatus === 'V1_ACTIVITY_CONTRACT_VIOLATION'");
    expect(idx).toBeGreaterThan(-1);
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 260);
    expect(slice).toMatch(/quiz\.canonicalContractViolation/);
  });

  it('33. the legacy messageText line is untouched -- still rendered for every attempt, v1 or not, unconditionally', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/<p style=\{\{ marginTop: 'var\(--space-4\)', color: 'var\(--text-secondary\)', fontSize: 14 \}\}>\{messageText\}<\/p>/);
  });
});

describe('34/35/36/37/38/39 -- REGRESSION: Practice v1, legacy topic_practice/quick_check, and the remaining NOT_READY gates', () => {
  it('34/35. Practice\'s own server-derived override block is untouched (still forces itemCount.authorized/difficulty.target for topic_practice requests)', () => {
    const idx = ROUTE_SRC.indexOf('if (v1Marker) {');
    expect(idx).toBeGreaterThan(-1);
    const block = ROUTE_SRC.slice(idx, idx + 500);
    expect(block).toMatch(/if \(v1Marker\.itemCount\) maxQuestions = v1Marker\.itemCount\.authorized;\s*\n\s*v1EffectiveDifficulty = v1Marker\.difficulty\.target;/);
  });

  it('36. legacy quick_check\'s dedicated fast path (generateQuickCheckQuestions) and its fixed 6-question contract are byte-unchanged', () => {
    expect(ROUTE_SRC).toMatch(/quick_check:\s*\{\s*\n\s*guidance:/);
    expect(ROUTE_SRC).toMatch(/defaultMax: 6,/);
  });

  it('37/38/39. Retention/Transfer/Learn Check remain the only three NOT_READY reasons -- Prove was the ONE and ONLY widened case this phase makes', () => {
    const src = read('src/lib/pedagogical-decision/activity-launch-readiness.ts');
    const reasons = src.match(/V1_\w+_GENERATION_NOT_READY/g) ?? [];
    const uniqueReasons = [...new Set(reasons)];
    expect(uniqueReasons.sort()).toEqual(['V1_LEARN_CHECK_GENERATION_NOT_READY', 'V1_RETENTION_GENERATION_NOT_READY', 'V1_TRANSFER_GENERATION_NOT_READY'].sort());
  });
});

describe('12 -- firewall: no touch to the pedagogical engine\'s own policy, AI providers, or Quality Gate', () => {
  it('CANONICAL_POLICY.prove itself is untouched -- itemCount 10, difficulty 3-4, minimumScorePercent 80, independenceRequired true, exactly as CANON-R2R1 froze it', () => {
    const src = read('src/lib/pedagogical-engine/policy.ts');
    const proveBlock = src.slice(src.indexOf('prove: {'), src.indexOf('retention: {'));
    expect(proveBlock).toMatch(/itemCount: 10,/);
    expect(proveBlock).toMatch(/difficulty: \{ min: 3, max: 4 \}/);
    expect(proveBlock).toMatch(/minimumScorePercent: 80,/);
    expect(proveBlock).toMatch(/independenceRequired: true,/);
  });

  it('no new import from an AI provider adapter or the Quality Gate anywhere touched by this phase', () => {
    expect(ROUTE_SRC).not.toMatch(/@\/lib\/ai\/adapters/);
    const persistenceSrc = read('src/services/quiz-persistence.service.ts');
    expect(persistenceSrc).not.toMatch(/@\/lib\/ai\/adapters|quality-gate/i);
  });
});
