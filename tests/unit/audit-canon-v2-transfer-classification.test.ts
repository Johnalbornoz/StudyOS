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
 *
 * SUPERSEDED (overnight 2026-10-16 contract 1.2): APPLY is now the adaptive
 * NEAR/MID/FAR ladder (3-5 challenges, each passing at >= 80; MID or FAR
 * completes it). The 3-challenge 80%-mean / 70%-floor rule and its Cases
 * A/B/C are RETIRED: a ladder that reaches only NEAR is never a failed
 * attempt (no rollback, no prior stage lost, the concept stays in TRANSFER),
 * and a legacy 3-challenge row is UNRESOLVED whatever its diagnostic. Case D
 * (critical misconception) still rolls back to PRACTICE and resets the
 * Practice window. This file now certifies THAT behavior end-to-end against
 * the real engine (and the real adapter for the per-challenge 80 boundary).
 * Test-only.
 */
import { describe, it, expect } from 'vitest';
import { evaluateCanonicalLearningState, type RawEvidenceItem, type PedagogicalEngineInput } from '@/lib/pedagogical-engine';
import { mapStudyUSEvidenceToPedagogicalEvidence } from '@/lib/pedagogical-shadow/evidence-adapter';

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
const PRACTICE_3 = item({ activityType: 'PRACTICE', timestamp: '2025-12-31T02:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 3 });
const PROVE = item({ activityType: 'PROVE', timestamp: '2026-01-01T00:00:00.000Z', itemCount: 10, correctCount: 9, scorePercent: 90, difficulty: 3.5, independent: true });
const RETAIN = item({ activityType: 'RETENTION_CHECK', timestamp: '2026-01-10T00:00:00.000Z', itemCount: 5, correctCount: 5, scorePercent: 90, difficulty: 3.5, independent: true, novel: true });
const READY_FOR_TRANSFER = [LEARNED, PRACTICE_1, PRACTICE_2, PRACTICE_3, PROVE, RETAIN];

type Level = 'NEAR' | 'MID' | 'FAR';
/** An APPLY ladder row as the adapter maps it (challenges re-derived to a highest passed+certified level at >= 80). */
function ladderItem(ts: string, challenges: Array<[Level, number, boolean?]>, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  const rows = challenges.map(([level, scorePercent, certified = true], i) => ({ level, scorePercent, passed: scorePercent >= 80, certified, taskId: `t${i}`, contextDomain: null }));
  const order: Level[] = ['NEAR', 'MID', 'FAR'];
  const best = rows.filter((c) => c.passed && c.certified).reduce<Level | null>((b, c) => (b === null || order.indexOf(c.level) > order.indexOf(b) ? c.level : b), null);
  const overall = rows.reduce((a, c) => a + c.scorePercent, 0) / rows.length;
  return item({ activityType: 'TRANSFER', timestamp: ts, itemCount: rows.length, correctCount: rows.filter((c) => c.passed).length, scorePercent: overall, difficulty: 4.5, independent: true, transferLadder: rows, transferHighestLevel: best, ...opts });
}
/** A LEGACY (pre-2026-10-16) 3-challenge NEAR/CONTEXTUAL/HIGHER row. */
function legacyTransferItem(ts: string, perChallengeScores: number[], opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  const overall = perChallengeScores.reduce((a, b) => a + b, 0) / perChallengeScores.length;
  return item({ activityType: 'TRANSFER', timestamp: ts, itemCount: 3, correctCount: perChallengeScores.filter((s) => s >= 80).length, scorePercent: overall, difficulty: 4.5, independent: true, perChallengeScores, reasoningProvided: true, ...opts });
}
const transferReq = (d: ReturnType<typeof evaluateCanonicalLearningState>) => d.requirements.find((r) => r.stage === 'TRANSFER')!;

describe('APPLY ladder qualification boundaries -- contract 1.2 (each challenge passes at >= 80; MID completes)', () => {
  it('NEAR 80 / MID 80 / FAR 79 -> MID reached -> SATISFIED, CONSOLIDATED MEDIUM (80 is inclusive per challenge; no overall mean)', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, ladderItem('2026-01-13T00:00:00.000Z', [['NEAR', 80], ['MID', 80], ['FAR', 79]])] }));
    expect(transferReq(d).status).toBe('SATISFIED');
    expect(d.consolidationLevel).toBe('MEDIUM');
  });

  it('a strong mean no longer compensates and a weak mean no longer blocks: NEAR 100 / MID 79.9 / MID 79.9 -> only NEAR -> UNSATISFIED; NEAR 80 / MID 40 / MID 80 (mean 66.7) -> MID -> SATISFIED', () => {
    const near = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, ladderItem('2026-01-13T00:00:00.000Z', [['NEAR', 100], ['MID', 79.9], ['MID', 79.9]])] }));
    expect(transferReq(near).status).toBe('UNSATISFIED');
    expect(transferReq(near).reasonCodes).toEqual(['TRANSFER_LEVEL_BELOW_CONSOLIDATION']);
    const mid = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, ladderItem('2026-01-13T00:00:00.000Z', [['NEAR', 80], ['MID', 40], ['MID', 80]])] }));
    expect(transferReq(mid).status).toBe('SATISFIED');
  });

  it('a passed but uncertified MID challenge does not count (only passed AND certified levels count)', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, ladderItem('2026-01-13T00:00:00.000Z', [['NEAR', 90], ['MID', 95, false], ['MID', 60]])] }));
    expect(transferReq(d).status).toBe('UNSATISFIED');
    expect(d.transferLevelReached).toBe('NEAR');
  });

  it('the adapter applies the >= 80 bar itself: a challenge flagged passed at 79 never raises the level (declared MID is rejected, row UNRESOLVED)', () => {
    const rows = mapStudyUSEvidenceToPedagogicalEvidence([{
      id: 'row', sourceType: 'TRANSFER', result: 'partial', scorePercent: 80, difficulty: 4.5, timestamp: '2026-01-13T00:00:00.000Z', hintsUsed: 0, aiAssistanceType: 'NONE', activityType: 'TRANSFER',
      transferLadder: { version: 'transfer-ladder-v1', highestLevelReached: 'MID', challenges: [
        { level: 'NEAR', scorePercent: 90, passed: true, certified: true, taskId: 'a', contextDomain: null },
        { level: 'MID', scorePercent: 79, passed: true, certified: true, taskId: 'b', contextDomain: null },
        { level: 'MID', scorePercent: 70, passed: false, certified: true, taskId: 'c', contextDomain: null },
      ] },
    }]);
    expect(rows.items[0].transferLadder).toBeUndefined();
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, rows.items[0]] }));
    expect(transferReq(d).reasonCodes).toEqual(['UNRESOLVED_POLICY']);
    expect(d.rollback).toBeNull();
  });
});

describe('AUDIT-003 SUPERSEDED: no Transfer failure classification below MID -- contract 1.2', () => {
  it('NEAR only -> stays TRANSFER, immediately executable (repeat APPLY), no rollback, no REINFORCE, Prove/Retain untouched', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, ladderItem('2026-01-13T00:00:00.000Z', [['NEAR', 90], ['MID', 60], ['MID', 60]])] }));
    expect(d.rollback).toBeNull();
    expect(d.intervention).toBeNull();
    expect(d.stage).toBe('TRANSFER');
    expect(d.actionState).toBe('EXECUTABLE');
    expect(d.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
    expect(d.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('SATISFIED');
    expect(transferReq(d).reasonCodes).not.toContain('FAILED_ATTEMPT');
  });

  it('the repeat gets the REAL APPLY ladder contract (3-5 challenges, NEAR/MID/FAR, independent), never a Practice-shaped one', () => {
    const d = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, ladderItem('2026-01-13T00:00:00.000Z', [['NEAR', 50], ['NEAR', 50], ['NEAR', 50]])] }));
    expect(d.activityContract?.activityType).toBe('TRANSFER');
    expect(d.activityContract?.itemCount).toEqual({ min: 3, max: 5 });
    expect(d.activityContract?.transferDepth).toEqual(['NEAR', 'MID', 'FAR']);
    expect(d.activityContract?.difficulty.min).toBe(4);
    expect(d.activityContract?.difficulty.max).toBe(5);
    expect(d.activityContract?.independence).toBe(true);
  });

  it('a legacy 3-challenge row is UNRESOLVED whatever its explicit diagnostic: the SAME [40,40,40] gives the SAME outcome (no Case A/B/C rollback)', () => {
    const scores = [40, 40, 40];
    const outcomes = [undefined, 'APPLICATION_CONTEXT_WEAKNESS', 'RETENTION_WEAKNESS', 'FOUNDATIONAL_PROCEDURAL_FAILURE'].map((diag) =>
      evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, legacyTransferItem('2026-01-13T00:00:00.000Z', scores, diag ? { transferFailureDiagnostic: diag as RawEvidenceItem['transferFailureDiagnostic'] } : {})] })),
    );
    for (const d of outcomes) {
      expect(d.rollback).toBeNull();
      expect(d.stage).toBe('TRANSFER');
      expect(transferReq(d).reasonCodes).toEqual(['UNRESOLVED_POLICY']);
      for (const s of ['PRACTICE', 'PROVE', 'RETAIN']) expect(d.requirements.find((r) => r.stage === s)!.status).toBe('SATISFIED');
    }
    // and a legacy PASS (the old 80-mean / 70-floor) no longer consolidates either
    const legacyPass = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, legacyTransferItem('2026-01-13T00:00:00.000Z', [90, 90, 90])] }));
    expect(legacyPass.stage).toBe('TRANSFER');
  });

  it('Case D (critical misconception) -> rolls back to PRACTICE, resetting the Practice window', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...READY_FOR_TRANSFER, ladderItem('2026-01-13T00:00:00.000Z', [['NEAR', 90], ['MID', 90], ['FAR', 90]], { hasCriticalMisconception: true })] }),
    );
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_D_CRITICAL_MISCONCEPTION');
    expect(decision.rollback?.rolledBackTo).toBe('PRACTICE');
    expect(decision.intervention).toBe('REINFORCE');
    expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('LOCKED');
    expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('LOCKED');
    expect(decision.practiceProgress?.recentValidAttempts).toEqual([]);
  });

  it('Case D: after the rollback, 3 NEW passing Practice attempts (the full last-3 window) are required before Prove unlocks again -- the 3 pre-rollback passes no longer count', () => {
    const misconceptionFail = ladderItem('2026-01-13T00:00:00.000Z', [['NEAR', 90], ['MID', 90], ['FAR', 90]], { hasCriticalMisconception: true });
    const newPractice = (ts: string) => item({ activityType: 'PRACTICE', timestamp: ts, itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 3 });
    const p1 = newPractice('2026-01-14T00:00:00.000Z');
    const p2 = newPractice('2026-01-14T01:00:00.000Z');
    const p3 = newPractice('2026-01-14T02:00:00.000Z');
    const afterOne = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, misconceptionFail, p1] }));
    expect(afterOne.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    const afterTwo = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, misconceptionFail, p1, p2] }));
    expect(afterTwo.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    const afterThree = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, misconceptionFail, p1, p2, p3] }));
    expect(afterThree.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED');
    expect(afterThree.stage).toBe('PROVE');
  });
});
