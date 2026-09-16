/**
 * CANONICAL POLICY V2 AUDIT -- AUDIT-ONLY CERTIFICATION TESTS.
 *
 * Asserts the FROZEN Policy V2's 4-way TRANSFER failure classification
 * (Section 7):
 *   A. Application/context weakness  -> stay TRANSFER, immediate retry, no wait.
 *   B. Retention weakness (Prove still valid) -> rollback to RETAIN,
 *      immediate retry, NO 3-day wait.
 *   C. Explicit foundational/procedural failure -> rollback to the
 *      earliest invalidated requirement (normally PRACTICE).
 *   D. Critical misconception -> rollback to the earliest invalidated
 *      requirement.
 *
 * The current engine (`src/lib/pedagogical-engine/types.ts`'s own
 * `RollbackCase` union and `engine.ts`'s Transfer-failure branch)
 * implements only 3 buckets -- CASE_A (application-weak, matches A),
 * CASE_B_FOUNDATIONAL_FAILURE (rolls back to PRACTICE, actually matches
 * policy Case C, not B), and CASE_C_CRITICAL_MISCONCEPTION (matches D).
 * There is NO case that rolls back to RETAIN, and no distinct
 * `RawEvidenceItem` signal exists to even express "retention weakness"
 * as opposed to "foundational failure." AUDIT-003 (BLOCKER). Test-only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateCanonicalLearningState, type RawEvidenceItem, type PedagogicalEngineInput } from '@/lib/pedagogical-engine';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const TYPES_SRC = read('src/lib/pedagogical-engine/types.ts');
const ENGINE_SRC = read('src/lib/pedagogical-engine/engine.ts');

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
const PRACTICE = item({ activityType: 'PRACTICE', timestamp: '2025-12-31T00:00:00.000Z', itemCount: 3, correctCount: 3, scorePercent: 90, difficulty: 3 });
const PROVE = item({ activityType: 'PROVE', timestamp: '2026-01-01T00:00:00.000Z', itemCount: 10, correctCount: 9, scorePercent: 90, difficulty: 3.5, independent: true });
const RETAIN = item({ activityType: 'RETENTION_CHECK', timestamp: '2026-01-10T00:00:00.000Z', itemCount: 10, correctCount: 9, scorePercent: 90, difficulty: 3.5, independent: true, novel: true });
const READY_FOR_TRANSFER = [LEARNED, PRACTICE, PROVE, RETAIN];

function transferItem(ts: string, perChallengeScores: number[], opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  const overall = perChallengeScores.reduce((a, b) => a + b, 0) / perChallengeScores.length;
  return item({ activityType: 'TRANSFER', timestamp: ts, itemCount: 3, correctCount: perChallengeScores.filter((s) => s >= 80).length, scorePercent: overall, difficulty: 4.5, independent: true, perChallengeScores, reasoningProvided: true, ...opts });
}

describe('TRANSFER qualification boundaries (Policy V2 Section 7) -- expected to already PASS', () => {
  it('AMBIGUOUS_SPEC: the policy\'s own worked example ("85 overall, 80/80/75") is internally inconsistent -- the simple arithmetic mean of [80,80,75] is 78.33%, not 85%. Documented, not asserted as a pass/fail.', () => {
    const overall = [80, 80, 75].reduce((a, b) => a + b, 0) / 3;
    expect(overall).toBeCloseTo(78.33, 1);
    // If "overall" means the simple mean of the 3 challenge percentages
    // (which is what the current engine computes and is the only
    // reasonable reading given RawEvidenceItem carries no separate,
    // independently-weighted overall-score input), this specific
    // example would actually FAIL (78.33 < 80), contradicting the
    // policy text's own stated PASS outcome. Product must clarify
    // whether "overall" is a simple mean or a different, item-weighted
    // computation -- see CANONICAL_GAPS_FOR_REMEDIATION.md AUDIT-003-AMBIGUITY.
  });

  it('an internally-consistent equivalent of the same example -- overall 80%, every challenge >=70% -- PASSES today', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [80, 80, 80])] }));
    expect(decision.requirements.find((r) => r.stage === 'TRANSFER')!.status).toBe('SATISFIED');
  });

  it('85 overall, [95,95,60] -> FAIL (one challenge below the 70 floor, despite a strong overall average -- no compensation)', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [95, 95, 60])] }));
    expect(decision.requirements.find((r) => r.stage === 'TRANSFER')!.status).toBe('UNSATISFIED');
  });

  it('70/70/70 -> FAIL (every challenge meets the 70 floor, but the 70% overall average misses the 80% bar -- neither check alone is sufficient)', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [70, 70, 70])] }));
    expect(decision.requirements.find((r) => r.stage === 'TRANSFER')!.status).toBe('UNSATISFIED');
  });
});

describe('AUDIT-003 (BLOCKER): TRANSFER 4-way failure classification -- Policy V2 Section 7', () => {
  it('Case A (application weakness, default/no special signal) -> stays TRANSFER, immediate retry, no 3-day wait -- CORRECTLY implemented today', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [60, 60, 60])] }));
    expect(decision.rollback?.case).toBe('CASE_A_TRANSFER_APPLICATION_WEAK');
    expect(decision.rollback?.rolledBackTo).toBe('TRANSFER');
    expect(decision.stage).toBe('TRANSFER');
    expect(decision.actionState).toBe('EXECUTABLE'); // immediate retry, no wait
  });

  it('Case B (retention weakness, Prove remains valid) -> the engine has NO rollback case that targets RETAIN from a Transfer failure at all', () => {
    // Source-level proof: the closed RollbackCase union has exactly 5
    // members, none of which is a Transfer-triggered rollback to RETAIN.
    const unionMatch = TYPES_SRC.match(/export type RollbackCase =\s*([\s\S]*?);/);
    expect(unionMatch).not.toBeNull();
    const union = unionMatch![1];
    expect(union).toMatch(/CASE_A_TRANSFER_APPLICATION_WEAK/);
    expect(union).toMatch(/CASE_B_FOUNDATIONAL_FAILURE/);
    expect(union).toMatch(/CASE_C_CRITICAL_MISCONCEPTION/);
    // The decisive negative: no case name or rollback target expresses
    // "Transfer failure -> RETAIN".
    expect(union).not.toMatch(/RETAIN/);
    const transferBranch = ENGINE_SRC.slice(ENGINE_SRC.indexOf("if (item.activityType === 'TRANSFER')"), ENGINE_SRC.indexOf("}\n  }\n\n  return {"));
    expect(transferBranch).not.toMatch(/rolledBackTo:\s*'RETAIN'|makeRollback\('TRANSFER',\s*[^,]+,\s*'RETAIN'/);
  });

  it('Case B: no RawEvidenceItem field exists to even express "this Transfer failure indicates retention weakness specifically" (distinct from foundational failure)', () => {
    // Only ONE diagnostic boolean exists on the evidence item:
    // `transferFoundationalFailureIndicated`. There is no sibling flag
    // (e.g. `transferRetentionWeaknessIndicated`) a caller could set to
    // route a Transfer failure to Case B instead of Case A/C.
    expect(TYPES_SRC).toMatch(/transferFoundationalFailureIndicated\?:\s*boolean;/);
    expect(TYPES_SRC).not.toMatch(/transferRetentionWeakness/i);
  });

  it('CURRENT BEHAVIOR (documented defect): a foundational-failure-indicated Transfer failure rolls all the way back to PRACTICE, which is what Policy V2 calls Case C, not Case B -- there is no way to land ONLY on RETAIN', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [40, 40, 40], { transferFoundationalFailureIndicated: true })] }),
    );
    expect(decision.rollback?.case).toBe('CASE_B_FOUNDATIONAL_FAILURE'); // current engine's own (misleadingly-named-vs-policy) case
    expect(decision.rollback?.rolledBackTo).toBe('PRACTICE');
    expect(decision.stage).toBe('PRACTICE');
    // Under Policy V2's OWN Case C wording ("rollback to the earliest
    // invalidated requirement, normally PRACTICE") this end state is
    // actually policy-CORRECT for a genuine foundational failure -- the
    // audit finding is the MISSING distinct Case B (retention-only
    // rollback), not that this particular path is wrong.
  });

  it('Case D (critical misconception) -> rolls back to PRACTICE (the earliest invalidated requirement, per this engine\'s own documented interpretation) -- directionally consistent with policy, PASS', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [40, 40, 40], { hasCriticalMisconception: true })] }),
    );
    // Per evidence-qualification.ts, hasCriticalMisconception is checked
    // BEFORE prerequisite/temporal checks and yields CRITICAL_MISCONCEPTION
    // directly, regardless of the per-challenge scores.
    expect(decision.rollback?.case).toBe('CASE_C_CRITICAL_MISCONCEPTION');
    expect(decision.rollback?.rolledBackTo).toBe('PRACTICE');
  });

  it('a Case A (application-weak, stay-Transfer) rollback -- the one case that does NOT touch Practice/Prove/Retain at all -- correctly leaves PROVE/RETAIN untouched, so no 3-day wait is ever implied', () => {
    const applicationWeak = evaluateCanonicalLearningState(baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [60, 60, 60])] }));
    expect(applicationWeak.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('SATISFIED');
    expect(applicationWeak.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('SATISFIED');
  });

  it('CURRENT BEHAVIOR: a Case C (foundational) rollback invalidates PRACTICE itself, which in turn LOCKS (not merely UNSATISFIES) both PROVE and RETAIN downstream -- a full rebuild is required, consistent with policy\'s own Case C wording', () => {
    const foundational = evaluateCanonicalLearningState(
      baseInput({ evidence: [...READY_FOR_TRANSFER, transferItem('2026-01-13T00:00:00.000Z', [40, 40, 40], { transferFoundationalFailureIndicated: true })] }),
    );
    expect(foundational.requirements.find((r) => r.stage === 'PRACTICE')!.status).toBe('UNSATISFIED');
    expect(foundational.requirements.find((r) => r.stage === 'PROVE')!.status).toBe('LOCKED');
    expect(foundational.requirements.find((r) => r.stage === 'RETAIN')!.status).toBe('LOCKED');
  });
});
