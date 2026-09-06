/**
 * Phase 7 -- Step 7E1: Phase 4 transfer-signal integration.
 *
 * Real service composition (getLearningDecisions), only @/lib/db mocked
 * -- same pattern as phase4-memory-signal-integration.test.ts. Proves:
 *   - concept_transfer_state now surfaces NEAR_TRANSFER_GAP /
 *     FAR_TRANSFER_GAP / TRANSFER_FRAGILE advisory signals through the
 *     orchestrator, in ONE batched read;
 *   - Phase 4 keeps WHAT authority: the activityType / actionConceptId
 *     / learningState of the decision is IDENTICAL whether or not the
 *     student has any transfer state (frozen-clock decision equivalence).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { getLearningDecisions } from '@/services/adaptive-learning-orchestrator.service';
import { TRANSFER_FRAGILE_SCORE_THRESHOLD } from '@/lib/adaptive-learning-policy';

const STUDENT = 'p7e-student';
const SUBJECT = 'p7e-subject';
const CONCEPT = 'p7e-concept';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function policyRow() {
  return {
    version: 1, minimum_understanding: 80, minimum_independence: 80, minimum_application: 75,
    minimum_retention: 75, minimum_transfer: 70, requires_transfer: false, maximum_critical_misconceptions: 0,
    minimum_evidence_count: 1, minimum_independent_evidence_count: 1, retention_min_gap_days: 3, validation_window_days: 14,
  };
}
function ksRow(overrides: Record<string, unknown> = {}) {
  return {
    student_id: STUDENT, concept_id: CONCEPT, subject_id: SUBJECT, mastery_state: 'DEVELOPING',
    understanding_score: 90, independence_score: 90, application_score: 90, retention_score: null, transfer_score: null,
    active_misconception_count: 0, critical_misconception_count: 0, recurring_misconception_count: 0,
    evidence_count: 5, independent_evidence_count: 3, first_evidence_at: daysAgo(90), last_evidence_at: daysAgo(1),
    validation_readiness: 'READY', state_reason: null, projection_version: 1, mastery_policy_version: 1, updated_at: daysAgo(1),
    ...overrides,
  };
}
function transferStateRow(o: Record<string, any> = {}) {
  return {
    concept_id: CONCEPT,
    transfer_depth: 'NONE',
    near_transfer_success_count: 0,
    mid_transfer_success_count: 0,
    far_transfer_success_count: 0,
    demonstrated_transfer_score: null,
    last_successful_transfer_at: null,
    last_successful_transfer_distance: null,
    distinct_novelty_dimensions_ok: [],
    policy_version: 1,
    ...o,
  };
}

function buildQuery(opts: { transferRows?: any[] } = {}) {
  return vi.fn(async (sql: string) => {
    if (/FROM subjects WHERE student_id/i.test(sql)) return { rows: [{ id: SUBJECT }] };
    if (/FROM concept_knowledge_state WHERE student_id = \$1 AND subject_id/i.test(sql)) return { rows: [ksRow()] };
    if (/FROM mastery_policies/i.test(sql)) return { rows: [policyRow()] };
    if (/FROM concept_memory_state\s+WHERE student_id = \$1/i.test(sql)) return { rows: [] };
    if (/FROM concept_transfer_state WHERE student_id = \$1/i.test(sql)) return { rows: opts.transferRows ?? [] };
    if (/FROM mastery_records mr\s+JOIN concepts c/i.test(sql)) return { rows: [] };
    if (/SELECT COUNT\(\*\)::int AS n FROM verification_attempts/i.test(sql)) return { rows: [{ n: 0 }] };
    return { rows: [] };
  });
}

const forConcept = (decisions: any[]) => decisions.find((d) => d.actionConceptId === CONCEPT);
const whatFields = (d: any) => ({ activityType: d?.activityType, actionConceptId: d?.actionConceptId, learningState: d?.learningState });

beforeEach(() => queryMock.mockReset());

describe('7E1 -- transfer signals surface through the orchestrator', () => {
  it('one batched concept_transfer_state read for the whole student', async () => {
    queryMock.mockImplementation(buildQuery({ transferRows: [transferStateRow()] }));
    await getLearningDecisions(STUDENT);
    const calls = queryMock.mock.calls.filter((c) => /FROM concept_transfer_state WHERE student_id = \$1/i.test(String(c[0])));
    expect(calls).toHaveLength(1);
  });

  it('NONE-depth transfer state -> NEAR_TRANSFER_GAP advisory signal on the decision', async () => {
    queryMock.mockImplementation(buildQuery({ transferRows: [transferStateRow({ transfer_depth: 'NONE' })] }));
    const d = forConcept(await getLearningDecisions(STUDENT));
    expect(d?.signals.some((s: any) => s.type === 'NEAR_TRANSFER_GAP')).toBe(true);
  });

  it('NEAR_DEMONSTRATED + fragile score -> FAR_TRANSFER_GAP and TRANSFER_FRAGILE', async () => {
    queryMock.mockImplementation(
      buildQuery({
        transferRows: [
          transferStateRow({
            transfer_depth: 'NEAR_DEMONSTRATED',
            near_transfer_success_count: 2,
            far_transfer_success_count: 0,
            demonstrated_transfer_score: TRANSFER_FRAGILE_SCORE_THRESHOLD - 10,
          }),
        ],
      }),
    );
    const d = forConcept(await getLearningDecisions(STUDENT));
    const types = d?.signals.map((s: any) => s.type) ?? [];
    expect(types).toContain('FAR_TRANSFER_GAP');
    expect(types).toContain('TRANSFER_FRAGILE');
    expect(types).not.toContain('NEAR_TRANSFER_GAP');
  });

  it('no transfer state row -> no transfer-read signals at all', async () => {
    queryMock.mockImplementation(buildQuery({ transferRows: [] }));
    const d = forConcept(await getLearningDecisions(STUDENT));
    const types = d?.signals.map((s: any) => s.type) ?? [];
    expect(types).not.toContain('NEAR_TRANSFER_GAP');
    expect(types).not.toContain('FAR_TRANSFER_GAP');
    expect(types).not.toContain('TRANSFER_FRAGILE');
  });

  it('DECISION EQUIVALENCE: the WHAT (activityType/actionConceptId/learningState) is identical with vs without transfer state', async () => {
    queryMock.mockImplementation(buildQuery({ transferRows: [] }));
    const without = whatFields(forConcept(await getLearningDecisions(STUDENT)));

    queryMock.mockReset();
    queryMock.mockImplementation(
      buildQuery({
        transferRows: [
          transferStateRow({
            transfer_depth: 'NEAR_DEMONSTRATED',
            near_transfer_success_count: 2,
            demonstrated_transfer_score: 5, // maximally "fragile" + far gap + not near gap
          }),
        ],
      }),
    );
    const withState = whatFields(forConcept(await getLearningDecisions(STUDENT)));

    expect(withState).toEqual(without);
  });
});
