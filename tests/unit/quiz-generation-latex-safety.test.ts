/**
 * STABILIZATION QUIZ PERFORMANCE Step 18: the final JSON + LaTeX safety
 * fix -- prompt v3, CLASS A pre-parse repair (repairInvalidJsonEscapes),
 * and CLASS B/newline-in-math post-parse corruption rejection
 * (isLatexCorrupted) -- exercised end-to-end through the three real
 * QUESTION_GENERATION call sites via mocked executeAI/callAnthropicMessages
 * (no live provider call, no DB write), plus direct unit tests of the
 * two helpers via generateQuestionsForConcept's own validate pipeline.
 *
 * IMPORTANT test-construction note: every raw JSON string below is built
 * as a literal JS template string, NOT via JSON.stringify(jsObject). A
 * single backslash written in a JS source string (e.g. '\\cdot') becomes
 * a literal one-character backslash at runtime -- JSON.stringify would
 * silently re-escape that backslash correctly and defeat the entire
 * point of these tests (which need to feed genuinely malformed/
 * corrupting raw JSON text, exactly like imperfect real model output,
 * not JS's own always-correct serialization).
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

import { generateQuestionsForConcept, generateQuickCheckQuestions, generatePracticeQuestions } from '@/services/quiz-generation.service';
import { PROMPT_REGISTRY } from '@/lib/ai/prompt-registry';

beforeEach(() => {
  executeAIMock.mockReset();
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [] });
  queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
  callAnthropicMessagesMock.mockReset().mockResolvedValue({ text: '[]' });
});

/**
 * Drives generateQuestionsForConcept's real validate() pipeline (CLASS A
 * repair -> parseAIJson/salvage -> CLASS B/newline-in-math rejection)
 * against a single raw model-response string, returning the accepted
 * clean question array. This is how every test below actually exercises
 * repairInvalidJsonEscapes/isLatexCorrupted -- both are private, so
 * they're proven correct through the one public surface that calls them.
 */
async function runValidatePipeline(rawResponseText: string): Promise<any[]> {
  executeAIMock.mockReset().mockImplementation(async (opts: any) => {
    const validation = opts.validate({ text: rawResponseText });
    return { result: validation.valid ? validation.value : opts.fallback(new Error('invalid')), execution: {} as any, provenance: {} as any };
  });
  return generateQuestionsForConcept('c1', 's1', 'subj1', { count: 1 });
}

/** Base multiple_choice fields, with `explanation` substituted -- built as a raw string, not JSON.stringify. */
function mcQuestionRaw(explanation: string): string {
  return `[{"type":"multiple_choice","options":[{"id":"A","text":"a"},{"id":"B","text":"b"}],"correctAnswer":"A","explanation":"${explanation}","difficulty":3,"question":"Q"}]`;
}

describe('CLASS A: invalid JSON escape repair (parse would otherwise throw; repair fixes it, intended LaTeX preserved)', () => {
  const cases: Array<[string, string]> = [
    ['\\cdot', 'Check: $4x \\cdot 3x$'],
    ['\\sum', 'Compute $\\sum_{i=1}^n i$'],
    ['\\sqrt', 'Simplify $\\sqrt{16}$'],
    ['\\alpha', 'Let $\\alpha = 5$'],
  ];
  for (const [label, explanation] of cases) {
    it(`${label}: raw text has a single unescaped backslash (invalid JSON) -- repaired and parsed, LaTeX preserved`, async () => {
      const raw = mcQuestionRaw(explanation);
      // Sanity: this raw text is genuinely invalid JSON before repair --
      // otherwise this test wouldn't be exercising the repair at all.
      expect(() => JSON.parse(raw)).toThrow();
      const result = await runValidatePipeline(raw);
      expect(result).toHaveLength(1);
      expect(result[0].explanation).toBe(explanation);
    });
  }

  // Regression test for a real bug found during Step 18's own real-data
  // validation run: an earlier version of repairInvalidJsonEscapes
  // examined each backslash independently, so the SECOND backslash of
  // an already-correct "\\cdot" (2 backslashes, valid JSON, unescapes to
  // "\cdot") got doubled AGAIN -- turning valid JSON into 3 backslashes,
  // which JSON.parse rejects. This is the common case once the v3
  // prompt fix is actually working (the model correctly double-escaping
  // its own LaTeX) -- must never be corrupted by the repair meant to
  // help the cases where it doesn't.
  it('already-correctly-double-escaped LaTeX (valid JSON) survives the repair unchanged', async () => {
    const explanation = 'Compute $4x \\\\cdot 3x$ and $\\\\sqrt{16}$'; // JS source -- 2 literal backslashes each, i.e. already-valid JSON
    const raw = mcQuestionRaw(explanation);
    expect(() => JSON.parse(raw)).not.toThrow(); // already valid JSON before repair
    const result = await runValidatePipeline(raw);
    expect(result).toHaveLength(1);
    expect(result[0].explanation).toBe('Compute $4x \\cdot 3x$ and $\\sqrt{16}$'); // unescapes to single backslashes, exactly as intended
  });
});

describe('CLASS B: valid-but-corrupting JSON escape (parse succeeds; corruption detected and rejected)', () => {
  const commands = ['\\times', '\\theta', '\\frac', '\\rightarrow', '\\begin'];
  for (const cmd of commands) {
    it(`${cmd}: JSON.parse succeeds on the raw text (single backslash IS a valid escape here) but the corrupted response is rejected, not silently accepted`, async () => {
      const raw = mcQuestionRaw(`Use ${cmd} here: $x ${cmd} y$`);
      // Sanity: this raw text IS valid JSON as-is -- the corruption is silent, not a parse error.
      expect(() => JSON.parse(raw)).not.toThrow();
      const result = await runValidatePipeline(raw);
      expect(result).toHaveLength(0); // rejected -- corrupted content never reaches the caller
    });
  }
});

describe('NEWLINE class: \\neq / \\nabla corrupted inside math -- rejected; legitimate multiline prose -- accepted', () => {
  it('\\neq corrupted into a newline INSIDE inline math is rejected', async () => {
    const raw = mcQuestionRaw('$x \\neq y$');
    const result = await runValidatePipeline(raw);
    expect(result).toHaveLength(0);
  });

  it('\\nabla corrupted into a newline INSIDE inline math is rejected', async () => {
    const raw = mcQuestionRaw('$\\nabla f$ is the gradient');
    const result = await runValidatePipeline(raw);
    expect(result).toHaveLength(0);
  });

  it('a legitimate multiline explanation with a REAL newline OUTSIDE any math span is accepted', async () => {
    // A genuine newline character (not "\\n" text) between two sentences,
    // mirroring the real "Paso 1... \n\n Paso 2..." pattern observed in
    // Step 14's actual captured data. Built via JSON.stringify here
    // deliberately -- there is no backslash-escaping subtlety to defeat
    // when the only special character is a real newline.
    const raw = JSON.stringify([
      { type: 'multiple_choice', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], correctAnswer: 'A', difficulty: 3, question: 'Q', explanation: 'Paso 1: identify the pattern.\n\nPaso 2: solve for $x = 5$.' },
    ]);
    const result = await runValidatePipeline(raw);
    expect(result).toHaveLength(1);
    expect(result[0].explanation).toContain('Paso 1');
    expect(result[0].explanation).toContain('Paso 2');
  });

  it('clean inline math is accepted', async () => {
    const result = await runValidatePipeline(mcQuestionRaw('The radius is $r = 5$ cm.'));
    expect(result).toHaveLength(1);
  });

  it('clean display math is accepted', async () => {
    const result = await runValidatePipeline(mcQuestionRaw('Pythagorean theorem: $$a^2 + b^2 = c^2$$'));
    expect(result).toHaveLength(1);
  });

  it('multiple math spans, all clean, are accepted', async () => {
    const result = await runValidatePipeline(mcQuestionRaw('Given $a = b$ and $$c = d$$, solve for $e$.'));
    expect(result).toHaveLength(1);
  });

  it('multiple math spans where only one is corrupted -- rejected', async () => {
    const result = await runValidatePipeline(mcQuestionRaw('Given $a = b$ and $c \\neq d$, solve for $e$.'));
    expect(result).toHaveLength(0);
  });
});

describe('recursive inspection: the same policy applies to every LaTeX-capable field, not just explanation', () => {
  it('corruption in options[].text is rejected', async () => {
    const raw = `[{"type":"multiple_choice","options":[{"id":"A","text":"$x \\neq y$"},{"id":"B","text":"b"}],"correctAnswer":"A","explanation":"clean","difficulty":3,"question":"Q"}]`;
    expect(await runValidatePipeline(raw)).toHaveLength(0);
  });

  it('corruption in correctAnswer is rejected', async () => {
    const raw = `[{"type":"short_answer","correctAnswer":"$x \\neq y$","explanation":"clean","difficulty":3,"question":"Q"}]`;
    expect(await runValidatePipeline(raw)).toHaveLength(0);
  });

  it('corruption in matchingPairs[].left/right is rejected', async () => {
    const raw = `[{"type":"matching","matchingPairs":[{"left":"$x \\neq y$","right":"ok"}],"correctAnswer":"summary","explanation":"clean","difficulty":3,"question":"Q"}]`;
    expect(await runValidatePipeline(raw)).toHaveLength(0);
  });

  it('corruption in orderingItems[] is rejected', async () => {
    const raw = `[{"type":"ordering","orderingItems":["step 1","$x \\neq y$"],"correctAnswer":"summary","explanation":"clean","difficulty":3,"question":"Q"}]`;
    expect(await runValidatePipeline(raw)).toHaveLength(0);
  });

  it('corruption in classificationCategories[] is rejected', async () => {
    const raw = `[{"type":"classification","classificationCategories":["$x \\neq y$","other"],"classificationItems":[{"item":"a","category":"other"}],"correctAnswer":"summary","explanation":"clean","difficulty":3,"question":"Q"}]`;
    expect(await runValidatePipeline(raw)).toHaveLength(0);
  });

  it('corruption in classificationItems[].item is rejected', async () => {
    const raw = `[{"type":"classification","classificationCategories":["cat"],"classificationItems":[{"item":"$x \\neq y$","category":"cat"}],"correctAnswer":"summary","explanation":"clean","difficulty":3,"question":"Q"}]`;
    expect(await runValidatePipeline(raw)).toHaveLength(0);
  });

  it('corruption in visualAid.caption/chartData fields is rejected', async () => {
    const raw = `[{"type":"multiple_choice","options":[{"id":"A","text":"a"},{"id":"B","text":"b"}],"correctAnswer":"A","explanation":"clean","difficulty":3,"question":"Q","visualAid":{"kind":"chart","chartData":{"chartType":"line","labels":["$x \\neq y$"],"values":[1]},"caption":"clean caption"}}]`;
    expect(await runValidatePipeline(raw)).toHaveLength(0);
  });
});

describe('currency-dollar false-positive (known, documented, accepted trade-off)', () => {
  it('a real newline landing between two bare (non-math) currency dollar amounts is rejected -- the accepted false-positive: a false REJECT (safe direction), never a false ACCEPT of corrupted math', async () => {
    // "$5" + real newline + "not $10" -- no LaTeX involved at all, but
    // the "$...$" delimiter heuristic can't distinguish this from real
    // math, so the legitimate newline between the two amounts gets
    // misread as "inside a math span" and the question is rejected.
    // Documented and accepted (Step 17/18): the failure direction only
    // ever costs one fewer question, never lets corrupted content through.
    const raw = JSON.stringify([
      { type: 'multiple_choice', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], correctAnswer: 'A', difficulty: 3, question: 'Q', explanation: 'It costs $5\nnot $10 as I said.' },
    ]);
    const result = await runValidatePipeline(raw);
    expect(result).toHaveLength(0); // rejected -- the documented, accepted trade-off, not a bug
  });
});

describe('TAB/FORM_FEED/BACKSPACE/CARRIAGE_RETURN: rejected unconditionally, even outside math', () => {
  it('a corrupted \\times (-> TAB) outside any math span (no dollar signs at all) is still rejected -- no legitimate use anywhere', async () => {
    const raw = mcQuestionRaw('Use \\times here, no dollar signs at all.');
    expect(() => JSON.parse(raw)).not.toThrow(); // parses fine -- the corruption is silent, not a parse error
    const result = await runValidatePipeline(raw);
    expect(result).toHaveLength(0);
  });
});

describe('never exceeds requested count / empty result uses existing GENERATION_FAILED signal', () => {
  it('a fully corrupted response degrades to [] -- the existing empty-result contract, no new failure path', async () => {
    const raw = mcQuestionRaw('Use \\times here.');
    const result = await runValidatePipeline(raw);
    expect(result).toEqual([]);
  });
});

describe('quick_check: any corrupted slot fails the WHOLE generation (all-or-nothing preserved)', () => {
  it('one corrupted slot among 6 makes generateQuickCheckQuestions return [] entirely', async () => {
    let call = 0;
    executeAIMock.mockImplementation(async (opts: any) => {
      const i = call++;
      const assignedTypes = ['multiple_choice', 'true_false', 'yes_no', 'short_answer', 'multiple_choice', 'true_false'];
      const type = assignedTypes[i];
      const text = i === 2 ? `[{"type":"${type}","question":"Q","correctAnswer":"a","explanation":"$x \\neq y$","difficulty":3}]` : `[{"type":"${type}","question":"Q","correctAnswer":"a","explanation":"clean","difficulty":3}]`;
      const validation = opts.validate({ text });
      return { result: validation.valid ? validation.value : opts.fallback(new Error('invalid')), execution: {} as any, provenance: {} as any };
    });
    const result = await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]); // all-or-nothing preserved -- one corrupted slot fails everything
  });
});

describe('practice/review chunking: a corrupted question within a chunk reduces the final count, never fails the whole quiz (partial tolerance preserved)', () => {
  it('one corrupted question among several in a chunk is filtered out, the rest still delivered', async () => {
    executeAIMock.mockImplementation(async (opts: any) => {
      const text = `[{"type":"multiple_choice","options":[{"id":"A","text":"a"},{"id":"B","text":"b"}],"correctAnswer":"A","explanation":"clean 1","difficulty":3,"question":"Q1"},{"type":"multiple_choice","options":[{"id":"A","text":"a"},{"id":"B","text":"b"}],"correctAnswer":"A","explanation":"$x \\neq y$","difficulty":3,"question":"Q2"}]`;
      const validation = opts.validate({ text });
      return { result: validation.valid ? validation.value : opts.fallback(new Error('invalid')), execution: {} as any, provenance: {} as any };
    });
    const result = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 6 }); // count=6 -> 2 chunks
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(4); // fewer than the 4 "clean" questions across 2 chunks -- proves at least one corrupted item was filtered, not everything discarded
  });

  it('final result never exceeds requestedCount even with corruption filtering in play', async () => {
    executeAIMock.mockImplementation(async (opts: any) => {
      const text = `[{"type":"multiple_choice","options":[{"id":"A","text":"a"},{"id":"B","text":"b"}],"correctAnswer":"A","explanation":"clean","difficulty":3,"question":"Q"}]`;
      const validation = opts.validate({ text });
      return { result: validation.valid ? validation.value : opts.fallback(new Error('invalid')), execution: {} as any, provenance: {} as any };
    });
    const result = await generatePracticeQuestions('c1', 's1', 'subj1', { count: 6 });
    expect(result.length).toBeLessThanOrEqual(6);
  });
});

describe('prompt version provenance (Step 18 Section 8): every QUESTION_GENERATION call site reports v3, unrelated prompts unchanged', () => {
  it('registry version is v3', () => {
    expect(PROMPT_REGISTRY['quiz.question_generation'].version).toBe('v3');
  });

  it('legacy batch generateQuestionsForConcept reports v3', async () => {
    executeAIMock.mockReset().mockResolvedValue({ result: [], execution: {} as any, provenance: {} as any });
    await generateQuestionsForConcept('c1', 's1', 'subj1', { count: 6 });
    expect(executeAIMock.mock.calls[0][0].promptVersion).toBe('v3');
  });

  it('quick_check fast path reports v3 for every slot', async () => {
    executeAIMock.mockReset().mockResolvedValue({ result: null, execution: {} as any, provenance: {} as any });
    await generateQuickCheckQuestions('c1', 's1', 'subj1', {});
    for (const call of executeAIMock.mock.calls) expect(call[0].promptVersion).toBe('v3');
  });

  it('practice/review chunked path reports v3 for every chunk', async () => {
    executeAIMock.mockReset().mockResolvedValue({ result: [], execution: {} as any, provenance: {} as any });
    await generatePracticeQuestions('c1', 's1', 'subj1', { count: 20 });
    for (const call of executeAIMock.mock.calls) expect(call[0].promptVersion).toBe('v3');
  });

  it('unrelated prompts (grading, hints, and others outside QUESTION_GENERATION) are unchanged -- verified against the real registry, not re-derived here', () => {
    expect(PROMPT_REGISTRY['quiz.free_text_grading'].version).toBe('v1');
    expect(PROMPT_REGISTRY['quiz.question_hint'].version).toBe('v2');
    expect(PROMPT_REGISTRY['misconception.classification'].version).toBe('v1');
  });
});
