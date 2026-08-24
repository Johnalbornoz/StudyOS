import { describe, it, expect } from 'vitest';
import { ASSESSMENT_PROFILES, getAssessmentProfile } from '@/lib/assessment-profiles';

describe('Phase 3B -- Assessment Profiles: Cumulative Assessment and Mock Exam stay distinct', () => {
  it('Cumulative Assessment and Mock Exam are genuinely different configurations, not aliases of each other', () => {
    const cumulative = ASSESSMENT_PROFILES.CUMULATIVE_ASSESSMENT;
    const mock = ASSESSMENT_PROFILES.MOCK_EXAM;
    expect(cumulative).not.toEqual(mock);
    expect(cumulative.verificationStrictness).toBe('ADAPTIVE');
    expect(mock.verificationStrictness).toBe('SELECTIVE');
  });

  it('only Mock Exam has real exam structure/timing and Exam Readiness comparison', () => {
    expect(ASSESSMENT_PROFILES.MOCK_EXAM.timed).toBe(true);
    expect(ASSESSMENT_PROFILES.MOCK_EXAM.examStructure).toBe(true);
    expect(ASSESSMENT_PROFILES.MOCK_EXAM.examReadinessComparison).toBe(true);
    expect(ASSESSMENT_PROFILES.CUMULATIVE_ASSESSMENT.timed).toBe(false);
    expect(ASSESSMENT_PROFILES.CUMULATIVE_ASSESSMENT.examStructure).toBe(false);
    expect(ASSESSMENT_PROFILES.CUMULATIVE_ASSESSMENT.examReadinessComparison).toBe(false);
  });

  it('getAssessmentProfile resolves the correct profile by Activity Type', () => {
    expect(getAssessmentProfile('CUMULATIVE_ASSESSMENT')).toBe(ASSESSMENT_PROFILES.CUMULATIVE_ASSESSMENT);
    expect(getAssessmentProfile('MOCK_EXAM')).toBe(ASSESSMENT_PROFILES.MOCK_EXAM);
  });

  it('returns null for any Activity Type that is not a profiled Assessment activity', () => {
    expect(getAssessmentProfile('PRACTICE')).toBeNull();
    expect(getAssessmentProfile('SOLO_CHECK')).toBeNull();
    expect(getAssessmentProfile('RETENTION_CHECK')).toBeNull();
  });

  it('profiles never define a mastery threshold field -- that belongs exclusively to Phase 2.2 mastery_policies', () => {
    for (const profile of Object.values(ASSESSMENT_PROFILES)) {
      const keys = Object.keys(profile).join(',').toLowerCase();
      expect(keys).not.toContain('mastery');
    }
  });
});
