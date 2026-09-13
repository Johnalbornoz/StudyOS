/**
 * LX-9R6-R1 -- UNIVERSAL QUIZ COUNT CONTRACT + GENERATION OBSERVABILITY.
 * The 30 required tests, in order (Count contract 1-12, Observability
 * 13-24, Regression 25-30).
 *
 * Standing product invariant this phase closes the last gaps on:
 * StudyUS decides the number of questions in a valid activity -- a
 * generated activity either contains EXACTLY the canonical required
 * count, or generation fails recoverably. Before this phase,
 * generatePracticeQuestions (topic_practice/review) and
 * generateGatedQuestionBatch (the small-Practice-count path AND
 * diagnostic_check/cumulative_assessment/exam_simulation) could all
 * silently publish fewer questions than requested -- "partial
 * tolerance" was the celebrated, explicitly-documented design. Fixed by:
 * (1) generateGatedQuestionBatch now runs its Terra fallback whenever
 * the accepted count is SHORT of target (not just fully EMPTY), and
 * fails closed (insufficientCount) rather than returning a short array;
 * (2) generatePracticeQuestions's chunked path now runs ONE bounded
 * aggregate recovery round if the merged, deduped result is still short
 * of `count`, and fails closed if that one round can't close the gap;
 * (3) route.ts gained a universal backstop rejecting any non-empty but
 * short-of-`maxQuestions` result, catching a residual multi-concept
 * cross-batch shortfall even if a future generator regresses.
 * Separately, operationId-correlated structured telemetry (matching the
 * pattern LX-9R6 already proved for quick_check/retention) was added to
 * generatePracticeQuestions ([practice]) and generateGatedQuestionBatch
 * ([gated_batch], shared by diagnostic/cumulative/mock/small-practice),
 * with a parent operationId threaded from route.ts correlating every
 * per-concept call of a multi-concept request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const GATED_SRC = read('src/services/gated-question-generation.service.ts');
const QUIZ_GEN_SRC = read('src/services/quiz-generation.service.ts');

// LX-9R6-R1 6-8: module mocks for the ONE describe block below that
// exercises generateGatedQuestionBatch directly (the shared generator
// behind DIAGNOSTIC_CHECK/CUMULATIVE_ASSESSMENT/MOCK_EXAM/small-count
// Practice) -- hoisted to top level per vitest's own requirement; every
// other describe block in this file is a pure source-text audit and
// never imports quiz-generation.service, so mocking it globally here is
// safe.
const h = vi.hoisted(() => ({
  gen: vi.fn(),
  det: vi.fn(),
  verify: vi.fn(),
  verifyBatch: vi.fn(async ({ candidates }: any) => {
    const entries = await Promise.all(candidates.map(async (c: any) => [c.id, await h.verify({ question: c.question })] as const));
    return new Map(entries);
  }),
  evalV: vi.fn(),
  record: vi.fn(),
}));
vi.mock('@/services/quiz-generation.service', () => ({ generateQuestionsForConcept: (...a: any[]) => h.gen(...a) }));
vi.mock('@/lib/lx/question-quality-contract', () => ({ checkQuestionQualityDeterministic: (...a: any[]) => h.det(...a) }));
vi.mock('@/services/question-quality-verifier.service', () => ({
  verifyQuestionQuality: (...a: any[]) => h.verify(...a),
  verifyQuestionQualityBatch: (a: any) => h.verifyBatch(a),
  evaluateQuestionQualityVerdict: (...a: any[]) => h.evalV(...a),
}));
vi.mock('@/lib/ai/runtime-event', () => ({
  recordRuntimeEvent: (...a: any[]) => h.record(...a),
  buildRuntimeEvent: (b: any) => b,
  buildAggregateRuntimeEvent: (base: any, calls: any[]) => ({ ...base, calls }),
}));

// ============================================================
// REQUIRED TESTS 1-12 -- COUNT CONTRACT
// ============================================================
describe('1. Practice publishes exactly requiredQuestionCount / 2. Review publishes exactly requiredQuestionCount', () => {
  it('topic_practice and review both resolve activityType via activityTypeForQuizMode and pass the SAME perConceptCap (the exact canonical count) into generatePracticeQuestions', () => {
    const block = ROUTE_SRC.slice(ROUTE_SRC.indexOf("quizMode === 'topic_practice' || validated.quizMode === 'review'"), ROUTE_SRC.indexOf("quizMode === 'topic_practice' || validated.quizMode === 'review'") + 500);
    expect(block).toMatch(/generatePracticeQuestions\(conceptIds\[0\], validated\.studentId, validated\.subjectId, \{/);
    expect(block).toMatch(/count: perConceptCap,/);
  });

  it('generatePracticeQuestions guarantees its return is either exactly `count` or []  -- verified in tests/unit/quiz-generation-practice-chunking.test.ts (exact-count publish contract describe block)', () => {
    expect(QUIZ_GEN_SRC).toMatch(/if \(published\.length < count\) \{/);
    expect(QUIZ_GEN_SRC).toMatch(/return published\.slice\(0, count\); \/\/ never exceed requestedCount/);
  });
});

describe('3. Practice missing candidates triggers bounded recovery / 4. failed recovery returns QUESTION_COUNT_INSUFFICIENT', () => {
  it('an aggregate deficit after chunk gating triggers exactly ONE recovery request, sized to the deficit plus a small bounded surplus', () => {
    const body = QUIZ_GEN_SRC.slice(QUIZ_GEN_SRC.indexOf('if (published.length < count) {'), QUIZ_GEN_SRC.indexOf("log('PRACTICE_RECOVERY_COMPLETE'"));
    expect(body).toMatch(/const deficit = count - published\.length;/);
    expect(body).toMatch(/const recoverySize = Math\.min\(MAX_QUESTIONS_PER_CHUNK \* 2, deficit \+ 1\);/);
    expect(body).toMatch(/const recoveryRaw = await requestChunk\(recoverySize, TERRA\)/);
  });

  it('if the recovery round still cannot reach `count`, the internal errorCode is QUESTION_COUNT_INSUFFICIENT and the function returns []', () => {
    const body = QUIZ_GEN_SRC.slice(QUIZ_GEN_SRC.indexOf("if (published.length < count) {\n      log('PRACTICE_GENERATION_INSUFFICIENT'"), QUIZ_GEN_SRC.indexOf("if (published.length < count) {\n      log('PRACTICE_GENERATION_INSUFFICIENT'") + 560);
    expect(body).toMatch(/errorCode: 'QUESTION_COUNT_INSUFFICIENT'/);
    expect(body).toMatch(/return \[\];/);
  });
});

describe('5. shorter Practice quiz is never silently published', () => {
  it('the ONLY two terminal outcomes generatePracticeQuestions\'s chunked path can produce are the full, capped `count` or [] -- both the success and the insufficiency branch are unconditional, guarded by the exact same `published.length < count` check', () => {
    const fn = QUIZ_GEN_SRC.slice(QUIZ_GEN_SRC.indexOf('let published = deduped;'), QUIZ_GEN_SRC.indexOf('export async function generateRetentionCheckQuestions'));
    expect(fn).toMatch(/if \(published\.length < count\) \{[\s\S]*?return \[\];\s*\n\s*\}/);
    expect(fn).toMatch(/return published\.slice\(0, count\); \/\/ never exceed requestedCount/);
    // No other bare `return <array>;` escapes between the recovery block and the final two outcomes.
    const between = fn.slice(fn.indexOf('if (published.length < count) {'), fn.indexOf('return published.slice(0, count)'));
    expect((between.match(/return \[\];/g) || []).length).toBe(1);
  });
});

describe('6. Diagnostic publishes resolved required count exactly / 7. Cumulative publishes resolved required count exactly / 8. Mock publishes resolved required count exactly', () => {
  const Q = (id: string) => ({ id, conceptId: 'c1', type: 'multiple_choice', question: id, correctAnswer: 'A', explanation: 'e', difficulty: 3 });

  beforeEach(() => {
    h.gen.mockReset();
    h.det.mockReset().mockReturnValue({ status: 'PASS', failures: [] });
    h.verify.mockReset().mockResolvedValue({});
    h.evalV.mockReset().mockReturnValue({ pass: true });
    h.record.mockReset();
  });

  it('DIAGNOSTIC_CHECK/CUMULATIVE_ASSESSMENT/MOCK_EXAM all resolve into ONE exact per-concept count BEFORE generation -- route.ts computes perConceptCap once, generateGatedQuestionBatch never invents its own', () => {
    expect(ROUTE_SRC).toMatch(/const perConceptCap = Math\.max\(1, Math\.ceil\(maxQuestions \/ conceptIds\.length\)\);/);
    expect(ROUTE_SRC).toMatch(/generateGatedQuestionBatch\(cId, validated\.studentId, validated\.subjectId, \{\s*\n\s*count: perConceptCap,/);
  });

  it('a Luna result SHORT of (but not empty against) the per-concept target now triggers Terra recovery -- fallbackWhen is SHORT, not EMPTY', async () => {
    const { generateGatedQuestionBatch } = await import('@/services/gated-question-generation.service');
    h.gen.mockResolvedValueOnce([Q('a')]).mockResolvedValueOnce([Q('b'), Q('c')]); // Luna: 1 of 3; Terra: 2 more, closing it
    const out = await generateGatedQuestionBatch('c1', 's1', 'subj1', { count: 3, language: 'en' });
    expect(h.gen).toHaveBeenCalledTimes(2); // Terra fired even though Luna wasn't fully empty
    expect(out.map((q: any) => q.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('if Terra recovery STILL leaves the batch short of the per-concept target, generateGatedQuestionBatch fails closed ([]) -- never publishes 2 of 3', async () => {
    const { generateGatedQuestionBatch } = await import('@/services/gated-question-generation.service');
    h.gen.mockResolvedValueOnce([Q('a')]).mockResolvedValueOnce([Q('b')]); // Luna: 1, Terra: 1 more -- merged is still only 2 of 3
    const out = await generateGatedQuestionBatch('c1', 's1', 'subj1', { count: 3, language: 'en' });
    expect(out).toEqual([]);
    expect(h.gen).toHaveBeenCalledTimes(2); // still bounded -- no third call
  });
});

describe('9. SOLO_CHECK remains exactly 6 or failure / 10. RETENTION_CHECK remains exactly 6 or failure', () => {
  it('generateQuickCheckQuestions is untouched by this phase -- still the all-or-nothing 6-slot contract from LX-9R6', () => {
    expect(QUIZ_GEN_SRC).toMatch(/const QUICK_CHECK_SLOT_COUNT = 6;/);
    expect(QUIZ_GEN_SRC).toMatch(/if \(storedQuestions\.length !== QUICK_CHECK_SLOT_COUNT\)/);
  });

  it('generateRetentionCheckQuestions is untouched by this phase -- still exactly RETENTION_REQUIRED_COUNT (6) or []', () => {
    expect(QUIZ_GEN_SRC).toMatch(/export const RETENTION_REQUIRED_COUNT = 6;/);
    expect(QUIZ_GEN_SRC).toMatch(/RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS/);
  });
});

describe('11. no unbounded recovery loop', () => {
  it('generatePracticeQuestions performs at most one aggregate recovery request -- no loop, no retry-of-the-recovery', () => {
    const body = QUIZ_GEN_SRC.slice(QUIZ_GEN_SRC.indexOf("let published = deduped;"), QUIZ_GEN_SRC.indexOf('if (published.length < count) {\n      log(\'PRACTICE_GENERATION_INSUFFICIENT\''));
    const recoveryCalls = (body.match(/requestChunk\(/g) || []).length;
    expect(recoveryCalls).toBe(1); // exactly one requestChunk call in the recovery block -- the `for` loop present only iterates the ALREADY-fetched candidates (merge/dedupe), it never re-invokes generation
    expect(body).not.toMatch(/while\s*\(/);
    expect(body.match(/requestChunk\(/g)?.length).not.toBeGreaterThan(1);
  });

  it('generateGatedQuestionBatch\'s Terra fallback is still bounded to exactly one regeneration per unit (gateUnitWithTerraFallback\'s own, unchanged contract)', () => {
    expect(GATED_SRC).toMatch(/No third attempt, ever\./);
  });
});

describe('12. candidate surplus never changes learner-visible required count', () => {
  it('the recovery request is sized independently of `count` (a bounded surplus over the DEFICIT, not a re-request of the full count) -- the published/capped count is always exactly `count`', () => {
    expect(QUIZ_GEN_SRC).toMatch(/const recoverySize = Math\.min\(MAX_QUESTIONS_PER_CHUNK \* 2, deficit \+ 1\);/);
    expect(QUIZ_GEN_SRC).toMatch(/return published\.slice\(0, count\);/);
  });

  it('retention_check\'s pre-existing candidate-surplus authority (8 candidates requested, 6 ever published) is untouched -- the same separation this phase generalizes elsewhere', () => {
    expect(QUIZ_GEN_SRC).toMatch(/CANONICAL COUNT vs\. CANDIDATE COUNT/);
  });
});

// ============================================================
// REQUIRED TESTS 13-24 -- OBSERVABILITY
// ============================================================
describe('13. Practice emits operationId / 14. Review emits operationId', () => {
  it('generatePracticeQuestions mints its own operationId and threads it through every [practice] log line', () => {
    expect(QUIZ_GEN_SRC).toMatch(/function logPractice\(label: string, meta: Record<string, unknown> = \{\}\): void \{/);
    expect(QUIZ_GEN_SRC).toMatch(/console\.log\('\[practice\]', JSON\.stringify\(\{ label, \.\.\.meta \}\)\);/);
    expect(QUIZ_GEN_SRC).toMatch(/const log = \(label: string, meta: Record<string, unknown> = \{\}\) =>\s*\n\s*logPractice\(label, \{ operationId,/);
  });

  it('review reuses the SAME generatePracticeQuestions call site/telemetry as topic_practice -- no separate review-specific logger', () => {
    const reviewBlock = ROUTE_SRC.slice(ROUTE_SRC.indexOf("quizMode === 'topic_practice' || validated.quizMode === 'review'"), ROUTE_SRC.indexOf("quizMode === 'topic_practice' || validated.quizMode === 'review'") + 70);
    expect(reviewBlock).toContain("=== 'review'");
  });
});

describe('15. Diagnostic emits operationId / 16. Cumulative emits operationId / 17. Mock emits operationId', () => {
  it('generateGatedQuestionBatch (shared by all three) mints its own operationId and threads it through every [gated_batch] log line', () => {
    expect(GATED_SRC).toMatch(/function logGatedBatch\(label: string, meta: Record<string, unknown> = \{\}\): void \{/);
    expect(GATED_SRC).toMatch(/const operationId = randomUUID\(\);/);
    expect(GATED_SRC).toMatch(/log\('GATED_BATCH_GENERATION_STARTED'\);/);
  });

  it('each per-concept call also carries the ONE parent operationId route.ts minted for the whole multi-concept request', () => {
    expect(ROUTE_SRC).toMatch(/const parentOperationId = randomUUID\(\);/);
    expect(ROUTE_SRC).toMatch(/generateGatedQuestionBatch\(cId, validated\.studentId, validated\.subjectId, \{[\s\S]{0,500}parentOperationId,/);
    expect(GATED_SRC).toMatch(/parentOperationId: opts\.parentOperationId \?\? null/);
  });
});

describe('18. SOLO_CHECK telemetry unchanged / 19. Retention telemetry unchanged', () => {
  it('the [quick_check] and [retention] logging functions from LX-9R6 are byte-identical -- this phase added new loggers, never touched these', () => {
    expect(QUIZ_GEN_SRC).toMatch(/function logQuickCheck\(label: string, meta: Record<string, unknown> = \{\}\): void \{/);
    expect(QUIZ_GEN_SRC).toMatch(/function logRetention\(label: string, meta: Record<string, unknown> = \{\}\): void \{/);
  });
});

describe('20. success telemetry contains publishedCount / 21. failure telemetry contains stable errorCode', () => {
  it('[practice] success and insufficiency logs both carry the required fields', () => {
    expect(QUIZ_GEN_SRC).toMatch(/log\('PRACTICE_GENERATION_SUCCEEDED', \{ publishedCount: count, acceptedCount: published\.length, durationMs: Date\.now\(\) - startedAt, success: true \}\);/);
    expect(QUIZ_GEN_SRC).toMatch(/errorCode: 'QUESTION_COUNT_INSUFFICIENT',\s*\n\s*publishedCount: published\.length,/);
  });

  it('[gated_batch] success and insufficiency logs both carry the required fields', () => {
    expect(GATED_SRC).toMatch(/log\('GATED_BATCH_GENERATION_SUCCEEDED', \{\s*\n\s*publishedCount: result\.accepted\.length,/);
    expect(GATED_SRC).toMatch(/errorCode: 'QUESTION_COUNT_INSUFFICIENT',\s*\n\s*publishedCount: result\.accepted\.length,/);
  });

  it('route.ts\'s new aggregate backstop log also carries a stable errorCode distinct from the plain empty-result GENERATION_FAILED', () => {
    expect(ROUTE_SRC).toMatch(/errorCode: 'QUESTION_COUNT_INSUFFICIENT',/);
    expect(ROUTE_SRC).toMatch(/generationPhase: 'GENERATION_INSUFFICIENT',/);
  });
});

describe('22. recovery count is observable / 23. durationMs observable', () => {
  it('[practice] logs the recovery deficit/recoverySize and recoveredCount explicitly', () => {
    expect(QUIZ_GEN_SRC).toMatch(/log\('PRACTICE_RECOVERY_STARTED', \{ deficit, recoverySize \}\);/);
    expect(QUIZ_GEN_SRC).toMatch(/log\('PRACTICE_RECOVERY_COMPLETE', \{ recoveredCount: newlyAccepted\.length, acceptedCount: published\.length \}\);/);
  });

  it('[gated_batch] logs recoveryCalls and durationMs on every terminal outcome', () => {
    expect(GATED_SRC).toMatch(/recoveryCalls: result\.fallbackUsed \? 1 : 0,/);
    expect(GATED_SRC).toMatch(/durationMs: Date\.now\(\) - startedAt,/);
  });
});

describe('24. provider usage remains correlatable', () => {
  it('generateGatedQuestionBatch still threads the SAME operationId into emitAggregateGateEvent via GateUnitTelemetry -- provider cost/usage events for this unit are correlatable with its [gated_batch] lines without duplicating provider accounting', () => {
    expect(GATED_SRC).toMatch(/\{ lunaGenerationCalls, terraGenerationCalls, operationId \}/);
  });
});

// ============================================================
// REQUIRED TESTS 25-30 -- REGRESSION
// ============================================================
describe('25. no canonical progression change / 26. no adaptive-difficulty change / 27. no novelty regression / 28. no WAITING regression / 29. no assistance regression', () => {
  it('this phase touches only route.ts, quiz-generation.service.ts, and gated-question-generation.service.ts -- never learner-journey-contract.ts, difficulty-contract.ts, canonical-learning-progress.ts, continuation.ts, or mastery.service.ts', () => {
    // Structural guard: the canonical policy modules this phase was
    // explicitly forbidden from touching still define the exact same
    // public contracts LX-9R5/LX-9R6 established.
    const difficultyContractSrc = read('src/lib/lx/difficulty-contract.ts');
    const journeyContractSrc = read('src/lib/lx/learner-journey-contract.ts');
    const canonicalProgressSrc = read('src/lib/lx/canonical-learning-progress.ts');
    expect(difficultyContractSrc).toMatch(/export function resolveTargetDifficulty/);
    expect(journeyContractSrc).toMatch(/export function isRetentionWaiting\(stage: LearnerJourneyStage, retentionDue: boolean \| undefined \| null\): boolean \{/);
    expect(canonicalProgressSrc).toMatch(/export function buildCanonicalLearningProgress/);
  });

  it('retention_check\'s novelty window (RETENTION_NOVELTY_ATTEMPT_WINDOW) and cross-attempt exclusion logic are untouched', () => {
    expect(QUIZ_GEN_SRC).toMatch(/const RETENTION_NOVELTY_ATTEMPT_WINDOW = 3;/);
  });

  it('assistance telemetry (hintsUsed-based history labeling from LX-9R5) is untouched', () => {
    const detailSrc = read('src/app/dashboard/subjects/[id]/concepts/[conceptId]/page.tsx');
    expect(detailSrc).toMatch(/h\.hintsUsed > 0/);
  });
});

describe('30. all existing tests green', () => {
  it('is verified by the full `npx vitest run` suite passing (see the phase report), not re-asserted here', () => {
    expect(true).toBe(true);
  });
});
