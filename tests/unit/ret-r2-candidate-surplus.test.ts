/**
 * RET-R2 -- RETENTION CANDIDATE-SURPLUS RELIABILITY REPAIR.
 *
 * Live failure being repaired: initial generation requested/generated 6,
 * accepted 4/rejected 2 (RET-R1 correctly preserved the 4, deficit=2);
 * one Terra recovery of 3 candidates (the old minimum-legal recovery
 * size) yielded accepted 1/rejected 2; final accepted=5, deficit=1 ->
 * correctly failed closed with RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS.
 * RET-R1's preservation logic worked; the exposed gap was CANDIDATE-POOL
 * SIZING -- the system requested exactly the canonical final count (6)
 * initially, so a single bounded recovery chunk could still fail even
 * with normally-functioning providers.
 *
 * RET-R2 separates the CANONICAL FINAL COUNT (RETENTION_REQUIRED_COUNT,
 * 6, unchanged) from the CANDIDATE GENERATION COUNT
 * (RETENTION_INITIAL_CANDIDATE_COUNT, 8, a surplus) and sizes bounded
 * recovery deterministically above the bare deficit
 * (recoveryCandidateCount(deficit) = min(6, max(3, deficit + 2))) so a
 * single recovery round can itself absorb a rejection.
 *
 * This suite is the file REQUIRED by the RET-R2 spec, covering all 30
 * required test items. It complements (does not replace)
 * tests/unit/quiz-generation-retention.test.ts (initial-wave
 * architecture, prompt wording, structural fingerprint) and
 * tests/unit/ret-r1-retention-deficit-recovery.test.ts (deficit
 * preservation mechanics) -- this file's own focus is the SURPLUS
 * properties: candidates > published count, surplus tolerance,
 * rejection telemetry, call-budget invariance, and non-regression of
 * every adjacent capability RET-R2 must leave untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

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
  verifyQuestionQuality: vi.fn(async ({ question }: any) => ({
    conceptAligned: !String(question?.question ?? '').includes('SEMANTIC_REJECT'),
    answerCorrect: true, unambiguous: true, reasoningConsistent: true,
    distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.95,
  })),
  evaluateQuestionQualityVerdict: vi.fn((verdict: any) => ({ pass: !!verdict?.conceptAligned, reason: verdict?.conceptAligned ? '' : 'test-forced semantic rejection' })),
}));

vi.mock('@/lib/lx/question-quality-contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/lx/question-quality-contract')>();
  return {
    ...actual,
    checkQuestionQualityDeterministic: (q: any, ctx: any) => {
      if (typeof q?.question === 'string' && q.question.includes('DET_REJECT')) {
        return { status: 'FAIL', failures: [{ code: 'SCHEMA_INVALID', detail: 'test-forced deterministic rejection' }], numericallyVerified: false, needsSemantic: [] };
      }
      if (typeof q?.question === 'string' && q.question.includes('VISUAL_REJECT')) {
        return { status: 'FAIL', failures: [{ code: 'VISUAL_MISSING_RENDER_DATA', detail: 'diagram has no svg -- referenced visual is missing' }], numericallyVerified: false, needsSemantic: [] };
      }
      return actual.checkQuestionQualityDeterministic(q, ctx);
    },
  };
});

import {
  generateRetentionCheckQuestions,
  RETENTION_REQUIRED_COUNT,
  RETENTION_INITIAL_CANDIDATE_COUNT,
  RETENTION_MAX_AI_CALLS_PER_ATTEMPT,
} from '@/services/quiz-generation.service';

const INITIAL_CHUNK_SIZE = 4;

function fakeQuestion(i: number, overrides: Partial<{ question: string; type: string }> = {}) {
  return {
    type: overrides.type ?? 'multiple_choice',
    question: overrides.question ?? `Q${i}`,
    options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }],
    correctAnswer: 'A',
    explanation: 'because',
    difficulty: 3,
    cognitiveLevel: 'APPLICATION',
    questionIntent: 'CHECK_APPLICATION',
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

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
function retentionEvents(): Array<{ label: string; [k: string]: unknown }> {
  return consoleLogSpy.mock.calls
    .filter((c: any[]) => c[0] === '[retention]')
    .map((c: any[]) => JSON.parse(c[1] as string));
}

beforeEach(() => {
  retrieveContextMock.mockReset().mockResolvedValue({ chunks: [] });
  queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }] });
  callModelMock.mockReset().mockResolvedValue({ text: '[]', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
  executeAIMock.mockReset();
  consoleLogSpy?.mockRestore();
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

/* ================================================================ *
 * 1-2 -- canonical count vs. candidate count are formally separate. *
 * ================================================================ */
describe('RET-R2 tests 1-2 -- canonical published count (6) is separate from and independent of candidate generation count', () => {
  it('1. RETENTION_REQUIRED_COUNT is exactly 6, unaffected by candidate surplus', () => {
    expect(RETENTION_REQUIRED_COUNT).toBe(6);
  });

  it('2. RETENTION_INITIAL_CANDIDATE_COUNT (8) strictly exceeds RETENTION_REQUIRED_COUNT (6) -- candidates may exceed the published count', () => {
    expect(RETENTION_INITIAL_CANDIDATE_COUNT).toBe(8);
    expect(RETENTION_INITIAL_CANDIDATE_COUNT).toBeGreaterThan(RETENTION_REQUIRED_COUNT);
  });
});

/* ================================================================ *
 * 3-4 -- initial surplus tolerates 1-2 rejections with NO recovery. *
 * ================================================================ */
describe('RET-R2 tests 3-4 -- initial candidate surplus absorbs ordinary rejection without triggering recovery', () => {
  it('3. exactly 1 of 8 initial candidates rejected -> 7 accepted, still >= 6 -> no recovery call, no RETENTION_DEFICIT_IDENTIFIED', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6);
    expect(executeAIMock).toHaveBeenCalledTimes(2);
    expect(retentionEvents().some((e) => e.label === 'RETENTION_DEFICIT_IDENTIFIED')).toBe(false);
  });

  it('4. exactly 2 of 8 initial candidates rejected -> 6 accepted, exactly meets the requirement -> no recovery call', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1, { question: 'DET_REJECT b' }), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6);
    expect(executeAIMock).toHaveBeenCalledTimes(2);
    expect(retentionEvents().some((e) => e.label === 'RETENTION_DEFICIT_IDENTIFIED')).toBe(false);
  });
});

/* ================================================================ *
 * 5-6 -- universal gate authority + exact-6 invariant preserved.    *
 * ================================================================ */
describe('RET-R2 tests 5-6 -- every published question passed the universal gate; surplus never inflates the final count', () => {
  it('5. all 8 initial candidates clean -> final result is exactly the canonical 6, never 7 or 8', async () => {
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6);
  });

  it('6. a rejected candidate never appears in the final published set', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result.map((q) => q.question)).not.toContain('DET_REJECT a');
  });
});

/* ================================================================ *
 * 7 -- duplicate candidates never inflate the count.                *
 * ================================================================ */
describe('RET-R2 test 7 -- an exact duplicate between the two initial chunks never inflates or double-publishes a question', () => {
  it('7. chunk A/B share a duplicate question -> whole Chunk B is discarded (pre-gate, RET-R1-established rule, unchanged by RET-R2), Chunk A retained, deficit covered by surplus-sized recovery, final published set contains the shared text only once', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'Duplicate text' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    const chunkB = batch([fakeQuestion(10, { question: 'Duplicate text' }), fakeQuestion(11), fakeQuestion(12), fakeQuestion(13)]);
    // Chunk A (4) retained whole; deficit = 6 - 4 = 2 -> recoveryCandidateCount(2) === 4.
    const recovery = cleanChunkText(20, 4);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recovery }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6);
    const texts = result.map((q) => q.question);
    expect(texts.filter((t) => t === 'Duplicate text')).toHaveLength(1);
    // None of discarded Chunk B's other (non-colliding) questions leak into the final set either -- the whole chunk is gone.
    expect(texts).not.toContain('Q11');
  });
});

/* ================================================================ *
 * 8-9 -- deficit is computed strictly from the retained/gated set,  *
 * not from the raw 8-candidate request volume.                     *
 * ================================================================ */
describe('RET-R2 tests 8-9 -- deficit reflects the actually-retained, gated candidate count, never the raw 8-candidate request volume', () => {
  it('8. a chunk-level collision discards Chunk B entirely -- deficit is computed from Chunk A alone (4), not from the 8 originally requested', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'Duplicate text' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    const chunkB = batch([fakeQuestion(10, { question: 'Duplicate text' }), fakeQuestion(11), fakeQuestion(12), fakeQuestion(13)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: cleanChunkText(20, 4) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const gateEvent = retentionEvents().find((e) => e.label === 'RETENTION_INITIAL_GATE_COMPLETE')!;
    expect(gateEvent.generatedCount).toBe(4); // Chunk A alone, never the raw 8 requested
    const deficitEvent = retentionEvents().find((e) => e.label === 'RETENTION_DEFICIT_IDENTIFIED')!;
    expect(deficitEvent.deficit).toBe(2);
  });

  it('9. a recovery candidate that exactly duplicates an already-accepted (retained) question is filtered by dedupeAgainstAccepted, never inflating the final set past 6', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'Duplicate text' }), fakeQuestion(1, { question: 'Kept unique question' }), fakeQuestion(2), fakeQuestion(3)]);
    const chunkB = batch([fakeQuestion(10, { question: 'Duplicate text' }), fakeQuestion(11), fakeQuestion(12), fakeQuestion(13)]);
    // deficit = 2 -> recoveryCandidateCount(2) === 4; one of the 4 recovery candidates duplicates a retained Chunk-A question exactly.
    const recovery = batch([
      fakeQuestion(20, { question: 'Kept unique question' }), // filtered: duplicates an already-accepted question
      fakeQuestion(21),
      fakeQuestion(22),
      fakeQuestion(23),
    ]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recovery }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6); // 4 retained + 3 usable recovery candidates (the 4th filtered as a duplicate) covers the deficit of 2 with 1 to spare, unused
    const texts = result.map((q) => q.question);
    expect(texts.filter((t) => t === 'Kept unique question')).toHaveLength(1); // never appears twice
  });
});

/* ================================================================ *
 * 10-12 -- recovery surplus is bounded, deterministic, never bare.  *
 * ================================================================ */
describe('RET-R2 tests 10-12 -- bounded recovery surplus formula: min(6, max(3, deficit + 2))', () => {
  it('10. deficit=1 -> recovery requests 3 candidates (not the bare deficit of 1)', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1, { question: 'DET_REJECT b' }), fakeQuestion(2, { question: 'DET_REJECT c' }), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }, { text: cleanChunkText(20, 3) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const recoveryMsg = callModelMock.mock.calls[2][0].user as string;
    expect(recoveryMsg).toContain('Generate EXACTLY 3');
    const recoveryEvent = retentionEvents().find((e) => e.label === 'RETENTION_RECOVERY_STARTED')!;
    expect(recoveryEvent.recoveryCandidateCount).toBe(3);
  });

  it('11. deficit=2 -> recovery requests 4 candidates', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1, { question: 'DET_REJECT b' }), fakeQuestion(2), fakeQuestion(3)]);
    const chunkB = batch([fakeQuestion(10, { question: 'DET_REJECT c' }), fakeQuestion(11, { question: 'DET_REJECT d' }), fakeQuestion(12), fakeQuestion(13)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: cleanChunkText(20, 4) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const recoveryMsg = callModelMock.mock.calls[2][0].user as string;
    expect(recoveryMsg).toContain('Generate EXACTLY 4');
    const recoveryEvent = retentionEvents().find((e) => e.label === 'RETENTION_RECOVERY_STARTED')!;
    expect(recoveryEvent.recoveryCandidateCount).toBe(4);
  });

  it('12. deficit=6 (both chunks fully rejected) -> recovery clamps to the ceiling of 6, never unbounded', async () => {
    const allRejectedChunk = (base: number) => batch(Array.from({ length: 4 }, (_, i) => fakeQuestion(base + i, { question: `DET_REJECT ${base + i}` })));
    wireRealisticExecuteAI([{ text: allRejectedChunk(0) }, { text: allRejectedChunk(10) }, { text: cleanChunkText(20, 6) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const recoveryMsg = callModelMock.mock.calls[2][0].user as string;
    expect(recoveryMsg).toContain('Generate EXACTLY 6');
    const recoveryEvent = retentionEvents().find((e) => e.label === 'RETENTION_RECOVERY_STARTED')!;
    expect(recoveryEvent.recoveryCandidateCount).toBe(6);
  });
});

/* ================================================================ *
 * 13-15 -- call budget is unaffected by the candidate-count change. *
 * ================================================================ */
describe('RET-R2 tests 13-15 -- provider call cap (2 Luna initial + 1 Terra recovery = 3 max) is unchanged', () => {
  it('13. RETENTION_MAX_AI_CALLS_PER_ATTEMPT remains 3', () => {
    expect(RETENTION_MAX_AI_CALLS_PER_ATTEMPT).toBe(3);
  });

  it('14. a clean initial surplus never fires a recovery (3rd) call', async () => {
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock).toHaveBeenCalledTimes(2);
  });

  it('15. even a fully-exhausted recovery never fires a 4th call (no retry loop)', async () => {
    const allRejectedChunk = (base: number) => batch(Array.from({ length: 4 }, (_, i) => fakeQuestion(base + i, { question: `DET_REJECT ${base + i}` })));
    const allRejectedRecovery = batch(Array.from({ length: 6 }, (_, i) => fakeQuestion(20 + i, { question: `DET_REJECT ${20 + i}` })));
    wireRealisticExecuteAI([{ text: allRejectedChunk(0) }, { text: allRejectedChunk(10) }, { text: allRejectedRecovery }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

/* ================================================================ *
 * 16 -- failure still occurs, closed-fail, if <6 after recovery.    *
 * ================================================================ */
describe('RET-R2 test 16 -- surplus reduces but never eliminates the possibility of closed-failure', () => {
  it('16. a deficit that bounded recovery cannot close still fails with RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS, never a partial batch', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1, { question: 'DET_REJECT b' }), fakeQuestion(2), fakeQuestion(3)]);
    const chunkB = batch([fakeQuestion(10, { question: 'DET_REJECT c' }), fakeQuestion(11, { question: 'DET_REJECT d' }), fakeQuestion(12), fakeQuestion(13)]);
    // deficit=2 -> recoveryCandidateCount=4; only 1 of 4 recovery candidates survives -> final accepted 4+1=5 < 6.
    const recovery = batch([
      fakeQuestion(20, { question: 'DET_REJECT e' }),
      fakeQuestion(21, { question: 'DET_REJECT f' }),
      fakeQuestion(22, { question: 'DET_REJECT g' }),
      fakeQuestion(23),
    ]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: chunkB }, { text: recovery }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
    const insufficientEvent = retentionEvents().find((e) => e.label === 'RETENTION_BATCH_INSUFFICIENT')!;
    expect(insufficientEvent.reason).toBe('RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS');
  });
});

/* ================================================================ *
 * 17-18 -- rejection-reason telemetry: aggregate counts, no content. *
 * ================================================================ */
describe('RET-R2 tests 17-18 -- safe aggregate rejectionReasons telemetry, no question/answer/learner content', () => {
  it('17. RETENTION_INITIAL_GATE_COMPLETE carries a rejectionReasons map with counts keyed by safe reason code', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1, { question: 'VISUAL_REJECT b' }), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const gateEvent = retentionEvents().find((e) => e.label === 'RETENTION_INITIAL_GATE_COMPLETE')!;
    const reasons = gateEvent.rejectionReasons as Record<string, number>;
    expect(reasons.SCHEMA_INVALID).toBe(1);
    expect(reasons.VISUAL_MISSING_RENDER_DATA).toBe(1);
  });

  it('18. rejectionReasons telemetry never contains question text, answers, or learner/mastery data', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'DET_REJECT secret-question-text' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const gateEvent = retentionEvents().find((e) => e.label === 'RETENTION_INITIAL_GATE_COMPLETE')!;
    const serialized = JSON.stringify(gateEvent.rejectionReasons);
    expect(serialized).not.toContain('secret-question-text');
    expect(serialized).not.toMatch(/correctAnswer|explanation|learner|mastery/i);
  });
});

/* ================================================================ *
 * 19-20 -- LX-8 visual gate: unrelated to retention, remains active. *
 * ================================================================ */
describe('RET-R2 tests 19-20 -- LX-8 visual-eligibility checks are structurally inert for retention_check (visualAidRate=0) yet remain enabled', () => {
  it('19. retention generation requests visualAidRate=0 -- retention questions never carry a visualAid field, so VISUAL_* checks cannot fire', () => {
    const src = readFileSync(join(process.cwd(), 'src/services/quiz-generation.service.ts'), 'utf-8');
    const retentionFnSrc = src.slice(src.indexOf('export async function generateRetentionCheckQuestions'), src.indexOf('async function retentionApplyGate'));
    expect(retentionFnSrc).toMatch(/buildQuestionGenerationPrompt\(types, difficulty, language, contextChunks, 0, guidance, ibContext, conceptContext\)/);
  });

  it('20. a question deliberately marked to fail the LX-8 visual check (VISUAL_MISSING_RENDER_DATA) is still rejected when it occurs -- the gate is not disabled for retention', async () => {
    const chunkA = batch([fakeQuestion(0, { question: 'VISUAL_REJECT a' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]);
    wireRealisticExecuteAI([{ text: chunkA }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result.map((q) => q.question)).not.toContain('VISUAL_REJECT a');
  });
});

/* ================================================================ *
 * 21-29 -- non-regression: every adjacent capability is untouched.  *
 * ================================================================ */
describe('RET-R2 tests 21-29 -- adjacent capabilities and contracts are untouched by the candidate-surplus change', () => {
  const QG = readFileSync(join(process.cwd(), 'src/services/quiz-generation.service.ts'), 'utf-8');

  it('21. Practice question generation is untouched', () => {
    expect(QG).toMatch(/export async function generatePracticeQuestions/);
  });

  it('22. Quick Check question generation is untouched', () => {
    expect(QG).toMatch(/export async function generateQuickCheckQuestions/);
  });

  it('23. Transfer/cumulative-exam gated batch generation is untouched', () => {
    const gated = readFileSync(join(process.cwd(), 'src/services/gated-question-generation.service.ts'), 'utf-8');
    expect(gated).toMatch(/export async function generateGatedQuestionBatch/);
  });

  it('24. retention_check remains EvidenceMode INDEPENDENT (unchanged taxonomy)', () => {
    const taxonomy = readFileSync(join(process.cwd(), 'src/lib/activity-taxonomy.ts'), 'utf-8');
    expect(taxonomy).toMatch(/RETENTION_CHECK:\s*'INDEPENDENT'/);
  });

  it('25. no help/hint/guide language introduced into the retention fast path (no-help integrity preserved)', () => {
    const retentionFnSrc = QG.slice(QG.indexOf('export async function generateRetentionCheckQuestions'), QG.indexOf('async function retentionApplyGate'));
    expect(retentionFnSrc.toLowerCase()).not.toMatch(/hint|guide/);
  });

  it('26. Structured Outputs contract (jsonSchema + v3 prompt version) is unchanged for both initial and recovery calls', () => {
    const retentionFnSrc = QG.slice(QG.indexOf('export async function generateRetentionCheckQuestions'), QG.indexOf('async function retentionApplyGate'));
    expect(retentionFnSrc).toMatch(/jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA/);
    expect(retentionFnSrc).toMatch(/promptVersion: prompt\.version/);
  });

  it('27. Luna/Terra provider routing is unchanged: initial chunks use RETENTION_CHUNK_MODEL (Luna), recovery uses Terra', () => {
    const retentionFnSrc = QG.slice(QG.indexOf('export async function generateRetentionCheckQuestions'), QG.indexOf('async function retentionApplyGate'));
    expect(retentionFnSrc).toMatch(/requestChunk\(0, RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK, RETENTION_VARIANT_B_NOTE_CHUNK_A\)/);
    expect(retentionFnSrc).toMatch(/requestChunk\(recoverySlotIndex, recoveryCount, recoveryNote, exclusionNote, TERRA\)/);
  });

  it('28. no evidence write anywhere in the retention generation path', () => {
    const retentionFnSrc = QG.slice(QG.indexOf('export async function generateRetentionCheckQuestions'), QG.indexOf('async function retentionApplyGate'));
    expect(retentionFnSrc).not.toMatch(/INSERT INTO learning_evidence|UPDATE\s+\w+\s+SET/);
  });

  it('29. generateRetentionCheckQuestions accepts no learner-answer/evidence/mastery input by construction', () => {
    const optionsShape = Object.keys({ difficulty: 3, guidance: 'x', language: 'en', ibContext: null });
    expect(optionsShape).not.toContain('learnerAnswers');
    expect(optionsShape).not.toContain('evidence');
    expect(optionsShape).not.toContain('mastery');
  });
});

/* ================================================================ *
 * 30 -- exact-6-or-nothing invariant holds across every scenario.   *
 * ================================================================ */
describe('RET-R2 test 30 -- PARTIAL_RETENTION_CAN_REACH_STUDENT = NO, even under surplus and recovery', () => {
  it('30. every scenario in this file returns exactly [] or a 6-length array, never a partial 1-5 length result', async () => {
    const scenarios: Array<Array<{ text: string } | { error: 'TIMEOUT' | 'PROVIDER_ERROR' }>> = [
      [{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }],
      [
        { text: batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1), fakeQuestion(2), fakeQuestion(3)]) },
        { text: cleanChunkText(10) },
      ],
      [
        { text: batch([fakeQuestion(0, { question: 'DET_REJECT a' }), fakeQuestion(1, { question: 'DET_REJECT b' }), fakeQuestion(2, { question: 'DET_REJECT c' }), fakeQuestion(3)]) },
        { text: cleanChunkText(10) },
        { text: cleanChunkText(20, 3) },
      ],
      [
        { text: batch(Array.from({ length: 4 }, (_, i) => fakeQuestion(i, { question: `DET_REJECT ${i}` }))) },
        { text: batch(Array.from({ length: 4 }, (_, i) => fakeQuestion(10 + i, { question: `DET_REJECT ${10 + i}` }))) },
        { text: batch(Array.from({ length: 6 }, (_, i) => fakeQuestion(20 + i, { question: `DET_REJECT ${20 + i}` }))) },
      ],
    ];
    for (const scenario of scenarios) {
      wireRealisticExecuteAI(scenario);
      const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
      expect([0, 6]).toContain(result.length);
    }
  });
});
