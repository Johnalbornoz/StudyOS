import { describe, it, expect } from 'vitest';
import { canUseAI } from '@/lib/ai-permission-policy';
import type { EvidenceMode } from '@/lib/activity-taxonomy';

describe('Phase 3A -- canUseAI is the one authoritative, server-side AI permission policy', () => {
  it('PRACTICE + HINT -> ALLOW', () => {
    expect(canUseAI({ evidenceMode: 'PRACTICE', feature: 'HINT' })).toBe(true);
  });

  it('PRACTICE + EXPLAIN -> ALLOW', () => {
    expect(canUseAI({ evidenceMode: 'PRACTICE', feature: 'EXPLAIN' })).toBe(true);
  });

  it('INDEPENDENT + HINT -> DENY', () => {
    expect(canUseAI({ evidenceMode: 'INDEPENDENT', feature: 'HINT' })).toBe(false);
  });

  it('INDEPENDENT + MATH_TOOLBAR -> ALLOW (input assistance is not answer assistance)', () => {
    expect(canUseAI({ evidenceMode: 'INDEPENDENT', feature: 'MATH_TOOLBAR' })).toBe(true);
  });

  it('ASSESSMENT + HINT -> DENY', () => {
    expect(canUseAI({ evidenceMode: 'ASSESSMENT', feature: 'HINT' })).toBe(false);
  });

  it('ASSESSMENT + INTERNAL_GRADING -> ALLOW', () => {
    expect(canUseAI({ evidenceMode: 'ASSESSMENT', feature: 'INTERNAL_GRADING' })).toBe(true);
  });

  it('ASSESSMENT + VARIANT_GENERATION -> ALLOW', () => {
    expect(canUseAI({ evidenceMode: 'ASSESSMENT', feature: 'VARIANT_GENERATION' })).toBe(true);
  });

  it('Math Toolbar works in all three Evidence Modes', () => {
    const modes: EvidenceMode[] = ['PRACTICE', 'INDEPENDENT', 'ASSESSMENT'];
    for (const evidenceMode of modes) {
      expect(canUseAI({ evidenceMode, feature: 'MATH_TOOLBAR' })).toBe(true);
    }
  });

  it('every student-assistance feature is denied outside PRACTICE', () => {
    const studentFeatures = ['HINT', 'EXPLAIN', 'ASK_AI', 'SOLVE', 'REWRITE', 'IMPROVE_ANSWER', 'AUTOCOMPLETE', 'PRE_SUBMIT_CHECK'] as const;
    for (const feature of studentFeatures) {
      expect(canUseAI({ evidenceMode: 'INDEPENDENT', feature })).toBe(false);
      expect(canUseAI({ evidenceMode: 'ASSESSMENT', feature })).toBe(false);
      expect(canUseAI({ evidenceMode: 'PRACTICE', feature })).toBe(true);
    }
  });

  it('every internal/system feature is allowed regardless of Evidence Mode -- it never assists the student directly', () => {
    const internalFeatures = [
      'INTERNAL_GRADING', 'VARIANT_GENERATION', 'VERIFICATION_GENERATION',
      'REASONING_EVALUATION', 'ERROR_CLASSIFICATION', 'DIFFICULTY_SELECTION', 'CONSISTENCY_ANALYSIS',
    ] as const;
    const modes: EvidenceMode[] = ['PRACTICE', 'INDEPENDENT', 'ASSESSMENT'];
    for (const feature of internalFeatures) {
      for (const evidenceMode of modes) {
        expect(canUseAI({ evidenceMode, feature })).toBe(true);
      }
    }
  });

  it('a student-assistance feature is denied once the attempt has been submitted, even in PRACTICE', () => {
    expect(canUseAI({ evidenceMode: 'PRACTICE', feature: 'HINT', attemptState: { submitted: true } })).toBe(false);
  });

  it('fails closed on an unrecognized feature rather than silently allowing it', () => {
    expect(canUseAI({ evidenceMode: 'PRACTICE', feature: 'SOMETHING_NEW' as any })).toBe(false);
  });
});
