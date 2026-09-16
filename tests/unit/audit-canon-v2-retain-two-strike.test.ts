/**
 * CANONICAL POLICY V2 -- AUDIT-002 REMEDIATION VERIFICATION.
 *
 * Was: AUDIT-002 (BLOCKER) -- the pre-remediation engine rolled back to
 * PROVE on ANY single Retention failure.
 *
 * Now: a FIRST Retention failure grants an IMMEDIATE second attempt
 * with new questions and no additional 3-day wait; ONLY a SECOND
 * CONSECUTIVE failure rolls back to PROVE (Policy V2 Section 6). These
 * tests assert the CORRECTED behavior end-to-end against the real,
 * unmodified engine. Test-only.
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
const PRACTICE_A = item({ activityType: 'PRACTICE', timestamp: '2025-12-31T00:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 3 });
const PRACTICE_B = item({ activityType: 'PRACTICE', timestamp: '2025-12-31T01:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 3 });

function proveItem(ts: string, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({ activityType: 'PROVE', timestamp: ts, itemCount: 10, correctCount: Math.round((score / 100) * 10), scorePercent: score, difficulty: 3.5, independent: true, ...opts });
}
function retentionItem(ts: string, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({ activityType: 'RETENTION_CHECK', timestamp: ts, itemCount: 10, correctCount: Math.round((score / 100) * 10), scorePercent: score, difficulty: 3.5, independent: true, novel: true, ...opts });
}

const PROVE_QUALIFIED = proveItem('2026-01-01T00:00:00.000Z', 90);
// 3 days after the qualifying Prove -- the earliest eligible Retain moment.
const RETAIN_ELIGIBLE_DAY1 = '2026-01-04T00:00:00.000Z';
const RETAIN_ELIGIBLE_DAY1_LATER = '2026-01-04T01:00:00.000Z';

describe('AUDIT-002 CLOSED: RETAIN two-strike rule -- Policy V2 Section 6', () => {
  it('Retain Attempt 1 FAIL, Retain Attempt 2 PASS (new questions, same day, no wait) -> RETAIN must be SATISFIED and PROVE must remain valid (no rebuild required)', () => {
    const evidence = [
      LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED,
      retentionItem(RETAIN_ELIGIBLE_DAY1, 50), // attempt 1: fail
      retentionItem(RETAIN_ELIGIBLE_DAY1_LATER, 90), // attempt 2: pass, immediately, new items implied by a distinct id
    ];
    const decision = evaluateCanonicalLearningState(baseInput({ evidence }));
    expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('SATISFIED');
    expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
    expect(decision.stage).toBe('TRANSFER');
    expect(decision.rollback).toBeNull();
  });

  it('strike 1 alone never rolls back -- PROVE stays SATISFIED, RETAIN stays immediately EXECUTABLE, no REINFORCE overlay', () => {
    const evidence = [LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED, retentionItem(RETAIN_ELIGIBLE_DAY1, 50)];
    const decision = evaluateCanonicalLearningState(baseInput({ evidence }));
    expect(decision.rollback).toBeNull();
    expect(decision.intervention).toBeNull();
    expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
    expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('UNSATISFIED');
    expect(decision.stage).toBe('RETAIN');
    expect(decision.actionState).toBe('EXECUTABLE');
    // The real 10-item independent Retain contract -- never a 2-3 item
    // Practice-shaped one.
    expect(decision.activityContract?.activityType).toBe('RETENTION_CHECK');
    expect(decision.activityContract?.itemCount).toEqual({ min: 10, max: 10 });
  });

  it('Retain Attempt 1 FAIL, Retain Attempt 2 FAIL (second CONSECUTIVE failure) -> rollback to PROVE', () => {
    const evidence = [
      LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED,
      retentionItem(RETAIN_ELIGIBLE_DAY1, 50),
      retentionItem(RETAIN_ELIGIBLE_DAY1_LATER, 40),
    ];
    const decision = evaluateCanonicalLearningState(baseInput({ evidence }));
    expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('UNSATISFIED');
    expect(decision.stage).toBe('PROVE');
  });

  it('Retain Attempt 1 FAIL, Retain Attempt 2 FAIL, new PROVE PASS -> a NEW 3-day retention window starts from zero (not the old due date)', () => {
    const NEW_PROVE = proveItem('2026-01-10T00:00:00.000Z', 95);
    const evidence = [
      LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED,
      retentionItem(RETAIN_ELIGIBLE_DAY1, 50),
      retentionItem(RETAIN_ELIGIBLE_DAY1_LATER, 40),
      NEW_PROVE,
    ];
    // Immediately after the new Prove (before 3 more days elapse):
    const decisionTooSoon = evaluateCanonicalLearningState(baseInput({ evidence, now: '2026-01-11T00:00:00.000Z' }));
    expect(decisionTooSoon.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('WAITING');
    expect(decisionTooSoon.nextEligibleAt).toBe('2026-01-13T00:00:00.000Z');

    // Exactly 3 days after the NEW Prove:
    const decisionEligible = evaluateCanonicalLearningState(baseInput({ evidence, now: '2026-01-13T00:00:00.000Z' }));
    expect(decisionEligible.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('UNSATISFIED');
  });

  it('a stale, superseded FIRST-failure rollback does not linger in `rollback` once the (current, single-strike) engine has already moved past it', () => {
    // Documents current single-strike rollback-clearing semantics for
    // reference; not itself an AUDIT-002 assertion.
    const evidence = [LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED, retentionItem(RETAIN_ELIGIBLE_DAY1, 90)];
    const decision = evaluateCanonicalLearningState(baseInput({ evidence }));
    expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('SATISFIED');
    expect(decision.rollback).toBeNull();
  });

  describe('Section 18 required RETAIN boundary matrix', () => {
    it('before 3 days -> WAITING with nextEligibleAt', () => {
      const decision = evaluateCanonicalLearningState(
        baseInput({ evidence: [LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED], now: '2026-01-03T23:59:59.000Z' }),
      );
      expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('WAITING');
      expect(decision.actionState).toBe('WAITING');
      expect(decision.waitingReason).toBe('RETENTION_MINIMUM_INTERVAL_NOT_REACHED');
      expect(decision.nextEligibleAt).toBe('2026-01-04T00:00:00.000Z');
    });

    it('exactly 3 days -> eligible (UNSATISFIED, not WAITING)', () => {
      const decision = evaluateCanonicalLearningState(
        baseInput({ evidence: [LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED], now: '2026-01-04T00:00:00.000Z' }),
      );
      expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('UNSATISFIED');
      expect(decision.actionState).toBe('EXECUTABLE');
    });

    it('after 3 days -> eligible', () => {
      const decision = evaluateCanonicalLearningState(
        baseInput({ evidence: [LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED], now: '2026-01-10T00:00:00.000Z' }),
      );
      expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('UNSATISFIED');
    });

    it('a Retain attempt submitted BEFORE the 3-day gate (temporally ineligible) does not qualify even with a passing score, though the window may have reopened by "now"', () => {
      const earlyAttempt = retentionItem('2026-01-02T00:00:00.000Z', 95);
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED, earlyAttempt], now: '2026-02-01T00:00:00.000Z' }));
      expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.nonQualifyingEvidenceIds).toContain(earlyAttempt.id);
      expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.reasonCodes).toContain('TEMPORALLY_INELIGIBLE');
      // "now" (Feb 1) is well past the 3-day gate (Jan 4), so the
      // requirement itself reports UNSATISFIED (a fresh, on-time attempt
      // is still possible), never SATISFIED from the rejected early one.
      expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('UNSATISFIED');
    });

    it('a non-novel Retain attempt (novel: false) never qualifies, regardless of score', () => {
      const decision = evaluateCanonicalLearningState(
        baseInput({ evidence: [LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED, retentionItem(RETAIN_ELIGIBLE_DAY1, 95, { novel: false })] }),
      );
      expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('UNSATISFIED');
    });

    it('Retain1 pass (no need for a second attempt) -> SATISFIED directly', () => {
      const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED, retentionItem(RETAIN_ELIGIBLE_DAY1, 85)] }));
      expect(decision.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('SATISFIED');
    });

    it('a stale earlier Retain failure from a PRIOR (already-rebuilt) Prove cycle must not affect the CURRENT cycle\'s two-strike count: 1 old strike + a NEW Prove + 1 new strike must NOT total "2 consecutive" and roll back', () => {
      const evidence = [
        LEARNED, PRACTICE_A, PRACTICE_B, PROVE_QUALIFIED,
        retentionItem(RETAIN_ELIGIBLE_DAY1, 50), // strike 1 of the OLD cycle
        retentionItem(RETAIN_ELIGIBLE_DAY1_LATER, 40), // strike 2 -- rolls back to PROVE, cycle ends
        item({ activityType: 'PRACTICE', timestamp: '2026-01-05T00:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 3 }),
        item({ activityType: 'PRACTICE', timestamp: '2026-01-05T01:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 3 }),
        proveItem('2026-01-08T00:00:00.000Z', 90), // NEW qualifying Prove -- opens a brand NEW Retain cycle, strike count back to 0
        retentionItem('2026-01-11T00:00:00.000Z', 50), // strike 1 of the NEW cycle only
      ];
      const decision = evaluateCanonicalLearningState(baseInput({ evidence }));
      // A single strike in the NEW cycle must never roll back, regardless
      // of how many strikes an earlier, already-superseded cycle had.
      expect(decision.rollback).toBeNull();
      expect(decision.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
      expect(decision.stage).toBe('RETAIN');
      expect(decision.actionState).toBe('EXECUTABLE');
    });
  });
});
