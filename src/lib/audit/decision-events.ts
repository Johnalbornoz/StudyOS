import { db } from '@/lib/db';
import type { DecisionEventInput } from './types';

/**
 * The one canonical write path for `decision_events` (Phase 0E2 Step
 * 31: "prefer one canonical audit service rather than ad hoc inserts
 * across routes"). Every engine instrumented this phase
 * (mastery/knowledge-state/verification/learning-debt/misconception)
 * calls this function -- nothing inserts into `decision_events`
 * directly anywhere else.
 *
 * Same failure policy as the AI execution audit sink (Step 10): never
 * throws, never blocks or fails the calling engine's real work. Awaited
 * by callers (so it completes, or is caught and logged, before the
 * request returns), never allowed to roll back or invalidate the
 * primary domain write that already committed before this is called.
 *
 * Test-environment default mirrors src/lib/ai/audit.ts's: Vitest sets
 * VITEST=true, and this is a no-op there by default (the 655+
 * pre-existing tests that exercise updateMastery/recalculateConcept-
 * KnowledgeState/etc. already mock @/lib/db with call-sequence-specific
 * mocks that a surprise extra query would silently desync). A test that
 * wants to assert on decision_events persistence calls
 * setDecisionEventPersistenceForTests(true) and mocks @/lib/db itself
 * (see tests/unit/decision-events.test.ts).
 */
let forceEnabledInTests = false;

/** Test-only escape hatch -- never called from application code. */
export function setDecisionEventPersistenceForTests(enabled: boolean): void {
  forceEnabledInTests = enabled;
}

function persistenceEnabled(): boolean {
  return process.env.VITEST !== 'true' || forceEnabledInTests;
}

export async function recordDecisionEvent(input: DecisionEventInput): Promise<void> {
  if (!persistenceEnabled()) return;
  try {
    await db.query(
      `INSERT INTO decision_events (
         decision_type, engine, engine_version, student_id, subject_id, concept_id,
         source_event_type, source_event_id, previous_state, new_state,
         reason_code, reason_details, ai_execution_id, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        input.decisionType,
        input.engine,
        input.engineVersion,
        input.studentId ?? null,
        input.subjectId ?? null,
        input.conceptId ?? null,
        input.sourceEventType ?? null,
        input.sourceEventId ?? null,
        input.previousState ? JSON.stringify(input.previousState) : null,
        input.newState ? JSON.stringify(input.newState) : null,
        input.reasonCode ?? null,
        input.reasonDetails ? JSON.stringify(input.reasonDetails) : null,
        input.aiExecutionId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    );
  } catch (err) {
    console.error('[decision-audit] failed to persist decision_events row', {
      decisionType: input.decisionType,
      engine: input.engine,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
