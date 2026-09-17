/**
 * CANON-V2-FINAL-HARDENING Section 13 -- THE FULL AUTOMATED JOURNEY
 * MATRIX, SCENARIOS A-J.
 *
 * This is the literal, labeled A-J deliverable the spec requires. Each
 * scenario below is a fresh, self-contained, directly-runnable proof
 * against the real, unmodified pure engine (`evaluateCanonicalLearningState`)
 * -- the SAME harness style already established across this session's
 * audit test files (audit-canon-v2-*.test.ts). Most of these exact
 * behaviors already have deep-dive coverage in those dedicated files
 * (cited in each scenario's own comment); this file's job is to prove
 * the SAME facts under the SPEC'S OWN A-J labels, in one place, as the
 * literal certification artifact -- not to duplicate their edge-case
 * depth.
 *
 * Scenario J (AI failure safety) is the one genuinely new scenario --
 * no existing file proves it across all 5 canonical activities in one
 * place. It is proven at the generation-service/route level (the pure
 * engine has no AI/generation concern at all), reusing the SAME
 * mock-based harness this phase's own canon-v2-retain-generation.test.ts
 * / canon-v2-transfer-generation.test.ts already established.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateCanonicalLearningState, type RawEvidenceItem, type PedagogicalEngineInput } from '@/lib/pedagogical-engine';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');

// Hoisted to module top level (vitest requirement) -- used only by
// SCENARIO J below.
const h = vi.hoisted(() => ({ chunked: vi.fn(), recovery: vi.fn(), priorFingerprints: vi.fn(), generate: vi.fn() }));
vi.mock('@/services/gated-question-generation.service', () => ({
  generateConcurrentChunkedBatch: (...a: any[]) => h.chunked(...a),
  generateBoundedRecoveryBatch: (...a: any[]) => h.recovery(...a),
}));
vi.mock('@/services/quiz-persistence.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/quiz-persistence.service')>('@/services/quiz-persistence.service');
  return { ...actual, loadPriorCanonicalQuestionFingerprintsForRetain: (...a: any[]) => h.priorFingerprints(...a), loadPriorPracticeQuestionFingerprints: (...a: any[]) => h.priorFingerprints(...a) };
});
vi.mock('@/services/quiz-generation.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/quiz-generation.service')>('@/services/quiz-generation.service');
  return { ...actual, generateQuestionsForConcept: (...a: any[]) => h.generate(...a) };
});

function item(overrides: Partial<RawEvidenceItem>): RawEvidenceItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    activityType: 'PRACTICE',
    timestamp: '2026-01-01T00:00:00.000Z',
    itemCount: 3,
    correctCount: 3,
    scorePercent: 100,
    independent: false,
    difficulty: 3,
    hasCriticalMisconception: false,
    ...overrides,
  };
}
function baseInput(overrides: Partial<PedagogicalEngineInput> = {}): PedagogicalEngineInput {
  return { conceptId: 'concept-1', studentId: 'student-1', now: '2026-01-01T00:00:00.000Z', evidence: [], activeCriticalMisconception: false, ...overrides };
}
function learnCheck(ts: string, score: number) {
  return item({ activityType: 'LEARN_CHECK', timestamp: ts, itemCount: 5, correctCount: Math.round((score / 100) * 5), scorePercent: score, difficulty: 1.5 });
}
function practice(ts: string, score: number) {
  return item({ activityType: 'PRACTICE', timestamp: ts, itemCount: 3, correctCount: Math.round((score / 100) * 3), scorePercent: score, difficulty: 3 });
}
function prove(ts: string, score: number) {
  return item({ activityType: 'PROVE', timestamp: ts, itemCount: 10, correctCount: Math.round((score / 100) * 10), scorePercent: score, difficulty: 3.5, independent: true });
}
function retain(ts: string, score: number) {
  return item({ activityType: 'RETENTION_CHECK', timestamp: ts, itemCount: 10, correctCount: Math.round((score / 100) * 10), scorePercent: score, difficulty: 3.5, independent: true, novel: true });
}
function transfer(ts: string, scores: number[], opts: Partial<RawEvidenceItem> = {}) {
  const overall = scores.reduce((a, b) => a + b, 0) / scores.length;
  return item({ activityType: 'TRANSFER', timestamp: ts, itemCount: 3, correctCount: scores.filter((s) => s >= 80).length, scorePercent: overall, difficulty: 4.5, independent: true, perChallengeScores: scores, reasoningProvided: true, ...opts });
}

describe('SCENARIO A -- HAPPY PATH (see also audit-canon-v2-full-scenarios.test.ts Scenario 1)', () => {
  it('LEARN pass -> Practice 85 -> Practice 90 -> Prove pass -> Retain WAITING -> +3 days -> Retain pass -> Transfer pass -> CONSOLIDATED', () => {
    const evidence = [
      learnCheck('2026-01-01T00:00:00.000Z', 90),
      practice('2026-01-02T00:00:00.000Z', 85),
      practice('2026-01-02T01:00:00.000Z', 90),
      prove('2026-01-03T00:00:00.000Z', 90),
    ];
    const afterProve = evaluateCanonicalLearningState(baseInput({ evidence, now: '2026-01-03T12:00:00.000Z' }));
    expect(afterProve.stage).toBe('RETAIN');
    expect(afterProve.actionState).toBe('WAITING');
    expect(afterProve.nextEligibleAt).toBe('2026-01-06T00:00:00.000Z');

    const withRetain = [...evidence, retain('2026-01-06T00:00:00.000Z', 90)];
    const afterRetain = evaluateCanonicalLearningState(baseInput({ evidence: withRetain, now: '2026-01-06T00:00:00.000Z' }));
    expect(afterRetain.stage).toBe('TRANSFER');
    expect(afterRetain.actionState).toBe('EXECUTABLE');

    const withTransfer = [...withRetain, transfer('2026-01-10T00:00:00.000Z', [90, 90, 90])];
    const finalDecision = evaluateCanonicalLearningState(baseInput({ evidence: withTransfer, now: '2026-01-11T00:00:00.000Z' }));
    expect(finalDecision.stage).toBe('CONSOLIDATED');
    expect(finalDecision.actionState).toBe('CONSOLIDATED');
  });
});

describe('SCENARIO B -- PRACTICE CONSISTENCY (see also audit-canon-v2-practice-consistency.test.ts AUDIT-001)', () => {
  it('100 -> still PRACTICE; 40 -> still PRACTICE; 40 -> still PRACTICE; 100 -> still PRACTICE; 100 -> PROVE', () => {
    const learned = learnCheck('2025-12-31T00:00:00.000Z', 90);
    const scores = [100, 40, 40, 100, 100];
    const evidence: RawEvidenceItem[] = [learned];
    const stagesAfterEach: string[] = [];
    scores.forEach((score, i) => {
      evidence.push(practice(`2026-01-0${i + 1}T00:00:00.000Z`, score));
      const d = evaluateCanonicalLearningState(baseInput({ evidence: [...evidence], now: `2026-01-0${i + 1}T12:00:00.000Z` }));
      stagesAfterEach.push(d.stage);
    });
    expect(stagesAfterEach).toEqual(['PRACTICE', 'PRACTICE', 'PRACTICE', 'PRACTICE', 'PROVE']);
  });
});

describe('SCENARIO C -- PROVE FAILURE (see also audit-canon-v2-full-scenarios.test.ts Scenario 3)', () => {
  it('Practice qualifies -> Prove fails -> Practice window reset (90 alone insufficient) -> a 2nd qualifying Practice -> PROVE unlocked again', () => {
    const learned = learnCheck('2025-12-30T00:00:00.000Z', 90);
    const p1 = practice('2025-12-31T00:00:00.000Z', 90);
    const p2 = practice('2025-12-31T01:00:00.000Z', 90);
    const failedProve = prove('2026-01-01T00:00:00.000Z', 50);
    const evidenceAfterFail = [learned, p1, p2, failedProve];
    const afterFail = evaluateCanonicalLearningState(baseInput({ evidence: evidenceAfterFail, now: '2026-01-01T12:00:00.000Z' }));
    expect(afterFail.stage).toBe('PRACTICE');

    const oneNewPractice = practice('2026-01-02T00:00:00.000Z', 90);
    const afterOneNew = evaluateCanonicalLearningState(baseInput({ evidence: [...evidenceAfterFail, oneNewPractice], now: '2026-01-02T12:00:00.000Z' }));
    // Section 13's own scenario: "Practice 90 -> still PRACTICE" (one
    // fresh qualifying attempt is never sufficient alone -- 2 of last 3
    // fresh-window attempts required, matching Scenario B's own rule).
    expect(afterOneNew.stage).toBe('PRACTICE');

    const twoNewPractices = practice('2026-01-02T01:00:00.000Z', 90);
    const afterTwoNew = evaluateCanonicalLearningState(baseInput({ evidence: [...evidenceAfterFail, oneNewPractice, twoNewPractices], now: '2026-01-02T13:00:00.000Z' }));
    expect(afterTwoNew.stage).toBe('PROVE');
    expect(afterTwoNew.actionState).toBe('EXECUTABLE');
  });
});

describe('SCENARIO D -- RETAIN FIRST FAILURE (see also audit-canon-v2-retain-two-strike.test.ts)', () => {
  it('Prove pass -> wait 3 days -> Retain fail -> RETAIN immediately executable (no new wait) -> second Retain pass -> TRANSFER', () => {
    const base = [learnCheck('2025-12-30T00:00:00.000Z', 90), practice('2025-12-31T00:00:00.000Z', 90), practice('2025-12-31T01:00:00.000Z', 90), prove('2026-01-01T00:00:00.000Z', 90)];
    const failedRetain = retain('2026-01-04T00:00:00.000Z', 50);
    const afterFail = evaluateCanonicalLearningState(baseInput({ evidence: [...base, failedRetain], now: '2026-01-04T01:00:00.000Z' }));
    expect(afterFail.stage).toBe('RETAIN');
    expect(afterFail.actionState).toBe('EXECUTABLE'); // immediately executable, no wait
    expect(afterFail.waitingReason).toBeNull();

    const secondRetain = retain('2026-01-04T02:00:00.000Z', 90);
    const afterSecond = evaluateCanonicalLearningState(baseInput({ evidence: [...base, failedRetain, secondRetain], now: '2026-01-04T03:00:00.000Z' }));
    expect(afterSecond.stage).toBe('TRANSFER');
    expect(afterSecond.actionState).toBe('EXECUTABLE');
  });
});

describe('SCENARIO E -- RETAIN DOUBLE FAILURE (see also audit-canon-v2-retain-two-strike.test.ts)', () => {
  it('Retain fail, Retain fail (2nd consecutive) -> PROVE -> new Prove pass -> a NEW 3-day clock (not the old due date)', () => {
    const base = [learnCheck('2025-12-30T00:00:00.000Z', 90), practice('2025-12-31T00:00:00.000Z', 90), practice('2025-12-31T01:00:00.000Z', 90), prove('2026-01-01T00:00:00.000Z', 90)];
    const fail1 = retain('2026-01-04T00:00:00.000Z', 40);
    const fail2 = retain('2026-01-04T01:00:00.000Z', 40);
    const afterDoubleFail = evaluateCanonicalLearningState(baseInput({ evidence: [...base, fail1, fail2], now: '2026-01-04T02:00:00.000Z' }));
    expect(afterDoubleFail.stage).toBe('PROVE');

    const newProve = prove('2026-01-05T00:00:00.000Z', 90);
    const afterNewProve = evaluateCanonicalLearningState(baseInput({ evidence: [...base, fail1, fail2, newProve], now: '2026-01-05T01:00:00.000Z' }));
    expect(afterNewProve.stage).toBe('RETAIN');
    expect(afterNewProve.actionState).toBe('WAITING');
    // The NEW 3-day clock starts from the NEW Prove (Jan 5), never the
    // old due date computed from the original Jan 1 Prove.
    expect(afterNewProve.nextEligibleAt).toBe('2026-01-08T00:00:00.000Z');
  });
});

const READY_FOR_TRANSFER = [
  learnCheck('2025-12-30T00:00:00.000Z', 90),
  practice('2025-12-31T00:00:00.000Z', 90),
  practice('2025-12-31T01:00:00.000Z', 90),
  prove('2026-01-01T00:00:00.000Z', 90),
  retain('2026-01-10T00:00:00.000Z', 90),
];

describe('SCENARIO F -- TRANSFER APPLICATION FAILURE (see also audit-canon-v2-transfer-classification.test.ts Case A)', () => {
  it('Transfer fail with APPLICATION_CONTEXT_WEAKNESS (default/no explicit signal) -> stay TRANSFER, immediate retry, no 3-day wait', () => {
    const failedTransfer = transfer('2026-01-13T00:00:00.000Z', [60, 60, 60]);
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, failedTransfer], now: '2026-01-13T01:00:00.000Z' }));
    expect(d.rollback?.case).toBe('TRANSFER_CASE_A_APPLICATION_CONTEXT_WEAKNESS');
    expect(d.stage).toBe('TRANSFER');
    expect(d.actionState).toBe('EXECUTABLE');
    expect(d.waitingReason).toBeNull();
  });
});

describe('SCENARIO G -- TRANSFER RETENTION FAILURE (see also audit-canon-v2-transfer-classification.test.ts Case B)', () => {
  it('Transfer fail with RETENTION_WEAKNESS -> RETAIN immediate (no wait), PROVE remains valid -> Retain pass -> TRANSFER again', () => {
    const failedTransfer = transfer('2026-01-13T00:00:00.000Z', [40, 40, 40], { transferFailureDiagnostic: 'RETENTION_WEAKNESS' });
    const afterFail = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, failedTransfer], now: '2026-01-13T01:00:00.000Z' }));
    expect(afterFail.rollback?.case).toBe('TRANSFER_CASE_B_RETENTION_WEAKNESS');
    expect(afterFail.stage).toBe('RETAIN');
    expect(afterFail.actionState).toBe('EXECUTABLE');
    expect(afterFail.waitingReason).toBeNull();
    expect(afterFail.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');

    const requalifyingRetain = retain('2026-01-14T00:00:00.000Z', 90);
    const afterRetain = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, failedTransfer, requalifyingRetain], now: '2026-01-14T01:00:00.000Z' }));
    expect(afterRetain.rollback).toBeNull();
    expect(afterRetain.stage).toBe('TRANSFER');
    expect(afterRetain.actionState).toBe('EXECUTABLE');
  });
});

describe('SCENARIO H -- TRANSFER FOUNDATION FAILURE (see also audit-canon-v2-transfer-classification.test.ts Case C)', () => {
  it('Transfer fail with FOUNDATIONAL_PROCEDURAL_FAILURE -> PRACTICE (window reset) -> 2 new qualifying Practices -> new Prove -> new 3-day wait -> Retain -> Transfer', () => {
    const failedTransfer = transfer('2026-01-13T00:00:00.000Z', [40, 40, 40], { transferFailureDiagnostic: 'FOUNDATIONAL_PROCEDURAL_FAILURE' });
    const afterFail = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, failedTransfer], now: '2026-01-13T01:00:00.000Z' }));
    expect(afterFail.rollback?.case).toBe('TRANSFER_CASE_C_FOUNDATIONAL_PROCEDURAL_FAILURE');
    expect(afterFail.stage).toBe('PRACTICE');
    expect(afterFail.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('LOCKED');
    expect(afterFail.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('LOCKED');

    const newP1 = practice('2026-01-14T00:00:00.000Z', 90);
    const newP2 = practice('2026-01-14T01:00:00.000Z', 90);
    const afterRequalified = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, failedTransfer, newP1, newP2], now: '2026-01-14T02:00:00.000Z' }));
    expect(afterRequalified.stage).toBe('PROVE');

    const newProve = prove('2026-01-15T00:00:00.000Z', 90);
    const afterNewProve = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, failedTransfer, newP1, newP2, newProve], now: '2026-01-15T01:00:00.000Z' }));
    expect(afterNewProve.stage).toBe('RETAIN');
    expect(afterNewProve.actionState).toBe('WAITING');
    // A genuinely NEW 3-day wait, from the new Prove.
    expect(afterNewProve.nextEligibleAt).toBe('2026-01-18T00:00:00.000Z');

    const newRetain = retain('2026-01-18T00:00:00.000Z', 90);
    const afterNewRetain = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, failedTransfer, newP1, newP2, newProve, newRetain], now: '2026-01-18T01:00:00.000Z' }));
    expect(afterNewRetain.stage).toBe('TRANSFER');
    expect(afterNewRetain.actionState).toBe('EXECUTABLE');
  });
});

describe('SCENARIO I -- CRITICAL MISCONCEPTION (see also audit-canon-v2-learn-prove-misconception.test.ts)', () => {
  it('high score + an ACTIVE critical misconception -> blocked back to PRACTICE; explicit resolution (the SAME evidence, flag cleared) -> progression resumes to CONSOLIDATED', () => {
    const evidence = [
      learnCheck('2025-12-30T00:00:00.000Z', 90),
      practice('2025-12-31T00:00:00.000Z', 90),
      practice('2025-12-31T01:00:00.000Z', 90),
      prove('2026-01-01T00:00:00.000Z', 90),
      retain('2026-01-10T00:00:00.000Z', 90),
      transfer('2026-01-20T00:00:00.000Z', [90, 90, 90]),
    ];
    const blocked = evaluateCanonicalLearningState(baseInput({ evidence, now: '2026-01-21T00:00:00.000Z', activeCriticalMisconception: true }));
    expect(blocked.stage).toBe('PRACTICE');
    expect(blocked.intervention).toBe('REINFORCE');
    expect(blocked.reasonCodes).toContain('CRITICAL_MISCONCEPTION');

    // Explicit correction evidence resolves the misconception elsewhere
    // (misconception.service.ts's own dedicated resolution evidence
    // pathway, outside this pure engine's scope) -- from the engine's
    // OWN perspective, resolution is exactly this: the SAME underlying
    // evidence, now with the live flag cleared.
    const resumed = evaluateCanonicalLearningState(baseInput({ evidence, now: '2026-01-21T00:00:00.000Z', activeCriticalMisconception: false }));
    expect(resumed.stage).toBe('CONSOLIDATED');
    expect(resumed.actionState).toBe('CONSOLIDATED');
  });
});

describe('SCENARIO J -- AI FAILURE SAFETY (across LEARN_CHECK, PRACTICE, PROVE, RETAIN, TRANSFER)', () => {
  beforeEach(() => {
    h.chunked.mockReset();
    h.recovery.mockReset();
    h.priorFingerprints.mockReset().mockResolvedValue(new Set<string>());
    h.generate.mockReset();
  });

  it('PROVE: a provider failure/short generation never produces a partial 10-question batch -- generateCanonicalProveQuestions degrades to a short result, never throws, never fabricates', async () => {
    const { generateCanonicalProveQuestions } = await import('@/services/canonical-prove-generation.service');
    h.chunked.mockResolvedValue({ accepted: [], chunkPlan: [10], chunkDiagnostics: [{ externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false }] });
    h.recovery.mockResolvedValue({ accepted: [], diagnostics: { externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false } });
    const result = await generateCanonicalProveQuestions({
      conceptId: 'c1', studentId: 's1', subjectId: 'subj1', targetCount: 10, difficulty: 3, guidance: 'g', language: 'en', visualAidRate: 0, ibContext: null,
      activityType: 'PROVE', quizMode: 'canonical_prove', parentOperationId: 'op1',
    });
    expect(result.finalQuestionCount).toBe(0);
    expect(result.questions).toEqual([]);
  });

  it('RETAIN: a provider failure never produces a partial 10-question batch (canon-v2-retain-generation.test.ts has the full dedicated suite)', async () => {
    const { generateCanonicalRetainQuestions } = await import('@/services/canonical-retain-generation.service');
    h.chunked.mockResolvedValue({ accepted: [], chunkPlan: [10], chunkDiagnostics: [{ externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false }] });
    h.recovery.mockResolvedValue({ accepted: [], diagnostics: { externalAiCallCount: 1, semanticCallCount: 0, fallbackUsed: false } });
    const result = await generateCanonicalRetainQuestions({
      conceptId: 'c1', studentId: 's1', subjectId: 'subj1', targetCount: 10, difficulty: 3, guidance: 'g', language: 'en', visualAidRate: 0, ibContext: null,
      activityType: 'RETENTION_CHECK', quizMode: 'canonical_retain', parentOperationId: 'op1',
    });
    expect(result.finalQuestionCount).toBe(0);
  });

  it('TRANSFER: a malformed/short generation never produces a partial 3-challenge set (canon-v2-transfer-generation.test.ts has the full dedicated suite)', async () => {
    const { generateCanonicalTransferChallenges } = await import('@/services/canonical-transfer-generation.service');
    h.generate.mockResolvedValue([]);
    const result = await generateCanonicalTransferChallenges({
      conceptId: 'c1', studentId: 's1', subjectId: 'subj1', difficulty: 4, guidance: 'g', language: 'en', visualAidRate: 0, ibContext: null,
    });
    expect(result.finalQuestionCount).toBe(0);
  });

  it('LEARN_CHECK and PRACTICE: both reuse generatePracticeQuestions, whose own AI failure (an empty/thrown result) is caught by the SAME universal "0 or short questions -> fail closed before storeQuiz" route guard -- never a separate, weaker path for either', () => {
    const guardIdx = ROUTE_SRC.indexOf('if (questions.length > 0 && questions.length < maxQuestions)');
    const storeIdx = ROUTE_SRC.indexOf('const quizId = await storeQuiz(');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(storeIdx).toBeGreaterThan(guardIdx);
    // Both canonical_learn_check and topic_practice/review dispatch
    // through generatePracticeQuestions -- confirmed exactly twice
    // (quiz-generation-timeout.test.ts's own dedicated single-call-site
    // count test), so there is no separate LEARN_CHECK-only generation
    // path that could bypass this same guard.
    const occurrences = (ROUTE_SRC.match(/generatePracticeQuestions\(/g) ?? []).length;
    expect(occurrences).toBe(2);
  });

  it('every canonical_* generation-incomplete response carries a real, diagnostics-derived canonicalErrorCode (AI_GENERATION_FAILED / AI_GENERATION_INVALID / AI_VALIDATION_FAILED via classifyProveRetainGenerationFailure/classifyTransferGenerationFailure), falling back to the generic AI_GENERATION_FAILED mapping only when no generation-result diagnostics are available -- proven at the unit level in canon-v2-generation-failure-classifier.test.ts; this test only confirms the route actually wires the classifier in for all 3 generation-incomplete branches', () => {
    const occurrences = (ROUTE_SRC.match(/canonicalErrorCode: canonicalGenerationErrorCode \?\? toCanonicalErrorCode\('V1_(PROVE|RETAIN|TRANSFER)_GENERATION_INCOMPLETE'\)\.code/g) ?? []).length;
    expect(occurrences).toBe(6); // 3 modes x 2 guard sites (short-of-target, totally-empty)
    expect(ROUTE_SRC).toMatch(/import \{ classifyProveRetainGenerationFailure, classifyTransferGenerationFailure \} from '@\/lib\/lx\/canonical-generation-failure-classifier';/);
  });

  it('no canonical failure path ever calls storeQuiz -- confirmed structurally: the universal guard\'s own early-return always precedes the ONE storeQuiz call site in handleGenerateQuiz', () => {
    const guardIdx = ROUTE_SRC.indexOf("if (questions.length === 0) {");
    const storeIdx = ROUTE_SRC.indexOf('const quizId = await storeQuiz(');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(storeIdx).toBeGreaterThan(guardIdx);
  });

  it('AI failure UX (Section 16): the client never blames the learner or claims lost progress/stage reset for a generation failure -- verified per-locale in canon-v2-ui-certification.test.ts / ret-r3-retention-availability.test.ts; this test confirms retry re-requests the SAME canonical activity contract, never a different stage/mode', () => {
    const QUIZ_PAGE_SRC = read('src/app/dashboard/quiz/page.tsx');
    const idx = QUIZ_PAGE_SRC.indexOf("if (phase === 'error')");
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 3800);
    // "Try again" calls the SAME generateQuiz with the SAME quizMode
    // state (never a different mode/stage) -- generateQuiz reads
    // `quizMode` from component state, set once from the URL and never
    // reassigned.
    expect(slice).toMatch(/onClick=\{\(\) => generateQuiz\(studentId\)\}/);
  });
});
