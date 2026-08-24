import { describe, it, expect } from 'vitest';
import { evaluateVerificationTriggers, shouldTriggerVerification, highestSeverity, type VerificationTriggerInput } from '@/lib/verification-triggers';

function baseInput(overrides: Partial<VerificationTriggerInput> = {}): VerificationTriggerInput {
  return {
    gradingConfidence: 0.9,
    currentScorePercent: 85,
    ...overrides,
  };
}

describe('Phase 3B -- Verification Trigger Engine (deterministic, no LLM call)', () => {
  it('strong, unambiguous evidence triggers nothing -- verification is selective, not automatic', () => {
    const triggers = evaluateVerificationTriggers(baseInput());
    expect(triggers).toEqual([]);
    expect(shouldTriggerVerification(triggers)).toBe(false);
  });

  it('LOW_GRADING_CONFIDENCE fires when grading itself was unsure', () => {
    const triggers = evaluateVerificationTriggers(baseInput({ gradingConfidence: 0.4 }));
    expect(triggers.map((t) => t.triggerId)).toContain('LOW_GRADING_CONFIDENCE');
  });

  it('LARGE_CONFIDENCE_DISAGREEMENT fires on a wide grading-confidence spread across questions', () => {
    const triggers = evaluateVerificationTriggers(baseInput({ gradingConfidenceSpread: 0.6 }));
    expect(triggers.map((t) => t.triggerId)).toContain('LARGE_CONFIDENCE_DISAGREEMENT');
  });

  it('CONTRADICTORY_EVIDENCE fires (HIGH severity) when this result is much weaker than the established prior', () => {
    const triggers = evaluateVerificationTriggers(baseInput({ currentScorePercent: 20, priorConceptScorePercent: 85 }));
    const t = triggers.find((x) => x.triggerId === 'CONTRADICTORY_EVIDENCE');
    expect(t).toBeTruthy();
    expect(t!.severity).toBe('HIGH');
  });

  it('UNEXPECTED_PERFORMANCE_JUMP fires when this result is much stronger than the established prior', () => {
    const triggers = evaluateVerificationTriggers(baseInput({ currentScorePercent: 95, priorConceptScorePercent: 30 }));
    expect(triggers.map((t) => t.triggerId)).toContain('UNEXPECTED_PERFORMANCE_JUMP');
  });

  it('WEAK_CONCEPT_ATTRIBUTION fires when the question-concept mapping itself is uncertain', () => {
    const triggers = evaluateVerificationTriggers(baseInput({ conceptMappingConfidence: 0.3 }));
    expect(triggers.map((t) => t.triggerId)).toContain('WEAK_CONCEPT_ATTRIBUTION');
  });

  it('CONCEPT_COVERAGE_AMBIGUITY fires when the concept has only been probed from one narrow angle', () => {
    const triggers = evaluateVerificationTriggers(baseInput({ conceptCoverageBreadth: 0.1 }));
    expect(triggers.map((t) => t.triggerId)).toContain('CONCEPT_COVERAGE_AMBIGUITY');
  });

  it('LOW_VARIANT_EQUIVALENCE fires when a used variant was not confidently equivalent', () => {
    const triggers = evaluateVerificationTriggers(baseInput({ variantEquivalenceConfidence: 0.5 }));
    expect(triggers.map((t) => t.triggerId)).toContain('LOW_VARIANT_EQUIVALENCE');
  });

  it('HIGH_BEHAVIORAL_ANOMALY fires at LOW severity only -- a behavioral signal alone never determines anything', () => {
    const triggers = evaluateVerificationTriggers(baseInput({ behavioralAnomalyScore: 0.8 }));
    const t = triggers.find((x) => x.triggerId === 'HIGH_BEHAVIORAL_ANOMALY');
    expect(t).toBeTruthy();
    expect(t!.severity).toBe('LOW');
  });

  it('REASONING_ANSWER_INCONSISTENCY fires (HIGH severity) when shown work does not support the final answer', () => {
    const triggers = evaluateVerificationTriggers(baseInput({ reasoningConsistent: false }));
    const t = triggers.find((x) => x.triggerId === 'REASONING_ANSWER_INCONSISTENCY');
    expect(t).toBeTruthy();
    expect(t!.severity).toBe('HIGH');
  });

  it('PROFILE_REQUIRES_VERIFICATION fires when the assessment profile itself mandates a confirming question', () => {
    const triggers = evaluateVerificationTriggers(baseInput({ requiresVerificationByProfile: true }));
    expect(triggers.map((t) => t.triggerId)).toContain('PROFILE_REQUIRES_VERIFICATION');
  });

  it('never infers cheating from a single behavioral signal: paste count alone is not a trigger input at all', () => {
    // behavioralAnomalyScore is the only behavioral input this engine accepts --
    // it is always a pre-aggregated 0-1 score, never a raw signal like pasteCount
    // or tabChanges directly, so there is no way to wire "paste = AI" in here.
    const triggers = evaluateVerificationTriggers(baseInput({ behavioralAnomalyScore: 0 }));
    expect(triggers.filter((t) => t.triggerId === 'HIGH_BEHAVIORAL_ANOMALY')).toHaveLength(0);
  });

  it('highestSeverity reduces multiple simultaneous triggers to the single highest severity', () => {
    const triggers = evaluateVerificationTriggers(
      baseInput({ gradingConfidence: 0.4, reasoningConsistent: false, behavioralAnomalyScore: 0.7 })
    );
    expect(triggers.length).toBeGreaterThan(1);
    expect(highestSeverity(triggers)).toBe('HIGH');
  });

  it('highestSeverity returns null when nothing triggered', () => {
    expect(highestSeverity([])).toBeNull();
  });

  it('every trigger reason is a non-empty, human-readable string -- never a raw code', () => {
    const triggers = evaluateVerificationTriggers(baseInput({ gradingConfidence: 0.3 }));
    for (const t of triggers) {
      expect(t.reason.length).toBeGreaterThan(10);
      expect(t.reason).not.toMatch(/^[A-Z_]+$/);
    }
  });
});
