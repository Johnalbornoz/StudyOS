/**
 * OVERNIGHT 2026-10-16 -- engine policy certification (docs/orchestration/OVERNIGHT_2026-10-16_CONTRACTS.md,
 * sections 0, 1.1, 1.2 and 1.3). POLICY_VERSION 'studyus-canonical-v3-pilot-2026-10-16'.
 *
 *   LEARN     a guided session of 4-7 interactions; AI closes at 4..7, CAP closes at exactly 7; NO score gate.
 *             Legacy LEARN_CHECK quiz rows qualify once completed with >= 4 items, whatever the score.
 *   PRACTICE  the last 3 completed practices: average >= 80 AND latest >= 80.
 *   PROVE     exactly 10 independent items at >= 80; a failure stays in PROVE.
 *   RETAIN    5 novel independent items, not before Prove pass + 3 days; fail #1 retry, fail #2 -> PROVE.
 *   APPLY     an adaptive NEAR/MID/FAR ladder of 3-5 challenges, each passing at >= 80; MID -> CONSOLIDATED MEDIUM,
 *             FAR -> HIGH; NEAR only -> stays TRANSFER with no rollback; the best level is never lowered.
 *   REVALIDATION  subject Test / Mock past PRACTICE: < 60 -> PRACTICE; 60-79 alert, 2 consecutive -> PRACTICE;
 *             >= 80 resets the counter; LEARN is kept; never satisfies a stage.
 *
 * Every test runs the REAL engine (and, where the row shape matters, the REAL adapter) through its public API, with an
 * injected `now`. Nothing is mocked.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateCanonicalLearningState,
  qualifyEvidence,
  CANONICAL_POLICY,
  POLICY_VERSION,
  type RawEvidenceItem,
  type CanonicalPedagogicalDecision,
  type TransferLadderChallenge,
  type TransferLevel,
} from '@/lib/pedagogical-engine';
import { mapStudyUSEvidenceToPedagogicalEvidence } from '@/lib/pedagogical-shadow/evidence-adapter';
import type { StudyUSEvidenceRow } from '@/lib/pedagogical-shadow/types';
import { projectCanonicalJourneyStage, canonicalEngineHasEvidence } from '@/lib/lx/learner-journey-contract';

let seq = 0;
function item(overrides: Partial<RawEvidenceItem>): RawEvidenceItem {
  seq++;
  return {
    id: overrides.id ?? `ev-${String(seq).padStart(4, '0')}`,
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

const T = (day: number, hour = 0, minute = 0) => new Date(Date.UTC(2026, 9, day, hour, minute)).toISOString();
const plusMs = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();
const DAY = 86_400_000;

const learnSession = (ts: string, interactionCount: number, closedBy: 'AI' | 'CAP', weaknesses: string[] = [], scorePercent = 0) =>
  item({ activityType: 'LEARN_CHECK', timestamp: ts, itemCount: 0, correctCount: 0, scorePercent, difficulty: 1.5, learnInteractionCount: interactionCount, learnClosedBy: closedBy, learnWeaknesses: weaknesses });
const legacyLearnQuiz = (ts: string, itemCount: number, scorePercent: number) =>
  item({ activityType: 'LEARN_CHECK', timestamp: ts, itemCount, correctCount: Math.round((scorePercent / 100) * itemCount), scorePercent, difficulty: 1.5 });
const practice = (ts: string, scorePercent: number) =>
  item({ activityType: 'PRACTICE', timestamp: ts, itemCount: 3, correctCount: Math.round((scorePercent / 100) * 3), scorePercent, difficulty: 3 });
const prove = (ts: string, correct: number) =>
  item({ activityType: 'PROVE', timestamp: ts, itemCount: 10, correctCount: correct, scorePercent: correct * 10, difficulty: 3.5, independent: true });
const retain = (ts: string, correct: number) =>
  item({ activityType: 'RETENTION_CHECK', timestamp: ts, itemCount: 5, correctCount: correct, scorePercent: correct * 20, difficulty: 3.5, independent: true, novel: true });

/** One ladder challenge: passes at >= 80 and certified. */
const ch = (level: TransferLevel, scorePercent: number, certified = true): TransferLadderChallenge => ({
  level, scorePercent, passed: scorePercent >= 80, certified, taskId: `task-${level}-${scorePercent}-${seq}`, contextDomain: null,
});
function highest(challenges: TransferLadderChallenge[]): TransferLevel | null {
  const order: TransferLevel[] = ['NEAR', 'MID', 'FAR'];
  let best: TransferLevel | null = null;
  for (const c of challenges) if (c.passed && c.certified && c.scorePercent >= 80 && (best === null || order.indexOf(c.level) > order.indexOf(best))) best = c.level;
  return best;
}
const ladder = (ts: string, challenges: TransferLadderChallenge[], extra: Partial<RawEvidenceItem> = {}) =>
  item({
    activityType: 'TRANSFER', timestamp: ts, itemCount: challenges.length, correctCount: challenges.filter((c) => c.passed).length,
    scorePercent: challenges.reduce((a, c) => a + c.scorePercent, 0) / challenges.length, difficulty: 4.5, independent: true,
    transferLadder: challenges, transferHighestLevel: highest(challenges), ...extra,
  });
const assessment = (ts: string, scorePercent: number) =>
  item({ activityType: 'INTERNAL_ASSESSMENT', timestamp: ts, itemCount: 4, correctCount: Math.round((scorePercent / 100) * 4), scorePercent, difficulty: 3, independent: true });

const decide = (evidence: RawEvidenceItem[], now: string, activeCriticalMisconception = false): CanonicalPedagogicalDecision =>
  evaluateCanonicalLearningState({ conceptId: 'c1', studentId: 's1', now, evidence, activeCriticalMisconception });
const req = (d: CanonicalPedagogicalDecision, stage: string) => d.requirements.find((r) => r.stage === stage)!;
const projected = (d: CanonicalPedagogicalDecision) => projectCanonicalJourneyStage(d, canonicalEngineHasEvidence(d));

// ---------------------------------------------------------------- shared journey fixtures
const LEARNED = learnSession(T(1), 4, 'AI', ['confuses numerator and denominator']);
const PRACTICE_READY = [LEARNED, practice(T(2, 0), 90), practice(T(2, 1), 90), practice(T(2, 2), 90)];
const PROVE_AT = T(3, 10);
const PROVEN = [...PRACTICE_READY, prove(PROVE_AT, 9)];
const RETAIN_AT = plusMs(PROVE_AT, 3 * DAY);
const RETAINED = [...PROVEN, retain(RETAIN_AT, 5)];
const APPLY_AT = (n: number) => plusMs(RETAIN_AT, (n + 1) * 3_600_000);
const NOW = T(20);

describe('policy object and version', () => {
  it('names the overnight version and carries exactly the contracted values (old LEARN / TRANSFER gates removed)', () => {
    expect(POLICY_VERSION).toBe('studyus-canonical-v3-pilot-2026-10-16');
    expect(CANONICAL_POLICY.version).toBe(POLICY_VERSION);
    expect(CANONICAL_POLICY.learn).toEqual({ difficulty: { min: 1, max: 2 }, minInteractions: 4, maxInteractions: 7 });
    expect(CANONICAL_POLICY.practice).toMatchObject({ windowSize: 3, minimumWindowAveragePercent: 80, latestMustPass: true });
    expect(CANONICAL_POLICY.transfer).toEqual({
      difficulty: { min: 4, max: 5 }, minChallenges: 3, maxChallenges: 5, perChallengePassPercent: 80,
      levels: ['NEAR', 'MID', 'FAR'], consolidatedMinimumLevel: 'MID', independenceRequired: true,
    });
    expect(CANONICAL_POLICY.internalAssessment).toEqual({ strongContradictionBelow: 60, alertBelow: 80, consecutiveAlertsForRevalidation: 2 });
    expect(decide([], NOW).policyVersion).toBe('studyus-canonical-v3-pilot-2026-10-16');
  });

  it('LEARN and TRANSFER activity contracts follow the new evidence contracts', () => {
    expect(decide([], NOW).activityContract).toMatchObject({
      activityType: 'LEARN_CHECK', itemCount: { min: 4, max: 7 }, minimumScorePercent: null, independence: false,
      evidenceContract: 'LEARN_GUIDED_UNDERSTANDING_4_TO_7_NO_SCORE_GATE',
    });
    expect(decide(RETAINED, NOW).activityContract).toMatchObject({
      activityType: 'TRANSFER', itemCount: { min: 3, max: 5 }, minimumScorePercent: 80, independence: true,
      transferDepth: ['NEAR', 'MID', 'FAR'], evidenceContract: 'TRANSFER_ADAPTIVE_LADDER_3_TO_5_PER_CHALLENGE_80',
    });
  });
});

describe('LEARN -- guided 4-7 interactions, no score gate', () => {
  it('closes at 4 (AI) -> LEARN satisfied, stage PRACTICE', () => {
    const d = decide([learnSession(T(1), 4, 'AI')], T(1, 1));
    expect(req(d, 'LEARN').status).toBe('SATISFIED');
    expect(req(d, 'LEARN').reasonCodes).toEqual(['LEARN_COMPLETED']);
    expect(d.stage).toBe('PRACTICE');
  });

  it('extends to 5 / 6 / 7 when the AI keeps it open: each closes and advances', () => {
    for (const n of [5, 6, 7]) {
      const d = decide([learnSession(T(1), n, 'AI')], T(1, 1));
      expect(req(d, 'LEARN').status).toBe('SATISFIED');
      expect(d.stage).toBe('PRACTICE');
    }
  });

  it('at 7 the CAP closes it and the concept advances; CAP before 7 is not a valid close (UNRESOLVED, never a pass)', () => {
    const cap = decide([learnSession(T(1), 7, 'CAP')], T(1, 1));
    expect(req(cap, 'LEARN').status).toBe('SATISFIED');
    expect(cap.stage).toBe('PRACTICE');
    for (const n of [4, 5, 6]) {
      const ev = learnSession(T(1), n, 'CAP');
      expect(qualifyEvidence(ev, { targetStage: 'LEARN', prerequisiteSatisfied: true })).toEqual({ result: 'UNRESOLVED', reasonCode: 'UNRESOLVED_POLICY' });
      expect(decide([ev], T(1, 1)).stage).toBe('LEARN');
    }
  });

  it('outside 4..7 interactions is UNRESOLVED (never a pass): 3 and 8', () => {
    for (const n of [0, 3, 8]) {
      const ev = learnSession(T(1), n, 'AI');
      expect(qualifyEvidence(ev, { targetStage: 'LEARN', prerequisiteSatisfied: true })).toEqual({ result: 'UNRESOLVED', reasonCode: 'UNRESOLVED_POLICY' });
      expect(decide([ev], T(1, 1)).stage).toBe('LEARN');
    }
  });

  it('there is no score gate: a session recorded at 0% still closes LEARN; a legacy quiz of >= 4 items qualifies at any score', () => {
    expect(req(decide([learnSession(T(1), 4, 'AI', [], 0)], T(1, 1)), 'LEARN').status).toBe('SATISFIED');
    for (const score of [0, 20, 79.9, 100]) {
      const d = decide([legacyLearnQuiz(T(1), 4, score)], T(1, 1));
      expect(req(d, 'LEARN').status).toBe('SATISFIED');
      expect(d.stage).toBe('PRACTICE');
    }
    expect(req(decide([legacyLearnQuiz(T(1), 5, 40)], T(1, 1)), 'LEARN').status).toBe('SATISFIED');
    // a legacy quiz with fewer than 4 items (or an unknown 0 count) is UNRESOLVED, even at 100%
    for (const n of [0, 3]) {
      const ev = legacyLearnQuiz(T(1), n, 100);
      expect(qualifyEvidence(ev, { targetStage: 'LEARN', prerequisiteSatisfied: true }).result).toBe('UNRESOLVED');
      expect(decide([ev], T(1, 1)).stage).toBe('LEARN');
    }
  });

  it('exposes the LATEST qualifying session\'s weaknesses for PRACTICE generation', () => {
    expect(decide([], T(1)).learnWeaknesses).toEqual([]);
    const d = decide([learnSession(T(1, 0), 4, 'AI', ['old']), learnSession(T(1, 2), 6, 'AI', ['sign errors', 'unit conversion']), learnSession(T(1, 3), 8, 'AI', ['invalid'])], T(1, 4));
    expect(d.learnWeaknesses).toEqual(['sign errors', 'unit conversion']);
  });
});

describe('PRACTICE -- average of the last 3 >= 80 AND latest >= 80', () => {
  const at = (scores: number[]) => decide([LEARNED, ...scores.map((s, i) => practice(T(2, i), s))], T(2, 12));

  it('average < 80 stays in PRACTICE (latest passing): 70, 75, 85', () => {
    const d = at([70, 75, 85]);
    expect(req(d, 'PRACTICE').status).toBe('UNSATISFIED');
    expect(d.stage).toBe('PRACTICE');
    expect(d.practiceProgress!.windowAveragePercent).toBe(76.7);
  });

  it('latest < 80 stays in PRACTICE despite an average >= 80: 100, 100, 50', () => {
    const d = at([100, 100, 50]);
    expect(d.practiceProgress!.windowAveragePercent).toBeGreaterThanOrEqual(80);
    expect(req(d, 'PRACTICE').status).toBe('UNSATISFIED');
    expect(d.stage).toBe('PRACTICE');
  });

  it('average >= 80 and latest >= 80 -> PROVE (READY_TO_PROVE projection): 75, 82, 88', () => {
    const d = at([75, 82, 88]);
    expect(req(d, 'PRACTICE').status).toBe('SATISFIED');
    expect(d.stage).toBe('PROVE');
    expect(d.actionState).toBe('EXECUTABLE');
    expect(projected(d)).toBe('READY_TO_PROVE');
  });
});

describe('PROVE', () => {
  it('7/10 fails and stays in PROVE (no rollback, Practice kept)', () => {
    const d = decide([...PRACTICE_READY, prove(T(3), 7)], T(3, 1));
    expect(d.stage).toBe('PROVE');
    expect(d.actionState).toBe('EXECUTABLE');
    expect(d.rollback).toBeNull();
    expect(req(d, 'PRACTICE').status).toBe('SATISFIED');
    expect(projected(d)).toBe('PROVE');
  });

  it('8/10 passes -> RETAIN WAITING with nextEligibleAt = pass + 3 days', () => {
    const d = decide([...PRACTICE_READY, prove(PROVE_AT, 8)], plusMs(PROVE_AT, 3_600_000));
    expect(d.stage).toBe('RETAIN');
    expect(d.actionState).toBe('WAITING');
    expect(d.nextEligibleAt).toBe(plusMs(PROVE_AT, 3 * DAY));
  });
});

describe('RETAIN -- injected now', () => {
  it('at T0 + 2d 23h 59m it is locked (WAITING); at T0 + 3d it is available', () => {
    const early = decide(PROVEN, plusMs(PROVE_AT, 3 * DAY - 60_000));
    expect(early.stage).toBe('RETAIN');
    expect(early.actionState).toBe('WAITING');
    expect(projected(early)).toBe('WAIT_FOR_RETENTION');
    const due = decide(PROVEN, plusMs(PROVE_AT, 3 * DAY));
    expect(due.actionState).toBe('EXECUTABLE');
    expect(due.nextCanonicalAction).toBe('RETENTION_CHECK');
  });

  it('3/5 fails; fail #1 -> immediate retry; fail #2 -> PROVE; a new Prove -> a new +3 days', () => {
    const f1 = retain(RETAIN_AT, 3);
    const afterF1 = decide([...PROVEN, f1], plusMs(RETAIN_AT, 60_000));
    expect(req(afterF1, 'RETAIN').reasonCodes).toContain('FAILED_ATTEMPT');
    expect(afterF1.stage).toBe('RETAIN');
    expect(afterF1.actionState).toBe('EXECUTABLE');
    expect(afterF1.rollback).toBeNull();

    const f2 = retain(plusMs(RETAIN_AT, 120_000), 3);
    const afterF2 = decide([...PROVEN, f1, f2], plusMs(RETAIN_AT, 180_000));
    expect(afterF2.stage).toBe('PROVE');
    expect(afterF2.rollback?.case).toBe('RETENTION_FAILURE_RETURN_TO_PROVE');
    expect(req(afterF2, 'PRACTICE').status).toBe('SATISFIED');

    const newProveAt = plusMs(RETAIN_AT, DAY);
    const renewed = decide([...PROVEN, f1, f2, prove(newProveAt, 8)], plusMs(newProveAt, 60_000));
    expect(renewed.stage).toBe('RETAIN');
    expect(renewed.actionState).toBe('WAITING');
    expect(renewed.nextEligibleAt).toBe(plusMs(newProveAt, 3 * DAY));
  });
});

describe('APPLY -- adaptive NEAR/MID/FAR ladder', () => {
  it('NEAR -> MID -> FAR in 3 challenges -> CONSOLIDATED with HIGH consolidation', () => {
    const d = decide([...RETAINED, ladder(APPLY_AT(0), [ch('NEAR', 90), ch('MID', 85), ch('FAR', 80)])], NOW);
    expect(d.stage).toBe('CONSOLIDATED');
    expect(d.transferLevelReached).toBe('FAR');
    expect(d.consolidationLevel).toBe('HIGH');
    expect(req(d, 'TRANSFER').reasonCodes).toEqual(['TRANSFER_LEVEL_REACHED']);
  });

  it('a failed challenge is retried at the same level, and the ladder can complete in 4 or 5 challenges', () => {
    const four = decide([...RETAINED, ladder(APPLY_AT(0), [ch('NEAR', 60), ch('NEAR', 90), ch('MID', 70), ch('MID', 85)])], NOW);
    expect(four.stage).toBe('CONSOLIDATED');
    expect(four.transferLevelReached).toBe('MID');
    expect(four.consolidationLevel).toBe('MEDIUM');
    const five = decide([...RETAINED, ladder(APPLY_AT(0), [ch('NEAR', 90), ch('MID', 70), ch('MID', 80), ch('FAR', 50), ch('FAR', 95)])], NOW);
    expect(five.stage).toBe('CONSOLIDATED');
    expect(five.consolidationLevel).toBe('HIGH');
  });

  it('NEAR only -> stays in TRANSFER, no rollback, no REINFORCE, every prior stage kept; APPLY may repeat', () => {
    const d = decide([...RETAINED, ladder(APPLY_AT(0), [ch('NEAR', 85), ch('MID', 60), ch('MID', 70)])], NOW);
    expect(d.stage).toBe('TRANSFER');
    expect(d.actionState).toBe('EXECUTABLE');
    expect(d.nextCanonicalAction).toBe('TRANSFER');
    expect(d.rollback).toBeNull();
    expect(d.intervention).toBeNull();
    expect(req(d, 'TRANSFER').reasonCodes).toEqual(['TRANSFER_LEVEL_BELOW_CONSOLIDATION']);
    expect(req(d, 'TRANSFER').reasonCodes).not.toContain('FAILED_ATTEMPT');
    for (const s of ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN']) expect(req(d, s).status).toBe('SATISFIED');
    expect(d.transferLevelReached).toBe('NEAR');
    expect(d.consolidationLevel).toBeNull();
    // nothing passed at all is the same: below consolidation, no rollback
    const none = decide([...RETAINED, ladder(APPLY_AT(0), [ch('NEAR', 10), ch('NEAR', 20), ch('NEAR', 30)])], NOW);
    expect(none.stage).toBe('TRANSFER');
    expect(none.rollback).toBeNull();
    expect(none.transferLevelReached).toBeNull();
  });

  it('MID -> CONSOLIDATED MEDIUM; FAR -> HIGH', () => {
    const mid = decide([...RETAINED, ladder(APPLY_AT(0), [ch('NEAR', 80), ch('MID', 80), ch('FAR', 79)])], NOW);
    expect(mid.stage).toBe('CONSOLIDATED');
    expect(mid.consolidationLevel).toBe('MEDIUM');
    const far = decide([...RETAINED, ladder(APPLY_AT(0), [ch('NEAR', 100), ch('MID', 100), ch('FAR', 100)])], NOW);
    expect(far.consolidationLevel).toBe('HIGH');
  });

  it('an APPLY retry never lowers the level reached', () => {
    const midThenNear = decide([
      ...RETAINED,
      ladder(APPLY_AT(0), [ch('NEAR', 90), ch('MID', 90), ch('FAR', 40)]),
      ladder(APPLY_AT(1), [ch('NEAR', 90), ch('MID', 50), ch('MID', 50)]),
    ], NOW);
    expect(midThenNear.stage).toBe('CONSOLIDATED');
    expect(midThenNear.transferLevelReached).toBe('MID');
    expect(midThenNear.consolidationLevel).toBe('MEDIUM');

    const farThenMid = decide([
      ...RETAINED,
      ladder(APPLY_AT(0), [ch('NEAR', 90), ch('MID', 90), ch('FAR', 90)]),
      ladder(APPLY_AT(1), [ch('NEAR', 90), ch('MID', 90), ch('FAR', 10)]),
    ], NOW);
    expect(farThenMid.consolidationLevel).toBe('HIGH');

    const nearThenMid = decide([
      ...RETAINED,
      ladder(APPLY_AT(0), [ch('NEAR', 90), ch('MID', 60), ch('MID', 60)]),
      ladder(APPLY_AT(1), [ch('NEAR', 90), ch('MID', 90), ch('FAR', 60)]),
    ], NOW);
    expect(nearThenMid.stage).toBe('CONSOLIDATED');
    expect(nearThenMid.consolidationLevel).toBe('MEDIUM');
  });

  it('a passed but uncertified challenge does not count toward the level', () => {
    const d = decide([...RETAINED, ladder(APPLY_AT(0), [ch('NEAR', 90), ch('MID', 95, false), ch('MID', 60)])], NOW);
    expect(d.stage).toBe('TRANSFER');
    expect(d.transferLevelReached).toBe('NEAR');
  });

  it('CONSOLIDATED requires TRANSFER >= MID: a ladder before RETAIN is premature and never consolidates', () => {
    const d = decide([...PROVEN, ladder(plusMs(PROVE_AT, 3_600_000), [ch('NEAR', 90), ch('MID', 90), ch('FAR', 90)])], plusMs(PROVE_AT, 2 * DAY));
    expect(d.stage).toBe('RETAIN');
    expect(req(d, 'TRANSFER').reasonCodes).toEqual(['PREMATURE_STAGE_EVIDENCE']);
    expect(d.transferLevelReached).toBeNull();
    expect(d.consolidationLevel).toBeNull();
  });

  it('a legacy 3-challenge NEAR/CONTEXTUAL/HIGHER row is UNRESOLVED: no qualification and no rollback (no 70% floor)', () => {
    const legacyPass = item({ activityType: 'TRANSFER', timestamp: APPLY_AT(0), itemCount: 3, scorePercent: 95, difficulty: 4.5, independent: true, perChallengeScores: [95, 95, 95], reasoningProvided: true });
    const legacyFail = item({ activityType: 'TRANSFER', timestamp: APPLY_AT(1), itemCount: 3, scorePercent: 30, difficulty: 4.5, independent: true, perChallengeScores: [30, 30, 30], transferFailureDiagnostic: 'FOUNDATIONAL_PROCEDURAL_FAILURE' });
    const d = decide([...RETAINED, legacyPass, legacyFail], NOW);
    expect(d.stage).toBe('TRANSFER');
    expect(d.rollback).toBeNull();
    expect(req(d, 'TRANSFER').reasonCodes).toEqual(['UNRESOLVED_POLICY']);
    expect(req(d, 'PRACTICE').status).toBe('SATISFIED');
  });

  it('a critical misconception during APPLY still rolls back to PRACTICE (Case D) and resets the level', () => {
    const d = decide([...RETAINED, ladder(APPLY_AT(0), [ch('NEAR', 90), ch('MID', 90), ch('FAR', 90)], { hasCriticalMisconception: true })], NOW);
    expect(d.stage).toBe('PRACTICE');
    expect(d.rollback?.case).toBe('TRANSFER_CASE_D_CRITICAL_MISCONCEPTION');
    expect(d.intervention).toBe('REINFORCE');
    expect(req(d, 'LEARN').status).toBe('SATISFIED');
    expect(d.transferLevelReached).toBeNull();
  });

  it('an assisted ladder does not qualify (independence required) and rolls nothing back', () => {
    const d = decide([...RETAINED, ladder(APPLY_AT(0), [ch('NEAR', 90), ch('MID', 90), ch('FAR', 90)], { independent: false })], NOW);
    expect(d.stage).toBe('TRANSFER');
    expect(d.rollback).toBeNull();
    expect(req(d, 'TRANSFER').reasonCodes).toEqual(['ASSISTED_WHEN_INDEPENDENCE_REQUIRED']);
  });
});

describe('REVALIDATION -- subject Test / Mock past PRACTICE', () => {
  const CONSOLIDATED = [...RETAINED, ladder(APPLY_AT(0), [ch('NEAR', 90), ch('MID', 90), ch('FAR', 60)])];
  const IA_AT = (n: number) => plusMs(APPLY_AT(0), (n + 1) * DAY);

  it('a score < 60 revalidates to PRACTICE (REINFORCE); LEARN is kept; Practice / Prove / Retain / Transfer reset', () => {
    expect(decide(CONSOLIDATED, NOW).stage).toBe('CONSOLIDATED');
    const d = decide([...CONSOLIDATED, assessment(IA_AT(0), 55)], NOW);
    expect(d.stage).toBe('PRACTICE');
    expect(d.intervention).toBe('REINFORCE');
    expect(d.rollback).toEqual({ triggeredBy: 'INTERNAL_ASSESSMENT', case: 'INTERNAL_ASSESSMENT_REVALIDATION', rolledBackTo: 'PRACTICE', reasonCodes: ['INTERNAL_ASSESSMENT_STRONG_CONTRADICTION'] });
    expect(d.revalidationRequired).toBe(true);
    expect(req(d, 'LEARN').status).toBe('SATISFIED');
    expect(req(d, 'PRACTICE').status).toBe('UNSATISFIED');
    for (const s of ['PROVE', 'RETAIN', 'TRANSFER']) expect(req(d, s).status).toBe('LOCKED');
    expect(d.practiceProgress!.recentValidAttempts).toEqual([]); // the practice window reset
    expect(d.transferLevelReached).toBeNull();
    expect(d.consolidationLevel).toBeNull();
  });

  it('a score 60-79 is alert #1: no stage change; the second consecutive alert revalidates to PRACTICE', () => {
    const one = decide([...CONSOLIDATED, assessment(IA_AT(0), 70)], NOW);
    expect(one.stage).toBe('CONSOLIDATED');
    expect(one.internalAssessmentAlertCount).toBe(1);
    expect(one.revalidationRequired).toBe(false);
    expect(one.rollback).toBeNull();

    const two = decide([...CONSOLIDATED, assessment(IA_AT(0), 70), assessment(IA_AT(1), 79)], NOW);
    expect(two.stage).toBe('PRACTICE');
    expect(two.rollback?.case).toBe('INTERNAL_ASSESSMENT_REVALIDATION');
    expect(two.rollback?.reasonCodes).toEqual(['INTERNAL_ASSESSMENT_CONSECUTIVE_ALERTS']);
    expect(two.internalAssessmentAlertCount).toBe(0); // reset by the revalidation
    expect(req(two, 'LEARN').status).toBe('SATISFIED');
  });

  it('72, 86, 74 -> the >= 80 resets the counter; alert counter is 1 at the end, no stage change', () => {
    const d = decide([...CONSOLIDATED, assessment(IA_AT(0), 72), assessment(IA_AT(1), 86), assessment(IA_AT(2), 74)], NOW);
    expect(d.stage).toBe('CONSOLIDATED');
    expect(d.internalAssessmentAlertCount).toBe(1);
    expect(d.revalidationRequired).toBe(false);
  });

  it('subject Test and subject Mock share ONE history (via the real adapter): Test 70 then Mock 65 revalidates', () => {
    const rows: StudyUSEvidenceRow[] = [
      { id: 'row-test', sourceType: 'CUMULATIVE_ASSESSMENT', result: 'partial', scorePercent: 70, difficulty: 3, timestamp: IA_AT(0), hintsUsed: 0, aiAssistanceType: 'NONE', activityType: 'CUMULATIVE_ASSESSMENT' },
      { id: 'row-mock', sourceType: 'EXAM_SIMULATION', result: 'partial', scorePercent: 65, difficulty: 3, timestamp: IA_AT(1), hintsUsed: 0, aiAssistanceType: 'NONE', activityType: 'MOCK_EXAM' },
    ];
    const mapped = mapStudyUSEvidenceToPedagogicalEvidence(rows);
    expect(mapped.items.map((i) => i.activityType)).toEqual(['INTERNAL_ASSESSMENT', 'INTERNAL_ASSESSMENT']);
    const afterTest = decide([...CONSOLIDATED, mapped.items[0]], NOW);
    expect(afterTest.internalAssessmentAlertCount).toBe(1);
    expect(afterTest.stage).toBe('CONSOLIDATED');
    const afterMock = decide([...CONSOLIDATED, ...mapped.items], NOW);
    expect(afterMock.stage).toBe('PRACTICE');
    expect(afterMock.rollback?.case).toBe('INTERNAL_ASSESSMENT_REVALIDATION');
  });

  it('applies only past PRACTICE; never satisfies a stage; a re-satisfied Practice window ends the revalidation', () => {
    // before Practice is satisfied: history only
    const early = decide([LEARNED, assessment(T(1, 5), 10), assessment(T(1, 6), 70), practice(T(2, 0), 90)], T(2, 1));
    expect(early.stage).toBe('PRACTICE');
    expect(early.rollback).toBeNull();
    expect(early.internalAssessmentAlertCount).toBe(0);
    // a 100% assessment satisfies nothing
    const noStage = decide([LEARNED, assessment(T(1, 5), 100)], T(1, 6));
    expect(req(noStage, 'PRACTICE').status).toBe('UNSATISFIED');
    expect(noStage.stage).toBe('PRACTICE');
    // repair: 3 new practices re-satisfy PRACTICE -> PROVE again, revalidation over (LEARN never re-done)
    const rev = [...CONSOLIDATED, assessment(IA_AT(0), 40)];
    const repaired = decide([...rev, practice(IA_AT(1), 85), practice(IA_AT(2), 85), practice(IA_AT(3), 85)], NOW);
    expect(repaired.stage).toBe('PROVE');
    expect(repaired.revalidationRequired).toBe(false);
    expect(repaired.rollback).toBeNull();
    expect(projected(repaired)).toBe('READY_TO_PROVE');
  });

  it('is a pure replay: historical evidence is never mutated, and the same input gives the same decision', () => {
    const evidence = [...CONSOLIDATED, assessment(IA_AT(0), 72), assessment(IA_AT(1), 55)];
    const snapshot = JSON.parse(JSON.stringify(evidence));
    for (const e of evidence) Object.freeze(e);
    const a = decide([...evidence].reverse(), NOW);
    const b = decide(evidence, NOW);
    expect(JSON.parse(JSON.stringify(evidence))).toEqual(snapshot);
    expect(a).toEqual(b);
    expect(b.stage).toBe('PRACTICE');
    // every qualifying id from before the revalidation is still recorded as history
    expect(req(b, 'PROVE').nonQualifyingEvidenceIds.length + req(b, 'PROVE').qualifyingEvidenceIds.length).toBe(1);
  });
});

describe('adapter -- contracts 1.1 / 1.2 / 1.3 row shapes', () => {
  const base = (over: Partial<StudyUSEvidenceRow>): StudyUSEvidenceRow => ({
    id: 'r1', sourceType: 'PRACTICE_QUIZ', result: 'correct', scorePercent: 100, difficulty: 2, timestamp: T(1), hintsUsed: 0, aiAssistanceType: 'NONE', activityType: null, ...over,
  });

  it('maps metadata.learnSession onto the LEARN fields (no item count needed) and drops a malformed session', () => {
    const ok = mapStudyUSEvidenceToPedagogicalEvidence([
      base({ id: 'l1', sourceType: 'LEARN_GUIDED', activityType: 'LEARN_CHECK', scorePercent: null, learnSession: { version: 'learn-guided-v1', interactionCount: 5, closedBy: 'AI', weaknesses: ['w1'] } }),
    ]);
    expect(ok.items[0]).toMatchObject({ activityType: 'LEARN_CHECK', learnInteractionCount: 5, learnClosedBy: 'AI', learnWeaknesses: ['w1'] });
    expect(ok.unresolved.map((u) => u.reason)).not.toContain('ITEM_COUNT_NOT_AVAILABLE');
    const bad = mapStudyUSEvidenceToPedagogicalEvidence([
      base({ id: 'l2', activityType: 'LEARN_CHECK', itemCount: 5, learnSession: { version: 'learn-guided-v1', interactionCount: '5', closedBy: 'AI', weaknesses: [] } }),
    ]);
    expect(bad.items).toEqual([]);
    expect(bad.unresolved.map((u) => u.reason)).toContain('LEARN_SESSION_MALFORMED');
  });

  it('maps metadata.transferLadder, re-deriving the level; a mismatched declared level fails closed', () => {
    const challenges = [ch('NEAR', 90), ch('MID', 85), ch('FAR', 70)];
    const ok = mapStudyUSEvidenceToPedagogicalEvidence([
      base({ id: 't1', activityType: 'TRANSFER', difficulty: 4.5, transferLadder: { version: 'transfer-ladder-v1', challenges, highestLevelReached: 'MID' } }),
    ]);
    expect(ok.items[0]).toMatchObject({ activityType: 'TRANSFER', transferHighestLevel: 'MID', itemCount: 3 });
    expect(ok.items[0].transferLadder).toHaveLength(3);
    const lying = mapStudyUSEvidenceToPedagogicalEvidence([
      base({ id: 't2', activityType: 'TRANSFER', difficulty: 4.5, transferLadder: { version: 'transfer-ladder-v1', challenges, highestLevelReached: 'FAR' } }),
    ]);
    expect(lying.items[0].transferLadder).toBeUndefined();
    expect(lying.unresolved.map((u) => u.reason)).toContain('TRANSFER_LADDER_MALFORMED');
    const tooMany = mapStudyUSEvidenceToPedagogicalEvidence([
      base({ id: 't3', activityType: 'TRANSFER', transferLadder: { version: 'transfer-ladder-v1', challenges: [...challenges, ...challenges], highestLevelReached: 'MID' } }),
    ]);
    expect(tooMany.items[0].transferLadder).toBeUndefined();
  });

  it('CUMULATIVE_ASSESSMENT / MOCK_EXAM (and their quiz modes) -> INTERNAL_ASSESSMENT; verification follow-ups and DIAGNOSTIC_CHECK are not mapped', () => {
    const r = mapStudyUSEvidenceToPedagogicalEvidence([
      base({ id: 'a1', sourceType: 'CUMULATIVE_ASSESSMENT', activityType: 'CUMULATIVE_ASSESSMENT', scorePercent: 75 }),
      base({ id: 'a2', sourceType: 'EXAM_SIMULATION', activityType: 'MOCK_EXAM', scorePercent: 50 }),
      base({ id: 'a3', sourceType: 'CUMULATIVE_ASSESSMENT', activityType: null, quizMode: 'cumulative_assessment', scorePercent: 90 }),
      base({ id: 'a4', sourceType: 'EXAM_SIMULATION', activityType: null, quizMode: 'exam_simulation', scorePercent: 90 }),
      base({ id: 'v1', sourceType: 'SOLO_VERIFICATION', activityType: 'CUMULATIVE_ASSESSMENT', scorePercent: 0 }),
      base({ id: 'd1', sourceType: 'DIAGNOSTIC', activityType: 'DIAGNOSTIC_CHECK' }),
    ]);
    expect(r.items.map((i) => [i.id, i.activityType, i.scorePercent])).toEqual([
      ['a1', 'INTERNAL_ASSESSMENT', 75],
      ['a2', 'INTERNAL_ASSESSMENT', 50],
      ['a3', 'INTERNAL_ASSESSMENT', 90],
      ['a4', 'INTERNAL_ASSESSMENT', 90],
    ]);
    expect(r.unresolved.find((u) => u.evidenceId === 'v1')?.reason).toBe('INTERNAL_ASSESSMENT_VERIFICATION_FOLLOWUP');
    expect(r.unresolved.find((u) => u.evidenceId === 'd1')?.reason).toBe('UNSUPPORTED_ACTIVITY_TYPE');
  });
});
