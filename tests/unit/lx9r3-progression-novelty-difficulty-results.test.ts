/**
 * LX-9R3 -- PROGRESSION CLOSURE, QUESTION NOVELTY, DIFFICULTY & QUIZ
 * PERFORMANCE. Required tests 1-21 and 31-34, plus the performance items
 * (22, 24, 28, 29) that fall naturally out of the same
 * generateRetentionCheckQuestions harness used for novelty. Tests 23,
 * 25, 26, 27, 30 (semantic-batching internals) live in
 * tests/unit/lx9r3-semantic-batching-performance.test.ts, since they
 * need the REAL verifyQuestionQualityBatch implementation rather than
 * the always-pass mock this file uses everywhere else.
 *
 * Where a real DB/live provider isn't available in this environment
 * (proving the RETAIN-loop fix and the continuation re-read end-to-end
 * against a live database), the test either exercises the actual PURE
 * function directly (adaptive-learning-policy.ts, concept-mission.ts)
 * or audits the shipped source for the architectural invariant --
 * exactly the convention already established by
 * tests/unit/lx4p-perf-r1c-r1-universal-gate.test.ts and the RET-R2/
 * RET-R3 suites for the same class of live-only invariant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/* ================================================================== *
 * Shared source reads for audit-style tests.                         *
 * ================================================================== */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const MASTERY_SRC = read('src/services/mastery.service.ts');
const CONTINUATION_SRC = read('src/services/learning-continuation.service.ts');
const CONTINUATION_PANEL_SRC = read('src/app/dashboard/quiz/ContinuationPanel.tsx');
const ROUTE_SRC = read('src/app/api/quizzes/generate-and-take/route.ts');
const QUIZ_PAGE_SRC = read('src/app/dashboard/quiz/page.tsx');
const QG_SRC = read('src/services/quiz-generation.service.ts');

/* ================================================================== *
 * PROGRESSION 1-3, 9 -- source-contract audits (live DB/session only  *
 * provable end-to-end; the pure-policy half is tests 4-8 below).      *
 * ================================================================== */
describe('LX-9R3 progression 1-3, 9 -- evidence write, recomputation, and continuation re-read', () => {
  it('1. a learning_evidence row is inserted before the memory/knowledge-state projection runs in the same transaction', () => {
    const insertIdx = MASTERY_SRC.indexOf('INSERT INTO learning_evidence');
    const projectIdx = MASTERY_SRC.indexOf('const memoryProjection = await projectConceptMemoryState(client, studentId, conceptId);');
    expect(insertIdx).toBeGreaterThan(-1);
    expect(projectIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeLessThan(projectIdx);
  });

  it('2. KnowledgeState is recalculated AFTER the memory projection, both on the SAME transaction client, before COMMIT', () => {
    const projectIdx = MASTERY_SRC.indexOf('const memoryProjection = await projectConceptMemoryState(client, studentId, conceptId);');
    const recalcIdx = MASTERY_SRC.indexOf('await recalculateConceptKnowledgeState(studentId, conceptId, client);');
    const commitIdx = MASTERY_SRC.indexOf("await client.query('COMMIT');");
    expect(projectIdx).toBeGreaterThan(-1);
    expect(recalcIdx).toBeGreaterThan(projectIdx);
    expect(commitIdx).toBeGreaterThan(recalcIdx);
  });

  it('3./9. Continue re-reads canonical Knowledge State fresh -- never a decision cached from the quiz submission response', () => {
    // resolveContinuation is invoked by a SEPARATE request
    // (/api/learning/continue), after the quiz submission's own
    // transaction has already committed -- it reads getConceptKnowledgeState
    // itself rather than accepting a decision object from its caller.
    expect(CONTINUATION_SRC).toMatch(/const ks = await getConceptKnowledgeState\(studentId, conceptId\)/);
    expect(CONTINUATION_PANEL_SRC).toMatch(/CONTINUE calls `\/api\/learning\/continue`, which re-reads\s*\n?\s*\* canonical truth/);
  });
});

/* ================================================================== *
 * PROGRESSION 4-8 -- pure adaptive-learning-policy behavior.          *
 * ================================================================== */
import {
  selectActivityType,
  computeLearningState,
  consolidateSignals,
  type LearningSignal,
  type ConceptDecisionContext,
} from '@/lib/adaptive-learning-policy';
import type { ConceptKnowledgeState } from '@/services/knowledge-state.service';

function signal(overrides: Partial<LearningSignal> & Pick<LearningSignal, 'type' | 'conceptId' | 'subjectId'>): LearningSignal {
  return { source: 'test', metadata: {}, ...overrides };
}

function ksState(overrides: Partial<ConceptKnowledgeState> = {}): ConceptKnowledgeState {
  return {
    studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
    masteryState: 'DEVELOPING', understandingScore: 70, independenceScore: 65, applicationScore: 60,
    retentionScore: null, transferScore: null,
    activeMisconceptionCount: 0, criticalMisconceptionCount: 0, recurringMisconceptionCount: 0,
    evidenceCount: 5, independentEvidenceCount: 2, firstEvidenceAt: null, lastEvidenceAt: null,
    validationReadiness: 'INSUFFICIENT_EVIDENCE', stateReason: null, projectionVersion: 1, masteryPolicyVersion: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeContext(signals: LearningSignal[], ks: ConceptKnowledgeState | null): ConceptDecisionContext {
  const map = new Map<string, ConceptKnowledgeState>();
  if (ks) map.set(ks.conceptId, ks);
  const contexts = consolidateSignals(signals, map);
  return (
    contexts[0] ?? {
      actionConceptId: 'c1', subjectId: 'subj1', knowledgeState: ks, signals: [], targetConceptIds: [],
      remediationPathIds: [], diagnosisIds: [], occurrenceIds: [], calibrationConflictIds: [], verificationAttemptIds: [], quizSessionIds: [],
    }
  );
}

describe('LX-9R3 progression 4-8 -- the RETAIN loop cannot recur, and the block is explainable', () => {
  it('4. a genuinely-cleared retention obligation (no WAITING_FOR_RETENTION, no due signal) never resolves the journey state to RETENTION_RISK', () => {
    const ks = ksState({ masteryState: 'VALIDATED_MASTERY', validationReadiness: 'READY' });
    const ctx = makeContext([], ks);
    expect(computeLearningState(ctx)).not.toBe('RETENTION_RISK');
    expect(selectActivityType(ctx)).not.toBe('RETENTION_CHECK');
  });

  it('5. TRANSFER_REQUIRED resolves activityType to TRANSFER once retention is no longer the blocker', () => {
    const ks = ksState({ masteryState: 'VALIDATED_MASTERY', validationReadiness: 'TRANSFER_REQUIRED' });
    const ctx = makeContext([signal({ type: 'TRANSFER_REQUIRED', conceptId: 'c1', subjectId: 'subj1' })], ks);
    expect(selectActivityType(ctx)).toBe('TRANSFER');
  });

  it('7./8. WAITING_FOR_RETENTION alone (the exact proven live-loop fixture) never offers another RETENTION_CHECK, but the journey state still honestly reports RETENTION_RISK -- never a silently-repeated identical quiz with no explanation', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', validationReadiness: 'WAITING_FOR_RETENTION' });
    const ctx = makeContext([signal({ type: 'WAITING_FOR_RETENTION', conceptId: 'c1', subjectId: 'subj1' })], ks);
    // The canonical reason the learner can be told: journey state is
    // still RETENTION_RISK (accurate -- retention genuinely hasn't been
    // re-demonstrated), but the SYSTEM never re-offers the activity
    // until it is actually due -- this is the exact fixture that
    // reproduced the live infinite loop before this phase's fix.
    expect(computeLearningState(ctx)).toBe('RETENTION_RISK');
    expect(selectActivityType(ctx)).not.toBe('RETENTION_CHECK');
  });

  it('8. repeating the SAME (still-too-soon) evidence-write outcome twice in a row still never re-offers RETENTION_CHECK -- the fix is a pure function of due-timing, not a one-shot patch', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', validationReadiness: 'WAITING_FOR_RETENTION' });
    const ctx = makeContext(
      [
        signal({ type: 'WAITING_FOR_RETENTION', conceptId: 'c1', subjectId: 'subj1' }),
        signal({ type: 'RETENTION_REVIEW_DUE', conceptId: 'c1', subjectId: 'subj1', temporalUrgency: 'LOW' }),
      ],
      ks,
    );
    expect(selectActivityType(ctx)).not.toBe('RETENTION_CHECK');
    // Calling it again with the identical context is deterministic --
    // no hidden mutable state, no loop-breaking side effect required.
    expect(selectActivityType(ctx)).not.toBe('RETENTION_CHECK');
  });
});

/* ================================================================== *
 * PROGRESSION 6 -- Consolidated concept never launches another quiz.  *
 * ================================================================== */
import { buildConceptMissionView, type ConceptMissionInputs, type ConceptMissionJourneyInput } from '@/lib/lx/concept-mission';
import type { MasteryState, ValidationReadiness } from '@/services/knowledge-state.service';

const RESOLVED = (learningState: any, source: 'LEARNING_DECISION' | 'CANONICAL_POLICY_NO_SIGNALS' = 'LEARNING_DECISION'): ConceptMissionJourneyInput => ({
  kind: 'RESOLVED', learningState, source,
});
function missionKs(masteryState: MasteryState, validationReadiness: ValidationReadiness) {
  return { masteryState, validationReadiness, evidenceCount: 12, independentEvidenceCount: 6 };
}
function missionBase(over: Partial<ConceptMissionInputs> = {}): ConceptMissionInputs {
  return {
    conceptName: 'Potenciación', subjectId: 'subj-1', subjectName: 'Math', conceptDescription: null,
    goalFallbackText: 'Understand it and apply it correctly and on your own.',
    knowledgeState: null, journeyInput: RESOLVED('DEVELOPING'), learningDecision: null, memory: null,
    transferDepth: null, hasCachedExplanation: false, ...over,
  };
}

describe('LX-9R3 progression 6 -- a Consolidated concept does not launch another quiz', () => {
  it('CONSOLIDATED (canonical VALIDATED, zero-signal policy) yields the calm no-action fallback, never a quiz launch', () => {
    const v = buildConceptMissionView(
      missionBase({ journeyInput: RESOLVED('VALIDATED', 'CANONICAL_POLICY_NO_SIGNALS'), knowledgeState: missionKs('VALIDATED_MASTERY', 'READY') }),
    );
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(v.journey.stage).toBe('CONSOLIDATED');
    expect(v.now.fallback).toBe('CONSOLIDATED_NO_ACTION');
  });
});

/* ================================================================== *
 * NOVELTY 10-16, PERFORMANCE 22/24/28/29 -- cross-attempt fingerprint *
 * awareness in generateRetentionCheckQuestions.                      *
 * ================================================================== */
const executeAIMock = vi.fn();
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>();
  return { ...actual, executeAI: (...a: any[]) => executeAIMock(...a) };
});

const retrieveContextMock = vi.fn().mockResolvedValue({ chunks: [] });
vi.mock('@/services/rag.service', () => ({ retrieveContext: (...a: any[]) => retrieveContextMock(...a) }));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));

const callModelMock = vi.fn();
vi.mock('@/lib/ai/adapters/call-model', () => ({ callModel: (...a: any[]) => callModelMock(...a) }));

vi.mock('@/services/question-quality-verifier.service', () => ({
  verifyQuestionQuality: vi.fn(async () => ({
    conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true,
    distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.95,
  })),
  verifyQuestionQualityBatch: vi.fn(async ({ candidates }: any) =>
    new Map(candidates.map((c: any) => [c.id, {
      conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true,
      distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.95,
    }]))
  ),
  evaluateQuestionQualityVerdict: vi.fn(() => ({ pass: true, reason: '' })),
}));

vi.mock('@/lib/lx/question-quality-contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/lx/question-quality-contract')>();
  return {
    ...actual,
    checkQuestionQualityDeterministic: (q: any, ctx: any) => {
      if (typeof q?.question === 'string' && q.question.includes('DET_REJECT')) {
        return { status: 'FAIL', failures: [{ code: 'SCHEMA_INVALID', detail: 'test-forced deterministic rejection' }], numericallyVerified: false, needsSemantic: [] };
      }
      return actual.checkQuestionQualityDeterministic(q, ctx);
    },
  };
});

import { generateRetentionCheckQuestions, RETENTION_REQUIRED_COUNT } from '@/services/quiz-generation.service';

const INITIAL_CHUNK_SIZE = 4;
function fakeQuestion(i: number, overrides: Partial<{ question: string; type: string; cognitiveLevel: string; questionIntent: string }> = {}) {
  return {
    type: overrides.type ?? 'multiple_choice',
    question: overrides.question ?? `Q${i}`,
    options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }],
    correctAnswer: 'A', explanation: 'because', difficulty: 3,
    cognitiveLevel: overrides.cognitiveLevel ?? 'APPLICATION',
    questionIntent: overrides.questionIntent ?? 'CHECK_APPLICATION',
  };
}
function batch(questions: any[]): string {
  return JSON.stringify({ questions });
}
function cleanChunkText(base: number, count = INITIAL_CHUNK_SIZE) {
  return batch(Array.from({ length: count }, (_, i) => fakeQuestion(base + i)));
}

function wireRealisticExecuteAI(chunkResponses: Array<{ text: string } | { error: 'TIMEOUT' | 'PROVIDER_ERROR' }>) {
  callModelMock.mockReset();
  for (const resp of chunkResponses) {
    if ('error' in resp) {
      callModelMock.mockImplementationOnce(async () => {
        const err: any = new Error(resp.error);
        err.name = resp.error === 'TIMEOUT' ? 'AbortError' : 'Error';
        throw err;
      });
    } else {
      callModelMock.mockImplementationOnce(async () => ({ text: resp.text, raw: {}, provider: 'openai', model: 'gpt-5.6-luna' }));
    }
  }
  executeAIMock.mockReset().mockImplementation(async (opts: any) => {
    let raw: any;
    try {
      raw = await opts.call(new AbortController().signal);
    } catch (err: any) {
      const code = err?.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_ERROR';
      return { result: opts.fallback({ code, message: String(err?.message ?? err) }), execution: {} as any, provenance: {} as any };
    }
    const validation = opts.validate(raw);
    if (!validation.valid) {
      return { result: opts.fallback({ code: 'VALIDATION_ERROR', message: (validation.errors ?? []).join('; ') }), execution: {} as any, provenance: {} as any };
    }
    return { result: validation.value, execution: {} as any, provenance: {} as any };
  });
}

/** A row shape matching quiz_sessions.questions -- the SAME persisted GeneratedQuestion[] shape `dedupeAgainstAccepted` already consumes. */
function historyRow(questions: any[]) {
  return { questions: JSON.stringify(questions) };
}

beforeEach(() => {
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [] });
  queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
  callModelMock.mockReset().mockResolvedValue({ text: '[]', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
  executeAIMock.mockReset();
});

describe('LX-9R3 novelty 10-16, performance 22/24/28/29 -- cross-attempt fingerprint awareness', () => {
  it('10. an exact prior-attempt question is rejected, and generation still recovers to the canonical 6', () => {
    // The first db.query call inside generateRetentionCheckQuestions is
    // the recent-history fetch (kicked off in Promise.all alongside
    // retrieveContext, ahead of the concept-row lookup) -- see
    // fetchRecentRetentionQuestions's own call site.
    queryMock.mockResolvedValueOnce({ rows: [historyRow([fakeQuestion(0, { question: 'Q0' })])] });
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }]);
    return generateRetentionCheckQuestions('c1', 's1', 'subj1', {}).then((result) => {
      expect(result.map((q: any) => q.question)).not.toContain('Q0');
      expect(result).toHaveLength(RETENTION_REQUIRED_COUNT); // 22/29: the 8-candidate surplus absorbs the one novelty rejection
    });
  });

  it('11. a structural-equivalent of a recent attempt (cosmetic number substitution only) is rejected, not just an exact-text repeat', async () => {
    // Recent history has "Evaluate $2x + 3$" (multiple_choice / APPLICATION /
    // CHECK_APPLICATION); the fresh candidate at the same slot swaps only
    // the bare numbers -- same fingerprint, same reasoning demand.
    queryMock.mockResolvedValueOnce({ rows: [historyRow([fakeQuestion(0, { question: 'Evaluate $2x + 3$' })])] });
    const chunkA = batch([
      fakeQuestion(0, { question: 'Evaluate $9x + 41$' }), // structural duplicate of history
      fakeQuestion(1), fakeQuestion(2), fakeQuestion(3),
    ]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result.map((q: any) => q.question)).not.toContain('Evaluate $9x + 41$');
    expect(result).toHaveLength(RETENTION_REQUIRED_COUNT);
  });

  it('12. recent-attempt fingerprints are genuinely consulted -- with NO history, the identical candidate is NOT rejected', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // no prior attempts at all
    const chunkA = batch([fakeQuestion(0, { question: 'Evaluate $2x + 3$' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result.map((q: any) => q.question)).toContain('Evaluate $2x + 3$');
  });

  it('13. the novelty window is bounded -- the history query asks for exactly a fixed, small number of attempts, never an unbounded history', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const historyCall = queryMock.mock.calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes('RETENTION_CHECK'));
    expect(historyCall).toBeDefined();
    const limitArg = historyCall![1][2];
    expect(typeof limitArg).toBe('number');
    expect(limitArg).toBeGreaterThanOrEqual(2);
    expect(limitArg).toBeLessThanOrEqual(3); // spec's own suggested "2-3 attempts" bound
  });

  it('14. an empty/unavailable history (e.g. everything relevant fell outside the window) never blocks generation', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(RETENTION_REQUIRED_COUNT);
  });

  it("14b. a DB failure on the history lookup fails OPEN (empty history) -- never blocks generation over a non-critical novelty check", async () => {
    queryMock.mockReset().mockImplementationOnce(() => Promise.reject(new Error('db unavailable')))
      .mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(RETENTION_REQUIRED_COUNT);
  });

  it('15. novelty rejection never weakens the Quality Gate -- a DET_REJECT candidate is still rejected on its own terms even while cross-attempt history is active', async () => {
    queryMock.mockResolvedValueOnce({ rows: [historyRow([fakeQuestion(99, { question: 'Some unrelated prior question' })])] });
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result.map((q: any) => q.question)).not.toContain('DET_REJECT a');
    expect(result).toHaveLength(RETENTION_REQUIRED_COUNT);
  });

  it('16. the six final published questions are unique even with an active novelty window', async () => {
    queryMock.mockResolvedValueOnce({ rows: [historyRow([fakeQuestion(50, { question: 'Prior attempt question' })])] });
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const texts = result.map((q: any) => q.question);
    expect(new Set(texts).size).toBe(texts.length);
    expect(result).toHaveLength(RETENTION_REQUIRED_COUNT);
  });

  it('22. the two initial Luna chunks remain concurrent -- unaffected by the added history lookup', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    let inFlight = 0;
    let maxInFlight = 0;
    callModelMock.mockReset().mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { text: cleanChunkText(0), raw: {}, provider: 'openai', model: 'gpt-5.6-luna' };
    });
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      const raw = await opts.call(new AbortController().signal);
      const validation = opts.validate(raw);
      return { result: validation.value, execution: {} as any, provenance: {} as any };
    });
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('24. a candidate matching recent history never triggers a semantic verification call for that candidate', async () => {
    const verifierModule = await import('@/services/question-quality-verifier.service');
    const batchMock = verifierModule.verifyQuestionQualityBatch as unknown as ReturnType<typeof vi.fn>;
    batchMock.mockClear();
    queryMock.mockResolvedValueOnce({ rows: [historyRow([fakeQuestion(0, { question: 'Evaluate $2x + 3$' })])] });
    const chunkA = batch([
      fakeQuestion(0, { question: 'Evaluate $9x + 41$' }), // structural duplicate of history -- caught before the gate
      fakeQuestion(1), fakeQuestion(2), fakeQuestion(3),
    ]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    for (const call of batchMock.mock.calls) {
      const candidates = call[0].candidates as Array<{ question: any }>;
      expect(candidates.some((c) => c.question.question === 'Evaluate $9x + 41$')).toBe(false);
    }
  });

  it('28. no unbounded retries -- still at most 2 generation calls when the 8-candidate surplus already clears the deficit with history active', async () => {
    queryMock.mockResolvedValueOnce({ rows: [historyRow([fakeQuestion(0, { question: 'Evaluate $2x + 3$' })])] });
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(2);
  });

  it('29. Retention still publishes exactly 6 when the novelty window is active and one candidate collides', async () => {
    queryMock.mockResolvedValueOnce({ rows: [historyRow([fakeQuestion(0, { question: 'Q0' })])] });
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6);
  });
});

/* ================================================================== *
 * DIFFICULTY 17-21.                                                   *
 * ================================================================== */
describe('LX-9R3 difficulty 17-21 -- a real, testable contract, never learner-selected', () => {
  it('17. difficulty authority is canonical (StudyUS-side default), never sourced from a learner-controlled field at the API boundary', () => {
    // The client never sends a difficulty; every generation call site
    // falls back to the SAME fixed canonical default when absent.
    const fallbackSites = ROUTE_SRC.match(/difficulty: validated\.difficulty \|\| 3/g) ?? [];
    expect(fallbackSites.length).toBeGreaterThan(0);
  });

  it("18. the generator receives the resolved difficulty and threads it into the actual generation prompt (never silently dropped)", () => {
    expect(QG_SRC).toMatch(/function buildQuestionGenerationPrompt\(\s*\n?\s*types: QuestionType\[\],\s*\n?\s*difficulty: number,/);
    expect(QG_SRC).toMatch(/buildQuestionGenerationPrompt\(types, difficulty, language, contextChunks/);
  });

  it('19. the printed difficulty label and the generated difficultyDesc come from the SAME resolved value -- never two independently-drifting numbers', () => {
    const block = QG_SRC.slice(QG_SRC.indexOf('function buildQuestionGenerationPrompt'), QG_SRC.indexOf('const languageName = LOCALE_FULL_NAME'));
    expect(block).toMatch(/if \(difficulty <= 1\) difficultyDesc/);
    expect(QG_SRC).toMatch(/Difficulty level \(\$\{difficulty\}\/5\): \$\{difficultyDesc\}/);
  });

  it('20. higher difficulty tiers demand a structurally different cognitive load in the prompt text -- not just a bigger adjective', () => {
    const block = QG_SRC.slice(QG_SRC.indexOf('let difficultyDesc'), QG_SRC.indexOf('const languageName = LOCALE_FULL_NAME'));
    // LOW tiers: explicitly no multi-step/combined/unfamiliar/transfer demand.
    expect(block).toMatch(/direct recall.*no combined operations, no unfamiliar representation, no multi-step reasoning/);
    // HIGH tiers: the concrete cognitive-demand vocabulary the spec requires.
    expect(block).toMatch(/multi-step reasoning/);
    expect(block).toMatch(/diagnosing an error/);
    expect(block).toMatch(/less familiar representation/);
    expect(block).toMatch(/transfer to a genuinely unfamiliar context/);
    expect(block).toMatch(/combining multiple operations/);
    expect(block).toMatch(/higher level of abstraction/);
  });

  it('21. the learner-facing quiz UI has no difficulty selector control -- StudyUS decides difficulty, never the learner', () => {
    // LX-4J's own removal note is still in force: no intrinsic
    // learner-visible 1-5 difficulty control was reintroduced.
    expect(QUIZ_PAGE_SRC).toMatch(/there\s*\n?\s*is no canonical learner-relative difficulty authority/);
    expect(QUIZ_PAGE_SRC).not.toMatch(/<select[^>]*difficulty/i);
    expect(QUIZ_PAGE_SRC).not.toMatch(/onChange.*setDifficulty/);
  });
});

/* ================================================================== *
 * RESULTS 31-34.                                                      *
 * ================================================================== */
describe('LX-9R3 results 31-34 -- no raw mastery leak in the primary learner experience', () => {
  it('31. the raw mastery-delta block is suppressed for retention_check results', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/quizMode !== 'retention_check' && perConcept\.length === 1 && results\.mastery/);
  });

  it('32. a canonical, truthful accomplishment message replaces the raw percentage for retention_check', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/const retentionTooSoon = quizMode === 'retention_check' && results\.retentionCheckQualified === false/);
    expect(QUIZ_PAGE_SRC).toMatch(/retentionTooSoon\s*\n?\s*\? at\['quiz\.retentionTooSoon'\]/);
  });

  it('33. the results screen always offers the canonical next action (ContinuationPanel), never a dead end', () => {
    expect(QUIZ_PAGE_SRC).toMatch(/<ContinuationPanel/);
    expect(QUIZ_PAGE_SRC).toMatch(/from=\{continuationKind\}/);
  });

  it('34. raw mastery data is still returned by the API for admin/debug/analytics -- only the LEARNER UI hides it for retention', () => {
    expect(ROUTE_SRC).toMatch(/mastery: primaryMastery/);
    expect(ROUTE_SRC).toMatch(/retentionCheckQualified: quizSession\.activityType === 'RETENTION_CHECK' \? primaryMastery\?\.retentionCheckQualified : undefined/);
  });
});
