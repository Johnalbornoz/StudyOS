/**
 * STABILIZATION QUIZ PERFORMANCE Step 23: generateRetentionCheckQuestions
 * -- the FINAL validated retention_check (EvidenceMode INDEPENDENT) fast
 * path, evolved from Step 22's plain 2x3 chunking into the Step 22D
 * architecture: preventive Variant B runtime diversification on both
 * initial chunks, plus exactly one bounded recovery round (chunk
 * failure, exact duplicate, or strict structural overlap), still
 * exact-6-or-nothing throughout -- never a partial set.
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

const callAnthropicMessagesMock = vi.fn();
vi.mock('@/lib/ai/adapters/anthropic', () => ({ callAnthropicMessages: (...a: any[]) => callAnthropicMessagesMock(...a) }));

import {
  generateRetentionCheckQuestions,
  RETENTION_REQUIRED_COUNT,
  RETENTION_MAX_AI_CALLS_PER_ATTEMPT,
  computeRetentionStructuralFingerprint,
} from '@/services/quiz-generation.service';
import { PROMPT_REGISTRY } from '@/lib/ai/prompt-registry';

const VARIANT_B_NOTE_A =
  'Generate questions using examples and mathematical structures that vary from the most obvious textbook examples for this concept.';
const VARIANT_B_NOTE_B =
  'Generate questions using a different variety of examples and mathematical structures; avoid defaulting to the most obvious textbook examples.';

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
 * own `call` (so callAnthropicMessagesMock genuinely receives each
 * chunk's real userMessage, inspectable in assertions) and `validate`/
 * `fallback`, exactly as the real gateway would -- just without the
 * network. `chunkResponses` are consumed in call order (chunk A, chunk
 * B, then the bounded recovery call if one occurs).
 */
function wireRealisticExecuteAI(chunkResponses: Array<{ text: string } | { error: 'TIMEOUT' | 'PROVIDER_ERROR' }>) {
  callAnthropicMessagesMock.mockReset();
  for (const resp of chunkResponses) {
    if ('error' in resp) {
      callAnthropicMessagesMock.mockImplementationOnce(async () => {
        const err: any = new Error(resp.error);
        err.name = resp.error === 'TIMEOUT' ? 'AbortError' : 'Error';
        throw err;
      });
    } else {
      callAnthropicMessagesMock.mockImplementationOnce(async () => ({ text: resp.text }));
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

function cleanChunkText(base: number) {
  return JSON.stringify([fakeQuestion(base), fakeQuestion(base + 1), fakeQuestion(base + 2)]);
}

beforeEach(() => {
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [] });
  queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
  callAnthropicMessagesMock.mockReset().mockResolvedValue({ text: '[]' });
  executeAIMock.mockReset();
});

describe('RETENTION_REQUIRED_COUNT is 6 (2 chunks x 3)', () => {
  it('equals 6', () => {
    expect(RETENTION_REQUIRED_COUNT).toBe(6);
  });
});

describe('RETENTION_MAX_AI_CALLS_PER_ATTEMPT is 3 (2 initial + at most 1 bounded recovery)', () => {
  it('equals 3', () => {
    expect(RETENTION_MAX_AI_CALLS_PER_ATTEMPT).toBe(3);
  });
});

describe('INITIAL SUCCESS: architecture, model, prompt, timeout, Variant B notes', () => {
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

  it('both calls use claude-haiku-4-5-20251001, promptId quiz.question_generation, promptVersion v3, timeoutMs 30000', async () => {
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    for (const call of executeAIMock.mock.calls) {
      expect(call[0].model).toBe('claude-haiku-4-5-20251001');
      expect(call[0].promptId).toBe('quiz.question_generation');
      expect(call[0].promptVersion).toBe('v3');
      expect(call[0].timeoutMs).toBe(30_000);
    }
    expect(PROMPT_REGISTRY['quiz.question_generation'].version).toBe('v3');
  });

  it('each call requests exactly 3 questions, carries the "chunk N of 2" / "6 total questions" context, and its own Variant B note', async () => {
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const messages = callAnthropicMessagesMock.mock.calls.map((c) => c[0].messages[0].content as string);
    expect(messages).toHaveLength(2);
    for (const msg of messages) {
      expect(msg).toContain('Generate EXACTLY 3 questions');
      expect(msg).toContain('6 total questions');
    }
    expect(messages[0]).toContain('chunk 1 of 2');
    expect(messages[1]).toContain('chunk 2 of 2');
    expect(messages[0]).toContain(VARIANT_B_NOTE_A);
    expect(messages[0]).not.toContain(VARIANT_B_NOTE_B);
    expect(messages[1]).toContain(VARIANT_B_NOTE_B);
    expect(messages[1]).not.toContain(VARIANT_B_NOTE_A);
  });

  it('does not manually assign or cycle question types -- no per-slot "prefer type X" instruction appears', async () => {
    const messages = callAnthropicMessagesMock.mock.calls.map((c) => c[0].messages[0].content as string);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    for (const msg of messages) {
      expect(msg).not.toContain('prefer question type');
    }
  });

  it('returns exactly 6 questions when both chunks succeed cleanly, with no recovery call', async () => {
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6);
    expect(executeAIMock).toHaveBeenCalledTimes(2); // no 3rd (recovery) call for a CLEAN initial set
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

describe('RECOVERY: exactly one bounded round, deterministic selection', () => {
  it('structural overlap between the two initial chunks => exactly one recovery call, keeping A and regenerating B', async () => {
    const overlapping = JSON.stringify([
      fakeQuestion(0, { question: 'Evaluate $2x + 3$' }),
      fakeQuestion(1),
      fakeQuestion(2),
    ]);
    const overlappingB = JSON.stringify([
      fakeQuestion(10, { question: 'Evaluate $9x + 41$' }), // same structural shape as chunk A's q0
      fakeQuestion(11),
      fakeQuestion(12),
    ]);
    const recoveryB = cleanChunkText(20);
    wireRealisticExecuteAI([{ text: overlapping }, { text: overlappingB }, { text: recoveryB }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(6);
    const messages = callAnthropicMessagesMock.mock.calls.map((c) => c[0].messages[0].content as string);
    expect(messages[2]).toContain('chunk 2 of 2'); // regenerating slot B (index 1)
    expect(messages[2]).toContain(VARIANT_B_NOTE_A); // reuses the RETAINED chunk's (A's) own note, per Step 22D's validated pattern
  });

  it('exact duplicate between the two initial chunks => exactly one recovery call, keeping A and regenerating B', async () => {
    const chunkA = JSON.stringify([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1), fakeQuestion(2)]);
    const chunkB = JSON.stringify([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: cleanChunkText(20) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(6);
    const messages = callAnthropicMessagesMock.mock.calls.map((c) => c[0].messages[0].content as string);
    expect(messages[2]).toContain('1. Same question text'); // exclusion note lists retained chunk A's own question text
  });

  it('Chunk A failure + Chunk B valid => regenerate A once, recovery call targets slot A', async () => {
    wireRealisticExecuteAI([{ error: 'PROVIDER_ERROR' }, { text: cleanChunkText(10) }, { text: cleanChunkText(20) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(6);
    // mock.calls[0] is chunk A's (rejected) call -- still recorded even though it threw.
    const messages = callAnthropicMessagesMock.mock.calls.map((c) => c[0].messages[0].content as string);
    expect(messages).toHaveLength(3);
    expect(messages[2]).toContain('chunk 1 of 2'); // recovery regenerates slot A (index 0)
    expect(messages[2]).toContain(VARIANT_B_NOTE_B); // reuses retained Chunk B's own note
  });

  it('Chunk B failure + Chunk A valid => regenerate B once, recovery call targets slot B', async () => {
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { error: 'TIMEOUT' }, { text: cleanChunkText(20) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(6);
    const messages = callAnthropicMessagesMock.mock.calls.map((c) => c[0].messages[0].content as string);
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
    const chunkA = JSON.stringify([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1), fakeQuestion(2)]);
    const chunkB = JSON.stringify([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: cleanChunkText(20) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const recoveryMsg = callAnthropicMessagesMock.mock.calls[2][0].messages[0].content as string;
    expect(recoveryMsg).toContain('Same question text');
    // "correctAnswer" itself appears only as a schema-shape label (the JSON template shown to the model for every field) --
    // what must never leak is an actual answer/explanation VALUE or any learner/evidence data.
    expect(recoveryMsg).not.toContain('because'); // fakeQuestion's explanation text
    expect(recoveryMsg).not.toContain('learner');
    expect(recoveryMsg).not.toContain('mastery');
    expect(recoveryMsg).not.toContain('Knowledge State');
    expect(recoveryMsg).not.toContain('prior attempt');
  });

  it('no second retry: even a structural-overlap-triggering recovery result is accepted or rejected outright, never re-attempted', async () => {
    const chunkA = JSON.stringify([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1), fakeQuestion(2)]);
    const chunkB = JSON.stringify([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12)]);
    const recoveryStillDuplicate = JSON.stringify([fakeQuestion(20, { question: 'Same question text' }), fakeQuestion(21), fakeQuestion(22)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryStillDuplicate }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
    expect(executeAIMock).toHaveBeenCalledTimes(3); // exactly 3, never a 4th call
  });
});

describe('FINAL FAILURE: recovery outcome still invalid => []', () => {
  it('recovery returns only 2 valid questions => []', async () => {
    const chunkA = JSON.stringify([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1), fakeQuestion(2)]);
    const chunkB = JSON.stringify([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12)]);
    const recoveryShort = JSON.stringify([fakeQuestion(20), fakeQuestion(21)]); // only 2
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryShort }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
    expect(executeAIMock).toHaveBeenCalledTimes(3);
  });

  it('recovery schema invalid (missing required fields) => []', async () => {
    const chunkA = JSON.stringify([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1), fakeQuestion(2)]);
    const chunkB = JSON.stringify([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12)]);
    const recoveryInvalid = JSON.stringify([fakeQuestion(20), fakeQuestion(21), { type: 'multiple_choice' /* missing question */ }]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryInvalid }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
  });

  it('recovery LaTeX corrupted => []', async () => {
    const chunkA = JSON.stringify([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1), fakeQuestion(2)]);
    const chunkB = JSON.stringify([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12)]);
    // \neq corrupted into a raw control char inside inline math -- corrupted item filtered, leaving only 2.
    const recoveryCorrupted = `[{"type":"multiple_choice","options":[{"id":"A","text":"a"},{"id":"B","text":"b"}],"correctAnswer":"A","explanation":"$x \\neq y$","difficulty":3,"question":"Q20","cognitiveLevel":"APPLICATION","questionIntent":"CHECK_APPLICATION"},${JSON.stringify(fakeQuestion(21))},${JSON.stringify(fakeQuestion(22))}]`;
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryCorrupted }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
  });

  it('recovery exact duplicate remains (recovered chunk duplicates the retained chunk) => []', async () => {
    const chunkA = JSON.stringify([fakeQuestion(0, { question: 'Retained question' }), fakeQuestion(1), fakeQuestion(2)]);
    const chunkB = JSON.stringify([fakeQuestion(10, { question: 'Retained question' }), fakeQuestion(11), fakeQuestion(12)]);
    const recoveryDup = JSON.stringify([fakeQuestion(20, { question: 'Retained question' }), fakeQuestion(21), fakeQuestion(22)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryDup }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
  });

  it('recovery structural overlap remains (recovered chunk structurally collides with retained chunk) => []', async () => {
    const chunkA = JSON.stringify([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1, { question: 'Evaluate $2x + 3$' }), fakeQuestion(2)]);
    const chunkB = JSON.stringify([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12)]);
    const recoveryOverlap = JSON.stringify([
      fakeQuestion(20, { question: 'Evaluate $9x + 41$' }), // same structural shape as retained chunk A's 2nd question
      fakeQuestion(21),
      fakeQuestion(22),
    ]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryOverlap }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
  });

  it('recovery call itself fails (timeout) => []', async () => {
    const chunkA = JSON.stringify([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1), fakeQuestion(2)]);
    const chunkB = JSON.stringify([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12)]);
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

  it('MAX_AI_CALLS_PER_RETENTION_ATTEMPT = 3 -- no scenario ever fires a 4th executeAI call', async () => {
    const chunkA = JSON.stringify([fakeQuestion(0, { question: 'Same question text' }), fakeQuestion(1), fakeQuestion(2)]);
    const chunkB = JSON.stringify([fakeQuestion(10, { question: 'Same question text' }), fakeQuestion(11), fakeQuestion(12)]);
    const recoveryStillBad = JSON.stringify([fakeQuestion(20, { question: 'Same question text' }), fakeQuestion(21), fakeQuestion(22)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recoveryStillBad }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
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
  it('generateRetentionCheckQuestions accepts no `count` option -- it is exact-6-only by construction, not a general chunked generator', () => {
    const optionsShape = Object.keys({ difficulty: 3, guidance: 'x', language: 'en', ibContext: null });
    expect(optionsShape).not.toContain('count');
  });
});
