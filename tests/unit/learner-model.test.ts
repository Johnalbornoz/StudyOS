import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

import {
  getRetention,
  computeAverageConfidence,
  computeConfidenceCalibration,
  shouldAskConfidence,
  getIndependentMastery,
  getEvidenceStrength,
  getEvidenceCoverage,
  getConceptIntelligenceBatch,
  getSubjectLearnerModel,
} from '@/services/learner-model.service';

beforeEach(() => {
  queryMock.mockReset();
});

const rows = (r: any[]) => ({ rows: r });

describe('getRetention', () => {
  it('is null when never practiced', () => {
    expect(getRetention(80, 80, null)).toBeNull();
  });

  it('is high right after recent practice', () => {
    const today = new Date().toISOString();
    const r = getRetention(90, 90, today);
    expect(r).not.toBeNull();
    expect(r as number).toBeGreaterThan(90);
  });

  it('drops for an overdue review', () => {
    // mastery 50/confidence 50 -> short interval; 30 days elapsed is well overdue
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const r = getRetention(50, 50, thirtyDaysAgo);
    expect(r as number).toBeLessThan(50);
  });

  it('asymptotically approaches 0 for a very large elapsed time, never negative', () => {
    const longAgo = new Date(Date.now() - 3650 * 24 * 60 * 60 * 1000).toISOString();
    const r = getRetention(50, 50, longAgo);
    expect(r).not.toBeNull();
    expect(r as number).toBeGreaterThanOrEqual(0);
    expect(r as number).toBeLessThan(10);
  });
});

describe('computeAverageConfidence', () => {
  it('is null with zero samples', () => {
    expect(computeAverageConfidence([])).toBeNull();
  });

  it('averages NOT_SURE/SOMEWHAT_SURE/VERY_SURE onto a 0-100 scale', () => {
    expect(computeAverageConfidence(['VERY_SURE'])).toBe(100);
    expect(computeAverageConfidence(['NOT_SURE'])).toBe(33);
    expect(computeAverageConfidence(['NOT_SURE', 'VERY_SURE'])).toBe(67); // (0.33+1.0)/2 = 0.665 -> 67
  });
});

describe('computeConfidenceCalibration', () => {
  it('is INSUFFICIENT_EVIDENCE with fewer than 3 samples', () => {
    const r = computeConfidenceCalibration([{ confidence: 'VERY_SURE', result: 'incorrect' }]);
    expect(r.score).toBeNull();
    expect(r.label).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.samples).toBe(1);
  });

  it('detects OVERCONFIDENT: high confidence, bad performance', () => {
    const r = computeConfidenceCalibration([
      { confidence: 'VERY_SURE', result: 'incorrect' },
      { confidence: 'VERY_SURE', result: 'incorrect' },
      { confidence: 'VERY_SURE', result: 'incorrect' },
    ]);
    expect(r.label).toBe('OVERCONFIDENT');
    expect(r.score).not.toBeNull();
  });

  it('detects UNDERCONFIDENT: low confidence, good performance', () => {
    const r = computeConfidenceCalibration([
      { confidence: 'NOT_SURE', result: 'correct' },
      { confidence: 'NOT_SURE', result: 'correct' },
      { confidence: 'NOT_SURE', result: 'correct' },
    ]);
    expect(r.label).toBe('UNDERCONFIDENT');
  });

  it('detects WELL_CALIBRATED: confidence consistently tracks performance', () => {
    const r = computeConfidenceCalibration([
      { confidence: 'VERY_SURE', result: 'correct' },
      { confidence: 'VERY_SURE', result: 'correct' },
      { confidence: 'NOT_SURE', result: 'incorrect' },
    ]);
    expect(r.label).toBe('WELL_CALIBRATED');
    expect(r.score).toBeGreaterThan(80);
  });

  it('handles mixed evidence without crashing and stays within 0-100', () => {
    const r = computeConfidenceCalibration([
      { confidence: 'VERY_SURE', result: 'correct' },
      { confidence: 'NOT_SURE', result: 'incorrect' },
      { confidence: 'SOMEWHAT_SURE', result: 'partial' },
      { confidence: 'VERY_SURE', result: 'incorrect' },
    ]);
    expect(r.score).not.toBeNull();
    expect(r.score as number).toBeGreaterThanOrEqual(0);
    expect(r.score as number).toBeLessThanOrEqual(100);
  });
});

describe('shouldAskConfidence', () => {
  const base = { quizMode: 'topic_practice' as const, hasExistingMasteryRecord: true, masteryScore: 70, independentMastery: 65, attemptCount: 3 };

  it('asks on first evidence ever for a concept', () => {
    expect(shouldAskConfidence({ ...base, hasExistingMasteryRecord: false })).toBe(true);
  });

  it('asks on SOLO-mode quizzes (cumulative_assessment/exam_simulation)', () => {
    expect(shouldAskConfidence({ ...base, quizMode: 'cumulative_assessment' })).toBe(true);
    expect(shouldAskConfidence({ ...base, quizMode: 'exam_simulation' })).toBe(true);
  });

  it('asks when mastery and independent mastery disagree by >= 20 points', () => {
    expect(shouldAskConfidence({ ...base, masteryScore: 80, independentMastery: 55 })).toBe(true);
  });

  it('asks on the periodic 5th attempt', () => {
    expect(shouldAskConfidence({ ...base, attemptCount: 5 })).toBe(true);
    expect(shouldAskConfidence({ ...base, attemptCount: 10 })).toBe(true);
  });

  it('does not ask when none of the rules trigger', () => {
    expect(shouldAskConfidence({ ...base, attemptCount: 3 })).toBe(false);
  });
});

describe('getIndependentMastery', () => {
  it('is null with no evidence', async () => {
    queryMock.mockResolvedValueOnce(rows([]));
    expect(await getIndependentMastery('s1', 'c1')).toBeNull();
  });

  it('is null with only one unassisted sample', async () => {
    queryMock.mockResolvedValueOnce(rows([{ result: 'correct' }]));
    expect(await getIndependentMastery('s1', 'c1')).toBeNull();
  });

  it('averages mixed outcomes across >= 2 samples', async () => {
    queryMock.mockResolvedValueOnce(rows([{ result: 'correct' }, { result: 'partial' }, { result: 'incorrect' }]));
    // (100 + 50 + 0) / 3 = 50
    expect(await getIndependentMastery('s1', 'c1')).toBe(50);
  });

  it('queries only unassisted evidence, most recent first, capped at 10', async () => {
    queryMock.mockResolvedValueOnce(rows([{ result: 'correct' }, { result: 'correct' }]));
    await getIndependentMastery('s1', 'c1');
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain("ai_assistance_type = 'NONE'");
    expect(sql).toContain('LIMIT 10');
  });
});

describe('getEvidenceStrength', () => {
  it('is null with zero attempts', async () => {
    queryMock.mockResolvedValueOnce(rows([])); // mastery_records lookup: no row
    expect(await getEvidenceStrength('s1', 'c1')).toBeNull();
  });

  it('is LOW with few, old, single-source attempts', async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    queryMock.mockResolvedValueOnce(rows([{ attempt_count: 1, last_practiced: oldDate }]));
    queryMock.mockResolvedValueOnce(rows([{ source_type: 'PRACTICE_QUESTION' }]));
    expect(await getEvidenceStrength('s1', 'c1')).toBe('LOW');
  });

  it('is HIGH with many recent attempts, diverse sources, and a real exam', async () => {
    const recent = new Date().toISOString();
    queryMock.mockResolvedValueOnce(rows([{ attempt_count: 8, last_practiced: recent }]));
    queryMock.mockResolvedValueOnce(rows([{ source_type: 'PRACTICE_QUESTION' }, { source_type: 'REAL_SCHOOL_EXAM' }]));
    // quantity: min(8,5)*10=50, recency: <=14d =20, diversity: 2 types =15, real exam =15 -> 100
    expect(await getEvidenceStrength('s1', 'c1')).toBe('HIGH');
  });

  it('is MEDIUM in between', async () => {
    const recent = new Date().toISOString();
    queryMock.mockResolvedValueOnce(rows([{ attempt_count: 2, last_practiced: recent }]));
    queryMock.mockResolvedValueOnce(rows([{ source_type: 'PRACTICE_QUESTION' }]));
    // quantity: 2*10=20, recency: 20, diversity: 0, exam: 0 -> 40 -> MEDIUM
    expect(await getEvidenceStrength('s1', 'c1')).toBe('MEDIUM');
  });
});

describe('getEvidenceCoverage', () => {
  it('is null when the scope has 0 concepts', async () => {
    queryMock.mockResolvedValueOnce(rows([{ count: 0 }]));
    expect(await getEvidenceCoverage('s1', 'subj1')).toBeNull();
  });

  it('is 100% for 1/1', async () => {
    queryMock.mockResolvedValueOnce(rows([{ count: 1 }]));
    queryMock.mockResolvedValueOnce(rows([{ count: 1 }]));
    expect(await getEvidenceCoverage('s1', 'subj1')).toEqual({ totalConcepts: 1, evidencedConcepts: 1, percent: 100 });
  });

  it('is 20% for 1/5 (a concept without a mastery record stays uncovered, not 0%)', async () => {
    queryMock.mockResolvedValueOnce(rows([{ count: 5 }]));
    queryMock.mockResolvedValueOnce(rows([{ count: 1 }]));
    expect(await getEvidenceCoverage('s1', 'subj1')).toEqual({ totalConcepts: 5, evidencedConcepts: 1, percent: 20 });
  });

  it('is 100% for 5/5', async () => {
    queryMock.mockResolvedValueOnce(rows([{ count: 5 }]));
    queryMock.mockResolvedValueOnce(rows([{ count: 5 }]));
    expect(await getEvidenceCoverage('s1', 'subj1')).toEqual({ totalConcepts: 5, evidencedConcepts: 5, percent: 100 });
  });

  it('scopes the overall (no subjectId) query to active subjects only', async () => {
    queryMock.mockResolvedValueOnce(rows([{ count: 3 }]));
    queryMock.mockResolvedValueOnce(rows([{ count: 2 }]));
    await getEvidenceCoverage('s1');
    const totalSql = queryMock.mock.calls[0][0] as string;
    const evidencedSql = queryMock.mock.calls[1][0] as string;
    expect(totalSql).toContain("s.status = 'active'");
    expect(evidencedSql).toContain("s.status = 'active'");
  });
});

describe('getConceptIntelligenceBatch (Concept -> Topic/Subtopic aggregation input)', () => {
  it('returns an empty map for an empty concept list without querying', async () => {
    const result = await getConceptIntelligenceBatch('s1', []);
    expect(result.size).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('computes independent mastery and calibration per concept from one batched query', async () => {
    queryMock.mockResolvedValueOnce(
      rows([
        { concept_id: 'a', ai_assistance_type: 'NONE', result: 'correct', confidence_before_answer: 'VERY_SURE' },
        { concept_id: 'a', ai_assistance_type: 'NONE', result: 'correct', confidence_before_answer: 'VERY_SURE' },
        { concept_id: 'a', ai_assistance_type: 'NONE', result: 'incorrect', confidence_before_answer: 'VERY_SURE' },
        // concept 'b' has no rows at all -> should still appear in the map with nulls
      ])
    );
    const result = await getConceptIntelligenceBatch('s1', ['a', 'b']);
    expect(result.get('a')?.independentMastery).toBe(67); // (100+100+0)/3
    expect(result.get('a')?.confidenceCalibration).not.toBeNull(); // 3 samples, HIGH confidence, 2/3 correct -> some overconfidence signal
    expect(result.get('b')).toEqual({ independentMastery: null, confidenceCalibration: null });
  });
});

describe('getSubjectLearnerModel (Subject Intelligence)', () => {
  it('returns all-null / zero-count when the subject has no mastery records', async () => {
    // Query order inside getSubjectLearnerModel: mastery_records, then
    // Step 6J-B1's batch concept_memory_state read, then (0 conceptIds
    // -> getConceptIntelligenceBatch skips its query entirely), then
    // learning_debt count, then getEvidenceCoverage's two queries
    // (total concepts, evidenced concepts).
    queryMock
      .mockResolvedValueOnce(rows([])) // mastery_records
      .mockResolvedValueOnce(rows([])) // concept_memory_state batch read (Step 6J-B1)
      .mockResolvedValueOnce(rows([{ count: 0 }])) // debt count
      .mockResolvedValueOnce(rows([{ count: 0 }])); // evidence coverage: total concepts (0 -> coverage is null, second query never runs)

    const result = await getSubjectLearnerModel('s1', 'subj1');
    expect(result.avgMastery).toBeNull();
    expect(result.avgRetention).toBeNull();
    expect(result.avgIndependentMastery).toBeNull();
    expect(result.avgConfidenceCalibration).toBeNull();
    expect(result.activeLearningDebtCount).toBe(0);
    expect(result.atRiskCount).toBe(0);
  });
});

// getLearnerModelSummary was removed in Phase 1C -- confirmed zero live
// callers (Phase 1A and re-confirmed Phase 1C). Its equivalent capability
// now lives in the canonical Digital Learning Twin's getOverview
// (src/lib/learner-twin), covered by tests/unit/learner-twin.test.ts.
