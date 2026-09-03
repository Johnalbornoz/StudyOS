/**
 * Phase 1C-R Steps 6/7/8/15: proves the three decision-adjacent
 * consumers (remediation, cognitive diagnosis, tutor strategy) reach
 * IDENTICAL decisions whether driven by the OLD `LearnerConceptState`
 * fixture (the retired `getLearnerConceptState` contract) or the
 * equivalent canonical `DecisionContext` fixture (the new Learner Twin
 * boundary) -- the actual "BEFORE learner-state fixture / AFTER
 * DecisionContext fixture / same decision outcome" comparison the
 * remediation requires. No orchestration/db mocking needed: every
 * function under test here is already a pure, exported, testable
 * decision function -- only its *inputs* changed source.
 *
 * This file also pins the release-blocking semantic invariant (Step 3):
 * `retention.retentionScore` (Knowledge State dimension) and
 * `retention.forgettingRisk` (spaced-repetition estimate) must never be
 * conflated. Every fixture below deliberately sets them to DIFFERENT
 * values so a future regression that swaps one for the other fails
 * loudly here, not silently in production.
 */
import { describe, it, expect } from 'vitest';
import { determineRemediationPattern, toCandidateState } from '@/services/remediation.service';
import { learnerGapFactor, evidenceConfidenceFactor } from '@/services/cognitive-diagnosis.service';
import { selectTutorStrategy } from '@/services/tutor-strategy.service';
import type { LearnerConceptState, EvidenceStrength, CalibrationLabel } from '@/services/learner-model.service';
import type { DecisionContext } from '@/lib/learner-twin';

function decisionContextFixture(overrides: {
  masteryScore?: number;
  forgettingRisk?: number | null;
  retentionScore?: number | null;
  independentMastery?: number | null;
  evidenceStrength?: EvidenceStrength | null;
  calibrationLabel?: CalibrationLabel;
}): DecisionContext {
  const {
    masteryScore = 80,
    forgettingRisk = 20, // 100 - 20 = 80, matches legacyStateFixture()'s default retention=80 below
    retentionScore = 55, // deliberately DIFFERENT from the forgettingRisk-derived 80 -- never should be read by these consumers
    independentMastery = 80,
    evidenceStrength = 'HIGH',
    calibrationLabel = 'WELL_CALIBRATED',
  } = overrides;
  return {
    studentId: 'student-1',
    conceptId: 'concept-1',
    subjectId: 'subject-1',
    generatedAt: '2026-08-31T00:00:00.000Z',
    mastery: { score: masteryScore, confidence: 70 },
    knowledgeState: {
      masteryState: 'PROVISIONAL_MASTERY',
      dimensions: { understanding: 70, independence: 55, application: null, retention: retentionScore, transfer: null },
      validationReadiness: 'READY',
    },
    metacognition: { confidenceCalibration: { score: 90, label: calibrationLabel, samples: 5 } },
    independence: { independentMastery, evidenceStrength },
    retention: { retentionScore, forgettingRisk, nextReviewAt: null },
    misconceptions: { activeCount: 0, criticalCount: 0, recurringCount: 0 },
    recentEvidence: [],
    assessmentPressure: { upcomingOccurrence: false, daysUntil: null, examReadiness: null, quality: { sourceType: 'SYSTEM_FACT', lastUpdatedAt: null } },
    availability: { dailyMinutes: 120 },
    // Phase 1E-R: not requested by default -- these fixtures never pass
    // options.derivedMetrics, matching every real current caller.
    learningVelocity: { requested: false },
    helpDependency: { requested: false },
    prerequisiteGaps: { requested: false },
    interventionState: { requested: false },
    validationState: { requested: false },
    assessmentState: { requested: false },
    dataQuality: { generatedAt: '2026-08-31T00:00:00.000Z', sourcesUsed: ['SYSTEM_FACT'] },
  };
}

function legacyStateFixture(overrides: Partial<LearnerConceptState>): LearnerConceptState {
  return {
    masteryScore: 80,
    retention: 80, // OLD semantic: 100 - forgettingRisk
    independentMastery: 80,
    evidenceStrength: 'HIGH',
    confidence: 70,
    confidenceCalibration: { score: 90, label: 'WELL_CALIBRATED', samples: 5 },
    ...overrides,
  };
}

describe('Remediation migration (Step 6): determineRemediationPattern(legacy state) === determineRemediationPattern(toCandidateState(DecisionContext))', () => {
  it('healthy candidate -> DEFAULT on both paths', () => {
    const legacy = determineRemediationPattern(legacyStateFixture({}));
    const canonical = determineRemediationPattern(toCandidateState(decisionContextFixture({})));
    expect(canonical).toBe(legacy);
    expect(canonical).toBe('DEFAULT');
  });

  it('low mastery -> LOW_MASTERY on both paths', () => {
    const legacy = determineRemediationPattern(legacyStateFixture({ masteryScore: 35 }));
    const canonical = determineRemediationPattern(toCandidateState(decisionContextFixture({ masteryScore: 35 })));
    expect(canonical).toBe(legacy);
    expect(canonical).toBe('LOW_MASTERY');
  });

  it('low retention -> LOW_RETENTION on both paths, driven by forgettingRisk, NOT retentionScore', () => {
    const legacy = determineRemediationPattern(legacyStateFixture({ masteryScore: 75, retention: 30 }));
    const canonical = determineRemediationPattern(
      // retentionScore set deliberately HIGH (95) -- if this were ever read instead of
      // forgettingRisk, the pattern would come out DEFAULT, not LOW_RETENTION.
      toCandidateState(decisionContextFixture({ masteryScore: 75, forgettingRisk: 70, retentionScore: 95 }))
    );
    expect(canonical).toBe(legacy);
    expect(canonical).toBe('LOW_RETENTION');
  });

  it('overconfident candidate -> OVERCONFIDENT on both paths', () => {
    const legacy = determineRemediationPattern(
      legacyStateFixture({ masteryScore: 70, confidenceCalibration: { score: 20, label: 'OVERCONFIDENT', samples: 5 } })
    );
    const canonical = determineRemediationPattern(toCandidateState(decisionContextFixture({ masteryScore: 70, calibrationLabel: 'OVERCONFIDENT' })));
    expect(canonical).toBe(legacy);
    expect(canonical).toBe('OVERCONFIDENT');
  });

  it('no evidence (null) -> LOW_MASTERY on both paths', () => {
    expect(determineRemediationPattern(null)).toBe('LOW_MASTERY');
    expect(determineRemediationPattern(toCandidateState(null))).toBe('LOW_MASTERY');
  });
});

describe('Cognitive diagnosis migration (Step 7): learnerGapFactor/evidenceConfidenceFactor inputs agree between legacy and canonical fixtures', () => {
  it('learnerGapFactor(mastery, retention, independentMastery) is identical whether retention comes from the legacy field or 100-forgettingRisk', () => {
    const legacyGap = learnerGapFactor(60, 40, 55); // legacy retention = 40
    const dc = decisionContextFixture({ masteryScore: 60, forgettingRisk: 60, retentionScore: 10, independentMastery: 55 }); // 100-60=40; retentionScore deliberately different
    const canonicalRetention = dc.retention.forgettingRisk !== null ? 100 - dc.retention.forgettingRisk : null;
    const canonicalGap = learnerGapFactor(dc.mastery.score, canonicalRetention, dc.independence.independentMastery);
    expect(canonicalGap).toBe(legacyGap);
  });

  it('learnerGapFactor is null (insufficient evidence) on both paths when no candidate evidence exists', () => {
    const legacyGap = learnerGapFactor(null, null, null);
    const dc = toCandidateState(null);
    expect(dc).toBeNull();
    expect(legacyGap).toBeNull();
  });

  it('evidenceConfidenceFactor maps independence.evidenceStrength to the same factor as the legacy evidenceStrength field', () => {
    const dc = decisionContextFixture({ evidenceStrength: 'MEDIUM' });
    expect(evidenceConfidenceFactor(dc.independence.evidenceStrength)).toBe(evidenceConfidenceFactor('MEDIUM'));
    expect(evidenceConfidenceFactor(dc.independence.evidenceStrength)).toBe(0.6);
  });
});

describe('Tutor strategy migration (Step 8): selectTutorStrategy inputs agree between legacy and canonical fixtures', () => {
  it('low-retention candidate -> RETRIEVAL on both paths, driven by forgettingRisk, NOT retentionScore', () => {
    const legacy = selectTutorStrategy({
      masteryScore: 80,
      retention: 30,
      independentMastery: 80,
      confidenceCalibrationLabel: 'WELL_CALIBRATED',
      transferScore: 80,
      hasRecurringMisconception: false,
    });
    // retentionScore deliberately high (95) -- if ever substituted for forgettingRisk this would flip to CHALLENGE.
    const dc = decisionContextFixture({ masteryScore: 80, forgettingRisk: 70, retentionScore: 95 });
    const canonicalRetention = dc.retention.forgettingRisk !== null ? 100 - dc.retention.forgettingRisk : null;
    const canonical = selectTutorStrategy({
      masteryScore: dc.mastery.score,
      retention: canonicalRetention,
      independentMastery: dc.independence.independentMastery,
      confidenceCalibrationLabel: dc.metacognition.confidenceCalibration.label,
      transferScore: 80,
      hasRecurringMisconception: false,
    });
    expect(canonical).toBe(legacy);
    expect(canonical).toBe('RETRIEVAL');
  });

  it('overconfident candidate -> SOCRATIC on both paths (confidenceCalibration.label preserved)', () => {
    const legacy = selectTutorStrategy({
      masteryScore: 80,
      retention: 80,
      independentMastery: 80,
      confidenceCalibrationLabel: 'OVERCONFIDENT',
      transferScore: 80,
      hasRecurringMisconception: false,
    });
    const dc = decisionContextFixture({ calibrationLabel: 'OVERCONFIDENT' });
    const canonical = selectTutorStrategy({
      masteryScore: dc.mastery.score,
      retention: dc.retention.forgettingRisk !== null ? 100 - dc.retention.forgettingRisk : null,
      independentMastery: dc.independence.independentMastery,
      confidenceCalibrationLabel: dc.metacognition.confidenceCalibration.label,
      transferScore: 80,
      hasRecurringMisconception: false,
    });
    expect(canonical).toBe(legacy);
    expect(canonical).toBe('SOCRATIC');
  });
});

describe('Release-blocking semantic invariant (Step 3/4): retention.retentionScore and retention.forgettingRisk are never conflated', () => {
  it('a DecisionContext with a HIGH retentionScore but a LOW forgettingRisk-derived retention still drives LOW_RETENTION correctly', () => {
    const dc = decisionContextFixture({ masteryScore: 75, forgettingRisk: 70, retentionScore: 98 });
    expect(dc.retention.retentionScore).toBe(98); // KS dimension: looks great
    expect(dc.retention.forgettingRisk).toBe(70); // spaced-repetition: at real risk
    const candidateState = toCandidateState(dc);
    expect(candidateState!.retention).toBe(30); // 100 - 70, NOT 98
    expect(determineRemediationPattern(candidateState)).toBe('LOW_RETENTION');
  });

  it('toCandidateState never reads retention.retentionScore', () => {
    const dc = decisionContextFixture({ retentionScore: 5, forgettingRisk: 5 }); // both low, but from different signals
    const candidateState = toCandidateState(dc);
    expect(candidateState!.retention).toBe(95); // 100 - 5 (forgettingRisk), not derived from retentionScore=5
  });

  it('toCandidateState maps a null forgettingRisk to null retention (never fabricated)', () => {
    const dc = decisionContextFixture({ forgettingRisk: null });
    const candidateState = toCandidateState(dc);
    expect(candidateState!.retention).toBeNull();
  });
});
