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
