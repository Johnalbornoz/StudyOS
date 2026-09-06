/**
 * Phase 8 -- Step 8C1: the batched orchestration INPUT layer.
 *
 * Real service composition (getLearningOrchestrationInputs) with only
 * @/lib/db mocked -- asserts the query bound (one Phase 4, one memory
 * batch, one transfer batch, one assessment batch), timezone / capacity
 * resolution, the read-only contract (except captureLearnerTimezone),
 * and the assessment read being a plain SELECT (not the side-effecting
 * getUpcomingForStudent).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) }, query: (...a: any[]) => queryMock(...a) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import {
  getLearningOrchestrationInputs,
  captureLearnerTimezone,
} from '@/services/learning-orchestration-inputs.service';

const STU = 'p8c-student';
const SUBJ = 'p8c-subject';
const CONCEPT = 'p8c-concept';

function policyRow() {
  return { version: 1, minimum_understanding: 80, minimum_independence: 80, minimum_application: 75, minimum_retention: 75, minimum_transfer: 70, requires_transfer: false, maximum_critical_misconceptions: 0, minimum_evidence_count: 1, minimum_independent_evidence_count: 1, retention_min_gap_days: 3, validation_window_days: 14 };
}
function ksRow() {
  return { student_id: STU, concept_id: CONCEPT, subject_id: SUBJ, mastery_state: 'DEVELOPING', understanding_score: 90, independence_score: 90, application_score: 90, retention_score: null, transfer_score: null, active_misconception_count: 0, critical_misconception_count: 0, recurring_misconception_count: 0, evidence_count: 5, independent_evidence_count: 3, first_evidence_at: '2026-06-01', last_evidence_at: '2026-09-01', validation_readiness: 'READY', state_reason: null, projection_version: 1, mastery_policy_version: 1, updated_at: '2026-09-01' };
}

/** availabilityRow: null = no student_availability row; profileTz: students.timezone value. */
function buildQuery(opts: { availabilityRow?: any; profileTz?: string; assessments?: any[]; remediations?: any[]; curriculum?: any[]; activePlan?: any } = {}) {
  return async (sql: string, _params?: any[]) => {
    const s = String(sql ?? '').replace(/\s+/g, ' ').trim();
    if (/FROM student_availability WHERE student_id = \$1/.test(s)) return { rows: opts.availabilityRow ? [opts.availabilityRow] : [] };
    if (/SELECT timezone FROM students WHERE id = \$1/.test(s)) return { rows: [{ timezone: opts.profileTz ?? 'UTC' }] };
    if (/FROM subjects WHERE student_id = \$1 AND status = 'active'/.test(s)) return { rows: [{ id: SUBJ }] };
    if (/FROM concept_knowledge_state WHERE student_id = \$1 AND subject_id/.test(s)) return { rows: [ksRow()] };
    if (/FROM mastery_policies/.test(s)) return { rows: [policyRow()] };
    if (/FROM concept_memory_state\s+WHERE student_id = \$1/.test(s)) return { rows: [] };
    if (/FROM concept_transfer_state WHERE student_id = \$1/.test(s)) return { rows: [] };
    if (/FROM mastery_records mr\s+JOIN concepts c/.test(s)) return { rows: [] };
    if (/COUNT\(\*\)::int AS n FROM verification_attempts/.test(s)) return { rows: [{ n: 0 }] };
    if (/FROM assessment_occurrences ao/.test(s)) return { rows: opts.assessments ?? [] };
    if (/FROM remediation_paths WHERE student_id = \$1 AND state IN/.test(s)) return { rows: opts.remediations ?? [] };
    if (/ROW_NUMBER\(\) OVER \( PARTITION BY c\.subject_id/.test(s)) return { rows: opts.curriculum ?? [] };
    if (/FROM learning_plan WHERE student_id = \$1 AND status = 'ACTIVE'/.test(s)) return { rows: opts.activePlan ? [opts.activePlan] : [] };
    return { rows: [] };
  };
}

beforeEach(() => queryMock.mockReset());

describe('8C1 -- query bound', () => {
  it('Phase 8 issues exactly one of each logical batch (its own diagnostics count; Phase 4 internal reads are Phase 4 cost)', async () => {
    queryMock.mockImplementation(buildQuery());
    const inputs = await getLearningOrchestrationInputs(STU, { now: new Date('2026-09-06T12:00:00Z') });
    expect(inputs.diagnostics).toEqual({
      phase4DecisionReads: 1, memoryBatchReads: 1, transferBatchReads: 1,
      assessmentBatchReads: 1, remediationBatchReads: 1, curriculumReads: 1,
    });
    const calls = queryMock.mock.calls.map((c) => String(c[0] ?? '').replace(/\s+/g, ' '));
    // Phase 8's OWN assessment read is the plain SELECT that filters by horizonStart -- exactly one.
    expect(calls.filter((c) => /FROM assessment_occurrences ao WHERE ao\.scheduled_date >= \$2/.test(c))).toHaveLength(1);
    // Phase 8's OWN curriculum-eligibility read -- exactly one.
    expect(calls.filter((c) => /ROW_NUMBER\(\) OVER \( PARTITION BY c\.subject_id/.test(c))).toHaveLength(1);
  });

  it('reads assessments via a PLAIN SELECT on assessment_occurrences (no getUpcomingForStudent hidden write)', async () => {
    queryMock.mockImplementation(buildQuery({ assessments: [{ id: 'a1', subject_id: SUBJ, scheduled_date: '2026-09-11', status: 'expected', topics: ['t'], exam_readiness: null }] }));
    const inputs = await getLearningOrchestrationInputs(STU, { now: new Date('2026-09-06T12:00:00Z') });
    expect(inputs.assessments).toEqual([{ id: 'a1', subjectId: SUBJ, scheduledDate: '2026-09-11', status: 'expected', topics: ['t'], examReadiness: null }]);
    const calls = queryMock.mock.calls.map((c) => String(c[0]));
    // never an INSERT/UPDATE from input collection
    expect(calls.some((c) => /INSERT INTO|UPDATE /i.test(c))).toBe(false);
  });
});

describe('8C1 -- horizon', () => {
  it('rolling 14 days from local date in the learner timezone', async () => {
    queryMock.mockImplementation(buildQuery({ availabilityRow: { study_start_time: '17:00:00', study_end_time: '19:00:00', max_daily_minutes: 90, timezone: 'America/Bogota' } }));
    const inputs = await getLearningOrchestrationInputs(STU, { now: new Date('2026-09-06T12:00:00Z') });
    expect(inputs.horizonStart).toBe('2026-09-06');
    expect(inputs.horizonEnd).toBe('2026-09-19');
    expect(inputs.horizonDays).toBe(14);
  });
});

describe('8C1 -- timezone resolution', () => {
  it('a student_availability row -> STUDENT_AVAILABILITY, not assumed (even if value is UTC)', async () => {
    queryMock.mockImplementation(buildQuery({ availabilityRow: { study_start_time: '17:00:00', study_end_time: '19:00:00', max_daily_minutes: 90, timezone: 'UTC' } }));
    const inputs = await getLearningOrchestrationInputs(STU, { now: new Date('2026-09-06T12:00:00Z') });
    expect(inputs).toMatchObject({ timezone: 'UTC', timezoneAssumed: false, timezoneSource: 'STUDENT_AVAILABILITY' });
  });
  it('no availability row, credible students.timezone -> STUDENT_PROFILE, not assumed', async () => {
    queryMock.mockImplementation(buildQuery({ profileTz: 'Europe/Berlin' }));
    const inputs = await getLearningOrchestrationInputs(STU, { now: new Date('2026-09-06T12:00:00Z') });
    expect(inputs).toMatchObject({ timezone: 'Europe/Berlin', timezoneAssumed: false, timezoneSource: 'STUDENT_PROFILE' });
  });
  it('nothing credible -> UTC, assumed', async () => {
    queryMock.mockImplementation(buildQuery({ profileTz: 'UTC' }));
    const inputs = await getLearningOrchestrationInputs(STU, { now: new Date('2026-09-06T12:00:00Z') });
    expect(inputs).toMatchObject({ timezone: 'UTC', timezoneAssumed: true, timezoneSource: 'DEFAULT_UTC' });
  });
  it('a garbage stored timezone falls through (never trusted)', async () => {
    queryMock.mockImplementation(buildQuery({ availabilityRow: { study_start_time: '17:00:00', study_end_time: '19:00:00', max_daily_minutes: 90, timezone: 'Not/AZone' }, profileTz: 'UTC' }));
    const inputs = await getLearningOrchestrationInputs(STU, { now: new Date('2026-09-06T12:00:00Z') });
    expect(inputs.timezoneSource).toBe('DEFAULT_UTC');
  });
});

describe('8C1 -- capacity', () => {
  it('no student_availability row -> established default (30 min), capacityAssumed = true', async () => {
    queryMock.mockImplementation(buildQuery());
    const inputs = await getLearningOrchestrationInputs(STU, { now: new Date('2026-09-06T12:00:00Z') });
    expect(inputs.capacity).toEqual({ maxDailyMinutes: 30, studyStartTime: '16:30:00', studyEndTime: '18:30:00', capacityAssumed: true });
  });
  it('a student_availability row -> its own values, capacityAssumed = false (never silently jumps to the column DEFAULT 120)', async () => {
    queryMock.mockImplementation(buildQuery({ availabilityRow: { study_start_time: '15:00:00', study_end_time: '16:00:00', max_daily_minutes: 60, timezone: 'UTC' } }));
    const inputs = await getLearningOrchestrationInputs(STU, { now: new Date('2026-09-06T12:00:00Z') });
    expect(inputs.capacity).toEqual({ maxDailyMinutes: 60, studyStartTime: '15:00:00', studyEndTime: '16:00:00', capacityAssumed: false });
  });
});

describe('8C1 -- captureLearnerTimezone (the ONLY write; explicit call only)', () => {
  it('rejects an invalid IANA timezone with no query', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const r = await captureLearnerTimezone(STU, 'Middle/Earth');
    expect(r).toEqual({ ok: false, error: 'INVALID_TIMEZONE' });
    expect(queryMock).not.toHaveBeenCalled();
  });
  it('UPSERTs ONLY student_availability.timezone (ON CONFLICT DO UPDATE SET timezone), returns created flag', async () => {
    queryMock.mockResolvedValue({ rows: [{ created: true }] });
    const r = await captureLearnerTimezone(STU, 'America/Bogota');
    expect(r).toEqual({ ok: true, timezone: 'America/Bogota', created: true });
    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = String(queryMock.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(sql).toMatch(/INSERT INTO student_availability \(student_id, timezone\).*ON CONFLICT \(student_id\) DO UPDATE SET timezone = EXCLUDED\.timezone/);
    expect(sql).not.toMatch(/study_start_time|study_end_time|max_daily_minutes/);
    expect(queryMock.mock.calls[0][1]).toEqual([STU, 'America/Bogota']);
  });
});
