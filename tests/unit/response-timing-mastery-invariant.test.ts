/**
 * Phase 1D Step 21 -- RELEASE-BLOCKING MASTERY INVARIANT.
 *
 * CORE INVARIANT: response-time telemetry must never change mastery,
 * grading, or Knowledge State inputs. This test calls the real
 * `updateMastery` (mastery.service.ts) twice with an otherwise-
 * identical MasteryUpdateInput -- once with `metadata.behavior`
 * present, once without -- and asserts every DB write and every
 * downstream call (mastery_records UPDATE, mastery_events INSERT,
 * decision_events, learning_evidence INSERT, Knowledge State
 * recalculation) is byte-identical except the one JSON metadata
 * parameter, where the only difference allowed is the added `behavior`
 * key itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MASTERY_RECORD = {
  id: 'mastery-record-1',
  mastery_score: '70.00',
  confidence_score: '65.00',
  attempt_count: '5',
  correct_count: '4',
  incorrect_count: '1',
  last_practiced: '2026-08-20T10:00:00.000Z',
  last_assessed: '2026-08-20T10:00:00.000Z',
};

function buildQueryMock() {
  return vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) {
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO mastery_records')) {
      // Phase 2B: the get-or-create upsert -- return value unused (the
      // locked SELECT immediately below is what's actually read).
      return { rows: [] };
    }
    if (s.includes('FROM mastery_records') && s.includes('WHERE student_id = $1 AND concept_id = $2')) {
      return { rows: [MASTERY_RECORD] };
    }
    if (s.includes('SELECT result') && s.includes('FROM learning_evidence')) {
      return { rows: [{ result: 'correct' }, { result: 'correct' }, { result: 'correct' }] };
    }
    if (s.startsWith('UPDATE mastery_records')) {
      return { rows: [{ id: MASTERY_RECORD.id }] };
    }
    if (s.startsWith('INSERT INTO mastery_events')) {
      return { rows: [{ id: 'event-1' }] };
    }
    if (s.startsWith('INSERT INTO learning_evidence')) {
      return { rows: [{ id: 'evidence-1' }] };
    }
    throw new Error(`Unmocked query in mastery-invariant fixture: ${s}`);
  });
}

async function runUpdateMastery(metadata: Record<string, unknown> | undefined) {
  // Each call gets a completely fresh module graph -- without this, the
  // second call in a test would reuse the first call's already-cached
  // `mastery.service` module (and its closed-over mocked dependencies),
  // silently defeating the second set of vi.doMock calls below.
  vi.resetModules();

  const queryMock = buildQueryMock();
  const recordDecisionEventMock = vi.fn().mockResolvedValue(undefined);
  const recalculateMock = vi.fn().mockResolvedValue(undefined);

  vi.doMock('@/lib/db', () => ({
    db: {
      query: queryMock,
      // Phase 2B: updateMastery runs inside one transaction via a
      // checked-out client -- reuse the same queryMock so every
      // existing SQL-pattern branch above still applies.
      connect: async () => ({ query: (...args: any[]) => queryMock(...(args as [string, any[]?])), release: () => {} }),
    },
  }));
  vi.doMock('@/lib/audit', () => ({ recordDecisionEvent: recordDecisionEventMock }));
  vi.doMock('./knowledge-state.service', () => ({ recalculateConceptKnowledgeState: recalculateMock }));
  vi.doMock('@/services/knowledge-state.service', () => ({ recalculateConceptKnowledgeState: recalculateMock }));

  const { updateMastery } = await import('@/services/mastery.service');

  const result = await updateMastery({
    studentId: 'student-1',
    conceptId: 'concept-1',
    subjectId: 'subject-1',
    evidence: {
      result: 'correct',
      difficulty: 3,
      sourceType: 'PRACTICE_QUIZ',
      confidenceWeight: 0.9,
      scorePercent: 100,
      sampleSize: 1,
    },
    telemetry: { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0, aiAssistanceType: 'NONE' },
    ...(metadata !== undefined ? { metadata } : {}),
  });

  return {
    result,
    updateMasteryRecordsCall: queryMock.mock.calls.find(([sql]) => sql.trim().startsWith('UPDATE mastery_records')),
    masteryEventsCall: queryMock.mock.calls.find(([sql]) => sql.trim().startsWith('INSERT INTO mastery_events')),
    learningEvidenceCall: queryMock.mock.calls.find(([sql]) => sql.trim().startsWith('INSERT INTO learning_evidence')),
    decisionEventArgs: recordDecisionEventMock.mock.calls[0]?.[0],
    recalculateArgs: recalculateMock.mock.calls[0],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@/lib/db');
  vi.doUnmock('@/lib/audit');
  vi.doUnmock('./knowledge-state.service');
  vi.doUnmock('@/services/knowledge-state.service');
});

describe('Phase 1D Step 21: identical evidence with vs. without behavioral timing metadata', () => {
  it('produces an identical MasteryUpdateResult (oldMastery/newMastery/delta/confidenceScore/learningDebtCreated)', async () => {
    const withTiming = await runUpdateMastery({ behavior: { responseTimes: [{ responseTimeMs: 4200, timingQuality: 'VALID' }] } });
    const withoutTiming = await runUpdateMastery(undefined);

    expect(withTiming.result).toEqual(withoutTiming.result);
  });

  it('issues an identical UPDATE mastery_records call (same SQL, same params) regardless of timing metadata', async () => {
    const withTiming = await runUpdateMastery({ behavior: { responseTimes: [{ responseTimeMs: 4200, timingQuality: 'VALID' }] } });
    const withoutTiming = await runUpdateMastery(undefined);

    expect(withTiming.updateMasteryRecordsCall).toEqual(withoutTiming.updateMasteryRecordsCall);
  });

  it('issues an identical INSERT INTO mastery_events call regardless of timing metadata', async () => {
    const withTiming = await runUpdateMastery({ behavior: { responseTimes: [{ responseTimeMs: 4200, timingQuality: 'VALID' }] } });
    const withoutTiming = await runUpdateMastery(undefined);

    expect(withTiming.masteryEventsCall).toEqual(withoutTiming.masteryEventsCall);
  });

  it('records an identical MASTERY_UPDATED decision_event (same reasonDetails/newState) regardless of timing metadata', async () => {
    const withTiming = await runUpdateMastery({ behavior: { responseTimes: [{ responseTimeMs: 4200, timingQuality: 'VALID' }] } });
    const withoutTiming = await runUpdateMastery(undefined);

    expect(withTiming.decisionEventArgs).toEqual(withoutTiming.decisionEventArgs);
  });

  it('triggers Knowledge State recalculation with identical (studentId, conceptId) arguments regardless of timing metadata', async () => {
    const withTiming = await runUpdateMastery({ behavior: { responseTimes: [{ responseTimeMs: 4200, timingQuality: 'VALID' }] } });
    const withoutTiming = await runUpdateMastery(undefined);

    // Phase 2B: a third argument (the atomic transaction's own client)
    // is now always passed too -- a fresh object per call, so compared
    // only for shape, not value/identity, here. The (studentId,
    // conceptId) invariant this test actually exists to prove is
    // exactly the first two.
    expect(withTiming.recalculateArgs?.slice(0, 2)).toEqual(withoutTiming.recalculateArgs?.slice(0, 2));
    expect(withTiming.recalculateArgs?.slice(0, 2)).toEqual(['student-1', 'concept-1']);
    expect(withTiming.recalculateArgs).toHaveLength(3);
  });

  it('the learning_evidence INSERT differs ONLY in the metadata parameter -- and only by the added behavior key', async () => {
    const withTiming = await runUpdateMastery({ behavior: { responseTimes: [{ responseTimeMs: 4200, timingQuality: 'VALID' }] } });
    const withoutTiming = await runUpdateMastery(undefined);

    const [sqlWith, paramsWith]: [string, any[]] = withTiming.learningEvidenceCall as any;
    const [sqlWithout, paramsWithout]: [string, any[]] = withoutTiming.learningEvidenceCall as any;

    expect(sqlWith).toBe(sqlWithout); // identical SQL text
    // Every param except metadata (second-to-last -- Phase 2B added
    // operation_key as the new, always-null-here, actually-last param)
    // is identical -- result/difficulty/timestamp-column/subject/
    // activity/mode/hints/AI-assistance/confidence/scorePercent are all
    // untouched by timing.
    expect(paramsWith.slice(0, -2)).toEqual(paramsWithout.slice(0, -2));

    const metadataWith = JSON.parse(paramsWith[paramsWith.length - 2]);
    const metadataWithout = paramsWithout[paramsWithout.length - 2];
    expect(metadataWithout).toBeNull(); // no metadata passed at all -> exactly the pre-Phase-1D NULL
    expect(metadataWith).toEqual({ behavior: { responseTimes: [{ responseTimeMs: 4200, timingQuality: 'VALID' }] } });

    // Phase 2B: neither call supplied `identity`, so operation_key
    // (the true last param) is NULL for both -- unrelated to, and
    // unaffected by, the timing-metadata invariant this test proves.
    expect(paramsWith[paramsWith.length - 1]).toBeNull();
    expect(paramsWithout[paramsWithout.length - 1]).toBeNull();
  });
});
