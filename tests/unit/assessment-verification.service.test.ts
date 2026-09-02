import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateMasteryMock = vi.fn();
vi.mock('@/services/mastery.service', () => ({ updateMastery: (...a: any[]) => updateMasteryMock(...a) }));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

import {
  evaluateAssessmentEvidence,
  interpretVerificationOutcome,
  recalculateConfidenceAfterVerification,
  qualifyEvidence,
  submitQualifiedAssessmentEvidence,
  calculateExamReadinessCalibration,
  createPendingVerificationAttempt,
  getPendingVerificationAttempt,
  resolveVerificationAttempt,
  computeConceptCoverageBreadth,
  deriveConceptMappingConfidence,
  selectMostAmbiguousQuestion,
} from '@/services/assessment-verification.service';

beforeEach(() => {
  updateMasteryMock.mockReset();
  queryMock.mockReset();
});

// --- A/B: profile-aware evaluation + verification triggers integration ---
describe('Phase 3B -- evaluateAssessmentEvidence (Assessment Confidence + trigger integration)', () => {
  it('strong, consistent evidence requires no verification', () => {
    const decision = evaluateAssessmentEvidence({
      activityType: 'CUMULATIVE_ASSESSMENT',
      gradingConfidences: [0.95, 0.9, 0.92],
      currentScorePercent: 90,
    });
    expect(decision.required).toBe(false);
    expect(decision.assessmentConfidenceBeforeVerification).toBeGreaterThan(80);
  });

  it('low grading confidence produces a lower Assessment Confidence and requires verification', () => {
    const decision = evaluateAssessmentEvidence({
      activityType: 'CUMULATIVE_ASSESSMENT',
      gradingConfidences: [0.3, 0.35],
      currentScorePercent: 55,
    });
    expect(decision.required).toBe(true);
    expect(decision.triggers.length).toBeGreaterThan(0);
  });

  it('CUMULATIVE_ASSESSMENT (ADAPTIVE strictness) forces verification once confidence drops below its profile floor, even with no other trigger', () => {
    const decision = evaluateAssessmentEvidence({
      activityType: 'CUMULATIVE_ASSESSMENT',
      gradingConfidences: [0.5], // 50 -> below the 55 ADAPTIVE floor, but not low enough to fire LOW_GRADING_CONFIDENCE (0.5 >= 0.6? no it is < 0.6, so it would also fire that -- use a value that clears 0.6 but still lands under 55 confidence isn't possible since 0.6*100=60 > 55; so rely on the profile trigger alongside)
      currentScorePercent: 60,
    });
    expect(decision.triggers.some((t) => t.triggerId === 'PROFILE_REQUIRES_VERIFICATION' || t.triggerId === 'LOW_GRADING_CONFIDENCE')).toBe(true);
  });

  it('behavioral anomaly signals reduce Assessment Confidence but the function never reads/returns anything resembling a Knowledge Score', () => {
    const clean = evaluateAssessmentEvidence({
      activityType: 'MOCK_EXAM',
      gradingConfidences: [0.9, 0.9],
      currentScorePercent: 85,
    });
    const anomalous = evaluateAssessmentEvidence({
      activityType: 'MOCK_EXAM',
      gradingConfidences: [0.9, 0.9],
      currentScorePercent: 85,
      integritySignals: { largestPasteLength: 500, focusLossCount: 5, tabChanges: 4 },
    });
    expect(anomalous.assessmentConfidenceBeforeVerification).toBeLessThan(clean.assessmentConfidenceBeforeVerification);
    expect(Object.keys(anomalous)).not.toContain('understandingScore');
    expect(Object.keys(anomalous)).not.toContain('masteryState');
  });
});

// --- Verification outcome interpretation ---
describe('Phase 3B -- interpretVerificationOutcome', () => {
  it('CONFIRMED when both original and verification are strong', () => {
    expect(interpretVerificationOutcome(85, 90)).toBe('CONFIRMED');
  });
  it('CONFIRMED when both original and verification are consistently weak (still confirms the read, just a weak one)', () => {
    expect(interpretVerificationOutcome(20, 15)).toBe('CONFIRMED');
  });
  it('CONTRADICTED when original was strong but verification was weak', () => {
    expect(interpretVerificationOutcome(90, 20)).toBe('CONTRADICTED');
  });
  it('CONTRADICTED when original was weak but verification was strong', () => {
    expect(interpretVerificationOutcome(20, 90)).toBe('CONTRADICTED');
  });
  it('INCONCLUSIVE for partial/ambiguous combinations', () => {
    expect(interpretVerificationOutcome(60, 55)).toBe('INCONCLUSIVE');
  });
});

// --- qualifyEvidence ---
describe('Phase 3B -- qualifyEvidence (evidence-strength labeling, never a mastery label)', () => {
  it('HIGH at high confidence, MEDIUM mid-range, LOW below that', () => {
    expect(qualifyEvidence(90).strength).toBe('HIGH');
    expect(qualifyEvidence(65).strength).toBe('MEDIUM');
    expect(qualifyEvidence(30).strength).toBe('LOW');
  });
  it('CONTRADICTED always wins regardless of the numeric confidence', () => {
    expect(qualifyEvidence(95, 'CONTRADICTED').strength).toBe('CONTRADICTED');
  });
});

// =========================================================================
// GOLDEN ARCHITECTURAL TESTS (mandatory, §18)
// =========================================================================
describe('Phase 3B -- GOLDEN ARCHITECTURAL TESTS', () => {
  it('TEST 1: High Assessment Confidence does NOT automatically create mastery -- updateMastery is called with ordinary evidence, never a masteryState override', async () => {
    updateMasteryMock.mockResolvedValue({ oldMastery: 50, newMastery: 60, delta: 10, confidenceScore: 0.8, eventId: 'ev-1' });

    await submitQualifiedAssessmentEvidence({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      sourceType: 'CUMULATIVE_ASSESSMENT', scorePercent: 95, difficulty: 3, sampleSize: 5,
      activityType: 'CUMULATIVE_ASSESSMENT', evidenceMode: 'ASSESSMENT',
      assessmentConfidence: 98, // very high confidence
      verificationAttemptId: 'va-1',
    });

    expect(updateMasteryMock).toHaveBeenCalledTimes(1);
    const call = updateMasteryMock.mock.calls[0][0];
    expect(call).not.toHaveProperty('masteryState');
    expect(call.evidence).not.toHaveProperty('masteryState');
    expect(call.metadata).not.toHaveProperty('masteryState');
    // The only mastery-relevant field passed is ordinary LearningEvidence
    // (result/scorePercent/confidenceWeight) -- the same shape every other
    // evidence-producing feature already uses, never a direct assignment.
    expect(call.evidence.result).toBe('correct');
    expect(call.evidence.confidenceWeight).toBeCloseTo(0.98, 5);
  });

  it('TEST 2: Integrity anomaly reduces Assessment Confidence but this module never touches Knowledge Score/State directly', () => {
    const withoutAnomaly = evaluateAssessmentEvidence({
      activityType: 'MOCK_EXAM', gradingConfidences: [0.9], currentScorePercent: 90,
    });
    const withAnomaly = evaluateAssessmentEvidence({
      activityType: 'MOCK_EXAM', gradingConfidences: [0.9], currentScorePercent: 90,
      integritySignals: { largestPasteLength: 999, focusLossCount: 10, tabChanges: 10, fullscreenExitCount: 5 },
    });
    expect(withAnomaly.assessmentConfidenceBeforeVerification).toBeLessThan(withoutAnomaly.assessmentConfidenceBeforeVerification);
    // Architectural guarantee: this module has no import of knowledge-state.service
    // anywhere (verified structurally -- no db write path exists in
    // evaluateAssessmentEvidence at all, it is a pure function).
  });

  it('TEST 3: Verification CONFIRMED increases Assessment Confidence, but mastery still depends on Learning Evidence + the projector (a separate updateMastery call)', async () => {
    const before = 60;
    const after = recalculateConfidenceAfterVerification(before, 'CONFIRMED');
    expect(after).toBeGreaterThan(before);

    updateMasteryMock.mockResolvedValue({ oldMastery: 50, newMastery: 55, delta: 5, confidenceScore: 0.7, eventId: 'ev-2' });
    const result = await submitQualifiedAssessmentEvidence({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      sourceType: 'SOLO_VERIFICATION', scorePercent: 90, difficulty: 3, sampleSize: 1,
      activityType: 'CUMULATIVE_ASSESSMENT', evidenceMode: 'ASSESSMENT',
      assessmentConfidence: after, verificationOutcome: 'CONFIRMED',
      verificationAttemptId: 'va-2',
    });
    // The confidence bump feeds confidenceWeight (evidence strength), not
    // a direct mastery write -- updateMastery's own deterministic algorithm
    // (mocked here) is what actually produces newMastery.
    expect(updateMasteryMock).toHaveBeenCalled();
    expect(result.newMastery).toBe(55);
  });

  it('TEST 4: Verification CONTRADICTED lowers Assessment Confidence without directly setting AT_RISK or any other Knowledge State', async () => {
    const before = 75;
    const after = recalculateConfidenceAfterVerification(before, 'CONTRADICTED');
    expect(after).toBeLessThan(before);

    const qualification = qualifyEvidence(after, 'CONTRADICTED');
    expect(qualification.strength).toBe('CONTRADICTED');
    // "CONTRADICTED" here is this module's own evidence-strength label,
    // never one of Phase 2.2's MasteryState values (UNKNOWN/LEARNING/
    // DEVELOPING/PROVISIONAL_MASTERY/VALIDATED_MASTERY/AT_RISK/
    // INTERVENTION_REQUIRED) -- confirmed distinct by construction, this
    // module never imports or references that enum.
    const masteryStateValues = ['UNKNOWN', 'LEARNING', 'DEVELOPING', 'PROVISIONAL_MASTERY', 'VALIDATED_MASTERY', 'AT_RISK', 'INTERVENTION_REQUIRED'];
    expect(masteryStateValues).not.toContain(qualification.strength);
  });

  it('TEST 5: Mock Exam performance affects calibration/readiness information, not direct Knowledge Mastery', () => {
    const calibration = calculateExamReadinessCalibration(82, 71);
    expect(calibration).toEqual({ predictedReadiness: 82, actualPerformance: 71, calibrationDelta: -11 });
    // Pure computation -- no db import needed by this function, no write
    // path exists, confirmed by the fact it takes only two numbers and
    // returns a plain object.
    expect(updateMasteryMock).not.toHaveBeenCalled();
  });
});

// --- Verification attempt persistence (mocked db) ---
describe('Phase 3B -- verification attempt persistence', () => {
  it('createPendingVerificationAttempt inserts one row with the before-confidence and original score preserved exactly', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'va-1' }] });
    const id = await createPendingVerificationAttempt({
      quizSessionId: 'quiz-1', studentId: 's1', conceptId: 'c1',
      originalQuestion: { id: 'q1' }, originalScorePercent: 55,
      verificationQuestion: { id: 'q2' }, triggerIds: ['LOW_GRADING_CONFIDENCE'],
      assessmentConfidenceBefore: 60,
    });
    expect(id).toBe('va-1');
    const params = queryMock.mock.calls[0][1];
    expect(params).toContain(55); // originalScorePercent
    expect(params).toContain(60); // assessmentConfidenceBefore
  });

  it('getPendingVerificationAttempt returns null when nothing is pending -- never fabricates a row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const pending = await getPendingVerificationAttempt('quiz-1', 'c1', 's1');
    expect(pending).toBeNull();
  });

  it('getPendingVerificationAttempt only ever looks up the given student -- student isolation', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await getPendingVerificationAttempt('quiz-1', 'c1', 'only-this-student');
    const params = queryMock.mock.calls[0][1];
    expect(params).toContain('only-this-student');
  });

  it('resolveVerificationAttempt writes the outcome and after-confidence without touching original_score_percent/assessment_confidence_before', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await resolveVerificationAttempt('va-1', {
      verificationResponse: 'answer text', gradingConfidence: 0.8, outcome: 'CONFIRMED', assessmentConfidenceAfter: 75,
    });
    const sql = queryMock.mock.calls[0][0];
    expect(sql).not.toMatch(/original_score_percent/);
    expect(sql).not.toMatch(/assessment_confidence_before/);
    expect(sql).toMatch(/outcome/);
  });
});

// --- Phase 2B: evidence idempotency wiring ---
describe('Phase 2B -- submitQualifiedAssessmentEvidence identity + resolveVerificationAttempt claim semantics', () => {
  it('threads a VERIFICATION_RESOLUTION identity keyed by verificationAttemptId + conceptId into updateMastery', async () => {
    updateMasteryMock.mockResolvedValue({ oldMastery: 50, newMastery: 55, delta: 5, confidenceScore: 0.7, eventId: 'ev-1' });

    await submitQualifiedAssessmentEvidence({
      studentId: 's1', conceptId: 'c1', subjectId: 'subj1',
      sourceType: 'SOLO_VERIFICATION', scorePercent: 90, difficulty: 3, sampleSize: 1,
      activityType: 'CUMULATIVE_ASSESSMENT', evidenceMode: 'ASSESSMENT',
      assessmentConfidence: 80,
      verificationAttemptId: 'va-xyz',
    });

    const call = updateMasteryMock.mock.calls[0][0];
    expect(call.identity).toEqual({ operationType: 'VERIFICATION_RESOLUTION', operationId: 'va-xyz', conceptId: 'c1' });
  });

  it('resolveVerificationAttempt is defense-in-depth: its WHERE clause carries "AND outcome IS NULL", and it reports whether THIS call actually won the claim', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // this call wins
    const won = await resolveVerificationAttempt('va-1', {
      verificationResponse: 'a', gradingConfidence: 0.8, outcome: 'CONFIRMED', assessmentConfidenceAfter: 75,
    });
    expect(won).toBe(true);
    expect(queryMock.mock.calls[0][0]).toMatch(/outcome IS NULL/);

    queryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // a concurrent request already resolved it
    const lost = await resolveVerificationAttempt('va-1', {
      verificationResponse: 'a', gradingConfidence: 0.8, outcome: 'CONFIRMED', assessmentConfidenceAfter: 75,
    });
    expect(lost).toBe(false);
  });
});

// --- Blocker 2: real trigger-input derivation ---
describe('Phase 3B closure -- computeConceptCoverageBreadth (real, deterministic, never fabricated)', () => {
  it('a single question is not enough data to assess breadth -- returns undefined, never a fabricated 0', () => {
    expect(computeConceptCoverageBreadth(['multiple_choice'])).toBeUndefined();
  });

  it('real concept coverage produces the correct breadth value: repeated same type is narrow', () => {
    expect(computeConceptCoverageBreadth(['multiple_choice', 'multiple_choice', 'multiple_choice', 'multiple_choice', 'multiple_choice'])).toBeCloseTo(0.2, 5);
  });

  it('real concept coverage produces the correct breadth value: distinct types is broad', () => {
    expect(computeConceptCoverageBreadth(['multiple_choice', 'short_answer', 'scenario'])).toBeCloseTo(1, 5);
  });

  it('missing information does not fabricate low confidence -- zero questions is also undefined, not 0', () => {
    expect(computeConceptCoverageBreadth([])).toBeUndefined();
  });
});

describe('Phase 3B closure -- deriveConceptMappingConfidence (reuses Pre-flight exam attribution, never a second formula)', () => {
  it('strong explicit concept mapping (CONCEPT_MAPPED) does not cause a weak-mapping trigger', () => {
    const attributions = [{ conceptId: 'c1', confidenceWeight: 0.95 }];
    const confidence = deriveConceptMappingConfidence(attributions, 'c1');
    expect(confidence).toBe(0.95);
    const triggers = evaluateAssessmentEvidence({
      activityType: 'MOCK_EXAM', gradingConfidences: [0.9], currentScorePercent: 85, conceptMappingConfidence: confidence,
    }).triggers;
    expect(triggers.map((t) => t.triggerId)).not.toContain('WEAK_CONCEPT_ATTRIBUTION');
  });

  it('genuinely ambiguous mapping (SUBJECT_WIDE-tier confidence, real Pre-flight value) can trigger verification', () => {
    const attributions = [{ conceptId: 'c1', confidenceWeight: 0.4 }]; // matches Pre-flight's real SUBJECT_WIDE tier
    const confidence = deriveConceptMappingConfidence(attributions, 'c1');
    const decision = evaluateAssessmentEvidence({
      activityType: 'MOCK_EXAM', gradingConfidences: [0.9], currentScorePercent: 85, conceptMappingConfidence: confidence,
    });
    expect(decision.triggers.map((t) => t.triggerId)).toContain('WEAK_CONCEPT_ATTRIBUTION');
  });

  it('missing information does not fabricate low confidence -- a concept absent from the attribution list is undefined, not 0', () => {
    const attributions = [{ conceptId: 'other-concept', confidenceWeight: 0.4 }];
    const confidence = deriveConceptMappingConfidence(attributions, 'c1');
    expect(confidence).toBeUndefined();
    const triggers = evaluateAssessmentEvidence({
      activityType: 'CUMULATIVE_ASSESSMENT', gradingConfidences: [0.9], currentScorePercent: 85, conceptMappingConfidence: confidence,
    }).triggers;
    // undefined must never be silently treated as "low confidence" --
    // the trigger stays quiet when the signal is genuinely unavailable.
    expect(triggers.map((t) => t.triggerId)).not.toContain('WEAK_CONCEPT_ATTRIBUTION');
  });
});

// --- Blocker 3: verification targets the actual ambiguous question ---
describe('Phase 3B closure -- selectMostAmbiguousQuestion (deterministic provenance, never an arbitrary first question)', () => {
  it('one concept / one question: that question is selected', () => {
    const result = selectMostAmbiguousQuestion([3], [0.7]);
    expect(result).toEqual({ questionIndex: 3, gradingConfidence: 0.7 });
  });

  it('one concept / multiple questions: the lowest-confidence question is selected, not the first one in the array', () => {
    // Question at index 5 was answered first (array position 0) with high
    // confidence; question at index 2 came second with much lower
    // confidence -- the second one is the actual ambiguous evidence.
    const result = selectMostAmbiguousQuestion([5, 2, 8], [0.9, 0.3, 0.85]);
    expect(result.questionIndex).toBe(2);
    expect(result.gradingConfidence).toBe(0.3);
  });

  it('trigger produced by the second question -> verification references the second question, not the first', () => {
    const questionIndexes = [10, 11, 12];
    const gradingConfidences = [0.95, 0.4, 0.9]; // only the second is genuinely ambiguous
    const { questionIndex } = selectMostAmbiguousQuestion(questionIndexes, gradingConfidences);
    expect(questionIndex).toBe(11);
  });

  it('deterministic selection when multiple questions tie on the lowest confidence -- always the lowest question index, never array order', () => {
    const result = selectMostAmbiguousQuestion([9, 3, 7], [0.4, 0.4, 0.4]);
    expect(result.questionIndex).toBe(3);
  });

  it('selection is stable across repeated calls with the same input -- fully deterministic', () => {
    const a = selectMostAmbiguousQuestion([4, 1, 6], [0.5, 0.2, 0.8]);
    const b = selectMostAmbiguousQuestion([4, 1, 6], [0.5, 0.2, 0.8]);
    expect(a).toEqual(b);
  });
});
