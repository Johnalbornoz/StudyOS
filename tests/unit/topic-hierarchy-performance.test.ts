import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const ensureTopicHierarchyLocalizationsMock = vi.fn();
const ensureConceptLocalizationsMock = vi.fn();
vi.mock('@/services/localization.service', () => ({
  ensureTopicHierarchyLocalizations: (...a: any[]) => ensureTopicHierarchyLocalizationsMock(...a),
  ensureConceptLocalizations: (...a: any[]) => ensureConceptLocalizationsMock(...a),
}));

const getConceptIntelligenceBatchMock = vi.fn();
vi.mock('@/services/learner-model.service', () => ({
  getRetention: vi.fn(),
  getConceptIntelligenceBatch: (...a: any[]) => getConceptIntelligenceBatchMock(...a),
}));

import { getSubjectHierarchy } from '@/services/topic-hierarchy.service';

const STUDENT = 's1';
const SUBJECT = 'subj1';

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (/SELECT id FROM concepts WHERE subject_id/i.test(sql)) return { rows: [{ id: 'c1' }] };
    return { rows: [] }; // the main hierarchy SELECT -- empty is fine, only shape/timing matters here
  });
  getConceptIntelligenceBatchMock.mockReset().mockResolvedValue(new Map());
  ensureConceptLocalizationsMock.mockReset().mockResolvedValue(undefined);
  ensureTopicHierarchyLocalizationsMock.mockReset();
});

describe('getSubjectHierarchy: topic/subtopic translation never blocks the page (performance fix)', () => {
  it('resolves without waiting for ensureTopicHierarchyLocalizations to finish -- a slow/never-resolving translation call cannot hang the subject page', async () => {
    // Never resolves during this test -- if getSubjectHierarchy awaited
    // it, this test would time out instead of completing.
    ensureTopicHierarchyLocalizationsMock.mockReturnValue(new Promise(() => {}));

    const result = await getSubjectHierarchy(SUBJECT, STUDENT, 'es');

    expect(result).toEqual({ topics: [], unassigned: [] });
    expect(ensureTopicHierarchyLocalizationsMock).toHaveBeenCalledWith(SUBJECT, 'es');
  });

  it('a rejected background translation is caught and never surfaces as an unhandled rejection or a thrown error', async () => {
    ensureTopicHierarchyLocalizationsMock.mockRejectedValue(new Error('Claude call failed'));

    await expect(getSubjectHierarchy(SUBJECT, STUDENT, 'es')).resolves.toEqual({ topics: [], unassigned: [] });
  });

  it('concept-label localization also stays fire-and-forget, unchanged from before', async () => {
    ensureTopicHierarchyLocalizationsMock.mockResolvedValue(undefined);
    ensureConceptLocalizationsMock.mockReturnValue(new Promise(() => {}));

    await expect(getSubjectHierarchy(SUBJECT, STUDENT, 'es')).resolves.toEqual({ topics: [], unassigned: [] });
    expect(ensureConceptLocalizationsMock).toHaveBeenCalledWith(['c1'], 'es');
  });
});

describe('getSubjectHierarchy: hasEvidence is real evidence, never a mastery row (OE-008)', () => {
  const topicRow = (over: Record<string, unknown>) => ({ topic_id: 't1', topic_name: 'T', topic_order: 1, subtopic_id: 'st1', subtopic_name: 'S', subtopic_order: 1, concept_label: 'C', confidence_score: '0.00', last_practiced: null, ...over });

  it('a concept with only its zero-valued placeholder mastery row has no evidence; one with learning evidence has', async () => {
    ensureTopicHierarchyLocalizationsMock.mockResolvedValue(undefined);
    queryMock.mockImplementation(async (sql: string) => {
      if (/SELECT id FROM concepts WHERE subject_id/i.test(sql)) return { rows: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] };
      if (/JOIN subtopics st/.test(sql)) {
        return { rows: [topicRow({ concept_id: 'c1', mastery_score: '0.00', has_evidence: false }), topicRow({ concept_id: 'c2', mastery_score: '0.40', has_evidence: true })] };
      }
      if (/c\.subtopic_id IS NULL/.test(sql)) return { rows: [{ id: 'c3', label: 'U', mastery_score: '0.00', confidence_score: '0.00', last_practiced: null, has_evidence: false }] };
      return { rows: [] };
    });
    const result = await getSubjectHierarchy(SUBJECT, STUDENT, 'es');
    const [placeholder, evidenced] = result.topics[0].subtopics[0].concepts;
    expect(placeholder.hasEvidence).toBe(false);
    expect(evidenced.hasEvidence).toBe(true);
    expect(result.unassigned[0].hasEvidence).toBe(false);

    const hierarchySql = queryMock.mock.calls.map((c) => c[0] as string).filter((s) => /has_evidence/.test(s));
    expect(hierarchySql).toHaveLength(2);
    for (const sql of hierarchySql) expect(sql).toMatch(/EXISTS \(SELECT 1 FROM learning_evidence e WHERE e\.student_id = \$2 AND e\.concept_id = c\.id\) AS has_evidence/);
  });
});
