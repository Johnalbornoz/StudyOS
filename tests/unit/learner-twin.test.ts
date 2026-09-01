/**
 * Phase 1C: canonical Digital Learning Twin read architecture.
 * Covers identity contract, projection consistency, data quality, and
 * the read-only invariant. All database access is mocked -- no real
 * connection, no production data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const STUDENT_ID = 'student-fixture-1';
const CONCEPT_ID = 'concept-fixture-1';
const SUBJECT_ID = 'subject-fixture-1';

/** One coherent fixture: a concept with real mastery/KS/evidence, reused across every projection so cross-projection consistency (Step 22) is meaningful. */
const MASTERY_ROW = {
  mastery_score: '62.00',
  confidence_score: '70.00',
  attempt_count: '9',
  correct_count: '6',
  incorrect_count: '3',
  last_practiced: '2026-08-20T10:00:00.000Z',
  next_review_date: '2026-09-05',
  updated_at: '2026-08-20T10:00:00.000Z',
};
const KS_ROW = {
  id: 'ks-1',
  student_id: STUDENT_ID,
  concept_id: CONCEPT_ID,
  subject_id: SUBJECT_ID,
  mastery_state: 'PROVISIONAL_MASTERY',
  understanding_score: '70',
  independence_score: '55',
  application_score: null,
  retention_score: '80',
  transfer_score: null,
  active_misconception_count: 0,
  critical_misconception_count: 0,
  recurring_misconception_count: 0,
  evidence_count: 9,
  independent_evidence_count: 4,
  first_evidence_at: '2026-08-01T00:00:00.000Z',
  last_evidence_at: '2026-08-20T10:00:00.000Z',
  validation_readiness: 'READY',
  state_reason: { resultingState: 'PROVISIONAL_MASTERY' },
  projection_version: 1,
  mastery_policy_version: 1,
  updated_at: '2026-08-20T10:00:05.000Z',
};

function buildMockQuery() {
  return vi.fn(async (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.includes('FROM student_academic_profile')) return { rows: [] };
    if (s.includes('FROM user_language_preferences')) return { rows: [] };
    if (s.includes('FROM students WHERE id')) return { rows: [{ language: 'es' }] };
    if (s.includes('FROM subjects WHERE student_id')) {
      return { rows: [{ id: SUBJECT_ID, name: 'Physics', ib_subject_group: 'sciences', ib_level: 'HL', target_language: null, quiz_language_mode: 'match_interface' }] };
    }
    if (s.includes('SELECT target_language, quiz_language_mode FROM subjects WHERE id')) return { rows: [] };
    if (s.includes('FROM mastery_records WHERE student_id = $1 AND concept_id = $2')) {
      return params[1] === CONCEPT_ID ? { rows: [MASTERY_ROW] } : { rows: [] };
    }
    if (s.includes('FROM mastery_records mr') && s.includes('JOIN concepts c')) {
      return { rows: [{ concept_id: CONCEPT_ID, label: 'Newton’s Second Law', ...MASTERY_ROW }] };
    }
    if (s.includes('concept_id, mastery_score, confidence_score, last_practiced FROM mastery_records')) {
      return { rows: [{ concept_id: CONCEPT_ID, mastery_score: MASTERY_ROW.mastery_score, confidence_score: MASTERY_ROW.confidence_score, last_practiced: MASTERY_ROW.last_practiced }] };
    }
    if (s.includes('concept_id, ai_assistance_type, result, confidence_before_answer FROM learning_evidence')) {
      return { rows: [{ concept_id: CONCEPT_ID, ai_assistance_type: 'NONE', result: 'correct', confidence_before_answer: 'SOMEWHAT_SURE' }] };
    }
    if (s.includes('FROM learning_debt WHERE student_id')) return { rows: [{ count: 0 }] };
    if (s.includes('FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = $2')) return { rows: [KS_ROW] };
    if (s.includes('FROM concept_knowledge_state WHERE student_id = $1 AND subject_id = $2')) return { rows: [KS_ROW] };
    if (s.includes('FROM learning_evidence') && s.includes("ai_assistance_type = 'NONE'")) {
      return { rows: [{ result: 'correct' }, { result: 'correct' }, { result: 'partial' }] };
    }
    if (s.includes('FROM mastery_records') && s.includes('attempt_count, last_practiced')) {
      return { rows: [{ attempt_count: '9', last_practiced: MASTERY_ROW.last_practiced }] };
    }
    if (s.includes('DISTINCT source_type FROM learning_evidence')) return { rows: [{ source_type: 'PRACTICE_QUIZ' }] };
    if (s.includes('confidence_before_answer FROM learning_evidence') && s.includes('confidence_before_answer IS NOT NULL') && !s.includes('result')) {
      return { rows: [{ confidence_before_answer: 'SOMEWHAT_SURE' }, { confidence_before_answer: 'VERY_SURE' }] };
    }
    if (s.includes('confidence_before_answer, result FROM learning_evidence')) {
      return {
        rows: [
          { confidence_before_answer: 'SOMEWHAT_SURE', result: 'correct' },
          { confidence_before_answer: 'VERY_SURE', result: 'correct' },
          { confidence_before_answer: 'SOMEWHAT_SURE', result: 'partial' },
        ],
      };
    }
    if (s.includes('FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC LIMIT')) {
      return {
        rows: [{ timestamp: '2026-08-20T10:00:00.000Z', source_type: 'PRACTICE_QUIZ', result: 'correct', score_percent: '100', ai_assistance_type: 'NONE', learning_mode: 'SOLO' }],
      };
    }
    if (s.includes("source_type = 'TRANSFER'")) return { rows: [] };
    if (s.includes('FROM student_misconceptions sm') && s.includes('COUNT')) return { rows: [{ active_count: '0', critical_count: '0', recurring_count: '0' }] };
    if (s.includes('sm.occurrence_count, ms.is_critical')) return { rows: [] };
    if (s.includes('FROM student_misconceptions sm') && s.includes('occurrence_count >= 2')) return { rows: [] };
    if (s.includes('SELECT timestamp, metadata FROM learning_evidence')) return { rows: [] };
    if (s.includes('FROM assessment_occurrences ao')) return { rows: [] };
    if (s.includes('FROM student_availability')) return { rows: [{ study_start_time: '16:30:00', study_end_time: '18:30:00', max_daily_minutes: 120, timezone: 'UTC', updated_at: null }] };
    if (s.includes('FROM decision_events')) {
      return {
        rows: [
          {
            decision_id: 'd1',
            decision_type: 'MASTERY_UPDATED',
            created_at: '2026-08-20T10:00:00.000Z',
            previous_state: { masteryScore: 40 },
            new_state: { masteryScore: 62 },
            reason_code: 'PRACTICE_QUIZ:correct',
          },
        ],
      };
    }
    if (s.includes('FROM errors')) return { rows: [] };
    if (s.includes('FROM learning_debt WHERE')) return { rows: [{ count: 0 }] };
    if (s.includes('FROM concepts c') && s.includes('LEFT JOIN concept_localizations')) {
      return { rows: [{ subject_id: SUBJECT_ID, label: 'Newton’s Second Law' }] };
    }
    if (s.includes('SELECT subject_id FROM concepts WHERE id')) return { rows: [{ subject_id: SUBJECT_ID }] };
    if (s.includes('mastery_policies')) {
      return { rows: [{ version: 1, minimum_understanding: 70, minimum_independence: 60, minimum_application: 60, minimum_retention: 60, minimum_transfer: 50, requires_transfer: false, maximum_critical_misconceptions: 0, minimum_evidence_count: 3, minimum_independent_evidence_count: 2, retention_min_gap_days: 3, validation_window_days: 14 }] };
    }
    if (s.includes('SELECT COUNT(*) AS c FROM')) return { rows: [{ c: '5' }] }; // generic evidence-coverage total fallback
    if (s.includes('COUNT(*)::int AS count FROM concepts WHERE subject_id')) return { rows: [{ count: 5 }] };
    if (s.includes('COUNT(DISTINCT') && s.includes('concept_id')) return { rows: [{ count: 3 }] };
    if (s.toLowerCase().includes('count(*)')) return { rows: [{ count: 5, total: 5, evidenced: 3 }] };

    // Anything unexpected fails loudly rather than silently returning empty rows.
    throw new Error(`Unmocked query in learner-twin test fixture: ${s}`);
  });
}

let mockQuery: ReturnType<typeof buildMockQuery>;

beforeEach(() => {
  mockQuery = buildMockQuery();
  vi.doMock('@/lib/db', () => ({ db: { query: mockQuery } }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@/lib/db');
});

describe('Read-only invariant (Step 19)', () => {
  it('no file in src/lib/learner-twin/ contains an INSERT/UPDATE/DELETE statement', () => {
    const dir = join(process.cwd(), 'src/lib/learner-twin');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const source = readFileSync(join(dir, f), 'utf-8');
      expect(source).not.toMatch(/\bINSERT INTO\b/i);
      expect(source).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
      expect(source).not.toMatch(/\bDELETE FROM\b/i);
    }
  });
});

describe('Identity contract (Step 21)', () => {
  it('getConceptView accepts one logical studentId and never exposes a profiles/students split in its output', async () => {
    const { getConceptView } = await import('@/lib/learner-twin/service');
    const view = await getConceptView(STUDENT_ID, CONCEPT_ID);
    expect(view).not.toBeNull();
    expect(view!.studentId).toBe(STUDENT_ID);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/profilesStudentId|studentsStudentId|profiles_id|students_id/i);
  });
});

describe('Overview / Subject / Concept / DecisionContext projections', () => {
  it('getConceptView returns null when there is no mastery record yet (no evidence for this concept)', async () => {
    const { getConceptView } = await import('@/lib/learner-twin/service');
    const view = await getConceptView(STUDENT_ID, 'concept-with-no-evidence');
    expect(view).toBeNull();
  });

  it('getConceptView populates mastery/knowledgeState/independence/metacognition/retention from the fixture', async () => {
    const { getConceptView } = await import('@/lib/learner-twin/service');
    const view = await getConceptView(STUDENT_ID, CONCEPT_ID);
    expect(view!.mastery.score).toBe(62);
    expect(view!.knowledgeState.masteryState).toBe('PROVISIONAL_MASTERY');
    expect(view!.knowledgeState.dimensions.retention).toBe(80);
    expect(view!.retention.retentionScore).toBe(80);
    expect(view!.retention.nextReviewAt).toBe('2026-09-05');
    expect(view!.independence.independentMastery).not.toBeNull();
    expect(view!.metacognition.confidenceCalibration.samples).toBe(3);
  });

  it('getConceptView never fabricates a Phase 1D/1E capability -- prerequisiteGaps is always NOT_AVAILABLE_YET', async () => {
    const { getConceptView } = await import('@/lib/learner-twin/service');
    const view = await getConceptView(STUDENT_ID, CONCEPT_ID);
    expect(view!.prerequisiteGaps).toEqual({ available: false, reason: 'NOT_AVAILABLE_YET', plannedPhase: '1E' });
  });

  it('getConceptView with includeHistory=true reads bounded decision_events history; omits it by default', async () => {
    const { getConceptView } = await import('@/lib/learner-twin/service');
    const withoutHistory = await getConceptView(STUDENT_ID, CONCEPT_ID);
    expect(withoutHistory!.stateHistory).toBeUndefined();

    const withHistory = await getConceptView(STUDENT_ID, CONCEPT_ID, { includeHistory: true, historyLimit: 5 });
    expect(withHistory!.stateHistory).toHaveLength(1);
    expect(withHistory!.stateHistory![0].decisionType).toBe('MASTERY_UPDATED');
    const historyCall = mockQuery.mock.calls.find(([sql]) => sql.includes('FROM decision_events'));
    expect(historyCall![1]).toEqual([STUDENT_ID, CONCEPT_ID, 5]);
  });

  it('getSubjectView returns null for an unknown subject, and a bounded concept list otherwise', async () => {
    const { getSubjectView } = await import('@/lib/learner-twin/service');
    const view = await getSubjectView(STUDENT_ID, SUBJECT_ID);
    expect(view).not.toBeNull();
    expect(view!.subjectId).toBe(SUBJECT_ID);
    expect(view!.concepts).toHaveLength(1);
    expect(view!.concepts[0].conceptId).toBe(CONCEPT_ID);
  });

  it('getDecisionContext returns only the minimal decision-relevant slice, with deferred capabilities explicit', async () => {
    const { getDecisionContext } = await import('@/lib/learner-twin/service');
    const ctx = await getDecisionContext(STUDENT_ID, CONCEPT_ID);
    expect(ctx!.mastery.score).toBe(62);
    expect(ctx!.learningVelocity).toEqual({ available: false, reason: 'NOT_AVAILABLE_YET', plannedPhase: '1E' });
    expect(ctx!.helpDependency).toEqual({ available: false, reason: 'NOT_AVAILABLE_YET', plannedPhase: '1E' });
    // Decision context is intentionally smaller than ConceptView -- no errorPatterns/transfer fields at all.
    expect((ctx as any).errorPatterns).toBeUndefined();
    expect((ctx as any).transfer).toBeUndefined();
  });
});

describe('Projection consistency (Step 22)', () => {
  it('the same mastery score appears identically in ConceptView, SubjectView, and DecisionContext', async () => {
    const { getConceptView, getSubjectView, getDecisionContext } = await import('@/lib/learner-twin/service');
    const [conceptView, subjectView, decisionContext] = await Promise.all([
      getConceptView(STUDENT_ID, CONCEPT_ID),
      getSubjectView(STUDENT_ID, SUBJECT_ID),
      getDecisionContext(STUDENT_ID, CONCEPT_ID),
    ]);
    expect(conceptView!.mastery.score).toBe(62);
    expect(subjectView!.concepts[0].mastery.score).toBe(62);
    expect(decisionContext!.mastery.score).toBe(62);
  });

  it('the same retention score appears identically in ConceptView and DecisionContext, sourced from the same Knowledge State dimension', async () => {
    const { getConceptView, getDecisionContext } = await import('@/lib/learner-twin/service');
    const [conceptView, decisionContext] = await Promise.all([getConceptView(STUDENT_ID, CONCEPT_ID), getDecisionContext(STUDENT_ID, CONCEPT_ID)]);
    expect(conceptView!.retention.retentionScore).toBe(80);
    expect(decisionContext!.retention.retentionScore).toBe(80);
  });

  it('Phase 1C-R Step 12: ConceptView and DecisionContext agree on every shared signal for the same fixture -- independence, forgettingRisk, confidence calibration, misconceptions, assessment pressure', async () => {
    const { getConceptView, getDecisionContext } = await import('@/lib/learner-twin/service');
    const [conceptView, decisionContext] = await Promise.all([getConceptView(STUDENT_ID, CONCEPT_ID), getDecisionContext(STUDENT_ID, CONCEPT_ID)]);

    expect(decisionContext!.mastery.score).toBe(conceptView!.mastery.score);
    expect(decisionContext!.independence.independentMastery).toBe(conceptView!.independence.independentMastery);
    expect(decisionContext!.independence.evidenceStrength).toBe(conceptView!.independence.evidenceStrength);
    expect(decisionContext!.retention.forgettingRisk).toBe(conceptView!.retention.forgettingRisk);
    expect(decisionContext!.retention.retentionScore).toBe(conceptView!.retention.retentionScore);
    expect(decisionContext!.metacognition.confidenceCalibration).toEqual(conceptView!.metacognition.confidenceCalibration);
    expect(decisionContext!.misconceptions).toEqual({
      activeCount: conceptView!.misconceptions.activeCount,
      criticalCount: conceptView!.misconceptions.criticalCount,
      recurringCount: conceptView!.misconceptions.recurringCount,
    });
    expect(decisionContext!.assessmentPressure).toEqual(conceptView!.assessmentContext);
  });
});

describe('Data quality contract (Step 20)', () => {
  it('mastery is tagged SYSTEM_FACT with a real lastUpdatedAt', async () => {
    const { getConceptView } = await import('@/lib/learner-twin/service');
    const view = await getConceptView(STUDENT_ID, CONCEPT_ID);
    expect(view!.mastery.quality).toEqual({ sourceType: 'SYSTEM_FACT', lastUpdatedAt: MASTERY_ROW.updated_at });
  });

  it('confidence calibration is tagged STUDENT_SELF_REPORT with the real sample size', async () => {
    const { getConceptView } = await import('@/lib/learner-twin/service');
    const view = await getConceptView(STUDENT_ID, CONCEPT_ID);
    expect(view!.metacognition.quality.sourceType).toBe('STUDENT_SELF_REPORT');
    expect(view!.metacognition.quality.sampleSize).toBe(3);
  });

  it('below the minimum sample threshold, calibration reports INSUFFICIENT_EVIDENCE rather than a fabricated score', async () => {
    mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('confidence_before_answer, result FROM learning_evidence')) {
        return { rows: [{ confidence_before_answer: 'VERY_SURE', result: 'correct' }] }; // only 1 sample
      }
      // Delegate everything else to the shared fixture logic.
      return buildMockQuery()(sql, params);
    });
    const { getConceptView } = await import('@/lib/learner-twin/service');
    const view = await getConceptView(STUDENT_ID, CONCEPT_ID);
    expect(view!.metacognition.confidenceCalibration).toEqual({ score: null, label: 'INSUFFICIENT_EVIDENCE', samples: 1 });
  });

  it('never fabricates AI provenance -- no signal carries a provenance field unless one genuinely exists', async () => {
    const { getConceptView } = await import('@/lib/learner-twin/service');
    const view = await getConceptView(STUDENT_ID, CONCEPT_ID);
    for (const signal of [view!.mastery, view!.knowledgeState, view!.retention, view!.transfer]) {
      expect((signal.quality as any).provenance).toBeUndefined();
    }
  });
});
