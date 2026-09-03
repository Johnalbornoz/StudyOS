import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 3C, section 22: drive the REAL service composition -- real
// signal loaders (remediation/diagnosis/misconception/debt/calibration/
// assessment/mastery/learner-model/knowledge-state/learning-scheduler
// all run for real) with only the DB layer mocked. Every other
// orchestrator test in adaptive-learning-orchestrator.test.ts exercises
// the pure policy directly with hand-built signals; that alone would
// pass even if the real IO wiring were broken. This file is the lesson
// learned from the P0-A.1 deadline bug: prove the real interaction, not
// an idealized mock of it.

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { getLearningDecisions, getBestLearningDecision } from '@/services/adaptive-learning-orchestrator.service';

const STUDENT = 'student-real';
const SUBJECT = 'subj-real';
const CONCEPT = 'concept-real';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function defaultImpl(sql: string) {
  if (/FROM subjects WHERE student_id/i.test(sql)) {
    return { rows: [{ id: SUBJECT }] };
  }
  if (/FROM concept_knowledge_state WHERE student_id = \$1 AND subject_id/i.test(sql)) {
    return {
      rows: [
        {
          student_id: STUDENT,
          concept_id: CONCEPT,
          subject_id: SUBJECT,
          mastery_state: 'DEVELOPING',
          understanding_score: 45, // below the mocked policy's minimum_understanding (80) -> real LOW_UNDERSTANDING signal
          independence_score: 40,
          application_score: 40,
          retention_score: null,
          transfer_score: null,
          active_misconception_count: 0,
          critical_misconception_count: 0,
          recurring_misconception_count: 0,
          evidence_count: 5,
          independent_evidence_count: 2,
          first_evidence_at: daysAgo(90),
          last_evidence_at: daysAgo(60),
          validation_readiness: 'INSUFFICIENT_EVIDENCE',
          state_reason: null,
          projection_version: 1,
          mastery_policy_version: 1,
          updated_at: daysAgo(60),
        },
      ],
    };
  }
  if (/FROM mastery_policies/i.test(sql)) {
    return {
      rows: [
        {
          version: 1,
          minimum_understanding: 80,
          minimum_independence: 80,
          minimum_application: 75,
          minimum_retention: 75,
          minimum_transfer: 70,
          requires_transfer: true,
          maximum_critical_misconceptions: 0,
          minimum_evidence_count: 3,
          minimum_independent_evidence_count: 2,
          retention_min_gap_days: 3,
          validation_window_days: 14,
        },
      ],
    };
  }
  if (/FROM mastery_records mr\s+JOIN concepts c/i.test(sql)) {
    // getStudentMastery -- feeds real FORGETTING_RISK computation via
    // the actual calculateReviewIntervalDays/calculateForgettingRisk
    // algorithms (not re-derived by the orchestrator).
    return {
      rows: [
        {
          concept_id: CONCEPT,
          canonical_id: CONCEPT,
          label: 'Concept Real',
          mastery_score: 45,
          confidence_score: 40,
          attempt_count: 5,
          last_practiced: daysAgo(60),
          learning_debt_severity: null,
          learning_debt_status: null,
        },
      ],
    };
  }
  // Phase 4A/4B: getAssessmentStateForConcept's pending-verification
  // COUNT query -- must return a real { n: 0 } row (never an empty rows
  // array) since the reader does `pending.rows[0].n` unconditionally.
  // Its other four queries (lastFormal/lastIndependent/lastVerification/
  // cognitiveDemandScan) are all plain SELECTs that correctly fall
  // through to the catch-all empty-rows default below.
  if (/SELECT COUNT\(\*\)::int AS n FROM verification_attempts/i.test(sql)) {
    return { rows: [{ n: 0 }] };
  }
  return { rows: [] };
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => defaultImpl(sql));
});

describe('22. Real Phase 3C composition: real signals -> real consolidation -> real selection -> real priority -> LearningDecision', () => {
  it('a concept with real below-policy Understanding and real stale practice produces one consolidated, correctly-typed decision', async () => {
    const decisions = await getLearningDecisions(STUDENT);

    const decision = decisions.find((d) => d.actionConceptId === CONCEPT);
    expect(decision).toBeDefined();
    expect(decision!.subjectId).toBe(SUBJECT);

    const types = new Set(decision!.signals.map((s) => s.type));
    expect(types.has('LOW_UNDERSTANDING')).toBe(true);
    expect(types.has('FORGETTING_RISK')).toBe(true);

    // Real consolidation: both real signals landed in the SAME context, not two separate rows.
    expect(decisions.filter((d) => d.actionConceptId === CONCEPT)).toHaveLength(1);

    // Real selection: with neither remediation/diagnosis/retention/transfer/independence
    // in play, and DEVELOPING (past LEARNING) with real understanding evidence, REVIEW is the deterministic pick.
    expect(decision!.activityType).toBe('REVIEW');

    // Real priority: a positive, band-consistent score was actually computed, not hardcoded.
    expect(decision!.priorityScore).toBeGreaterThan(0);
  });

  it('getBestLearningDecision returns the same top decision getLearningDecisions ranks first', async () => {
    const [decisions, best] = await Promise.all([getLearningDecisions(STUDENT), getBestLearningDecision(STUDENT)]);
    expect(best).toEqual(decisions[0]);
  });

  it('returns an empty list, never an error, for a student with no signals anywhere', async () => {
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => {
      if (/FROM mastery_policies/i.test(sql)) return defaultImpl(sql); // still required -- getActiveMasteryPolicy throws on empty
      return { rows: [] };
    });
    const decisions = await getLearningDecisions('empty-student');
    expect(decisions).toEqual([]);
    expect(await getBestLearningDecision('empty-student')).toBeNull();
  });
});

describe('25. Student isolation: every real data load is scoped to the supplied studentId', () => {
  it('forwards the exact studentId to the subjects query and every downstream signal source', async () => {
    await getLearningDecisions('only-this-student');

    const subjectsCall = queryMock.mock.calls.find(([sql]) => /FROM subjects WHERE student_id/i.test(sql));
    expect(subjectsCall?.[1]).toEqual(['only-this-student']);

    const ksCall = queryMock.mock.calls.find(([sql]) => /FROM concept_knowledge_state WHERE student_id = \$1 AND subject_id/i.test(sql));
    expect(ksCall?.[1]?.[0]).toBe('only-this-student');

    const masteryCall = queryMock.mock.calls.find(([sql]) => /FROM mastery_records mr\s+JOIN concepts c/i.test(sql));
    expect(masteryCall?.[1]?.[0]).toBe('only-this-student');
  });
});
