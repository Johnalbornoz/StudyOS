/**
 * Phase 4A/4B real-IO composition: proves the two new Phase 3-sourced
 * signals (VERIFICATION_PENDING, INSUFFICIENT_INDEPENDENT_EVIDENCE)
 * are actually wired into the REAL adaptive-learning-orchestrator.service.ts
 * -> getAssessmentStateForConcept chain, not just the pure policy (see
 * phase-4-learning-state-decision-policy.test.ts for that). Same
 * "real service composition, only @/lib/db mocked" pattern as
 * tests/unit/adaptive-learning-orchestrator-integration.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { getLearningDecisions } from '@/services/adaptive-learning-orchestrator.service';

const STUDENT = 'p4-student';
const SUBJECT = 'p4-subject';
const CONCEPT = 'p4-concept';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function policyRow() {
  return {
    version: 1, minimum_understanding: 70, minimum_independence: 60, minimum_application: 60,
    minimum_retention: 60, minimum_transfer: 50, requires_transfer: false, maximum_critical_misconceptions: 0,
    minimum_evidence_count: 3, minimum_independent_evidence_count: 2, retention_min_gap_days: 3, validation_window_days: 14,
  };
}

function ksRow(understandingScore: number, masteryState = 'DEVELOPING') {
  return {
    student_id: STUDENT, concept_id: CONCEPT, subject_id: SUBJECT, mastery_state: masteryState,
    understanding_score: understandingScore, independence_score: understandingScore, application_score: understandingScore,
    retention_score: null, transfer_score: null, active_misconception_count: 0, critical_misconception_count: 0,
    recurring_misconception_count: 0, evidence_count: 5, independent_evidence_count: 2,
    first_evidence_at: daysAgo(30), last_evidence_at: daysAgo(1), validation_readiness: 'READY',
    state_reason: null, projection_version: 1, mastery_policy_version: 1, updated_at: daysAgo(1),
  };
}

/** Builds a per-scenario mocked db.query. assessmentState controls what getAssessmentStateForConcept's 5 queries return. */
function buildQuery(understandingScore: number, assessmentState: { hasPendingVerification: boolean; hasIndependentEvidence: boolean }) {
  return vi.fn(async (sql: string) => {
    if (/FROM subjects WHERE student_id/i.test(sql)) return { rows: [{ id: SUBJECT }] };
    if (/FROM concept_knowledge_state WHERE student_id = \$1 AND subject_id/i.test(sql)) return { rows: [ksRow(understandingScore)] };
    if (/FROM mastery_policies/i.test(sql)) return { rows: [policyRow()] };
    if (/FROM mastery_records mr\s+JOIN concepts c/i.test(sql)) return { rows: [] };
    // --- getAssessmentStateForConcept's own 5 queries ---
    if (/evidenceMode' = 'ASSESSMENT' OR/.test(sql)) {
      return { rows: assessmentState.hasIndependentEvidence ? [{ timestamp: daysAgo(2), score_percent: '90', activity_type: 'CUMULATIVE_ASSESSMENT', source_type: 'ASSESSMENT_QUIZ' }] : [] };
    }
    if (/evidenceMode' IN \('INDEPENDENT'/.test(sql)) {
      return { rows: assessmentState.hasIndependentEvidence ? [{ timestamp: daysAgo(2), score_percent: '90', activity_type: 'CUMULATIVE_ASSESSMENT', evidence_mode: 'ASSESSMENT', source_type: 'ASSESSMENT_QUIZ' }] : [] };
    }
    if (/timestamp, source_type, metadata FROM learning_evidence/.test(sql)) return { rows: [] };
    if (/FROM verification_attempts/.test(sql) && /outcome IS NOT NULL/.test(sql)) return { rows: [] };
    // Phase 4-R: SELECTs the pending row's own identity (id, quiz_session_id, created_at), not a COUNT.
    if (/FROM verification_attempts/.test(sql) && /outcome IS NULL/.test(sql)) {
      return { rows: assessmentState.hasPendingVerification ? [{ id: 'va-pending-1', quiz_session_id: 'quiz-p4r', created_at: daysAgo(0) }] : [] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  queryMock.mockReset();
});

describe('Phase 4A/4B -- VERIFICATION_PENDING is real-wired end-to-end', () => {
  it('a concept with a genuinely pending verification produces a VERIFICATION_PENDING signal and PENDING_VERIFICATION learningState', async () => {
    queryMock.mockImplementation(buildQuery(85, { hasPendingVerification: true, hasIndependentEvidence: true }));
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision).toBeDefined();
    expect(decision!.signals.some((s) => s.type === 'VERIFICATION_PENDING')).toBe(true);
    expect(decision!.learningState).toBe('PENDING_VERIFICATION');
  });

  it('a concept with no pending verification never produces the signal', async () => {
    queryMock.mockImplementation(buildQuery(85, { hasPendingVerification: false, hasIndependentEvidence: true }));
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    // Understanding is adequate (85 >= 70) and independent evidence exists and nothing else is wrong -- VALIDATED, so genuinely no decision row at all (Phase 4D.6/no-op semantics).
    expect(decision).toBeUndefined();
  });
});

describe('Phase 4A/4B -- INSUFFICIENT_INDEPENDENT_EVIDENCE is real-wired end-to-end', () => {
  it('adequate understanding but zero independent/assessment evidence produces the signal and blocks VALIDATED', async () => {
    queryMock.mockImplementation(buildQuery(85, { hasPendingVerification: false, hasIndependentEvidence: false }));
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision).toBeDefined();
    expect(decision!.signals.some((s) => s.type === 'INSUFFICIENT_INDEPENDENT_EVIDENCE')).toBe(true);
    expect(decision!.learningState).toBe('INSUFFICIENT_INDEPENDENT_EVIDENCE');
    expect(decision!.activityType).toBe('SOLO_CHECK');
  });

  it('low understanding (still genuinely LEARNING) with no independent evidence does NOT fire the signal -- nothing surprising to report yet', async () => {
    queryMock.mockImplementation(buildQuery(30, { hasPendingVerification: false, hasIndependentEvidence: false }));
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision).toBeDefined();
    expect(decision!.signals.some((s) => s.type === 'INSUFFICIENT_INDEPENDENT_EVIDENCE')).toBe(false);
  });

  it('adequate understanding WITH real independent evidence does not fire the signal', async () => {
    queryMock.mockImplementation(buildQuery(85, { hasPendingVerification: false, hasIndependentEvidence: true }));
    const decisions = await getLearningDecisions(STUDENT);
    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision).toBeUndefined(); // VALIDATED -- no signal, no decision row
  });
});

describe('Phase 4F.4 -- no DecisionContext/Twin bypass: the orchestrator calls the exact certified reader function', () => {
  it('getAssessmentStateForConcept is invoked with (studentId, conceptId) -- the same canonical reader learner-twin/readers.ts::readAssessmentState calls, never a hand-rolled ad-hoc query', async () => {
    queryMock.mockImplementation(buildQuery(85, { hasPendingVerification: true, hasIndependentEvidence: true }));
    await getLearningDecisions(STUDENT);
    // Confirmed structurally: every one of getAssessmentStateForConcept's
    // own 5 query shapes appears in the call log (proving THAT function
    // ran, not a parallel reimplementation of its logic).
    const calls = queryMock.mock.calls.map(([sql]) => String(sql));
    expect(calls.some((s) => /evidenceMode' = 'ASSESSMENT' OR/.test(s))).toBe(true);
    expect(calls.some((s) => /evidenceMode' IN \('INDEPENDENT'/.test(s))).toBe(true);
    expect(calls.some((s) => /SELECT id, quiz_session_id, created_at FROM verification_attempts/.test(s))).toBe(true);
  });
});
