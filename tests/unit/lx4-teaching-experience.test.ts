/**
 * LX-4B -- Teaching Experience contract.
 *
 * Canonical `SupportLevel` (adaptive-teaching-policy) must finally
 * become a VISIBLE difference in the learner experience. This module
 * maps it to presentation; it never computes it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  deriveTeachingExperience,
  TEACHING_EXPERIENCE_CONTRACT_VERSION,
  type TeachingExperienceInputs,
} from '@/lib/lx/teaching-experience';

function base(over: Partial<TeachingExperienceInputs> = {}): TeachingExperienceInputs {
  return {
    supportLevel: 'MINIMAL_SUPPORT',
    explanationDepth: 'STANDARD',
    evidenceMode: 'PRACTICE',
    primaryBarrier: 'LOW_UNDERSTANDING',
    hasActiveMisconception: false,
    ...over,
  };
}

describe('LX-4B deriveTeachingExperience -- SupportLevel is visible', () => {
  it('HIGH_SUPPORT: explain -> model -> guide -> practice, worked example, full scaffolding, help, retry', () => {
    const v = deriveTeachingExperience(base({ supportLevel: 'HIGH_SUPPORT', explanationDepth: 'DEEP' }));
    expect(v.stages).toEqual(['EXPLAIN', 'MODEL', 'GUIDE', 'PRACTICE']);
    expect(v.mode).toBe('EXPLAIN');
    expect(v.showWorkedExample).toBe(true);
    expect(v.scaffolding).toBe('FULL');
    expect(v.helpAvailable).toBe(true);
    expect(v.retryAllowed).toBe(true);
    expect(v.explanationProminence).toBe('PRIMARY');
    expect(v.isProve).toBe(false);
  });

  it('GUIDED: model -> guide -> practice, worked example, guided scaffolding', () => {
    const v = deriveTeachingExperience(base({ supportLevel: 'GUIDED' }));
    expect(v.stages).toEqual(['MODEL', 'GUIDE', 'PRACTICE']);
    expect(v.showWorkedExample).toBe(true);
    expect(v.scaffolding).toBe('GUIDED');
    expect(v.helpAvailable).toBe(true);
  });

  it('PARTIAL_SUPPORT: straight to practice, light scaffolding, explanation on request', () => {
    const v = deriveTeachingExperience(base({ supportLevel: 'PARTIAL_SUPPORT' }));
    expect(v.stages).toEqual(['PRACTICE']);
    expect(v.showWorkedExample).toBe(false);
    expect(v.scaffolding).toBe('LIGHT');
    expect(v.explanationProminence).toBe('ON_REQUEST');
    expect(v.helpAvailable).toBe(true);
  });

  it('MINIMAL_SUPPORT: practice, no scaffolding, help still available on request', () => {
    const v = deriveTeachingExperience(base({ supportLevel: 'MINIMAL_SUPPORT' }));
    expect(v.stages).toEqual(['PRACTICE']);
    expect(v.scaffolding).toBe('NONE');
    expect(v.showWorkedExample).toBe(false);
    expect(v.helpAvailable).toBe(true);
  });

  it('INDEPENDENT support: no help, no retry, no explanation, no worked example', () => {
    const v = deriveTeachingExperience(base({ supportLevel: 'INDEPENDENT' }));
    expect(v.mode).toBe('INDEPENDENT');
    expect(v.helpAvailable).toBe(false);
    expect(v.retryAllowed).toBe(false);
    expect(v.showWorkedExample).toBe(false);
    expect(v.explanationProminence).toBe('HIDDEN');
  });
});

describe('LX-4B -- EvidenceMode is the integrity backstop (Prove has no teaching help)', () => {
  for (const evidenceMode of ['INDEPENDENT', 'ASSESSMENT'] as const) {
    it(`${evidenceMode}: any supportLevel input is forced to a no-help Prove experience`, () => {
      const v = deriveTeachingExperience(base({ supportLevel: 'HIGH_SUPPORT', explanationDepth: 'DEEP', evidenceMode }));
      expect(v.isProve).toBe(true);
      expect(v.mode).toBe('INDEPENDENT');
      expect(v.helpAvailable).toBe(false);
      expect(v.retryAllowed).toBe(false);
      expect(v.showWorkedExample).toBe(false);
      expect(v.reinforceCorrect).toBe(false);
      expect(v.explanationProminence).toBe('HIDDEN');
    });
  }

  it('PRACTICE evidence mode keeps it a teaching moment', () => {
    const v = deriveTeachingExperience(base({ evidenceMode: 'PRACTICE', supportLevel: 'GUIDED' }));
    expect(v.isProve).toBe(false);
    expect(v.helpAvailable).toBe(true);
  });
});

describe('LX-4B -- misconception / prerequisite repair always shows a worked example', () => {
  it('active misconception forces a worked example even at MINIMAL_SUPPORT', () => {
    const v = deriveTeachingExperience(base({ supportLevel: 'MINIMAL_SUPPORT', hasActiveMisconception: true }));
    expect(v.showWorkedExample).toBe(true);
  });
  it('PREREQUISITE_GAP barrier forces a worked example', () => {
    const v = deriveTeachingExperience(base({ supportLevel: 'PARTIAL_SUPPORT', primaryBarrier: 'PREREQUISITE_GAP' }));
    expect(v.showWorkedExample).toBe(true);
  });
});

describe('LX-4B -- determinism + version + no policy of its own', () => {
  it('is deterministic', () => {
    const i = base({ supportLevel: 'GUIDED' });
    expect(deriveTeachingExperience(i)).toEqual(deriveTeachingExperience(i));
  });
  it('carries the contract version', () => {
    expect(deriveTeachingExperience(base()).contractVersion).toBe(TEACHING_EXPERIENCE_CONTRACT_VERSION);
  });
  it('the module never computes SupportLevel / TeachingIntent', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/lx/teaching-experience.ts'), 'utf-8');
    expect(src).not.toMatch(/function computeSupportLevel/);
    expect(src).not.toMatch(/function computeTeachingIntent/);
    expect(src).not.toMatch(/masteryScore|independentMastery|independenceScore/);
    // it only imports SupportLevel etc. as types
    expect(src).toMatch(/import type \{ SupportLevel/);
  });
});
