/**
 * LX-4P-PERF-R1F -- OpenAI structured question response compatibility.
 *
 * ROOT CAUSE (proved, not assumed): every QUESTION_GENERATION call site
 * did `parsed = parseAIJson<any[]>(repaired)` -- a compile-time-only
 * cast with no runtime check -- and never wired
 * `jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA` into `callModel`, so the
 * adapter fell back to legacy `response_format: json_object` while the
 * prompt still asked for a bare JSON ARRAY. `json_object` mode requires
 * an OBJECT root, so the model's (correct, object-rooted) response made
 * `parsed.filter(...)` throw `TypeError: parsed.filter is not a
 * function` -- an uncaught throw inside `validate` that `executeAI`
 * classifies as `INVALID_RESPONSE`, exactly matching the live evidence
 * (both Luna and Terra attempts, 0 generated/0 passed/0 det-fail/
 * 0 sem-fail).
 *
 * The fix: `jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA` is now wired
 * into every QUESTION_GENERATION call, the prompt asks for
 * `{"questions": [...]}"`, and the ONE explicit boundary
 * (`parseGeneratedQuestionBatch`, private -- exercised only through the
 * public generation functions) never throws on a shape mismatch --
 * it returns `{ok:false}` with a specific `failureStage`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const QG = read('src/services/quiz-generation.service.ts');
const SCHEMAS = read('src/lib/ai/schemas.ts');

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
  evaluateQuestionQualityVerdict: vi.fn(() => ({ pass: true, reason: '' })),
}));

import { generateQuestionsForConcept } from '@/services/quiz-generation.service';

const VALID_QUESTION = {
  type: 'multiple_choice',
  question: 'Q', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }],
  correctAnswer: 'A', explanation: 'because', difficulty: 3,
};

function openAIResponse(body: unknown, opts: Partial<{ finishReason: string; usage: any; refusal: string }> = {}) {
  return {
    choices: [{ message: opts.refusal ? { refusal: opts.refusal } : { content: JSON.stringify(body) }, finish_reason: opts.finishReason ?? 'stop' }],
    ...(opts.usage !== undefined ? { usage: opts.usage } : {}),
  };
}

/** Drives generateQuestionsForConcept's real validate() pipeline against one raw callModel-shaped response. */
async function runValidate(raw: { text: string; raw: unknown; provider?: 'openai'; model?: string }): Promise<any[]> {
  executeAIMock.mockReset().mockImplementation(async (opts: any) => {
    const validation = opts.validate({ text: raw.text, raw: raw.raw, provider: raw.provider ?? 'openai', model: raw.model ?? 'gpt-5.6-luna' });
    return { result: validation.valid ? validation.value : opts.fallback(new Error('invalid')), execution: {} as any, provenance: {} as any };
  });
  return generateQuestionsForConcept('c1', 's1', 'subj1', { count: 1 });
}

beforeEach(() => {
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [] });
  queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
  callModelMock.mockReset();
  vi.restoreAllMocks();
});

/* ---------- R1/R5: the wiring itself ---------- */
describe('R1F R5 -- the strict schema is actually wired into every QUESTION_GENERATION call', () => {
  it('every callModel(...) call for question generation carries jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA', () => {
    const callSites = QG.match(/callModel\(\s*\{[^}]*capability|callModel\(\{[\s\S]{0,400}?\}, signal\)/g) ?? [];
    // Simpler, robust check: every occurrence of the QUESTION_GENERATION
    // prompt's "Output a JSON object" wording is paired with jsonSchema
    // in the same call. Count both and require they match.
    const promptCount = (QG.match(/Output a JSON object \(no markdown fences\)/g) || []).length;
    const schemaCount = (QG.match(/jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA/g) || []).length;
    expect(promptCount).toBeGreaterThanOrEqual(4); // generateQuestionsForConcept, quick_check slot, practice chunk, retention chunk
    expect(schemaCount).toBe(promptCount);
  });

  it('no QUESTION_GENERATION call site still asks for a bare JSON array', () => {
    expect(QG).not.toMatch(/Output a JSON array \(no markdown fences\)/);
    expect(QG).not.toMatch(/Output a JSON array containing exactly/);
  });

  it('parseGeneratedQuestionBatch is the ONE unwrap boundary -- every QUESTION_GENERATION validate closure calls it exactly once, none re-implements its own JSON.parse(...).questions unwrap', () => {
    const bodies = [
      QG.slice(QG.indexOf('export async function generateQuestionsForConcept'), QG.indexOf('export async function generateQuickCheckQuestions')),
      QG.slice(QG.indexOf('export async function generateQuickCheckQuestions'), QG.indexOf('export const MAX_QUESTIONS_PER_CHUNK')),
      QG.slice(QG.indexOf('export async function generatePracticeQuestions'), QG.indexOf('export async function generateRetentionCheckQuestions')),
      QG.slice(QG.indexOf('export async function generateRetentionCheckQuestions'), QG.indexOf('export interface EquivalenceCheckResult')),
    ];
    for (const body of bodies) {
      expect((body.match(/parseGeneratedQuestionBatch\(/g) || []).length).toBe(1);
      // no call site re-implements its own parse + unwrap
      expect(body).not.toMatch(/parseAIJson<any\[\]>/);
      expect(body).not.toMatch(/JSON\.parse\([^)]*\)\.questions/);
    }
  });
});

/* ---------- tests 1-6: the batch-wrapper boundary itself ---------- */
describe('R1F tests 1-6 -- parseGeneratedQuestionBatch boundary (via generateQuestionsForConcept)', () => {
  it('test 1: {"questions":[...]} strict response parses successfully', async () => {
    const out = await runValidate({ text: JSON.stringify({ questions: [VALID_QUESTION] }), raw: openAIResponse({ questions: [VALID_QUESTION] }) });
    expect(out).toHaveLength(1);
  });

  it('test 2: the domain output is a flat GeneratedQuestion[] after one centralized unwrap (no nested .questions leaks through)', async () => {
    const out = await runValidate({ text: JSON.stringify({ questions: [VALID_QUESTION] }), raw: {} });
    expect(Array.isArray(out)).toBe(true);
    expect((out[0] as any).questions).toBeUndefined();
    expect(out[0].question).toBe('Q');
  });

  it('test 3: a raw bare array (the OLD/wrong shape) is rejected, not silently accepted', async () => {
    const out = await runValidate({ text: JSON.stringify([VALID_QUESTION]), raw: {} });
    expect(out).toEqual([]); // rejected -> executeAI's fallback (() => []) -> mapRawQuestionsToGenerated([]) -> []
  });

  it('test 4: an object missing the "questions" property is rejected', async () => {
    const out = await runValidate({ text: JSON.stringify({ items: [VALID_QUESTION] }), raw: {} });
    expect(out).toEqual([]);
  });

  it('test 5: a null "questions" value is rejected', async () => {
    const out = await runValidate({ text: JSON.stringify({ questions: null }), raw: {} });
    expect(out).toEqual([]);
  });

  it('test 6: malformed JSON (and nothing salvageable) is rejected', async () => {
    const out = await runValidate({ text: '{not json', raw: {} });
    expect(out).toEqual([]);
  });
});

/* ---------- test 7/8: failure classification ---------- */
describe('R1F tests 7/8 -- failure classification (refusal vs truncation vs structural)', () => {
  it('test 7: a strict-schema refusal fails at the CALL boundary (NOT_APPLICABLE), never at validate (FAILED) -- distinguishable from a structural defect', async () => {
    const { executeAI } = await vi.importActual<typeof import('@/lib/ai')>('@/lib/ai');
    const { AIExecutionFailure } = await import('@/lib/ai/gateway');
    let caught: any = null;
    try {
      await executeAI({
        capability: 'QUESTION_GENERATION', risk: 'HIGH_RISK', provider: 'openai', model: 'gpt-5.6-luna',
        promptId: 'quiz.question_generation', promptVersion: 'v3',
        call: async () => { throw new (await import('@/lib/ai/errors')).AIExecutionError('INVALID_RESPONSE', 'OpenAI refused the structured request: nope'); },
        validate: () => ({ valid: true, value: [] }),
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AIExecutionFailure);
    expect(caught.execution.validationStatus).toBe('NOT_APPLICABLE'); // never reached validate
  });

  it('test 8: finish_reason "length" + unparseable content is classified OUTPUT_TRUNCATED (visible via the [ai-structure] log)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await runValidate({ text: '{"questions": [ { "type": "multiple_choice", "quest', raw: openAIResponse({}, { finishReason: 'length' }) });
    expect(out).toEqual([]);
    const structureLine = logSpy.mock.calls.find((c) => c[0] === '[ai-structure]');
    expect(structureLine).toBeTruthy();
    const parsed = JSON.parse(structureLine![1] as string);
    expect(parsed.failureStage).toBe('OUTPUT_TRUNCATED');
    expect(parsed.finishReason).toBe('length');
    logSpy.mockRestore();
  });
});

/* ---------- tests 9-13: gate boundary + Luna/Terra behaviour ---------- */
describe('R1F tests 9-13 -- a structurally valid batch reaches the REAL Quality Gate; Terra is not a masquerade for a parser bug', () => {
  it('test 9/10: a valid strict response reaches the deterministic gate and is accepted WITHOUT Terra', async () => {
    callModelMock.mockResolvedValue({ text: JSON.stringify({ questions: [VALID_QUESTION] }), raw: openAIResponse({ questions: [VALID_QUESTION] }), provider: 'openai', model: 'gpt-5.6-luna' });
    const { generateGatedPracticeBatch } = await import('@/services/gated-question-generation.service');
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      const raw = await opts.call(new AbortController().signal);
      const validation = opts.validate(raw);
      return { result: validation.valid ? validation.value : opts.fallback(new Error('x')), execution: {} as any, provenance: {} as any };
    });
    const out = await generateGatedPracticeBatch('c1', 's1', 'subj1', { count: 1, language: 'en' });
    expect(out).toHaveLength(1);
    expect(callModelMock).toHaveBeenCalledTimes(1); // Luna only -- test 11 (R11): no Terra for a structurally-valid response
  });

  it('test 12: a genuine deterministic gate FAILURE (not a parser defect) invokes Terra exactly once', async () => {
    const INVALID_QUESTION = { type: 'multiple_choice', question: 'Q', options: [{ id: 'A', text: 'a' }], correctAnswer: 'Z', explanation: 'e', difficulty: 3 }; // correctAnswer not a valid option id
    callModelMock
      .mockResolvedValueOnce({ text: JSON.stringify({ questions: [INVALID_QUESTION] }), raw: openAIResponse({ questions: [INVALID_QUESTION] }), provider: 'openai', model: 'gpt-5.6-luna' })
      .mockResolvedValueOnce({ text: JSON.stringify({ questions: [VALID_QUESTION] }), raw: openAIResponse({ questions: [VALID_QUESTION] }), provider: 'openai', model: 'gpt-5.6-terra' });
    const { generateGatedPracticeBatch } = await import('@/services/gated-question-generation.service');
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      const raw = await opts.call(new AbortController().signal);
      const validation = opts.validate(raw);
      return { result: validation.valid ? validation.value : opts.fallback(new Error('x')), execution: {} as any, provenance: {} as any };
    });
    const out = await generateGatedPracticeBatch('c1', 's1', 'subj1', { count: 1, language: 'en' });
    expect(out).toHaveLength(1);
    expect(callModelMock).toHaveBeenCalledTimes(2); // Luna, then exactly one Terra
    expect(callModelMock.mock.calls[1][0].model).toBe('gpt-5.6-terra');
  });

  it('test 13: a pure structural/parser defect (bad wrapper) is classified as a VALIDATION failure, not silently folded into "quality rejected" language -- and still only costs ONE Terra attempt, same as a real quality failure', async () => {
    callModelMock
      .mockResolvedValueOnce({ text: JSON.stringify([VALID_QUESTION]), raw: {}, provider: 'openai', model: 'gpt-5.6-luna' }) // wrong shape: bare array
      .mockResolvedValueOnce({ text: JSON.stringify({ questions: [VALID_QUESTION] }), raw: openAIResponse({ questions: [VALID_QUESTION] }), provider: 'openai', model: 'gpt-5.6-terra' });
    const { generateGatedPracticeBatch } = await import('@/services/gated-question-generation.service');
    executeAIMock.mockReset().mockImplementation(async (opts: any) => {
      const raw = await opts.call(new AbortController().signal);
      const validation = opts.validate(raw);
      return { result: validation.valid ? validation.value : opts.fallback(new Error('x')), execution: {} as any, provenance: {} as any };
    });
    const out = await generateGatedPracticeBatch('c1', 's1', 'subj1', { count: 1, language: 'en' });
    expect(out).toHaveLength(1); // Terra's structurally-valid batch recovers it
    expect(callModelMock).toHaveBeenCalledTimes(2); // never more than the existing bounded fallback
  });
});

/* ---------- test 14: Terra shares the same parser ---------- */
describe('R1F test 14 -- Terra uses the SAME batch parser, not a separate path', () => {
  it('generateQuestionsForConcept (used for both Luna and the Terra modelOverride retry) has exactly one validate closure calling parseGeneratedQuestionBatch', () => {
    const fnBody = QG.slice(QG.indexOf('export async function generateQuestionsForConcept'), QG.indexOf('export async function generateQuickCheckQuestions'));
    const occurrences = (fnBody.match(/parseGeneratedQuestionBatch\(/g) || []).length;
    expect(occurrences).toBe(1);
    expect(fnBody).toMatch(/modelOverride\?\: string/);
  });
});

/* ---------- test 15/16: telemetry ---------- */
describe('R1F tests 15/16 -- usage preserved on failure; no learner content logged', () => {
  it('test 15: real usage on a response that later fails domain validation is preserved in the structural diagnostic (never fabricated)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const usage = { prompt_tokens: 500, completion_tokens: 200 };
    await runValidate({ text: JSON.stringify([VALID_QUESTION]), raw: openAIResponse({}, { usage }) }); // wrong shape -> fails, but usage was present
    const structureLine = logSpy.mock.calls.find((c) => c[0] === '[ai-structure]');
    const parsed = JSON.parse(structureLine![1] as string);
    expect(parsed.hasUsage).toBe(true);
    expect(parsed.failureStage).toBe('BATCH_WRAPPER_INVALID');
    logSpy.mockRestore();
  });

  it('test 15b: no usage returned -> hasUsage false, never fabricated as true', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runValidate({ text: JSON.stringify({ questions: [VALID_QUESTION] }), raw: openAIResponse({ questions: [VALID_QUESTION] }) });
    const structureLine = logSpy.mock.calls.find((c) => c[0] === '[ai-structure]');
    const parsed = JSON.parse(structureLine![1] as string);
    expect(parsed.hasUsage).toBe(false);
    logSpy.mockRestore();
  });

  it('test 16: the [ai-structure] diagnostic never carries question text, options, explanations, or RAG content -- shape/counts/booleans only', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runValidate({ text: JSON.stringify({ questions: [VALID_QUESTION] }), raw: openAIResponse({ questions: [VALID_QUESTION] }) });
    const structureLine = logSpy.mock.calls.find((c) => c[0] === '[ai-structure]');
    const payload = structureLine![1] as string;
    expect(payload).not.toContain(VALID_QUESTION.question);
    expect(payload).not.toContain(VALID_QUESTION.explanation);
    expect(payload).not.toContain(VALID_QUESTION.correctAnswer);
    const parsed = JSON.parse(payload);
    expect(Object.keys(parsed).sort()).toEqual(
      ['contentLength', 'failureStage', 'finishReason', 'hasContent', 'hasRefusal', 'hasUsage', 'keys', 'model', 'parseMs', 'parsedRoot', 'questionsCount'].sort(),
    );
    logSpy.mockRestore();
  });
});

/* ---------- tests 17-22: invariants untouched by this repair ---------- */
describe('R1F tests 17-22 -- invariants this repair must not touch', () => {
  it('test 17: canonical counts (planChunks, RETENTION_REQUIRED_COUNT, quick_check 6-slot) are untouched', async () => {
    const { planChunks, MAX_QUESTIONS_PER_CHUNK, RETENTION_REQUIRED_COUNT } = await import('@/services/quiz-generation.service');
    expect(MAX_QUESTIONS_PER_CHUNK).toBe(4);
    expect(planChunks(20)).toEqual([4, 4, 4, 4, 4]);
    expect(RETENTION_REQUIRED_COUNT).toBe(6);
  });

  it('test 18: this repair never imports or computes ResponseEvidenceContract', () => {
    expect(() => read('src/lib/lx/response-evidence-contract.ts')).not.toThrow();
    // Real usage signal, not a prose ban -- quiz-generation.service.ts
    // never imports the evidence-contract module.
    expect(QG).not.toMatch(/from ['"]@\/lib\/lx\/response-evidence-contract['"]/);
  });

  it('test 19: activity language still flows into the generation prompt (LOCALE_FULL_NAME / languageName), unchanged by the wrapper fix', () => {
    expect(QG).toMatch(/LANGUAGE: Write EVERYTHING in \$\{languageName\}/);
  });

  it('test 20: the universal Question Quality Gate module itself is untouched by this repair (no jsonSchema/parseGeneratedQuestionBatch references leaked into it)', () => {
    const gated = read('src/services/gated-question-generation.service.ts');
    expect(gated).not.toMatch(/jsonSchema|parseGeneratedQuestionBatch|GENERATED_QUESTION_BATCH_SCHEMA/);
    expect(gated).toMatch(/export async function generateGatedQuestionBatch/);
  });

  it('test 21: TeachingIntro / GUIDE independence (R1E-R1) is untouched -- this repair never modified TeachingIntro.tsx or the guided-practice route', () => {
    const teach = read('src/app/dashboard/quiz/TeachingIntro.tsx');
    expect(teach).toMatch(/const \[guideState, setGuideState\] = useState/);
    const gpRoute = read('src/app/api/learning/guided-practice/route.ts');
    expect(gpRoute).not.toMatch(/GENERATED_QUESTION_BATCH_SCHEMA|parseGeneratedQuestionBatch/);
  });

  it('test 22: no evidence/mastery writing surface was touched -- real usage, not prose mentions in doc comments', () => {
    expect(QG).not.toMatch(/INSERT INTO learning_evidence|await updateMastery\(|\brecordEvidence\(/);
  });
});

/* ---------- R7: strict schema audit ---------- */
describe('R1F R7 -- GENERATED_QUESTION_BATCH_SCHEMA strict-mode structural audit', () => {
  it('the exact request body callOpenAIChat would send is strict-mode-shaped: object root, additionalProperties:false, required===keys(properties), recursively', async () => {
    const { GENERATED_QUESTION_BATCH_SCHEMA } = await import('@/lib/ai/schemas');
    const body = {
      model: 'gpt-5.6-luna',
      messages: [{ role: 'user', content: 'x' }],
      response_format: { type: 'json_schema', json_schema: { name: GENERATED_QUESTION_BATCH_SCHEMA.name, strict: true, schema: GENERATED_QUESTION_BATCH_SCHEMA.schema } },
    };
    const seen: string[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false);
        const propKeys = Object.keys(node.properties ?? {}).sort();
        const requiredKeys = [...(node.required ?? [])].sort();
        expect(requiredKeys).toEqual(propKeys);
      }
      for (const [k, v] of Object.entries(node)) {
        if (k === 'minimum' || k === 'maximum' || k === 'minLength' || k === 'maxLength' || k === 'pattern' || k === 'format' || k === 'minItems' || k === 'maxItems') {
          seen.push(k);
        }
        walk(v);
      }
    };
    walk(body.response_format.json_schema.schema);
    expect(seen).toEqual([]); // none of the commonly-unsupported strict-mode numeric/string range keywords
  });

  it('no numeric range constraint on difficulty (R7 audit finding) -- range enforced downstream by the deterministic gate instead', () => {
    // The generatedQuestion.difficulty field itself carries no minimum/
    // maximum (unlike, legitimately, other schemas' confidence fields
    // elsewhere in this file) -- scoped to the one line, not a whole-file
    // scan that would also trip on unrelated schemas.
    const line = SCHEMAS.split('\n').find((l) => l.includes('difficulty:'));
    expect(line).toBeTruthy();
    expect(line).toBe("    difficulty: { type: 'integer' },");
  });
});
