import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/services/mastery.service', () => ({ updateMastery: vi.fn() }));
vi.mock('@/services/debt-resolution.service', () => ({ autoResolveDebt: vi.fn() }));

import { getConceptAttribution, type ExamConceptAttribution } from '@/services/exam-result.service';

beforeEach(() => {
  queryMock.mockReset();
});

describe('Phase 3 Pre-flight -- exam concept attribution never uniformly trusts a subject-wide guess', () => {
  it('CONCEPT_MAPPED: uses the exact stored weight/mapping_confidence from assessment_concept_coverage, not a fabricated default', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { concept_id: 'c1', weight: 1.0, mapping_confidence: 0.9 },
        { concept_id: 'c2', weight: 0.3, mapping_confidence: 0.4 },
      ],
    });
    const attributions = await getConceptAttribution('occ-1', 'subj-1', []);
    expect(attributions).toEqual<ExamConceptAttribution[]>([
      { conceptId: 'c1', sourceGranularity: 'CONCEPT_MAPPED', coverageWeight: 1.0, mappingConfidence: 0.9, confidenceWeight: 0.9 },
      { conceptId: 'c2', sourceGranularity: 'CONCEPT_MAPPED', coverageWeight: 0.3, mappingConfidence: 0.4, confidenceWeight: 0.12 },
    ]);
  });

  it('TOPICS_LIST: an explicit topics[] with no coverage mapping gets mid confidence, never full 1.0', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // no assessment_concept_coverage rows
    const attributions = await getConceptAttribution('occ-2', 'subj-1', ['c3', 'c4']);
    expect(attributions).toHaveLength(2);
    for (const a of attributions) {
      expect(a.sourceGranularity).toBe('TOPICS_LIST');
      expect(a.confidenceWeight).toBeLessThan(1.0);
      expect(a.confidenceWeight).toBeGreaterThan(0);
    }
  });

  it('SUBJECT_WIDE: no topics selected at all falls back to every concept in the subject, at the lowest confidence tier', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // no coverage rows
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'c5' }, { id: 'c6' }, { id: 'c7' }] }); // all concepts in subject
    const attributions = await getConceptAttribution('occ-3', 'subj-1', []);
    expect(attributions.map((a) => a.conceptId)).toEqual(['c5', 'c6', 'c7']);
    for (const a of attributions) {
      expect(a.sourceGranularity).toBe('SUBJECT_WIDE');
    }
  });

  it('SUBJECT_WIDE confidence is strictly lower than TOPICS_LIST confidence -- less precision must mean less trust, never the same', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const topicsList = await getConceptAttribution('occ-4', 'subj-1', ['c8']);

    queryMock.mockResolvedValueOnce({ rows: [] });
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'c9' }] });
    const subjectWide = await getConceptAttribution('occ-5', 'subj-1', []);

    expect(subjectWide[0].confidenceWeight).toBeLessThan(topicsList[0].confidenceWeight);
  });

  it('a low-confidence CONCEPT_MAPPED row never gets clamped up past its own mapping_confidence x weight', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ concept_id: 'c10', weight: 0.2, mapping_confidence: 0.2 }] });
    const [a] = await getConceptAttribution('occ-6', 'subj-1', []);
    expect(a.confidenceWeight).toBeCloseTo(0.04, 5);
  });
});
