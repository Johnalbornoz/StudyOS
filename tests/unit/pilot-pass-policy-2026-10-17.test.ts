/**
 * 2026-10-17 PILOT PASS POLICY -- focused certification of the governed
 * operator decision (POLICY_VERSION 'studyus-canonical-v2-pilot-2026-10-17').
 *
 *   LEARN     exactly 5 items, >= 80% INCLUSIVE; any other item count is
 *             UNRESOLVED (never a pass).
 *   PRACTICE  the LAST 3 valid attempts each >= 80% AND their average >= 80%;
 *             fewer than 3 valid attempts never satisfies.
 *   PROVE     exactly 10 independent items, >= 80%; a failure stays in PROVE
 *             (immediate retry, no rollback to PRACTICE); once passed in a
 *             cycle, later attempts never undo it.
 *   RETAIN    exactly 5 novel independent items, >= 80%, not before the
 *             qualifying Prove + 3 days; fail #1 -> immediate retry; fail #2
 *             -> back to PROVE; a new Prove pass opens a new +3 day window.
 *   TRANSFER  unchanged (3 challenges, overall >= 80, each >= 70).
 *
 * Every test runs the REAL engine through its public API only.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateCanonicalLearningState,
  qualifyEvidence,
  CANONICAL_POLICY,
  POLICY_VERSION,
  type RawEvidenceItem,
  type CanonicalPedagogicalDecision,
} from '@/lib/pedagogical-engine';

let seq = 0;
function item(overrides: Partial<RawEvidenceItem>): RawEvidenceItem {
  seq++;
  return {
    id: overrides.id ?? `ev-${seq}`,
    activityType: 'PRACTICE',
    timestamp: '2026-10-01T00:00:00.000Z',
    itemCount: 3,
    correctCount: 3,
    scorePercent: 100,
    independent: false,
    difficulty: 3,
    hasCriticalMisconception: false,
    ...overrides,
  };
}

const learnCheck = (ts: string, scorePercent: number, itemCount = 5) =>
  item({ activityType: 'LEARN_CHECK', timestamp: ts, itemCount, correctCount: Math.round((scorePercent / 100) * itemCount), scorePercent, difficulty: 1.5 });
const practice = (ts: string, scorePercent: number) =>
  item({ activityType: 'PRACTICE', timestamp: ts, itemCount: 3, correctCount: Math.round((scorePercent / 100) * 3), scorePercent, difficulty: 3 });
const prove = (ts: string, correct: number, itemCount = 10) =>
  item({ activityType: 'PROVE', timestamp: ts, itemCount, correctCount: correct, scorePercent: (correct / itemCount) * 100, difficulty: 3.5, independent: true });
const retain = (ts: string, correct: number, itemCount = 5) =>
  item({ activityType: 'RETENTION_CHECK', timestamp: ts, itemCount, correctCount: correct, scorePercent: (correct / itemCount) * 100, difficulty: 3.5, independent: true, novel: true });
const transfer = (ts: string, scores: number[]) =>
  item({
    activityType: 'TRANSFER', timestamp: ts, itemCount: 3, correctCount: scores.filter((s) => s >= 80).length,
    scorePercent: scores.reduce((a, b) => a + b, 0) / scores.length, difficulty: 4.5, independent: true, perChallengeScores: scores, reasoningProvided: true,
  });

const decide = (evidence: RawEvidenceItem[], now: string): CanonicalPedagogicalDecision =>
  evaluateCanonicalLearningState({ conceptId: 'c1', studentId: 's1', now, evidence, activeCriticalMisconception: false });
const req = (d: CanonicalPedagogicalDecision, stage: string) => d.requirements.find((r) => r.stage === stage)!;
const plusDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86400000).toISOString();

const LEARNED = learnCheck('2026-10-01T00:00:00.000Z', 100);
/** LEARN + the minimum passing Practice window (3 of 3). */
const PRACTICE_READY = [
  LEARNED,
  practice('2026-10-02T00:00:00.000Z', 90),
  practice('2026-10-02T01:00:00.000Z', 90),
  practice('2026-10-02T02:00:00.000Z', 90),
];
const PROVE_PASS_AT = '2026-10-03T10:00:00.000Z';

describe('the governed policy object', () => {
  it('names the 2026-10-17 pilot version and carries every governed value', () => {
    expect(POLICY_VERSION).toBe('studyus-canonical-v2-pilot-2026-10-17');
    expect(CANONICAL_POLICY.version).toBe(POLICY_VERSION);
    expect(CANONICAL_POLICY.learn).toMatchObject({ minimumScorePercent: 80, itemCount: 5 });
    expect(CANONICAL_POLICY.practice).toMatchObject({ windowSize: 3, requiredPassesInWindow: 3, minimumWindowAveragePercent: 80, minimumScorePercent: 80 });
    expect(CANONICAL_POLICY.prove).toMatchObject({ itemCount: 10, minimumScorePercent: 80, independenceRequired: true, failureStaysInProve: true });
    expect(CANONICAL_POLICY.retention).toMatchObject({ itemCount: 5, minimumWaitDays: 3, minimumScorePercent: 80, independenceRequired: true, noveltyRequired: true });
    expect(CANONICAL_POLICY.transfer).toMatchObject({ challengeCount: 3, minimumOverallScorePercent: 80, perChallengeMinimumScorePercent: 70 });
  });

  it('every decision reports the pilot policy version', () => {
    expect(decide([], '2026-10-01T00:00:00.000Z').policyVersion).toBe('studyus-canonical-v2-pilot-2026-10-17');
  });
});

describe('LEARN -- exactly 5 items, >= 80% inclusive', () => {
  it('80.0% passes', () => {
    const d = decide([learnCheck('2026-10-01T00:00:00.000Z', 80)], '2026-10-01T01:00:00.000Z');
    expect(req(d, 'LEARN').status).toBe('SATISFIED');
    expect(req(d, 'LEARN').reasonCodes).toEqual(['PASSING_SCORE']);
    expect(d.stage).toBe('PRACTICE');
  });

  it('79.9% fails', () => {
    const d = decide([learnCheck('2026-10-01T00:00:00.000Z', 79.9)], '2026-10-01T01:00:00.000Z');
    expect(req(d, 'LEARN').status).toBe('UNSATISFIED');
    expect(req(d, 'LEARN').reasonCodes).toEqual(['INSUFFICIENT_SCORE']);
    expect(d.stage).toBe('LEARN');
  });

  it('a check of any other size (or with no item count) is UNRESOLVED_POLICY -- never a pass, even at 100%', () => {
    for (const itemCount of [0, 1, 4, 6, 10, undefined as unknown as number]) {
      const ev = item({ activityType: 'LEARN_CHECK', timestamp: '2026-10-01T00:00:00.000Z', itemCount, correctCount: itemCount ?? 0, scorePercent: 100, difficulty: 1.5 });
      expect(qualifyEvidence(ev, { targetStage: 'LEARN', prerequisiteSatisfied: true })).toEqual({ result: 'UNRESOLVED', reasonCode: 'UNRESOLVED_POLICY' });
      const d = decide([ev], '2026-10-01T01:00:00.000Z');
      expect(req(d, 'LEARN').status).toBe('UNSATISFIED');
      expect(d.stage).toBe('LEARN');
    }
  });

  it('the LEARN contract is the fixed 5-question check at >= 80', () => {
    const d = decide([], '2026-10-01T00:00:00.000Z');
    expect(d.activityContract).toMatchObject({
      activityType: 'LEARN_CHECK',
      itemCount: { min: 5, max: 5 },
      minimumScorePercent: 80,
      evidenceContract: 'LEARN_COMPREHENSION_CHECK_5_SCORE_AT_LEAST_80',
    });
  });
});

describe('PRACTICE -- the rolling last-3 window (operator example)', () => {
  // 90, 85, 78, 88, 92, 86
  const scores = [90, 85, 78, 88, 92, 86];
  const evidence = [LEARNED, ...scores.map((s, i) => practice(`2026-10-02T0${i}:00:00.000Z`, s))];
  const after = (n: number) => decide(evidence.slice(0, 1 + n), '2026-10-02T12:00:00.000Z');

  it('fewer than 3 valid practices never satisfies, even at 90 and 85; no rolling average yet', () => {
    for (const n of [1, 2]) {
      const d = after(n);
      expect(req(d, 'PRACTICE').status).toBe('UNSATISFIED');
      expect(d.stage).toBe('PRACTICE');
      expect(d.practiceProgress!.windowAveragePercent).toBeNull();
    }
  });

  it('90, 85, 78 -> not satisfied (the 78 fails; average 84.3)', () => {
    const d = after(3);
    expect(req(d, 'PRACTICE').status).toBe('UNSATISFIED');
    expect(d.stage).toBe('PRACTICE');
    expect(d.practiceProgress!.recentValidAttempts.map((a) => a.scorePercent)).toEqual([90, 85, 78]);
    expect(d.practiceProgress!.passesInWindow).toBe(2);
    expect(d.practiceProgress!.windowAveragePercent).toBe(84.3);
  });

  it('+88 -> window 85, 78, 88 -> not satisfied (average 83.7)', () => {
    const d = after(4);
    expect(req(d, 'PRACTICE').status).toBe('UNSATISFIED');
    expect(d.practiceProgress!.recentValidAttempts.map((a) => a.scorePercent)).toEqual([85, 78, 88]);
    expect(d.practiceProgress!.windowAveragePercent).toBe(83.7);
  });

  it('+92 -> window 78, 88, 92 -> not satisfied (average 86, but the 78 is still in the window)', () => {
    const d = after(5);
    expect(req(d, 'PRACTICE').status).toBe('UNSATISFIED');
    expect(d.stage).toBe('PRACTICE');
    expect(d.practiceProgress!.recentValidAttempts.map((a) => a.scorePercent)).toEqual([78, 88, 92]);
    expect(d.practiceProgress!.windowAveragePercent).toBe(86);
  });

  it('+86 -> window 88, 92, 86 -> SATISFIED: READY to prove (stage PROVE, executable)', () => {
    const d = after(6);
    expect(req(d, 'PRACTICE').status).toBe('SATISFIED');
    expect(req(d, 'PROVE').status).toBe('UNSATISFIED');
    expect(d.stage).toBe('PROVE');
    expect(d.actionState).toBe('EXECUTABLE');
    expect(d.nextCanonicalAction).toBe('PROVE');
    expect(d.practiceProgress).toMatchObject({
      windowSize: 3,
      requiredPasses: 3,
      minimumScorePercent: 80,
      minimumWindowAveragePercent: 80,
      passesInWindow: 3,
      windowAveragePercent: 88.7,
      satisfied: true,
    });
    expect(d.practiceProgress!.recentValidAttempts.map((a) => a.scorePercent)).toEqual([88, 92, 86]);
  });

  it('80, 80, 80 is the inclusive boundary: each attempt and the average exactly at 80 -> SATISFIED; 80, 80, 79.9 -> not', () => {
    const at = (ss: number[]) => decide([LEARNED, ...ss.map((s, i) => practice(`2026-10-02T0${i}:00:00.000Z`, s))], '2026-10-02T12:00:00.000Z');
    const pass = at([80, 80, 80]);
    expect(req(pass, 'PRACTICE').status).toBe('SATISFIED');
    expect(pass.practiceProgress!.windowAveragePercent).toBe(80);
    expect(req(at([80, 80, 79.9]), 'PRACTICE').status).toBe('UNSATISFIED');
  });
});

describe('PROVE -- exactly 10 independent items; a failure stays in PROVE', () => {
  it('7/10 (70%) fails and stays in PROVE, immediately executable with the same exact-10 contract; Practice is untouched', () => {
    const d = decide([...PRACTICE_READY, prove('2026-10-03T00:00:00.000Z', 7)], '2026-10-03T00:30:00.000Z');
    expect(req(d, 'PROVE').status).toBe('UNSATISFIED');
    expect(req(d, 'PROVE').reasonCodes).toContain('FAILED_ATTEMPT');
    expect(req(d, 'PRACTICE').status).toBe('SATISFIED');
    expect(d.stage).toBe('PROVE');
    expect(d.actionState).toBe('EXECUTABLE');
    expect(d.nextCanonicalAction).toBe('PROVE');
    expect(d.rollback).toBeNull();
    expect(d.intervention).toBeNull();
    expect(d.activityContract).toMatchObject({ activityType: 'PROVE', itemCount: { min: 10, max: 10 }, independence: true, minimumScorePercent: 80 });
    expect(d.practiceProgress!.recentValidAttempts).toHaveLength(3); // the window is not reset
  });

  it('8/10 (80%) passes -> RETAIN WAITING with nextEligibleAt = pass + 3 days', () => {
    const d = decide([...PRACTICE_READY, prove(PROVE_PASS_AT, 8)], '2026-10-03T11:00:00.000Z');
    expect(req(d, 'PROVE').status).toBe('SATISFIED');
    expect(d.stage).toBe('RETAIN');
    expect(d.actionState).toBe('WAITING');
    expect(d.waitingReason).toBe('RETENTION_MINIMUM_INTERVAL_NOT_REACHED');
    expect(d.nextEligibleAt).toBe(plusDays(PROVE_PASS_AT, 3));
    expect(d.nextEligibleAt).toBe('2026-10-06T10:00:00.000Z');
    expect(d.lastQualifyingProveAt).toBe(PROVE_PASS_AT);
  });

  it('a Prove of any size other than 10 is UNRESOLVED_POLICY, never a pass', () => {
    const d = decide([...PRACTICE_READY, prove('2026-10-03T00:00:00.000Z', 5, 5)], '2026-10-03T01:00:00.000Z');
    expect(req(d, 'PROVE').status).toBe('UNSATISFIED');
    expect(req(d, 'PROVE').reasonCodes).toContain('UNRESOLVED_POLICY');
  });

  it('repeated attempts: fail, fail, pass -> the pass anchors Retain; later attempts (fail or pass) are history only and never undo it', () => {
    const f1 = prove('2026-10-03T00:00:00.000Z', 6);
    const f2 = prove('2026-10-03T01:00:00.000Z', 7);
    const p = prove('2026-10-03T02:00:00.000Z', 9);
    const laterFail = prove('2026-10-03T03:00:00.000Z', 2);
    const laterPass = prove('2026-10-03T04:00:00.000Z', 10);

    const afterTwoFails = decide([...PRACTICE_READY, f1, f2], '2026-10-03T01:30:00.000Z');
    expect(afterTwoFails.stage).toBe('PROVE');
    expect(afterTwoFails.actionState).toBe('EXECUTABLE');
    expect(afterTwoFails.proveAttemptsInCycle).toBe(2);

    const afterPass = decide([...PRACTICE_READY, f1, f2, p], '2026-10-03T02:30:00.000Z');
    expect(afterPass.stage).toBe('RETAIN');
    expect(afterPass.nextEligibleAt).toBe(plusDays(p.timestamp, 3));

    const afterMore = decide([...PRACTICE_READY, f1, f2, p, laterFail, laterPass], '2026-10-03T04:30:00.000Z');
    expect(req(afterMore, 'PROVE').status).toBe('SATISFIED');
    expect(req(afterMore, 'PROVE').qualifyingEvidenceIds).toEqual([p.id]);
    expect(req(afterMore, 'PROVE').nonQualifyingEvidenceIds).toEqual([f1.id, f2.id, laterFail.id, laterPass.id]);
    expect(afterMore.lastQualifyingProveAt).toBe(p.timestamp);
    expect(afterMore.nextEligibleAt).toBe(plusDays(p.timestamp, 3)); // the Retain clock is never re-anchored
    expect(afterMore.stage).toBe('RETAIN');
    expect(afterMore.rollback).toBeNull();
  });
});

describe('RETAIN -- 5 items, not before day 3, two-strike rule', () => {
  const PROVEN = [...PRACTICE_READY, prove(PROVE_PASS_AT, 9)];
  const DUE = plusDays(PROVE_PASS_AT, 3);

  it('is WAITING until exactly pass + 3 days, then EXECUTABLE with the 5-item independent contract', () => {
    const justBefore = decide(PROVEN, new Date(new Date(DUE).getTime() - 1).toISOString());
    expect(justBefore.stage).toBe('RETAIN');
    expect(justBefore.actionState).toBe('WAITING');
    expect(justBefore.nextEligibleAt).toBe(DUE);

    const atDue = decide(PROVEN, DUE);
    expect(atDue.actionState).toBe('EXECUTABLE');
    expect(atDue.nextCanonicalAction).toBe('RETENTION_CHECK');
    expect(atDue.activityContract).toMatchObject({ activityType: 'RETENTION_CHECK', itemCount: { min: 5, max: 5 }, independence: true, minimumScorePercent: 80 });
  });

  it('an attempt before day 3 never counts -- not as a pass (5/5) and not as a strike (0/5)', () => {
    const earlyPass = retain(plusDays(PROVE_PASS_AT, 2.9), 5);
    const d1 = decide([...PROVEN, earlyPass], plusDays(PROVE_PASS_AT, 4));
    expect(req(d1, 'RETAIN').status).toBe('UNSATISFIED');
    expect(req(d1, 'RETAIN').reasonCodes).toContain('TEMPORALLY_INELIGIBLE');

    const earlyFail = retain(plusDays(PROVE_PASS_AT, 2.9), 0);
    const onTimeFail = retain(plusDays(PROVE_PASS_AT, 3.1), 1);
    const d2 = decide([...PROVEN, earlyFail, onTimeFail], plusDays(PROVE_PASS_AT, 4));
    expect(d2.rollback).toBeNull(); // only ONE genuine strike so far
    expect(d2.stage).toBe('RETAIN');
    expect(req(d2, 'PROVE').status).toBe('SATISFIED');
  });

  it('fail #1 -> immediate retry (RETAIN executable, no new wait, Prove still valid)', () => {
    const fail1 = retain(plusDays(PROVE_PASS_AT, 3), 3); // 60%
    const d = decide([...PROVEN, fail1], plusDays(PROVE_PASS_AT, 3.01));
    expect(d.stage).toBe('RETAIN');
    expect(d.actionState).toBe('EXECUTABLE');
    expect(d.waitingReason).toBeNull();
    expect(d.nextEligibleAt).toBeNull();
    expect(d.rollback).toBeNull();
    expect(req(d, 'PROVE').status).toBe('SATISFIED');

    const retryPass = retain(plusDays(PROVE_PASS_AT, 3.02), 4); // 80%
    const after = decide([...PROVEN, fail1, retryPass], plusDays(PROVE_PASS_AT, 3.03));
    expect(req(after, 'RETAIN').status).toBe('SATISFIED');
    expect(after.stage).toBe('TRANSFER');
  });

  it('fail #2 (consecutive) -> back to PROVE (Practice stays satisfied); a new Prove pass -> a NEW +3 day timer from that pass', () => {
    const fail1 = retain(plusDays(PROVE_PASS_AT, 3), 3);
    const fail2 = retain(plusDays(PROVE_PASS_AT, 3.05), 2);
    const back = decide([...PROVEN, fail1, fail2], plusDays(PROVE_PASS_AT, 3.1));
    expect(back.stage).toBe('PROVE');
    expect(back.actionState).toBe('EXECUTABLE');
    expect(back.rollback?.case).toBe('RETENTION_FAILURE_RETURN_TO_PROVE');
    expect(req(back, 'PRACTICE').status).toBe('SATISFIED');
    expect(req(back, 'RETAIN').status).toBe('LOCKED');
    expect(back.lastQualifyingProveAt).toBeNull();

    const newPassAt = plusDays(PROVE_PASS_AT, 3.2);
    const renewed = decide([...PROVEN, fail1, fail2, prove(newPassAt, 8)], plusDays(PROVE_PASS_AT, 3.3));
    expect(renewed.stage).toBe('RETAIN');
    expect(renewed.actionState).toBe('WAITING');
    expect(renewed.nextEligibleAt).toBe(plusDays(newPassAt, 3));
    expect(renewed.nextEligibleAt).not.toBe(DUE);
    expect(renewed.rollback).toBeNull();
  });

  it('itemCount is 5: a 10-item check is UNRESOLVED_POLICY (neither a pass nor a strike); 4/5 (80%) passes', () => {
    const tenItem = retain(DUE, 10, 10);
    const d10 = decide([...PROVEN, tenItem], plusDays(DUE, 0.1));
    expect(req(d10, 'RETAIN').status).toBe('UNSATISFIED');
    expect(req(d10, 'RETAIN').reasonCodes).toContain('UNRESOLVED_POLICY');
    const twoTenItemFails = decide([...PROVEN, retain(DUE, 0, 10), retain(plusDays(DUE, 0.01), 0, 10)], plusDays(DUE, 0.1));
    expect(twoTenItemFails.rollback).toBeNull();

    const d5 = decide([...PROVEN, retain(DUE, 4)], plusDays(DUE, 0.1));
    expect(req(d5, 'RETAIN').status).toBe('SATISFIED');
    expect(d5.stage).toBe('TRANSFER');
  });
});

describe('CONSOLIDATED requires every requirement', () => {
  const PROVEN = [...PRACTICE_READY, prove(PROVE_PASS_AT, 9)];
  const RETAINED = [...PROVEN, retain(plusDays(PROVE_PASS_AT, 3), 5)];
  const NOW = plusDays(PROVE_PASS_AT, 10);

  it('LEARN -> PRACTICE(3/3) -> PROVE -> RETAIN(5) -> TRANSFER reaches CONSOLIDATED with every requirement SATISFIED', () => {
    const d = decide([...RETAINED, transfer(plusDays(PROVE_PASS_AT, 5), [90, 85, 80])], NOW);
    expect(d.stage).toBe('CONSOLIDATED');
    expect(d.actionState).toBe('CONSOLIDATED');
    expect(d.requirements.every((r) => r.status === 'SATISFIED')).toBe(true);
  });

  it('missing or failing any one requirement is never CONSOLIDATED', () => {
    // no Transfer yet
    expect(decide(RETAINED, NOW).stage).toBe('TRANSFER');
    // Transfer with a challenge below the 70 floor (overall 83.3)
    expect(decide([...RETAINED, transfer(plusDays(PROVE_PASS_AT, 5), [100, 90, 60])], NOW).stage).toBe('TRANSFER');
    // no Retain
    expect(decide([...PROVEN, transfer(plusDays(PROVE_PASS_AT, 5), [90, 90, 90])], NOW).stage).toBe('RETAIN');
    // only 2 Practices: Prove/Retain/Transfer evidence is premature, never consolidating
    const twoPractices = [LEARNED, practice('2026-10-02T00:00:00.000Z', 90), practice('2026-10-02T01:00:00.000Z', 90)];
    const premature = decide([...twoPractices, prove(PROVE_PASS_AT, 10), retain(plusDays(PROVE_PASS_AT, 3), 5), transfer(plusDays(PROVE_PASS_AT, 5), [90, 90, 90])], NOW);
    expect(premature.stage).toBe('PRACTICE');
    expect(req(premature, 'PROVE').reasonCodes).toContain('PREMATURE_STAGE_EVIDENCE');
    // no LEARN check of the governed size
    const noLearn = [learnCheck('2026-10-01T00:00:00.000Z', 100, 4), ...PRACTICE_READY.slice(1), prove(PROVE_PASS_AT, 9)];
    expect(decide(noLearn, NOW).stage).toBe('LEARN');
  });
});
