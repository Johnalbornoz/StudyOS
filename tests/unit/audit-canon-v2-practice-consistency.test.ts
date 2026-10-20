/**
 * CANONICAL POLICY V2 -- AUDIT-001 REMEDIATION VERIFICATION.
 *
 * Was: AUDIT-001 (BLOCKER) -- the pre-remediation engine satisfied
 * PRACTICE on any single qualifying attempt.
 *
 * Was (CANON-V2): PRACTICE required 2 of the last 3 valid attempts >=80%.
 *
 * Was (2026-10-17 pilot pass policy): the LAST 3 valid attempts EACH >=80%
 * AND their average >=80%.
 *
 * Now (overnight 2026-10-16 contract section 0): PRACTICE requires the
 * AVERAGE of the LAST 3 valid attempts >=80% AND the LATEST attempt >=80%
 * -- the other two need not pass individually, and fewer than 3 valid
 * attempts never satisfies. The window still RESETS to a brand-new cycle
 * whenever a rollback lands back on PRACTICE (Transfer Case D, an
 * internal-assessment revalidation); a failed PROVE does not roll back to
 * PRACTICE at all, so it never resets the window. Prior Practice evidence remains
 * immutable History. These tests assert the governed behavior end-to-end
 * against the real engine. Test-only.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateCanonicalLearningState,
  type RawEvidenceItem,
  type PedagogicalEngineInput,
} from '@/lib/pedagogical-engine';

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
  return {
    conceptId: 'concept-1',
    studentId: 'student-1',
    now: '2026-01-10T00:00:00.000Z',
    evidence: [],
    activeCriticalMisconception: false,
    ...overrides,
  };
}

function learnCheckItem(ts: string, score = 90): RawEvidenceItem {
  return item({ activityType: 'LEARN_CHECK', timestamp: ts, itemCount: 5, correctCount: 5, scorePercent: score, difficulty: 1.5 });
}
const LEARNED = learnCheckItem('2025-12-31T00:00:00.000Z', 90);

function practiceItem(day: number, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({
    activityType: 'PRACTICE',
    timestamp: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    itemCount: 3,
    correctCount: Math.round((score / 100) * 3),
    scorePercent: score,
    difficulty: 3,
    ...opts,
  });
}

function proveItem(day: number, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({
    activityType: 'PROVE',
    timestamp: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    itemCount: 10,
    correctCount: Math.round((score / 100) * 10),
    scorePercent: score,
    difficulty: 3.5,
    independent: true,
    ...opts,
  });
}

function practiceStatus(scores: number[], now = '2026-02-01T00:00:00.000Z') {
  const evidence = [LEARNED, ...scores.map((s, i) => practiceItem(i + 1, s))];
  const decision = evaluateCanonicalLearningState(baseInput({ evidence, now }));
  return decision.requirements.find((r) => r.stage === 'PRACTICE')!.status;
}

describe('AUDIT-001 (BLOCKER): PRACTICE rolling-window consistency rule -- overnight 2026-10-16 policy (average of the last 3 valid attempts >= 80 AND latest >= 80)', () => {
  describe('the former Policy V2 worked examples, re-evaluated under the last-3 average + latest rule', () => {
    it('[85, 90] -> UNSATISFIED (only 2 valid attempts; the window needs 3 -- was SATISFIED under "2 of last 3")', () => {
      expect(practiceStatus([85, 90])).toBe('UNSATISFIED');
    });

    it('[85, 90, 88] -> SATISFIED (average 87.7, latest 88)', () => {
      expect(practiceStatus([85, 90, 88])).toBe('SATISFIED');
    });

    it('[90, 50, 85] -> UNSATISFIED (average 75 < 80 even though the latest 85 passes -- was SATISFIED under "2 of last 3")', () => {
      expect(practiceStatus([90, 50, 85])).toBe('UNSATISFIED');
    });

    it('[100, 40, 40] -> UNSATISFIED (average 60, latest 40)', () => {
      expect(practiceStatus([100, 40, 40])).toBe('UNSATISFIED');
    });

    it('[40, 90, 60] -> UNSATISFIED (average 63.3, latest 60)', () => {
      expect(practiceStatus([40, 90, 60])).toBe('UNSATISFIED');
    });
  });

  describe('boundary matrix (final status after the full sequence)', () => {
    it('[80,80] -> UNSATISFIED (2 attempts never fill the window)', () => expect(practiceStatus([80, 80])).toBe('UNSATISFIED'));

    it('[80,80,80] -> SATISFIED (80 is INCLUSIVE: the 80.0 average and the latest 80 meet the bar)', () => {
      expect(practiceStatus([80, 80, 80])).toBe('SATISFIED');
    });

    it('[80,79] -> UNSATISFIED', () => {
      expect(practiceStatus([80, 79])).toBe('UNSATISFIED');
    });

    it('[79,80,80] -> UNSATISFIED (average 79.67 < 80 -- was SATISFIED under "2 of last 3")', () => expect(practiceStatus([79, 80, 80])).toBe('UNSATISFIED'));

    it('[79,80,80,80] -> SATISFIED (the 79 has rolled out; last 3 = [80,80,80])', () => expect(practiceStatus([79, 80, 80, 80])).toBe('SATISFIED'));

    it('[80,79,80] -> UNSATISFIED (average 79.67 < 80 -- was SATISFIED under "2 of last 3")', () => expect(practiceStatus([80, 79, 80])).toBe('UNSATISFIED'));

    it('[79,79,100] -> SATISFIED (average 86 >= 80 and latest 100 >= 80; the two 79s need not pass individually -- was UNSATISFIED under "each of the last 3")', () => expect(practiceStatus([79, 79, 100])).toBe('SATISFIED'));

    it('[40,100,100] -> SATISFIED (average exactly 80.0, inclusive; latest 100)', () => expect(practiceStatus([40, 100, 100])).toBe('SATISFIED'));

    it('[39.9,100,100] -> UNSATISFIED (average 79.97 < 80, latest passes)', () => expect(practiceStatus([39.9, 100, 100])).toBe('UNSATISFIED'));

    it('[100,100,50] -> UNSATISFIED (average 83.3 >= 80 but the LATEST 50 fails)', () => expect(practiceStatus([100, 100, 50])).toBe('UNSATISFIED'));

    it('[100,100,79.9] -> UNSATISFIED (latest just below 80, average 93.3)', () => expect(practiceStatus([100, 100, 79.9])).toBe('UNSATISFIED'));

    it('[40,100,100,100] -> SATISFIED (last 3 = [100,100,100])', () => expect(practiceStatus([40, 100, 100, 100])).toBe('SATISFIED'));

    it('[100,100,100,40] -> SATISFIED (the 40 does not retroactively unsatisfy an already-met window)', () => {
      expect(practiceStatus([100, 100, 100, 40])).toBe('SATISFIED');
    });

    it('[100,100,40] -> UNSATISFIED (the window was never met before the 40 landed in it)', () => {
      expect(practiceStatus([100, 100, 40])).toBe('UNSATISFIED');
    });

    it('[40,40,100] -> UNSATISFIED (average 60); [40,40,100,100] -> SATISFIED (last 3 = [40,100,100], average 80, latest 100)', () => {
      expect(practiceStatus([40, 40, 100])).toBe('UNSATISFIED');
      expect(practiceStatus([40, 40, 100, 100])).toBe('SATISFIED');
    });
  });

  describe('the core defect, isolated: fewer than 3 valid attempts must NEVER satisfy PRACTICE', () => {
    it('exactly ONE Practice attempt, scoring 100%, must NOT satisfy PRACTICE (3 attempts is the structural minimum)', () => {
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 100)] }));
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    });

    it('consequently PROVE must remain LOCKED after only one qualifying Practice attempt', () => {
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 100)] }));
      expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('LOCKED');
      expect(decision.stage).not.toBe('PROVE');
    });

    it('TWO Practice attempts, both 100%, still must NOT satisfy PRACTICE (2 of 2 is no longer enough)', () => {
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 100), practiceItem(2, 100)] }));
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
      expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('LOCKED');
    });
  });

  describe('no intermediate-state divergence -- the engine never unlocks PROVE early', () => {
    it('[79,80] and [79,80,80] (prefixes of [79,80,80,80]) -> still UNSATISFIED', () => {
      const d2 = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 79), practiceItem(2, 80)] }));
      expect(d2.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
      const d3 = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 79), practiceItem(2, 80), practiceItem(3, 80)] }));
      expect(d3.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    });
  });

  describe('Section 10 real regression sequence: Practice 100, Prove 50, Practice 67, Practice 100', () => {
    it('the single Practice 100 never satisfied PRACTICE on its own, so the Prove 50 is PREMATURE (not a genuine failure); [100,67,100] IS a passing window (average 89, latest 100) -- PROVE unlocks without further practice', () => {
      const evidence = [
        LEARNED,
        practiceItem(1, 100),
        proveItem(2, 50),
        practiceItem(3, 67),
        practiceItem(4, 100),
      ];
      const decision = evaluateCanonicalLearningState(baseInput({ evidence }));
      expect(decision.requirements.find((r) => r.stage === 'PROVE')!.reasonCodes).toContain('PREMATURE_STAGE_EVIDENCE');
      expect(decision.rollback).toBeNull(); // no genuine Prove failure ever occurred -- nothing to roll back
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED'); // [100,67,100]
      expect(decision.practiceProgress?.windowAveragePercent).toBe(89);
      expect(decision.stage).toBe('PROVE');
      expect(decision.actionState).toBe('EXECUTABLE');
      // the premature Prove 50 never counts as an attempt of this cycle
      expect(decision.proveAttemptsInCycle).toBe(0);

      // the same sequence with a LATEST below 80 stays in PRACTICE: [100, 67, 79]
      const latestFails = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 100), proveItem(2, 50), practiceItem(3, 67), practiceItem(4, 79)] }));
      expect(latestFails.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
      expect(latestFails.stage).toBe('PRACTICE');
    });

    it('2026-10-17 pilot policy: a GENUINE Prove failure no longer resets the Practice window -- PRACTICE stays SATISFIED, no rollback, and the learner stays in PROVE (superseding the CANON-V2 "Prove failure resets the window" rule)', () => {
      const genuinelySatisfied = [LEARNED, practiceItem(1, 90), practiceItem(2, 90), practiceItem(3, 90)];
      const satisfied = evaluateCanonicalLearningState(baseInput({ evidence: genuinelySatisfied }));
      expect(satisfied.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED');

      const afterGenuineFailure = [...genuinelySatisfied, proveItem(4, 50)];
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: afterGenuineFailure }));
      expect(decision.requirements.find((r) => r.stage === 'PROVE')!.reasonCodes).toContain('FAILED_ATTEMPT'); // genuine -- Practice was truly satisfied first
      expect(decision.rollback).toBeNull();
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED');
      expect(decision.practiceProgress?.recentValidAttempts.map((a) => a.scorePercent)).toEqual([90, 90, 90]); // window untouched
      expect(decision.stage).toBe('PROVE');
      expect(decision.actionState).toBe('EXECUTABLE');
    });

    it('REGRESSION GUARD: qualification of the final Practice 100% attempt depends ONLY on RawEvidenceItem.activityType (== PRACTICE), never on a "canonicalActivityType: REINFORCE" tag -- the engine has no such field and cannot see it, so a REINFORCE-overlay Practice attempt qualifies identically to an ordinary one', () => {
      // This is a structural, source-level guard: RawEvidenceItem simply
      // has no canonicalActivityType field, so no future refactor of
      // qualifyEvidence can accidentally start reading it without also
      // changing this type (and this test would need a matching update,
      // making the change visible in review).
      const evidence = [LEARNED, practiceItem(1, 100), proveItem(2, 50), practiceItem(3, 67), practiceItem(4, 100)];
      const item4 = evidence[4];
      expect(Object.keys(item4)).not.toContain('canonicalActivityType');
      const decision = evaluateCanonicalLearningState(baseInput({ evidence }));
      expect(decision.qualifiedEvidence.find((q) => q.requirement === 'PRACTICE')!.qualifyingEvidenceIds).toContain(item4.id);
    });
  });

  describe('AUDIT-001-AMBIGUITY RESOLVED: the "last 3" window resets on any rollback to PRACTICE, per the remediation spec\'s own frozen product decision', () => {
    it('the reset applies to every rollback to PRACTICE (Transfer Case D, internal-assessment revalidation); a PROVE failure is not a rollback at all', () => {
      // Case D (critical misconception during Transfer) and the 2026-10-16 internal-assessment revalidation both land on
      // PRACTICE and start a new cycle: the window is empty right after, and the old passing practices no longer count.
      const passed = [LEARNED, practiceItem(1, 90), practiceItem(2, 90), practiceItem(3, 90)];
      const revalidated = evaluateCanonicalLearningState(baseInput({
        evidence: [...passed, item({ activityType: 'INTERNAL_ASSESSMENT', timestamp: '2026-01-04T00:00:00.000Z', itemCount: 4, scorePercent: 40, independent: true })],
      }));
      expect(revalidated.rollback?.case).toBe('INTERNAL_ASSESSMENT_REVALIDATION');
      expect(revalidated.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
      expect(revalidated.practiceProgress?.recentValidAttempts).toEqual([]);
      // two new passing practices are not enough -- the new cycle needs its own 3
      const twoMore = evaluateCanonicalLearningState(baseInput({
        evidence: [...passed, item({ activityType: 'INTERNAL_ASSESSMENT', timestamp: '2026-01-04T00:00:00.000Z', itemCount: 4, scorePercent: 40, independent: true }), practiceItem(5, 100), practiceItem(6, 100)],
      }));
      expect(twoMore.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    });
  });
});
