import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn(async (...queryArgs: any[]) => {
  const sql = (queryArgs[0] as string).replace(/\s+/g, ' ').trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) {
    return { rows: [] };
  }
  if (/^INSERT INTO mastery_records/i.test(sql)) {
    // Phase 2B: the get-or-create upsert -- return value unused by
    // the caller (it re-reads via the locked SELECT immediately after).
    return { rows: [] };
  }
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
    return { rows: [{ id: 'evidence-1' }] };
  }
  if (/INSERT INTO learning_debt/i.test(sql)) {
    return { rows: [] };
  }
  throw new Error(`unexpected query in test: ${sql.slice(0, 120)}`);
});

vi.mock('@/lib/db', () => ({
  db: {
    query: (...args: any[]) => queryMock(...args),
    // Phase 2B: updateMastery runs inside one transaction via a
    // checked-out client -- reuse the same queryMock so every existing
    // SQL-pattern branch above still applies, whether a call came via
    // the pool or the "transaction."
    connect: async () => ({ query: (...args: any[]) => queryMock(...args), release: () => {} }),
  },
}));
vi.mock('@/services/knowledge-state.service', () => ({
  recalculateConceptKnowledgeState: vi.fn().mockResolvedValue(null),
  // Phase 2C: updateMastery's misconception-resolution check calls this
  // unconditionally for a non-observation application -- a minimal
  // valid policy shape is all this file's PRACTICE_QUIZ-only fixtures
  // need (none of them ever qualify as resolution evidence).
  getActiveMasteryPolicy: vi.fn().mockResolvedValue({
    version: 1, minimumUnderstanding: 80, minimumIndependence: 80, minimumApplication: 75,
    minimumRetention: 75, minimumTransfer: 70, requiresTransfer: true, maximumCriticalMisconceptions: 0,
    minimumEvidenceCount: 3, minimumIndependentEvidenceCount: 2, retentionMinGapDays: 3, validationWindowDays: 14,
  }),
}));
// Phase 6 Step 6E: SHADOW MODE projector, unrelated to this metadata
// fixture -- stubbed out like knowledge-state.service above.
vi.mock('@/services/memory-projector.service', () => ({
  projectConceptMemoryState: vi.fn().mockResolvedValue({ state: {}, stateChanged: false, diagnostics: {} }),
}));

import { updateMastery } from '@/services/mastery.service';

beforeEach(() => {
  queryMock.mockClear();
});

describe('Phase 3 Pre-flight -- updateMastery persists optional metadata onto the learning_evidence row it writes', () => {
  it('stamps the exact metadata object passed in, JSON-encoded, as the second-to-last INSERT parameter (operation_key -- Phase 2B -- is last)', async () => {
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
    const metadataParam = params[params.length - 2];
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
    expect(params[params.length - 2]).toBeNull();
  });

  it('leaves operation_key NULL when the caller omits identity -- Phase 2B: unprotected callers keep pre-Phase-2B behavior exactly', async () => {
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
