/**
 * CANONICAL POLICY V2 -- AUDIT-003 REMEDIATION VERIFICATION.
 *
 * Was: AUDIT-003 (BLOCKER) -- the pre-remediation engine implemented
 * only 3 TRANSFER failure classifications, with a letter mismatch
 * against Policy V2 Section 7's own naming (its "Case B" actually meant
 * policy's Case C), and NO case at all that rolled back to RETAIN
 * ("Case B: retention weakness" was structurally impossible).
 *
 * Now: the engine implements the full, correctly-lettered 4-way
 * classification (`TRANSFER_CASE_A_APPLICATION_CONTEXT_WEAKNESS`,
 * `TRANSFER_CASE_B_RETENTION_WEAKNESS`,
 * `TRANSFER_CASE_C_FOUNDATIONAL_PROCEDURAL_FAILURE`,
 * `TRANSFER_CASE_D_CRITICAL_MISCONCEPTION`), driven by the trusted,
 * explicit `RawEvidenceItem.transferFailureDiagnostic` signal (plus the
 * pre-existing `hasCriticalMisconception` for Case D) -- never inferred
 * from a numeric score pattern. This file asserts the CORRECTED
 * behavior end-to-end against the real, unmodified engine. Test-only.
 */
import { describe, it, expect } from 'vitest';
import { evaluateCanonicalLearningState, type RawEvidenceItem, type PedagogicalEngineInput } from '@/lib/pedagogical-engine';

function item(overrides: Partial<RawEvidenceItem>): RawEvidenceItem {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    activityType: 'PRACTICE',
    timestamp: '2026-01-01T00:00:00.000Z',
    itemCount: 3,
    correctCount: 3,
    scorePercent: 100,
    independent: false,
    difficulty: 3,
    hasCriticalMisconception: false,
    ...overrides,
  };
}
function baseInput(overrides: Partial<PedagogicalEngineInput> = {}): PedagogicalEngineInput {
  return { conceptId: 'concept-1', studentId: 'student-1', now: '2026-02-01T00:00:00.000Z', evidence: [], activeCriticalMisconception: false, ...overrides };
}

const LEARNED = item({ activityType: 'LEARN_CHECK', timestamp: '2025-12-30T00:00:00.000Z', itemCount: 5, correctCount: 5, scorePercent: 90, difficulty: 1.5 });
const PRACTICE_1 = item({ activityType: 'PRACTICE', timestamp: '2025-12-31T00:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 3 });
const PRACTICE_2 = item({ activityType: 'PRACTICE', timestamp: '2025-12-31T01:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 3 });
const PROVE = item({ activityType: 'PROVE', timestamp: '2026-01-01T00:00:00.000Z', itemCount: 10, correctCount: 9, scorePercent: 90, difficulty: 3.5, independent: true });
const RETAIN = item({ activityType: 'RETENTION_CHECK', timestamp: '2026-01-10T00:00:00.000Z', itemCount: 10, correctCount: 9, scorePercent: 90, difficulty: 3.5, independent: true, novel: true });
const READY_FOR_TRANSFER = [LEARNED, PRACTICE_1, PRACTICE_2, PROVE, RETAIN];

function transferItem(ts: string, perChallengeScores: number[], opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  const overall = perChallengeScores.reduce((a, b) => a + b, 0) / perChallengeScores.length;
  return item({ activityType: 'TRANSFER', timestamp: ts, itemCount: 3, correctCount: perChallengeScores.filter((s) => s >= 80).length, scorePercent: overall, difficulty: 4.5, independent: true, perChallengeScores, reasoningProvided: true, ...opts });
}

describe('TRANSFER qualification boundaries -- Policy V2 Section 7 (frozen product decision: overall = simple mean)', () => {
  it('80/80/80 -> overall 80%, every challenge >=70% -> PASS', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [80, 80, 80])] }));
    expect(decision.requirements.find((r) => r.stage === 'TRANSFER')!.status).toBe('SATISFIED');
  });

  it('80/80/75 -> overall 78.33% -> FAIL (frozen product decision: overall is the simple arithmetic mean; this example, given verbatim in the remediation spec, must fail)', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [80, 80, 75])] }));
    expect(decision.requirements.find((r) => r.stage === 'TRANSFER')!.status).toBe('UNSATISFIED');
  });

  it('95/95/60 -> FAIL (one challenge below the 70 floor, despite a strong overall average -- no compensation)', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [95, 95, 60])] }));
    expect(decision.requirements.find((r) => r.stage === 'TRANSFER')!.status).toBe('UNSATISFIED');
  });

  it('70/70/70 -> FAIL (every challenge meets the 70 floor, but the 70% overall average misses the 80% bar -- neither check alone is sufficient)', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [70, 70, 70])] }));
    expect(decision.requirements.find((r) => r.stage === 'TRANSFER')!.status).toBe('UNSATISFIED');
  });
});

describe('AUDIT-003 CLOSED: TRANSFER 4-way failure classification -- Policy V2 Section 7', () => {
  it('Case A (application-context weakness, default/no explicit signal) -> stays TRANSFER, immediate retry, no wait, Prove/Retain untouched', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [60, 60, 60])] }));
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_A_APPLICATION_CONTEXT_WEAKNESS');
    expect(decision.rollback?.rolledBackTo).toBe('TRANSFER');
    expect(decision.stage).toBe('TRANSFER');
    expect(decision.actionState).toBe('EXECUTABLE'); // immediate retry, no wait
    expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
    expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('SATISFIED');
  });

  it('an application-context-weakness retry gets the REAL 3-challenge Transfer contract, never a 2-3 item Practice-shaped one (the discovered-defect fix)', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [60, 60, 60])] }));
    expect(decision.intervention).toBe('REINFORCE'); // still reported, unchanged, already-certified fact
    expect(decision.activityContract?.activityType).toBe('TRANSFER'); // NOT 'REINFORCE'
    expect(decision.activityContract?.itemCount).toEqual({ min: 3, max: 3 });
    expect(decision.activityContract?.difficulty.min).toBe(4);
    expect(decision.activityContract?.difficulty.max).toBe(5);
    expect(decision.activityContract?.independence).toBe(true);
  });

  it('Case B (retention weakness, explicit signal) -> rollback to RETAIN ONLY, immediately executable, no new 3-day wait, PROVE remains valid', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [40, 40, 40], { transferFailureDiagnostic: 'RETENTION_WEAKNESS' })] }),
    );
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_B_RETENTION_WEAKNESS');
    expect(decision.rollback?.rolledBackTo).toBe('RETAIN');
    expect(decision.stage).toBe('RETAIN');
    expect(decision.actionState).toBe('EXECUTABLE'); // immediate, no wait
    expect(decision.waitingReason).toBeNull();
    expect(decision.nextEligibleAt).toBeNull();
    // PROVE remains valid -- never touched by this classification.
    expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
    // PRACTICE remains valid too -- only RETAIN was invalidated.
    expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED');
  });

  it('Case B retry gets the REAL 10-item independent Retain contract -- no REINFORCE overlay of any kind (intervention is null)', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [40, 40, 40], { transferFailureDiagnostic: 'RETENTION_WEAKNESS' })] }),
    );
    expect(decision.intervention).toBeNull();
    expect(decision.activityContract?.activityType).toBe('RETENTION_CHECK');
    expect(decision.activityContract?.itemCount).toEqual({ min: 10, max: 10 });
    expect(decision.activityContract?.independence).toBe(true);
    expect(decision.activityContract?.supportLevel).toBe('NONE');
  });

  it('Case B: a qualifying Retain requalification resolves the rollback and re-unlocks TRANSFER, with NO new 3-day wait ever having been imposed', () => {
    const caseBFail = transferItem('2026-01-13T00:00:00.000Z', [40, 40, 40], { transferFailureDiagnostic: 'RETENTION_WEAKNESS' });
    const requalifyingRetain = item({ activityType: 'RETENTION_CHECK', timestamp: '2026-01-14T00:00:00.000Z', itemCount: 10, correctCount: 9, scorePercent: 90, difficulty: 3.5, independent: true, novel: true });
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, caseBFail, requalifyingRetain], now: '2026-01-14T00:00:00.000Z' }));
    expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('SATISFIED');
    expect(decision.rollback).toBeNull();
    expect(decision.stage).toBe('TRANSFER');
    expect(decision.actionState).toBe('EXECUTABLE');
  });

  it('Case C (foundational/procedural failure, explicit signal) -> rollback to the earliest invalidated requirement (PRACTICE), resetting the Practice window', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [40, 40, 40], { transferFailureDiagnostic: 'FOUNDATIONAL_PROCEDURAL_FAILURE' })] }),
    );
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_C_FOUNDATIONAL_PROCEDURAL_FAILURE');
    expect(decision.rollback?.rolledBackTo).toBe('PRACTICE');
    expect(decision.stage).toBe('PRACTICE');
    expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('LOCKED');
    expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('LOCKED');
  });

  it('Case C: after the rollback, 2 NEW valid Practice attempts (2 of last 3) are required before Prove unlocks again -- the window reset applies here exactly like a Prove-failure rollback', () => {
    const foundationalFail = transferItem('2026-01-13T00:00:00.000Z', [40, 40, 40], { transferFailureDiagnostic: 'FOUNDATIONAL_PROCEDURAL_FAILURE' });
    const oneNewPractice = item({ activityType: 'PRACTICE', timestamp: '2026-01-14T00:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 3 });
    const afterOne = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, foundationalFail, oneNewPractice] }));
    expect(afterOne.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    const twoNewPractices = item({ activityType: 'PRACTICE', timestamp: '2026-01-14T01:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 3 });
    const afterTwo = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, foundationalFail, oneNewPractice, twoNewPractices] }));
    expect(afterTwo.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED');
    expect(afterTwo.stage).toBe('PROVE');
  });

  it('Case D (critical misconception) -> rolls back to PRACTICE, resetting the Practice window, exactly like Case C', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [40, 40, 40], { hasCriticalMisconception: true })] }),
    );
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_D_CRITICAL_MISCONCEPTION');
    expect(decision.rollback?.rolledBackTo).toBe('PRACTICE');
    expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('LOCKED');
  });

  it('classification is never inferred from score alone -- the SAME [40,40,40] pattern produces 3 different outcomes depending ONLY on the explicit diagnostic signal', () => {
    const scores = [40, 40, 40];
    const noSignal = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', scores)] }));
    const retention = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', scores, { transferFailureDiagnostic: 'RETENTION_WEAKNESS' })] }));
    const foundational = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', scores, { transferFailureDiagnostic: 'FOUNDATIONAL_PROCEDURAL_FAILURE' })] }));
    expect(noSignal.rollback?.rolledBackTo).toBe('TRANSFER');
    expect(retention.rollback?.rolledBackTo).toBe('RETAIN');
    expect(foundational.rollback?.rolledBackTo).toBe('PRACTICE');
  });
});
