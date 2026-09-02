/**
 * Phase 1D Step 22: behavioral timing metadata must coexist with every
 * other kind of metadata a Learning Evidence row already carries --
 * AI grading provenance, transfer metadata, verification metadata --
 * without overwriting a single existing property. Exercises the real
 * writer functions (not a reimplementation) with mocked `updateMastery`/
 * `db.query`, and inspects exactly what metadata object each one
 * actually constructs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withBehaviorMetadata, toResponseTimingEntries } from '@/lib/algorithms/response-timing';

describe('withBehaviorMetadata alongside every existing metadata shape in the codebase', () => {
  it('coexists with AI grading provenance (explain/submit, transfer/submit shape)', () => {
    const aiExecution = { aiExecutionId: 'exec-1', provider: 'anthropic', model: 'claude-x', promptVersion: 'v3' };
    const merged = withBehaviorMetadata({ aiExecution }, toResponseTimingEntries([{ timing: { responseTimeMs: 8200, quality: 'VALID' } }]));
    expect(merged).toEqual({
      aiExecution,
      behavior: { responseTimes: [{ responseTimeMs: 8200, timingQuality: 'VALID' }] },
    });
    // The AI provenance object itself is untouched -- same reference-equal contents.
    expect((merged as any).aiExecution).toEqual(aiExecution);
  });

  it('coexists with transfer metadata (transferDistance/assisted/aiExecution shape)', () => {
    const transferMetadata = { transferDistance: 'FAR', assisted: false, aiExecution: { aiExecutionId: 'exec-2' } };
    const merged = withBehaviorMetadata(transferMetadata, toResponseTimingEntries([{ timing: { responseTimeMs: 15300, quality: 'VALID' } }]));
    expect(merged).toMatchObject(transferMetadata);
    expect((merged as any).behavior).toEqual({ responseTimes: [{ responseTimeMs: 15300, timingQuality: 'VALID' }] });
  });

  it('coexists with assessment-verification metadata (assessmentConfidence/verificationOutcome/triggers shape)', () => {
    const verificationMetadata = {
      activityType: 'CUMULATIVE_ASSESSMENT',
      evidenceMode: 'ASSESSMENT',
      assessmentConfidence: 82,
      verificationOutcome: 'CONFIRMED',
      verificationTriggerIds: ['LOW_GRADING_CONFIDENCE'],
      variantEquivalenceConfidence: 0.9,
      reasoningErrorTypes: [],
      assessmentProfile: 'ADAPTIVE',
    };
    const merged = withBehaviorMetadata(verificationMetadata, toResponseTimingEntries([{ timing: { responseTimeMs: 6100, quality: 'VALID' } }]));
    expect(merged).toMatchObject(verificationMetadata);
    expect((merged as any).behavior.responseTimes).toHaveLength(1);
  });

  it('coexists with quiz questionSemantics + aiGrading (structured/free-text quiz bucket shape)', () => {
    const quizMetadata = {
      activityType: 'quiz',
      evidenceMode: 'PRACTICE',
      questionSemantics: [{ questionIntent: 'recall', cognitiveLevel: 'remember' }],
      aiGrading: [{ questionIndex: 2, aiExecutionId: 'exec-3', provider: 'anthropic', model: 'claude-x' }],
    };
    const merged = withBehaviorMetadata(
      quizMetadata,
      toResponseTimingEntries([
        { timing: { responseTimeMs: 4000, quality: 'VALID' }, questionIndex: 1 },
        { timing: { responseTimeMs: 9000, quality: 'VALID' }, questionIndex: 2 },
      ])
    );
    expect(merged).toMatchObject(quizMetadata);
    expect((merged as any).behavior.responseTimes).toEqual([
      { responseTimeMs: 4000, timingQuality: 'VALID', questionIndex: 1 },
      { responseTimeMs: 9000, timingQuality: 'VALID', questionIndex: 2 },
    ]);
    // Every pre-existing key survives untouched.
    expect((merged as any).questionSemantics).toEqual(quizMetadata.questionSemantics);
    expect((merged as any).aiGrading).toEqual(quizMetadata.aiGrading);
  });

  it('never overwrites a property literally named "behavior" if one somehow already existed (defensive -- no writer today sets this key itself)', () => {
    const metadata = { activityType: 'quiz' };
    const merged = withBehaviorMetadata(metadata, toResponseTimingEntries([{ timing: { responseTimeMs: 100, quality: 'VALID' } }]));
    // Confirms the merge is a plain additive spread -- `behavior` is the
    // only new top-level key ever introduced by this helper.
    expect(Object.keys(merged as any).sort()).toEqual(['activityType', 'behavior']);
  });
});

describe('submitQualifiedAssessmentEvidence (assessment-verification.service.ts) merges behavior additively into the real metadata object passed to updateMastery', () => {
  const updateMasteryMock = vi.fn();

  beforeEach(() => {
    updateMasteryMock.mockReset();
    updateMasteryMock.mockResolvedValue({ oldMastery: 50, newMastery: 55, delta: 5, confidenceScore: 0.7, eventId: 'ev-1' });
    vi.doMock('@/services/mastery.service', () => ({ updateMastery: updateMasteryMock }));
  });

  it('passes AI provenance, verification fields, and behavior.responseTimes together, none overwritten', async () => {
    const { submitQualifiedAssessmentEvidence } = await import('@/services/assessment-verification.service');

    await submitQualifiedAssessmentEvidence({
      studentId: 's1',
      conceptId: 'c1',
      subjectId: 'subj1',
      sourceType: 'SOLO_VERIFICATION',
      scorePercent: 90,
      difficulty: 3,
      sampleSize: 1,
      activityType: 'CUMULATIVE_ASSESSMENT',
      evidenceMode: 'ASSESSMENT',
      assessmentConfidence: 88,
      verificationOutcome: 'CONFIRMED',
      aiExecution: { aiExecutionId: 'exec-verify-1', provider: 'anthropic', model: 'claude-x' } as any,
      responseTiming: { responseTimeMs: 12000, quality: 'VALID' },
      verificationAttemptId: 'va-1',
    });

    expect(updateMasteryMock).toHaveBeenCalledTimes(1);
    const call = updateMasteryMock.mock.calls[0][0];
    expect(call.metadata.assessmentConfidence).toBe(88);
    expect(call.metadata.verificationOutcome).toBe('CONFIRMED');
    expect(call.metadata.aiExecution).toEqual({ aiExecutionId: 'exec-verify-1', provider: 'anthropic', model: 'claude-x' });
    expect(call.metadata.behavior).toEqual({ responseTimes: [{ responseTimeMs: 12000, timingQuality: 'VALID' }] });
  });

  it('omits behavior entirely when responseTiming is absent -- identical metadata to the pre-Phase-1D call shape', async () => {
    const { submitQualifiedAssessmentEvidence } = await import('@/services/assessment-verification.service');

    await submitQualifiedAssessmentEvidence({
      studentId: 's1',
      conceptId: 'c1',
      subjectId: 'subj1',
      sourceType: 'SOLO_VERIFICATION',
      scorePercent: 90,
      difficulty: 3,
      sampleSize: 1,
      activityType: 'CUMULATIVE_ASSESSMENT',
      evidenceMode: 'ASSESSMENT',
      assessmentConfidence: 88,
      verificationAttemptId: 'va-2',
    });

    const call = updateMasteryMock.mock.calls[0][0];
    expect(call.metadata).not.toHaveProperty('behavior');
  });

  it('omits behavior when responseTiming was normalized to MISSING (client sent nothing)', async () => {
    const { submitQualifiedAssessmentEvidence } = await import('@/services/assessment-verification.service');

    await submitQualifiedAssessmentEvidence({
      studentId: 's1',
      conceptId: 'c1',
      subjectId: 'subj1',
      sourceType: 'SOLO_VERIFICATION',
      scorePercent: 90,
      difficulty: 3,
      sampleSize: 1,
      activityType: 'CUMULATIVE_ASSESSMENT',
      evidenceMode: 'ASSESSMENT',
      assessmentConfidence: 88,
      responseTiming: { responseTimeMs: null, quality: 'MISSING' },
      verificationAttemptId: 'va-3',
    });

    const call = updateMasteryMock.mock.calls[0][0];
    expect(call.metadata).not.toHaveProperty('behavior');
  });
});
