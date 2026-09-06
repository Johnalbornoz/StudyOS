/**
 * Phase 8 -- Step 8F1: the PURE learner-facing presentation mapping.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  planItemWhyKey,
  planItemStatusKey,
  planItemDayBucket,
  canLearnerSkip,
  PLAN_ITEM_WHY_KEYS,
} from '@/lib/learning-plan-presentation';
import { ORCHESTRATION_REASON_CODES } from '@/lib/learning-orchestration-policy';

const MESSAGES_SRC = readFileSync(join(process.cwd(), 'src/lib/i18n/messages.ts'), 'utf-8');

describe('8F1 -- learning-plan-presentation is pure and deterministic', () => {
  it('has no DB / AI / clock imports', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/learning-plan-presentation.ts'), 'utf-8');
    expect(src).not.toMatch(/from '@\/lib\/db'/);
    expect(src).not.toMatch(/anthropic|openai|generateText|\.query\(/i);
    expect(src).not.toMatch(/Date\.now|new Date\(/);
  });

  it('maps every closed reason code to a stable why key', () => {
    for (const rc of ORCHESTRATION_REASON_CODES) {
      expect(planItemWhyKey(rc)).toBe(`plan8.why.${rc}`);
    }
    expect(PLAN_ITEM_WHY_KEYS).toHaveLength(ORCHESTRATION_REASON_CODES.length);
  });

  it('every why key + both status keys are defined for all five locales in messages.ts', () => {
    const localeCount = 5;
    for (const key of [...PLAN_ITEM_WHY_KEYS, 'plan8.status.PLANNED', 'plan8.status.READY']) {
      const occurrences = MESSAGES_SRC.split(`'${key}':`).length - 1;
      expect(occurrences, key).toBe(localeCount);
    }
  });

  it('canLearnerSkip is true ONLY for the two lowest tiers (curriculum, learner request)', () => {
    expect(canLearnerSkip('CURRICULUM_PROGRESSION')).toBe(true);
    expect(canLearnerSkip('LEARNER_REQUESTED')).toBe(true);
    for (const rc of [
      'ASSESSMENT_APPROACHING',
      'RETENTION_DUE',
      'REMEDIATION_REQUIRED',
      'VERIFICATION_READY',
      'PREREQUISITE_FIRST',
      'TRANSFER_PROGRESSION',
      'MISCONCEPTION_BLOCK',
      'LEARNING_DEBT',
    ] as const) {
      expect(canLearnerSkip(rc), rc).toBe(false);
    }
  });

  it('planItemStatusKey / planItemDayBucket are pure lookups', () => {
    expect(planItemStatusKey('PLANNED')).toBe('plan8.status.PLANNED');
    expect(planItemDayBucket('2026-09-01', '2026-09-06')).toBe('OVERDUE');
    expect(planItemDayBucket('2026-09-06', '2026-09-06')).toBe('TODAY');
    expect(planItemDayBucket('2026-09-20', '2026-09-06')).toBe('UPCOMING');
  });
});
