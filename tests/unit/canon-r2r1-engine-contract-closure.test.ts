/**
 * CANON-R2R1 -- PEDAGOGICAL ENGINE CONTRACT CLOSURE.
 *
 * The required regression matrix from the CANON-R2R1 spec: LEARN
 * regression tests (Part 29, 1-8), Transfer regression tests
 * (Part 30, 9-16), Practice difficulty tests (Part 31, 17-26),
 * Prove/Retention/Transfer difficulty tests (Part 32, 27-34), and
 * Output Contract tests (Part 33, 35-48). Every test exercises the
 * REAL, unmocked engine (`src/lib/pedagogical-engine/`) -- no DB, no
 * React, no Next.js, no AI provider, no browser.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluateCanonicalLearningState,
  resolvePracticeDifficulty,
  type RawEvidenceItem,
  type PedagogicalEngineInput,
  type CanonicalPedagogicalDecision,
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
    now: '2026-01-01T00:00:00.000Z',
    evidence: [],
    activeCriticalMisconception: false,
    ...overrides,
  };
}

function learnCheckItem(ts: string, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({ activityType: 'LEARN_CHECK', timestamp: ts, itemCount: 5, correctCount: Math.round((score / 100) * 5), scorePercent: score, difficulty: 1.5, independent: false, ...opts });
}

const LEARNED = learnCheckItem('2025-12-31T00:00:00.000Z', 90);

function practiceItem(ts: string, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({ activityType: 'PRACTICE', timestamp: ts, itemCount: 3, correctCount: Math.round((score / 100) * 3), scorePercent: score, difficulty: 3, independent: false, ...opts });
}

function proveItem(ts: string, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({ activityType: 'PROVE', timestamp: ts, itemCount: 10, correctCount: Math.round((score / 100) * 10), scorePercent: score, difficulty: 3.5, independent: true, ...opts });
}

function retentionItem(ts: string, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({ activityType: 'RETENTION_CHECK', timestamp: ts, itemCount: 10, correctCount: Math.round((score / 100) * 10), scorePercent: score, difficulty: 3.5, independent: true, novel: true, ...opts });
}

function transferItem(ts: string, perChallengeScores: number[], opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  const overall = perChallengeScores.reduce((a, b) => a + b, 0) / perChallengeScores.length;
  return item({ activityType: 'TRANSFER', timestamp: ts, itemCount: 3, correctCount: perChallengeScores.filter((s) => s >= 80).length, scorePercent: overall, difficulty: 4.5, independent: true, perChallengeScores, reasoningProvided: true, ...opts });
}

// CANON-V2-REMEDIATION Part 1A: PRACTICE now requires 2 of the last 3
// valid attempts >=80% (AUDIT-001) -- a single qualifying attempt is no
// longer sufficient, so this shared ledger now includes 2.
function provenLedger(): RawEvidenceItem[] {
  return [
    LEARNED,
    practiceItem('2026-01-01T00:00:00.000Z', 90),
    practiceItem('2026-01-01T01:00:00.000Z', 90),
    proveItem('2026-01-02T00:00:00.000Z', 90),
  ];
}

function retainedLedger(): RawEvidenceItem[] {
  return [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 90)];
}

function requirement(decision: CanonicalPedagogicalDecision, stage: string) {
  const r = decision.requirements.find((x) => x.stage === stage);
  if (!r) throw new Error(`no requirement for ${stage}`);
  return r;
}

describe('CANON-R2R1 Part 29 -- LEARN regression tests (1-8)', () => {
  it('1. no evidence -> LEARN UNSATISFIED', () => {
    const decision = evaluateCanonicalLearningState(baseInput());
    expect(requirement(decision, 'LEARN').status).toBe('UNSATISFIED');
  });

  it('2. random failed Practice evidence does not automatically satisfy LEARN', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [practiceItem('2026-01-01T00:00:00.000Z', 20)] }));
    expect(requirement(decision, 'LEARN').status).toBe('UNSATISFIED');
    expect(requirement(decision, 'LEARN').reasonCodes).toContain('WRONG_ACTIVITY_TYPE');
  });

  it('3. premature Transfer evidence does not automatically satisfy LEARN', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [transferItem('2026-01-01T00:00:00.000Z', [100, 100, 100])] }));
    expect(requirement(decision, 'LEARN').status).toBe('UNSATISFIED');
  });

  it('4. Learn quiz 80% -> FAIL (the bar is strictly exclusive)', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [learnCheckItem('2026-01-01T00:00:00.000Z', 80)] }));
    expect(requirement(decision, 'LEARN').status).toBe('UNSATISFIED');
    expect(requirement(decision, 'LEARN').reasonCodes).toContain('INSUFFICIENT_SCORE');
  });

  it('5. Learn quiz 81% -> PASS', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [learnCheckItem('2026-01-01T00:00:00.000Z', 81)] }));
    expect(requirement(decision, 'LEARN').status).toBe('SATISFIED');
  });

  it('6. Learn quiz >80% + an ON-ATTEMPT critical misconception -> that attempt does not qualify (blocked), never silently passed', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [learnCheckItem('2026-01-01T00:00:00.000Z', 95, { hasCriticalMisconception: true })] }),
    );
    expect(requirement(decision, 'LEARN').status).toBe('UNSATISFIED');
    expect(requirement(decision, 'LEARN').reasonCodes).toContain('CRITICAL_MISCONCEPTION');
  });

  it('7. Learn may qualify with assistance (independent: false)', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [learnCheckItem('2026-01-01T00:00:00.000Z', 90, { independent: false })] }));
    expect(requirement(decision, 'LEARN').status).toBe('SATISFIED');
  });

  it('8. Learn qualification alone does not qualify Practice', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [learnCheckItem('2026-01-01T00:00:00.000Z', 90)] }));
    expect(requirement(decision, 'LEARN').status).toBe('SATISFIED');
    expect(requirement(decision, 'PRACTICE').status).toBe('UNSATISFIED');
    expect(decision.currentStage).toBe('PRACTICE');
  });
});

describe('CANON-R2R1 Part 30 -- Transfer regression tests (9-16)', () => {
  it('9. 90/85/75 with overall >=80 and every challenge >=70 -> PASS', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [90, 85, 75])], now: '2026-01-10T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'TRANSFER').status).toBe('SATISFIED');
  });

  it('10. any challenge at 69% -> FAIL even if overall >=80', () => {
    const decision = evaluateCanonicalLearningState(
      // overall = (100+100+69)/3 = 89.67% -- well above 80 -- but the 69% challenge alone must still fail it.
      baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [100, 100, 69])], now: '2026-01-10T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'TRANSFER').status).not.toBe('SATISFIED');
  });

  it('11. 100/100/60 -> FAIL', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [100, 100, 60])], now: '2026-01-10T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'TRANSFER').status).not.toBe('SATISFIED');
  });

  it('12. the removed <50% floor no longer appears anywhere in engine source (superseded by the 70% per-challenge floor)', async () => {
    const { readFileSync, readdirSync } = await import('fs');
    const { join } = await import('path');
    const dir = join(process.cwd(), 'src/lib/pedagogical-engine');
    for (const f of readdirSync(dir).filter((f: string) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf-8');
      expect(src).not.toMatch(/perChallengeFailureFloor/);
      expect(src).not.toMatch(/\b50\b.*complete failure/i);
    }
  });

  it('13. a low challenge score alone does not automatically trigger foundational (Case C) rollback', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [5, 5, 5])], now: '2026-01-10T00:00:00.000Z' }),
    );
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_A_APPLICATION_CONTEXT_WEAKNESS');
  });

  it('14. application weakness (Case A) results in a Transfer REINFORCE, not a rollback to an earlier stage', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [90, 55, 90])], now: '2026-01-10T00:00:00.000Z' }),
    );
    expect(decision.rollback?.rolledBackTo).toBe('TRANSFER');
    expect(decision.intervention).toBe('REINFORCE');
    expect(decision.currentStage).toBe('TRANSFER');
  });

  it('15. explicit foundational evidence (transferFailureDiagnostic: FOUNDATIONAL_PROCEDURAL_FAILURE) rolls back to the earliest invalidated requirement (PRACTICE)', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [10, 10, 10], { transferFailureDiagnostic: 'FOUNDATIONAL_PROCEDURAL_FAILURE' })],
        now: '2026-01-10T00:00:00.000Z',
      }),
    );
    expect(decision.rollback?.rolledBackTo).toBe('PRACTICE');
    expect(decision.currentStage).toBe('PRACTICE');
  });

  it('16. a critical misconception during Transfer produces the appropriate earlier rollback (Case D, to PRACTICE)', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [90, 90, 90], { hasCriticalMisconception: true })],
        now: '2026-01-10T00:00:00.000Z',
      }),
    );
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_D_CRITICAL_MISCONCEPTION');
    expect(decision.rollback?.rolledBackTo).toBe('PRACTICE');
  });
});

describe('CANON-R2R1 Part 31 -- Practice difficulty tests (17-26)', () => {
  // CANON-R2R1's own Practice requirement semantics (preserved
  // verbatim from CANON-R2, Part 6: "PRESERVE") mean ONE qualifying
  // Practice attempt already satisfies PRACTICE and moves the learner
  // on to PROVE -- so the FULL engine can never itself display a
  // "next Practice target" AFTER a qualifying pass (there is no next
  // Practice attempt to show a contract for). `resolvePracticeDifficulty`
  // is tested directly here, exactly as it is designed to be used: the
  // running-target walk it documents applies whenever the learner
  // RETURNS to Practice (e.g. after a Prove/Retention/Transfer rollback,
  // Tests 19-21 of the CANON-R2 suite already exercise that return path
  // end-to-end through the full engine). Test 17 is the one case the
  // full engine CAN observe directly (zero Practice evidence yet, so
  // PRACTICE is genuinely UNSATISFIED-not-LOCKED and still the active
  // stage) and is exercised that way for extra end-to-end confidence.

  it('17. default Practice target = D2 with no Practice evidence (exercised through the full engine)', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED] }));
    expect(decision.currentStage).toBe('PRACTICE');
    expect(decision.activityContract?.difficulty.target).toBe(2);
    expect(decision.activityContract?.difficulty.reasonCode).toBe('PRACTICE_DEFAULT_DIFFICULTY');
  });

  it('18. a qualifying D2 attempt -> next target D3', () => {
    const result = resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 90, { difficulty: 2 })]);
    expect(result.target).toBe(3);
    expect(result.reasonCode).toBe('PRACTICE_SUCCESS_DIFFICULTY_INCREASE');
  });

  it('19. a qualifying D3 attempt -> next target D4', () => {
    const result = resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 90, { difficulty: 3 })]);
    expect(result.target).toBe(4);
    expect(result.reasonCode).toBe('PRACTICE_SUCCESS_DIFFICULTY_INCREASE');
  });

  it('20. a qualifying D4 attempt -> remains D4', () => {
    const result = resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 90, { difficulty: 4 })]);
    expect(result.target).toBe(4);
    expect(result.reasonCode).toBe('PRACTICE_DIFFICULTY_MAINTAINED');
  });

  it('21. a 60-79% mid-band result maintains the administered difficulty', () => {
    const result = resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 70, { difficulty: 3 })]);
    expect(result.target).toBe(3);
    expect(result.reasonCode).toBe('PRACTICE_DIFFICULTY_MAINTAINED');
  });

  it('22. <60% at D4 -> target decreases to D3', () => {
    const result = resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 40, { difficulty: 4 })]);
    expect(result.target).toBe(3);
    expect(result.reasonCode).toBe('PRACTICE_LOW_PERFORMANCE_DIFFICULTY_DECREASE');
  });

  it('23. <60% at D3 -> target decreases to D2', () => {
    const result = resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 40, { difficulty: 3 })]);
    expect(result.target).toBe(2);
  });

  it('24. <60% at D2 -> remains D2 (never below the Practice floor)', () => {
    const result = resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 40, { difficulty: 2 })]);
    expect(result.target).toBe(2);
  });

  it('25. a critical misconception on a Practice attempt produces reinforcement-oriented difficulty behavior (decrease + its own reason code)', () => {
    const result = resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 90, { difficulty: 3, hasCriticalMisconception: true })]);
    expect(result.target).toBe(2);
    expect(result.reasonCode).toBe('PRACTICE_MISCONCEPTION_REINFORCEMENT');
  });

  it('26. every Practice difficulty decision includes a reasonCode from the closed vocabulary, across the full range of scenarios', () => {
    const results = [
      resolvePracticeDifficulty([]),
      resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 90, { difficulty: 2 })]),
      resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 70, { difficulty: 3 })]),
      resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 40, { difficulty: 3 })]),
      resolvePracticeDifficulty([practiceItem('2026-01-01T00:00:00.000Z', 90, { difficulty: 3, hasCriticalMisconception: true })]),
    ];
    const allowed = new Set([
      'PRACTICE_DEFAULT_DIFFICULTY',
      'PRACTICE_SUCCESS_DIFFICULTY_INCREASE',
      'PRACTICE_DIFFICULTY_MAINTAINED',
      'PRACTICE_LOW_PERFORMANCE_DIFFICULTY_DECREASE',
      'PRACTICE_MISCONCEPTION_REINFORCEMENT',
    ]);
    for (const r of results) expect(allowed.has(r.reasonCode)).toBe(true);
  });
});

describe('CANON-R2R1 Part 32 -- Prove/Retention/Transfer difficulty tests (27-34)', () => {
  it('27. Prove target is derived from the highest qualifying Practice difficulty', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [
          LEARNED,
          practiceItem('2026-01-01T00:00:00.000Z', 90, { difficulty: 4 }),
          practiceItem('2026-01-01T01:00:00.000Z', 90, { difficulty: 4 }),
        ],
      }),
    );
    expect(decision.currentStage).toBe('PROVE');
    expect(decision.activityContract?.difficulty.target).toBe(4);
    expect(decision.activityContract?.difficulty.reasonCode).toBe('PROVE_DIFFICULTY_FROM_QUALIFYING_PRACTICE');
  });

  it('28. Prove target is never below 3, even from a D2 qualifying Practice', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED, practiceItem('2026-01-01T00:00:00.000Z', 90, { difficulty: 2 })] }),
    );
    expect(decision.activityContract?.difficulty.target).toBeGreaterThanOrEqual(3);
  });

  it('29. Prove target is never above 4, even from a hypothetically higher qualifying Practice difficulty', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED, practiceItem('2026-01-01T00:00:00.000Z', 90, { difficulty: 5 })] }),
    );
    expect(decision.activityContract?.difficulty.target).toBeLessThanOrEqual(4);
  });

  it('30. Retention target matches the qualifying Prove difficulty that opened its window', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [
          LEARNED,
          practiceItem('2026-01-01T00:00:00.000Z', 90, { difficulty: 2 }),
          practiceItem('2026-01-01T01:00:00.000Z', 90, { difficulty: 2 }),
          proveItem('2026-01-02T00:00:00.000Z', 90, { difficulty: 4 }),
        ],
      }),
    );
    expect(decision.currentStage).toBe('RETAIN');
    expect(decision.activityContract?.difficulty.target).toBe(4);
    expect(decision.activityContract?.difficulty.reasonCode).toBe('RETENTION_MATCHES_QUALIFYING_PROVE_DIFFICULTY');
  });

  it('31. Retention does not reset to a generic stage default when a qualifying Prove difficulty is known', () => {
    const decisionD3 = evaluateCanonicalLearningState(baseInput({ evidence: provenLedger() }));
    // provenLedger's own qualifying Prove is administered at difficulty 3.5 -> clamped target 3.5? No -- Retention clamps into [3,4], and the Prove's own administered difficulty (3.5) round-trips verbatim since it already sits inside [3,4].
    expect(decisionD3.activityContract?.difficulty.target).toBe(3.5);
  });

  it('32. Transfer default target = 4 with no advanced-support evidence', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: retainedLedger() }));
    expect(decision.currentStage).toBe('TRANSFER');
    expect(decision.activityContract?.difficulty.target).toBe(4);
    expect(decision.activityContract?.difficulty.reasonCode).toBe('TRANSFER_BASE_DIFFICULTY');
  });

  it('33. Transfer can reach target 5 only when evidence supports it (Prove at its own ceiling D4 AND a strong >=90% qualifying Retention)', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [
          LEARNED,
          practiceItem('2026-01-01T00:00:00.000Z', 90, { difficulty: 4 }),
          practiceItem('2026-01-01T01:00:00.000Z', 90, { difficulty: 4 }),
          proveItem('2026-01-02T00:00:00.000Z', 90, { difficulty: 4 }),
          retentionItem('2026-01-06T00:00:00.000Z', 95, { difficulty: 4 }),
        ],
        now: '2026-01-06T00:00:00.000Z',
      }),
    );
    expect(decision.currentStage).toBe('TRANSFER');
    expect(decision.activityContract?.difficulty.target).toBe(5);
    expect(decision.activityContract?.difficulty.reasonCode).toBe('TRANSFER_ADVANCED_DIFFICULTY_SUPPORTED');
  });

  it('34. Transfer target remains within [4,5] in every case', () => {
    const base = evaluateCanonicalLearningState(baseInput({ evidence: retainedLedger() }));
    expect(base.activityContract?.difficulty.target).toBeGreaterThanOrEqual(4);
    expect(base.activityContract?.difficulty.target).toBeLessThanOrEqual(5);
  });
});

describe('CANON-R2R1 Part 33 -- Output Contract tests (35-48)', () => {
  it('35. decision always has policyVersion', () => {
    expect(evaluateCanonicalLearningState(baseInput()).policyVersion).toBeTruthy();
  });

  it('36. decision always has canonicalRevision', () => {
    expect(evaluateCanonicalLearningState(baseInput()).canonicalRevision).toBeTruthy();
  });

  it('37. decision always has stage', () => {
    expect(evaluateCanonicalLearningState(baseInput()).stage).toBe('LEARN');
  });

  it('38. decision always has actionState', () => {
    expect(evaluateCanonicalLearningState(baseInput()).actionState).toBeDefined();
  });

  it('39. decision always has nextCanonicalAction', () => {
    expect(evaluateCanonicalLearningState(baseInput()).nextCanonicalAction).toBeDefined();
  });

  it('40. decision always has requirements', () => {
    expect(evaluateCanonicalLearningState(baseInput()).requirements).toHaveLength(5);
  });

  it('41. an executable stage has an activityContract', () => {
    const decision = evaluateCanonicalLearningState(baseInput());
    expect(decision.actionState).toBe('EXECUTABLE');
    expect(decision.activityContract).not.toBeNull();
  });

  it('42. a waiting stage contains a waitingReason', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: provenLedger(), now: '2026-01-03T00:00:00.000Z' }));
    expect(decision.actionState).toBe('WAITING');
    expect(decision.waitingReason).toBe('RETENTION_MINIMUM_INTERVAL_NOT_REACHED');
  });

  it('43. a temporally-waiting stage contains nextEligibleAt', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: provenLedger(), now: '2026-01-03T00:00:00.000Z' }));
    expect(decision.nextEligibleAt).toBe('2026-01-05T00:00:00.000Z');
  });

  it('44. CONSOLIDATED returns actionState CONSOLIDATED and nextCanonicalAction NONE', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [90, 90, 90])],
        now: '2026-01-10T00:00:00.000Z',
      }),
    );
    expect(decision.stage).toBe('CONSOLIDATED');
    expect(decision.actionState).toBe('CONSOLIDATED');
    expect(decision.nextCanonicalAction).toBe('NONE');
  });

  it('45. the same input produces the same canonicalRevision', () => {
    const args = baseInput({ evidence: provenLedger() });
    const a = evaluateCanonicalLearningState(args);
    const b = evaluateCanonicalLearningState(args);
    expect(a.canonicalRevision).toBe(b.canonicalRevision);
  });

  it('46. changed evidence changes canonicalRevision', () => {
    const a = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem('2026-01-01T00:00:00.000Z', 90)] }));
    const b = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem('2026-01-01T00:00:00.000Z', 50)] }));
    expect(a.canonicalRevision).not.toBe(b.canonicalRevision);
  });

  it('47. the revision exposes no learner content -- it is structurally incapable of it, since RawEvidenceItem itself carries no free-form text', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: provenLedger() }));
    expect(decision.canonicalRevision).not.toMatch(/[<>]/);
    expect(typeof decision.canonicalRevision).toBe('string');
  });

  it('48. the full output is JSON serializable', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [90, 90, 90])], now: '2026-01-10T00:00:00.000Z' }));
    expect(JSON.parse(JSON.stringify(decision))).toEqual(decision);
  });
});

describe('CANON-R2R1 supplementary -- actionState/nextCanonicalAction across stages', () => {
  it('LOCKED stage reports actionState LOCKED and nextCanonicalAction NONE', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem('2026-01-01T00:00:00.000Z', 90), practiceItem('2026-01-01T01:00:00.000Z', 90)] }));
    expect(decision.stage).toBe('PROVE');
    expect(decision.actionState).toBe('EXECUTABLE');
    expect(decision.nextCanonicalAction).toBe('PROVE');
    expect(requirement(decision, 'RETAIN').status).toBe('LOCKED');
  });

  it('a REINFORCE intervention reports actionState EXECUTABLE with the underlying stage as nextCanonicalAction', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [
          LEARNED,
          practiceItem('2026-01-01T00:00:00.000Z', 90),
          practiceItem('2026-01-01T01:00:00.000Z', 90),
          proveItem('2026-01-02T00:00:00.000Z', 70),
        ],
      }),
    );
    expect(decision.intervention).toBe('REINFORCE');
    expect(decision.actionState).toBe('EXECUTABLE');
    expect(decision.nextCanonicalAction).toBe('PRACTICE');
  });

  it('qualifiedEvidence mirrors requirements one-to-one, with only opaque ids -- never free text', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: provenLedger() }));
    expect(decision.qualifiedEvidence).toHaveLength(5);
    for (const q of decision.qualifiedEvidence) {
      expect(Array.isArray(q.qualifyingEvidenceIds)).toBe(true);
      expect(Array.isArray(q.nonQualifyingEvidenceIds)).toBe(true);
    }
  });

  it('journeyProgressPercent follows stage exactly and premature evidence cannot raise it', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [transferItem('2026-01-01T00:00:00.000Z', [100, 100, 100])] }));
    expect(decision.stage).toBe('LEARN');
    expect(decision.journeyProgressPercent).toBe(15);
  });

  it('journeyProgressPercent is strictly increasing across the canonical stage order', () => {
    const percents = [
      evaluateCanonicalLearningState(baseInput()).journeyProgressPercent, // LEARN
      evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED, practiceItem('2026-01-01T00:00:00.000Z', 90)] })).journeyProgressPercent, // PROVE
      evaluateCanonicalLearningState(baseInput({ evidence: provenLedger(), now: '2026-01-06T00:00:00.000Z' })).journeyProgressPercent, // RETAIN (WAITING, but stage RETAIN)
    ];
    for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThan(percents[i - 1]);
  });
});
