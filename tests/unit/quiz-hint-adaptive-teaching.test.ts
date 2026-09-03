/**
 * Phase 5-R: live-surface B (PRACTICE hints), service level. Proves
 * the actual system prompt generateQuestionHint sends carries support-
 * level/barrier/strategy constraints when a TeachingGenerationContext
 * is supplied, while the CRITICAL no-answer-reveal rules are never
 * weakened (release tests 6, 7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callAnthropicMessagesMock = vi.fn().mockResolvedValue({ text: '["hint one", "hint two"]' });
vi.mock('@/lib/ai/adapters/anthropic', () => ({ callAnthropicMessages: (...a: any[]) => callAnthropicMessagesMock(...a) }));

import { generateQuestionHint, type GeneratedQuestion } from '@/services/quiz-generation.service';
import { toTeachingGenerationContext } from '@/lib/adaptive-teaching-generation';
import { computeTeachingIntent, type TeachingContextInputs } from '@/lib/adaptive-teaching-policy';
import type { LearningDecision, LearningSignal } from '@/lib/adaptive-learning-policy';

const QUESTION: GeneratedQuestion = { id: 'q1', question: 'What is F=ma?', type: 'short_answer', conceptId: 'c1' } as any;

function sig(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return { type: 'LOW_UNDERSTANDING', source: 'test', conceptId: 'c1', subjectId: 'subj1', metadata: {}, ...overrides } as LearningSignal;
}
function decision(overrides: Partial<LearningDecision> = {}): LearningDecision {
  const primarySignal = overrides.primarySignal ?? sig();
  return {
    actionConceptId: 'c1', subjectId: 'subj1', targetConceptIds: [], signals: [primarySignal], primarySignal,
    learningState: 'DEVELOPING', targetDimension: 'UNDERSTANDING', activityType: 'PRACTICE', pedagogicalPriority: 'MEDIUM',
    temporalUrgency: null, priorityScore: 1000, reasonCode: primarySignal.type, facts: [], dueAt: null, policyVersion: 3, ...overrides,
  };
}

beforeEach(() => callAnthropicMessagesMock.mockClear());

describe('generateQuestionHint -- support level honored (release test 6)', () => {
  it('HIGH_SUPPORT explicitly permits a worked example in the system prompt', async () => {
    const neutral: TeachingContextInputs = { calibrationLabel: 'WELL_CALIBRATED', independentMastery: 90, masteryScore: 90, helpDependencyFlag: false, cognitiveLevel: null, previousStrategies: [] };
    const intent = computeTeachingIntent('s1', decision({ learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION' }), neutral);
    await generateQuestionHint(QUESTION, 'en', toTeachingGenerationContext(intent));
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).toMatch(/worked example/i);
  });

  it('MINIMAL_SUPPORT (help dependency) instructs a light cue only, never a full explanation', async () => {
    const dependent: TeachingContextInputs = { calibrationLabel: 'WELL_CALIBRATED', independentMastery: 20, masteryScore: 90, helpDependencyFlag: true, cognitiveLevel: null, previousStrategies: [] };
    const intent = computeTeachingIntent('s1', decision(), dependent);
    expect(intent.supportLevel).toBe('MINIMAL_SUPPORT');
    await generateQuestionHint(QUESTION, 'en', toTeachingGenerationContext(intent));
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).toMatch(/light cue|prompting question/i);
  });
});

describe('generateQuestionHint -- CRITICAL no-answer-reveal rules are never weakened (release test 7)', () => {
  it('the CRITICAL RULES section is present verbatim regardless of support level, and stated as overriding any guidance above it', async () => {
    const neutral: TeachingContextInputs = { calibrationLabel: 'WELL_CALIBRATED', independentMastery: 90, masteryScore: 90, helpDependencyFlag: false, cognitiveLevel: null, previousStrategies: [] };
    const intent = computeTeachingIntent('s1', decision({ learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION' }), neutral);
    await generateQuestionHint(QUESTION, 'en', toTeachingGenerationContext(intent));
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).toMatch(/NEVER state or imply the correct answer/);
    expect(params.system).toMatch(/never break these, regardless of any guidance above/i);
  });
});

describe('generateQuestionHint -- misconception targeting reaches the hint generator (release test 2)', () => {
  it('the system prompt names the misconception code', async () => {
    const withMisconception: TeachingContextInputs = { calibrationLabel: 'WELL_CALIBRATED', independentMastery: 60, masteryScore: 65, helpDependencyFlag: false, cognitiveLevel: null, previousStrategies: [] };
    const misSignal = sig({ type: 'CRITICAL_MISCONCEPTION', misconceptionCode: 'SIGN_ERROR' });
    const d = decision({ learningState: 'MISCONCEPTION_BLOCKED', primarySignal: misSignal, signals: [misSignal], reasonCode: 'CRITICAL_MISCONCEPTION' });
    const intent = computeTeachingIntent('s1', d, withMisconception);
    await generateQuestionHint(QUESTION, 'en', toTeachingGenerationContext(intent));
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).toContain('SIGN_ERROR');
  });
});

describe('generateQuestionHint -- backward compatible with no adaptive context (v1 behavior)', () => {
  it('produces no adaptive guidance section at all', async () => {
    await generateQuestionHint(QUESTION, 'en');
    const [params] = callAnthropicMessagesMock.mock.calls[0];
    expect(params.system).not.toMatch(/ADAPTIVE TEACHING GUIDANCE/);
    expect(params.system).toMatch(/NEVER state or imply the correct answer/);
  });
});
