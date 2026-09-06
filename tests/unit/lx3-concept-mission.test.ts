/**
 * LX-3B/D/E + LX-3R -- the pure Concept Mission read model.
 *
 * These lock the architectural invariants: the Mission presents
 * canonical truth and never becomes a second Learning Engine. It never
 * chooses an ActivityType, never invents completion history, never
 * applies a score threshold, and derives the learner-visible stage only
 * through LX-1's `deriveLearnerJourneyStage`.
 *
 * LX-3R: the builder NEVER invents a `LearningState`. The read boundary
 * hands it a discriminated `journeyInput`:
 *   { kind: 'RESOLVED', learningState, source } -- canonical (from the
 *     Phase 4 decision, or the canonical pure policy over a zero-signal
 *     context)
 *   { kind: 'UNAVAILABLE' } -- the decision read failed; no stage is shown
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildConceptMissionView,
  CONCEPT_MISSION_VIEW_VERSION,
  type ConceptMissionInputs,
  type ConceptMissionJourneyInput,
} from '@/lib/lx/concept-mission';
import type { LearningState, LearningFact } from '@/lib/adaptive-learning-policy';
import type { MasteryState, ValidationReadiness } from '@/services/knowledge-state.service';

const FACTS: LearningFact[] = [{ kind: 'forgettingRisk', forgettingRisk: 62 } as unknown as LearningFact];

const RESOLVED = (
  learningState: LearningState,
  source: 'LEARNING_DECISION' | 'CANONICAL_POLICY_NO_SIGNALS' = 'LEARNING_DECISION',
): ConceptMissionJourneyInput => ({ kind: 'RESOLVED', learningState, source });
const UNAVAILABLE: ConceptMissionJourneyInput = { kind: 'UNAVAILABLE' };

function base(over: Partial<ConceptMissionInputs> = {}): ConceptMissionInputs {
  return {
    conceptName: 'Factoring Trinomials',
    subjectId: 'subj-1',
    subjectName: 'Algebra',
    conceptDescription: null,
    goalFallbackText: 'Understand Factoring Trinomials and apply it correctly and on your own.',
    knowledgeState: null,
    journeyInput: RESOLVED('DEVELOPING'),
    learningDecision: null,
    memory: null,
    transferDepth: null,
    hasCachedExplanation: false,
    ...over,
  };
}

function ks(
  masteryState: MasteryState,
  validationReadiness: ValidationReadiness,
  evidenceCount = 0,
  independentEvidenceCount = 0,
) {
  return { masteryState, validationReadiness, evidenceCount, independentEvidenceCount };
}

function decision(learningState: LearningState, over: Record<string, unknown> = {}) {
  return { activityType: 'PRACTICE' as const, actionConceptId: 'concept-42', learningState, facts: FACTS, ...over };
}

/* ================================================================= */
/* LX-3R -- no fabricated LearningState                               */
/* ================================================================= */

describe('LX-3R -- the builder never invents a LearningState', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/lx/concept-mission.ts'), 'utf-8');

  it('has no VALIDATED_MASTERY -> VALIDATED special case and no "otherwise -> DEVELOPING" fallback', () => {
    expect(src).not.toMatch(/effectiveLearningState/);
    expect(src).not.toMatch(/'VALIDATED_MASTERY'\s*(?:===|\?|:).*'VALIDATED'/);
    expect(src).not.toMatch(/masteryState === 'VALIDATED_MASTERY'/);
    expect(src).not.toMatch(/return \{ learningState: 'DEVELOPING'/);
    expect(src).not.toMatch(/return \{ learningState: 'NOT_STARTED'/);
  });

  it('defines no learning policy of its own (no computeLearningState / selectActivityType body)', () => {
    expect(src).not.toMatch(/function computeLearningState/);
    expect(src).not.toMatch(/function selectActivityType/);
    expect(src).not.toMatch(/function selectTargetDimension/);
  });

  it('introduces no score threshold', () => {
    expect(src).not.toMatch(/masteryScore|understandingScore|forgettingRisk|retentionScore|independenceScore/);
    // the only numeric comparisons allowed are presence checks (> 0) on evidence counts
    const comparisons = src.match(/[<>]=?\s*\d+/g) ?? [];
    for (const c of comparisons) expect(c.replace(/\s/g, '')).toBe('>0');
  });

  it('a read failure yields journey.status UNAVAILABLE -- never a manufactured stage', () => {
    const v = buildConceptMissionView(base({ journeyInput: UNAVAILABLE, knowledgeState: ks('VALIDATED_MASTERY', 'READY') }));
    expect(v.journey.status).toBe('UNAVAILABLE');
    expect(v.journey).not.toHaveProperty('stage');
    if (v.journey.status === 'UNAVAILABLE') {
      expect(v.journey.reason).toBe('LEARNING_STATE_READ_FAILED');
      // rail still renders, with no "you are here"
      expect(v.journey.milestones).toHaveLength(5);
      expect(v.journey.milestones.every((m) => m.position === 'INDETERMINATE')).toBe(true);
    }
  });

  it('validated MasteryState alone does NOT manufacture CONSOLIDATED when the state is unavailable', () => {
    const v = buildConceptMissionView(base({ journeyInput: UNAVAILABLE, knowledgeState: ks('VALIDATED_MASTERY', 'READY') }));
    expect(v.journey.status).toBe('UNAVAILABLE');
  });

  it('UNAVAILABLE still preserves identity, goal, Learn surface, and NO_CANONICAL_ACTION', () => {
    const v = buildConceptMissionView(base({ journeyInput: UNAVAILABLE }));
    expect(v.identity.conceptName).toBe('Factoring Trinomials');
    expect(v.goal.text).toBeTruthy();
    expect(v.learn.available).toBe(true);
    expect(v.learn.prominence).toBe('PRIMARY_INLINE');
    expect(v.now.kind).toBe('NO_CANONICAL_ACTION');
    expect(v.now.activityType).toBeNull();
    expect(v.now.fallback).toBe('LEARN_FIRST');
  });

  it('UNAVAILABLE milestones still carry canonical demonstrated records (independent of stage)', () => {
    const v = buildConceptMissionView(
      base({
        journeyInput: UNAVAILABLE,
        knowledgeState: ks('DEVELOPING', 'INSUFFICIENT_EVIDENCE', 10, 3),
        memory: { lastSuccessfulRetentionAt: '2026-01-02T00:00:00Z', retentionDue: false, memoryStatus: 'STABLE' },
        transferDepth: 'NEAR_DEMONSTRATED',
      }),
    );
    if (v.journey.status !== 'UNAVAILABLE') throw new Error('expected UNAVAILABLE');
    const m = (rung: string) => v.journey.milestones.find((x) => x.rung === rung)!;
    expect(m('LEARN').demonstrated).toBe(true);
    expect(m('PROVE').demonstrated).toBe(true);
    expect(m('RETAIN').demonstrated).toBe(true);
    expect(m('TRANSFER').demonstrated).toBe(true);
    expect(m('LEARN').position).toBe('INDETERMINATE');
  });
});

/* ================================================================= */
/* journey stage -- canonical LearningState maps normally            */
/* ================================================================= */

describe('LX-3 buildConceptMissionView -- RESOLVED journey (via LX-1 contract only)', () => {
  const cases: Array<[string, ConceptMissionInputs, string, 'REINFORCE' | null]> = [
    ['NOT_STARTED', base({ journeyInput: RESOLVED('NOT_STARTED', 'CANONICAL_POLICY_NO_SIGNALS') }), 'NOT_STARTED', null],
    ['LEARN', base({ journeyInput: RESOLVED('DEVELOPING'), knowledgeState: ks('LEARNING', 'INSUFFICIENT_EVIDENCE') }), 'LEARN', null],
    ['PRACTICE', base({ journeyInput: RESOLVED('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'INSUFFICIENT_EVIDENCE') }), 'PRACTICE', null],
    ['READY_TO_PROVE', base({ journeyInput: RESOLVED('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'READY') }), 'READY_TO_PROVE', null],
    ['PROVE', base({ journeyInput: RESOLVED('PENDING_VERIFICATION'), knowledgeState: ks('PROVISIONAL_MASTERY', 'INSUFFICIENT_EVIDENCE') }), 'PROVE', null],
    ['RETAIN', base({ journeyInput: RESOLVED('RETENTION_RISK'), knowledgeState: ks('VALIDATED_MASTERY', 'READY') }), 'RETAIN', null],
    ['TRANSFER', base({ journeyInput: RESOLVED('TRANSFER_GAP'), knowledgeState: ks('VALIDATED_MASTERY', 'TRANSFER_REQUIRED') }), 'TRANSFER', null],
    ['CONSOLIDATED (canonical VALIDATED via zero-signal policy)', base({ journeyInput: RESOLVED('VALIDATED', 'CANONICAL_POLICY_NO_SIGNALS'), knowledgeState: ks('VALIDATED_MASTERY', 'READY') }), 'CONSOLIDATED', null],
    ['REINFORCE overlay', base({ journeyInput: RESOLVED('MISCONCEPTION_BLOCKED'), knowledgeState: ks('INTERVENTION_REQUIRED', 'ACTIVE_CRITICAL_MISCONCEPTION') }), 'PRACTICE', 'REINFORCE'],
  ];

  for (const [name, inputs, expectedStage, expectedIntervention] of cases) {
    it(`maps ${name}`, () => {
      const v = buildConceptMissionView(inputs);
      if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
      expect(v.journey.stage).toBe(expectedStage);
      expect(v.journey.intervention).toBe(expectedIntervention);
      expect(v.contractVersion).toBe(CONCEPT_MISSION_VIEW_VERSION);
    });
  }

  it('carries the source verbatim from the read boundary', () => {
    const a = buildConceptMissionView(base({ journeyInput: RESOLVED('RETENTION_RISK', 'LEARNING_DECISION') }));
    const b = buildConceptMissionView(base({ journeyInput: RESOLVED('VALIDATED', 'CANONICAL_POLICY_NO_SIGNALS'), knowledgeState: ks('VALIDATED_MASTERY', 'READY') }));
    if (a.journey.status !== 'RESOLVED' || b.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(a.journey.source).toBe('LEARNING_DECISION');
    expect(b.journey.source).toBe('CANONICAL_POLICY_NO_SIGNALS');
  });

  it('a null decision does not become DEVELOPING -- the resolved learningState is honoured as-is', () => {
    // read boundary resolved VALIDATED via the canonical zero-signal policy
    const v = buildConceptMissionView(base({ journeyInput: RESOLVED('VALIDATED', 'CANONICAL_POLICY_NO_SIGNALS'), knowledgeState: ks('VALIDATED_MASTERY', 'READY') }));
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(v.journey.stage).toBe('CONSOLIDATED');
    expect(v.journey.stage).not.toBe('PRACTICE');
  });
});

/* ================================================================= */
/* NOW -- never invents an ActivityType                              */
/* ================================================================= */

describe('LX-3 -- the Mission never chooses an ActivityType', () => {
  it('passes the canonical decision through verbatim', () => {
    const d = decision('PENDING_VERIFICATION', { activityType: 'SOLO_VERIFY', actionConceptId: 'c-9' });
    const v = buildConceptMissionView(
      base({ journeyInput: RESOLVED('PENDING_VERIFICATION'), learningDecision: d, knowledgeState: ks('PROVISIONAL_MASTERY', 'INSUFFICIENT_EVIDENCE') }),
    );
    expect(v.now.kind).toBe('CANONICAL_ACTION');
    expect(v.now.activityType).toBe('SOLO_VERIFY');
    expect(v.now.actionConceptId).toBe('c-9');
    expect(v.now.facts).toBe(d.facts);
    expect(v.now.fallback).toBeNull();
  });

  it('never emits an activity when there is no decision (resolved or unavailable)', () => {
    for (const ji of [RESOLVED('NOT_STARTED', 'CANONICAL_POLICY_NO_SIGNALS'), UNAVAILABLE]) {
      const v = buildConceptMissionView(base({ journeyInput: ji, learningDecision: null }));
      expect(v.now.kind).toBe('NO_CANONICAL_ACTION');
      expect(v.now.activityType).toBeNull();
      expect(v.now.actionConceptId).toBeNull();
      expect(v.now.facts).toEqual([]);
    }
  });

  it('CONSOLIDATED with no decision -> calm no-action; anything else -> LEARN_FIRST', () => {
    const consolidated = buildConceptMissionView(base({ journeyInput: RESOLVED('VALIDATED', 'CANONICAL_POLICY_NO_SIGNALS'), knowledgeState: ks('VALIDATED_MASTERY', 'READY') }));
    expect(consolidated.now.fallback).toBe('CONSOLIDATED_NO_ACTION');
    const learnFirst = buildConceptMissionView(base({ journeyInput: RESOLVED('NOT_STARTED', 'CANONICAL_POLICY_NO_SIGNALS') }));
    expect(learnFirst.now.fallback).toBe('LEARN_FIRST');
  });

  it('does not synthesise a time estimate', () => {
    const v = buildConceptMissionView(base({ journeyInput: RESOLVED('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'READY') }));
    expect(v.now).not.toHaveProperty('timeEstimate');
    expect(v.now).not.toHaveProperty('estimatedMinutes');
    expect(JSON.stringify(v)).not.toMatch(/min\b/);
  });
});

/* ================================================================= */
/* goal                                                              */
/* ================================================================= */

describe('LX-3 -- goal comes from canonical content, never invented', () => {
  it('uses the concept description when present', () => {
    const v = buildConceptMissionView(base({ conceptDescription: '  Factor standard trinomials and explain why the factors work.  ' }));
    expect(v.goal.source).toBe('CONCEPT_DESCRIPTION');
    expect(v.goal.text).toBe('Factor standard trinomials and explain why the factors work.');
  });

  it('falls back to the supplied name-based copy when there is no description', () => {
    const v = buildConceptMissionView(base({ conceptDescription: '   ' }));
    expect(v.goal.source).toBe('FALLBACK_FROM_NAME');
    expect(v.goal.text).toBe(base().goalFallbackText);
  });
});

/* ================================================================= */
/* milestones                                                        */
/* ================================================================= */

describe('LX-3 -- journey milestones: no thresholds, no invented completion history', () => {
  it('stage is independent of evidence counts; only `demonstrated` reflects them', () => {
    const withEvidence = buildConceptMissionView(base({ journeyInput: RESOLVED('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'INSUFFICIENT_EVIDENCE', 12, 4) }));
    const withoutEvidence = buildConceptMissionView(base({ journeyInput: RESOLVED('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'INSUFFICIENT_EVIDENCE', 0, 0) }));
    if (withEvidence.journey.status !== 'RESOLVED' || withoutEvidence.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(withEvidence.journey.stage).toBe(withoutEvidence.journey.stage);
    const m = (v: typeof withEvidence, rung: string) =>
      v.journey.status === 'RESOLVED' ? v.journey.milestones.find((x) => x.rung === rung)! : null!;
    expect(m(withEvidence, 'LEARN').demonstrated).toBe(true);
    expect(m(withEvidence, 'PROVE').demonstrated).toBe(true);
    expect(m(withoutEvidence, 'LEARN').demonstrated).toBe(false);
    expect(m(withoutEvidence, 'PROVE').demonstrated).toBe(false);
  });

  it('`demonstrated` is backed by a named canonical record, never by position', () => {
    const v = buildConceptMissionView(base({ journeyInput: RESOLVED('TRANSFER_GAP'), knowledgeState: ks('VALIDATED_MASTERY', 'TRANSFER_REQUIRED', 0, 0), transferDepth: null }));
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    const m = (rung: string) => v.journey.status === 'RESOLVED' ? v.journey.milestones.find((x) => x.rung === rung)! : null!;
    expect(m('LEARN').position).toBe('PASSED');
    expect(m('LEARN').demonstrated).toBe(false);
    expect(m('LEARN').demonstratedBy).toBeNull();
    expect(m('TRANSFER').position).toBe('CURRENT');
  });

  it('transferDepth NONE is not a demonstration', () => {
    const v = buildConceptMissionView(base({ journeyInput: RESOLVED('TRANSFER_GAP'), knowledgeState: ks('VALIDATED_MASTERY', 'TRANSFER_REQUIRED', 5, 2), transferDepth: 'NONE' }));
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(v.journey.milestones.find((m) => m.rung === 'TRANSFER')!.demonstrated).toBe(false);
  });

  it('readyToProve appears only on PROVE and only for the READY_TO_PROVE stage', () => {
    const ready = buildConceptMissionView(base({ journeyInput: RESOLVED('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'READY') }));
    if (ready.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(ready.journey.milestones.find((m) => m.rung === 'PROVE')!.readyToProve).toBe(true);
    for (const m of ready.journey.milestones) if (m.rung !== 'PROVE') expect(m.readyToProve).toBeUndefined();
  });

  it('CONSOLIDATED shows every rung as PASSED', () => {
    const v = buildConceptMissionView(base({ journeyInput: RESOLVED('VALIDATED', 'CANONICAL_POLICY_NO_SIGNALS'), knowledgeState: ks('VALIDATED_MASTERY', 'READY') }));
    if (v.journey.status !== 'RESOLVED') throw new Error('expected RESOLVED');
    expect(v.journey.milestones.every((m) => m.position === 'PASSED')).toBe(true);
  });

  it('is deterministic', () => {
    const inputs = base({ journeyInput: RESOLVED('RETENTION_RISK'), knowledgeState: ks('VALIDATED_MASTERY', 'READY', 9, 3) });
    expect(buildConceptMissionView(inputs)).toEqual(buildConceptMissionView(inputs));
  });
});

/* ================================================================= */
/* learn surface                                                     */
/* ================================================================= */

describe('LX-3 -- learn surface prominence', () => {
  it('is inline & primary when understanding is the job (LEARN / NOT_STARTED / REINFORCE / unavailable)', () => {
    expect(buildConceptMissionView(base({ journeyInput: RESOLVED('NOT_STARTED', 'CANONICAL_POLICY_NO_SIGNALS') })).learn.prominence).toBe('PRIMARY_INLINE');
    expect(buildConceptMissionView(base({ journeyInput: RESOLVED('DEVELOPING'), knowledgeState: ks('LEARNING', 'INSUFFICIENT_EVIDENCE') })).learn.prominence).toBe('PRIMARY_INLINE');
    expect(buildConceptMissionView(base({ journeyInput: RESOLVED('MISCONCEPTION_BLOCKED'), knowledgeState: ks('INTERVENTION_REQUIRED', 'ACTIVE_CRITICAL_MISCONCEPTION') })).learn.prominence).toBe('PRIMARY_INLINE');
    expect(buildConceptMissionView(base({ journeyInput: UNAVAILABLE })).learn.prominence).toBe('PRIMARY_INLINE');
  });

  it('is secondary once the learner is past understanding', () => {
    expect(buildConceptMissionView(base({ journeyInput: RESOLVED('RETENTION_RISK'), knowledgeState: ks('VALIDATED_MASTERY', 'READY') })).learn.prominence).toBe('SECONDARY');
  });

  it('reflects whether an explanation is already cached', () => {
    expect(buildConceptMissionView(base({ hasCachedExplanation: false })).learn.state).toBe('READ');
    expect(buildConceptMissionView(base({ hasCachedExplanation: true })).learn.state).toBe('REVIEW');
  });
});
