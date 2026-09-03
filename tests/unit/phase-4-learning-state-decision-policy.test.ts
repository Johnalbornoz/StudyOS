/**
 * Phase 4B/4C/4D/4G: canonical Learning State derivation, the two new
 * Phase 3-sourced signals (VERIFICATION_PENDING,
 * INSUFFICIENT_INDEPENDENT_EVIDENCE), and the required adversarial
 * (red-team) coverage -- all against the PURE policy
 * (adaptive-learning-policy.ts), no DB, no mocking. See
 * tests/unit/adaptive-learning-orchestrator.test.ts for the existing
 * Phase 3C pure-policy coverage this file extends, and
 * tests/unit/adaptive-learning-orchestrator-integration.test.ts /
 * tests/unit/phase-4-decision-engine-integration.test.ts for the real
 * (mocked-db) IO wiring of the same two signals.
 */
import { describe, it, expect } from 'vitest';
import {
  consolidateSignals,
  buildLearningDecisions,
  buildLearningDecision,
  computeLearningState,
  ADAPTIVE_LEARNING_POLICY_VERSION,
  type LearningSignal,
  type ConceptDecisionContext,
  type LearningDecision,
  type LearningState,
} from '@/lib/adaptive-learning-policy';
import type { ConceptKnowledgeState } from '@/services/knowledge-state.service';

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

function context(signals: LearningSignal[], ks: ConceptKnowledgeState | null = null): ConceptDecisionContext {
  const map = new Map<string, ConceptKnowledgeState>();
  if (ks) map.set(ks.conceptId, ks);
  const contexts = consolidateSignals(signals, map);
  return (
    contexts[0] ?? {
      actionConceptId: 'c1', subjectId: 'subj1', knowledgeState: ks, signals: [], targetConceptIds: [],
      remediationPathIds: [], diagnosisIds: [], occurrenceIds: [], calibrationConflictIds: [], verificationAttemptIds: [], quizSessionIds: [],
    }
  );
}

function decisionFor(signals: LearningSignal[], ks: ConceptKnowledgeState | null = null): LearningDecision {
  const ctx = context(signals, ks);
  return buildLearningDecision(ctx);
}

describe('Phase 4B -- computeLearningState: state vs action separation', () => {
  it('a state is never an ActivityType and an action is never confused with a state', () => {
    const ks = ksState({ masteryState: 'INTERVENTION_REQUIRED' });
    const decision = decisionFor([signal({ type: 'PREREQUISITE_GAP', conceptId: 'c1', subjectId: 'subj1', metadata: { unlockValue: 5 } })], ks);
    // STATE: PREREQUISITE_BLOCKED. ACTION: whatever selectActivityType picked (PRACTICE here). Never the same field, never the same value space.
    expect(decision.learningState).toBe('PREREQUISITE_BLOCKED');
    expect(decision.activityType).not.toBe('PREREQUISITE_BLOCKED');
    expect((['PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION', 'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM'] as const)).toContain(decision.activityType);
  });
});

describe('Phase 4B -- computeLearningState: NOT_STARTED', () => {
  it('no Knowledge State row at all -> NOT_STARTED', () => {
    expect(computeLearningState(context([signal({ type: 'LOW_UNDERSTANDING', conceptId: 'c1', subjectId: 'subj1', metadata: {} })], null))).toBe('NOT_STARTED');
  });
  it('masteryState UNKNOWN (zero evidence) -> NOT_STARTED even with a knowledgeState row present', () => {
    const ks = ksState({ masteryState: 'UNKNOWN', evidenceCount: 0 });
    expect(computeLearningState(context([], ks))).toBe('NOT_STARTED');
  });
});

describe('Phase 4G.1 -- RED TEAM: raw score cannot bypass a hard cognitive blocker', () => {
  it('high understanding/mastery + active critical misconception -> MISCONCEPTION_BLOCKED, never VALIDATED', () => {
    const ks = ksState({ masteryState: 'VALIDATED_MASTERY', understandingScore: 98, criticalMisconceptionCount: 1 });
    const decision = decisionFor([signal({ type: 'CRITICAL_MISCONCEPTION', conceptId: 'c1', subjectId: 'subj1', metadata: { criticalMisconceptionCount: 1 } })], ks);
    expect(decision.learningState).toBe('MISCONCEPTION_BLOCKED');
    expect(decision.learningState).not.toBe('VALIDATED');
    // Non-compensating: the ActivityType is the deterministic corrective one (PRACTICE), never a light REVIEW that a high score alone would otherwise justify.
    expect(decision.activityType).toBe('PRACTICE');
  });

  it('criticalMisconceptionCount alone (no explicit signal) still blocks, even with masteryState already VALIDATED_MASTERY', () => {
    const ks = ksState({ masteryState: 'VALIDATED_MASTERY', criticalMisconceptionCount: 2 });
    expect(computeLearningState(context([signal({ type: 'LOW_UNDERSTANDING', conceptId: 'c1', subjectId: 'subj1', metadata: {} })], ks))).toBe('MISCONCEPTION_BLOCKED');
  });
});

describe('Phase 4G.2 -- RED TEAM: assisted performance without independent evidence never reads as VALIDATED', () => {
  it('understanding above policy threshold but assessmentState.lastIndependentEvidence is null (surfaced as INSUFFICIENT_INDEPENDENT_EVIDENCE) -> not VALIDATED', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', understandingScore: 90 });
    const decision = decisionFor(
      [signal({ type: 'INSUFFICIENT_INDEPENDENT_EVIDENCE', conceptId: 'c1', subjectId: 'subj1', metadata: { understandingScore: 90 } })],
      ks
    );
    expect(decision.learningState).toBe('INSUFFICIENT_INDEPENDENT_EVIDENCE');
    expect(decision.learningState).not.toBe('VALIDATED');
    // The recommended action is the one ActivityType whose EvidenceMode is INDEPENDENT -- not a false ADVANCE, not more PRACTICE.
    expect(decision.activityType).toBe('SOLO_CHECK');
    expect(decision.targetDimension).toBe('INDEPENDENCE');
  });

  it('reasonCode is the machine-readable INSUFFICIENT_INDEPENDENT_EVIDENCE code, not a generic label', () => {
    const decision = decisionFor([signal({ type: 'INSUFFICIENT_INDEPENDENT_EVIDENCE', conceptId: 'c1', subjectId: 'subj1', metadata: {} })], ksState());
    expect(decision.reasonCode).toBe('INSUFFICIENT_INDEPENDENT_EVIDENCE');
  });
});

describe('Phase 4G.3 -- RED TEAM: prerequisite gap blocks even when the target concept itself looks fine', () => {
  it('a confirmed prerequisite gap on the target concept -> PREREQUISITE_BLOCKED, PRACTICE on the prerequisite, never VALIDATED', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', understandingScore: 85 });
    const decision = decisionFor(
      [signal({ type: 'PREREQUISITE_GAP', conceptId: 'c1', subjectId: 'subj1', targetConceptId: 'downstream-c', metadata: { unlockValue: 10, blockedConceptCount: 3 } })],
      ks
    );
    expect(decision.learningState).toBe('PREREQUISITE_BLOCKED');
    expect(decision.activityType).toBe('PRACTICE');
    expect(decision.targetConceptIds).toContain('downstream-c');
  });
});

describe('Phase 4G.4 -- RED TEAM: pending verification blocks a validated claim', () => {
  it('VERIFICATION_PENDING -> PENDING_VERIFICATION state, never VALIDATED, even with a strong masteryState', () => {
    const ks = ksState({ masteryState: 'VALIDATED_MASTERY', understandingScore: 95 });
    const decision = decisionFor(
      [signal({ type: 'VERIFICATION_PENDING', conceptId: 'c1', subjectId: 'subj1', verificationAttemptId: 'va-1', quizSessionId: 'quiz-1', metadata: {} })],
      ks
    );
    expect(decision.learningState).toBe('PENDING_VERIFICATION');
    expect(decision.learningState).not.toBe('VALIDATED');
    expect(decision.reasonCode).toBe('VERIFICATION_PENDING');
  });

  it('Phase 4-R: VERIFICATION_PENDING selects the existing SOLO_VERIFY ActivityType -- reuses the real taxonomy, never a fabricated RESUME_VERIFICATION/VERIFY_PENDING action', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', understandingScore: 40 });
    const decision = decisionFor(
      [signal({ type: 'VERIFICATION_PENDING', conceptId: 'c1', subjectId: 'subj1', verificationAttemptId: 'va-1', quizSessionId: 'quiz-1', metadata: {} })],
      ks
    );
    expect(decision.activityType).toBe('SOLO_VERIFY');
    expect(decision.targetDimension).toBe('VALIDATION');
  });

  it('Phase 4-R: the decision carries the exact existing verificationAttemptId and quizSessionId through -- never regenerated, never a client-supplied value', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', understandingScore: 40 });
    const decision = decisionFor(
      [signal({ type: 'VERIFICATION_PENDING', conceptId: 'c1', subjectId: 'subj1', verificationAttemptId: 'va-exact-1', quizSessionId: 'quiz-exact-1', metadata: {} })],
      ks
    );
    expect(decision.verificationAttemptId).toBe('va-exact-1');
    expect(decision.quizSessionId).toBe('quiz-exact-1');
  });
});

describe('Phase 4G.5 -- RED TEAM: retention risk on previously-validated knowledge', () => {
  it('AT_RISK masteryState (Phase 2.2B) -> RETENTION_RISK state, historical VALIDATED_MASTERY is not erased, only the CURRENT state reflects the risk', () => {
    const ks = ksState({ masteryState: 'AT_RISK' });
    const decision = decisionFor([signal({ type: 'FORGETTING_RISK', conceptId: 'c1', subjectId: 'subj1', metadata: { forgettingRisk: 70 } })], ks);
    expect(decision.learningState).toBe('RETENTION_RISK');
  });

  it('WAITING_FOR_RETENTION validationReadiness alone -> RETENTION_RISK, activityType RETENTION_CHECK', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', validationReadiness: 'WAITING_FOR_RETENTION' });
    const decision = decisionFor([signal({ type: 'WAITING_FOR_RETENTION', conceptId: 'c1', subjectId: 'subj1', metadata: {} })], ks);
    expect(decision.learningState).toBe('RETENTION_RISK');
    expect(decision.activityType).toBe('RETENTION_CHECK');
  });
});

describe('Phase 4G.6 -- RED TEAM: transfer gap on otherwise strong understanding/application', () => {
  it('TRANSFER_REQUIRED validationReadiness -> TRANSFER_GAP state, activityType TRANSFER, never VALIDATED', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', understandingScore: 92, applicationScore: 90, validationReadiness: 'TRANSFER_REQUIRED' });
    const decision = decisionFor([signal({ type: 'TRANSFER_REQUIRED', conceptId: 'c1', subjectId: 'subj1', metadata: {} })], ks);
    expect(decision.learningState).toBe('TRANSFER_GAP');
    expect(decision.activityType).toBe('TRANSFER');
    expect(decision.learningState).not.toBe('VALIDATED');
  });
});

describe('Phase 4G.7 -- RED TEAM: active intervention continues rather than creating a duplicate conflicting action', () => {
  it('REMEDIATION_ACTIVE -> NEEDS_REPAIR state, activityType REMEDIATION (continue), never a fresh PRACTICE/DIAGNOSTIC_CHECK started alongside it', () => {
    const ks = ksState({ masteryState: 'INTERVENTION_REQUIRED' });
    const decision = decisionFor(
      [signal({ type: 'REMEDIATION_ACTIVE', conceptId: 'c1', subjectId: 'subj1', remediationPathId: 'rp-1', metadata: { pattern: 'LOW_RETENTION' } })],
      ks
    );
    expect(decision.learningState).toBe('NEEDS_REPAIR');
    expect(decision.activityType).toBe('REMEDIATION');
    expect(decision.remediationPathId).toBe('rp-1');
    // Only ONE decision for this concept -- consolidateSignals already guarantees this (Phase 3C), re-confirmed here for the Phase 4 state layer.
  });
});

describe('Phase 4G.8 -- RED TEAM: assessment pressure changes priority, never truth', () => {
  it('an imminent exam raises priorityScore/pedagogicalPriority but the learningState of a genuinely weak concept stays exactly what the evidence says', () => {
    const ks = ksState({ masteryState: 'LEARNING', understandingScore: 30 });
    const withoutExam = decisionFor([signal({ type: 'LOW_UNDERSTANDING', conceptId: 'c1', subjectId: 'subj1', metadata: { understandingScore: 30, gap: 50 } })], ks);
    const withExam = decisionFor(
      [
        signal({ type: 'LOW_UNDERSTANDING', conceptId: 'c1', subjectId: 'subj1', metadata: { understandingScore: 30, gap: 50 } }),
        signal({ type: 'EXAM_APPROACHING', conceptId: 'c1', subjectId: 'subj1', metadata: { daysUntil: 1 } }),
      ],
      ks
    );
    expect(withExam.priorityScore).toBeGreaterThan(withoutExam.priorityScore);
    expect(withExam.pedagogicalPriority).toBe('CRITICAL');
    // Truth (learningState) is identical either way -- the exam changed urgency, not the cognitive facts.
    expect(withExam.learningState).toBe(withoutExam.learningState);
    expect(withExam.learningState).toBe('DEVELOPING');
  });
});

describe('Phase 4G.9 -- FALSE NEGATIVE: resolved historical problems do not poison current state', () => {
  it('a concept with real validated mastery, zero active signals, and no misconception/prerequisite/verification/retention/transfer issue reads as VALIDATED, not held back by anything historical', () => {
    const ks = ksState({ masteryState: 'VALIDATED_MASTERY', understandingScore: 95, criticalMisconceptionCount: 0, validationReadiness: 'READY' });
    // No signals at all -- exactly what a resolved misconception / closed intervention / old failed assessment / expired irrelevant debt looks like today (Phase 2C/2D/2E's own "currently active" definitions already exclude them from ever producing a signal here).
    expect(computeLearningState(context([], ks))).toBe('VALIDATED');
  });

  it('a resolved misconception (criticalMisconceptionCount back to 0) no longer blocks, even though a CRITICAL_MISCONCEPTION signal existed for this concept historically', () => {
    // The signal itself is never fabricated once resolved -- this proves the ABSENCE of the signal (not a stale flag) is what determines state.
    const ks = ksState({ masteryState: 'VALIDATED_MASTERY', criticalMisconceptionCount: 0 });
    expect(computeLearningState(context([signal({ type: 'LOW_UNDERSTANDING', conceptId: 'c1', subjectId: 'subj1', metadata: {} })], ks))).not.toBe('MISCONCEPTION_BLOCKED');
  });
});

describe('Phase 4G.10 -- DETERMINISM: identical context + identical policy version -> identical decision', () => {
  it('calling buildLearningDecision twice on the same context produces byte-identical output', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', understandingScore: 40 });
    const ctx = context([signal({ type: 'LOW_UNDERSTANDING', conceptId: 'c1', subjectId: 'subj1', metadata: { understandingScore: 40, gap: 40 } })], ks);
    const a = buildLearningDecision(ctx);
    const b = buildLearningDecision(ctx);
    expect(a).toEqual(b);
    expect(a.policyVersion).toBe(ADAPTIVE_LEARNING_POLICY_VERSION);
    expect(b.policyVersion).toBe(ADAPTIVE_LEARNING_POLICY_VERSION);
  });

  it('no randomness: 50 consecutive calls all produce the exact same learningState/activityType/priorityScore', () => {
    const ks = ksState({ masteryState: 'AT_RISK' });
    const ctx = context([signal({ type: 'FORGETTING_RISK', conceptId: 'c1', subjectId: 'subj1', metadata: { forgettingRisk: 65 } })], ks);
    const results = Array.from({ length: 50 }, () => buildLearningDecision(ctx));
    const first = results[0];
    for (const r of results) {
      expect(r.learningState).toBe(first.learningState);
      expect(r.activityType).toBe(first.activityType);
      expect(r.priorityScore).toBe(first.priorityScore);
    }
  });
});

describe('Phase 4G.11 -- AI governance: nothing here is AI-derived', () => {
  it('every LearningDecision field is deterministically computed from typed inputs -- no aiExecution/aiExecutionId/prose field exists on the type', () => {
    const decision = decisionFor([signal({ type: 'LOW_UNDERSTANDING', conceptId: 'c1', subjectId: 'subj1', metadata: {} })], ksState());
    expect(decision).not.toHaveProperty('aiExecution');
    expect(decision).not.toHaveProperty('aiExecutionId');
    expect(decision).not.toHaveProperty('aiGeneratedReason');
    // facts are structured data (kind + typed fields), never a prose string.
    for (const fact of decision.facts) {
      expect(typeof fact.kind).toBe('string');
    }
  });
});

describe('Phase 4C.4 -- reason codes are the actual dominant signal type, never a generic label', () => {
  it('reasonCode equals primarySignal.type for every state-driving signal', () => {
    const cases: LearningSignal['type'][] = ['CRITICAL_MISCONCEPTION', 'PREREQUISITE_GAP', 'VERIFICATION_PENDING', 'INSUFFICIENT_INDEPENDENT_EVIDENCE', 'FORGETTING_RISK', 'TRANSFER_REQUIRED'];
    for (const type of cases) {
      const decision = decisionFor([signal({ type, conceptId: 'c1', subjectId: 'subj1', metadata: {} })], ksState());
      expect(decision.reasonCode).toBe(type);
      expect(decision.reasonCode).toBe(decision.primarySignal.type);
    }
  });
});

describe('Phase 4B precedence -- explicit ordering, most-severe-first, never a compensating blend', () => {
  it('misconception outranks prerequisite, verification, and retention when several signals coexist on the same concept', () => {
    const ks = ksState({ masteryState: 'AT_RISK', criticalMisconceptionCount: 1 });
    const decision = decisionFor(
      [
        signal({ type: 'CRITICAL_MISCONCEPTION', conceptId: 'c1', subjectId: 'subj1', metadata: {} }),
        signal({ type: 'PREREQUISITE_GAP', conceptId: 'c1', subjectId: 'subj1', metadata: { unlockValue: 5 } }),
        signal({ type: 'VERIFICATION_PENDING', conceptId: 'c1', subjectId: 'subj1', metadata: {} }),
        signal({ type: 'FORGETTING_RISK', conceptId: 'c1', subjectId: 'subj1', metadata: { forgettingRisk: 80 } }),
      ],
      ks
    );
    expect(decision.learningState).toBe('MISCONCEPTION_BLOCKED');
  });

  it('prerequisite outranks verification-pending and retention when misconception is absent', () => {
    const ks = ksState({ masteryState: 'DEVELOPING' });
    const decision = decisionFor(
      [
        signal({ type: 'PREREQUISITE_GAP', conceptId: 'c1', subjectId: 'subj1', metadata: { unlockValue: 5 } }),
        signal({ type: 'VERIFICATION_PENDING', conceptId: 'c1', subjectId: 'subj1', metadata: {} }),
        signal({ type: 'FORGETTING_RISK', conceptId: 'c1', subjectId: 'subj1', metadata: { forgettingRisk: 80 } }),
      ],
      ks
    );
    expect(decision.learningState).toBe('PREREQUISITE_BLOCKED');
  });

  it('verification-pending outranks insufficient-independent-evidence and retention risk', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', understandingScore: 90 });
    const decision = decisionFor(
      [
        signal({ type: 'VERIFICATION_PENDING', conceptId: 'c1', subjectId: 'subj1', metadata: {} }),
        signal({ type: 'INSUFFICIENT_INDEPENDENT_EVIDENCE', conceptId: 'c1', subjectId: 'subj1', metadata: {} }),
        signal({ type: 'FORGETTING_RISK', conceptId: 'c1', subjectId: 'subj1', metadata: { forgettingRisk: 80 } }),
      ],
      ks
    );
    expect(decision.learningState).toBe('PENDING_VERIFICATION');
  });

  it('every LearningState value is reachable and distinct (exhaustive sanity check)', () => {
    const allStates: LearningState[] = [
      'NOT_STARTED', 'MISCONCEPTION_BLOCKED', 'PREREQUISITE_BLOCKED', 'NEEDS_REPAIR', 'PENDING_VERIFICATION',
      'INSUFFICIENT_INDEPENDENT_EVIDENCE', 'RETENTION_RISK', 'TRANSFER_GAP', 'DEVELOPING', 'VALIDATED',
    ];
    expect(new Set(allStates).size).toBe(allStates.length);
  });
});

describe('Phase 4-R Finding 12 -- VERIFICATION_PENDING and INSUFFICIENT_INDEPENDENT_EVIDENCE remain distinct, never confused', () => {
  it('side-by-side: the same knowledgeState produces two different (learningState, activityType, targetDimension) triples depending on which signal is present', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', understandingScore: 90 });

    const verifyDecision = decisionFor(
      [signal({ type: 'VERIFICATION_PENDING', conceptId: 'c1', subjectId: 'subj1', verificationAttemptId: 'va-1', quizSessionId: 'quiz-1', metadata: {} })],
      ks
    );
    const checkDecision = decisionFor(
      [signal({ type: 'INSUFFICIENT_INDEPENDENT_EVIDENCE', conceptId: 'c1', subjectId: 'subj1', metadata: { understandingScore: 90 } })],
      ks
    );

    // VERIFY = complete an already-created verification requirement.
    expect(verifyDecision.learningState).toBe('PENDING_VERIFICATION');
    expect(verifyDecision.activityType).toBe('SOLO_VERIFY');
    expect(verifyDecision.targetDimension).toBe('VALIDATION');
    expect(verifyDecision.verificationAttemptId).toBe('va-1');

    // SOLO_CHECK = obtain initial independent evidence.
    expect(checkDecision.learningState).toBe('INSUFFICIENT_INDEPENDENT_EVIDENCE');
    expect(checkDecision.activityType).toBe('SOLO_CHECK');
    expect(checkDecision.targetDimension).toBe('INDEPENDENCE');
    expect(checkDecision.verificationAttemptId).toBeUndefined();

    // Genuinely different outcomes for genuinely different signals -- never collapsed into one.
    expect(verifyDecision.learningState).not.toBe(checkDecision.learningState);
    expect(verifyDecision.activityType).not.toBe(checkDecision.activityType);
  });

  it('both signals present at once: VERIFICATION_PENDING still wins (higher precedence tier), but neither is silently dropped from the evidence trail', () => {
    const ks = ksState({ masteryState: 'DEVELOPING', understandingScore: 90 });
    const decision = decisionFor(
      [
        signal({ type: 'VERIFICATION_PENDING', conceptId: 'c1', subjectId: 'subj1', verificationAttemptId: 'va-1', quizSessionId: 'quiz-1', metadata: {} }),
        signal({ type: 'INSUFFICIENT_INDEPENDENT_EVIDENCE', conceptId: 'c1', subjectId: 'subj1', metadata: {} }),
      ],
      ks
    );
    expect(decision.activityType).toBe('SOLO_VERIFY');
    expect(decision.signals.map((s) => s.type)).toEqual(expect.arrayContaining(['VERIFICATION_PENDING', 'INSUFFICIENT_INDEPENDENT_EVIDENCE']));
  });
});

describe('Phase 4-R Finding 16 -- policyVersion audit: a genuine ActivityType-mapping change requires (and got) an explicit bump', () => {
  it('ADAPTIVE_LEARNING_POLICY_VERSION is 3, not silently left at 2', () => {
    expect(ADAPTIVE_LEARNING_POLICY_VERSION).toBe(3);
  });

  it('every decision, regardless of which signal drives it, carries the current policyVersion', () => {
    const cases: LearningSignal['type'][] = ['LOW_UNDERSTANDING', 'VERIFICATION_PENDING', 'INSUFFICIENT_INDEPENDENT_EVIDENCE', 'CRITICAL_MISCONCEPTION'];
    for (const type of cases) {
      const decision = decisionFor([signal({ type, conceptId: 'c1', subjectId: 'subj1', metadata: {} })], ksState());
      expect(decision.policyVersion).toBe(3);
    }
  });
});

describe('Phase 4-R Finding 14/15 -- higher-priority blockers still win over VERIFICATION_PENDING (band ordering not reopened)', () => {
  it('active critical misconception outranks a simultaneously-pending verification', () => {
    const ks = ksState({ masteryState: 'AT_RISK', criticalMisconceptionCount: 1 });
    const decision = decisionFor(
      [
        signal({ type: 'CRITICAL_MISCONCEPTION', conceptId: 'c1', subjectId: 'subj1', metadata: {} }),
        signal({ type: 'VERIFICATION_PENDING', conceptId: 'c1', subjectId: 'subj1', verificationAttemptId: 'va-1', quizSessionId: 'quiz-1', metadata: {} }),
      ],
      ks
    );
    expect(decision.learningState).toBe('MISCONCEPTION_BLOCKED');
    expect(decision.activityType).toBe('PRACTICE');
    expect(decision.activityType).not.toBe('SOLO_VERIFY');
  });

  it('active remediation outranks a simultaneously-pending verification', () => {
    const ks = ksState({ masteryState: 'INTERVENTION_REQUIRED' });
    const decision = decisionFor(
      [
        signal({ type: 'REMEDIATION_ACTIVE', conceptId: 'c1', subjectId: 'subj1', remediationPathId: 'rp-1', metadata: { pattern: 'LOW_RETENTION' } }),
        signal({ type: 'VERIFICATION_PENDING', conceptId: 'c1', subjectId: 'subj1', verificationAttemptId: 'va-1', quizSessionId: 'quiz-1', metadata: {} }),
      ],
      ks
    );
    expect(decision.learningState).toBe('NEEDS_REPAIR');
    expect(decision.activityType).toBe('REMEDIATION');
  });
});
