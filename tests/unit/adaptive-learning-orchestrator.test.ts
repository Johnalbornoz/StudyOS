import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  consolidateSignals,
  buildLearningDecisions,
  rankLearningDecisions,
  selectActivityType,
  type LearningSignal,
  type ConceptDecisionContext,
  type LearningDecision,
} from '@/lib/adaptive-learning-policy';
import type { ConceptKnowledgeState } from '@/services/knowledge-state.service';
import { evidenceModeForActivity } from '@/lib/activity-taxonomy';

function signal(overrides: Partial<LearningSignal> & Pick<LearningSignal, 'type' | 'conceptId' | 'subjectId'>): LearningSignal {
  return { source: 'test', metadata: {}, ...overrides };
}

function ksState(overrides: Partial<ConceptKnowledgeState> = {}): ConceptKnowledgeState {
  return {
    studentId: 's1',
    conceptId: 'c1',
    subjectId: 'subj1',
    masteryState: 'DEVELOPING',
    understandingScore: 70,
    independenceScore: 65,
    applicationScore: 60,
    retentionScore: null,
    transferScore: null,
    activeMisconceptionCount: 0,
    criticalMisconceptionCount: 0,
    recurringMisconceptionCount: 0,
    evidenceCount: 5,
    independentEvidenceCount: 2,
    firstEvidenceAt: null,
    lastEvidenceAt: null,
    validationReadiness: 'INSUFFICIENT_EVIDENCE',
    stateReason: null,
    projectionVersion: 1,
    masteryPolicyVersion: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** One signal -> one consolidated decision, no Knowledge State attached unless the caller passes a map. */
function buildDecision(signals: LearningSignal[], ksMap: Map<string, ConceptKnowledgeState> = new Map()): LearningDecision {
  const contexts = consolidateSignals(signals, ksMap);
  const decisions = buildLearningDecisions(contexts);
  return decisions[0];
}

describe('1. Multi-signal consolidation: no signal is ever destroyed', () => {
  it('a concept with exam + debt + forgetting + independence signals keeps all four in one context', () => {
    const signals = [
      signal({ type: 'EXAM_APPROACHING', conceptId: 'c1', subjectId: 's1', metadata: { daysUntil: 5 } }),
      signal({ type: 'LEARNING_DEBT', conceptId: 'c1', subjectId: 's1', metadata: { severity: 3 } }),
      signal({ type: 'FORGETTING_RISK', conceptId: 'c1', subjectId: 's1', metadata: { forgettingRisk: 60 } }),
      signal({ type: 'INDEPENDENCE_GAP', conceptId: 'c1', subjectId: 's1', metadata: {} }),
    ];
    const contexts = consolidateSignals(signals, new Map());
    expect(contexts).toHaveLength(1);
    expect(contexts[0].signals).toHaveLength(4);
    expect(new Set(contexts[0].signals.map((s) => s.type))).toEqual(
      new Set(['EXAM_APPROACHING', 'LEARNING_DEBT', 'FORGETTING_RISK', 'INDEPENDENCE_GAP'])
    );
  });
});

describe('2. No duplicate concept decision', () => {
  it('the same actionable concept arriving from Scheduler, Knowledge State, and Cognitive Engine sources produces ONE consolidated decision', () => {
    const signals = [
      signal({ type: 'AT_RISK', conceptId: 'c1', subjectId: 's1', source: 'learning-scheduler.service' }),
      signal({ type: 'LOW_UNDERSTANDING', conceptId: 'c1', subjectId: 's1', source: 'knowledge-state.service', metadata: { understandingScore: 50, gap: 30 } }),
      signal({ type: 'RECURRING_MISCONCEPTION', conceptId: 'c1', subjectId: 's1', source: 'misconception.service', metadata: { occurrenceCount: 3 } }),
    ];
    const decisions = buildLearningDecisions(consolidateSignals(signals, new Map()));
    expect(decisions).toHaveLength(1);
    expect(decisions[0].signals).toHaveLength(3);
  });
});

describe('3. Root cause: actionConceptId is the root cause, target stays provenance', () => {
  it('target concept A with root cause B under active remediation: actionConceptId = B, A remains provenance', () => {
    const signals = [
      signal({ type: 'REMEDIATION_ACTIVE', conceptId: 'B', subjectId: 's1', targetConceptId: 'A', remediationPathId: 'rp1', metadata: { pattern: 'LOW_MASTERY' } }),
    ];
    const [ctx] = consolidateSignals(signals, new Map());
    expect(ctx.actionConceptId).toBe('B');
    expect(ctx.rootCauseConceptId).toBe('B');
    expect(ctx.targetConceptIds).toEqual(['A']);
    const [decision] = buildLearningDecisions([ctx]);
    expect(decision.actionConceptId).toBe('B');
    expect(decision.targetConceptIds).toEqual(['A']);
    expect(decision.remediationPathId).toBe('rp1');
  });
});

describe('4. Multiple targets, one root: no duplicate repair decisions', () => {
  it('targets A and C both blocked by root cause B collapse into one decision, both preserved as provenance', () => {
    const signals = [
      signal({ type: 'REMEDIATION_ACTIVE', conceptId: 'B', subjectId: 's1', targetConceptId: 'A', remediationPathId: 'rp1', metadata: { pattern: 'LOW_MASTERY' } }),
      signal({ type: 'REMEDIATION_UNFINISHED', conceptId: 'B', subjectId: 's1', targetConceptId: 'C', remediationPathId: 'rp2' }),
    ];
    const [ctx] = consolidateSignals(signals, new Map());
    expect(ctx.actionConceptId).toBe('B');
    expect(new Set(ctx.targetConceptIds)).toEqual(new Set(['A', 'C']));
    const decisions = buildLearningDecisions([ctx]);
    expect(decisions).toHaveLength(1);
  });
});

describe('5 & 6. INTERVENTION_REQUIRED: high-priority, never a mastery write', () => {
  it('5. INTERVENTION_REQUIRED produces a high-priority (CRITICAL) actionable decision', () => {
    const d = buildDecision([signal({ type: 'INTERVENTION_REQUIRED', conceptId: 'c1', subjectId: 's1' })]);
    expect(d.pedagogicalPriority).toBe('CRITICAL');
    expect(d.activityType).toBe('PRACTICE');
  });

  it('6. building a decision is pure -- identical input always produces byte-identical output, no hidden mutation/state', () => {
    const ctxs = consolidateSignals([signal({ type: 'INTERVENTION_REQUIRED', conceptId: 'c1', subjectId: 's1' })], new Map());
    expect(buildLearningDecisions(ctxs)).toEqual(buildLearningDecisions(ctxs));
  });
});

describe('7 & 8. Active remediation vs. exam proximity (NBA v2 invariant)', () => {
  it('7. active remediation outranks a non-critical exam (more than 2 days out)', () => {
    const remediation = buildDecision([signal({ type: 'REMEDIATION_ACTIVE', conceptId: 'c1', subjectId: 's1', metadata: { pattern: 'LOW_MASTERY' } })]);
    const exam = buildDecision([signal({ type: 'EXAM_APPROACHING', conceptId: 'c2', subjectId: 's1', metadata: { daysUntil: 5 } })]);
    expect(remediation.priorityScore).toBeGreaterThan(exam.priorityScore);
  });

  it('8. an imminent exam (<=2 days) is the one thing that outranks active remediation', () => {
    const remediation = buildDecision([signal({ type: 'REMEDIATION_ACTIVE', conceptId: 'c1', subjectId: 's1', metadata: { pattern: 'LOW_MASTERY' } })]);
    const exam = buildDecision([signal({ type: 'EXAM_APPROACHING', conceptId: 'c2', subjectId: 's1', metadata: { daysUntil: 2 } })]);
    expect(exam.priorityScore).toBeGreaterThan(remediation.priorityScore);
  });
});

describe('9 & 10. Prerequisite gap vs. its symptom, and Learning Unlock Value scaling', () => {
  it('9. a confirmed prerequisite/root-cause gap outranks the low-mastery symptom it causes', () => {
    const gap = buildDecision([signal({ type: 'PREREQUISITE_GAP', conceptId: 'root', subjectId: 's1', metadata: { unlockValue: 10 } })]);
    const symptom = buildDecision([signal({ type: 'LOW_UNDERSTANDING', conceptId: 'sym', subjectId: 's1', metadata: { understandingScore: 40, gap: 40 } })]);
    expect(gap.priorityScore).toBeGreaterThan(symptom.priorityScore);
  });

  it('10. a bigger Learning Unlock Value ranks a prerequisite gap higher than a smaller one', () => {
    const big = buildDecision([signal({ type: 'PREREQUISITE_GAP', conceptId: 'c1', subjectId: 's1', metadata: { unlockValue: 80 } })]);
    const small = buildDecision([signal({ type: 'PREREQUISITE_GAP', conceptId: 'c2', subjectId: 's1', metadata: { unlockValue: 10 } })]);
    expect(big.priorityScore).toBeGreaterThan(small.priorityScore);
  });
});

describe('11. Diagnosis required selects DIAGNOSTIC_CHECK', () => {
  it('never remediates a root cause that has not yet been established', () => {
    const d = buildDecision([signal({ type: 'DIAGNOSIS_REQUIRED', conceptId: 'c1', subjectId: 's1' })]);
    expect(d.activityType).toBe('DIAGNOSTIC_CHECK');
    expect(d.targetDimension).toBe('PREREQUISITE');
  });
});

describe('12 & 13. Retention selects RETENTION_CHECK, evidence mode stays INDEPENDENT', () => {
  it('12. retention due / WAITING_FOR_RETENTION selects RETENTION_CHECK', () => {
    const d = buildDecision([signal({ type: 'WAITING_FOR_RETENTION', conceptId: 'c1', subjectId: 's1' })]);
    expect(d.activityType).toBe('RETENTION_CHECK');
  });

  it('13. evidenceModeForActivity(RETENTION_CHECK) remains INDEPENDENT -- no second mapping introduced', () => {
    expect(evidenceModeForActivity('RETENTION_CHECK')).toBe('INDEPENDENT');
  });
});

describe('14. Transfer required selects TRANSFER', () => {
  it('transfer required selects TRANSFER', () => {
    const d = buildDecision([signal({ type: 'TRANSFER_REQUIRED', conceptId: 'c1', subjectId: 's1' })]);
    expect(d.activityType).toBe('TRANSFER');
  });
});

describe('15 & 16. Independence gap selects SOLO_CHECK, evidence mode stays INDEPENDENT', () => {
  it('15. independence gap selects SOLO_CHECK', () => {
    const d = buildDecision([signal({ type: 'INDEPENDENCE_GAP', conceptId: 'c1', subjectId: 's1' })]);
    expect(d.activityType).toBe('SOLO_CHECK');
  });

  it('16. evidenceModeForActivity(SOLO_CHECK) remains INDEPENDENT', () => {
    expect(evidenceModeForActivity('SOLO_CHECK')).toBe('INDEPENDENT');
  });
});

describe('17. Understanding / debt: PRACTICE-vs-REVIEW is deterministic, never random', () => {
  it('a concept still at the LEARNING stage with weak understanding chooses PRACTICE (nothing yet to review)', () => {
    const ksMap = new Map([['c1', ksState({ conceptId: 'c1', masteryState: 'LEARNING', understandingScore: 40 })]]);
    const d = buildDecision([signal({ type: 'LOW_UNDERSTANDING', conceptId: 'c1', subjectId: 's1', metadata: { understandingScore: 40, gap: 40 } })], ksMap);
    expect(d.activityType).toBe('PRACTICE');
  });

  it('a concept past LEARNING with real existing evidence chooses REVIEW', () => {
    const ksMap = new Map([['c2', ksState({ conceptId: 'c2', masteryState: 'DEVELOPING', understandingScore: 75 })]]);
    const d = buildDecision([signal({ type: 'LEARNING_DEBT', conceptId: 'c2', subjectId: 's1', metadata: { severity: 2 } })], ksMap);
    expect(d.activityType).toBe('REVIEW');
  });

  it('is deterministic: calling it repeatedly on the same context never flips the result', () => {
    const ksMap = new Map([['c2', ksState({ conceptId: 'c2', masteryState: 'DEVELOPING', understandingScore: 75 })]]);
    const [ctx] = consolidateSignals([signal({ type: 'LEARNING_DEBT', conceptId: 'c2', subjectId: 's1', metadata: { severity: 2 } })], ksMap);
    const results = Array.from({ length: 5 }, () => selectActivityType(ctx));
    expect(new Set(results).size).toBe(1);
  });
});

describe('18 & 19. Misconceptions', () => {
  it('18. recurring misconception priority increases with occurrence count', () => {
    const low = buildDecision([signal({ type: 'RECURRING_MISCONCEPTION', conceptId: 'c1', subjectId: 's1', metadata: { occurrenceCount: 2 } })]);
    const high = buildDecision([signal({ type: 'RECURRING_MISCONCEPTION', conceptId: 'c2', subjectId: 's1', metadata: { occurrenceCount: 20 } })]);
    expect(high.priorityScore).toBeGreaterThan(low.priorityScore);
  });

  it('19. a critical misconception is not hidden by a superficial high mastery score', () => {
    const ksMap = new Map([['c1', ksState({ conceptId: 'c1', masteryState: 'PROVISIONAL_MASTERY', understandingScore: 95, criticalMisconceptionCount: 1 })]]);
    const d = buildDecision([signal({ type: 'CRITICAL_MISCONCEPTION', conceptId: 'c1', subjectId: 's1', metadata: {} })], ksMap);
    expect(d.pedagogicalPriority).toBe('CRITICAL');
  });
});

describe('20. Temporal urgency stays separate from pedagogical priority', () => {
  it('a CRITICAL time-bound deadline does not by itself force CRITICAL pedagogical priority', () => {
    const d = buildDecision([signal({ type: 'RETENTION_REVIEW_DUE', conceptId: 'c1', subjectId: 's1', temporalUrgency: 'CRITICAL' })]);
    expect(d.temporalUrgency).toBe('CRITICAL');
    expect(d.pedagogicalPriority).not.toBe('CRITICAL');
  });

  it('a CRITICAL pedagogical priority (active escalation) can coexist with no temporal deadline at all', () => {
    const d = buildDecision([signal({ type: 'INTERVENTION_REQUIRED', conceptId: 'c1', subjectId: 's1' })]);
    expect(d.pedagogicalPriority).toBe('CRITICAL');
    expect(d.temporalUrgency).toBeNull();
  });
});

describe('21. Multiple secondary signal modifiers cannot violate the dominant-class invariant', () => {
  it('piling low-tier signals onto active remediation never lets it cross into imminent-exam territory', () => {
    const remediationPlusExtras = buildDecision([
      signal({ type: 'REMEDIATION_ACTIVE', conceptId: 'c1', subjectId: 's1', metadata: { pattern: 'LOW_MASTERY' } }),
      signal({ type: 'RECURRING_MISCONCEPTION', conceptId: 'c1', subjectId: 's1', metadata: { occurrenceCount: 500 } }),
      signal({ type: 'LEARNING_DEBT', conceptId: 'c1', subjectId: 's1', metadata: { severity: 5 } }),
      signal({ type: 'FORGETTING_RISK', conceptId: 'c1', subjectId: 's1', metadata: { forgettingRisk: 100 } }),
    ]);
    const imminentExam = buildDecision([signal({ type: 'EXAM_APPROACHING', conceptId: 'c2', subjectId: 's1', metadata: { daysUntil: 1 } })]);
    expect(imminentExam.priorityScore).toBeGreaterThan(remediationPlusExtras.priorityScore);
  });
});

describe('22. Deterministic tie-breaking, independent of input array order', () => {
  it('identical-priority decisions always order the same way regardless of input order', () => {
    const a = buildDecision([signal({ type: 'LEARNING_DEBT', conceptId: 'c-a', subjectId: 'subj-a', metadata: { severity: 2 } })]);
    const b = buildDecision([signal({ type: 'LEARNING_DEBT', conceptId: 'c-b', subjectId: 'subj-a', metadata: { severity: 2 } })]);
    const order1 = rankLearningDecisions([a, b]).map((d) => d.actionConceptId);
    const order2 = rankLearningDecisions([b, a]).map((d) => d.actionConceptId);
    expect(order1).toEqual(order2);
    expect(order1[0]).toBe('c-a');
  });

  it('breaks ties by soonest dueAt before falling back to subjectId/actionConceptId', () => {
    const soon = buildDecision([signal({ type: 'LEARNING_DEBT', conceptId: 'c-z', subjectId: 'subj-z', dueAt: '2026-01-01T00:00:00Z', metadata: { severity: 2 } })]);
    const later = buildDecision([signal({ type: 'LEARNING_DEBT', conceptId: 'c-a', subjectId: 'subj-a', dueAt: '2026-06-01T00:00:00Z', metadata: { severity: 2 } })]);
    expect(rankLearningDecisions([later, soon])[0].actionConceptId).toBe('c-z');
  });
});

describe('23 & 24. Calibration conflicts respect the data-quality boundary', () => {
  it('23. a real, high-quality (directional) calibration conflict becomes actionable', () => {
    const d = buildDecision([
      signal({ type: 'CALIBRATION_CONFLICT', conceptId: 'c1', subjectId: 's1', calibrationConflictId: 'cc1', metadata: { tags: ['INTERNAL_OVERESTIMATION'], actionable: true, conflictMagnitude: 30 } }),
    ]);
    expect(d.activityType).toBe('DIAGNOSTIC_CHECK');
    expect(d.pedagogicalPriority).toBe('MEDIUM');
  });

  it('24. LOW_MAPPING_CONFIDENCE/COVERAGE_MISMATCH alone never gets promoted into a strong knowledge-gap decision', () => {
    const d = buildDecision([
      signal({
        type: 'CALIBRATION_CONFLICT',
        conceptId: 'c1',
        subjectId: 's1',
        calibrationConflictId: 'cc1',
        metadata: { tags: ['LOW_MAPPING_CONFIDENCE', 'COVERAGE_MISMATCH'], actionable: false, conflictMagnitude: 30 },
      }),
    ]);
    expect(d.activityType).not.toBe('DIAGNOSTIC_CHECK');
    expect(d.pedagogicalPriority).toBe('LOW');
  });
});

describe('26. No LLM dependency in the policy module', () => {
  it('the pure policy source has no AI/LLM import or call anywhere', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/adaptive-learning-policy.ts'), 'utf-8');
    expect(source).not.toMatch(/openai|anthropic|generateText|generateObject/i);
  });
});

describe('27. No second Knowledge State/MasteryState writer', () => {
  it('the orchestrator source contains no write to concept_knowledge_state and never imports the projector for mutation', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/adaptive-learning-orchestrator.service.ts'), 'utf-8');
    expect(source).not.toMatch(/INSERT INTO concept_knowledge_state|UPDATE concept_knowledge_state/i);
    expect(source).not.toMatch(/recalculateConceptKnowledgeState/);
  });

  it('the pure policy source performs no IO at all (no db import, no fetch)', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/adaptive-learning-policy.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"]@\/lib\/db['"]/);
    expect(source).not.toMatch(/\bfetch\(/);
  });
});

describe('28. learning-scheduler.service.ts gained no new priority/ranking logic', () => {
  it('the Scheduler source has no priority/ranking vocabulary -- it remains time-only', () => {
    const source = readFileSync(join(process.cwd(), 'src/services/learning-scheduler.service.ts'), 'utf-8');
    expect(source).not.toMatch(/priorityScore|pedagogicalPriority|rankLearningDecisions|nbaPriority|selectActivityType/);
  });
});

describe('29 & 30. Legacy NBA v2 compatibility invariants, reproduced against Phase 3C signals', () => {
  it('29. diagnosis required ranks above forgetting risk and independence gap but below learning debt', () => {
    const diagnosis = buildDecision([signal({ type: 'DIAGNOSIS_REQUIRED', conceptId: 'c1', subjectId: 's1' })]);
    const forgetting = buildDecision([signal({ type: 'FORGETTING_RISK', conceptId: 'c2', subjectId: 's1', metadata: { forgettingRisk: 90 } })]);
    const independence = buildDecision([signal({ type: 'INDEPENDENCE_GAP', conceptId: 'c3', subjectId: 's1' })]);
    const debt = buildDecision([signal({ type: 'LEARNING_DEBT', conceptId: 'c4', subjectId: 's1', metadata: { severity: 1 } })]);
    expect(diagnosis.priorityScore).toBeGreaterThan(forgetting.priorityScore);
    expect(diagnosis.priorityScore).toBeGreaterThan(independence.priorityScore);
    expect(diagnosis.priorityScore).toBeLessThan(debt.priorityScore);
  });

  it('30. lower understanding remains more urgent within otherwise-equivalent plain low-understanding contexts', () => {
    const lower = buildDecision([signal({ type: 'LOW_UNDERSTANDING', conceptId: 'c1', subjectId: 's1', metadata: { understandingScore: 30, gap: 50 } })]);
    const higher = buildDecision([signal({ type: 'LOW_UNDERSTANDING', conceptId: 'c2', subjectId: 's1', metadata: { understandingScore: 70, gap: 10 } })]);
    expect(lower.priorityScore).toBeGreaterThan(higher.priorityScore);
  });
});
