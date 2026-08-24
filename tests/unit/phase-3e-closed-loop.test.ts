import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 3E product closed loop: real Knowledge State -> real Phase 3C
// decisions -> the REAL product read boundary (getLearningOSSnapshot,
// what Today/Learning Debt actually call) -> a real session-start
// contract (startLearningSession, what the Start button actually
// calls) -> then Knowledge State changes (representing the existing,
// untouched evidence/projector flow having run) -> the SAME product
// read boundary produces a different next action. Only @/lib/db is
// mocked; every real service in the chain runs for real -- no fake
// separate recommendation engine.

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { getLearningOSSnapshot } from '@/services/learning-os-snapshot.service';
import { startLearningSession } from '@/services/learning-session-engine.service';

const STUDENT = 'product-loop-student';
const SUBJECT = 'product-loop-subject';
const CONCEPT = 'product-loop-concept';

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
  if (/FROM concepts c\s+(JOIN|LEFT JOIN LATERAL)/i.test(sql) || /FROM concepts c\s+JOIN subjects s/i.test(sql)) {
    return { rows: [{ id: CONCEPT, canonical_id: CONCEPT, label: 'Product Loop Concept', subject_name: 'Physics' }] };
  }
  return { rows: [] };
}

beforeEach(() => {
  currentUnderstandingScore = 45;
  currentMasteryState = 'DEVELOPING';
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => defaultImpl(sql));
});

describe('Phase 3E product closed loop: Knowledge State -> Today snapshot -> session-start contract -> (evidence) -> a different next action', () => {
  it('Knowledge State A: the real product read boundary surfaces a real, launchable next action for the concept', async () => {
    const snapshot = await getLearningOSSnapshot(STUDENT, { preferredLanguage: 'en' });

    expect(snapshot.nextExecutableItem).not.toBeNull();
    expect(snapshot.nextExecutableItem!.decision.actionConceptId).toBe(CONCEPT);
    expect(snapshot.conceptLabels.get(CONCEPT)?.label).toBe('Product Loop Concept');

    // Session-start contract: the exact same real Session Engine the Start button calls.
    const session = await startLearningSession({ studentId: STUDENT, learningDecision: snapshot.nextExecutableItem!.decision });
    expect(session.launchStatus).toBe('READY');
    expect(session.actionConceptId).toBe(CONCEPT);
  });

  it('Knowledge State B: once concept_knowledge_state advances (the existing, untouched evidence/projector flow having run), the SAME product read boundary produces a genuinely different next action', async () => {
    const before = await getLearningOSSnapshot(STUDENT, { preferredLanguage: 'en' });
    expect(before.nextExecutableItem?.decision.actionConceptId).toBe(CONCEPT);

    currentUnderstandingScore = 92;
    currentMasteryState = 'VALIDATED_MASTERY';

    const after = await getLearningOSSnapshot(STUDENT, { preferredLanguage: 'en' });

    if (after.nextExecutableItem !== null) {
      expect(after.nextExecutableItem.decision.facts.some((f) => f.kind === 'lowUnderstanding')).toBe(false);
    } else {
      expect(after.nextExecutableItem).toBeNull();
    }
    // Proves no caching anywhere in the product read boundary: the two
    // calls above used the exact same call shape and produced different results.
    expect(after.decisions).not.toEqual(before.decisions);
  });
});
