/**
 * LX-9R3 D3 -- required tests 25 and 26, against the REAL
 * `verifyQuestionQualityBatch` (not mocked, unlike every other LX-9R3
 * file) so its own 1:1 id-mapping and fail-closed behavior is actually
 * exercised, not merely assumed. Only the network boundary
 * (executeAI/callModel) is mocked, using the SAME
 * call/validate/fallback-invoking executeAI mock this codebase already
 * uses throughout tests/unit/quiz-generation-retention.test.ts and the
 * RET-R2/RET-R3 suites.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeAIMock = vi.fn();
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>();
  return { ...actual, executeAI: (...a: any[]) => executeAIMock(...a) };
});

const callModelMock = vi.fn();
vi.mock('@/lib/ai/adapters/call-model', () => ({ callModel: (...a: any[]) => callModelMock(...a) }));

import { verifyQuestionQualityBatch, evaluateQuestionQualityVerdict } from '@/services/question-quality-verifier.service';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';

function q(id: string): GeneratedQuestion {
  return {
    id, conceptId: 'c1', type: 'short_answer', answerFormat: 'text', question: `Question ${id}`,
    correctAnswer: 'a', explanation: 'e', difficulty: 3,
  };
}

function wireCallModel(responseText: string | (() => never)) {
  callModelMock.mockReset().mockImplementation(async () => {
    if (typeof responseText === 'function') return responseText();
    return { text: responseText, raw: {}, provider: 'openai', model: 'gpt-5.6-terra' };
  });
  executeAIMock.mockReset().mockImplementation(async (opts: any) => {
    let raw: any;
    try {
      raw = await opts.call(new AbortController().signal);
    } catch (err: any) {
      throw err; // verifyQuestionQualityBatch itself catches AIExecutionFailure / any throw -- let it propagate like the real gateway would on a hard failure
    }
    const validation = opts.validate(raw);
    return { result: validation.value, execution: {} as any, provenance: {} as any };
  });
}

beforeEach(() => {
  callModelMock.mockReset();
  executeAIMock.mockReset();
});

describe('LX-9R3 performance 25 -- one verdict per candidate, strictly by id, never by array position', () => {
  it('a response with candidates out of order, one missing, and one foreign id maps correctly -- never shifted, never cross-applied', async () => {
    wireCallModel(
      JSON.stringify({
        verdicts: [
          // id "1" first in the array, but must still map to candidate "1" -- never position 0.
          { id: '1', conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true, distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.9 },
          // A foreign id not among the requested candidates -- must be ignored entirely.
          { id: 'not-a-real-candidate', conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true, distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.9 },
          // id "2" is a REJECTION -- must never be conflated with id "0" or "1"'s verdicts.
          { id: '2', conceptAligned: false, answerCorrect: true, unambiguous: true, reasoningConsistent: true, distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: ['bad'], confidence: 0.9 },
          // id "0" is intentionally OMITTED -- must degrade to null (fail-closed), never inherit a neighbor's verdict.
        ],
      }),
    );
    const result = await verifyQuestionQualityBatch({
      candidates: [{ id: '0', question: q('0') }, { id: '1', question: q('1') }, { id: '2', question: q('2') }],
      requestedLanguage: 'en',
    });
    expect(result.get('0')).toBeNull(); // omitted -> fail-closed null, never borrowed from a sibling
    expect(evaluateQuestionQualityVerdict(result.get('1') ?? null).pass).toBe(true);
    expect(evaluateQuestionQualityVerdict(result.get('2') ?? null).pass).toBe(false); // its OWN rejection, not id 1's approval
    expect(result.has('not-a-real-candidate')).toBe(false); // a foreign id is never assigned to anything
    expect(result.size).toBe(3); // exactly the requested candidates, nothing added
  });

  it('a malformed verdict for one id (missing required boolean fields) degrades ONLY that id to null, never the whole batch', async () => {
    wireCallModel(
      JSON.stringify({
        verdicts: [
          { id: 'a', conceptAligned: 'yes' /* wrong type -- malformed */, confidence: 0.9 },
          { id: 'b', conceptAligned: true, answerCorrect: true, unambiguous: true, reasoningConsistent: true, distractorsPlausible: true, scenarioAppropriate: true, visualConsistent: true, issues: [], confidence: 0.9 },
        ],
      }),
    );
    const result = await verifyQuestionQualityBatch({
      candidates: [{ id: 'a', question: q('a') }, { id: 'b', question: q('b') }],
      requestedLanguage: 'en',
    });
    expect(result.get('a')).toBeNull();
    expect(evaluateQuestionQualityVerdict(result.get('b') ?? null).pass).toBe(true);
  });
});

describe('LX-9R3 performance 26 -- no candidate is ever approved without its own required semantic check', () => {
  it('an empty verdicts array leaves every candidate at its fail-closed null default', async () => {
    wireCallModel(JSON.stringify({ verdicts: [] }));
    const result = await verifyQuestionQualityBatch({
      candidates: [{ id: '0', question: q('0') }, { id: '1', question: q('1') }],
      requestedLanguage: 'en',
    });
    expect(result.get('0')).toBeNull();
    expect(result.get('1')).toBeNull();
    for (const v of result.values()) expect(evaluateQuestionQualityVerdict(v).pass).toBe(false);
  });

  it('a hard call failure (thrown, e.g. provider error) fails EVERY candidate closed -- never approves anything', async () => {
    wireCallModel(() => {
      throw new Error('provider down');
    });
    const result = await verifyQuestionQualityBatch({
      candidates: [{ id: '0', question: q('0') }, { id: '1', question: q('1') }, { id: '2', question: q('2') }],
      requestedLanguage: 'en',
    });
    expect(result.size).toBe(3);
    for (const v of result.values()) {
      expect(v).toBeNull();
      expect(evaluateQuestionQualityVerdict(v).pass).toBe(false);
    }
  });

  it('an unparseable response body fails every candidate closed rather than throwing', async () => {
    wireCallModel('not valid json at all {{{');
    const result = await verifyQuestionQualityBatch({
      candidates: [{ id: '0', question: q('0') }],
      requestedLanguage: 'en',
    });
    expect(result.get('0')).toBeNull();
  });
});
