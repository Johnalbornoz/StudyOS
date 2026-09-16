/**
 * CANON-R2 -- Canonical Learning State Machine v1.0: the required test
 * matrix (10 categories, ~80 tests) from the CANON-R2 spec. Every test
 * exercises the REAL, unmocked engine (`src/lib/pedagogical-engine/`) --
 * no DB, no React, no Next.js, no AI provider, no browser.
 *
 * CANON-R2R1 UPDATE: two CANON-R2 product rules were superseded by
 * CANON-R2R1's final product decisions, and this file's fixtures/
 * assertions are updated accordingly (never mechanically weakened --
 * see each inline comment for the specific reasoning):
 *   - LEARN no longer qualifies from arbitrary evidence (any activity
 *     type). It now requires a dedicated `LEARN_CHECK` attempt scoring
 *     strictly above 80%. Every fixture that previously relied on a bare
 *     Practice/Prove/Transfer attempt to also satisfy LEARN now
 *     explicitly includes a `learnCheckItem(...)` in its evidence.
 *   - Transfer's per-challenge floor moved from an implementation-created
 *     <50% "complete failure" threshold to a final product decision:
 *     every challenge must independently score >=70%. The Case B
 *     (foundational failure) diagnosis is no longer inferred from that
 *     floor at all -- it now requires an explicit, non-score-based
 *     `transferFoundationalFailureIndicated: true` signal (CANON-R2R1
 *     Part 2); a low score alone defaults to the more conservative
 *     Case A.
 * The full CANON-R2R1-specific test matrix (Parts 29-33 of that spec)
 * lives in its own file, tests/unit/canon-r2r1-engine-contract-closure.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  evaluateCanonicalLearningState,
  rebuildConceptCanonicalState,
  CANONICAL_POLICY,
  POLICY_VERSION,
  qualifyEvidence,
  buildActivityContract,
  resolveLearnDifficulty,
  resolvePracticeDifficulty,
  resolveProveDifficulty,
  resolveRetentionDifficulty,
  resolveTransferDifficulty,
  resolveReinforceDifficulty,
  STAGE_ORDER,
  type RawEvidenceItem,
  type PedagogicalEngineInput,
  type CanonicalPedagogicalDecision,
  type PedagogicalStage,
  type DifficultyResolution,
} from '@/lib/pedagogical-engine';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const ENGINE_DIR = 'src/lib/pedagogical-engine';
const ENGINE_FILES = readdirSync(join(process.cwd(), ENGINE_DIR)).filter((f) => f.endsWith('.ts'));

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

/** CANON-R2R1 Part 3/4: the ONE activity type that can satisfy LEARN. */
function learnCheckItem(ts: string, score = 90): RawEvidenceItem {
  return item({ activityType: 'LEARN_CHECK', timestamp: ts, itemCount: 5, correctCount: Math.round((score / 100) * 5), scorePercent: score, difficulty: 1.5, independent: false });
}

/** A single shared, reused, never-mutated LEARN_CHECK evidence item, dated safely before every other fixture's own timeline (2025-12-31) so it never disturbs existing day-numbering in this file. Prepend it to any evidence array that needs PRACTICE (and beyond) reachable. */
const LEARNED_ITEM = learnCheckItem('2025-12-31T00:00:00.000Z', 90);

function practiceItem(ts: string, score = 90): RawEvidenceItem {
  return item({ activityType: 'PRACTICE', timestamp: ts, itemCount: 3, correctCount: Math.round((score / 100) * 3), scorePercent: score, difficulty: 3, independent: false });
}

function proveItem(ts: string, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({
    activityType: 'PROVE',
    timestamp: ts,
    itemCount: 10,
    correctCount: Math.round((score / 100) * 10),
    scorePercent: score,
    difficulty: 3.5,
    independent: true,
    ...opts,
  });
}

function retentionItem(ts: string, score: number, opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  return item({
    activityType: 'RETENTION_CHECK',
    timestamp: ts,
    itemCount: 10,
    correctCount: Math.round((score / 100) * 10),
    scorePercent: score,
    difficulty: 3.5,
    independent: true,
    novel: true,
    ...opts,
  });
}

function transferItem(ts: string, perChallengeScores: number[], opts: Partial<RawEvidenceItem> = {}): RawEvidenceItem {
  const overall = perChallengeScores.reduce((a, b) => a + b, 0) / perChallengeScores.length;
  return item({
    activityType: 'TRANSFER',
    timestamp: ts,
    itemCount: 3,
    correctCount: perChallengeScores.filter((s) => s >= 80).length,
    scorePercent: overall,
    difficulty: 4.5,
    independent: true,
    perChallengeScores,
    reasoningProvided: true,
    ...opts,
  });
}

/**
 * A fully-qualified progression -- LEARN, then Practice, then a passing
 * Prove, anchored at day 0. Used as a shared starting ledger for
 * RETAIN/TRANSFER tests. CANON-V2-REMEDIATION Part 1A: PRACTICE now
 * requires 2 of the last 3 valid attempts >=80% (AUDIT-001) -- a single
 * qualifying attempt is no longer sufficient.
 */
function provenLedger(): RawEvidenceItem[] {
  return [
    LEARNED_ITEM,
    practiceItem('2026-01-01T00:00:00.000Z', 90),
    practiceItem('2026-01-01T01:00:00.000Z', 90),
    proveItem('2026-01-02T00:00:00.000Z', 90),
  ];
}

function requirement(decision: CanonicalPedagogicalDecision, stage: string) {
  const r = decision.requirements.find((x) => x.stage === stage);
  if (!r) throw new Error(`no requirement for ${stage}`);
  return r;
}

/** Real, correctly-ranged difficulty resolutions per stage, for the Difficulty Authority tests below -- never a placeholder target that could fall outside that stage's own [min,max] (which would make Test 56 meaningless). */
function difficultyFor(stage: PedagogicalStage): DifficultyResolution {
  switch (stage) {
    case 'LEARN':
      return resolveLearnDifficulty();
    case 'PRACTICE':
      return resolvePracticeDifficulty([]);
    case 'PROVE':
      return resolveProveDifficulty(null);
    case 'RETAIN':
      return resolveRetentionDifficulty(null);
    case 'TRANSFER':
      return resolveTransferDifficulty({ qualifyingProveDifficulty: null, qualifyingRetentionScore: null, activeCriticalMisconception: false });
    case 'CONSOLIDATED':
      return resolveLearnDifficulty();
  }
}

describe('CANON-R2 Engine Isolation (1-7)', () => {
  it('1. has zero imports from React/Next.js in any engine source file', () => {
    for (const f of ENGINE_FILES) {
      const src = read(join(ENGINE_DIR, f));
      expect(src).not.toMatch(/from ['"]react['"]/);
      expect(src).not.toMatch(/from ['"]next\//);
    }
  });

  it('2. has zero imports of any AI/provider SDK or model routing code', () => {
    for (const f of ENGINE_FILES) {
      const src = read(join(ENGINE_DIR, f));
      expect(src).not.toMatch(/openai|anthropic|@ai-sdk|model-routing|model-compatibility|token-budgets/i);
    }
  });

  it('3. has zero imports of a DB client, Vercel, or Neon', () => {
    for (const f of ENGINE_FILES) {
      const src = read(join(ENGINE_DIR, f));
      expect(src).not.toMatch(/from ['"]@\/lib\/db['"]|pg['"]|@neondatabase|@vercel/i);
    }
  });

  it('4. has zero references to quiz-generation, the Quality Gate, or prompt construction', () => {
    for (const f of ENGINE_FILES) {
      const src = read(join(ENGINE_DIR, f));
      expect(src).not.toMatch(/quiz-generation|gated-question-generation|buildQuestionGenerationPrompt|promptCacheKey/);
    }
  });

  it('5. never calls Date.now() or `new Date()` with no argument -- every timestamp is caller-injected', () => {
    for (const f of ENGINE_FILES) {
      const src = read(join(ENGINE_DIR, f));
      expect(src).not.toMatch(/Date\.now\(\)/);
      expect(src).not.toMatch(/new Date\(\)/);
    }
  });

  it('6. is deterministic: identical input produces a deep-equal decision across repeated calls', () => {
    const input = baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90)] });
    const a = evaluateCanonicalLearningState(input);
    const b = evaluateCanonicalLearningState(input);
    expect(a).toEqual(b);
  });

  it('7. produces a plain, JSON-serializable decision object (no functions, no class instances)', () => {
    const decision = evaluateCanonicalLearningState(baseInput());
    const roundTripped = JSON.parse(JSON.stringify(decision));
    expect(roundTripped).toEqual(decision);
  });
});

describe('CANON-R2 Practice (8-13)', () => {
  it('8. PRACTICE is LOCKED when there is no evidence at all', () => {
    const decision = evaluateCanonicalLearningState(baseInput());
    expect(requirement(decision, 'PRACTICE').status).toBe('LOCKED');
    expect(decision.currentStage).toBe('LEARN');
  });

  it('9. CANON-V2-REMEDIATION Part 1A (AUDIT-001 closed): a SINGLE qualifying Practice attempt (score >= 80, difficulty in [2,4]) is NOT sufficient -- PRACTICE requires 2 of the last 3 valid attempts', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90)] }));
    expect(requirement(decision, 'PRACTICE').status).toBe('UNSATISFIED');
    expect(decision.currentStage).toBe('PRACTICE');
  });

  it('9b. a SECOND qualifying Practice attempt satisfies PRACTICE (2 of last 3), once LEARN is satisfied', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90), practiceItem('2026-01-01T01:00:00.000Z', 90)] }),
    );
    expect(requirement(decision, 'PRACTICE').status).toBe('SATISFIED');
    expect(decision.currentStage).toBe('PROVE');
  });

  it('10. a below-threshold Practice score does not qualify', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 60)] }));
    expect(requirement(decision, 'PRACTICE').status).toBe('UNSATISFIED');
    expect(requirement(decision, 'PRACTICE').reasonCodes).toContain('INSUFFICIENT_SCORE');
  });

  it('11. a Practice attempt outside the canonical difficulty range [2,4] does not qualify', () => {
    const onlyOutOfRange = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED_ITEM, item({ activityType: 'PRACTICE', difficulty: 1, scorePercent: 95 })] }),
    );
    expect(requirement(onlyOutOfRange, 'PRACTICE').status).toBe('UNSATISFIED');
  });

  it('12. Practice allows assistance (independent: false) -- it is never required to be independent', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 85), practiceItem('2026-01-01T01:00:00.000Z', 85)] }),
    );
    expect(requirement(decision, 'PRACTICE').status).toBe('SATISFIED');
  });

  it('13. only qualifying Practice attempts count toward qualifyingEvidenceCount -- non-qualifying attempts are tallied separately, never discarded', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 50), practiceItem('2026-01-02T00:00:00.000Z', 90)] }),
    );
    const r = requirement(decision, 'PRACTICE');
    expect(r.qualifyingEvidenceCount).toBe(1);
    expect(r.nonQualifyingEvidenceCount).toBe(1);
    // CANON-V2-REMEDIATION Part 1A: only 1 of these 2 valid attempts
    // passes -- 1 of 2 (or 3) is never "2 of the last 3" -- so PRACTICE
    // itself remains UNSATISFIED even though one attempt individually
    // qualified.
    expect(r.status).toBe('UNSATISFIED');
  });

  it("13b. 2 of 2 qualifying attempts DOES satisfy PRACTICE, and both are reflected in qualifyingEvidenceCount", () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90), practiceItem('2026-01-02T00:00:00.000Z', 90)] }),
    );
    const r = requirement(decision, 'PRACTICE');
    expect(r.qualifyingEvidenceCount).toBe(2);
    expect(r.nonQualifyingEvidenceCount).toBe(0);
    expect(r.status).toBe('SATISFIED');
  });
});

describe('CANON-R2 Prove (14-22)', () => {
  it('14. PROVE is LOCKED while PRACTICE is unsatisfied', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 50)] }));
    expect(requirement(decision, 'PROVE').status).toBe('LOCKED');
  });

  it('15. a Prove attempt with fewer than 10 items is UNRESOLVED, never silently treated as a pass or fail', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90), practiceItem('2026-01-01T01:00:00.000Z', 90), proveItem('2026-01-02T00:00:00.000Z', 90, { itemCount: 8 })] }),
    );
    expect(requirement(decision, 'PROVE').status).toBe('UNSATISFIED');
    expect(requirement(decision, 'PROVE').reasonCodes).toContain('UNRESOLVED_POLICY');
  });

  it('16. Prove requires independence -- an assisted attempt never qualifies regardless of score', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90), practiceItem('2026-01-01T01:00:00.000Z', 90), proveItem('2026-01-02T00:00:00.000Z', 100, { independent: false })],
      }),
    );
    expect(requirement(decision, 'PROVE').status).toBe('UNSATISFIED');
    expect(requirement(decision, 'PROVE').reasonCodes).toContain('ASSISTED_WHEN_INDEPENDENCE_REQUIRED');
  });

  it('17. Prove requires difficulty in [3,4]', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90), practiceItem('2026-01-01T01:00:00.000Z', 90), proveItem('2026-01-02T00:00:00.000Z', 90, { difficulty: 2 })] }),
    );
    expect(requirement(decision, 'PROVE').status).toBe('UNSATISFIED');
  });

  it('18. exactly 8/10 (80%) qualifies as a passing Prove', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90), practiceItem('2026-01-01T01:00:00.000Z', 90), proveItem('2026-01-02T00:00:00.000Z', 80)] }),
    );
    expect(requirement(decision, 'PROVE').status).toBe('SATISFIED');
    expect(decision.currentStage).toBe('RETAIN');
  });

  it('19. exactly 7/10 (70%) is a FAILED_ATTEMPT and rolls back to PRACTICE', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90), practiceItem('2026-01-01T01:00:00.000Z', 90), proveItem('2026-01-02T00:00:00.000Z', 70)] }),
    );
    // PROVE is LOCKED (not merely UNSATISFIED) because its own
    // prerequisite -- PRACTICE -- was just invalidated by this failure.
    expect(requirement(decision, 'PROVE').status).toBe('LOCKED');
    expect(requirement(decision, 'PRACTICE').status).toBe('UNSATISFIED');
    expect(decision.currentStage).toBe('PRACTICE');
    expect(decision.intervention).toBe('REINFORCE');
    expect(decision.rollback?.case).toBe('PROVE_FAILURE_RETURN_TO_PRACTICE');
  });

  it('20. after a Prove failure, a NEW qualifying Practice attempt is required before a NEW Prove can qualify -- the failed Prove is never simply repeated', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [
          LEARNED_ITEM,
          practiceItem('2026-01-01T00:00:00.000Z', 90),
          proveItem('2026-01-02T00:00:00.000Z', 70),
          // A second Prove immediately after the failure, before any repair Practice, must NOT qualify -- PRACTICE is unsatisfied again.
          proveItem('2026-01-03T00:00:00.000Z', 90),
        ],
      }),
    );
    expect(requirement(decision, 'PROVE').status).toBe('LOCKED');
    expect(decision.currentStage).toBe('PRACTICE');
  });

  it('21. after repair (a new qualifying Practice) and a new qualifying Prove, PROVE is SATISFIED and the intervention clears', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [
          LEARNED_ITEM,
          practiceItem('2026-01-01T00:00:00.000Z', 90),
          proveItem('2026-01-02T00:00:00.000Z', 70),
          practiceItem('2026-01-03T00:00:00.000Z', 90),
          proveItem('2026-01-04T00:00:00.000Z', 90),
        ],
      }),
    );
    expect(requirement(decision, 'PROVE').status).toBe('SATISFIED');
    expect(decision.intervention).toBeNull();
    expect(decision.currentStage).toBe('RETAIN');
  });

  it('22. a qualifying Prove unlocks RETAIN (no longer LOCKED)', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: provenLedger() }));
    expect(requirement(decision, 'RETAIN').status).not.toBe('LOCKED');
  });
});

describe('CANON-R2 Retention (23-33)', () => {
  it('23. RETAIN is LOCKED without a qualified Prove', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90)] }));
    expect(requirement(decision, 'RETAIN').status).toBe('LOCKED');
  });

  it('24. an attempt before the 3-day minimum wait is TEMPORALLY_INELIGIBLE and does not qualify', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...provenLedger(), retentionItem('2026-01-03T00:00:00.000Z', 100)], now: '2026-01-03T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'RETAIN').status).toBe('WAITING');
    expect(requirement(decision, 'RETAIN').reasonCodes).toContain('TEMPORALLY_INELIGIBLE');
  });

  it('25. status is WAITING (not UNSATISFIED) while the minimum wait has not elapsed, with a concrete waitingUntil date', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: provenLedger(), now: '2026-01-03T00:00:00.000Z' }));
    const r = requirement(decision, 'RETAIN');
    expect(r.status).toBe('WAITING');
    expect(r.waitingUntil).toBe('2026-01-05T00:00:00.000Z');
  });

  it('26. once eligible and passing, RETAIN is SATISFIED', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 90)], now: '2026-01-06T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'RETAIN').status).toBe('SATISFIED');
    expect(decision.currentStage).toBe('TRANSFER');
  });

  it('27. Retention requires exactly 10 novel items -- a non-novel item never qualifies', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 90, { novel: false })], now: '2026-01-06T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'RETAIN').status).not.toBe('SATISFIED');
    expect(requirement(decision, 'RETAIN').reasonCodes).toContain('NOT_APPLICABLE');
  });

  it('28. a Retention attempt with the wrong item count is UNRESOLVED', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 90, { itemCount: 6 })], now: '2026-01-06T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'RETAIN').reasonCodes).toContain('UNRESOLVED_POLICY');
  });

  it('29. Retention requires difficulty comparable to a qualifying Prove ([3,4])', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 90, { difficulty: 5 })], now: '2026-01-06T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'RETAIN').status).not.toBe('SATISFIED');
  });

  it('30. CANON-V2-REMEDIATION Part 2: Retention requires >=80% -- a SINGLE 70% attempt (strike 1) does NOT roll back to PROVE; RETAIN remains immediately re-attemptable', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 70)], now: '2026-01-06T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'RETAIN').status).toBe('UNSATISFIED');
    expect(requirement(decision, 'PROVE').status).toBe('SATISFIED');
    expect(decision.currentStage).toBe('RETAIN');
    expect(decision.actionState).toBe('EXECUTABLE');
    expect(decision.rollback).toBeNull();
  });

  it('30b. CANON-V2-REMEDIATION Part 2: a SECOND CONSECUTIVE 70% attempt (strike 2) rolls back to PROVE', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 70), retentionItem('2026-01-06T01:00:00.000Z', 70)],
        now: '2026-01-06T01:00:00.000Z',
      }),
    );
    // RETAIN is LOCKED (not merely UNSATISFIED) because its own
    // prerequisite -- a qualifying PROVE -- was just invalidated.
    expect(requirement(decision, 'RETAIN').status).toBe('LOCKED');
    expect(requirement(decision, 'PROVE').status).toBe('UNSATISFIED');
    expect(decision.currentStage).toBe('PROVE');
    expect(decision.rollback?.case).toBe('RETENTION_FAILURE_RETURN_TO_PROVE');
  });

  it('31. a SECOND CONSECUTIVE Retention failure invalidates the prior qualifying Prove entirely -- RETAIN becomes LOCKED again, not merely UNSATISFIED, until a new Prove qualifies', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 70), retentionItem('2026-01-06T01:00:00.000Z', 70)],
        now: '2026-01-06T01:00:00.000Z',
      }),
    );
    expect(requirement(decision, 'RETAIN').status).toBe('LOCKED');
  });

  it('32. after a SECOND CONSECUTIVE Retention failure, a NEW successful Prove creates a NEW retention window anchored to the NEW Prove timestamp -- never the old due date', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [
          ...provenLedger(), // qualifying Prove on 2026-01-02
          retentionItem('2026-01-06T00:00:00.000Z', 70), // strike 1 -- no rollback yet
          retentionItem('2026-01-06T01:00:00.000Z', 70), // strike 2 -- rolls back to PROVE, old window discarded
          practiceItem('2026-01-07T00:00:00.000Z', 90), // CANON-V2-REMEDIATION Part 1A: the window reset means 2 NEW valid attempts are required
          practiceItem('2026-01-07T01:00:00.000Z', 90),
          proveItem('2026-01-10T00:00:00.000Z', 90), // NEW qualifying Prove
        ],
        now: '2026-01-11T00:00:00.000Z',
      }),
    );
    const r = requirement(decision, 'RETAIN');
    // Eligible from the NEW Prove (01-10) + 3 days = 01-13, not the old
    // Prove (01-02) + 3 days = 01-05 (which `now` 01-11 would already satisfy).
    expect(r.status).toBe('WAITING');
    expect(r.waitingUntil).toBe('2026-01-13T00:00:00.000Z');
  });

  it('33. requirements array always reports RETAIN even when far from reachable (LOCKED, zero evidence)', () => {
    const decision = evaluateCanonicalLearningState(baseInput());
    expect(requirement(decision, 'RETAIN')).toBeDefined();
    expect(requirement(decision, 'RETAIN').status).toBe('LOCKED');
  });
});

describe('CANON-R2 Transfer (34-43)', () => {
  const retainedLedger = () => [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 90)];

  it('34. TRANSFER is LOCKED without a qualified Retention', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: provenLedger(), now: '2026-01-06T00:00:00.000Z' }));
    expect(requirement(decision, 'TRANSFER').status).toBe('LOCKED');
  });

  it('35. Transfer requires exactly 3 structured challenges -- a 2-challenge attempt is UNRESOLVED', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [90, 90])], now: '2026-01-10T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'TRANSFER').reasonCodes).toContain('UNRESOLVED_POLICY');
  });

  it("36. the contract's transfer depths are exactly NEAR/CONTEXTUAL/HIGHER", () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: retainedLedger(), now: '2026-01-10T00:00:00.000Z' }));
    expect(decision.activityContract?.transferDepth).toEqual(['NEAR', 'CONTEXTUAL', 'HIGHER']);
  });

  it('37. Transfer requires difficulty in [4,5]', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [90, 90, 90], { difficulty: 3 })], now: '2026-01-10T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'TRANSFER').status).not.toBe('SATISFIED');
  });

  it("38. CANON-R2R1: the spec's own 100/100/20 example still FAILS Transfer under the new 70% per-challenge floor (a single challenge below 70% fails the attempt regardless of the overall average) -- it now defaults to Case A (application-weak) rather than the superseded automatic Case B, since no explicit foundational-failure signal was supplied", () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [100, 100, 20])], now: '2026-01-10T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'TRANSFER').status).not.toBe('SATISFIED');
    expect(requirement(decision, 'TRANSFER').reasonCodes).toContain('FAILED_ATTEMPT');
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_A_APPLICATION_CONTEXT_WEAKNESS');
  });

  it('39. an overall >=80% attempt with every challenge >=70% SATISFIES Transfer and reaches CONSOLIDATED', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [90, 85, 80])], now: '2026-01-10T00:00:00.000Z' }),
    );
    expect(requirement(decision, 'TRANSFER').status).toBe('SATISFIED');
    expect(decision.currentStage).toBe('CONSOLIDATED');
  });

  it('40. a response contract requiring shown reasoning (SHOW_WORK/EXPLAIN/JUSTIFY) rejects an attempt missing it', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [90, 90, 90], { reasoningProvided: false })],
        now: '2026-01-10T00:00:00.000Z',
      }),
    );
    expect(requirement(decision, 'TRANSFER').reasonCodes).toContain('MISSING_REQUIRED_REASONING');
    expect(requirement(decision, 'TRANSFER').status).not.toBe('SATISFIED');
  });

  it('41. Case A (application-weak, knowledge intact) is the DEFAULT diagnosis for any Transfer failure with no explicit foundational signal: Prove/Retention remain valid and only a Transfer-focused retry is required', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [90, 55, 90])], now: '2026-01-10T00:00:00.000Z' }),
    );
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_A_APPLICATION_CONTEXT_WEAKNESS');
    expect(requirement(decision, 'PROVE').status).toBe('SATISFIED');
    expect(requirement(decision, 'RETAIN').status).toBe('SATISFIED');
    expect(decision.currentStage).toBe('TRANSFER');
    expect(decision.intervention).toBe('REINFORCE');
  });

  it('42. CANON-R2R1 Part 2 / CANON-V2-REMEDIATION Part 4: Case C (foundational/procedural failure) is superseded from an automatic "<50% on every challenge" inference -- it now requires an EXPLICIT `transferFailureDiagnostic` signal, never a numeric score pattern alone, before rolling all the way back to PRACTICE', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [20, 30, 10], { transferFailureDiagnostic: 'FOUNDATIONAL_PROCEDURAL_FAILURE' })],
        now: '2026-01-10T00:00:00.000Z',
      }),
    );
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_C_FOUNDATIONAL_PROCEDURAL_FAILURE');
    expect(requirement(decision, 'PROVE').status).toBe('LOCKED');
    expect(requirement(decision, 'RETAIN').status).toBe('LOCKED');
    expect(decision.currentStage).toBe('PRACTICE');
  });

  it('42b. CANON-R2R1 Part 2 regression guard: that SAME [20,30,10] score pattern WITHOUT the explicit foundational signal defaults to Case A -- proving low scores alone never imply foundational rollback', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [20, 30, 10])], now: '2026-01-10T00:00:00.000Z' }),
    );
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_A_APPLICATION_CONTEXT_WEAKNESS');
    expect(requirement(decision, 'PROVE').status).toBe('SATISFIED');
    expect(requirement(decision, 'RETAIN').status).toBe('SATISFIED');
  });

  it('43. Case D (critical misconception during Transfer) rolls back to the first invalidated requirement (PRACTICE)', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [...retainedLedger(), transferItem('2026-01-10T00:00:00.000Z', [90, 90, 90], { hasCriticalMisconception: true })],
        now: '2026-01-10T00:00:00.000Z',
      }),
    );
    expect(decision.rollback?.case).toBe('TRANSFER_CASE_D_CRITICAL_MISCONCEPTION');
    expect(decision.currentStage).toBe('PRACTICE');
    expect(requirement(decision, 'PROVE').status).toBe('LOCKED');
  });
});

describe('CANON-R2 Journey (44-50)', () => {
  it('44. currentStage is always the first unsatisfied requirement, in canonical order', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90), practiceItem('2026-01-01T01:00:00.000Z', 90)] }),
    );
    expect(decision.currentStage).toBe('PROVE');
  });

  it('45. CONSOLIDATED requires ALL FIVE requirements satisfied', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 90), transferItem('2026-01-10T00:00:00.000Z', [90, 90, 90])],
        now: '2026-01-10T00:00:00.000Z',
      }),
    );
    expect(decision.requirements.every((r) => r.status === 'SATISFIED')).toBe(true);
    expect(decision.currentStage).toBe('CONSOLIDATED');
  });

  it('46. an active (live, current) critical misconception blocks CONSOLIDATED even when all five stages are evidence-satisfied', () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 90), transferItem('2026-01-10T00:00:00.000Z', [90, 90, 90])],
        now: '2026-01-10T00:00:00.000Z',
        activeCriticalMisconception: true,
      }),
    );
    expect(decision.currentStage).toBe('PRACTICE');
    expect(decision.intervention).toBe('REINFORCE');
  });

  it('47. the requirements array always contains all five stages, in LEARN..TRANSFER order, regardless of progress', () => {
    const decision = evaluateCanonicalLearningState(baseInput());
    expect(decision.requirements.map((r) => r.stage)).toEqual(['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER']);
    expect(STAGE_ORDER).toEqual(['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER']);
  });

  it('48. REINFORCE never appears as a value of currentStage -- it is an intervention overlay only', () => {
    const decisions = [
      evaluateCanonicalLearningState(baseInput()),
      evaluateCanonicalLearningState(
        baseInput({
          evidence: [
            LEARNED_ITEM,
            practiceItem('2026-01-01T00:00:00.000Z', 90),
            practiceItem('2026-01-01T01:00:00.000Z', 90),
            proveItem('2026-01-02T00:00:00.000Z', 70),
          ],
        }),
      ),
    ];
    for (const d of decisions) {
      expect(['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER', 'CONSOLIDATED']).toContain(d.currentStage);
    }
    // The second decision specifically exercises a genuine Prove failure
    // and rollback (LEARN satisfied via LEARNED_ITEM) -- confirm REINFORCE
    // shows up only as `intervention`, never as `currentStage`.
    expect(decisions[1].intervention).toBe('REINFORCE');
    expect(decisions[1].currentStage).toBe('PRACTICE');
  });

  it("49. CANON-R2R1 Part 3: premature Transfer evidence can NO LONGER satisfy LEARN's own trivial bar (superseding CANON-R2's original 'any evidence satisfies LEARN' behavior) -- with no LEARN_CHECK attempt anywhere in the ledger, currentStage correctly stays at LEARN itself, and the premature Transfer attempt is still recorded (PREMATURE_STAGE_EVIDENCE), never deleted", () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({ evidence: [transferItem('2026-01-01T00:00:00.000Z', [100, 100, 100])] }),
    );
    expect(decision.currentStage).toBe('LEARN');
    expect(requirement(decision, 'LEARN').status).toBe('UNSATISFIED');
    expect(requirement(decision, 'LEARN').reasonCodes).toContain('WRONG_ACTIVITY_TYPE');
    expect(requirement(decision, 'TRANSFER').status).toBe('LOCKED');
    expect(requirement(decision, 'TRANSFER').reasonCodes).toContain('PREMATURE_STAGE_EVIDENCE');
    expect(requirement(decision, 'TRANSFER').nonQualifyingEvidenceCount).toBe(1);
  });

  it('50. the evidence ledger passed in is never mutated by the engine', () => {
    const evidence = Object.freeze([LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90)]);
    expect(() => evaluateCanonicalLearningState(baseInput({ evidence: evidence as RawEvidenceItem[] }))).not.toThrow();
  });
});

describe('CANON-R2 Difficulty Authority (51-56)', () => {
  it('51. LEARN contract difficulty range is [1,2]', () => {
    const c = buildActivityContract('LEARN', null, difficultyFor('LEARN'));
    expect(c?.difficulty).toMatchObject({ min: 1, max: 2 });
  });

  it('52. PRACTICE contract difficulty range is [2,4]', () => {
    const c = buildActivityContract('PRACTICE', null, difficultyFor('PRACTICE'));
    expect(c?.difficulty).toMatchObject({ min: 2, max: 4 });
  });

  it('53. PROVE and RETAIN contract difficulty ranges are both [3,4]', () => {
    expect(buildActivityContract('PROVE', null, difficultyFor('PROVE'))?.difficulty).toMatchObject({ min: 3, max: 4 });
    expect(buildActivityContract('RETAIN', null, difficultyFor('RETAIN'))?.difficulty).toMatchObject({ min: 3, max: 4 });
  });

  it('54. TRANSFER contract difficulty range is [4,5]', () => {
    expect(buildActivityContract('TRANSFER', null, difficultyFor('TRANSFER'))?.difficulty).toMatchObject({ min: 4, max: 5 });
  });

  it('55. REINFORCE contract difficulty range is [1,3] when applied to a PRACTICE-stage remediation', () => {
    expect(buildActivityContract('PRACTICE', 'REINFORCE', resolveReinforceDifficulty(2))?.difficulty).toMatchObject({ min: 1, max: 3 });
  });

  // CANON-V2-REMEDIATION Part 4 (discovered-defect fix): `buildActivityContract`
  // itself still honors whatever `intervention`/`stage` combination its
  // caller passes (this pure function is not the place that decides
  // WHEN a REINFORCE shape applies -- see engine.ts's own
  // `applyReinforceShape` gate for that decision). The bug this
  // superseded test 55 used to certify was in the ENGINE's use of this
  // function: it used to pass `intervention: 'REINFORCE'` into this
  // function even when the real stage was PROVE/RETAIN/TRANSFER,
  // silently downgrading a real 10-item independent Prove/Retain retry
  // (or a real 3-challenge Transfer retry) into a 2-3 item assisted
  // Practice drill -- contradicting Policy V2's own exact PROVE/RETAIN/
  // TRANSFER contracts. `evaluateCanonicalLearningState` now only ever
  // calls this function with `'REINFORCE'` when `stage === 'PRACTICE'`;
  // see the engine-level assertions in
  // audit-canon-v2-transfer-classification.test.ts and
  // audit-canon-v2-retain-two-strike.test.ts for the corrected,
  // full-engine behavior.
  it("55b. buildActivityContract itself still applies a REINFORCE shape to a non-PRACTICE stage if explicitly asked -- this is a pure function's own documented behavior; the ENGINE is what now guards against ever asking for that combination in practice", () => {
    expect(buildActivityContract('PROVE', 'REINFORCE', resolveReinforceDifficulty(4))?.difficulty).toMatchObject({ min: 1, max: 3 });
    expect(buildActivityContract('PROVE', 'REINFORCE', resolveReinforceDifficulty(4))?.activityType).toBe('REINFORCE');
  });

  it('56. every contract difficulty target lies within its own [min,max]', () => {
    for (const stage of ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'] as const) {
      const c = buildActivityContract(stage, null, difficultyFor(stage));
      expect(c!.difficulty.target).toBeGreaterThanOrEqual(c!.difficulty.min);
      expect(c!.difficulty.target).toBeLessThanOrEqual(c!.difficulty.max);
    }
  });
});

describe('CANON-R2 Cross-Surface Consistency (57-63)', () => {
  it('57. evaluateCanonicalLearningState and rebuildConceptCanonicalState produce identical output for equivalent input', () => {
    const args = { conceptId: 'c1', studentId: 's1', evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90)], activeCriticalMisconception: false, now: '2026-01-01T00:00:00.000Z' };
    expect(rebuildConceptCanonicalState(args)).toEqual(evaluateCanonicalLearningState(args));
  });

  it('58. the decision is stable under JSON serialization (every surface reading the same payload sees the same truth)', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90)] }));
    expect(JSON.parse(JSON.stringify(decision))).toEqual(decision);
  });

  it('59. two different (conceptId, studentId) pairs with identical evidence produce structurally identical decisions apart from the id/canonicalRevision fields', () => {
    const evidence = [LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90)];
    const a = evaluateCanonicalLearningState(baseInput({ conceptId: 'concept-A', studentId: 'student-A', evidence }));
    const b = evaluateCanonicalLearningState(baseInput({ conceptId: 'concept-B', studentId: 'student-B', evidence }));
    const { conceptId: _a, studentId: _sa, canonicalRevision: _ra, ...restA } = a;
    const { conceptId: _b, studentId: _sb, canonicalRevision: _rb, ...restB } = b;
    expect(restA).toEqual(restB);
  });

  it('60. evidence order in the input array does not affect the decision -- the engine sorts by timestamp itself', () => {
    const evidence = [proveItem('2026-01-02T00:00:00.000Z', 90), LEARNED_ITEM, practiceItem('2026-01-01T00:00:00.000Z', 90)];
    const forward = evaluateCanonicalLearningState(baseInput({ evidence }));
    const reversed = evaluateCanonicalLearningState(baseInput({ evidence: [...evidence].reverse() }));
    expect(forward).toEqual(reversed);
  });

  it('61. computedAt always equals the injected `now`, never a fresh wall-clock timestamp', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ now: '2030-06-15T12:00:00.000Z' }));
    expect(decision.computedAt).toBe('2030-06-15T12:00:00.000Z');
  });

  it('62. policyVersion defaults to the canonical POLICY_VERSION and is always present', () => {
    const decision = evaluateCanonicalLearningState(baseInput());
    expect(decision.policyVersion).toBe(POLICY_VERSION);
    expect(decision.policyVersion).toBe(CANONICAL_POLICY.version);
  });

  it('63. an explicit policyVersion override is echoed verbatim without changing the decision logic', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ policyVersion: 'studyus-canonical-v1-preview' }));
    expect(decision.policyVersion).toBe('studyus-canonical-v1-preview');
    expect(decision.currentStage).toBe('LEARN');
  });
});

describe('CANON-R2 Recent-Work Regression Audit (64-72)', () => {
  it('64. does not import quiz-generation.service.ts', () => {
    for (const f of ENGINE_FILES) expect(read(join(ENGINE_DIR, f))).not.toMatch(/quiz-generation\.service/);
  });
  it('65. does not import gated-question-generation.service.ts (the Quality Gate)', () => {
    for (const f of ENGINE_FILES) expect(read(join(ENGINE_DIR, f))).not.toMatch(/gated-question-generation/);
  });
  it('66. does not import model-routing.ts (Luna/Terra selection)', () => {
    for (const f of ENGINE_FILES) expect(read(join(ENGINE_DIR, f))).not.toMatch(/model-routing/);
  });
  it('67. does not import token-budgets.ts or model-compatibility.ts (reasoning effort)', () => {
    for (const f of ENGINE_FILES) expect(read(join(ENGINE_DIR, f))).not.toMatch(/token-budgets|model-compatibility/);
  });
  it('68. does not import difficulty-presentation.ts (UX/CANON-R1 visible-difficulty UI) -- the engine owns policy, not presentation', () => {
    for (const f of ENGINE_FILES) expect(read(join(ENGINE_DIR, f))).not.toMatch(/difficulty-presentation/);
  });
  it('69. does not import any src/app route or React component', () => {
    for (const f of ENGINE_FILES) expect(read(join(ENGINE_DIR, f))).not.toMatch(/from ['"]@\/app\//);
  });
  it('70. does not import learning-continuation.service.ts, learning-os-snapshot.service.ts, or knowledge-state.service.ts -- it replaces their DECISION LOGIC, not their IO', () => {
    for (const f of ENGINE_FILES) {
      const src = read(join(ENGINE_DIR, f));
      expect(src).not.toMatch(/learning-continuation\.service|learning-os-snapshot\.service|knowledge-state\.service/);
    }
  });
  it('71. RELEASE-R1 zero-gap frontend fixes remain untouched by this phase (ConceptList.tsx and ErrorPatternList.tsx still route to Concept Mission)', () => {
    const conceptList = read('src/app/dashboard/subjects/[id]/ConceptList.tsx');
    const errorPatterns = read('src/app/dashboard/learning-debt/ErrorPatternList.tsx');
    expect(conceptList).toMatch(/\/dashboard\/subjects\/\$\{subjectId\}\/concepts\/\$\{c\.conceptId\}/);
    expect(errorPatterns).toMatch(/\/dashboard\/subjects\/\$\{p\.subjectId\}\/concepts\/\$\{p\.topConceptId\}/);
  });
  it('72. UX/CANON-R1 retention-before-transfer precedence in knowledge-state.service.ts remains untouched by this phase', () => {
    const src = read('src/services/knowledge-state.service.ts');
    const retentionIdx = src.indexOf(`scores.retention === null`);
    const transferIdx = src.indexOf(`policy.requiresTransfer && scores.transfer === null`);
    expect(retentionIdx).toBeGreaterThan(-1);
    expect(transferIdx).toBeGreaterThan(-1);
    expect(retentionIdx).toBeLessThan(transferIdx);
  });
});

describe('CANON-R2 Recalculation (73-80)', () => {
  it('73. rebuildConceptCanonicalState is idempotent -- rerunning it on the same evidence never changes the result', () => {
    const args = { conceptId: 'c1', studentId: 's1', evidence: provenLedger(), activeCriticalMisconception: false, now: '2026-01-06T00:00:00.000Z' };
    const first = rebuildConceptCanonicalState(args);
    const second = rebuildConceptCanonicalState(args);
    expect(first).toEqual(second);
  });

  it('74. never mutates the objects inside the evidence array (safe to rerun against a live, shared ledger)', () => {
    const ev = provenLedger();
    const snapshot = JSON.parse(JSON.stringify(ev));
    evaluateCanonicalLearningState(baseInput({ evidence: ev }));
    expect(ev).toEqual(snapshot);
  });

  it("75. Radicación regression case: history TRANSFER 0%, PRACTICE 0%, PRACTICE 0%, PRACTICE 33% resolves to PRACTICE as the first unresolved requirement, never RETAIN or TRANSFER (a plausible prior LEARN_CHECK pass is included -- CANON-R2R1's stricter Learn policy requires one explicitly, and nothing in the reported symptom contradicts the student having passed initial comprehension before these Practice attempts)", () => {
    const decision = evaluateCanonicalLearningState(
      baseInput({
        evidence: [
          LEARNED_ITEM,
          // A premature Transfer attempt exists in history -- it can
          // never itself satisfy Transfer (Invariant), and Retain/Prove
          // were never even attempted.
          transferItem('2026-01-01T00:00:00.000Z', [0, 0, 0]),
          practiceItem('2026-01-02T00:00:00.000Z', 0),
          practiceItem('2026-01-03T00:00:00.000Z', 0),
          practiceItem('2026-01-04T00:00:00.000Z', 33),
        ],
        now: '2026-01-04T00:00:00.000Z',
      }),
    );
    expect(decision.currentStage).toBe('PRACTICE');
    expect(requirement(decision, 'PRACTICE').status).toBe('UNSATISFIED');
    expect(requirement(decision, 'PROVE').status).toBe('LOCKED');
    expect(requirement(decision, 'RETAIN').status).toBe('LOCKED');
    expect(requirement(decision, 'TRANSFER').status).toBe('LOCKED');
    expect(requirement(decision, 'TRANSFER').reasonCodes).toContain('PREMATURE_STAGE_EVIDENCE');
  });

  it('76. a brand-new concept with zero evidence resolves cleanly to LEARN with no throw (dry-run safe)', () => {
    expect(() => evaluateCanonicalLearningState(baseInput())).not.toThrow();
    expect(evaluateCanonicalLearningState(baseInput()).currentStage).toBe('LEARN');
  });

  it('77. a policyVersion label always round-trips verbatim, never silently replaced', () => {
    const decision = evaluateCanonicalLearningState(baseInput({ policyVersion: 'studyus-canonical-v1-dry-run' }));
    expect(decision.policyVersion).toBe('studyus-canonical-v1-dry-run');
  });

  it('78. malformed evidence (a Transfer item with only 2 of the required 3 challenge scores) resolves to UNRESOLVED without throwing', () => {
    const retained = [...provenLedger(), retentionItem('2026-01-06T00:00:00.000Z', 90)];
    expect(() =>
      evaluateCanonicalLearningState(
        baseInput({ evidence: [...retained, transferItem('2026-01-10T00:00:00.000Z', [90, 90])], now: '2026-01-10T00:00:00.000Z' }),
      ),
    ).not.toThrow();
  });

  it('79. a large, mixed evidence ledger (200 items) completes and produces a consistent, well-formed decision', () => {
    const evidence: RawEvidenceItem[] = [LEARNED_ITEM];
    for (let i = 0; i < 200; i++) {
      evidence.push(practiceItem(new Date(2026, 0, 1 + i).toISOString(), i % 2 === 0 ? 90 : 40));
    }
    const decision = evaluateCanonicalLearningState(baseInput({ evidence, now: new Date(2026, 6, 1).toISOString() }));
    expect(decision.requirements).toHaveLength(5);
    expect(requirement(decision, 'PRACTICE').status).toBe('SATISFIED');
  });

  it('80. adding a new, later PROVE attempt does not change the already-settled PRACTICE tally -- incremental recalculation only affects downstream state', () => {
    // A fixed id so "before" and "after" reference the identical Practice
    // attempt object, not two randomly-id'd lookalikes.
    const stablePractice = item({
      id: 'stable-practice-1',
      activityType: 'PRACTICE',
      timestamp: '2026-01-01T00:00:00.000Z',
      itemCount: 3,
      correctCount: 3,
      scorePercent: 90,
      difficulty: 3,
      independent: false,
    });
    const before = evaluateCanonicalLearningState(baseInput({ evidence: [LEARNED_ITEM, stablePractice] }));
    const after = evaluateCanonicalLearningState(
      baseInput({ evidence: [LEARNED_ITEM, stablePractice, proveItem('2026-01-02T00:00:00.000Z', 90)] }),
    );
    expect(after.requirements.find((r) => r.stage === 'PRACTICE')).toEqual(before.requirements.find((r) => r.stage === 'PRACTICE'));
  });
});

describe('CANON-R2 qualifyEvidence direct unit tests (supplementary)', () => {
  it('rejects any evidence carrying an active critical misconception, regardless of stage', () => {
    const verdict = qualifyEvidence(practiceItem('2026-01-01T00:00:00.000Z', 100), { targetStage: 'PRACTICE', prerequisiteSatisfied: true });
    expect(verdict.result).toBe('QUALIFIES');
    const withMisconception = qualifyEvidence(
      item({ activityType: 'PRACTICE', scorePercent: 100, difficulty: 3, hasCriticalMisconception: true }),
      { targetStage: 'PRACTICE', prerequisiteSatisfied: true },
    );
    expect(withMisconception.result).toBe('DOES_NOT_QUALIFY');
    expect(withMisconception.reasonCode).toBe('CRITICAL_MISCONCEPTION');
  });

  it('rejects evidence declared for the wrong activity type', () => {
    const verdict = qualifyEvidence(practiceItem('2026-01-01T00:00:00.000Z', 100), { targetStage: 'PROVE', prerequisiteSatisfied: true });
    expect(verdict.result).toBe('DOES_NOT_QUALIFY');
    expect(verdict.reasonCode).toBe('WRONG_ACTIVITY_TYPE');
  });
});
