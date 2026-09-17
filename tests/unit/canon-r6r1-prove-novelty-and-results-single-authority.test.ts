/**
 * CANON-R6R1 -- PROVE EXACT-DUPLICATE NOVELTY + RESULTS SINGLE
 * AUTHORITY (surgical repair of CANON-R6's two open blockers).
 *
 * A. Exact-duplicate novelty: a Prove question must never repeat a
 *    question the student already saw in a prior v1 Practice attempt
 *    for the same concept, nor repeat within the Prove batch itself.
 *    Deliberately MINIMUM scope -- exact text match only, never
 *    semantic similarity.
 * B. Results single authority: for a v1 attempt, `canonicalResults` is
 *    the ONLY displayed next-step authority -- the legacy `messageText`
 *    next-step line must never render alongside it.
 *
 * Route/UI-level wiring is audited via source, following this route's
 * own established testing convention (see
 * canon-r5r1-generate-and-take-wiring.test.ts's doc comment); the pure
 * novelty functions and the DB loader are exercised directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeQuestionForExactNovelty, fingerprintQuestion, filterExactDuplicates } from '@/lib/lx/exact-duplicate-novelty';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const QUIZ_PAGE_SRC = read('src/app/dashboard/quiz/page.tsx');
const NOVELTY_SRC = read('src/lib/lx/exact-duplicate-novelty.ts');
const PERSISTENCE_SRC = read('src/services/quiz-persistence.service.ts');
// CANON-R6-PERF-R2: the novelty-filter + aggregate-recovery orchestration
// this describe block originally audited inside ROUTE_SRC was extracted
// (CANON-R6-PERF-R2) into this shared service so BOTH the live request
// path and the new background pre-generation path call the identical
// certified pipeline -- audited here instead, plus a route-level check
// that route.ts actually DELEGATES to it rather than reimplementing it.
const GENERATION_SERVICE_SRC = read('src/services/canonical-prove-generation.service.ts');

function q(question: string, overrides: Partial<GeneratedQuestion> = {}): GeneratedQuestion {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    conceptId: 'c1',
    type: 'short_answer',
    answerFormat: 'text',
    question,
    correctAnswer: 'x',
    explanation: 'because',
    difficulty: 3,
    ...overrides,
  } as GeneratedQuestion;
}

// ============================================================
// 1-4 -- normalization
// ============================================================
describe('1-4 -- normalizeQuestionForExactNovelty', () => {
  it('1. is deterministic -- same input always normalizes to the same output', () => {
    const text = 'What is the derivative of x^2?';
    expect(normalizeQuestionForExactNovelty(text)).toBe(normalizeQuestionForExactNovelty(text));
  });

  it('2. whitespace-only differences normalize equal', () => {
    const a = 'What   is  the derivative of x^2?';
    const b = 'What is the derivative of x^2?  ';
    const c = '  What\nis the\tderivative of x^2?';
    expect(normalizeQuestionForExactNovelty(a)).toBe(normalizeQuestionForExactNovelty(b));
    expect(normalizeQuestionForExactNovelty(b)).toBe(normalizeQuestionForExactNovelty(c));
  });

  it('3. case-only differences normalize equal', () => {
    const a = 'What is the derivative of x^2?';
    const b = 'WHAT IS THE DERIVATIVE OF X^2?';
    expect(normalizeQuestionForExactNovelty(a)).toBe(normalizeQuestionForExactNovelty(b));
  });

  it('4. materially different math/text remains different', () => {
    const a = normalizeQuestionForExactNovelty('What is the derivative of x^2?');
    const b = normalizeQuestionForExactNovelty('What is the integral of x^2?');
    const c = normalizeQuestionForExactNovelty('What is the derivative of x^3?');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('18. never claims or uses semantic similarity -- no embedding/similarity-scoring/paraphrase CODE anywhere in the novelty module (the doc comments legitimately use those words only in prose, to document what is explicitly OUT of scope)', () => {
    // strip comments first: the doc comments legitimately discuss
    // embeddings/similarity/paraphrase as excluded concepts in prose --
    // this checks only the actual executable code.
    const codeOnly = NOVELTY_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/cosine|paraphrase|embedding|similarity/i);
    // exactly the three documented exports -- no fourth, undocumented
    // similarity-scoring function was slipped in alongside them.
    const exportedFunctions = NOVELTY_SRC.match(/^export function \w+/gm) ?? [];
    expect(exportedFunctions.sort()).toEqual(
      ['export function normalizeQuestionForExactNovelty', 'export function fingerprintQuestion', 'export function filterExactDuplicates'].sort()
    );
  });

  it('fingerprintQuestion uses ONLY the `question` field -- never correctAnswer/matchingPairs/orderingItems/id (documented in Part 5)', () => {
    const question = q('What is 2+2?', { correctAnswer: 'four' });
    expect(fingerprintQuestion(question)).toBe(normalizeQuestionForExactNovelty('What is 2+2?'));
    const sameQuestionDifferentAnswer = q('What is 2+2?', { correctAnswer: 'FOUR (different case, should not matter -- not even read)' });
    expect(fingerprintQuestion(question)).toBe(fingerprintQuestion(sameQuestionDifferentAnswer));
  });
});

// ============================================================
// 7-9 -- filterExactDuplicates
// ============================================================
describe('7-9 -- filterExactDuplicates', () => {
  it('7. an exact prior-Practice duplicate is rejected', () => {
    const prior = new Set([normalizeQuestionForExactNovelty('What is 2+2?')]);
    const result = filterExactDuplicates([q('What is 2+2?'), q('What is 3+3?')], prior);
    expect(result.accepted.map((x) => x.question)).toEqual(['What is 3+3?']);
    expect(result.rejectedCount).toBe(1);
  });

  it('8. an intra-batch (Prove-internal) duplicate is rejected -- only the first occurrence is accepted', () => {
    const result = filterExactDuplicates([q('What is 2+2?'), q('what is 2+2?  '), q('What is 5+5?')], new Set());
    expect(result.accepted.map((x) => x.question)).toEqual(['What is 2+2?', 'What is 5+5?']);
    expect(result.rejectedCount).toBe(1);
  });

  it('9. 10 genuinely novel questions are all accepted when none collide', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => q(`Distinct question number ${i}?`));
    const result = filterExactDuplicates(candidates, new Set());
    expect(result.accepted).toHaveLength(10);
    expect(result.rejectedCount).toBe(0);
  });

  it('is pure -- never mutates candidates or excludeFingerprints', () => {
    const candidates = [q('A?'), q('B?')];
    const exclude = new Set(['x']);
    const frozenCandidates = JSON.parse(JSON.stringify(candidates));
    const frozenExclude = new Set(exclude);
    filterExactDuplicates(candidates, exclude);
    expect(candidates).toEqual(frozenCandidates);
    expect(exclude).toEqual(frozenExclude);
  });

  it('returns an updated fingerprint set (prior + newly accepted) for the caller to pass into the next filtering call', () => {
    const prior = new Set(['zzz-prior-fingerprint']);
    const result = filterExactDuplicates([q('New question?')], prior);
    expect(result.fingerprints.has('zzz-prior-fingerprint')).toBe(true);
    expect(result.fingerprints.has(normalizeQuestionForExactNovelty('New question?'))).toBe(true);
  });
});

// ============================================================
// 5/6 -- loadPriorPracticeQuestionFingerprints
// ============================================================
const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: unknown[]) => queryMock(...args) } }));

describe('5/6 -- loadPriorPracticeQuestionFingerprints', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('5. loads fingerprints for the exact (student, concept) pair from real quiz_sessions.questions -- not a re-derivation from learning_evidence', async () => {
    const { loadPriorPracticeQuestionFingerprints } = await import('@/services/quiz-persistence.service');
    queryMock.mockResolvedValueOnce({
      rows: [{ questions: [q('Prior practice question one?', { conceptId: 'c1' }), q('Prior practice question two?', { conceptId: 'c1' })] }],
    });
    const fingerprints = await loadPriorPracticeQuestionFingerprints('s1', 'c1');
    expect(fingerprints.has(normalizeQuestionForExactNovelty('Prior practice question one?'))).toBe(true);
    expect(fingerprints.has(normalizeQuestionForExactNovelty('Prior practice question two?'))).toBe(true);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('topic_practice'), ['s1', 'c1']);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('pedagogical_policy_version IS NOT NULL'), ['s1', 'c1']);
  });

  it('6. a question belonging to a DIFFERENT concept within the same row is never included -- unrelated concepts are not excluded', async () => {
    const { loadPriorPracticeQuestionFingerprints } = await import('@/services/quiz-persistence.service');
    queryMock.mockResolvedValueOnce({
      rows: [{ questions: [q('This concept question?', { conceptId: 'c1' }), q('Other concept question?', { conceptId: 'c2' })] }],
    });
    const fingerprints = await loadPriorPracticeQuestionFingerprints('s1', 'c1');
    expect(fingerprints.has(normalizeQuestionForExactNovelty('This concept question?'))).toBe(true);
    expect(fingerprints.has(normalizeQuestionForExactNovelty('Other concept question?'))).toBe(false);
  });

  it('scopes the SQL itself to the one concept being Proved (never a broader student-only scan)', () => {
    const idx = PERSISTENCE_SRC.indexOf('export async function loadPriorPracticeQuestionFingerprints');
    const slice = PERSISTENCE_SRC.slice(idx, idx + 900);
    expect(slice).toMatch(/\$2::uuid = ANY\(concept_ids\)/);
    expect(slice).toMatch(/quiz_mode = 'topic_practice'/);
  });

  it('an empty result (no prior Practice history) returns an empty Set, never throws', async () => {
    const { loadPriorPracticeQuestionFingerprints } = await import('@/services/quiz-persistence.service');
    queryMock.mockResolvedValueOnce({ rows: [] });
    const fingerprints = await loadPriorPracticeQuestionFingerprints('s1', 'c1');
    expect(fingerprints.size).toBe(0);
  });
});

// ============================================================
// 10-14, 17 -- PROVE generation flow (source audit)
// ============================================================
describe('10-14/17 -- the certified canonical_prove generation pipeline wires the novelty filter with a bounded aggregate recovery (CANON-R6-PERF-R2 -- extracted into a shared service so the live path AND background pre-generation call the SAME code; CANON-R6-PERF-R1 already supersedes CANON-R6R1\'s own up-to-2-refill loop, which live evidence showed was never actually the latency source)', () => {
  it('10/12. at most ONE aggregate recovery round exists in the shared generation service -- no loop, no retry counter, never recursive', () => {
    expect(GENERATION_SERVICE_SRC).not.toMatch(/for \(let attempt/);
    expect(GENERATION_SERVICE_SRC).not.toMatch(/MAX_NOVELTY_REFILL_ATTEMPTS/);
    const recoveryCalls = (GENERATION_SERVICE_SRC.match(/generateBoundedRecoveryBatch\(/g) ?? []).length;
    expect(recoveryCalls).toBe(1);
  });

  it('10. when the concurrent chunks\' own novelty-filtered aggregate is short of targetCount, ONE recovery is requested, sized via the proven deficit+1 surplus formula (capped at 2x the per-chunk max)', () => {
    expect(GENERATION_SERVICE_SRC).toMatch(/const deficit = params\.targetCount - accepted\.length;/);
    expect(GENERATION_SERVICE_SRC).toMatch(/const recoveryRequestedCount = Math\.min\(MAX_QUESTIONS_PER_CHUNK \* 2, deficit \+ 1\);/);
    expect(GENERATION_SERVICE_SRC).toMatch(/generateBoundedRecoveryBatch\(params\.conceptId, params\.studentId, params\.subjectId, \{\s*\n\s*count: recoveryRequestedCount,/);
  });

  it('11. the recovery round\'s own output is filtered against `excludeFingerprints` carried forward from the initial pass -- filtered against BOTH prior Practice AND everything already accepted, never an isolated exclusion set', () => {
    const idx = GENERATION_SERVICE_SRC.indexOf('const recoveryFiltered = filterExactDuplicates(recovery.accepted, excludeFingerprints);');
    expect(idx).toBeGreaterThan(-1);
    const initialFilterIdx = GENERATION_SERVICE_SRC.indexOf('const initialFiltered = filterExactDuplicates(chunked.accepted, priorFingerprints);');
    expect(initialFilterIdx).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(initialFilterIdx);
  });

  it('13/14. after at most one recovery round, the result is simply returned (never re-entered) -- the CALLER decides fail-closed semantics (route.ts\'s pre-existing choke point for the live path; FAILED status for the background pre-generation path)', () => {
    const idx = GENERATION_SERVICE_SRC.indexOf('if (accepted.length < params.targetCount) {');
    expect(idx).toBeGreaterThan(-1);
    const returnIdx = GENERATION_SERVICE_SRC.indexOf('const questions = accepted.slice(0, params.targetCount);');
    expect(returnIdx).toBeGreaterThan(idx);
    const deficitChecks = (GENERATION_SERVICE_SRC.match(/if \(accepted\.length < params\.targetCount\)/g) ?? []).length;
    expect(deficitChecks).toBe(1);
    // route.ts's own pre-existing fail-closed choke point is unchanged
    // and still runs on whatever `questions` the generation service
    // (or the cache-hit path) produced.
    const chokePointIdx = ROUTE_SRC.indexOf('if (questions.length > 0 && questions.length < maxQuestions) {');
    const emptyGuardIdx = ROUTE_SRC.indexOf('if (questions.length === 0) {');
    const storeQuizIdx = ROUTE_SRC.indexOf('const quizId = await storeQuiz(');
    expect(emptyGuardIdx).toBeGreaterThan(chokePointIdx);
    expect(storeQuizIdx).toBeGreaterThan(emptyGuardIdx);
  });

  it('17. novelty diagnostics (priorPracticeFingerprintCount/rejectedExactDuplicateCount/acceptedNovelQuestionCount/noveltyPolicy) are computed and merged into the persisted marker as `v1MarkerToPersist`, never mutating the original `v1Marker`', () => {
    expect(ROUTE_SRC).toMatch(/v1MarkerToPersist: QuizSessionV1Marker \| null = v1Marker\s*\n\s*\? \{ \.\.\.v1Marker, novelty: noveltyDiagnostics \}\s*\n\s*: null;/);
    // populated from the generation service's own result on a cold-cache
    // request, or from the consumed prepared activity's own basis on a
    // cache hit (CANON-R6-PERF-R2) -- either way, always set for a
    // successful canonical_prove attempt.
    expect(ROUTE_SRC).toMatch(/noveltyDiagnostics = \{\s*\n\s*priorPracticeFingerprintCount: g\.priorPracticeFingerprintCount,\s*\n\s*rejectedExactDuplicateCount: g\.rejectedExactDuplicateCount,\s*\n\s*acceptedNovelQuestionCount: questions\.length,\s*\n\s*noveltyPolicy: 'EXACT_DUPLICATE_EXCLUSION_V1',/);
  });

  it('route.ts DELEGATES to the shared certified generator (generateCanonicalProveQuestions) rather than reimplementing chunking/novelty/recovery inline -- CANON-R6-PERF-R2 Part 6\'s own "never a cheaper pre-generation path" requirement depends on this being ONE real function, not two parallel implementations', () => {
    expect(ROUTE_SRC).toMatch(/const proveGen = await generateCanonicalProveQuestions\(\{/);
    expect(ROUTE_SRC).not.toMatch(/generateConcurrentChunkedBatch\(/);
    expect(ROUTE_SRC).not.toMatch(/generateBoundedRecoveryBatch\(/);
  });

  it('the failure reason for an incomplete novel batch is the SAME pre-existing Prove-specific code (V1_PROVE_GENERATION_INCOMPLETE) -- no new/different failure reason was invented for the novelty case', () => {
    // 2 occurrences in the JSON error response bodies (unchanged from
    // CANON-R6) + 2 occurrences (CANON-R6-PERF-I1) where the same,
    // already-existing code is ALSO passed as the `errorCode` argument
    // to `emitCanonicalProveSummary` at each of those two guards, + 2
    // (CANON-V2-FINAL-HARDENING Section 3) where the same code is ALSO
    // passed to toCanonicalErrorCode(...) at each guard to derive the
    // additive canonicalErrorCode field -- instrumentation reusing the
    // existing reason code, never a new one.
    const occurrences = (ROUTE_SRC.match(/V1_PROVE_GENERATION_INCOMPLETE/g) ?? []).length;
    expect(occurrences).toBe(6);
  });
});

// ============================================================
// 9 (generation guidance) -- isolated, non-authoritative nudge
// ============================================================
describe('9 -- generation guidance is an isolated nudge only, never the enforcement mechanism', () => {
  it('the canonical_prove guidance string gained an additive "do not repeat" sentence, scoped to ONLY that one config entry', () => {
    const idx = ROUTE_SRC.indexOf('canonical_prove: {');
    const slice = ROUTE_SRC.slice(idx, idx + 1200);
    expect(slice).toMatch(/do not repeat a question the student has already been asked/);
  });

  it('no other QUIZ_MODE_CONFIG entry (quick_check/topic_practice/review/etc.) was touched by this addition', () => {
    const idx = ROUTE_SRC.indexOf("quick_check: {");
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).not.toMatch(/do not repeat/);
  });
});

// ============================================================
// 15/16 -- Practice / quick_check regression
// ============================================================
describe('15/16 -- legacy quick_check and Practice generation are completely untouched', () => {
  it('15. quick_check retains its fixed defaultMax: 6 and its own dedicated fast path, with no novelty policy attached', () => {
    expect(ROUTE_SRC).toMatch(/quick_check:\s*\{\s*\n\s*guidance:/);
    expect(ROUTE_SRC).toMatch(/defaultMax: 6,/);
    const idx = ROUTE_SRC.indexOf('quick_check: {');
    const slice = ROUTE_SRC.slice(idx, idx + 400);
    expect(slice).not.toMatch(/novelty|Fingerprint/i);
  });

  it('16. the topic_practice/review generation call site never references generateCanonicalProveQuestions, novelty, or prepared-activity consumption', () => {
    const idx = ROUTE_SRC.indexOf("generatePracticeQuestions(conceptIds[0]");
    const nextBranchIdx = ROUTE_SRC.indexOf("validated.quizMode === 'retention_check'");
    const slice = ROUTE_SRC.slice(idx, nextBranchIdx);
    expect(slice).not.toMatch(/generateCanonicalProveQuestions|filterExactDuplicates|findActivePreparedActivity|revalidatePreparedActivity|consumePreparedActivity/);
  });

  it('novelty filtering (inside the shared generation service) and prepared-activity consumption are both gated strictly on quizMode === canonical_prove -- structurally unreachable for any other mode', () => {
    // The shared generation service itself has no notion of quizMode
    // gating (it's activity-agnostic, called ONLY for canonical_prove) --
    // the gate is at the CALL SITE, in route.ts's own canonical_prove
    // branch of the generation ternary.
    const generateCallIdx = ROUTE_SRC.indexOf('const proveGen = await generateCanonicalProveQuestions({');
    const branchGuardIdx = ROUTE_SRC.lastIndexOf("validated.quizMode === 'canonical_prove'", generateCallIdx);
    expect(branchGuardIdx).toBeGreaterThan(-1);
    const consumeCallIdx = ROUTE_SRC.indexOf('const consumed = await consumePreparedActivity(');
    expect(consumeCallIdx).toBeGreaterThan(branchGuardIdx);
    expect(consumeCallIdx).toBeLessThan(generateCallIdx);
  });
});

// ============================================================
// 19-24, 29 -- RESULTS single authority (source audit)
// ============================================================
describe('19-24/29 -- Results UI: canonicalResults is the sole next-step authority for v1 attempts', () => {
  it('isV1Result is derived purely from canonicalResultsStatus !== NOT_V1 -- never from score/quizMode', () => {
    const idx = QUIZ_PAGE_SRC.indexOf('const isV1Result = ');
    expect(idx).toBeGreaterThan(-1);
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 100);
    expect(slice).toMatch(/results\.canonicalResultsStatus !== 'NOT_V1'/);
  });

  it("20/21/22. the legacy messageText next-step line is gated on `!isV1Result` -- suppressed for OK, contract-violation, AND unavailable statuses alike", () => {
    const idx = QUIZ_PAGE_SRC.indexOf('{!isV1Result && (');
    expect(idx).toBeGreaterThan(-1);
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 200);
    expect(slice).toMatch(/\{messageText\}/);
  });

  it('23. a legacy (non-v1) attempt still renders messageText -- isV1Result is false whenever canonicalResultsStatus is the default NOT_V1', () => {
    // NOT_V1 is the route's own default value (canonicalResultsStatus
    // starts 'NOT_V1' and is only ever reassigned inside the v1Marker
    // branch) -- confirmed via source audit of the route's own default.
    expect(ROUTE_SRC).toMatch(/let canonicalResultsStatus: 'NOT_V1' \| 'OK' \| 'CANONICAL_RESULTS_UNAVAILABLE' \| 'V1_ACTIVITY_CONTRACT_VIOLATION' = 'NOT_V1';/);
  });

  it('24. the factual score/correct/incorrect outcome card is NOT gated on isV1Result -- it renders unconditionally, before any v1-specific block', () => {
    const scoreIdx = QUIZ_PAGE_SRC.indexOf('{results.results.score}%');
    const firstV1BlockIdx = QUIZ_PAGE_SRC.indexOf("results.canonicalResultsStatus === 'OK' && results.canonicalResults && (");
    expect(scoreIdx).toBeGreaterThan(-1);
    // the score card renders before any v1-specific block in the JSX...
    expect(scoreIdx).toBeLessThan(firstV1BlockIdx);
    // ...and is not itself wrapped in an `isV1Result`/`!isV1Result`
    // conditional: the ONLY JSX usage of `isV1Result` is the
    // `!isV1Result` guard around `messageText`, which comes AFTER (not
    // around) the score card.
    const messageTextGuardIdx = QUIZ_PAGE_SRC.indexOf('{!isV1Result && (');
    expect(messageTextGuardIdx).toBeGreaterThan(scoreIdx);
  });

  it('22. a CANONICAL_RESULTS_UNAVAILABLE status renders a distinct neutral block (previously unhandled in the UI) -- never legacy progression copy, never an invented stage', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("results.canonicalResultsStatus === 'CANONICAL_RESULTS_UNAVAILABLE'");
    expect(idx).toBeGreaterThan(-1);
    const slice = QUIZ_PAGE_SRC.slice(idx, idx + 280);
    expect(slice).toMatch(/quiz\.canonicalResultsUnavailable/);
    expect(slice).not.toMatch(/canonicalNextPractice|canonicalNextProve|canonicalNextConsolidated/);
  });

  it('29. the canonicalResults-driven block never reads results.results.score/correctCount anywhere in its own render -- next step comes only from stage/actionState/nextEligibleAt', () => {
    const idx = QUIZ_PAGE_SRC.indexOf("results.canonicalResultsStatus === 'OK' && results.canonicalResults && (");
    const endIdx = QUIZ_PAGE_SRC.indexOf("results.canonicalResultsStatus === 'V1_ACTIVITY_CONTRACT_VIOLATION'", idx);
    const block = QUIZ_PAGE_SRC.slice(idx, endIdx);
    expect(block).not.toMatch(/results\.results\.score|results\.results\.correctCount/);
    expect(block).toMatch(/results\.canonicalResults\.stage/);
    expect(block).toMatch(/results\.canonicalResults\.actionState/);
  });
});

// ============================================================
// 25-28 -- canonical stage copy (already-existing R6 wiring, re-confirmed unbroken by this phase)
// ============================================================
describe('25-28 -- canonical stage copy is unbroken by the single-authority fix', () => {
  it('25. PRACTICE stage copy still wired', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/results\.canonicalResults\.stage === 'PRACTICE'\s*\n\s*\? at\['quiz\.canonicalNextPractice'\]/);
  });
  it('26. PROVE stage copy still wired', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/results\.canonicalResults\.stage === 'PROVE'\s*\n\s*\? at\['quiz\.canonicalNextProve'\]/);
  });
  it('27. RETAIN/WAITING copy still wired (reuses the existing conceptMission retention-waiting keys)', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/results\.canonicalResults\.actionState === 'WAITING'/);
    expect(QUIZ_PAGE_SRC).toMatch(/conceptMission\.noActionRetentionWaitingBody/);
  });
  it('28. CONSOLIDATED stage copy still wired', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/results\.canonicalResults\.stage === 'CONSOLIDATED'\s*\n\s*\? at\['quiz\.canonicalNextConsolidated'\]/);
  });
});

// ============================================================
// Firewall
// ============================================================
describe('Firewall -- no touch to the frozen pedagogical engine, migration recognitions, AI provider selection, cache, or Retention/Transfer/Learn Check', () => {
  it('no new import from @/lib/pedagogical-engine, @/lib/ai/adapters, or @/lib/pedagogical-migration in the route or the new novelty module', () => {
    expect(ROUTE_SRC).not.toMatch(/from '@\/lib\/pedagogical-engine'/);
    expect(ROUTE_SRC).not.toMatch(/@\/lib\/ai\/adapters/);
    expect(ROUTE_SRC).not.toMatch(/from '@\/lib\/pedagogical-migration'/);
    expect(NOVELTY_SRC).not.toMatch(/@\/lib\/ai|pedagogical-engine|pedagogical-migration/);
  });

  it('retention_check/transfer/diagnostic_check generation call sites are untouched by novelty logic', () => {
    expect(ROUTE_SRC).not.toMatch(/retention_check[\s\S]{0,300}filterExactDuplicates/);
  });
});
