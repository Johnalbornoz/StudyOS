/**
 * LX-1E (repaired LX-1R) -- Difficulty Contract. LX-1 owns semantics +
 * the evidence-consistency rule ONLY. It invents no difficulty policy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  difficultyForEvidence,
  aggregateEvidenceDifficulty,
  resolveTargetDifficulty,
  DIFFICULTY_IS_STUDYUS_OWNED,
  LEGACY_GENERATION_DIFFICULTY_DEFAULT,
  DIFFICULTY_CONTRACT_VERSION,
  CANDIDATE_INPUTS_FOR_TARGET_DIFFICULTY_AUTHORITY,
} from '@/lib/lx/difficulty-contract';

const SRC = readFileSync(join(process.cwd(), 'src/lib/lx/difficulty-contract.ts'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('LX-1R -- no invented difficulty policy in the source', () => {
  it('no mastery-score band thresholds', () => {
    expect(SRC).not.toMatch(/masteryScore/);
    expect(SRC).not.toMatch(/masteryScoreToBand/);
    expect(SRC).not.toMatch(/score\s*<\s*\d/);
  });
  it('no activity +1/-1 difficulty bias', () => {
    expect(SRC).not.toMatch(/base\s*[-+]\s*1/);
    expect(SRC).not.toMatch(/PURPOSE_ADJUSTED/);
    expect(SRC).not.toMatch(/deriveTargetDifficulty\b/);
  });
  it('no learner-selected difficulty field', () => {
    expect(SRC).not.toMatch(/\b(learnerSelected|userDifficulty|chosenDifficulty|selectedDifficulty|difficultyOverride)\b/);
  });
});

describe('LX-1E difficulty semantics & ownership', () => {
  it('StudyUS owns target difficulty (invariant asserted, not implemented)', () => {
    expect(DIFFICULTY_IS_STUDYUS_OWNED).toBe(true);
  });

  it('the legacy generation default (3) is labelled a compatibility constant, not a policy', () => {
    expect(LEGACY_GENERATION_DIFFICULTY_DEFAULT).toBe(3);
  });
});

describe('LX-1E target difficulty is UNRESOLVED by design', () => {
  it('resolveTargetDifficulty takes no inputs and returns UNRESOLVED, deferred to LX-4', () => {
    expect(resolveTargetDifficulty.length).toBe(0);
    const r = resolveTargetDifficulty();
    expect(r.status).toBe('UNRESOLVED');
    expect(r.deferredTo).toBe('LX-4');
    expect(r.candidateInputsForFutureAuthority).toBe(CANDIDATE_INPUTS_FOR_TARGET_DIFFICULTY_AUTHORITY);
    expect(r.candidateInputsForFutureAuthority.length).toBeGreaterThan(0);
  });
});

describe('LX-1E evidence-consistency rule (kept)', () => {
  it('evidence difficulty is the actual question difficulty, clamped to 1..5, never a constant', () => {
    expect(difficultyForEvidence(4)).toBe(4);
    expect(difficultyForEvidence(0)).toBe(1);
    expect(difficultyForEvidence(9)).toBe(5);
  });

  it('aggregate is the mean of actual question difficulties (rounded, clamped); empty -> legacy default', () => {
    expect(aggregateEvidenceDifficulty([2, 3, 4])).toBe(3);
    expect(aggregateEvidenceDifficulty([5, 5, 4])).toBe(5);
    expect(aggregateEvidenceDifficulty([1, 2])).toBe(2); // 1.5 -> round -> 2
    expect(aggregateEvidenceDifficulty([])).toBe(LEGACY_GENERATION_DIFFICULTY_DEFAULT);
  });

  it('is deterministic and version-stamped', () => {
    expect(DIFFICULTY_CONTRACT_VERSION).toBe(2);
    expect(aggregateEvidenceDifficulty([3, 3])).toBe(aggregateEvidenceDifficulty([3, 3]));
  });
});
