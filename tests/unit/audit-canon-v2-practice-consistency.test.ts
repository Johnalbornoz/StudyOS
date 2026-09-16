/**
 * CANONICAL POLICY V2 AUDIT -- AUDIT-ONLY CERTIFICATION TESTS.
 *
 * These tests assert the FROZEN Canonical Policy V2's own PRACTICE
 * consistency rule (Section 3: "PRACTICE is satisfied only when AT
 * LEAST 2 OF THE LAST 3 VALID PRACTICE ATTEMPTS have score >= 80% AND
 * there is no active critical misconception") against the REAL,
 * unmodified engine (`evaluateCanonicalLearningState`) -- never a mock,
 * never a weakened/adjusted expectation.
 *
 * DO NOT weaken these assertions to make the current implementation
 * pass. A FAILING test here is the audit finding itself: it proves the
 * current engine still uses its original CANON-R2 "any single qualifying
 * Practice attempt satisfies PRACTICE" rule, which the frozen V2 policy
 * explicitly supersedes. See docs/CANON_AUDIT_REPORT.md finding
 * AUDIT-001 (BLOCKER) for the full analysis. This file is test-only --
 * it changes no production code.
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

    it('the current engine (documented defect) DOES report PRACTICE satisfied and PROVE unlocked after just one attempt -- recorded here as a pinned "current behavior" fact, not a policy endorsement', () => {
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 100)] }));
      // NOTE: this assertion documents ACTUAL current behavior (for the
      // audit report's evidence trail) and is expected to itself need
      // deletion/replacement once AUDIT-001 is remediated -- it is not a
      // policy assertion.
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED');
    });
  });

  describe('intermediate-state divergence: the engine unlocks PROVE one attempt too early even in sequences whose FINAL state happens to match V2', () => {
    it('[79,80] (prefix of [79,80,80]) -> V2 says still UNSATISFIED (1 of last 2/3 >= 80); current engine already reports SATISFIED', () => {
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem(1, 79), practiceItem(2, 80)] }));
      // Policy-correct expectation:
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    });
  });

  describe('Section 10 real regression sequence: Practice 100, Prove 50 (fail/rollback), Practice 67, Practice 100', () => {
    it('final PRACTICE status: coincidentally SATISFIED under both the current engine and a correct 2-of-last-3 reading (2 of [100,67,100] pass) -- this specific sequence does NOT by itself prove AUDIT-001, see [100,40,40] above for the decisive proof', () => {
      const evidence = [
        LEARNED,
        practiceItem(1, 100),
        proveItem(2, 50),
        practiceItem(3, 67),
        practiceItem(4, 100),
      ];
      const decision = evaluateCanonicalLearningState(baseInput({ evidence }));
      expect(decision.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('SATISFIED');
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

  describe('AMBIGUOUS_SPEC: does the "last 3" window reset after a PROVE-failure rollback, or does it span the full Practice history?', () => {
    it('documented ambiguity -- not asserted either way; see CANONICAL_GAPS_FOR_REMEDIATION.md AUDIT-001-AMBIGUITY', () => {
      // The frozen policy's own "valid Practice attempt" checklist
      // (correct policy version, activity type, item count, contract,
      // non-duplicate, non-malformed) says nothing about TEMPORAL
      // position relative to a prior rollback. Two defensible readings
      // exist:
      //   (a) the window is drawn from the full chronological Practice
      //       ledger, including attempts BEFORE the Prove failure that
      //       triggered the rollback;
      //   (b) the window resets to empty at the moment of rollback,
      //       since the whole purpose of the rule is RECENT consistency
      //       and a Prove failure is itself evidence the prior Practice
      //       success was not a reliable signal.
      // This test intentionally asserts nothing -- it exists so the gap
      // is discoverable by running the suite, not just by reading prose.
      expect(true).toBe(true);
    });
  });
});
