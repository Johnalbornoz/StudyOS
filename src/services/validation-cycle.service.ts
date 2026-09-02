/**
 * Knowledge Validation Over Time (Phase 2.2B): a Validation Cycle is
 * opened only when a real, meaningful knowledge gap exists (never for
 * mere exposure), tracks it against a deadline, and always resolves to
 * an explicit outcome -- never left UNKNOWN once its window passes.
 *
 * See docs/architecture/phase-2-2-knowledge-validation.md for the full
 * design. This module never invents a second Mastery truth -- it reads
 * the Concept Knowledge State the 2.2A projector already computed and
 * only adds the time dimension on top of it.
 */

import { db, type DbExecutor } from '@/lib/db';
import { track } from '@/lib/analytics';
import type { MasteryState, DimensionScores, MisconceptionState, MasteryPolicy } from './knowledge-state.service';

export type TriggerType =
  | 'LOW_BASELINE'
  | 'CONFIRMED_MISCONCEPTION'
  | 'DIAGNOSTIC_FAILURE'
  | 'REPEATED_CONCEPTUAL_ERROR'
  | 'APPLICATION_FAILURE'
  | 'TRANSFER_FAILURE'
  | 'RETENTION_FAILURE'
  | 'KNOWLEDGE_DECAY'
  | 'EXTERNAL_ASSESSMENT_CONFLICT';

export type ValidationCycleStatus = 'OPEN' | 'CLOSED';
export type FinalOutcome = 'VALIDATED_MASTERY' | 'DEVELOPING' | 'INTERVENTION_REQUIRED';

export interface ValidationCycle {
  id: string;
  studentId: string;
  conceptId: string;
  subjectId: string;
  triggerType: TriggerType;
  startedAt: string;
  validationDeadline: string;
  status: ValidationCycleStatus;
  masteryPolicyVersion: number;
  validatedAt: string | null;
  closedAt: string | null;
  finalOutcome: FinalOutcome | null;
  outcomeReason: string | null;
  reopenedFromCycleId: string | null;
}

function rowToCycle(row: any): ValidationCycle {
  return {
    id: row.id,
    studentId: row.student_id,
    conceptId: row.concept_id,
    subjectId: row.subject_id,
    triggerType: row.trigger_type,
    startedAt: row.started_at,
    validationDeadline: row.validation_deadline,
    status: row.status,
    masteryPolicyVersion: row.mastery_policy_version,
    validatedAt: row.validated_at,
    closedAt: row.closed_at,
    finalOutcome: row.final_outcome,
    outcomeReason: row.outcome_reason,
    reopenedFromCycleId: row.reopened_from_cycle_id,
  };
}

async function logEvent(cycleId: string, eventType: string, metadata?: Record<string, unknown>, client: DbExecutor = db): Promise<void> {
  await client.query(`INSERT INTO validation_events (validation_cycle_id, event_type, metadata) VALUES ($1, $2, $3)`, [
    cycleId,
    eventType,
    metadata ? JSON.stringify(metadata) : null,
  ]);
}

/**
 * Never true for UNKNOWN (no evidence at all -- mere exposure, nothing
 * to validate yet) or VALIDATED_MASTERY (already proven, not a gap).
 * Every other state is a real, meaningful gap worth monitoring --
 * including PROVISIONAL_MASTERY, which by definition still needs its
 * retention/transfer proven over time.
 */
export function isMeaningfulGap(state: MasteryState): boolean {
  return state !== 'UNKNOWN' && state !== 'VALIDATED_MASTERY';
}

/**
 * Which trigger best explains why this concept needs a Validation
 * Cycle, in priority order -- a critical misconception is the most
 * urgent signal, a plain low baseline (nothing else specifically
 * failing) is the fallback. DIAGNOSTIC_FAILURE and
 * REPEATED_CONCEPTUAL_ERROR are valid trigger types but are set by
 * callers with that specific Phase 2 context (Diagnostic Check, error
 * recurrence) rather than inferred here from dimension scores alone.
 */
export function determineTriggerType(scores: DimensionScores, misconceptions: MisconceptionState, policy: MasteryPolicy): TriggerType {
  if (misconceptions.criticalCount > policy.maximumCriticalMisconceptions) return 'CONFIRMED_MISCONCEPTION';
  if (policy.requiresTransfer && scores.transfer !== null && scores.transfer < policy.minimumTransfer) return 'TRANSFER_FAILURE';
  if (scores.application !== null && scores.application < policy.minimumApplication) return 'APPLICATION_FAILURE';
  if (scores.retention !== null && scores.retention < policy.minimumRetention) return 'RETENTION_FAILURE';
  return 'LOW_BASELINE';
}

/** The most recent CLOSED cycle for this concept that ended in VALIDATED_MASTERY, if any -- used to link a decay reopen back to what it's reopening. */
export async function getLastValidatedCycle(studentId: string, conceptId: string, client: DbExecutor = db): Promise<ValidationCycle | null> {
  const result = await client.query(
    `SELECT * FROM validation_cycles WHERE student_id = $1 AND concept_id = $2 AND final_outcome = 'VALIDATED_MASTERY'
     ORDER BY validated_at DESC LIMIT 1`,
    [studentId, conceptId]
  );
  return result.rows[0] ? rowToCycle(result.rows[0]) : null;
}

/** How many of this concept's CLOSED cycles did NOT end in VALIDATED_MASTERY -- the persistent-difficulty signal for INTERVENTION_REQUIRED. */
export async function countFailedCyclesForConcept(studentId: string, conceptId: string, client: DbExecutor = db): Promise<number> {
  const result = await client.query(
    `SELECT COUNT(*)::int AS n FROM validation_cycles
     WHERE student_id = $1 AND concept_id = $2 AND status = 'CLOSED' AND final_outcome != 'VALIDATED_MASTERY'`,
    [studentId, conceptId]
  );
  return result.rows[0].n;
}

/**
 * What an expired cycle resolves to. Two failed cycles already on
 * record for this concept escalates to INTERVENTION_REQUIRED (a
 * genuinely persistent difficulty, not a single missed window);
 * otherwise it resolves to DEVELOPING, with the reason distinguishing
 * "we checked and it's not there yet" from "we simply never got enough
 * evidence to judge" -- never a fabricated low score either way.
 */
export function determineExpiredCycleOutcome(
  priorFailedCycleCount: number,
  hadAnyEvidenceDuringCycle: boolean
): { outcome: FinalOutcome; reason: string } {
  if (priorFailedCycleCount >= 2) {
    return { outcome: 'INTERVENTION_REQUIRED', reason: 'PERSISTENT_DIFFICULTY' };
  }
  return {
    outcome: 'DEVELOPING',
    reason: hadAnyEvidenceDuringCycle ? 'NOT_YET_VALIDATED' : 'INSUFFICIENT_VALIDATION_EVIDENCE',
  };
}

/** Days between start and validation -- Time to Mastery, only meaningful for a cycle that actually reached VALIDATED_MASTERY. */
export function computeTimeToMastery(startedAt: string | Date, validatedAt: string | Date | null): number | null {
  if (!validatedAt) return null;
  const ms = new Date(validatedAt).getTime() - new Date(startedAt).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/** Idempotent: an already-OPEN cycle for this (student, concept) is returned as-is (enforced by the DB's partial unique index too, not just this check). */
export async function openValidationCycle(
  studentId: string,
  conceptId: string,
  subjectId: string,
  triggerType: TriggerType,
  policy: MasteryPolicy,
  initialKnowledgeState: unknown,
  reopenedFromCycleId: string | null = null,
  client: DbExecutor = db
): Promise<ValidationCycle> {
  const existing = await client.query(`SELECT * FROM validation_cycles WHERE student_id = $1 AND concept_id = $2 AND status = 'OPEN'`, [
    studentId,
    conceptId,
  ]);
  if (existing.rows[0]) return rowToCycle(existing.rows[0]);

  const inserted = await client.query(
    `INSERT INTO validation_cycles (
       student_id, concept_id, subject_id, trigger_type, validation_deadline,
       mastery_policy_version, initial_knowledge_state, reopened_from_cycle_id
     ) VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::interval, $6, $7, $8)
     RETURNING *`,
    [studentId, conceptId, subjectId, triggerType, policy.validationWindowDays, policy.version, JSON.stringify(initialKnowledgeState ?? null), reopenedFromCycleId]
  );
  const cycle = rowToCycle(inserted.rows[0]);
  await logEvent(cycle.id, reopenedFromCycleId ? 'VALIDATION_CYCLE_REOPENED' : 'VALIDATION_CYCLE_STARTED', { triggerType }, client);
  // Analytics stays outside the atomic cognitive-application boundary
  // (Phase 2B: `track` is best-effort product telemetry, not part of
  // the exactly-once cognitive-state guarantee -- see the Phase 2B
  // report's Transaction Semantics section).
  track(studentId, reopenedFromCycleId ? 'validation_cycle_reopened' : 'validation_cycle_started', { conceptId, triggerType });
  return cycle;
}

async function closeCycle(
  cycle: ValidationCycle,
  finalOutcome: FinalOutcome,
  outcomeReason: string,
  validatedAt: Date | null,
  client: DbExecutor = db
): Promise<ValidationCycle> {
  const updated = await client.query(
    `UPDATE validation_cycles SET status = 'CLOSED', closed_at = NOW(), final_outcome = $2, outcome_reason = $3, validated_at = $4
     WHERE id = $1 RETURNING *`,
    [cycle.id, finalOutcome, outcomeReason, validatedAt]
  );
  const closed = rowToCycle(updated.rows[0]);
  await logEvent(cycle.id, 'VALIDATION_CYCLE_CLOSED', { finalOutcome, outcomeReason }, client);
  if (finalOutcome === 'VALIDATED_MASTERY') await logEvent(cycle.id, 'VALIDATED_MASTERY_REACHED', {}, client);
  if (finalOutcome === 'INTERVENTION_REQUIRED') await logEvent(cycle.id, 'INTERVENTION_REQUIRED', {}, client);
  track(cycle.studentId, 'validation_cycle_closed', { conceptId: cycle.conceptId, finalOutcome, outcomeReason });
  return closed;
}

/**
 * Resolves a cycle whose deadline has already passed and that's still
 * OPEN -- an expired active cycle must never be left as an implicit
 * UNKNOWN. `hadEvidence` tells the caller's projector whether any real
 * evidence arrived during the window, so the outcome reason is honest
 * about "not there yet" vs. "never got enough data to judge."
 */
async function resolveIfExpired(cycle: ValidationCycle, hadEvidence: boolean, client: DbExecutor = db): Promise<ValidationCycle> {
  if (cycle.status !== 'OPEN' || new Date(cycle.validationDeadline) > new Date()) return cycle;
  const priorFailed = await countFailedCyclesForConcept(cycle.studentId, cycle.conceptId, client);
  const { outcome, reason } = determineExpiredCycleOutcome(priorFailed, hadEvidence);
  await logEvent(cycle.id, 'VALIDATION_DEADLINE_REACHED', { outcome, reason }, client);
  return closeCycle(cycle, outcome, reason, null, client);
}

/**
 * Internal: looks up the OPEN cycle for this concept and, via the same
 * lazy resolve-on-read as before, resolves it if its deadline already
 * passed. Unlike the public getActiveValidationCycle (which only ever
 * hands back "still OPEN or null" -- that contract is unchanged), this
 * also surfaces the cycle that was JUST closed in THIS call, so a
 * caller in the same pass can still see what it resolved to before
 * that information is lost. At most one of the two fields is non-null:
 * either the cycle is still open, or it was just resolved CLOSED.
 */
interface ActiveCycleResolution {
  openCycle: ValidationCycle | null;
  justResolved: ValidationCycle | null;
}

async function resolveActiveCycle(
  studentId: string,
  conceptId: string,
  hadRecentEvidence: boolean = true,
  client: DbExecutor = db
): Promise<ActiveCycleResolution> {
  const result = await client.query(`SELECT * FROM validation_cycles WHERE student_id = $1 AND concept_id = $2 AND status = 'OPEN'`, [
    studentId,
    conceptId,
  ]);
  if (!result.rows[0]) return { openCycle: null, justResolved: null };
  const resolved = await resolveIfExpired(rowToCycle(result.rows[0]), hadRecentEvidence, client);
  if (resolved.status === 'OPEN') return { openCycle: resolved, justResolved: null };
  return { openCycle: null, justResolved: resolved };
}

/** The OPEN cycle for this concept, if any -- lazily resolves it first if its deadline already passed (same resolve-on-read pattern already used for learning_debt). Contract unchanged: never returns a cycle that isn't currently OPEN. */
export async function getActiveValidationCycle(
  studentId: string,
  conceptId: string,
  hadRecentEvidence: boolean = true,
  client: DbExecutor = db
): Promise<ValidationCycle | null> {
  const { openCycle } = await resolveActiveCycle(studentId, conceptId, hadRecentEvidence, client);
  return openCycle;
}

/** Every OPEN cycle for a student -- lazily resolves any that have expired before returning. */
export async function getActiveValidationCycles(studentId: string): Promise<ValidationCycle[]> {
  const result = await db.query(`SELECT * FROM validation_cycles WHERE student_id = $1 AND status = 'OPEN'`, [studentId]);
  const resolved = await Promise.all(result.rows.map((r) => resolveIfExpired(rowToCycle(r), true)));
  return resolved.filter((c) => c.status === 'OPEN');
}

/**
 * The core lifecycle step, called from the Knowledge Projector after
 * it computes a concept's dimension-based Mastery State. Overlays the
 * time dimension: opens a cycle for a new meaningful gap, closes one on
 * validation, detects decay when a previously-validated concept
 * regresses, and lazily resolves anything past its deadline. Returns
 * the Mastery State the projector should actually persist -- AT_RISK/
 * INTERVENTION_REQUIRED only ever come from here, never from 2.2A's
 * pure dimension check alone.
 */
export async function evaluateValidationLifecycle(
  params: {
    studentId: string;
    conceptId: string;
    subjectId: string;
    previousState: MasteryState | null;
    baseState: MasteryState;
    scores: DimensionScores;
    misconceptions: MisconceptionState;
    policy: MasteryPolicy;
    knowledgeStateSnapshot: unknown;
  },
  client: DbExecutor = db
): Promise<MasteryState> {
  const { studentId, conceptId, subjectId, previousState, baseState, scores, misconceptions, policy, knowledgeStateSnapshot } = params;

  const { openCycle: existingOpen, justResolved } = await resolveActiveCycle(studentId, conceptId, true, client);

  // Terminal escalation: if the OPEN cycle we just found had already
  // expired and was resolved THIS pass to INTERVENTION_REQUIRED (two or
  // more prior failed cycles -- persistent difficulty, not a single
  // missed window), that outcome must win immediately. It must never be
  // lost by falling through to decay detection, AT_RISK, opening a
  // replacement cycle, or baseState -- getActiveValidationCycle only
  // ever returns OPEN cycles, so without capturing this here the
  // escalation vanishes the instant the cycle closes.
  if (justResolved?.finalOutcome === 'INTERVENTION_REQUIRED') {
    return 'INTERVENTION_REQUIRED';
  }

  // Decay: a previously-validated concept whose fresh evidence no
  // longer clears policy is not "still developing" -- it's a real
  // regression, and reopens monitoring against the concept's own
  // validated history.
  if (previousState === 'VALIDATED_MASTERY' && baseState !== 'VALIDATED_MASTERY' && !existingOpen) {
    const lastValidated = await getLastValidatedCycle(studentId, conceptId, client);
    const cycle = await openValidationCycle(
      studentId,
      conceptId,
      subjectId,
      'KNOWLEDGE_DECAY',
      policy,
      knowledgeStateSnapshot,
      lastValidated?.id ?? null,
      client
    );
    await logEvent(cycle.id, 'KNOWLEDGE_DECAY_DETECTED', {}, client);
    await logEvent(cycle.id, 'CONCEPT_AT_RISK', {}, client);
    track(studentId, 'knowledge_decay_detected', { conceptId });
    return 'AT_RISK';
  }

  if (baseState === 'VALIDATED_MASTERY') {
    if (existingOpen) {
      await closeCycle(existingOpen, 'VALIDATED_MASTERY', 'VALIDATED', new Date(), client);
    }
    return 'VALIDATED_MASTERY';
  }

  // Durability: INTERVENTION_REQUIRED marks persistent difficulty, not a
  // one-pass event -- per the state machine (docs/architecture/phase-2-2-
  // knowledge-validation.md §10), it has no drawn edge back down to
  // DEVELOPING/LEARNING. Only reaching VALIDATED_MASTERY above escapes it.
  // Without this, the very next projector pass after the cycle that
  // earned INTERVENTION_REQUIRED closes would fall through to baseState
  // and silently erase the escalation the instant new (still-failing)
  // evidence arrives -- defeating the point of the signal. A replacement
  // cycle still opens (if none is open) so the concept keeps being
  // tracked toward genuine resolution; the returned state just doesn't
  // regress in the meantime.
  if (previousState === 'INTERVENTION_REQUIRED') {
    if (isMeaningfulGap(baseState) && !existingOpen) {
      const triggerType = determineTriggerType(scores, misconceptions, policy);
      await openValidationCycle(studentId, conceptId, subjectId, triggerType, policy, knowledgeStateSnapshot, null, client);
    }
    return 'INTERVENTION_REQUIRED';
  }

  if (isMeaningfulGap(baseState) && !existingOpen) {
    const triggerType = determineTriggerType(scores, misconceptions, policy);
    await openValidationCycle(studentId, conceptId, subjectId, triggerType, policy, knowledgeStateSnapshot, null, client);
    if (baseState === 'PROVISIONAL_MASTERY') {
      const reopened = await getActiveValidationCycle(studentId, conceptId, true, client);
      if (reopened) await logEvent(reopened.id, 'PROVISIONAL_MASTERY_REACHED', {}, client);
    }
  } else if (existingOpen && baseState === 'PROVISIONAL_MASTERY') {
    await logEvent(existingOpen.id, 'PROVISIONAL_MASTERY_REACHED', {}, client);
  }

  return baseState;
}

/**
 * Knowledge Validation Rate - 14 Days (student-scoped): of every
 * Validation Cycle that reached a terminal outcome, what fraction
 * reached VALIDATED_MASTERY within its own deadline. An OPEN cycle
 * (still mid-window) is not yet eligible in either direction --
 * eligibility requires status = 'CLOSED', which by construction is
 * also what excludes cleaned-up scratch/E2E data (never left CLOSED
 * behind on purpose). Late validation never happens by construction
 * (validated_at is only ever set inside closeCycle, at the moment of
 * validation), so "validated within window" reduces to "closed with
 * finalOutcome = VALIDATED_MASTERY".
 */
export async function getKVR14(studentId: string): Promise<{ value: number | null; eligibleCount: number; validatedCount: number }> {
  const result = await db.query(
    `SELECT
       COUNT(*)::int AS eligible,
       COUNT(*) FILTER (WHERE final_outcome = 'VALIDATED_MASTERY' AND validated_at <= validation_deadline)::int AS validated
     FROM validation_cycles WHERE student_id = $1 AND status = 'CLOSED'`,
    [studentId]
  );
  const eligibleCount = result.rows[0].eligible;
  const validatedCount = result.rows[0].validated;
  return {
    value: eligibleCount > 0 ? Math.round((validatedCount / eligibleCount) * 100) : null,
    eligibleCount,
    validatedCount,
  };
}

/** Time to Mastery across every cycle of a student's that actually reached VALIDATED_MASTERY -- null with none yet, never 0. */
export async function getTimeToMastery(studentId: string): Promise<{ averageDays: number | null; count: number }> {
  const result = await db.query(
    `SELECT started_at, validated_at FROM validation_cycles
     WHERE student_id = $1 AND status = 'CLOSED' AND final_outcome = 'VALIDATED_MASTERY' AND validated_at IS NOT NULL`,
    [studentId]
  );
  if (result.rows.length === 0) return { averageDays: null, count: 0 };
  const days = result.rows.map((r) => computeTimeToMastery(r.started_at, r.validated_at)).filter((d): d is number => d !== null);
  return { averageDays: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null, count: days.length };
}

export async function getConceptsAtRisk(studentId: string): Promise<{ conceptId: string; subjectId: string }[]> {
  const result = await db.query(
    `SELECT DISTINCT concept_id, subject_id FROM concept_knowledge_state WHERE student_id = $1 AND mastery_state = 'AT_RISK'`,
    [studentId]
  );
  return result.rows.map((r) => ({ conceptId: r.concept_id, subjectId: r.subject_id }));
}

export async function getInterventionRequiredConcepts(studentId: string): Promise<{ conceptId: string; subjectId: string }[]> {
  const result = await db.query(
    `SELECT DISTINCT concept_id, subject_id FROM concept_knowledge_state WHERE student_id = $1 AND mastery_state = 'INTERVENTION_REQUIRED'`,
    [studentId]
  );
  return result.rows.map((r) => ({ conceptId: r.concept_id, subjectId: r.subject_id }));
}

/**
 * Deadlines of every currently DB-OPEN Validation Cycle for a student --
 * including ones whose deadline has already passed. Deliberately a
 * direct, read-only SELECT rather than going through
 * getActiveValidationCycles: that function's resolve-on-read behavior
 * (via resolveIfExpired) would close an expired cycle as a side effect
 * of merely asking what's due, which can silently resolve a cycle to
 * INTERVENTION_REQUIRED outside evaluateValidationLifecycle -- losing
 * the terminal state before the Knowledge Projector ever sees it -- and
 * would also filter overdue cycles out before the Scheduler can surface
 * VALIDATION_DEADLINE_OVERDUE. Only evaluateValidationLifecycle is
 * allowed to transition a cycle's status; observing what's due must
 * never do that.
 */
export async function getValidationDeadlines(studentId: string): Promise<{ conceptId: string; validationDeadline: string }[]> {
  const result = await db.query(
    `SELECT concept_id, validation_deadline FROM validation_cycles WHERE student_id = $1 AND status = 'OPEN'`,
    [studentId]
  );
  return result.rows.map((r) => ({ conceptId: r.concept_id, validationDeadline: r.validation_deadline }));
}
