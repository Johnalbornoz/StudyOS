import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn(async (...queryArgs: any[]) => {
  const sql = queryArgs[0] as string;
  if (/FROM mastery_records/i.test(sql) && /SELECT/i.test(sql)) {
    return { rows: [{ id: 'mr-1', mastery_score: 50, confidence_score: 0.5, attempt_count: 2, correct_count: 1, incorrect_count: 1, last_practiced: null }] };
  }
  if (/SELECT result[\s\S]*FROM learning_evidence/i.test(sql)) {
    return { rows: [] };
  }
  if (/UPDATE mastery_records/i.test(sql)) {
    return { rows: [{ id: 'mr-1' }] };
  }
  if (/INSERT INTO mastery_events/i.test(sql)) {
    return { rows: [{ id: 'ev-1' }] };
  }
  if (/INSERT INTO learning_evidence/i.test(sql)) {
    return { rows: [] };
  }
  if (/INSERT INTO learning_debt/i.test(sql)) {
    return { rows: [] };
  }
  throw new Error(`unexpected query in test: ${sql.slice(0, 120)}`);
});

vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/services/knowledge-state.service', () => ({ recalculateConceptKnowledgeState: vi.fn().mockResolvedValue(null) }));

import { updateMastery } from '@/services/mastery.service';

beforeEach(() => {
  queryMock.mockClear();
});

describe('Phase 3 Pre-flight -- updateMastery persists optional metadata onto the learning_evidence row it writes', () => {
  it('stamps the exact metadata object passed in, JSON-encoded, as the final INSERT parameter', async () => {
    await updateMastery({
      studentId: 's1',
      conceptId: 'c1',
      subjectId: 'subj1',
      evidence: { result: 'correct', difficulty: 3, sourceType: 'REAL_SCHOOL_EXAM', confidenceWeight: 0.4, scorePercent: 82 },
      metadata: { examConceptAttribution: { sourceGranularity: 'SUBJECT_WIDE', coverageWeight: 1.0, mappingConfidence: 0.4, occurrenceId: 'occ-1' } },
    });

    const insertCall = queryMock.mock.calls.find(([sql]) => /INSERT INTO learning_evidence/i.test(sql));
    expect(insertCall).toBeTruthy();
    const params = insertCall![1] as any[];
    const metadataParam = params[params.length - 1];
    expect(JSON.parse(metadataParam)).toEqual({
      examConceptAttribution: { sourceGranularity: 'SUBJECT_WIDE', coverageWeight: 1.0, mappingConfidence: 0.4, occurrenceId: 'occ-1' },
    });
  });

  it('leaves metadata NULL when the caller omits it -- existing callers are unaffected', async () => {
    await updateMastery({
      studentId: 's1',
      conceptId: 'c1',
      subjectId: 'subj1',
      evidence: { result: 'correct', difficulty: 3, sourceType: 'PRACTICE_QUIZ' },
    });

    const insertCall = queryMock.mock.calls.find(([sql]) => /INSERT INTO learning_evidence/i.test(sql));
    const params = insertCall![1] as any[];
    expect(params[params.length - 1]).toBeNull();
  });
});
