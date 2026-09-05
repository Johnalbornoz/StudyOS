/**
 * Phase 1D Steps 16-19, corrected by Phase 1D-R: the Digital Learning
 * Twin's read integration for behavioral evidence. Covers: reading
 * from learning_evidence.metadata only (no new table), bounding/
 * flattening across rows, BEHAVIOR_OBSERVATION data-quality tagging,
 * and the NO_TIMING_DATA-vs-0ms/fast distinction (Step 19) -- a
 * concept with no instrumented evidence yet must read back as an
 * empty, honest signal, never a fabricated fast reading.
 *
 * Sample-count semantics (Phase 1D-R): VALID, OUTLIER, and INVALID/
 * CLOCK_SKEW are three MUTUALLY EXCLUSIVE categories --
 * validSampleCount counts ONLY quality === 'VALID'. OUTLIER remains
 * visible in recentObservations (a real, preserved observation) but
 * has its own outlierSampleCount and never inflates validSampleCount.
 * See the dedicated "timing-quality sample-count matrix" describe
 * block below and docs/audits/STUDYUS_PHASE_1D_R_TIMING_QUALITY_CLOSURE.md.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const STUDENT_ID = 'student-1';
const CONCEPT_ID = 'concept-1';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@/lib/db');
});

describe('readResponseTimingSignal', () => {
  it('Step 19: a concept with no timing-instrumented evidence returns an empty signal -- NO_TIMING_DATA, never 0ms or a fabricated "fast" reading', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readResponseTimingSignal } = await import('@/lib/learner-twin/readers');

    const signal = await readResponseTimingSignal(STUDENT_ID, CONCEPT_ID);

    expect(signal.recentObservations).toEqual([]);
    expect(signal.validSampleCount).toBe(0);
    expect(signal.invalidSampleCount).toBe(0);
    expect(signal.quality.sourceType).toBe('BEHAVIOR_OBSERVATION');
    expect(signal.quality.lastUpdatedAt).toBeNull();
  });

  it('flattens multiple observations per row (a quiz concept-bucket can carry several) and across rows, most-recent-row-first', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          timestamp: '2026-08-31T12:00:00.000Z',
          metadata: { behavior: { responseTimes: [{ responseTimeMs: 5000, timingQuality: 'VALID', questionIndex: 0 }, { responseTimeMs: 8000, timingQuality: 'VALID', questionIndex: 1 }] } },
        },
        {
          timestamp: '2026-08-30T12:00:00.000Z',
          metadata: { behavior: { responseTimes: [{ responseTimeMs: 12000, timingQuality: 'VALID' }] } },
        },
      ],
    }));
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readResponseTimingSignal } = await import('@/lib/learner-twin/readers');

    const signal = await readResponseTimingSignal(STUDENT_ID, CONCEPT_ID);

    expect(signal.recentObservations).toHaveLength(3);
    expect(signal.recentObservations[0]).toEqual({ responseTimeMs: 5000, timingQuality: 'VALID', observedAt: '2026-08-31T12:00:00.000Z', questionIndex: 0 });
    expect(signal.recentObservations[2]).toEqual({ responseTimeMs: 12000, timingQuality: 'VALID', observedAt: '2026-08-30T12:00:00.000Z' });
    expect(signal.validSampleCount).toBe(3);
    expect(signal.quality.lastUpdatedAt).toBe('2026-08-31T12:00:00.000Z');
  });

  it('Phase 1D-R: OUTLIER remains visible in recentObservations (a real measured duration, preserved for transparency) but does NOT count toward validSampleCount -- it has its own outlierSampleCount instead', async () => {
    const query = vi.fn(async () => ({
      rows: [{ timestamp: '2026-08-31T12:00:00.000Z', metadata: { behavior: { responseTimes: [{ responseTimeMs: 99999999, timingQuality: 'OUTLIER' }] } } }],
    }));
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readResponseTimingSignal } = await import('@/lib/learner-twin/readers');

    const signal = await readResponseTimingSignal(STUDENT_ID, CONCEPT_ID);

    expect(signal.recentObservations).toEqual([{ responseTimeMs: 99999999, timingQuality: 'OUTLIER', observedAt: '2026-08-31T12:00:00.000Z' }]);
    expect(signal.validSampleCount).toBe(0);
    expect(signal.outlierSampleCount).toBe(1);
    // sampleSize must never be inflated by outliers -- a future minimum-
    // sample gate reading quality.sampleSize must see 0, not 1.
    expect(signal.quality.sampleSize).toBe(0);
  });

  it('counts INVALID/CLOCK_SKEW as invalidSampleCount, never surfaced as a fabricated duration in recentObservations', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          timestamp: '2026-08-31T12:00:00.000Z',
          metadata: { behavior: { responseTimes: [{ responseTimeMs: null, timingQuality: 'INVALID' }, { responseTimeMs: null, timingQuality: 'CLOCK_SKEW' }] } },
        },
      ],
    }));
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readResponseTimingSignal } = await import('@/lib/learner-twin/readers');

    const signal = await readResponseTimingSignal(STUDENT_ID, CONCEPT_ID);

    expect(signal.recentObservations).toEqual([]);
    expect(signal.validSampleCount).toBe(0);
    expect(signal.invalidSampleCount).toBe(2);
  });

  it('bounds recentObservations to observationLimit while still counting every valid sample seen in the scanned window', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      timestamp: `2026-08-3${i}T12:00:00.000Z`,
      metadata: { behavior: { responseTimes: [{ responseTimeMs: 1000 * (i + 1), timingQuality: 'VALID' }] } },
    }));
    const query = vi.fn(async () => ({ rows }));
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readResponseTimingSignal } = await import('@/lib/learner-twin/readers');

    const signal = await readResponseTimingSignal(STUDENT_ID, CONCEPT_ID, 3);

    expect(signal.recentObservations).toHaveLength(3);
    expect(signal.validSampleCount).toBe(5); // full count, even though the array itself is capped
  });

  it('rows with metadata but no behavior key are silently skipped (existing pre-Phase-1D evidence coexists safely)', async () => {
    const query = vi.fn(async () => ({
      rows: [
        { timestamp: '2026-08-31T12:00:00.000Z', metadata: { aiExecution: { aiExecutionId: 'exec-1' } } },
        { timestamp: '2026-08-30T12:00:00.000Z', metadata: { transferDistance: 'FAR' } },
      ],
    }));
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readResponseTimingSignal } = await import('@/lib/learner-twin/readers');

    const signal = await readResponseTimingSignal(STUDENT_ID, CONCEPT_ID);

    expect(signal.recentObservations).toEqual([]);
    expect(signal.validSampleCount).toBe(0);
    expect(signal.invalidSampleCount).toBe(0);
  });
});

describe('Phase 1D-R: timing-quality sample-count matrix (release-blocking for Phase 1E safety)', () => {
  function rowsFor(entries: Array<{ responseTimeMs: number | null; timingQuality: 'VALID' | 'OUTLIER' | 'INVALID' | 'CLOCK_SKEW' }>) {
    return entries.map((entry, i) => ({
      timestamp: `2026-08-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      metadata: { behavior: { responseTimes: [entry] } },
    }));
  }

  async function readWith(entries: Array<{ responseTimeMs: number | null; timingQuality: 'VALID' | 'OUTLIER' | 'INVALID' | 'CLOCK_SKEW' }>, observationLimit = 100) {
    const query = vi.fn(async () => ({ rows: rowsFor(entries) }));
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { readResponseTimingSignal } = await import('@/lib/learner-twin/readers');
    return readResponseTimingSignal(STUDENT_ID, CONCEPT_ID, observationLimit, entries.length + 1);
  }

  it('Step 8 (the exact scenario the external review flagged): 9 VALID + 20 OUTLIER -> validSampleCount = 9, NOT 29', async () => {
    const entries = [
      ...Array.from({ length: 9 }, () => ({ responseTimeMs: 5000, timingQuality: 'VALID' as const })),
      ...Array.from({ length: 20 }, () => ({ responseTimeMs: 9_999_999, timingQuality: 'OUTLIER' as const })),
    ];
    const signal = await readWith(entries);

    expect(signal.validSampleCount).toBe(9);
    expect(signal.validSampleCount).not.toBe(29);
    expect(signal.outlierSampleCount).toBe(20);
    // A future Phase 1E minimum-sample gate reading quality.sampleSize
    // must see the same honest 9, never a count inflated by outliers.
    expect(signal.quality.sampleSize).toBe(9);
  });

  it('A: 3 VALID -> validSampleCount = 3, outlierSampleCount = 0, invalidSampleCount = 0', async () => {
    const signal = await readWith(Array.from({ length: 3 }, () => ({ responseTimeMs: 1000, timingQuality: 'VALID' as const })));
    expect(signal.validSampleCount).toBe(3);
    expect(signal.outlierSampleCount).toBe(0);
    expect(signal.invalidSampleCount).toBe(0);
  });

  it('B: 3 OUTLIER -> validSampleCount = 0, outlierSampleCount = 3', async () => {
    const signal = await readWith(Array.from({ length: 3 }, () => ({ responseTimeMs: 9_999_999, timingQuality: 'OUTLIER' as const })));
    expect(signal.validSampleCount).toBe(0);
    expect(signal.outlierSampleCount).toBe(3);
  });

  it('C: 2 INVALID + 2 CLOCK_SKEW -> validSampleCount = 0, invalidSampleCount = 4', async () => {
    const signal = await readWith([
      { responseTimeMs: null, timingQuality: 'INVALID' },
      { responseTimeMs: null, timingQuality: 'INVALID' },
      { responseTimeMs: null, timingQuality: 'CLOCK_SKEW' },
      { responseTimeMs: null, timingQuality: 'CLOCK_SKEW' },
    ]);
    expect(signal.validSampleCount).toBe(0);
    expect(signal.outlierSampleCount).toBe(0);
    expect(signal.invalidSampleCount).toBe(4);
  });

  it('D: mixed 3 VALID + 2 OUTLIER + 1 INVALID + 1 CLOCK_SKEW -> valid=3, outlier=2, invalid=2, mutually exclusive and summing to 7', async () => {
    const signal = await readWith([
      { responseTimeMs: 1000, timingQuality: 'VALID' },
      { responseTimeMs: 2000, timingQuality: 'VALID' },
      { responseTimeMs: 3000, timingQuality: 'VALID' },
      { responseTimeMs: 9_999_999, timingQuality: 'OUTLIER' },
      { responseTimeMs: 9_999_998, timingQuality: 'OUTLIER' },
      { responseTimeMs: null, timingQuality: 'INVALID' },
      { responseTimeMs: null, timingQuality: 'CLOCK_SKEW' },
    ]);
    expect(signal.validSampleCount).toBe(3);
    expect(signal.outlierSampleCount).toBe(2);
    expect(signal.invalidSampleCount).toBe(2);
    expect(signal.validSampleCount + signal.outlierSampleCount + signal.invalidSampleCount).toBe(7);
  });

  it('E: no timing at all -> zero usable samples, NO_TIMING_DATA semantics preserved', async () => {
    const signal = await readWith([]);
    expect(signal.validSampleCount).toBe(0);
    expect(signal.outlierSampleCount).toBe(0);
    expect(signal.invalidSampleCount).toBe(0);
    expect(signal.recentObservations).toEqual([]);
    expect(signal.quality.sampleSize).toBe(0);
  });
});

describe('ConceptView.behavior.responseTiming (Digital Twin integration, Step 17)', () => {
  it('getConceptView carries the behavioral signal without any Twin write and without affecting mastery/knowledgeState', async () => {
    const MASTERY_ROW = {
      mastery_score: '70.00', confidence_score: '65.00', attempt_count: '5', correct_count: '4', incorrect_count: '1',
      last_practiced: '2026-08-20T10:00:00.000Z', next_review_date: '2026-09-01', updated_at: '2026-08-20T10:00:00.000Z',
    };
    const query = vi.fn(async (sql: string) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('FROM concepts c') && s.includes('LEFT JOIN concept_localizations')) return { rows: [{ subject_id: 'subject-1', label: 'Concept' }] };
      if (s.includes('FROM mastery_records WHERE student_id = $1 AND concept_id = $2')) return { rows: [MASTERY_ROW] };
      if (s.includes('FROM concept_knowledge_state')) return { rows: [] };
      if (s.includes("source_type = 'TRANSFER'")) return { rows: [] };
      if (s.includes('sm.occurrence_count, sm.status, ms.is_critical')) return { rows: [] };
      if (s.includes('FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC LIMIT') && s.includes('score_percent')) return { rows: [] };
      if (s.includes('SELECT timestamp, metadata FROM learning_evidence')) {
        return { rows: [{ timestamp: '2026-08-31T12:00:00.000Z', metadata: { behavior: { responseTimes: [{ responseTimeMs: 4200, timingQuality: 'VALID' }] } } }] };
      }
      if (s.includes('FROM errors')) return { rows: [] };
      if (s.includes('FROM assessment_occurrences ao')) return { rows: [] };
      if (s.includes('FROM learning_evidence') && s.includes("ai_assistance_type = 'NONE'")) return { rows: [] };
      if (s.includes('FROM mastery_records') && s.includes('attempt_count, last_practiced')) return { rows: [{ attempt_count: '5', last_practiced: MASTERY_ROW.last_practiced }] };
      if (s.includes('DISTINCT source_type FROM learning_evidence')) return { rows: [] };
      if (s.includes('confidence_before_answer FROM learning_evidence') && !s.includes('result')) return { rows: [] };
      if (s.includes('confidence_before_answer, result FROM learning_evidence')) return { rows: [] };
      // Phase 1E: derived learner metrics -- safe, deterministic defaults.
      if (s.includes('ai_assistance_type, hints_used, timestamp FROM learning_evidence')) return { rows: [] };
      if (s.includes('SELECT outcome FROM verification_attempts')) return { rows: [] };
      if (s.includes('mastery_policies')) {
        return { rows: [{ version: 1, minimum_understanding: 70, minimum_independence: 60, minimum_application: 60, minimum_retention: 60, minimum_transfer: 50, requires_transfer: false, maximum_critical_misconceptions: 0, minimum_evidence_count: 3, minimum_independent_evidence_count: 2, retention_min_gap_days: 3, validation_window_days: 14 }] };
      }
      if (s.includes('MIN(timestamp) AS first_evidence_at')) return { rows: [] };
      if (s.includes("DISTINCT ON (concept_id, new_state ->> 'masteryState')")) return { rows: [] };
      if (s.includes('FROM concept_relationships WHERE target_concept_id')) return { rows: [] };
      if (s.includes('SELECT concept_id, mastery_score FROM mastery_records WHERE student_id = $1 AND concept_id = ANY')) return { rows: [] };
      if (s.includes('SELECT concept_id FROM mastery_records WHERE student_id = $1')) return { rows: [] };
      if (s.includes('FROM study_plans WHERE student_id')) return { rows: [] };
      if (s.includes('FROM study_sessions ss WHERE')) return { rows: [] };
      if (s.includes('SELECT result, timestamp FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp ASC')) return { rows: [] };
      // Phase 2D/2E: eager on ConceptView -- always exercised.
      if (s.includes('FROM cognitive_diagnoses cd')) return { rows: [{ n: 0 }] };
      if (s.includes("FROM remediation_paths WHERE student_id = $1 AND target_concept_id = $2 AND state IN ('CONFIRMED'")) return { rows: [{ n: 0 }] };
      if (s.includes("FROM remediation_paths WHERE student_id = $1 AND target_concept_id = $2 AND state IN ('RESOLVED'")) return { rows: [] };
      if (s.includes("FROM validation_cycles WHERE student_id = $1 AND concept_id = $2 AND status = 'OPEN'")) return { rows: [] };
      if (s.includes("FROM validation_cycles WHERE student_id = $1 AND concept_id = $2 AND status = 'CLOSED'")) return { rows: [] };
      // Phase 3F: eager on ConceptView -- always exercised.
      if (s.includes("evidenceMode' = 'ASSESSMENT' OR")) return { rows: [] };
      if (s.includes("evidenceMode' IN ('INDEPENDENT'")) return { rows: [] };
      if (s.includes('timestamp, source_type, metadata FROM learning_evidence')) return { rows: [] };
      if (s.includes('FROM verification_attempts') && s.includes('outcome IS NOT NULL')) return { rows: [] };
      if (s.includes('FROM verification_attempts') && s.includes('outcome IS NULL')) return { rows: [{ n: 0 }] };
      // Step 6I: Phase 6 canonical memory state -- no row for this
      // fixture concept (this test doesn't assert on memory fields).
      if (s.includes('FROM concept_memory_state')) return { rows: [] };
      throw new Error(`Unmocked: ${s}`);
    });
    vi.doMock('@/lib/db', () => ({ db: { query } }));

    const { getConceptView } = await import('@/lib/learner-twin/service');
    const view = await getConceptView(STUDENT_ID, CONCEPT_ID);

    expect(view!.behavior.responseTiming.recentObservations).toEqual([
      { responseTimeMs: 4200, timingQuality: 'VALID', observedAt: '2026-08-31T12:00:00.000Z' },
    ]);
    expect(view!.behavior.responseTiming.quality.sourceType).toBe('BEHAVIOR_OBSERVATION');
    // Mastery is completely unaffected -- comes only from mastery_records, never from behavior.
    expect(view!.mastery.score).toBe(70);
    // No write query of any kind was issued by this read.
    for (const call of query.mock.calls) {
      expect(String(call[0])).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i);
    }
  });
});
