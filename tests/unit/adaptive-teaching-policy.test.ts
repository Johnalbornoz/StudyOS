/**
 * Phase 5G: adversarial certification of the pure Adaptive Teaching
 * Policy (src/lib/adaptive-teaching-policy.ts). No IO anywhere in this
 * file's subject -- every test constructs a `LearningDecision` +
 * `TeachingContextInputs` fixture and asserts on the returned
 * `TeachingIntent` directly.
 */
import { describe, it, expect } from 'vitest';
import {
  computeTeachingIntent,
  computePrimaryBarrier,
  selectTeachingStrategy,
  computeSupportLevel,
  computeExplanationDepth,
  computeAvoidStrategies,
  ADAPTIVE_TEACHING_POLICY_VERSION,
  type TeachingContextInputs,
  type PrimaryBarrier,
} from '@/lib/adaptive-teaching-policy';
import type { LearningDecision, LearningSignal, LearningState } from '@/lib/adaptive-learning-policy';

function sig(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return { type: 'LOW_UNDERSTANDING', source: 'test', conceptId: 'c1', subjectId: 'subj1', metadata: {}, ...overrides } as LearningSignal;
}

function decision(overrides: Partial<LearningDecision> = {}): LearningDecision {
  const primarySignal = overrides.primarySignal ?? sig();
  return {
    actionConceptId: 'c1',
    subjectId: 'subj1',
    targetConceptIds: [],
    signals: [primarySignal],
    primarySignal,
    learningState: 'DEVELOPING',
    targetDimension: 'UNDERSTANDING',
    activityType: 'PRACTICE',
    pedagogicalPriority: 'MEDIUM',
    temporalUrgency: null,
    priorityScore: 1000,
    reasonCode: primarySignal.type,
    facts: [],
    dueAt: null,
    policyVersion: 3,
    ...overrides,
  };
}

const NEUTRAL_INPUTS: TeachingContextInputs = {
  calibrationLabel: 'WELL_CALIBRATED',
  independentMastery: 60,
  masteryScore: 65,
  helpDependencyFlag: false,
  cognitiveLevel: null,
  previousStrategies: [],
};

describe('1. computePrimaryBarrier -- every LearningState maps to a certified barrier', () => {
  const cases: [LearningState, PrimaryBarrier][] = [
    ['MISCONCEPTION_BLOCKED', 'ACTIVE_MISCONCEPTION'],
    ['PREREQUISITE_BLOCKED', 'PREREQUISITE_GAP'],
    ['NEEDS_REPAIR', 'PERSISTENT_FAILURE'],
    ['PENDING_VERIFICATION', 'INSUFFICIENT_INDEPENDENT_EVIDENCE'],
    ['INSUFFICIENT_INDEPENDENT_EVIDENCE', 'INSUFFICIENT_INDEPENDENT_EVIDENCE'],
    ['RETENTION_RISK', 'RETENTION_RISK'],
    ['TRANSFER_GAP', 'TRANSFER_GAP'],
    ['NOT_STARTED', 'LOW_UNDERSTANDING'],
    ['VALIDATED', 'LOW_UNDERSTANDING'],
  ];
  it.each(cases)('%s -> %s', (learningState, expected) => {
    const d = decision({ learningState });
    expect(computePrimaryBarrier(d, { calibrationLabel: 'WELL_CALIBRATED', helpDependencyFlag: false })).toBe(expected);
  });
});

describe('2. DEVELOPING residual -- refined by calibration/help-dependency, in precedence order', () => {
  it('help dependency wins over calibration when both are present', () => {
    const d = decision({ learningState: 'DEVELOPING' });
    expect(computePrimaryBarrier(d, { calibrationLabel: 'OVERCONFIDENT', helpDependencyFlag: true })).toBe('HELP_DEPENDENCY');
  });
  it('overconfident calibration alone', () => {
    const d = decision({ learningState: 'DEVELOPING' });
    expect(computePrimaryBarrier(d, { calibrationLabel: 'OVERCONFIDENT', helpDependencyFlag: false })).toBe('OVERCONFIDENCE');
  });
  it('underconfident calibration alone', () => {
    const d = decision({ learningState: 'DEVELOPING' });
    expect(computePrimaryBarrier(d, { calibrationLabel: 'UNDERCONFIDENT', helpDependencyFlag: false })).toBe('LOW_CONFIDENCE');
  });
  it('no flags -> LOW_UNDERSTANDING', () => {
    const d = decision({ learningState: 'DEVELOPING' });
    expect(computePrimaryBarrier(d, { calibrationLabel: 'WELL_CALIBRATED', helpDependencyFlag: false })).toBe('LOW_UNDERSTANDING');
  });
  it('a real escalation (MISCONCEPTION_BLOCKED) is never overridden by calibration/help-dependency', () => {
    const d = decision({ learningState: 'MISCONCEPTION_BLOCKED' });
    expect(computePrimaryBarrier(d, { calibrationLabel: 'OVERCONFIDENT', helpDependencyFlag: true })).toBe('ACTIVE_MISCONCEPTION');
  });
});

describe('3. selectTeachingStrategy -- barrier defaults reconcile selectTutorStrategy\'s existing mappings', () => {
  it('ACTIVE_MISCONCEPTION -> CONTRAST', () => {
    expect(selectTeachingStrategy('ACTIVE_MISCONCEPTION', { previousStrategies: [] })).toBe('CONTRAST');
  });
  it('RETENTION_RISK -> RETRIEVAL', () => {
    expect(selectTeachingStrategy('RETENTION_RISK', { previousStrategies: [] })).toBe('RETRIEVAL');
  });
  it('TRANSFER_GAP -> TRANSFER', () => {
    expect(selectTeachingStrategy('TRANSFER_GAP', { previousStrategies: [] })).toBe('TRANSFER');
  });
  it('OVERCONFIDENCE -> SOCRATIC (active demonstration before revealing correction)', () => {
    expect(selectTeachingStrategy('OVERCONFIDENCE', { previousStrategies: [] })).toBe('SOCRATIC');
  });
  it('LOW_UNDERSTANDING -> EXPLAIN', () => {
    expect(selectTeachingStrategy('LOW_UNDERSTANDING', { previousStrategies: [] })).toBe('EXPLAIN');
  });
});

describe('4. Error-type attack (5G.7 / test 7): conceptual vs careless error select different strategies', () => {
  it('a CONCEPTUAL error on the response strengthens CONTRAST', () => {
    expect(selectTeachingStrategy('LOW_UNDERSTANDING', { previousStrategies: [], lastErrorType: 'CONCEPTUAL' })).toBe('CONTRAST');
  });
  it('a CARELESS slip never escalates to a full conceptual re-teach -- leads with SOCRATIC instead', () => {
    const strategy = selectTeachingStrategy('LOW_UNDERSTANDING', { previousStrategies: [], lastErrorType: 'CARELESS' });
    expect(strategy).toBe('SOCRATIC');
    expect(strategy).not.toBe('CONTRAST');
  });
  it('a MISREADING slip also leads with SOCRATIC, not a re-teach', () => {
    expect(selectTeachingStrategy('LOW_UNDERSTANDING', { previousStrategies: [], lastErrorType: 'MISREADING' })).toBe('SOCRATIC');
  });
});

describe('5. Failed-strategy attack (5G.8 / test 8): repeated strategy triggers an eligible alternative', () => {
  it('one prior use of the top strategy does not yet avoid it', () => {
    expect(selectTeachingStrategy('LOW_UNDERSTANDING', { previousStrategies: ['EXPLAIN'] })).toBe('EXPLAIN');
  });
  it('two consecutive prior uses of the same strategy select the next eligible one', () => {
    const strategy = selectTeachingStrategy('LOW_UNDERSTANDING', { previousStrategies: ['EXPLAIN', 'EXPLAIN'] });
    expect(strategy).not.toBe('EXPLAIN');
    expect(strategy).toBe('ANALOGY');
  });
  it('computeAvoidStrategies is empty with fewer than two consecutive repeats', () => {
    expect(computeAvoidStrategies([])).toEqual([]);
    expect(computeAvoidStrategies(['EXPLAIN'])).toEqual([]);
    expect(computeAvoidStrategies(['EXPLAIN', 'ANALOGY'])).toEqual([]);
  });
  it('computeAvoidStrategies flags the strategy after two consecutive identical uses', () => {
    expect(computeAvoidStrategies(['EXPLAIN', 'EXPLAIN', 'ANALOGY'])).toEqual(['EXPLAIN']);
  });
});

describe('6. computeSupportLevel -- Evidence Mode is a hard floor (5G.9 assistance contamination)', () => {
  const nonPracticeActivities: LearningDecision['activityType'][] = [
    'SOLO_CHECK', 'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'DIAGNOSTIC_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM',
  ];
  it.each(nonPracticeActivities)('%s always yields INDEPENDENT, even for the most severe barrier', (activityType) => {
    const d = decision({ activityType });
    expect(computeSupportLevel(d, 'ACTIVE_MISCONCEPTION', { independentMastery: 10, masteryScore: 90 })).toBe('INDEPENDENT');
  });
  it('PRACTICE + ACTIVE_MISCONCEPTION -> HIGH_SUPPORT even for an otherwise-strong learner', () => {
    const d = decision({ activityType: 'PRACTICE' });
    expect(computeSupportLevel(d, 'ACTIVE_MISCONCEPTION', { independentMastery: 95, masteryScore: 95 })).toBe('HIGH_SUPPORT');
  });
  it('PRACTICE + PREREQUISITE_GAP -> HIGH_SUPPORT', () => {
    const d = decision({ activityType: 'PRACTICE' });
    expect(computeSupportLevel(d, 'PREREQUISITE_GAP', { independentMastery: 95, masteryScore: 95 })).toBe('HIGH_SUPPORT');
  });
});

describe('7. Help-dependency attack (5G.4 / test 4): fading, never more permanent assistance', () => {
  it('HELP_DEPENDENCY yields MINIMAL_SUPPORT even when the independence gap alone would suggest heavy scaffolding', () => {
    const d = decision({ activityType: 'PRACTICE' });
    const level = computeSupportLevel(d, 'HELP_DEPENDENCY', { independentMastery: 10, masteryScore: 90 });
    expect(level).toBe('MINIMAL_SUPPORT');
    expect(level).not.toBe('HIGH_SUPPORT');
    expect(level).not.toBe('GUIDED');
  });
});

describe('8. Independence-gap ladder (no special barrier)', () => {
  const d = decision({ activityType: 'PRACTICE' });
  it('null independent mastery -> GUIDED (never assessed independently yet)', () => {
    expect(computeSupportLevel(d, 'LOW_UNDERSTANDING', { independentMastery: null, masteryScore: 60 })).toBe('GUIDED');
  });
  it('gap > 20 -> GUIDED', () => {
    expect(computeSupportLevel(d, 'LOW_UNDERSTANDING', { independentMastery: 40, masteryScore: 70 })).toBe('GUIDED');
  });
  it('gap in (10, 20] -> PARTIAL_SUPPORT', () => {
    expect(computeSupportLevel(d, 'LOW_UNDERSTANDING', { independentMastery: 55, masteryScore: 70 })).toBe('PARTIAL_SUPPORT');
  });
  it('gap <= 10 -> MINIMAL_SUPPORT', () => {
    expect(computeSupportLevel(d, 'LOW_UNDERSTANDING', { independentMastery: 65, masteryScore: 70 })).toBe('MINIMAL_SUPPORT');
  });
});

describe('9. computeExplanationDepth', () => {
  const d = decision({ activityType: 'PRACTICE' });
  it('non-PRACTICE evidence mode -> BRIEF (not a teaching moment)', () => {
    const evidenceCollection = decision({ activityType: 'SOLO_CHECK' });
    expect(computeExplanationDepth(evidenceCollection, 'LOW_UNDERSTANDING', { cognitiveLevel: 'SYNTHESIS' })).toBe('BRIEF');
  });
  it('LOW_CONFIDENCE stays BRIEF -- underconfidence + strong evidence attack (5G.6 / test 6)', () => {
    expect(computeExplanationDepth(d, 'LOW_CONFIDENCE', { cognitiveLevel: null })).toBe('BRIEF');
  });
  it('ACTIVE_MISCONCEPTION -> DEEP', () => {
    expect(computeExplanationDepth(d, 'ACTIVE_MISCONCEPTION', { cognitiveLevel: null })).toBe('DEEP');
  });
  it('PREREQUISITE_GAP -> DEEP', () => {
    expect(computeExplanationDepth(d, 'PREREQUISITE_GAP', { cognitiveLevel: null })).toBe('DEEP');
  });
  it('high cognitive demand -> DEEP even without a severe barrier', () => {
    expect(computeExplanationDepth(d, 'LOW_UNDERSTANDING', { cognitiveLevel: 'ANALYSIS' })).toBe('DEEP');
    expect(computeExplanationDepth(d, 'LOW_UNDERSTANDING', { cognitiveLevel: 'EVALUATION' })).toBe('DEEP');
  });
  it('default -> STANDARD', () => {
    expect(computeExplanationDepth(d, 'LOW_UNDERSTANDING', { cognitiveLevel: 'RECALL' })).toBe('STANDARD');
  });
});

describe('10. computeTeachingIntent -- full composition', () => {
  it('policy version is always included (test 17)', () => {
    const intent = computeTeachingIntent('student-1', decision(), NEUTRAL_INPUTS);
    expect(intent.policyVersion).toBe(ADAPTIVE_TEACHING_POLICY_VERSION);
  });

  it('Decision Engine activityType/reasonCode/learningState/targetDimension are passed through VERBATIM, never overridden (test 15)', () => {
    const d = decision({ activityType: 'REMEDIATION', reasonCode: 'PREREQUISITE_GAP', learningState: 'PREREQUISITE_BLOCKED', targetDimension: 'PREREQUISITE' });
    const intent = computeTeachingIntent('student-1', d, NEUTRAL_INPUTS);
    expect(intent.activityType).toBe('REMEDIATION');
    expect(intent.reasonCode).toBe('PREREQUISITE_GAP');
    expect(intent.learningState).toBe('PREREQUISITE_BLOCKED');
    expect(intent.targetKnowledgeDimension).toBe('PREREQUISITE');
  });

  it('the input decision object is never mutated', () => {
    const d = decision({ activityType: 'REMEDIATION', rootCauseConceptId: 'root-1', targetConceptIds: ['root-1'] });
    const frozen = Object.freeze({ ...d });
    expect(() => computeTeachingIntent('student-1', frozen as typeof d, NEUTRAL_INPUTS)).not.toThrow();
  });

  it('target concept is never silently changed -- conceptId is decision.actionConceptId verbatim (test 16 / 5G.3 prerequisite attack)', () => {
    const d = decision({ actionConceptId: 'prerequisite-root', learningState: 'PREREQUISITE_BLOCKED', targetConceptIds: ['downstream-concept'] });
    const intent = computeTeachingIntent('student-1', d, NEUTRAL_INPUTS);
    expect(intent.conceptId).toBe('prerequisite-root');
    expect(intent.prerequisiteConceptIds).toEqual(['downstream-concept']);
  });

  it('misconception codes are extracted from decision.facts/signals -- zero fresh query needed (5C.3 / 5G.15)', () => {
    const misSignal = sig({ type: 'CRITICAL_MISCONCEPTION', misconceptionCode: 'FORCE_ALONG_VELOCITY' });
    const d = decision({ learningState: 'MISCONCEPTION_BLOCKED', primarySignal: misSignal, signals: [misSignal], reasonCode: 'CRITICAL_MISCONCEPTION' });
    const intent = computeTeachingIntent('student-1', d, NEUTRAL_INPUTS);
    expect(intent.misconceptionCodes).toContain('FORCE_ALONG_VELOCITY');
  });

  it('determinism: same decision + same inputs -> deep-equal TeachingIntent, twice (test 14 / 5G.13)', () => {
    const d = decision({ learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION' });
    const a = computeTeachingIntent('student-1', d, NEUTRAL_INPUTS);
    const b = computeTeachingIntent('student-1', d, NEUTRAL_INPUTS);
    expect(a).toEqual(b);
  });

  it('language is not a policy input at all -- the same TeachingIntent results regardless of any caller-side language choice (test 13 / 5G.12)', () => {
    // TeachingIntent has no language field and computeTeachingIntent takes
    // no language parameter -- strategy/support/depth are structurally
    // language-invariant, not merely tested to happen to match.
    const d = decision();
    const intent = computeTeachingIntent('student-1', d, NEUTRAL_INPUTS);
    expect(Object.keys(intent)).not.toContain('language');
  });
});

describe('11. Same concept, different state -> different TeachingIntent (5G.1 / test 1)', () => {
  it('low understanding vs active misconception produce genuinely different intents, not just different wording', () => {
    const studentA = decision({ learningState: 'DEVELOPING', reasonCode: 'LOW_UNDERSTANDING' });
    const studentB = decision({ learningState: 'MISCONCEPTION_BLOCKED', reasonCode: 'CRITICAL_MISCONCEPTION' });
    const intentA = computeTeachingIntent('student-a', studentA, NEUTRAL_INPUTS);
    const intentB = computeTeachingIntent('student-b', studentB, NEUTRAL_INPUTS);
    expect(intentA.primaryBarrier).not.toBe(intentB.primaryBarrier);
    expect(intentA.strategy).not.toBe(intentB.strategy);
    expect(intentA.supportLevel).not.toBe(intentB.supportLevel);
  });
});

describe('12. No learning-style classifier anywhere in this policy (test 18)', () => {
  it('TeachingIntent has no visual/auditory/kinesthetic/learningStyle field', () => {
    const intent = computeTeachingIntent('student-1', decision(), NEUTRAL_INPUTS);
    const keys = Object.keys(intent).join(',').toLowerCase();
    expect(keys).not.toMatch(/visual|auditory|kinesthetic|learningstyle/);
  });
});

describe('13. AI governance -- this file never generates content or calls a provider (5G.14)', () => {
  it('computeTeachingIntent returns synchronously (pure, no network/AI call)', () => {
    const result = computeTeachingIntent('student-1', decision(), NEUTRAL_INPUTS);
    expect(result).not.toBeInstanceOf(Promise);
  });
});
