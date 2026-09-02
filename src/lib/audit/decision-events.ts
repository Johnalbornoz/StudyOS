import { db, type DbExecutor } from '@/lib/db';
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

/**
 * Phase 2B: `client` is optional and additive. Every pre-existing
 * caller (there are many, across mastery/verification/learning-debt/
 * misconception engines) keeps calling this with no client -- runs
 * against the pool, keeps swallowing its own errors exactly as before,
 * completely unaffected by this change.
 *
 * The ONE new caller that matters is mastery.service.ts's atomic
 * evidence-application transaction: when `client` is the transaction's
 * own checked-out connection, this decision event becomes part of that
 * same atomic operation (Phase 2B Step 3's correction -- "IF THE
 * OPERATION IS CONSIDERED APPLIED, THE COGNITIVE STATE MUST BE
 * INTERNALLY CONSISTENT," which includes its own audit trail, not just
 * the evidence/mastery/Knowledge State rows). That requires NOT
 * swallowing the error in that one case -- a failure here must be able
 * to roll back the whole transaction, the same way a failure in any
 * other step of that operation would. Swallow-and-log stays the
 * default (client omitted); propagate only when a caller explicitly
 * opted this write into its own transaction.
 */
export async function recordDecisionEvent(input: DecisionEventInput, client?: DbExecutor): Promise<void> {
  if (!persistenceEnabled()) return;
  const executor = client ?? db;
  try {
    await executor.query(
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
    if (client) throw err; // part of an atomic operation -- let the caller's transaction roll back
    console.error('[decision-audit] failed to persist decision_events row', {
      decisionType: input.decisionType,
      engine: input.engine,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
