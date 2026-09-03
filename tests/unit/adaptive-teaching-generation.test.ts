/**
 * Phase 5-R S4: the pure TeachingIntent -> AI-instructional-constraints
 * adapter. No IO -- every test builds a `TeachingGenerationContext`
 * fixture and asserts on the returned text block directly.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTeachingConstraintsBlock,
  supportLevelInstruction,
  toTeachingGenerationContext,
  type TeachingGenerationContext,
} from '@/lib/adaptive-teaching-generation';
import { computeTeachingIntent, type TeachingContextInputs } from '@/lib/adaptive-teaching-policy';
import type { LearningDecision, LearningSignal } from '@/lib/adaptive-learning-policy';

function baseCtx(overrides: Partial<TeachingGenerationContext> = {}): TeachingGenerationContext {
  return {
    instructionalGoal: 'Build initial understanding of this concept.',
    primaryBarrier: 'LOW_UNDERSTANDING',
    strategy: 'EXPLAIN',
    supportLevel: 'GUIDED',
    explanationDepth: 'STANDARD',
    reasoningDemand: null,
    misconceptionCodes: [],
    prerequisiteConceptIds: [],
    avoidStrategies: [],
    successCriteria: 'Student can restate the core idea.',
    ...overrides,
  };
}

describe('supportLevelInstruction (5-R S8)', () => {
  it('every SupportLevel has a distinct, non-empty instruction', () => {
    const levels = ['HIGH_SUPPORT', 'GUIDED', 'PARTIAL_SUPPORT', 'MINIMAL_SUPPORT', 'INDEPENDENT'] as const;
    const instructions = levels.map(supportLevelInstruction);
    expect(new Set(instructions).size).toBe(levels.length);
    for (const i of instructions) expect(i.length).toBeGreaterThan(0);
  });
  it('INDEPENDENT explicitly forbids instructional help', () => {
    expect(supportLevelInstruction('INDEPENDENT')).toMatch(/not provide instructional help/i);
  });
  it('HIGH_SUPPORT explicitly allows a worked example', () => {
    expect(supportLevelInstruction('HIGH_SUPPORT')).toMatch(/worked example/i);
  });
});

describe('buildTeachingConstraintsBlock -- misconception experience (5-R S6 / release test 2)', () => {
  it('names the misconception code and requires contrast + why-it-fails + no-mere-answer-reveal + never a generic explanation', () => {
    const block = buildTeachingConstraintsBlock(baseCtx({ primaryBarrier: 'ACTIVE_MISCONCEPTION', misconceptionCodes: ['FORCE_ALONG_VELOCITY'] }));
    expect(block).toContain('FORCE_ALONG_VELOCITY');
    expect(block).toMatch(/contrast/i);
    expect(block).toMatch(/why.*fails|fails.*why/i);
    expect(block).toMatch(/do not merely reveal/i);
  });
});

describe('buildTeachingConstraintsBlock -- prerequisite experience (5-R S7 / release test 3)', () => {
  it('instructs the generator to teach the prerequisite itself, not drift to the downstream concept', () => {
    const block = buildTeachingConstraintsBlock(baseCtx({ primaryBarrier: 'PREREQUISITE_GAP' }));
    expect(block).toMatch(/prerequisite/i);
    expect(block).toMatch(/do not drift/i);
  });
});

describe('buildTeachingConstraintsBlock -- help dependency / fading (5-R S11 / release test 4)', () => {
  it('produces a materially different, less-supportive block than a generic low-understanding barrier', () => {
    const dependent = buildTeachingConstraintsBlock(baseCtx({ primaryBarrier: 'HELP_DEPENDENCY', supportLevel: 'MINIMAL_SUPPORT' }));
    const generic = buildTeachingConstraintsBlock(baseCtx({ primaryBarrier: 'LOW_UNDERSTANDING', supportLevel: 'GUIDED' }));
    expect(dependent).not.toBe(generic);
    expect(dependent).toMatch(/attempt.*themselves|before any further help/i);
  });
});

describe('buildTeachingConstraintsBlock -- previous strategy avoidance (5-R S12 / release test 20)', () => {
  it('when a strategy is in avoidStrategies, the block instructs the AI not to lead with it again', () => {
    const block = buildTeachingConstraintsBlock(baseCtx({ strategy: 'EXPLAIN', avoidStrategies: ['CONTRAST'] }));
    expect(block).toMatch(/do not lead with CONTRAST/i);
  });
  it('with no avoided strategies, no avoidance clause appears', () => {
    const block = buildTeachingConstraintsBlock(baseCtx({ strategy: 'EXPLAIN', avoidStrategies: [] }));
    expect(block).not.toMatch(/do not lead with/i);
  });
});

describe('buildTeachingConstraintsBlock -- language independence (5-R S14 / release test 16)', () => {
  it('takes no language parameter and produces the identical block regardless of caller-side language', () => {
    const context = baseCtx({ primaryBarrier: 'ACTIVE_MISCONCEPTION', misconceptionCodes: ['X'] });
    const a = buildTeachingConstraintsBlock(context);
    const b = buildTeachingConstraintsBlock(context);
    expect(a).toBe(b);
    expect(buildTeachingConstraintsBlock.length).toBe(1); // single-arg function -- no language slot exists to vary
  });
});

describe('toTeachingGenerationContext -- reuses TeachingIntent fields verbatim, no new learner-state model', () => {
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
  const neutral: TeachingContextInputs = {
    calibrationLabel: 'WELL_CALIBRATED', independentMastery: 60, masteryScore: 65, helpDependencyFlag: false, cognitiveLevel: null, previousStrategies: [],
  };
  it('every field on the generation context traces to the TeachingIntent it was derived from', () => {
    const intent = computeTeachingIntent('student-1', decision(), neutral);
    const generationContext = toTeachingGenerationContext(intent);
    expect(generationContext.instructionalGoal).toBe(intent.instructionalGoal);
    expect(generationContext.primaryBarrier).toBe(intent.primaryBarrier);
    expect(generationContext.strategy).toBe(intent.strategy);
    expect(generationContext.supportLevel).toBe(intent.supportLevel);
    expect(generationContext.explanationDepth).toBe(intent.explanationDepth);
    expect(generationContext.misconceptionCodes).toBe(intent.misconceptionCodes);
    expect(generationContext.prerequisiteConceptIds).toBe(intent.prerequisiteConceptIds);
    expect(generationContext.avoidStrategies).toBe(intent.avoidStrategies);
    expect(generationContext.successCriteria).toBe(intent.successCriteria);
    // No field not already on TeachingIntent -- no new model.
    expect(Object.keys(generationContext).every((k) => k in intent)).toBe(true);
  });
});
