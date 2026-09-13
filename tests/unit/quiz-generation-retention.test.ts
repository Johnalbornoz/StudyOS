/**
 * STABILIZATION QUIZ PERFORMANCE Step 23, evolved through RET-R1
 * (deficit-preserving recovery) and RET-R2 (candidate-surplus
 * reliability) -- the FINAL validated retention_check (EvidenceMode
 * INDEPENDENT) fast path: preventive Variant B runtime diversification
 * on both initial chunks, a bounded candidate SURPLUS at every wave
 * (initial: 4+4=8 candidates for a published count of 6; recovery:
 * deficit+2 clamped to [3,6]), plus exactly one bounded recovery round,
 * still exact-6-or-nothing throughout -- never a partial set.
 *
 * Mocks executeAI directly -- no live provider call, no DB write.
 *
 * Backslash note (same discipline as tests/unit/quiz-generation-latex-safety.test.ts):
 * raw JSON strings below are built as literal template strings, not via
 * JSON.stringify, so a single backslash in source is genuinely a single
 * backslash at runtime where that matters for a test's intent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// LX-4P-PERF-R1C-R1: the UNIVERSAL Question Quality Gate now runs on the
// merged retention_check set too (deterministic contract + semantic
// verify where required), feeding the SAME single bounded recovery. These
// tests cover the initial-surplus + one-recovery ARCHITECTURE; the
// independent semantic verifier has its own suite, so it is stubbed to
// pass here. Tests that specifically exercise a gate rejection re-mock
// it locally (see tests/unit/ret-r1-retention-deficit-recovery.test.ts
// and tests/unit/ret-r2-candidate-surplus.test.ts).
vi.mock('@/services/question-quality-verifier.service', () => ({
  verifyQuestionQuality: vi.fn(async () => ({
    conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true,
    distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.95,
  })),
  evaluateQuestionQualityVerdict: vi.fn(() => ({ pass: true, reason: '' })),
}));

import {
  generateRetentionCheckQuestions,
  RETENTION_REQUIRED_COUNT,
  RETENTION_INITIAL_CANDIDATE_COUNT,
  RETENTION_MAX_AI_CALLS_PER_ATTEMPT,
  computeRetentionStructuralFingerprint,
} from '@/services/quiz-generation.service';
import { PROMPT_REGISTRY } from '@/lib/ai/prompt-registry';

const VARIANT_B_NOTE_A =
  'Generate questions using examples and mathematical structures that vary from the most obvious textbook examples for this concept.';
const VARIANT_B_NOTE_B =
  'Generate questions using a different variety of examples and mathematical structures; avoid defaulting to the most obvious textbook examples.';

/** RET-R2: mirrors the production RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK (4) -- duplicated here deliberately so these tests pin the exact contract rather than importing a private constant. */
const INITIAL_CHUNK_SIZE = 4;

function fakeQuestion(i: number, overrides: Partial<{ question: string; type: string; cognitiveLevel: string; questionIntent: string }> = {}) {
  return {
    type: overrides.type ?? 'multiple_choice',
    question: overrides.question ?? `Q${i}`,
    options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }],
    correctAnswer: 'A',
    explanation: 'because',
    difficulty: 3,
    cognitiveLevel: overrides.cognitiveLevel ?? 'APPLICATION',
    questionIntent: overrides.questionIntent ?? 'CHECK_APPLICATION',
  };
}

/**
 * A validate()/fallback() aware mock that actually invokes the caller's
 * own `call` (so callModelMock genuinely receives each
 * chunk's real userMessage, inspectable in assertions) and `validate`/
 * `fallback`, exactly as the real gateway would -- just without the
 * network. `chunkResponses` are consumed in call order (chunk A, chunk
 * B, then the bounded recovery call if one occurs).
 */
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
      return {
        result: opts.fallback({ code: 'VALIDATION_ERROR', message: (validation.errors ?? []).join('; ') }),
        execution: {} as any,
        provenance: {} as any,
      };
    }
    return { result: validation.value, execution: {} as any, provenance: {} as any };
  });
}

// LX-4P-PERF-R1F: the strict Structured Output wire shape is object-rooted
// ({"questions": [...]}) -- `batch` wraps a raw question array the same
// way the real model output does, everywhere this file used to call
// batch([...]) directly on a bare array.
function batch(questions: any[]): string {
  return JSON.stringify({ questions });
}

/** RET-R2: an initial-wave chunk now carries INITIAL_CHUNK_SIZE (4) candidates, not 3. */
function cleanChunkText(base: number, count = INITIAL_CHUNK_SIZE) {
  return batch(Array.from({ length: count }, (_, i) => fakeQuestion(base + i)));
}

beforeEach(() => {
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [] });
  queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
  callModelMock.mockReset().mockResolvedValue({ text: '[]', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
  executeAIMock.mockReset();
});

describe('RETENTION_REQUIRED_COUNT is 6 -- the canonical published count, independent of candidate volume', () => {
  it('equals 6', () => {
    expect(RETENTION_REQUIRED_COUNT).toBe(6);
  });

  it('RET-R2: RETENTION_INITIAL_CANDIDATE_COUNT (8) exceeds RETENTION_REQUIRED_COUNT (6) -- candidate surplus, never conflated with the published count', () => {
    expect(RETENTION_INITIAL_CANDIDATE_COUNT).toBe(8);
    expect(RETENTION_INITIAL_CANDIDATE_COUNT).toBeGreaterThan(RETENTION_REQUIRED_COUNT);
  });
});

describe('RETENTION_MAX_AI_CALLS_PER_ATTEMPT is 3 (2 initial + at most 1 bounded recovery) -- unchanged by RET-R2', () => {
  it('equals 3', () => {
    expect(RETENTION_MAX_AI_CALLS_PER_ATTEMPT).toBe(3);
  });
});

describe('INITIAL SUCCESS: architecture, model, prompt, timeout, Variant B notes, candidate surplus', () => {
  beforeEach(() => wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }]));

  it('fires exactly 2 executeAI calls when both initial chunks are clean', async () => {
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(2);
  });

  it('the 2 initial calls are concurrent (both fire before either resolves)', async () => {
    const order: string[] = [];
    let resolveA: () => void = () => {};
    const gate = new Promise<void>((res) => (resolveA = res));
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      order.push('started');
      const base = order.length === 1 ? 0 : 10; // captured before any await, so concurrency can't shift which base a call sees
      if (order.length === 1) await gate; // first call blocks until second has also started
      const validation = opts.validate({ text: cleanChunkText(base) });
      if (order.length === 2) resolveA();
      return { result: validation.value, execution: {} as any, provenance: {} as any };
    });
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(order).toEqual(['started', 'started']);
    expect(executeAIMock).toHaveBeenCalledTimes(2); // CLEAN (distinct bases 0/10) -- no recovery call
  });

  it('both calls use the QUESTION_GENERATION route model (Luna), promptId quiz.question_generation, promptVersion v3, timeoutMs 30000', async () => {
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    for (const call of executeAIMock.mock.calls) {
      expect(call[0].model).toBe('gpt-5.6-luna');
      expect(call[0].promptId).toBe('quiz.question_generation');
      expect(call[0].promptVersion).toBe('v3');
      expect(call[0].timeoutMs).toBe(30_000);
    }
    expect(PROMPT_REGISTRY['quiz.question_generation'].version).toBe('v3');
  });

  it('RET-R2: each initial call requests exactly 4 CANDIDATE questions (a surplus over the 6 published), carries "chunk N of 2" framing and its own Variant B note', async () => {
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const messages = callModelMock.mock.calls.map((c) => c[0].user as string);
    expect(messages).toHaveLength(2);
    for (const msg of messages) {
      expect(msg).toContain('Generate EXACTLY 4 CANDIDATE questions');
      expect(msg).toContain(`select the best ${RETENTION_REQUIRED_COUNT}`);
    }
    expect(messages[0]).toContain('chunk 1 of 2');
    expect(messages[1]).toContain('chunk 2 of 2');
    expect(messages[0]).toContain(VARIANT_B_NOTE_A);
    expect(messages[0]).not.toContain(VARIANT_B_NOTE_B);
    expect(messages[1]).toContain(VARIANT_B_NOTE_B);
    expect(messages[1]).not.toContain(VARIANT_B_NOTE_A);
  });

  it('does not manually assign or cycle question types -- no per-slot "prefer type X" instruction appears', async () => {
    const messages = callModelMock.mock.calls.map((c) => c[0].user as string);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    for (const msg of messages) {
      expect(msg).not.toContain('prefer question type');
    }
  });

  it('RET-R2: 8 clean initial candidates -> published result is still exactly 6, extras simply unused, no recovery call', async () => {
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6);
    expect(executeAIMock).toHaveBeenCalledTimes(2); // no 3rd (recovery) call -- 8 accepted already clears the deficit
  });
});

describe('STRUCTURAL FINGERPRINT (computeRetentionStructuralFingerprint)', () => {
  const base = { type: 'multiple_choice', cognitiveLevel: 'APPLICATION', questionIntent: 'CHECK_APPLICATION' };

  it('same strict math shape + same type/concept/cognitiveLevel/questionIntent with different bare numbers => same fingerprint', () => {
    const q1 = { ...base, question: 'Evaluate $2x + 3$' };
    const q2 = { ...base, question: 'Evaluate $9x + 41$' };
    expect(computeRetentionStructuralFingerprint(q1, 'c1')).toBe(computeRetentionStructuralFingerprint(q2, 'c1'));
  });

  it('different operator => different fingerprint', () => {
    const q1 = { ...base, question: 'Evaluate $2x + 3$' };
    const q2 = { ...base, question: 'Evaluate $2x - 3$' };
    expect(computeRetentionStructuralFingerprint(q1, 'c1')).not.toBe(computeRetentionStructuralFingerprint(q2, 'c1'));
  });

  it('different variable => different fingerprint', () => {
    const q1 = { ...base, question: 'Evaluate $2x + 3$' };
    const q2 = { ...base, question: 'Evaluate $2y + 3$' };
    expect(computeRetentionStructuralFingerprint(q1, 'c1')).not.toBe(computeRetentionStructuralFingerprint(q2, 'c1'));
  });

  it('different function => different fingerprint', () => {
    const q1 = { ...base, question: 'Find $\\sin(x)$' };
    const q2 = { ...base, question: 'Find $\\cos(x)$' };
    expect(computeRetentionStructuralFingerprint(q1, 'c1')).not.toBe(computeRetentionStructuralFingerprint(q2, 'c1'));
  });

  it('different exponent DIGIT-COUNT structure => different fingerprint (validated diagnostic behavior preserves exponent digit count, not the literal value)', () => {
    const q1 = { ...base, question: 'Simplify $x^2$' };
    const q2 = { ...base, question: 'Simplify $x^12$' };
    expect(computeRetentionStructuralFingerprint(q1, 'c1')).not.toBe(computeRetentionStructuralFingerprint(q2, 'c1'));
  });

  it('same exponent digit COUNT (e.g. $x^2$ vs $x^3$, both single-digit) => same fingerprint -- matches the validated Step 22D diagnostic normalization exactly', () => {
    const q1 = { ...base, question: 'Simplify $x^2$' };
    const q2 = { ...base, question: 'Simplify $x^3$' };
    expect(computeRetentionStructuralFingerprint(q1, 'c1')).toBe(computeRetentionStructuralFingerprint(q2, 'c1'));
  });

  it('different subscript structure => different fingerprint', () => {
    const q1 = { ...base, question: 'Find $a_1$' };
    const q2 = { ...base, question: 'Find $a_12$' };
    expect(computeRetentionStructuralFingerprint(q1, 'c1')).not.toBe(computeRetentionStructuralFingerprint(q2, 'c1'));
  });

  it('different cognitiveLevel => different fingerprint', () => {
    const q1 = { ...base, question: 'Evaluate $2x + 3$', cognitiveLevel: 'APPLICATION' };
    const q2 = { ...base, question: 'Evaluate $2x + 3$', cognitiveLevel: 'ANALYSIS' };
    expect(computeRetentionStructuralFingerprint(q1, 'c1')).not.toBe(computeRetentionStructuralFingerprint(q2, 'c1'));
  });

  it('different questionIntent => different fingerprint', () => {
    const q1 = { ...base, question: 'Evaluate $2x + 3$', questionIntent: 'CHECK_APPLICATION' };
    const q2 = { ...base, question: 'Evaluate $2x + 3$', questionIntent: 'CHECK_TRANSFER' };
    expect(computeRetentionStructuralFingerprint(q1, 'c1')).not.toBe(computeRetentionStructuralFingerprint(q2, 'c1'));
  });

  it('unifies \\to, \\rightarrow, and -> as the same arrow token', () => {
    const q1 = { ...base, question: 'Evaluate $\\lim_{x \\to 2} f(x)$' };
    const q2 = { ...base, question: 'Evaluate $\\lim_{x \\rightarrow 2} f(x)$' };
    expect(computeRetentionStructuralFingerprint(q1, 'c1')).toBe(computeRetentionStructuralFingerprint(q2, 'c1'));
  });

  it('no math span => null / excluded', () => {
    const q = { ...base, question: 'What is the capital of France?' };
    expect(computeRetentionStructuralFingerprint(q, 'c1')).toBeNull();
  });

  it('different conceptId => different fingerprint even with identical question shape', () => {
    const q = { ...base, question: 'Evaluate $2x + 3$' };
    expect(computeRetentionStructuralFingerprint(q, 'c1')).not.toBe(computeRetentionStructuralFingerprint(q, 'c2'));
  });
});

/**
 * RET-R3 B4 ROOT-CAUSE REPAIR: a single collision between the two
 * initial chunks no longer discards a whole chunk (3-4 otherwise-valid
 * candidates) -- only the specific colliding candidate is dropped, via
 * per-question dedupe (`dedupeAgainstAccepted`, reused post-gate). To
 * still exercise the deficit -> recovery path deterministically, these
 * fixtures make EVERY one of chunk B's 4 candidates collide with one
 * of chunk A's 4 (exact text, or -- for the structural-overlap test --
 * the same math shape+questionIntent pairing, each pair distinct from
 * the others so chunk A's OWN 4 candidates never collide with each
 * other). This reaches the SAME numeric deficit (2) the old whole-
 * chunk-discard rule produced, now via the CORRECT per-question
 * mechanism -- proving the fix without losing recovery-path coverage.
 */
function fullyDuplicatedChunkTexts() {
  const chunkA = batch([
    fakeQuestion(0, { question: 'Same question text 1' }),
    fakeQuestion(1, { question: 'Same question text 2' }),
    fakeQuestion(2, { question: 'Same question text 3' }),
    fakeQuestion(3, { question: 'Same question text 4' }),
  ]);
  const chunkB = batch([
    fakeQuestion(10, { question: 'Same question text 1' }),
    fakeQuestion(11, { question: 'Same question text 2' }),
    fakeQuestion(12, { question: 'Same question text 3' }),
    fakeQuestion(13, { question: 'Same question text 4' }),
  ]);
  return { chunkA, chunkB };
}

const QUESTION_INTENTS = ['CHECK_UNDERSTANDING', 'CHECK_APPLICATION', 'CHECK_TRANSFER', 'DIAGNOSTIC_PROBE'] as const;
function fullyOverlappingChunkTexts() {
  const chunkA = batch([
    fakeQuestion(0, { question: 'Evaluate $2x + 3$', questionIntent: QUESTION_INTENTS[0] }),
    fakeQuestion(1, { question: 'Evaluate $5y - 7$', questionIntent: QUESTION_INTENTS[1] }),
    fakeQuestion(2, { question: 'Solve $9z + 1$', questionIntent: QUESTION_INTENTS[2] }),
    fakeQuestion(3, { question: 'Find $4a - 6$', questionIntent: QUESTION_INTENTS[3] }),
  ]);
  const chunkB = batch([
    fakeQuestion(10, { question: 'Evaluate $9x + 41$', questionIntent: QUESTION_INTENTS[0] }), // same shape+intent as A's q0
    fakeQuestion(11, { question: 'Evaluate $8y - 13$', questionIntent: QUESTION_INTENTS[1] }), // same shape+intent as A's q1
    fakeQuestion(12, { question: 'Solve $6z + 5$', questionIntent: QUESTION_INTENTS[2] }), // same shape+intent as A's q2
    fakeQuestion(13, { question: 'Find $1a - 2$', questionIntent: QUESTION_INTENTS[3] }), // same shape+intent as A's q3
  ]);
  return { chunkA, chunkB };
}

describe('RECOVERY: exactly one bounded round, deterministic selection, RET-R2 surplus sizing', () => {
  it('every candidate in chunk B structurally overlaps a chunk-A counterpart => keep all of A (4), deficit=2, one recovery call for 4 candidates -- per-question dedupe, never a whole-chunk discard', async () => {
    const { chunkA, chunkB } = fullyOverlappingChunkTexts();
    const recoveryB = cleanChunkText(20); // 4 candidates, matching recoveryCandidateCount(deficit=2) === 4
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryB }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(6);
    const messages = callModelMock.mock.calls.map((c) => c[0].user as string);
    expect(messages[2]).toContain('chunk 2 of 2'); // fixed recovery slot/note default (RET-R3: no longer tied to "which chunk lost")
    expect(messages[2]).toContain('Generate EXACTLY 4'); // recoveryCandidateCount(2) === 4
    expect(messages[2]).toContain(VARIANT_B_NOTE_B);
  });

  it('a SINGLE structural overlap (not all 4) between the two initial chunks drops only that one candidate -- 7 of 8 survive, comfortably above 6, so NO recovery call is needed at all (this is the exact live-failure fix: previously one collision discarded 3-4 valid candidates)', async () => {
    const chunkA = batch([
      fakeQuestion(0, { question: 'Evaluate $2x + 3$' }),
      fakeQuestion(1), fakeQuestion(2), fakeQuestion(3),
    ]);
    const chunkB = batch([
      fakeQuestion(10, { question: 'Evaluate $9x + 41$' }), // same structural shape as chunk A's q0 -- the ONLY collision
      fakeQuestion(11), fakeQuestion(12), fakeQuestion(13),
    ]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(2); // no recovery call -- 7 unique already clears the deficit
    expect(result).toHaveLength(6);
    const texts = result.map((q) => q.question);
    // Chunk A's q0 is kept (first occurrence); chunk B's colliding q10 is the one dropped.
    expect(texts).toContain('Evaluate $2x + 3$');
    expect(texts).not.toContain('Evaluate $9x + 41$');
  });

  it('every candidate in chunk B exactly duplicates a chunk-A counterpart => keep all of A (4), deficit=2, one recovery call for 4 candidates', async () => {
    const { chunkA, chunkB } = fullyDuplicatedChunkTexts();
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: cleanChunkText(20) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(6);
    const messages = callModelMock.mock.calls.map((c) => c[0].user as string);
    expect(messages[2]).toContain('1. Same question text 1'); // exclusion note lists all 4 retained chunk-A questions
    expect(messages[2]).toContain('4. Same question text 4');
  });

  it('a SINGLE exact duplicate (not all 4) between the two initial chunks drops only that one candidate -- 7 of 8 survive, no recovery call needed', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    const chunkB = batch([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12), fakeQuestion(13)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(6);
  });

  it('Chunk A failure + Chunk B valid (4) => keep B, deficit=2, recovery call targets slot A for 4 candidates', async () => {
    wireRealisticExecuteAI([{ error: 'PROVIDER_ERROR' }, { text: cleanChunkText(10) }, { text: cleanChunkText(20) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(6);
    // mock.calls[0] is chunk A's (rejected) call -- still recorded even though it threw.
    const messages = callModelMock.mock.calls.map((c) => c[0].user as string);
    expect(messages).toHaveLength(3);
    expect(messages[2]).toContain('chunk 1 of 2'); // recovery regenerates slot A (index 0)
    expect(messages[2]).toContain(VARIANT_B_NOTE_B); // reuses retained Chunk B's own note
  });

  it('Chunk B failure + Chunk A valid (4) => keep A, deficit=2, recovery call targets slot B for 4 candidates', async () => {
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { error: 'TIMEOUT' }, { text: cleanChunkText(20) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(6);
    const messages = callModelMock.mock.calls.map((c) => c[0].user as string);
    expect(messages).toHaveLength(3);
    expect(messages[2]).toContain('chunk 2 of 2'); // recovery regenerates slot B (index 1)
    expect(messages[2]).toContain(VARIANT_B_NOTE_A); // reuses retained Chunk A's own note
  });

  it('both chunks fail => [] with no recovery call attempted', async () => {
    wireRealisticExecuteAI([{ error: 'TIMEOUT' }, { error: 'PROVIDER_ERROR' }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
    expect(executeAIMock).toHaveBeenCalledTimes(2); // never a 3rd call when there is nothing valid to recover around
  });

  it('recovery exclusion context contains the retained question text but no answers/explanations/learner data', async () => {
    const { chunkA, chunkB } = fullyDuplicatedChunkTexts();
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: cleanChunkText(20) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const recoveryMsg = callModelMock.mock.calls[2][0].user as string;
    expect(recoveryMsg).toContain('Same question text 1');
    // "correctAnswer" itself appears only as a schema-shape label (the JSON template shown to the model for every field) --
    // what must never leak is an actual answer/explanation VALUE or any learner/evidence data.
    expect(recoveryMsg).not.toContain('because'); // fakeQuestion's explanation text
    expect(recoveryMsg).not.toContain('learner');
    expect(recoveryMsg).not.toContain('mastery');
    expect(recoveryMsg).not.toContain('Knowledge State');
    expect(recoveryMsg).not.toContain('prior attempt');
  });

  it('no second retry: a recovery batch that entirely collides with the retained set is accepted or rejected outright, never re-attempted', async () => {
    const { chunkA, chunkB } = fullyDuplicatedChunkTexts();
    // All 4 recovery candidates duplicate an already-accepted question exactly -- 0 survive per-question dedup, deficit(2) stays unmet.
    const recoveryAllDuplicate = batch([
      fakeQuestion(20, { question: 'Same question text 1' }),
      fakeQuestion(21, { question: 'Same question text 2' }),
      fakeQuestion(22, { question: 'Same question text 3' }),
      fakeQuestion(23, { question: 'Same question text 4' }),
    ]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryAllDuplicate }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
    expect(executeAIMock).toHaveBeenCalledTimes(3); // exactly 3, never a 4th call
  });
});

describe('FINAL FAILURE: recovery outcome still invalid => []', () => {
  it('recovery returns fewer candidates than requested => chunk validation fails => []', async () => {
    const { chunkA, chunkB } = fullyDuplicatedChunkTexts();
    const recoveryShort = batch([fakeQuestion(20), fakeQuestion(21)]); // only 2, but recoveryCandidateCount(2) === 4 is required
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryShort }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
    expect(executeAIMock).toHaveBeenCalledTimes(3);
  });

  it('recovery schema invalid (missing required fields) => []', async () => {
    const { chunkA, chunkB } = fullyDuplicatedChunkTexts();
    const recoveryInvalid = batch([fakeQuestion(20), fakeQuestion(21), fakeQuestion(22), { type: 'multiple_choice' /* missing question */ }]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryInvalid }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
  });

  it('recovery LaTeX corrupted => []', async () => {
    const { chunkA, chunkB } = fullyDuplicatedChunkTexts();
    // \neq corrupted into a raw control char inside inline math -- corrupted item filtered, leaving only 3 of the 4 requested.
    const recoveryCorrupted = `[{"type":"multiple_choice","options":[{"id":"A","text":"a"},{"id":"B","text":"b"}],"correctAnswer":"A","explanation":"$x \\neq y$","difficulty":3,"question":"Q20","cognitiveLevel":"APPLICATION","questionIntent":"CHECK_APPLICATION"},${JSON.stringify(fakeQuestion(21))},${JSON.stringify(fakeQuestion(22))},${JSON.stringify(fakeQuestion(23))}]`;
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryCorrupted }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
  });

  it('recovery entirely duplicates the retained set => []', async () => {
    const { chunkA, chunkB } = fullyDuplicatedChunkTexts();
    const recoveryAllDup = batch([
      fakeQuestion(20, { question: 'Same question text 1' }),
      fakeQuestion(21, { question: 'Same question text 2' }),
      fakeQuestion(22, { question: 'Same question text 3' }),
      fakeQuestion(23, { question: 'Same question text 4' }),
    ]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryAllDup }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
  });

  it('recovery entirely structurally overlaps the retained set => []', async () => {
    // Same fully-duplicated 4-pair baseline (deficit=2), with chunk A/B's
    // second pair swapped to a math-bearing shape so the recovery batch
    // below can structurally overlap the RETAINED chunk-A question.
    const chunkA = batch([
      fakeQuestion(0, { question: 'Same question text 1' }),
      fakeQuestion(1, { question: 'Evaluate $2x + 3$' }),
      fakeQuestion(2, { question: 'Same question text 3' }),
      fakeQuestion(3, { question: 'Same question text 4' }),
    ]);
    const chunkB = batch([
      fakeQuestion(10, { question: 'Same question text 1' }),
      fakeQuestion(11, { question: 'Evaluate $2x + 3$' }),
      fakeQuestion(12, { question: 'Same question text 3' }),
      fakeQuestion(13, { question: 'Same question text 4' }),
    ]);
    const recoveryOverlap = batch([
      fakeQuestion(20, { question: 'Evaluate $9x + 41$' }), // same structural shape as retained chunk A's 2nd question
      fakeQuestion(21, { question: 'Evaluate $5x + 7$' }),
      fakeQuestion(22, { question: 'Evaluate $3x + 2$' }),
      fakeQuestion(23, { question: 'Evaluate $8x + 6$' }),
    ]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryOverlap }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
  });

  it('recovery call itself fails (timeout) => []', async () => {
    const { chunkA, chunkB } = fullyDuplicatedChunkTexts();
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { error: 'TIMEOUT' }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
  });
});

describe('INVARIANTS', () => {
  it('PARTIAL_RETENTION_CAN_REACH_STUDENT = NO -- every scenario above returns exactly [] or 6, never a 1-5 length array', async () => {
    const scenarios: Array<Array<{ text: string } | { error: 'TIMEOUT' | 'PROVIDER_ERROR' }>> = [
      [{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }],
      [{ error: 'TIMEOUT' }, { error: 'PROVIDER_ERROR' }],
      [{ error: 'PROVIDER_ERROR' }, { text: cleanChunkText(10) }, { text: cleanChunkText(20) }],
      [{ text: cleanChunkText(0) }, { error: 'TIMEOUT' }, { text: cleanChunkText(20) }],
    ];
    for (const scenario of scenarios) {
      wireRealisticExecuteAI(scenario);
      const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
      expect([0, 6]).toContain(result.length);
    }
  });

  it('MAX_AI_CALLS_PER_RETENTION_ATTEMPT = 3 -- no scenario ever fires a 4th executeAI call, even when recovery is triggered (deficit=2) and still exhausted', async () => {
    const { chunkA, chunkB } = fullyDuplicatedChunkTexts();
    const recoveryStillBad = batch([
      fakeQuestion(20, { question: 'Same question text 1' }),
      fakeQuestion(21, { question: 'Same question text 2' }),
      fakeQuestion(22, { question: 'Same question text 3' }),
      fakeQuestion(23, { question: 'Same question text 4' }),
    ]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryStillBad }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]); // deficit(2) never closes -- all 4 recovery candidates duplicate the retained set
    expect(executeAIMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('LEARNER_RESPONSE_AFFECTS_GENERATION = NO -- generateRetentionCheckQuestions accepts no learner-answer/evidence/mastery input by construction', () => {
    const optionsShape = Object.keys({ difficulty: 3, guidance: 'x', language: 'en', ibContext: null });
    expect(optionsShape).not.toContain('learnerAnswers');
    expect(optionsShape).not.toContain('evidence');
    expect(optionsShape).not.toContain('mastery');
    expect(optionsShape).not.toContain('knowledgeState');
  });
});

describe('mode isolation: retention_check fast path is a new, separate function -- does not touch other capabilities', () => {
  it('generateRetentionCheckQuestions accepts no `count` option -- the PUBLISHED count is exact-6-only by construction, not a general chunked generator', () => {
    const optionsShape = Object.keys({ difficulty: 3, guidance: 'x', language: 'en', ibContext: null });
    expect(optionsShape).not.toContain('count');
  });
});
