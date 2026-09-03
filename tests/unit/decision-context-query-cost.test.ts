/**
 * Phase 1E-R Step 7: RELEASE-BLOCKING query-count regression test.
 *
 * External review finding A: `getDecisionContext` must not eagerly
 * compute Phase 1E's derived metrics (helpDependency/learningVelocity/
 * prerequisiteGaps) when the caller didn't ask for them. This test
 * proves it two ways:
 *
 *   1. By spying on the three metric-reader functions themselves --
 *      the strongest possible proof that they are not called at all
 *      (not called-then-discarded) when not requested, and that only
 *      the specifically-requested reader(s) run otherwise.
 *   2. By counting real `db.query` invocations against a full working
 *      fixture, to measure the actual query-count delta between the
 *      default (no derived metrics) and `'all'` cases -- Step 1's
 *      instrumented, non-prose measurement.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const STUDENT_ID = 'student-1';
const CONCEPT_ID = 'concept-1';
const SUBJECT_ID = 'subject-1';

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

/** Every base-DecisionContext query shape, plus Phase 1E's derived-metric
 * query shapes (only exercised if a metric is actually requested). */
function buildFullFixtureQuery() {
  return vi.fn(async (sql: string) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    // --- base DecisionContext ---
    if (s.includes('SELECT subject_id FROM concepts WHERE id')) return { rows: [{ subject_id: SUBJECT_ID }] };
    if (s.includes('FROM mastery_records WHERE student_id = $1 AND concept_id = $2')) return { rows: [MASTERY_ROW] };
    if (s.includes('FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = $2')) return { rows: [] };
    if (s.includes('FROM learning_evidence') && s.includes("ai_assistance_type = 'NONE'")) return { rows: [{ result: 'correct' }, { result: 'correct' }] };
    if (s.includes('DISTINCT source_type FROM learning_evidence')) return { rows: [{ source_type: 'PRACTICE_QUIZ' }] };
    if (s.includes('FROM mastery_records') && s.includes('attempt_count, last_practiced')) return { rows: [{ attempt_count: '9', last_practiced: MASTERY_ROW.last_practiced }] };
    if (s.includes('confidence_before_answer FROM learning_evidence') && s.includes('confidence_before_answer IS NOT NULL') && !s.includes('result')) return { rows: [] };
    if (s.includes('confidence_before_answer, result FROM learning_evidence')) return { rows: [] };
    if (s.includes('FROM student_misconceptions sm') && s.includes('COUNT')) return { rows: [{ active_count: '0', critical_count: '0', recurring_count: '0' }] };
    if (s.includes('sm.occurrence_count, sm.status, ms.is_critical')) return { rows: [] };
    if (s.includes('FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC LIMIT')) return { rows: [] };
    if (s.includes('FROM assessment_occurrences ao')) return { rows: [] };
    if (s.includes('FROM student_availability')) return { rows: [{ study_start_time: '16:30:00', study_end_time: '18:30:00', max_daily_minutes: 120, timezone: 'UTC', updated_at: null }] };
    // --- Phase 1E derived metrics (only exercised when requested) ---
    if (s.includes('mastery_policies')) {
      return { rows: [{ version: 1, minimum_understanding: 70, minimum_independence: 60, minimum_application: 60, minimum_retention: 60, minimum_transfer: 50, requires_transfer: false, maximum_critical_misconceptions: 0, minimum_evidence_count: 3, minimum_independent_evidence_count: 2, retention_min_gap_days: 3, validation_window_days: 14 }] };
    }
    if (s.includes('ai_assistance_type, hints_used, timestamp FROM learning_evidence')) return { rows: [] };
    if (s.includes('SELECT outcome FROM verification_attempts')) return { rows: [] };
    if (s.includes('MIN(timestamp) AS first_evidence_at')) return { rows: [] };
    if (s.includes("DISTINCT ON (concept_id, new_state ->> 'masteryState')")) return { rows: [] };
    if (s.includes('FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = ANY')) return { rows: [] };
    if (s.includes('FROM concept_relationships WHERE target_concept_id')) return { rows: [] };
    // --- Phase 2D/2E derived metrics (only exercised when requested) ---
    if (s.includes('FROM cognitive_diagnoses cd')) return { rows: [{ n: 1 }] };
    if (s.includes("FROM remediation_paths WHERE student_id = $1 AND target_concept_id = $2 AND state IN ('CONFIRMED'")) return { rows: [{ n: 1 }] };
    if (s.includes("FROM remediation_paths WHERE student_id = $1 AND target_concept_id = $2 AND state IN ('RESOLVED'")) return { rows: [{ state: 'RESOLVED', resolved_at: '2026-08-01T00:00:00.000Z' }] };
    if (s.includes("FROM validation_cycles WHERE student_id = $1 AND concept_id = $2 AND status = 'OPEN'")) {
      return { rows: [{ id: 'cyc-1', student_id: STUDENT_ID, concept_id: CONCEPT_ID, subject_id: SUBJECT_ID, trigger_type: 'LOW_BASELINE', started_at: '2026-08-01', validation_deadline: '2026-09-20T00:00:00.000Z', status: 'OPEN', mastery_policy_version: 1, validated_at: null, closed_at: null, final_outcome: null, outcome_reason: null, reopened_from_cycle_id: null }] };
    }
    if (s.includes("FROM validation_cycles WHERE student_id = $1 AND concept_id = $2 AND status = 'CLOSED'")) return { rows: [] };
    throw new Error(`Unmocked: ${s}`);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('@/lib/db');
  vi.doUnmock('@/lib/learner-twin/metrics');
});

describe('Step 7: getDecisionContext calls the derived-metric READER FUNCTIONS only when requested', () => {
  async function setup() {
    const readHelpDependency = vi.fn().mockResolvedValue({ available: false, reason: 'INSUFFICIENT_EVIDENCE', detail: 'x' });
    const readLearningVelocity = vi.fn().mockResolvedValue({ available: false, reason: 'INSUFFICIENT_EVIDENCE', detail: 'x' });
    const readPrerequisiteGaps = vi.fn().mockResolvedValue({ available: false, reason: 'NOT_APPLICABLE', detail: 'x' });

    vi.doMock('@/lib/learner-twin/metrics', async () => {
      const actual = await vi.importActual<any>('@/lib/learner-twin/metrics');
      return { ...actual, readHelpDependency, readLearningVelocity, readPrerequisiteGaps };
    });
    vi.doMock('@/lib/db', () => ({ db: { query: buildFullFixtureQuery() } }));

    const { getDecisionContext } = await import('@/lib/learner-twin/service');
    return { getDecisionContext, readHelpDependency, readLearningVelocity, readPrerequisiteGaps };
  }

  it('default (no options) -> zero derived-metric readers are called', async () => {
    const { getDecisionContext, readHelpDependency, readLearningVelocity, readPrerequisiteGaps } = await setup();
    const ctx = await getDecisionContext(STUDENT_ID, CONCEPT_ID);

    expect(readHelpDependency).not.toHaveBeenCalled();
    expect(readLearningVelocity).not.toHaveBeenCalled();
    expect(readPrerequisiteGaps).not.toHaveBeenCalled();
    expect(ctx!.helpDependency).toEqual({ requested: false });
    expect(ctx!.learningVelocity).toEqual({ requested: false });
    expect(ctx!.prerequisiteGaps).toEqual({ requested: false });
  });

  it("requesting ['helpDependency'] -> only helpDependency's reader runs", async () => {
    const { getDecisionContext, readHelpDependency, readLearningVelocity, readPrerequisiteGaps } = await setup();
    await getDecisionContext(STUDENT_ID, CONCEPT_ID, { derivedMetrics: ['helpDependency'] });

    expect(readHelpDependency).toHaveBeenCalledTimes(1);
    expect(readLearningVelocity).not.toHaveBeenCalled();
    expect(readPrerequisiteGaps).not.toHaveBeenCalled();
  });

  it("requesting ['learningVelocity', 'prerequisiteGaps'] -> exactly those two run, helpDependency does not", async () => {
    const { getDecisionContext, readHelpDependency, readLearningVelocity, readPrerequisiteGaps } = await setup();
    await getDecisionContext(STUDENT_ID, CONCEPT_ID, { derivedMetrics: ['learningVelocity', 'prerequisiteGaps'] });

    expect(readHelpDependency).not.toHaveBeenCalled();
    expect(readLearningVelocity).toHaveBeenCalledTimes(1);
    expect(readPrerequisiteGaps).toHaveBeenCalledTimes(1);
  });

  it("requesting 'all' -> every derived-metric reader runs exactly once", async () => {
    const { getDecisionContext, readHelpDependency, readLearningVelocity, readPrerequisiteGaps } = await setup();
    await getDecisionContext(STUDENT_ID, CONCEPT_ID, { derivedMetrics: 'all' });

    expect(readHelpDependency).toHaveBeenCalledTimes(1);
    expect(readLearningVelocity).toHaveBeenCalledTimes(1);
    expect(readPrerequisiteGaps).toHaveBeenCalledTimes(1);
  });
});

describe('Step 1: instrumented query-count measurement (real readers, no reader-function mocking)', () => {
  it('default DEFAULT_DECISION_CONTEXT_DERIVED_METRIC_QUERIES = 0 -- measured, not estimated', async () => {
    const query = buildFullFixtureQuery();
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { getDecisionContext } = await import('@/lib/learner-twin/service');

    await getDecisionContext(STUDENT_ID, CONCEPT_ID);
    const baseQueryCount = query.mock.calls.length;

    // Every call this base run made is a base-DecisionContext query --
    // none of the Phase 1E-only query shapes appear in the call log.
    const derivedMetricPatterns = ['mastery_policies', 'hints_used', 'verification_attempts', 'first_evidence_at', "new_state ->> 'masteryState'", 'concept_relationships'];
    const derivedCalls = query.mock.calls.filter(([sql]) => derivedMetricPatterns.some((p) => String(sql).includes(p)));
    expect(derivedCalls).toHaveLength(0);
    expect(baseQueryCount).toBeGreaterThan(0);
  });

  it("requesting 'all' issues strictly more queries than the default -- the derived metrics genuinely run", async () => {
    const queryDefault = buildFullFixtureQuery();
    vi.doMock('@/lib/db', () => ({ db: { query: queryDefault } }));
    const { getDecisionContext: getDefault } = await import('@/lib/learner-twin/service');
    await getDefault(STUDENT_ID, CONCEPT_ID);
    const defaultCount = queryDefault.mock.calls.length;

    vi.resetModules();
    const queryAll = buildFullFixtureQuery();
    vi.doMock('@/lib/db', () => ({ db: { query: queryAll } }));
    const { getDecisionContext: getAll } = await import('@/lib/learner-twin/service');
    await getAll(STUDENT_ID, CONCEPT_ID, { derivedMetrics: 'all' });
    const allCount = queryAll.mock.calls.length;

    expect(allCount).toBeGreaterThan(defaultCount);
  });
});

describe('Phase 2D/2E: interventionState/validationState follow the exact same MetricProjection contract', () => {
  it('default (no options): both are {requested: false}, carrying real, populated values only when actually requested', async () => {
    const query = buildFullFixtureQuery();
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { getDecisionContext } = await import('@/lib/learner-twin/service');

    const ctxDefault = await getDecisionContext(STUDENT_ID, CONCEPT_ID);
    expect(ctxDefault!.interventionState).toEqual({ requested: false });
    expect(ctxDefault!.validationState).toEqual({ requested: false });

    vi.resetModules();
    const queryAll = buildFullFixtureQuery();
    vi.doMock('@/lib/db', () => ({ db: { query: queryAll } }));
    const { getDecisionContext: getAll } = await import('@/lib/learner-twin/service');
    const ctxAll = await getAll(STUDENT_ID, CONCEPT_ID, { derivedMetrics: 'all' });

    expect(ctxAll!.interventionState).toMatchObject({ requested: true, result: { available: true, value: { activeDiagnosisCount: 1, openInterventionCount: 1, lastOutcome: 'RESOLVED' } } });
    expect(ctxAll!.validationState).toMatchObject({ requested: true, result: { available: true, value: { status: 'OPEN' } } });
  });

  it("requesting only ['interventionState'] runs it without touching validationState's queries", async () => {
    const query = buildFullFixtureQuery();
    vi.doMock('@/lib/db', () => ({ db: { query } }));
    const { getDecisionContext } = await import('@/lib/learner-twin/service');

    const ctx = await getDecisionContext(STUDENT_ID, CONCEPT_ID, { derivedMetrics: ['interventionState'] });

    expect(ctx!.interventionState).toMatchObject({ requested: true });
    expect(ctx!.validationState).toEqual({ requested: false });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('FROM validation_cycles'))).toBe(false);
  });
});
