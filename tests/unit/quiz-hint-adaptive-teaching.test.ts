/**
 * Phase 5-R: live-surface B (PRACTICE hints), service level. Proves
 * the actual system prompt generateQuestionHint sends carries support-
 * level/barrier/strategy constraints when a TeachingGenerationContext
 * is supplied, while the CRITICAL no-answer-reveal rules are never
 * weakened (release tests 6, 7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callModelMock = vi.fn().mockResolvedValue({ text: '["hint one", "hint two"]' });
vi.mock('@/lib/ai/adapters/call-model', () => ({ callModel: (...a: any[]) => callModelMock(...a) }));

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

beforeEach(() => callModelMock.mockClear());

describe('generateQuestionHint -- support level honored (release test 6)', () => {
  it('HIGH_SUPPORT explicitly permits a worked example in the system prompt', async () => {
    const neutral: TeachingContextInputs = { calibrationLabel: 'WELL_CALIBRATED', independentMastery: 90, masteryScore: 90, helpDependencyFlag: false, cognitiveLevel: null, previousStrategies: [] };
    const intent = computeTeachingIntent('s1', decision({ learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION' }), neutral);
    await generateQuestionHint(QUESTION, 'en', toTeachingGenerationContext(intent));
    const [params] = callModelMock.mock.calls[0];
    expect(params.system).toMatch(/worked example/i);
  });

  it('MINIMAL_SUPPORT (help dependency) instructs a light cue only, never a full explanation', async () => {
    const dependent: TeachingContextInputs = { calibrationLabel: 'WELL_CALIBRATED', independentMastery: 20, masteryScore: 90, helpDependencyFlag: true, cognitiveLevel: null, previousStrategies: [] };
    const intent = computeTeachingIntent('s1', decision(), dependent);
    expect(intent.supportLevel).toBe('MINIMAL_SUPPORT');
    await generateQuestionHint(QUESTION, 'en', toTeachingGenerationContext(intent));
    const [params] = callModelMock.mock.calls[0];
    expect(params.system).toMatch(/light cue|prompting question/i);
  });
});

describe('generateQuestionHint -- CRITICAL no-answer-reveal rules are never weakened (release test 7)', () => {
  it('the CRITICAL RULES section is present verbatim regardless of support level, and stated as overriding any guidance above it', async () => {
    const neutral: TeachingContextInputs = { calibrationLabel: 'WELL_CALIBRATED', independentMastery: 90, masteryScore: 90, helpDependencyFlag: false, cognitiveLevel: null, previousStrategies: [] };
    const intent = computeTeachingIntent('s1', decision({ learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION' }), neutral);
    await generateQuestionHint(QUESTION, 'en', toTeachingGenerationContext(intent));
    const [params] = callModelMock.mock.calls[0];
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
    const [params] = callModelMock.mock.calls[0];
    expect(params.system).toContain('SIGN_ERROR');
  });
});

describe('generateQuestionHint -- backward compatible with no adaptive context (v1 behavior)', () => {
  it('produces no adaptive guidance section at all', async () => {
    await generateQuestionHint(QUESTION, 'en');
    const [params] = callModelMock.mock.calls[0];
    expect(params.system).not.toMatch(/ADAPTIVE TEACHING GUIDANCE/);
    expect(params.system).toMatch(/NEVER state or imply the correct answer/);
  });
});

describe('7E3 -- teach-for-transfer clause on the ONE supported surface (quiz hints)', () => {
  const neutral: TeachingContextInputs = {
    calibrationLabel: 'WELL_CALIBRATED', independentMastery: 85, masteryScore: 88, helpDependencyFlag: false, cognitiveLevel: null, previousStrategies: [],
  };

  it('a PRACTICE decision carrying a FAR_TRANSFER_GAP signal -> the hint prompt gets the TEACH-FOR-TRANSFER clause', async () => {
    const far = sig({ type: 'FAR_TRANSFER_GAP', source: 'transfer-read.service' });
    const d = decision({ signals: [sig(), far], primarySignal: sig() });
    const intent = computeTeachingIntent('s1', d, neutral);
    expect(intent.transferPreparation.varyContext).toBe(true);
    await generateQuestionHint(QUESTION, 'en', toTeachingGenerationContext(intent));
    const [params] = callModelMock.mock.calls[0];
    expect(params.system).toMatch(/TEACH-FOR-TRANSFER/);
    expect(params.system).toMatch(/recognising WHEN this concept applies/);
    // no-answer-reveal rules still present and last
    expect(params.system).toMatch(/NEVER state or imply the correct answer/);
    expect(params.system.indexOf('TEACH-FOR-TRANSFER')).toBeLessThan(params.system.indexOf('NEVER state or imply'));
  });

  it('a plain LOW_UNDERSTANDING PRACTICE decision (no transfer signal) -> NO teach-for-transfer clause', async () => {
    const intent = computeTeachingIntent('s1', decision(), neutral);
    expect(intent.transferPreparation.varyContext).toBe(false);
    await generateQuestionHint(QUESTION, 'en', toTeachingGenerationContext(intent));
    const [params] = callModelMock.mock.calls[0];
    expect(params.system).not.toMatch(/TEACH-FOR-TRANSFER/);
  });

  it('fadeScaffold clause appears only when the learner is not in heavy support', async () => {
    const far = sig({ type: 'FAR_TRANSFER_GAP', source: 'transfer-read.service' });
    // heavy support: a misconception barrier -> HIGH_SUPPORT -> fadeScaffold false
    const heavy = computeTeachingIntent(
      's1',
      decision({ learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION', signals: [sig({ type: 'CRITICAL_MISCONCEPTION' }), far] }),
      neutral,
    );
    expect(heavy.transferPreparation.fadeScaffold).toBe(false);
    // light support
    const light = computeTeachingIntent('s1', decision({ signals: [sig(), far] }), neutral);
    expect(light.transferPreparation.fadeScaffold).toBe(true);
  });
});
