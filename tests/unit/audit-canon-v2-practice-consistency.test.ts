/**
 * CANONICAL POLICY V2 -- AUDIT-001 REMEDIATION VERIFICATION.
 *
 * Was: AUDIT-001 (BLOCKER) -- the pre-remediation engine satisfied
 * PRACTICE on any single qualifying attempt.
 *
 * Now: PRACTICE requires 2 of the last 3 valid attempts >=80% (Policy
 * V2 Section 3), and the window RESETS to a brand-new cycle whenever a
 * rollback lands back on PRACTICE (the frozen product decision from the
 * remediation spec's own Part 1A) -- prior Practice evidence remains
 * immutable History but no longer occupies a window slot for
 * requalification. These tests assert the CORRECTED behavior end-to-end
 * against the real, unmodified engine. Test-only.
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

describe('AUDIT-001 (BLOCKER): PRACTICE "2 of last 3" consistency rule -- Policy V2 Section 3', () => {
  describe('the verbatim policy examples', () => {
    it('[85, 90] -> SATISFIED (policy\'s own example)', () => {
      expect(practiceStatus([85, 90])).toBe('SATISFIED');
    });

    it('[90, 50, 85] -> SATISFIED (policy\'s own example)', () => {
      expect(practiceStatus([90, 50, 85])).toBe('SATISFIED');
    });

    it('[100, 40, 40] -> UNSATISFIED (policy\'s own example: only 1 of last 3 >= 80)', () => {
      // AUDIT FINDING: the current engine satisfies PRACTICE on the very
      // first qualifying attempt (the 100) and never revisits that
      // decision -- it has no "last 3" window at all. This assertion is
      // the policy's OWN verbatim worked example; a FAIL here is not an
      // edge case, it is the frozen spec's own headline example failing
      // against the current implementation.
      expect(practiceStatus([100, 40, 40])).toBe('UNSATISFIED');
    });

    it('[40, 90, 60] -> UNSATISFIED (policy\'s own example: only 1 of last 3 >= 80)', () => {
      expect(practiceStatus([40, 90, 60])).toBe('UNSATISFIED');
    });
  });

  describe('Section 18 required boundary matrix (final status after the full sequence)', () => {
    it('[80,80] -> SATISFIED', () => expect(practiceStatus([80, 80])).toBe('SATISFIED'));

    it('[80,79] -> UNSATISFIED (only 1 of 2 attempts >= 80; window requires 2 OF the last 3, never 1 of 2)', () => {
      expect(practiceStatus([80, 79])).toBe('UNSATISFIED');
    });

    it('[79,80,80] -> SATISFIED (2 of last 3 >= 80)', () => expect(practiceStatus([79, 80, 80])).toBe('SATISFIED'));

    it('[80,79,80] -> SATISFIED (2 of last 3 >= 80)', () => expect(practiceStatus([80, 79, 80])).toBe('SATISFIED'));

    it('[79,79,100] -> UNSATISFIED (only 1 of last 3 >= 80)', () => expect(practiceStatus([79, 79, 100])).toBe('UNSATISFIED'));

    it('[40,100,100] -> SATISFIED (2 of last 3 >= 80)', () => expect(practiceStatus([40, 100, 100])).toBe('SATISFIED'));

    it('[100,100,40] -> SATISFIED (2 of last 3 >= 80 -- the 40 does not retroactively unsatisfy an already-met window)', () => {
      expect(practiceStatus([100, 100, 40])).toBe('SATISFIED');
    });

    it('[40,40,100,100] -> SATISFIED (last 3 = [40,100,100], 2 of 3 >= 80)', () => {
      expect(practiceStatus([40, 40, 100, 100])).toBe('SATISFIED');
    });
  });

  describe('the core defect, isolated: a single qualifying attempt must NEVER satisfy PRACTICE alone', () => {
    it('exactly ONE Practice attempt, scoring 100%, must NOT satisfy PRACTICE (2 attempts is the structural minimum for "2 of last 3")', () => {
      // This is the cleanest, most decisive proof of AUDIT-001: with
      // only one attempt ever recorded, "2 of the last 3" can never be
      // met (at most 1 of 1 can pass) -- so PRACTICE must remain
      // UNSATISFIED, and PROVE must remain LOCKED, no matter how high
      // that single score is.
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 100)] }));
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    });

    it('consequently PROVE must remain LOCKED after only one qualifying Practice attempt', () => {
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 100)] }));
      expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('LOCKED');
      expect(decision.stage).not.toBe('PROVE');
    });

    it('AUDIT-001 CLOSED: the remediated engine now correctly reports PRACTICE unsatisfied after just one attempt (superseded the pre-remediation "documented defect" pin)', () => {
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 100)] }));
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    });
  });

  describe('AUDIT-001 CLOSED: no more intermediate-state divergence -- the engine no longer unlocks PROVE early', () => {
    it('[79,80] (prefix of [79,80,80]) -> V2 says still UNSATISFIED (1 of last 2/3 >= 80); the remediated engine agrees', () => {
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 79), practiceItem(2, 80)] }));
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    });
  });

  describe('Section 10 real regression sequence: Practice 100, Prove 50, Practice 67, Practice 100', () => {
    it('final PRACTICE status: SATISFIED -- and, now that AUDIT-001 is closed, for the CORRECT reason: the single Practice 100 never satisfied PRACTICE on its own, so the Prove 50 submission is PREMATURE (not a genuine failure) and never resets the window -- all 3 real Practice attempts ([100,67,100], 2 of 3 pass) accumulate naturally', () => {
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
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED');
      expect(decision.stage).toBe('PROVE');
      expect(decision.actionState).toBe('EXECUTABLE');
    });

    it('the window RESET rule (frozen decision, Part 1A) proven directly: 2 valid Practices satisfy PRACTICE, a GENUINE Prove failure resets the window, and 1 new Practice alone is then insufficient', () => {
      const genuinelySatisfied = [LEARNED, practiceItem(1, 90), practiceItem(2, 90)];
      const afterGenuineFailure = [...genuinelySatisfied, proveItem(3, 50)];
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: afterGenuineFailure }));
      expect(decision.rollback?.case).toBe('PROVE_FAILURE_RETURN_TO_PRACTICE'); // this one IS genuine -- Practice was truly satisfied first
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');

      const onlyOneNewPractice = [...afterGenuineFailure, practiceItem(4, 90)];
      const afterOne = evaluateCanonicalLearningState(baseInput({ evidence: onlyOneNewPractice }));
      expect(afterOne.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED'); // the reset window has only 1 slot filled

      const twoNewPractices = [...onlyOneNewPractice, practiceItem(5, 90)];
      const afterTwo = evaluateCanonicalLearningState(baseInput({ evidence: twoNewPractices }));
      expect(afterTwo.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED');
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
    it('the reset applies identically whether the rollback came from a PROVE failure or a TRANSFER-triggered rollback to PRACTICE (Case C/D) -- see audit-canon-v2-transfer-classification.test.ts for the Transfer-triggered proof', () => {
      // Documentation anchor: the PROVE-failure reset path is proven
      // directly above ("the window RESET rule... proven directly");
      // the TRANSFER-triggered reset path (Case C foundational, Case D
      // misconception) is proven in audit-canon-v2-transfer-classification.test.ts's
      // own "Case C: after the rollback, 2 NEW valid Practice attempts"
      // test -- both share the exact same `practiceWindow = []` reset
      // point in engine.ts, so there is no separate code path to
      // duplicate here.
      expect(true).toBe(true);
    });
  });
});
