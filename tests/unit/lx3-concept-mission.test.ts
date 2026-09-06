/**
 * LX-3B/D/E -- the pure Concept Mission read model.
 *
 * These lock the architectural invariants: the Mission presents
 * canonical truth and never becomes a second Learning Engine. It never
 * chooses an ActivityType, never invents completion history, never
 * applies a score threshold, and derives the learner-visible stage
 * only through LX-1's `deriveLearnerJourneyStage`.
 */
import { describe, it, expect } from 'vitest';
import {
  buildConceptMissionView,
  CONCEPT_MISSION_VIEW_VERSION,
  type ConceptMissionInputs,
} from '@/lib/lx/concept-mission';
import type { LearningState, LearningFact } from '@/lib/adaptive-learning-policy';
import type { MasteryState, ValidationReadiness } from '@/services/knowledge-state.service';

const FACTS: LearningFact[] = [{ kind: 'forgettingRisk', forgettingRisk: 62 } as unknown as LearningFact];

function base(over: Partial<ConceptMissionInputs> = {}): ConceptMissionInputs {
  return {
    conceptName: 'Factoring Trinomials',
    subjectId: 'subj-1',
    subjectName: 'Algebra',
    conceptDescription: null,
    goalFallbackText: 'Understand Factoring Trinomials and apply it correctly and on your own.',
    knowledgeState: null,
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
  return {
    activityType: 'PRACTICE' as const,
    actionConceptId: 'concept-42',
    learningState,
    facts: FACTS,
    ...over,
  };
}

describe('LX-3 buildConceptMissionView -- journey stage (via LX-1 contract only)', () => {
  const cases: Array<[string, ConceptMissionInputs, string, 'REINFORCE' | null]> = [
    ['NOT_STARTED', base(), 'NOT_STARTED', null],
    [
      'LEARN',
      base({ learningDecision: decision('DEVELOPING'), knowledgeState: ks('LEARNING', 'INSUFFICIENT_EVIDENCE') }),
      'LEARN',
      null,
    ],
    [
      'PRACTICE',
      base({ learningDecision: decision('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'INSUFFICIENT_EVIDENCE') }),
      'PRACTICE',
      null,
    ],
    [
      'READY_TO_PROVE',
      base({ learningDecision: decision('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'READY') }),
      'READY_TO_PROVE',
      null,
    ],
    [
      'PROVE',
      base({ learningDecision: decision('PENDING_VERIFICATION'), knowledgeState: ks('PROVISIONAL_MASTERY', 'INSUFFICIENT_EVIDENCE') }),
      'PROVE',
      null,
    ],
    [
      'RETAIN',
      base({ learningDecision: decision('RETENTION_RISK'), knowledgeState: ks('VALIDATED_MASTERY', 'READY') }),
      'RETAIN',
      null,
    ],
    [
      'TRANSFER',
      base({ learningDecision: decision('TRANSFER_GAP'), knowledgeState: ks('VALIDATED_MASTERY', 'TRANSFER_REQUIRED') }),
      'TRANSFER',
      null,
    ],
    [
      'CONSOLIDATED (no decision, validated knowledge state)',
      base({ knowledgeState: ks('VALIDATED_MASTERY', 'READY') }),
      'CONSOLIDATED',
      null,
    ],
    [
      'REINFORCE overlay',
      base({ learningDecision: decision('MISCONCEPTION_BLOCKED'), knowledgeState: ks('INTERVENTION_REQUIRED', 'ACTIVE_CRITICAL_MISCONCEPTION') }),
      'PRACTICE',
      'REINFORCE',
    ],
  ];

  for (const [name, inputs, expectedStage, expectedIntervention] of cases) {
    it(`maps ${name}`, () => {
      const v = buildConceptMissionView(inputs);
      expect(v.journey.stage).toBe(expectedStage);
      expect(v.journey.intervention).toBe(expectedIntervention);
      expect(v.contractVersion).toBe(CONCEPT_MISSION_VIEW_VERSION);
    });
  }

  it('records how the stage was sourced', () => {
    expect(buildConceptMissionView(base()).journey.source).toBe('NO_KNOWLEDGE_STATE');
    expect(buildConceptMissionView(base({ knowledgeState: ks('VALIDATED_MASTERY', 'READY') })).journey.source).toBe(
      'KNOWLEDGE_STATE_VALIDATED',
    );
    expect(buildConceptMissionView(base({ knowledgeState: ks('DEVELOPING', 'INSUFFICIENT_EVIDENCE') })).journey.source).toBe(
      'KNOWLEDGE_STATE_RESIDUAL',
    );
    expect(
      buildConceptMissionView(base({ learningDecision: decision('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'READY') }))
        .journey.source,
    ).toBe('LEARNING_DECISION');
  });
});

describe('LX-3 -- the Mission never chooses an ActivityType', () => {
  it('passes the canonical decision through verbatim', () => {
    const d = decision('PENDING_VERIFICATION', { activityType: 'SOLO_VERIFY', actionConceptId: 'c-9' });
    const v = buildConceptMissionView(base({ learningDecision: d, knowledgeState: ks('PROVISIONAL_MASTERY', 'INSUFFICIENT_EVIDENCE') }));
    expect(v.now.kind).toBe('CANONICAL_ACTION');
    expect(v.now.activityType).toBe('SOLO_VERIFY');
    expect(v.now.actionConceptId).toBe('c-9');
    expect(v.now.facts).toBe(d.facts);
    expect(v.now.fallback).toBeNull();
  });

  it('never emits an activity when Phase 4 has no decision', () => {
    const notStarted = buildConceptMissionView(base());
    expect(notStarted.now.kind).toBe('NO_CANONICAL_ACTION');
    expect(notStarted.now.activityType).toBeNull();
    expect(notStarted.now.actionConceptId).toBeNull();
    expect(notStarted.now.facts).toEqual([]);
    expect(notStarted.now.fallback).toBe('LEARN_FIRST');

    const consolidated = buildConceptMissionView(base({ knowledgeState: ks('VALIDATED_MASTERY', 'READY') }));
    expect(consolidated.now.kind).toBe('NO_CANONICAL_ACTION');
    expect(consolidated.now.activityType).toBeNull();
    expect(consolidated.now.fallback).toBe('CONSOLIDATED_NO_ACTION');
  });

  it('does not synthesise a time estimate', () => {
    const v = buildConceptMissionView(base({ learningDecision: decision('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'READY') }));
    expect(v.now).not.toHaveProperty('timeEstimate');
    expect(v.now).not.toHaveProperty('estimatedMinutes');
    expect(JSON.stringify(v)).not.toMatch(/min\b/);
  });
});

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

describe('LX-3 -- journey milestones: no thresholds, no invented completion history', () => {
  it('stage is independent of evidence counts; only `demonstrated` reflects them', () => {
    const withEvidence = buildConceptMissionView(
      base({ learningDecision: decision('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'INSUFFICIENT_EVIDENCE', 12, 4) }),
    );
    const withoutEvidence = buildConceptMissionView(
      base({ learningDecision: decision('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'INSUFFICIENT_EVIDENCE', 0, 0) }),
    );
    expect(withEvidence.journey.stage).toBe(withoutEvidence.journey.stage);

    const learn = (v: typeof withEvidence, rung: string) => v.journey.milestones.find((m) => m.rung === rung)!;
    expect(learn(withEvidence, 'LEARN').demonstrated).toBe(true);
    expect(learn(withEvidence, 'PROVE').demonstrated).toBe(true);
    expect(learn(withoutEvidence, 'LEARN').demonstrated).toBe(false);
    expect(learn(withoutEvidence, 'PROVE').demonstrated).toBe(false);
  });

  it('`demonstrated` is backed by a named canonical record, never by position', () => {
    // stage TRANSFER (rungs before it are PASSED) but zero evidence recorded:
    // PASSED must NOT imply demonstrated.
    const v = buildConceptMissionView(
      base({ learningDecision: decision('TRANSFER_GAP'), knowledgeState: ks('VALIDATED_MASTERY', 'TRANSFER_REQUIRED', 0, 0), transferDepth: null }),
    );
    const m = (rung: string) => v.journey.milestones.find((x) => x.rung === rung)!;
    expect(m('LEARN').position).toBe('PASSED');
    expect(m('LEARN').demonstrated).toBe(false);
    expect(m('LEARN').demonstratedBy).toBeNull();
    expect(m('TRANSFER').position).toBe('CURRENT');
  });

  it('retention and transfer demonstration read their own canonical facts', () => {
    const v = buildConceptMissionView(
      base({
        learningDecision: decision('TRANSFER_GAP'),
        knowledgeState: ks('VALIDATED_MASTERY', 'TRANSFER_REQUIRED', 20, 8),
        memory: { lastSuccessfulRetentionAt: '2026-01-02T00:00:00Z', retentionDue: false, memoryStatus: 'STABLE' },
        transferDepth: 'NEAR_DEMONSTRATED',
      }),
    );
    const m = (rung: string) => v.journey.milestones.find((x) => x.rung === rung)!;
    expect(m('RETAIN').demonstrated).toBe(true);
    expect(m('RETAIN').demonstratedBy).toBe('RETENTION_DEMONSTRATED');
    expect(m('TRANSFER').demonstrated).toBe(true);
    expect(m('TRANSFER').demonstratedBy).toBe('TRANSFER_DEMONSTRATED');
  });

  it('transferDepth NONE is not a demonstration', () => {
    const v = buildConceptMissionView(
      base({ learningDecision: decision('TRANSFER_GAP'), knowledgeState: ks('VALIDATED_MASTERY', 'TRANSFER_REQUIRED', 5, 2), transferDepth: 'NONE' }),
    );
    expect(v.journey.milestones.find((m) => m.rung === 'TRANSFER')!.demonstrated).toBe(false);
  });

  it('readyToProve appears only on PROVE and only for the READY_TO_PROVE stage', () => {
    const ready = buildConceptMissionView(base({ learningDecision: decision('DEVELOPING'), knowledgeState: ks('DEVELOPING', 'READY') }));
    const proveM = ready.journey.milestones.find((m) => m.rung === 'PROVE')!;
    expect(proveM.readyToProve).toBe(true);
    for (const m of ready.journey.milestones) {
      if (m.rung !== 'PROVE') expect(m.readyToProve).toBeUndefined();
    }
    const notReady = buildConceptMissionView(base({ learningDecision: decision('PENDING_VERIFICATION'), knowledgeState: ks('PROVISIONAL_MASTERY', 'INSUFFICIENT_EVIDENCE') }));
    expect(notReady.journey.milestones.find((m) => m.rung === 'PROVE')!.readyToProve).toBe(false);
  });

  it('CONSOLIDATED shows every rung as PASSED', () => {
    const v = buildConceptMissionView(base({ knowledgeState: ks('VALIDATED_MASTERY', 'READY') }));
    expect(v.journey.milestones.every((m) => m.position === 'PASSED')).toBe(true);
  });

  it('is deterministic', () => {
    const inputs = base({ learningDecision: decision('RETENTION_RISK'), knowledgeState: ks('VALIDATED_MASTERY', 'READY', 9, 3) });
    expect(buildConceptMissionView(inputs)).toEqual(buildConceptMissionView(inputs));
  });
});

describe('LX-3 -- learn surface prominence', () => {
  it('is inline & primary when understanding is the job', () => {
    expect(buildConceptMissionView(base()).learn.prominence).toBe('PRIMARY_INLINE'); // NOT_STARTED
    expect(
      buildConceptMissionView(base({ learningDecision: decision('DEVELOPING'), knowledgeState: ks('LEARNING', 'INSUFFICIENT_EVIDENCE') })).learn
        .prominence,
    ).toBe('PRIMARY_INLINE'); // LEARN
    expect(
      buildConceptMissionView(base({ learningDecision: decision('MISCONCEPTION_BLOCKED'), knowledgeState: ks('INTERVENTION_REQUIRED', 'ACTIVE_CRITICAL_MISCONCEPTION') }))
        .learn.prominence,
    ).toBe('PRIMARY_INLINE'); // REINFORCE
  });

  it('is secondary once the learner is past understanding', () => {
    expect(
      buildConceptMissionView(base({ learningDecision: decision('RETENTION_RISK'), knowledgeState: ks('VALIDATED_MASTERY', 'READY') })).learn
        .prominence,
    ).toBe('SECONDARY');
  });

  it('reflects whether an explanation is already cached', () => {
    expect(buildConceptMissionView(base({ hasCachedExplanation: false })).learn.state).toBe('READ');
    expect(buildConceptMissionView(base({ hasCachedExplanation: true })).learn.state).toBe('REVIEW');
  });
});
