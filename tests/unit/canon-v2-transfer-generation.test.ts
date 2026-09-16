/**
 * CANON-V2-ARCH-CLEANUP Section 9/28 -- THE CANONICAL TRANSFER
 * GENERATION SERVICE.
 *
 * `generateCanonicalTransferChallenges` generates 3 INDEPENDENT
 * challenges (one dedicated AI call per depth, never one call asked to
 * self-label a mixed batch), tags each with a deterministic
 * `transferDepth`, and NEVER publishes a partial/malformed set --
 * dropping any challenge whose own generation call failed or whose
 * difficulty fell outside D4-D5. `generateQuestionsForConcept` is
 * mocked directly (it is independently tested elsewhere against the
 * real AI stack).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ generate: vi.fn() }));

vi.mock('@/services/quiz-generation.service', async () => {
  const actual = await vi.importActual<typeof import('@/services/quiz-generation.service')>('@/services/quiz-generation.service');
  return { ...actual, generateQuestionsForConcept: (...a: any[]) => h.generate(...a) };
});

import { generateCanonicalTransferChallenges } from '@/services/canonical-transfer-generation.service';

const Q = (id: string, difficulty: number, type = 'scenario'): any => ({
  id, conceptId: 'c1', type, answerFormat: 'text', question: `question ${id}`,
  correctAnswer: 'a', explanation: 'e', difficulty,
});

const baseParams = {
  conceptId: 'c1',
  studentId: 's1',
  subjectId: 'subj1',
  difficulty: 4,
  guidance: 'g',
  language: 'en',
  visualAidRate: 0,
  ibContext: null,
};

beforeEach(() => {
  h.generate.mockReset();
});

describe('generateCanonicalTransferChallenges', () => {
  it('makes exactly 3 dedicated generation calls (one per depth), each requesting count:1 at D4-D5', async () => {
    h.generate
      .mockResolvedValueOnce([Q('near', 4)])
      .mockResolvedValueOnce([Q('ctx', 4)])
      .mockResolvedValueOnce([Q('high', 5)]);
    const result = await generateCanonicalTransferChallenges(baseParams);
    expect(h.generate).toHaveBeenCalledTimes(3);
    for (const call of h.generate.mock.calls) {
      expect(call[3]).toMatchObject({ count: 1 });
      expect(call[3].difficulty).toBeGreaterThanOrEqual(4);
      expect(call[3].difficulty).toBeLessThanOrEqual(5);
    }
    expect(result.finalQuestionCount).toBe(3);
  });

  it('tags each challenge with the correct, deterministic transferDepth -- never inferred from AI output', async () => {
    h.generate
      .mockResolvedValueOnce([Q('near', 4)])
      .mockResolvedValueOnce([Q('ctx', 4)])
      .mockResolvedValueOnce([Q('high', 5)]);
    const result = await generateCanonicalTransferChallenges(baseParams);
    const depths = result.questions.map((q: any) => q.transferDepth).sort();
    expect(depths).toEqual(['CONTEXTUAL', 'HIGHER', 'NEAR']);
  });

  it('never publishes a partial set -- if one depth\'s own generation call returns nothing, the final set is short (never padded/fabricated)', async () => {
    h.generate
      .mockResolvedValueOnce([Q('near', 4)])
      .mockResolvedValueOnce([]) // CONTEXTUAL generation failed
      .mockResolvedValueOnce([Q('high', 5)]);
    const result = await generateCanonicalTransferChallenges(baseParams);
    expect(result.finalQuestionCount).toBe(2);
    expect(result.questions.some((q: any) => q.transferDepth === 'CONTEXTUAL')).toBe(false);
  });

  it('rejects (never publishes) a generated challenge whose difficulty falls outside D4-D5', async () => {
    h.generate
      .mockResolvedValueOnce([Q('near', 2)]) // out of range -- rejected
      .mockResolvedValueOnce([Q('ctx', 4)])
      .mockResolvedValueOnce([Q('high', 5)]);
    const result = await generateCanonicalTransferChallenges(baseParams);
    expect(result.finalQuestionCount).toBe(2);
    expect(result.challengeDiagnostics.find((d) => d.depth === 'NEAR')).toMatchObject({ generated: true, difficultyInRange: false });
  });

  it('never throws when a generation call itself rejects -- degrades to a short result instead', async () => {
    h.generate
      .mockRejectedValueOnce(new Error('AI provider down'))
      .mockResolvedValueOnce([Q('ctx', 4)])
      .mockResolvedValueOnce([Q('high', 5)]);
    const result = await generateCanonicalTransferChallenges(baseParams);
    expect(result.finalQuestionCount).toBe(2);
  });
});
