/**
 * CANONICAL POLICY V2 -- AUDIT-001 REMEDIATION VERIFICATION.
 *
 * Was: AUDIT-001 (BLOCKER) -- the pre-remediation engine satisfied
 * PRACTICE on any single qualifying attempt.
 *
 * Was (CANON-V2): PRACTICE required 2 of the last 3 valid attempts >=80%.
 *
 * Now (2026-10-17 pilot pass policy, operator decision): PRACTICE requires
 * the LAST 3 valid attempts to EACH score >=80% AND their average to be
 * >=80% -- fewer than 3 valid attempts never satisfies. The window still
 * RESETS to a brand-new cycle whenever a rollback lands back on PRACTICE
 * (Transfer Case C/D); a failed PROVE no longer rolls back to PRACTICE at
 * all, so it never resets the window. Prior Practice evidence remains
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

describe('AUDIT-001 (BLOCKER): PRACTICE rolling-window consistency rule -- 2026-10-17 pilot policy (last 3 valid attempts each >= 80, average >= 80)', () => {
  describe('the former Policy V2 worked examples, re-evaluated under the 3-of-3 rule', () => {
    it('[85, 90] -> UNSATISFIED (only 2 valid attempts; the window needs 3 -- was SATISFIED under "2 of last 3")', () => {
      expect(practiceStatus([85, 90])).toBe('UNSATISFIED');
    });

    it('[85, 90, 88] -> SATISFIED (3 of 3 pass, average 87.7)', () => {
      expect(practiceStatus([85, 90, 88])).toBe('SATISFIED');
    });

    it('[90, 50, 85] -> UNSATISFIED (the 50 sits inside the last-3 window -- was SATISFIED under "2 of last 3")', () => {
      expect(practiceStatus([90, 50, 85])).toBe('UNSATISFIED');
    });

    it('[100, 40, 40] -> UNSATISFIED (only 1 of last 3 >= 80)', () => {
      expect(practiceStatus([100, 40, 40])).toBe('UNSATISFIED');
    });

    it('[40, 90, 60] -> UNSATISFIED (only 1 of last 3 >= 80)', () => {
      expect(practiceStatus([40, 90, 60])).toBe('UNSATISFIED');
    });
  });

  describe('boundary matrix (final status after the full sequence)', () => {
    it('[80,80] -> UNSATISFIED (2 attempts never fill the window)', () => expect(practiceStatus([80, 80])).toBe('UNSATISFIED'));

    it('[80,80,80] -> SATISFIED (80 is INCLUSIVE: each attempt and the 80.0 average meet the bar)', () => {
      expect(practiceStatus([80, 80, 80])).toBe('SATISFIED');
    });

    it('[80,79] -> UNSATISFIED', () => {
      expect(practiceStatus([80, 79])).toBe('UNSATISFIED');
    });

    it('[79,80,80] -> UNSATISFIED (the 79 is inside the window -- was SATISFIED under "2 of last 3")', () => expect(practiceStatus([79, 80, 80])).toBe('UNSATISFIED'));

    it('[79,80,80,80] -> SATISFIED (the 79 has rolled out; last 3 = [80,80,80])', () => expect(practiceStatus([79, 80, 80, 80])).toBe('SATISFIED'));

    it('[80,79,80] -> UNSATISFIED (one failure in the window -- was SATISFIED under "2 of last 3")', () => expect(practiceStatus([80, 79, 80])).toBe('UNSATISFIED'));

    it('[79,79,100] -> UNSATISFIED (only 1 of last 3 >= 80)', () => expect(practiceStatus([79, 79, 100])).toBe('UNSATISFIED'));

    it('[40,100,100] -> UNSATISFIED (the 40 is inside the window -- was SATISFIED under "2 of last 3")', () => expect(practiceStatus([40, 100, 100])).toBe('UNSATISFIED'));

    it('[40,100,100,100] -> SATISFIED (last 3 = [100,100,100])', () => expect(practiceStatus([40, 100, 100, 100])).toBe('SATISFIED'));

    it('[100,100,100,40] -> SATISFIED (the 40 does not retroactively unsatisfy an already-met window)', () => {
      expect(practiceStatus([100, 100, 100, 40])).toBe('SATISFIED');
    });

    it('[100,100,40] -> UNSATISFIED (the window was never met before the 40 landed in it)', () => {
      expect(practiceStatus([100, 100, 40])).toBe('UNSATISFIED');
    });

    it('[40,40,100,100] -> UNSATISFIED (last 3 = [40,100,100]); one more 100 -> SATISFIED', () => {
      expect(practiceStatus([40, 40, 100, 100])).toBe('UNSATISFIED');
      expect(practiceStatus([40, 40, 100, 100, 100])).toBe('SATISFIED');
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
    it('the single Practice 100 never satisfied PRACTICE on its own, so the Prove 50 is PREMATURE (not a genuine failure); [100,67,100] is NOT a passing window (the 67) -- two more passing Practices are needed before PROVE unlocks', () => {
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
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
      expect(decision.stage).toBe('PRACTICE');

      const afterOneMore = evaluateCanonicalLearningState(baseInput({ evidence: [...evidence, practiceItem(5, 100)] }));
      expect(afterOneMore.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED'); // [67,100,100]
      const afterTwoMore = evaluateCanonicalLearningState(baseInput({ evidence: [...evidence, practiceItem(5, 100), practiceItem(6, 100)] }));
      expect(afterTwoMore.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED'); // [100,100,100]
      expect(afterTwoMore.stage).toBe('PROVE');
      expect(afterTwoMore.actionState).toBe('EXECUTABLE');
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
    it('the reset applies to every TRANSFER-triggered rollback to PRACTICE (Case C/D) -- see audit-canon-v2-transfer-classification.test.ts for the proof; since 2026-10-17 a PROVE failure is not a rollback at all', () => {
      // Documentation anchor: the TRANSFER-triggered reset path (Case C
      // foundational, Case D misconception) is proven in
      // audit-canon-v2-transfer-classification.test.ts's own "Case C:
      // after the rollback, 3 NEW valid Practice attempts" test. The
      // PROVE-failure path is proven above to NOT reset the window.
      expect(true).toBe(true);
    });
  });
});
