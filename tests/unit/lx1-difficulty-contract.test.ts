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

describe('LX-9R3-R1 -- target difficulty authority is resolved, canonical, and deterministic', () => {
  it('is a pure function of ActivityType + Knowledge State -- same input, same decision', () => {
    const ctx = { activityType: 'PRACTICE' as const, knowledgeState: { masteryState: 'DEVELOPING' as const, criticalMisconceptionCount: 0 } };
    expect(resolveTargetDifficulty(ctx)).toEqual(resolveTargetDifficulty(ctx));
  });

  it('every level stays within the 1-5 scale', () => {
    const activityTypes = ['PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION', 'SOLO_VERIFY', 'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM'] as const;
    const masteryStates = ['UNKNOWN', 'LEARNING', 'DEVELOPING', 'PROVISIONAL_MASTERY', 'VALIDATED_MASTERY', 'AT_RISK', 'INTERVENTION_REQUIRED'] as const;
    for (const activityType of activityTypes) {
      for (const masteryState of masteryStates) {
        for (const criticalMisconceptionCount of [0, 1]) {
          const { level } = resolveTargetDifficulty({ activityType, knowledgeState: { masteryState, criticalMisconceptionCount } });
          expect(level).toBeGreaterThanOrEqual(1);
          expect(level).toBeLessThanOrEqual(5);
        }
      }
      const { level } = resolveTargetDifficulty({ activityType, knowledgeState: null });
      expect(level).toBeGreaterThanOrEqual(1);
      expect(level).toBeLessThanOrEqual(5);
    }
  });

  it('the historical candidate-inputs record still documents what this authority was scoped to', () => {
    expect(CANDIDATE_INPUTS_FOR_TARGET_DIFFICULTY_AUTHORITY.length).toBeGreaterThan(0);
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
    expect(DIFFICULTY_CONTRACT_VERSION).toBe(3);
    expect(aggregateEvidenceDifficulty([3, 3])).toBe(aggregateEvidenceDifficulty([3, 3]));
  });
});
