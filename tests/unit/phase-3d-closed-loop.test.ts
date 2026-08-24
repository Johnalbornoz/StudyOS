import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 3D closed-loop proof: real Knowledge State -> real Phase 3C
// decision -> real Phase 3D daily plan -> real NBA v3 -> real Session
// Engine launch contract -> (existing evidence flow, not simulated here
// -- that boundary is already covered by generate-and-take's own tests)
// -> once concept_knowledge_state reflects new evidence, a SUBSEQUENT
// call through the exact same real chain produces a different result,
// with no caching anywhere in the loop. Only @/lib/db is mocked; every
// service in the chain (orchestrator, scheduler, NBA v3, session
// engine) runs for real.

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { getNextBestActionV3 } from '@/services/next-best-action-v3.service';

const STUDENT = 'closed-loop-student';
const SUBJECT = 'closed-loop-subject';
const CONCEPT = 'closed-loop-concept';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function knowledgeStateRow(understandingScore: number, masteryState: string) {
  return {
    student_id: STUDENT, concept_id: CONCEPT, subject_id: SUBJECT, mastery_state: masteryState,
    understanding_score: understandingScore, independence_score: understandingScore,
    application_score: understandingScore, retention_score: null, transfer_score: null,
    active_misconception_count: 0, critical_misconception_count: 0, recurring_misconception_count: 0,
    evidence_count: 5, independent_evidence_count: 2, first_evidence_at: daysAgo(90), last_evidence_at: daysAgo(1),
    validation_readiness: 'INSUFFICIENT_EVIDENCE', state_reason: null, projection_version: 1,
    mastery_policy_version: 1, updated_at: daysAgo(1),
  };
}

function policyRow() {
  return {
    version: 1, minimum_understanding: 80, minimum_independence: 80, minimum_application: 75,
    minimum_retention: 75, minimum_transfer: 70, requires_transfer: true, maximum_critical_misconceptions: 0,
    minimum_evidence_count: 3, minimum_independent_evidence_count: 2, retention_min_gap_days: 3, validation_window_days: 14,
  };
}

let currentUnderstandingScore = 45;
let currentMasteryState = 'DEVELOPING';

function defaultImpl(sql: string) {
  if (/FROM subjects WHERE student_id/i.test(sql)) return { rows: [{ id: SUBJECT }] };
  if (/FROM concept_knowledge_state WHERE student_id = \$1 AND subject_id/i.test(sql)) {
    return { rows: [knowledgeStateRow(currentUnderstandingScore, currentMasteryState)] };
  }
  if (/FROM mastery_policies/i.test(sql)) return { rows: [policyRow()] };
  // Session Engine's read-only ownership check (P0-3D.1): confirms
  // CONCEPT genuinely belongs to SUBJECT for STUDENT before any launch.
  if (/FROM concepts c\s+JOIN subjects s ON s\.id = c\.subject_id/i.test(sql)) {
    return { rows: [{ label: 'Closed Loop Concept' }] };
  }
  return { rows: [] };
}

beforeEach(() => {
  currentUnderstandingScore = 45;
  currentMasteryState = 'DEVELOPING';
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => defaultImpl(sql));
});

describe('Phase 3D closed loop: Knowledge State -> Phase 3C -> Phase 3D -> NBA v3 -> session launch -> (evidence) -> a different next decision', () => {
  it('before evidence: real below-policy Understanding produces a real, launchable NBA v3 action for the concept', async () => {
    const action = await getNextBestActionV3(STUDENT);

    expect(action).not.toBeNull();
    expect(action!.actionConceptId).toBe(CONCEPT);
    expect(action!.subjectId).toBe(SUBJECT);
    expect(['PRACTICE', 'REVIEW']).toContain(action!.activityType);
    expect(action!.sessionLaunch.launchStatus).toBe('READY');
    expect(action!.sessionLaunch.launchTarget).toContain(`conceptId=${CONCEPT}`);
    expect(action!.facts.some((f) => f.kind === 'lowUnderstanding')).toBe(true);
  });

  it('after evidence changes concept_knowledge_state (the existing, untouched projector\'s job), the SAME real chain produces a different result -- no caching anywhere in the loop', async () => {
    const before = await getNextBestActionV3(STUDENT);
    expect(before!.actionConceptId).toBe(CONCEPT);

    // Simulate the existing evidence flow having run (quiz submission ->
    // updateMastery -> recalculateConceptKnowledgeState, none of which
    // Phase 3D touches or re-implements) by advancing the persisted
    // Knowledge State row exactly as that real projector would.
    currentUnderstandingScore = 92;
    currentMasteryState = 'VALIDATED_MASTERY';

    const after = await getNextBestActionV3(STUDENT);

    // The concept that used to be the top action either drops out
    // entirely (nothing left to do) or is no longer driven by
    // LOW_UNDERSTANDING -- either way, the SAME read path produced a
    // genuinely different outcome from the SAME call shape, proving
    // nothing was cached or stale.
    if (after !== null) {
      expect(after.facts.some((f) => f.kind === 'lowUnderstanding')).toBe(false);
    } else {
      expect(after).toBeNull();
    }
  });
});
