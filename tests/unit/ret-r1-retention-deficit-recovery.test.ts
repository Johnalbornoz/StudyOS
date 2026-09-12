/**
 * RET-R1 -- RETENTION QUALITY-GATE DEFICIT RECOVERY, evolved by RET-R2's
 * candidate-surplus reliability repair.
 *
 * Live failure: retention_check's Quality Gate rejected 1 of 6
 * questions (5 accepted); the old code discarded the ENTIRE 3-question
 * chunk containing that 1 rejection (throwing away 2 valid, already-
 * accepted questions) and regenerated a fresh chunk of 3, which itself
 * had 2 rejections on the recovery pass -- ending in a 500 even though
 * 5 of the original 6 questions, and most of the recovery batch, were
 * genuinely fine.
 *
 * RET-R1 fixed the deficit-preserving path: never discard accepted
 * questions, recover only the deficit. RET-R2 layered a candidate
 * SURPLUS on top: each initial chunk now requests 4 candidates (8
 * total, a surplus over the published 6), and any bounded recovery
 * requests deterministically more than the bare deficit
 * (recoveryCandidateCount(deficit) = min(6, max(3, deficit + 2))) so a
 * single recovery round can itself absorb a rejection. These fixtures
 * are sized accordingly: initial chunks carry 4 questions apiece
 * (INITIAL_CHUNK_SIZE), and recovery chunks are sized per-scenario to
 * match the deficit each scenario deliberately produces.
 *
 * This suite exercises the fixed deficit-preserving + surplus path
 * directly (mirrors tests/unit/quiz-generation-retention.test.ts's
 * mocking style exactly -- same executeAI/callModel/db/rag mocks --
 * plus one additional targeted mock of the deterministic Quality Gate
 * so specific questions, marked by a "DET_REJECT"/"SEMANTIC_REJECT"
 * substring in their own text, fail deterministically/semantically
 * while every other question passes through the real check, exactly
 * reproducing the live failure shape).
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

// The ONE new mock beyond the established retention test harness: a
// specific question (marked "DET_REJECT" in its own text) fails the
// deterministic Quality Gate, exactly like the live "1 of 6 rejected"
// trace. Everything else goes through the REAL deterministic check
// (proven safe by the existing suite passing with plain generic fake
// questions).
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

import {
  generateRetentionCheckQuestions,
  RETENTION_REQUIRED_COUNT,
  RETENTION_MAX_AI_CALLS_PER_ATTEMPT,
} from '@/services/quiz-generation.service';

/** RET-R2: mirrors production RETENTION_INITIAL_CANDIDATE_COUNT_PER_CHUNK (4). */
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
/** A clean (all-accepted) initial-wave chunk of INITIAL_CHUNK_SIZE (4) candidates. */
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

/* ============================================================== *
 * 1 -- initial surplus (8 candidates) all pass, no recovery.      *
 * ============================================================== */
describe('RET-R1 test 1 -- requested=6, initial 8/8 candidates pass -> no recovery', () => {
  it('returns exactly 6, exactly 2 AI calls, no RETENTION_DEFICIT_IDENTIFIED event', async () => {
    wireRealisticExecuteAI([{ text: cleanChunkText(0) }, { text: cleanChunkText(10) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6);
    expect(executeAIMock).toHaveBeenCalledTimes(2);
    expect(retentionEvents().some((e) => e.label === 'RETENTION_DEFICIT_IDENTIFIED')).toBe(false);
  });
});

/* ============================================================== *
 * 2-6, 10 -- the core fix: preserve accepted, recover only deficit,*
 * now against RET-R2's 4-per-chunk initial surplus.                *
 * ============================================================== */
describe('RET-R1 tests 2/3/4/5/6/10 -- 5 of 8 initial candidates pass, deficit-only recovery reaches exactly 6', () => {
  it('2. preserves the 5 accepted questions; deficit is exactly 1', async () => {
    // Chunk A: 3 of 4 candidates deterministically rejected -> 1 accepted. Chunk B: clean (4 accepted). Total accepted = 5, deficit = 1.
    const chunkAText = batch([
      fakeQuestion(0, { question: 'DET_REJECT a' }),
      fakeQuestion(1, { question: 'DET_REJECT b' }),
      fakeQuestion(2, { question: 'DET_REJECT c' }),
      fakeQuestion(3),
    ]);
    const chunkBText = cleanChunkText(10);
    const recovery = cleanChunkText(20, 3); // recoveryCandidateCount(deficit=1) === 3
    wireRealisticExecuteAI([{ text: chunkAText }, { text: chunkBText }, { text: recovery }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6);
    const gateEvent = retentionEvents().find((e) => e.label === 'RETENTION_INITIAL_GATE_COMPLETE')!;
    expect(gateEvent.acceptedCount).toBe(5);
    expect(gateEvent.rejectedCount).toBe(3);
    const deficitEvent = retentionEvents().find((e) => e.label === 'RETENTION_DEFICIT_IDENTIFIED')!;
    expect(deficitEvent.deficit).toBe(1);
  });

  it('3/10. only the deficit is added from the replacement chunk -- 2 of the 3 newly-generated, gate-passing replacements are simply unused, never inflating the batch past 6', async () => {
    const chunkAText = batch([
      fakeQuestion(0, { question: 'DET_REJECT a' }),
      fakeQuestion(1, { question: 'DET_REJECT b' }),
      fakeQuestion(2, { question: 'DET_REJECT c' }),
      fakeQuestion(3),
    ]);
    wireRealisticExecuteAI([{ text: chunkAText }, { text: cleanChunkText(10) }, { text: cleanChunkText(20, 3) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toHaveLength(6); // never 7 or 8, even though the replacement chunk generated 3 valid candidates for a deficit of 1
    const recoveryEvent = retentionEvents().find((e) => e.label === 'RETENTION_RECOVERY_COMPLETE')!;
    expect(recoveryEvent.replacementGeneratedCount).toBe(3);
    expect(recoveryEvent.replacementAcceptedCount).toBe(1);
  });

  it('4. the replacement wave succeeds -> final count is exactly the canonical 6', async () => {
    const chunkAText = batch([
      fakeQuestion(0, { question: 'DET_REJECT a' }),
      fakeQuestion(1, { question: 'DET_REJECT b' }),
      fakeQuestion(2, { question: 'DET_REJECT c' }),
      fakeQuestion(3),
    ]);
    wireRealisticExecuteAI([{ text: chunkAText }, { text: cleanChunkText(10) }, { text: cleanChunkText(20, 3) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result.length).toBe(RETENTION_REQUIRED_COUNT);
  });

  it('5. the 5 originally-accepted questions are never regenerated -- they appear verbatim in the final result and in the recovery exclusion note', async () => {
    const chunkAText = batch([
      fakeQuestion(0, { question: 'DET_REJECT a' }),
      fakeQuestion(1, { question: 'DET_REJECT b' }),
      fakeQuestion(2, { question: 'DET_REJECT c' }),
      fakeQuestion(3, { question: 'Keep me one' }),
    ]);
    const chunkBText = batch([
      fakeQuestion(10, { question: 'Keep me two' }),
      fakeQuestion(11, { question: 'Keep me three' }),
      fakeQuestion(12, { question: 'Keep me four' }),
      fakeQuestion(13, { question: 'Keep me five' }),
    ]);
    wireRealisticExecuteAI([{ text: chunkAText }, { text: chunkBText }, { text: cleanChunkText(20, 3) }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const texts = result.map((q) => q.question);
    for (const kept of ['Keep me one', 'Keep me two', 'Keep me three', 'Keep me four', 'Keep me five']) {
      expect(texts).toContain(kept);
    }
    const recoveryMsg = callModelMock.mock.calls[2][0].user as string;
    for (const kept of ['Keep me one', 'Keep me two', 'Keep me three', 'Keep me four', 'Keep me five']) {
      expect(recoveryMsg).toContain(kept);
    }
  });

  it('6. a rejected replacement never enters the final batch', async () => {
    const chunkAText = batch([
      fakeQuestion(0, { question: 'DET_REJECT a' }),
      fakeQuestion(1, { question: 'DET_REJECT b' }),
      fakeQuestion(2, { question: 'DET_REJECT c' }),
      fakeQuestion(3),
    ]);
    // Recovery chunk (deficit=1 -> recoveryCandidateCount=3): one of the three replacement candidates is itself deterministically rejected.
    const recoveryWithReject = batch([fakeQuestion(20, { question: 'DET_REJECT replacement' }), fakeQuestion(21), fakeQuestion(22)]);
    wireRealisticExecuteAI([{ text: chunkAText }, { text: cleanChunkText(10) }, { text: recoveryWithReject }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    const texts = result.map((q) => q.question);
    expect(texts).not.toContain('DET_REJECT replacement');
    expect(result).toHaveLength(6); // the other 2 clean replacement candidates still cover the deficit of 1 (only 1 needed)
  });
});

/* ============================================================== *
 * 7/8 -- replacements still go through both gate layers.          *
 * ============================================================== */
describe('RET-R1 tests 7/8 -- replacements are gated deterministically AND semantically, same as originals', () => {
  it('7. a deterministically-failing replacement batch is excluded even when it was the only candidate source for the deficit', async () => {
    const chunkAText = batch([
      fakeQuestion(0, { question: 'DET_REJECT a' }),
      fakeQuestion(1, { question: 'DET_REJECT b' }),
      fakeQuestion(2, { question: 'DET_REJECT c' }),
      fakeQuestion(3),
    ]);
    // deficit=1 -> recoveryCandidateCount=3; all 3 replacement candidates deterministically fail -> 0 usable replacements -> deficit cannot close.
    const recoveryAllRejected = batch([
      fakeQuestion(20, { question: 'DET_REJECT r1' }),
      fakeQuestion(21, { question: 'DET_REJECT r2' }),
      fakeQuestion(22, { question: 'DET_REJECT r3' }),
    ]);
    wireRealisticExecuteAI([{ text: chunkAText }, { text: cleanChunkText(10) }, { text: recoveryAllRejected }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
  });

  it('8. a semantically-failing replacement (deterministically inconclusive) is also excluded', async () => {
    const chunkAText = batch([
      fakeQuestion(0, { question: 'DET_REJECT a' }),
      fakeQuestion(1, { question: 'DET_REJECT b' }),
      fakeQuestion(2, { question: 'DET_REJECT c' }),
      fakeQuestion(3),
    ]);
    // fill_in_blank goes through semantic verification when deterministically inconclusive in this codebase's
    // real contract for many types; to keep this test independent of that exact routing, force the semantic
    // mock to fail via the SEMANTIC_REJECT marker on all 3 replacement candidates alongside a benign type.
    const recoverySemanticReject = batch([
      fakeQuestion(20, { question: 'SEMANTIC_REJECT r1' }),
      fakeQuestion(21, { question: 'SEMANTIC_REJECT r2' }),
      fakeQuestion(22, { question: 'SEMANTIC_REJECT r3' }),
    ]);
    wireRealisticExecuteAI([{ text: chunkAText }, { text: cleanChunkText(10) }, { text: recoverySemanticReject }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    // Whether these particular fixtures resolve deterministically or semantically, the point under test is
    // that a marked-bad replacement batch cannot close a real deficit by construction of this mock; assert
    // the batch is never inflated with clearly-marked-bad content instead of a same-length coincidence.
    const texts = result.map((q) => q.question);
    expect(texts.some((t) => t.includes('SEMANTIC_REJECT'))).toBe(false);
  });
});

/* ============================================================== *
 * 9 -- a duplicate replacement cannot fill the deficit.           *
 * ============================================================== */
describe('RET-R1 test 9 -- a duplicate replacement cannot fill the deficit', () => {
  it('a replacement that exactly duplicates an already-accepted question is filtered, leaving the deficit unmet -> []', async () => {
    const chunkAText = batch([
      fakeQuestion(0, { question: 'DET_REJECT a' }),
      fakeQuestion(1, { question: 'DET_REJECT b' }),
      fakeQuestion(2, { question: 'DET_REJECT c' }),
      fakeQuestion(3, { question: 'Unique kept question' }),
    ]);
    // deficit=1 -> recoveryCandidateCount=3; all 3 replacement candidates duplicate an already-accepted question's exact text.
    const recoveryAllDup = batch([
      fakeQuestion(20, { question: 'Unique kept question' }),
      fakeQuestion(21, { question: 'Unique kept question' }),
      fakeQuestion(22, { question: 'Unique kept question' }),
    ]);
    wireRealisticExecuteAI([{ text: chunkAText }, { text: cleanChunkText(10) }, { text: recoveryAllDup }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
  });
});

/* ============================================================== *
 * 11/12 -- bounded recovery exhausted -> explicit failure, no loop. *
 * ============================================================== */
describe('RET-R1 tests 11/12 -- bounded recovery cannot fill the count -> explicit failure, never a 4th call', () => {
  it('11. emits RETENTION_BATCH_INSUFFICIENT with RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS and full metadata, no question content', async () => {
    // Chunk A: 2 of 4 rejected -> 2 accepted. Chunk B: 2 of 4 rejected -> 2 accepted. Total accepted = 4, deficit = 2.
    const chunkAText = batch([
      fakeQuestion(0, { question: 'DET_REJECT a' }),
      fakeQuestion(1, { question: 'DET_REJECT b' }),
      fakeQuestion(2),
      fakeQuestion(3),
    ]);
    const chunkBText = batch([
      fakeQuestion(10, { question: 'DET_REJECT c' }),
      fakeQuestion(11, { question: 'DET_REJECT d' }),
      fakeQuestion(12),
      fakeQuestion(13),
    ]);
    // recoveryCandidateCount(deficit=2) === 4; only 1 of the 4 replacement candidates survives -> final accepted = 4 + 1 = 5 < 6.
    const recovery = batch([
      fakeQuestion(20, { question: 'DET_REJECT e' }),
      fakeQuestion(21, { question: 'DET_REJECT f' }),
      fakeQuestion(22, { question: 'DET_REJECT g' }),
      fakeQuestion(23),
    ]);
    wireRealisticExecuteAI([{ text: chunkAText }, { text: chunkBText }, { text: recovery }]);
    const result = await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(result).toEqual([]);
    const insufficientEvent = retentionEvents().find((e) => e.label === 'RETENTION_BATCH_INSUFFICIENT')!;
    expect(insufficientEvent.reason).toBe('RETENTION_INSUFFICIENT_ACCEPTED_QUESTIONS');
    expect(insufficientEvent.requestedCount).toBe(6);
    expect(typeof insufficientEvent.initialGeneratedCount).toBe('number');
    expect(typeof insufficientEvent.initialAcceptedCount).toBe('number');
    expect(typeof insufficientEvent.initialRejectedCount).toBe('number');
    expect(typeof insufficientEvent.replacementGeneratedCount).toBe('number');
    expect(typeof insufficientEvent.replacementAcceptedCount).toBe('number');
    expect(insufficientEvent.remainingDeficit).toBeGreaterThan(0);
    // No question content anywhere in the event.
    const serialized = JSON.stringify(insufficientEvent);
    expect(serialized).not.toContain('DET_REJECT');
    expect(serialized).not.toMatch(/"question"/);
  });

  it('12. never a 4th AI call regardless of how the deficit resolves', async () => {
    const chunkAText = batch([
      fakeQuestion(0, { question: 'DET_REJECT a' }),
      fakeQuestion(1, { question: 'DET_REJECT b' }),
      fakeQuestion(2),
      fakeQuestion(3),
    ]);
    const chunkBText = batch([
      fakeQuestion(10, { question: 'DET_REJECT c' }),
      fakeQuestion(11, { question: 'DET_REJECT d' }),
      fakeQuestion(12),
      fakeQuestion(13),
    ]);
    const recovery = batch([
      fakeQuestion(20, { question: 'DET_REJECT e' }),
      fakeQuestion(21, { question: 'DET_REJECT f' }),
      fakeQuestion(22, { question: 'DET_REJECT g' }),
      fakeQuestion(23),
    ]);
    wireRealisticExecuteAI([{ text: chunkAText }, { text: chunkBText }, { text: recovery }]);
    await generateRetentionCheckQuestions('c1', 's1', 'subj1', {});
    expect(executeAIMock.mock.calls.length).toBeLessThanOrEqual(RETENTION_MAX_AI_CALLS_PER_ATTEMPT);
  });
});

/* ============================================================== *
 * 13-20 -- integrity: no evidence writes, permissions/thresholds/  *
 * other paths unchanged.                                          *
 * ============================================================== */
describe('RET-R1 tests 13-20 -- retention integrity and mode isolation', () => {
  const QG = readFileSync(join(process.cwd(), 'src/services/quiz-generation.service.ts'), 'utf-8');
  const retentionFnSrc = QG.slice(QG.indexOf('export async function generateRetentionCheckQuestions'), QG.indexOf('async function retentionApplyGate'));

  it('13. no evidence write anywhere in the retention generation path', () => {
    expect(retentionFnSrc).not.toMatch(/INSERT INTO learning_evidence|UPDATE\s+\w+\s+SET/);
  });

  it('14. retention_check remains EvidenceMode INDEPENDENT (unchanged taxonomy)', () => {
    const taxonomy = readFileSync(join(process.cwd(), 'src/lib/activity-taxonomy.ts'), 'utf-8');
    expect(taxonomy).toMatch(/RETENTION_CHECK:\s*'INDEPENDENT'/);
  });

  it('15. no hint/guide language introduced into the retention fast path', () => {
    expect(retentionFnSrc.toLowerCase()).not.toMatch(/hint|guide/);
  });

  it('16. the canonical Retention published-count authority is unchanged: exactly 6', () => {
    expect(RETENTION_REQUIRED_COUNT).toBe(6);
  });

  it('17. Structured Output contract unchanged: jsonSchema + v3 prompt version still used by both initial and recovery calls', () => {
    expect(retentionFnSrc).toMatch(/jsonSchema: GENERATED_QUESTION_BATCH_SCHEMA/);
    expect(retentionFnSrc).toMatch(/promptVersion: prompt\.version/);
  });

  it('18/19/20. Practice / Quick Check / gated cumulative-exam-diagnostic batch functions are untouched by this repair', () => {
    expect(QG).toMatch(/export async function generatePracticeQuestions/);
    expect(QG).toMatch(/export async function generateQuickCheckQuestions/);
    expect(readFileSync(join(process.cwd(), 'src/services/gated-question-generation.service.ts'), 'utf-8')).toMatch(/export async function generateGatedQuestionBatch/);
  });
});
