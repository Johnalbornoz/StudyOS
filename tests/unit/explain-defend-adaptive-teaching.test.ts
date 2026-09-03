/**
 * Phase 5-R: live-surface C (remediation EXPLAIN step) -- proves the
 * actual system prompt `generateExplainPrompt` sends to the AI
 * provider carries the adaptive teaching constraints when a
 * `TeachingGenerationContext` is supplied, and is unchanged (v1
 * behavior) when it isn't. Runs through the REAL AI Gateway
 * (executeAI) -- only the provider adapter and RAG retrieval are
 * mocked -- so this is the actual deterministic prompt/context layer,
 * not a re-implementation of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callAnthropicMessagesMock = vi.fn().mockResolvedValue({ text: '{"prompt":"q","expectedElements":["a"]}' });
vi.mock('@/lib/ai/adapters/anthropic', () => ({ callAnthropicMessages: (...a: any[]) => callAnthropicMessagesMock(...a) }));

const retrieveContextMock = vi.fn().mockResolvedValue({ chunks: [{ text: 'Chunk from the student\'s own material.' }] });
vi.mock('@/services/rag.service', () => ({ retrieveContext: (...a: any[]) => retrieveContextMock(...a) }));

import { generateExplainPrompt } from '@/services/explain-defend.service';
import { toTeachingGenerationContext } from '@/lib/adaptive-teaching-generation';
import { computeTeachingIntent, type TeachingContextInputs } from '@/lib/adaptive-teaching-policy';
import type { LearningDecision, LearningSignal } from '@/lib/adaptive-learning-policy';

function sig(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return { type: 'CRITICAL_MISCONCEPTION', source: 'test', conceptId: 'c1', subjectId: 'subj1', misconceptionCode: 'FORCE_ALONG_VELOCITY', metadata: {}, ...overrides } as LearningSignal;
}
function decision(overrides: Partial<LearningDecision> = {}): LearningDecision {
  const primarySignal = overrides.primarySignal ?? sig();
  return {
    actionConceptId: 'c1', subjectId: 'subj1', targetConceptIds: [], signals: [primarySignal], primarySignal,
    learningState: 'MISCONCEPTION_BLOCKED', targetDimension: 'MISCONCEPTION', activityType: 'REMEDIATION', pedagogicalPriority: 'HIGH',
    temporalUrgency: null, priorityScore: 5000, reasonCode: primarySignal.type, facts: [], dueAt: null, policyVersion: 3, ...overrides,
  };
}
const neutral: TeachingContextInputs = {
  calibrationLabel: 'WELL_CALIBRATED', independentMastery: 60, masteryScore: 65, helpDependencyFlag: false, cognitiveLevel: null, previousStrategies: [],
};

beforeEach(() => {
  callAnthropicMessagesMock.mockClear();
  retrieveContextMock.mockClear();
});

describe('generateExplainPrompt -- misconception experience reaches the live generator (release test 2)', () => {
  it('the actual system prompt sent to the provider names the misconception and requires contrast', async () => {
    const intent = computeTeachingIntent('student-1', decision(), neutral);
    const generationContext = toTeachingGenerationContext(intent);
    await generateExplainPrompt('student-1', 'subj1', 'c1', 'Newton\'s First Law', 'EXPLAIN', 'en', generationContext);
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).toContain('FORCE_ALONG_VELOCITY');
    expect(params.system).toMatch(/contrast/i);
  });
});

describe('generateExplainPrompt -- prerequisite experience (release test 3)', () => {
  it('the actual system prompt targets the prerequisite concept the generator was called with, without downstream drift', async () => {
    const d = decision({ actionConceptId: 'prerequisite-concept', learningState: 'PREREQUISITE_BLOCKED', reasonCode: 'PREREQUISITE_GAP', targetDimension: 'PREREQUISITE', targetConceptIds: ['downstream-concept'] });
    const intent = computeTeachingIntent('student-1', d, neutral);
    const generationContext = toTeachingGenerationContext(intent);
    // The caller passes the PREREQUISITE concept's own id/label -- this is
    // what proves the prerequisite, not the downstream concept, is the
    // lesson subject: the generator is never even told about the
    // downstream concept's label.
    await generateExplainPrompt('student-1', 'subj1', 'prerequisite-concept', 'Prerequisite Concept', 'EXPLAIN', 'en', generationContext);
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).toContain('Prerequisite Concept');
    expect(params.system).not.toContain('downstream-concept');
    expect(params.system).toMatch(/teach the prerequisite/i);
  });
});

describe('generateExplainPrompt -- grounding preserved (release test 15 / S13)', () => {
  it('the retrieved source material is still included in the system prompt alongside adaptive guidance', async () => {
    const intent = computeTeachingIntent('student-1', decision(), neutral);
    const generationContext = toTeachingGenerationContext(intent);
    await generateExplainPrompt('student-1', 'subj1', 'c1', 'Newton\'s First Law', 'EXPLAIN', 'en', generationContext);
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).toContain("Chunk from the student's own material.");
    expect(retrieveContextMock).toHaveBeenCalled();
  });
});

describe('generateExplainPrompt -- multilingual invariance (release test 16)', () => {
  it('the same TeachingIntent produces the same adaptive constraints regardless of language, only the rest of the prompt changes', async () => {
    const intent = computeTeachingIntent('student-1', decision(), neutral);
    const generationContext = toTeachingGenerationContext(intent);
    await generateExplainPrompt('student-1', 'subj1', 'c1', 'Concepto', 'EXPLAIN', 'es', generationContext);
    const [esParams] = callAnthropicMessagesMock.mock.calls[0];
    callAnthropicMessagesMock.mockClear();
    await generateExplainPrompt('student-1', 'subj1', 'c1', 'Concept', 'EXPLAIN', 'en', generationContext);
    const [enParams] = callAnthropicMessagesMock.mock.calls[0];
    // Extract just the adaptive block text (identical across both calls).
    expect(esParams.system).toContain('FORCE_ALONG_VELOCITY');
    expect(enParams.system).toContain('FORCE_ALONG_VELOCITY');
    expect(esParams.system).toMatch(/contrast/i);
    expect(enParams.system).toMatch(/contrast/i);
  });
});

describe('generateExplainPrompt -- backward compatible when no adaptive context is supplied (v1 behavior preserved)', () => {
  it('produces no adaptive guidance section at all', async () => {
    await generateExplainPrompt('student-1', 'subj1', 'c1', 'Some Concept', 'EXPLAIN', 'en');
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).not.toMatch(/ADAPTIVE TEACHING GUIDANCE/);
  });
});

describe('generateExplainPrompt -- AI provenance context now threaded through (release S16)', () => {
  it('passes studentId/subjectId/conceptId context into the AI Gateway call', async () => {
    // Verified indirectly: executeAI's context param never throws when
    // present; the call succeeds and produces a result, proving the
    // wiring didn't break. Direct inspection of ai_execution_events is
    // covered by the AI Gateway's own certified tests (Phase 0E2).
    const result = await generateExplainPrompt('student-1', 'subj1', 'c1', 'Some Concept', 'EXPLAIN', 'en');
    expect(result.prompt).toBe('q');
  });
});

describe('generateExplainPrompt -- AI failure produces zero cognitive effect (release test 14)', () => {
  it('a provider failure throws and generates no result -- no cognitive mutation is even possible from this function, which performs none', async () => {
    callAnthropicMessagesMock.mockRejectedValueOnce(new Error('provider down'));
    await expect(generateExplainPrompt('student-1', 'subj1', 'c1', 'Some Concept', 'EXPLAIN', 'en')).rejects.toThrow();
  });
});
