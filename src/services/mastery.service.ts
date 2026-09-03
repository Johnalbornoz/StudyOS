/**
 * Mastery Service - Orchestrates mastery calculations and database updates
 *
 * Never updates mastery directly from AI.
 * Always goes through: LearningEvidence → MasteryEngine → MasteryRecord → MasteryEvent
 */

import { db, type DbExecutor } from '@/lib/db';
import { ensureConceptLocalizations } from './localization.service';
import {
  calculateMasteryDelta,
  calculateConfidence,
  shouldCreateLearningDebt,
  calculateDebtSeverity,
  updateMastery as algorithmUpdateMastery,
  type LearningEvidence,
} from '@/lib/algorithms/mastery';
import { calculateNextReviewDate } from '@/lib/algorithms/spaced-repetition';
import { recalculateConceptKnowledgeState, getActiveMasteryPolicy } from './knowledge-state.service';
import { recordDecisionEvent } from '@/lib/audit';
import { buildOperationKey, type EvidenceApplicationIdentity } from '@/lib/algorithms/evidence-idempotency';
import { toCanonicalErrorType } from './error-intelligence.service';
import {
  recordStudentMisconception,
  resolveMisconceptionSignatures,
  getActiveMisconceptionSignatureIdsForConcept,
  isMisconceptionResolutionEvidence,
} from './misconception.service';
import type { AIProvenance } from '@/lib/ai';

/** Postgres unique_violation. See database/migrations/20260901_1200_evidence_idempotency.sql. */
const PG_UNIQUE_VIOLATION = '23505';
const OPERATION_KEY_CONSTRAINT = 'learning_evidence_operation_key_unique_idx';

function isOperationKeyConflict(err: unknown): boolean {
  const pgErr = err as { code?: string; constraint?: string } | undefined;
  return pgErr?.code === PG_UNIQUE_VIOLATION && pgErr?.constraint === OPERATION_KEY_CONSTRAINT;
}

export type AIAssistanceType =
  | 'NONE' | 'HINT' | 'MULTIPLE_HINTS' | 'TUTOR_GUIDANCE' | 'TUTOR_EXPLANATION' | 'WORKED_EXAMPLE' | 'OTHER';
export type LearningMode = 'SOLO' | 'COACH' | 'AI_NATIVE';
// Matches learning_evidence's existing CHECK constraint (migration 021).
export type ConfidenceLevel = 'NOT_SURE' | 'SOMEWHAT_SURE' | 'VERY_SURE';

export interface MasteryUpdateInput {
  studentId: string;
  conceptId: string;
  subjectId: string;
  evidence: LearningEvidence;
  errorClassification?: string; // Optional: CONCEPTUAL, PROCEDURAL, etc.
  telemetry?: {
    activityType?: string; // e.g. 'quiz'
    learningMode?: LearningMode;
    hintsUsed?: number;
    aiAssistanceType?: AIAssistanceType;
    confidenceBeforeAnswer?: ConfidenceLevel; // self-reported, captured before the student saw the result
  };
  // Arbitrary structured context to stamp onto the learning_evidence row
  // this call writes (e.g. exam-attribution granularity, or per-question
  // semantic tags for a multi-question concept bucket). Optional and
  // additive -- existing callers that omit it get exactly the previous
  // behavior (metadata stays NULL). Some earlier callers (e.g.
  // transfer/submit) instead stamp metadata with a follow-up UPDATE
  // after this call returns; both are valid, this is just the direct path.
  metadata?: Record<string, unknown>;
  /**
   * Phase 0E2: set ONLY when this evidence came from one unambiguous
   * AI execution (see src/lib/ai/gateway.ts's AIProvenance.aiExecutionId)
   * -- never fabricated when evidence was deterministic or aggregated
   * multiple/zero AI calls. Links the resulting MASTERY_UPDATED
   * decision_events row to that execution (Step 15).
   */
  aiExecutionId?: string | null;
  /**
   * Phase 2B: the stable logical-operation identity this evidence
   * belongs to (see src/lib/algorithms/evidence-idempotency.ts). When
   * present, this call becomes idempotent: a second call with the same
   * identity never re-applies -- it returns the already-applied
   * result instead (MasteryUpdateResult.duplicate === true). Omitted
   * entirely -- not merely a caller declining to identify one specific
   * retry -- for writers this phase deliberately did not wire up yet
   * (see the Phase 2B report's Evidence Writer Audit); those keep
   * today's unprotected behavior unchanged, exactly as before this
   * field existed.
   */
  identity?: EvidenceApplicationIdentity;
  /**
   * Phase 2C: a misconception observation classified from THIS SAME
   * logical action (e.g. Explain & Defend's rubric flagged one) --
   * persisted only when this call's own operation_key gate confirms a
   * genuinely new application, using the SAME transaction. Never
   * persisted independently: a transport replay of the triggering
   * request never reaches this at all, since the evidence-insert gate
   * above it already rejected the retry (Phase 2B's identity reused,
   * not a second idempotency system -- Phase 2C Step 8). AI
   * classification itself may still run twice on a client retry
   * (accepted cost, same as grading); only the winning application's
   * classification is ever persisted.
   */
  misconceptionObservation?: {
    signatureId: string;
    misconceptionCode: string;
    isCritical: boolean;
    evidenceRef?: Record<string, unknown>;
    aiExecution: AIProvenance;
  };
  /**
   * Phase 2C-R: an explicit set of misconception signature ids THIS
   * evidence is known to address -- e.g. a future targeted Explain
   * activity or an explicitly-scoped Verification attempt (no current
   * writer supplies this yet -- see the Phase 2C-R report §4/§6 for
   * why: no existing generation/evaluation path knows which specific
   * signature a response addressed). When present, ONLY these
   * signatures may resolve, and only after being independently
   * confirmed to belong to `conceptId` and be currently ACTIVE
   * (resolveMisconceptionSignatures's own join/WHERE -- a foreign or
   * stale id here is never trusted blindly). When ABSENT, `updateMastery`
   * falls back to the conservative single-active-signature rule: the
   * one ACTIVE signature on this concept resolves ONLY if there is
   * exactly one; two or more ACTIVE signatures with no explicit scope
   * resolves NOTHING (ambiguity is never guessed away -- Phase 2C-R
   * Step 5, closing the concept-wide bulk-resolution defect external
   * review found in Phase 2C).
   */
  resolvedMisconceptionSignatureIds?: string[];
}

export interface MasteryUpdateResult {
  oldMastery: number;
  newMastery: number;
  delta: number;
  confidenceScore: number;
  learningDebtCreated?: boolean;
  learningDebtSeverity?: number;
  /**
   * Phase 2B: true when this call was a replay of an already-applied
   * logical operation (same `identity`) -- evidence, Mastery, and
   * Knowledge State were NOT touched a second time. oldMastery/
   * newMastery/confidenceScore reflect the CURRENT (already-applied)
   * state; delta is always 0. Absent (not merely false) when the
   * caller supplied no `identity` at all, since idempotency was never
   * evaluated in that case.
   */
  duplicate?: boolean;
  eventId: string;
}

/**
 * Get current mastery record for a student+concept. `client` defaults
 * to the pool (every pre-existing caller's exact previous behavior);
 * `forUpdate` row-locks the record for the duration of the caller's
 * own transaction (Phase 2B -- only the atomic updateMastery below
 * uses this, to serialize concurrent writes to the same record rather
 * than risk one silently overwriting the other's stale-read-based
 * delta).
 */
export async function getMasteryRecord(
  studentId: string,
  conceptId: string,
  options?: { client?: DbExecutor; forUpdate?: boolean }
) {
  const executor = options?.client ?? db;
  try {
    const result = await executor.query(
      `
      SELECT
        id,
        mastery_score,
        confidence_score,
        attempt_count,
        correct_count,
        incorrect_count,
        last_practiced,
        last_assessed
      FROM mastery_records
      WHERE student_id = $1 AND concept_id = $2
      LIMIT 1
      ${options?.forUpdate ? 'FOR UPDATE' : ''}
      `,
      [studentId, conceptId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error fetching mastery record:', error);
    throw error;
  }
}

/**
 * Create or get mastery record (auto-create if missing). Same
 * `client`/`forUpdate` additive contract as getMasteryRecord above.
 * The forUpdate path always returns a row: the INSERT ... ON CONFLICT
 * DO NOTHING guarantees one exists (racing concurrently against
 * another operation's own get-or-create is exactly what the row lock
 * that follows is for), then the locked SELECT reads it back.
 */
export async function getOrCreateMasteryRecord(
  studentId: string,
  conceptId: string,
  subjectId: string,
  options?: { client?: DbExecutor; forUpdate?: boolean }
) {
  const executor = options?.client ?? db;

  if (options?.forUpdate) {
    await executor.query(
      `
      INSERT INTO mastery_records (student_id, concept_id, subject_id, mastery_score, confidence_score, attempt_count, correct_count, incorrect_count)
      VALUES ($1, $2, $3, 0, 0, 0, 0, 0)
      ON CONFLICT (student_id, concept_id) DO NOTHING
      `,
      [studentId, conceptId, subjectId]
    );
    const record = await getMasteryRecord(studentId, conceptId, { client: executor, forUpdate: true });
    return record!;
  }

  let record = await getMasteryRecord(studentId, conceptId, { client: executor });

  if (!record) {
    // Auto-create with default values
    const result = await executor.query(
      `
      INSERT INTO mastery_records (
        student_id,
        concept_id,
        subject_id,
        mastery_score,
        confidence_score,
        attempt_count,
        correct_count,
        incorrect_count
      ) VALUES ($1, $2, $3, 0, 0, 0, 0, 0)
      RETURNING
        id,
        mastery_score,
        confidence_score,
        attempt_count,
        correct_count,
        incorrect_count,
        last_practiced,
        last_assessed
      `,
      [studentId, conceptId, subjectId]
    );

    record = result.rows[0];
  }

  return record;
}

/**
 * Reads the current mastery_records state for a duplicate/ALREADY_APPLIED
 * response -- informational only (no lock: the transaction that owns
 * this record already committed or never started), never a fabricated
 * "as if newly applied" value. Falls back to zeros only in the
 * pathological case where the record genuinely doesn't exist (it
 * always will in practice -- the first, real application that won the
 * operation_key race is what created it).
 */
async function readCurrentMasteryForDuplicateResponse(
  studentId: string,
  conceptId: string
): Promise<{ masteryScore: number; confidenceScore: number; eventId: string }> {
  const record = await getMasteryRecord(studentId, conceptId);
  const masteryScore = record ? Number(record.mastery_score) : 0;
  const confidenceScore = record ? Number(record.confidence_score) : 0;
  let eventId = '';
  if (record?.id) {
    const eventResult = await db.query(
      `SELECT id FROM mastery_events WHERE mastery_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [record.id]
    );
    eventId = eventResult.rows[0]?.id ?? '';
  }
  return { masteryScore, confidenceScore, eventId };
}

/**
 * Main method: apply learning evidence to Mastery, Knowledge State, and
 * their audit trail as ONE atomic, at-most-once cognitive-state change.
 *
 * Phase 2B (Evidence Idempotency & Mastery Integrity): when
 * `input.identity` is present, this whole operation -- learning_evidence
 * insertion, the Mastery mutation, its audit row, Knowledge State
 * recalculation (including the Phase 2.2B Validation Cycle overlay),
 * and the decision events that belong to this same application -- runs
 * inside ONE short database transaction, gated by an atomic DB-level
 * claim on a deterministic operation_key (see
 * src/lib/algorithms/evidence-idempotency.ts). Two concurrent calls
 * with the same identity can never both apply: the database itself
 * decides which one wins (an INSERT racing a unique index), not a
 * preceding SELECT. The loser rolls back cleanly and returns the
 * ALREADY_APPLIED (duplicate: true) result instead of an error.
 *
 * HTTP delivery to StudyUs remains AT_LEAST_ONCE (a network retry, a
 * double-click, or a server-side retry after a client timeout can all
 * cause this function to be called more than once for the same real
 * learner action) -- the guarantee this function makes is EXACTLY-ONCE
 * COGNITIVE EFFECT for a given stable logical operation identity, not
 * that it is only ever called once.
 *
 * `input.identity` omitted entirely (not merely one field blank) keeps
 * today's unprotected behavior byte-for-byte -- the writers this phase
 * did not wire an identity for (see the Phase 2B report's Evidence
 * Writer Audit) are unaffected by any of this.
 *
 * Steps inside the transaction:
 * 1. Read recent evidence for the confidence calc (BEFORE the gate --
 *    see the "read before the gate" note below).
 * 2. Atomically claim operation_key by inserting learning_evidence.
 *    A unique_violation on that specific constraint here means this
 *    exact operation already applied -- roll back, return
 *    ALREADY_APPLIED. Any other error is a real failure and propagates.
 * 3. Get-or-create + row-lock mastery_records.
 * 4. Calculate new mastery using the deterministic algorithm (unchanged).
 * 5. Update mastery_records; insert mastery_events; conditionally
 *    upsert learning_debt and log the classified error, if any --
 *    all inside the same transaction, so a duplicate can never produce
 *    a second error record either (Phase 2B Step 4's correction).
 * 6. Recalculate Concept Knowledge State using the SAME transactional
 *    client (Phase 2.2A + 2.2B, unchanged algorithms -- see
 *    knowledge-state.service.ts/validation-cycle.service.ts's own
 *    Phase 2B doc comments).
 * 7. Record the MASTERY_UPDATED (+ LEARNING_DEBT_CREATED, if any)
 *    decision events on the SAME client -- part of the same atomic
 *    operation, not a best-effort afterthought, for this call only.
 * 8. Commit. If ANY of the above throws, the whole transaction rolls
 *    back -- Evidence, Mastery, Knowledge State, and their audit trail
 *    either all reflect this operation or none of them do; there is no
 *    partially-applied state to reconcile.
 */
export async function updateMastery(
  input: MasteryUpdateInput
): Promise<MasteryUpdateResult> {
  const { studentId, conceptId, subjectId, evidence, errorClassification, telemetry, metadata, aiExecutionId, identity } = input;
  const operationKey = identity ? buildOperationKey(identity) : null;

  const client = await db.connect();
  let duplicate = false;
  let result: MasteryUpdateResult | null = null;

  try {
    await client.query('BEGIN');

    // Read BEFORE the idempotency gate -- calculateConfidence's
    // "recent results" must never include the evidence row THIS call
    // is about to write (that would change confidence_score's inputs
    // for every future evidence write, an algorithm-adjacent behavior
    // change Phase 2B does not make). Reading first, then writing,
    // preserves the exact pre-Phase-2B ordering.
    const recentResults = await getRecentResults(studentId, conceptId, 5, client);

    // The atomic claim: the database, not a preceding SELECT, decides
    // who wins a concurrent race for this operation_key (Phase 2B
    // Step 10's correction). Evidence columns never depend on the
    // Mastery record's current state, so this can safely be the FIRST
    // write -- a duplicate is detected (and rolled back) before any
    // mastery_records lock is ever taken, keeping a flood of retries
    // cheap rather than serializing them behind real work.
    let learningEvidenceId: string | null = null;
    // Named so Phase 2C's misconception-resolution check (below) can
    // reuse the EXACT same computed value the evidence row itself
    // stores, rather than recomputing "was this independent" a second,
    // possibly-diverging way.
    const computedAiAssistanceType =
      telemetry?.aiAssistanceType ?? (telemetry?.hintsUsed ? (telemetry.hintsUsed > 1 ? 'MULTIPLE_HINTS' : 'HINT') : 'NONE');
    try {
      const evidenceResult = await client.query(
        `
        INSERT INTO learning_evidence (
          student_id, concept_id, source_type, result, difficulty, timestamp,
          subject_id, activity_type, learning_mode, hints_used, ai_assistance_type,
          confidence_before_answer, score_percent, metadata, operation_key
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id
        `,
        [
          studentId,
          conceptId,
          evidence.sourceType,
          evidence.result,
          evidence.difficulty,
          subjectId,
          telemetry?.activityType ?? null,
          telemetry?.learningMode ?? null,
          telemetry?.hintsUsed ?? 0,
          computedAiAssistanceType,
          telemetry?.confidenceBeforeAnswer ?? null,
          evidence.scorePercent ?? null,
          metadata ? JSON.stringify(metadata) : null,
          operationKey,
        ]
      );
      learningEvidenceId = evidenceResult.rows[0].id;
    } catch (err) {
      if (operationKey && isOperationKeyConflict(err)) {
        // Another (or an earlier) call already applied this exact
        // logical operation. Roll back cleanly -- nothing else in this
        // transaction has written anything yet -- and fall through:
        // `duplicate` short-circuits the rest of this try block below,
        // and the ALREADY_APPLIED result is built once the client has
        // been released (see after the try/catch/finally).
        await client.query('ROLLBACK');
        duplicate = true;
      } else {
        throw err; // a real failure -- not our constraint, or no identity was ever supplied
      }
    }

    if (!duplicate) {
      // Get-or-create + row-lock mastery_records -- serializes
      // concurrent DISTINCT (different operation_key) operations on
      // the SAME concept against each other too, so a second
      // legitimate delta is always computed against the first's
      // already-applied result rather than a stale pre-write read
      // (Phase 2B Step 12/13).
      const masteryRecord = await getOrCreateMasteryRecord(studentId, conceptId, subjectId, { client, forUpdate: true });

      const oldMastery = Number.isFinite(Number(masteryRecord.mastery_score)) ? Number(masteryRecord.mastery_score) : 0;

      // Deterministic algorithm -- unchanged (Phase 2B makes no
      // formula, weight, or threshold changes).
      const rawNewMastery = algorithmUpdateMastery(oldMastery, evidence);
      const newMastery = Number.isFinite(rawNewMastery) ? rawNewMastery : oldMastery;
      const delta = newMastery - oldMastery;

      let correctCount = masteryRecord.correct_count;
      let incorrectCount = masteryRecord.incorrect_count;
      if (evidence.result === 'correct') correctCount += 1;
      else if (evidence.result === 'incorrect') incorrectCount += 1;
      const attemptCount = masteryRecord.attempt_count + 1;

      const confidenceInput = {
        mastery: newMastery,
        recentResults: recentResults.map((r) => r.result as any),
        daysSinceLastAttempt: getDaysSinceLastAttempt(masteryRecord.last_practiced),
        attemptCount,
        correctCount,
      };
      const confidenceScore = calculateConfidence(confidenceInput);

      // Next time this concept is due for review -- interval scales
      // with the mastery/confidence just calculated, so well-known
      // concepts get spaced out further than ones just past the
      // "solid" threshold.
      const nextReviewDate = calculateNextReviewDate(newMastery, confidenceScore);

      const updateResult = await client.query(
        `
        UPDATE mastery_records
        SET
          mastery_score = $1,
          confidence_score = $2,
          attempt_count = $3,
          correct_count = $4,
          incorrect_count = $5,
          last_practiced = NOW(),
          next_review_date = $8,
          updated_at = NOW()
        WHERE student_id = $6 AND concept_id = $7
        RETURNING id
        `,
        [newMastery, confidenceScore, attemptCount, correctCount, incorrectCount, studentId, conceptId, nextReviewDate]
      );
      const masteryRecordId = updateResult.rows[0].id;

      const eventResult = await client.query(
        `
        INSERT INTO mastery_events (mastery_id, old_score, new_score, delta_reason, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING id
        `,
        [masteryRecordId, oldMastery, newMastery, `${evidence.sourceType}:${evidence.result}`.slice(0, 50)]
      );
      const eventId = eventResult.rows[0].id;

      const recurrenceCount = incorrectCount; // Simple: count of incorrect answers
      const shouldCreateDebt = shouldCreateLearningDebt(
        newMastery,
        evidence.sourceType === 'TOPIC_ASSESSMENT' || evidence.sourceType === 'CUMULATIVE_ASSESSMENT',
        evidence.sourceType === 'PRACTICE_QUIZ' || evidence.sourceType === 'PRACTICE_QUESTION',
        false, // TODO: check if prerequisite to upcoming exam
        recurrenceCount
      );

      let learningDebtCreated = false;
      let learningDebtSeverity = 0;

      if (shouldCreateDebt) {
        const severity = calculateDebtSeverity(newMastery, recurrenceCount, false);

        const debtResult = await client.query(
          `
          INSERT INTO learning_debt (student_id, concept_id, subject_id, severity, status, created_at)
          VALUES ($1, $2, $3, $4, 'active', NOW())
          ON CONFLICT (student_id, concept_id)
          DO UPDATE SET severity = $4, status = 'active', resolved_at = NULL
          RETURNING id
          `,
          [studentId, conceptId, subjectId, severity]
        );

        learningDebtCreated = true;
        learningDebtSeverity = severity;

        // Phase 0E2 Step 19: shouldCreateLearningDebt's own boolean
        // condition, spelled out as a machine-readable reason. Phase
        // 2B: same transactional client -- part of this atomic
        // operation now, not a best-effort afterthought (Step 15 of
        // the Phase 2B task).
        await recordDecisionEvent(
          {
            decisionType: 'LEARNING_DEBT_CREATED',
            engine: 'debt-resolution-engine',
            engineVersion: 'v1',
            studentId,
            subjectId,
            conceptId,
            sourceEventType: 'learning_debt',
            sourceEventId: debtResult.rows[0]?.id ?? null,
            newState: { severity, status: 'active' },
            reasonCode: 'LOW_MASTERY_WITH_RECENT_ATTEMPT',
            reasonDetails: { mastery: newMastery, recurrenceCount, sourceType: evidence.sourceType },
          },
          client
        );
      }

      // Phase 0E2 Step 14: cross-engine auditability for the mastery
      // update that just happened. Phase 2B: same transactional client.
      await recordDecisionEvent(
        {
          decisionType: 'MASTERY_UPDATED',
          engine: 'mastery-engine',
          engineVersion: 'v1',
          studentId,
          subjectId,
          conceptId,
          sourceEventType: 'learning_evidence',
          sourceEventId: learningEvidenceId,
          previousState: { masteryScore: oldMastery },
          newState: { masteryScore: newMastery, confidenceScore },
          reasonCode: `${evidence.sourceType}:${evidence.result}`.slice(0, 50),
          reasonDetails: {
            sourceType: evidence.sourceType,
            result: evidence.result,
            scorePercent: evidence.scorePercent ?? null,
            sampleSize: evidence.sampleSize ?? null,
            delta,
          },
          aiExecutionId: aiExecutionId ?? null,
        },
        client
      );

      // Log a classified error, if this was a wrong/partial answer and
      // the caller classified why. Phase 2B Step 4: now inside the
      // same atomic operation as the evidence it's about -- a
      // duplicate application (rejected above, before this line is
      // ever reached) can never create a second error record either.
      if (errorClassification && evidence.result !== 'correct') {
        // Phase 2F: errorClassification is caller-supplied free-form
        // text (record-evidence/route.ts's own schema: z.string(), not
        // an enum) -- canonicalized here at the one other INSERT INTO
        // errors call site (error-intelligence.service.ts::recordError
        // is the other), so a non-canonical value never reaches this
        // table (and never trips the CHECK constraint added in
        // database/migrations/20260905_1000_error_taxonomy_reconciliation.sql,
        // which would otherwise abort this whole transaction).
        await client.query(
          `INSERT INTO errors (student_id, concept_id, subject_id, error_type, source_type) VALUES ($1, $2, $3, $4, $5)`,
          [studentId, conceptId, subjectId, toCanonicalErrorType(errorClassification), evidence.sourceType]
        );
      }

      // Phase 2C: misconception observation, same transactional
      // client, same atomic operation as the evidence it was
      // classified from -- see MasteryUpdateInput.misconceptionObservation's
      // own doc comment for the exactly-once reasoning. Mutually
      // exclusive with the resolution check just below: a misconception
      // genuinely (re)observed by THIS SAME action cannot, in the same
      // breath, also be evidence that the concept is now free of it.
      let misconceptionObserved = false;
      if (input.misconceptionObservation) {
        const obs = input.misconceptionObservation;
        const observation = await recordStudentMisconception(studentId, obs.signatureId, obs.evidenceRef, learningEvidenceId, client);
        misconceptionObserved = true;
        await recordDecisionEvent(
          {
            decisionType: observation.isReactivation ? 'MISCONCEPTION_REACTIVATED' : 'MISCONCEPTION_RECORDED',
            engine: 'misconception-engine',
            engineVersion: 'v1',
            studentId,
            subjectId,
            conceptId,
            sourceEventType: 'student_misconceptions',
            sourceEventId: learningEvidenceId,
            previousState: { status: observation.previousStatus },
            newState: { status: 'ACTIVE', occurrenceCount: observation.occurrenceCount },
            reasonCode: observation.isReactivation ? 'MISCONCEPTION_REOBSERVED_AFTER_RESOLUTION' : 'AI_MISCONCEPTION_CLASSIFIED',
            reasonDetails: { misconceptionCode: obs.misconceptionCode, isCritical: obs.isCritical },
            aiExecutionId: obs.aiExecution.aiExecutionId,
          },
          client
        );
      }

      // Phase 2C/2C-R: misconception resolution check -- runs for every
      // non-duplicate evidence application (not just Explain & Defend's
      // own), since Verification's SOLO_VERIFICATION evidence flows
      // through this exact same function too. Reuses the Understanding
      // threshold already fetched for the projector immediately below,
      // computed once here so the projector (which reads criticalCount)
      // sees the post-resolution state in this SAME pass -- never one
      // interaction behind (Phase 2C Step 19's explicit ordering
      // requirement).
      if (!misconceptionObserved) {
        const policyForResolution = await getActiveMasteryPolicy(client);
        if (
          isMisconceptionResolutionEvidence(
            { sourceType: evidence.sourceType, scorePercent: evidence.scorePercent ?? null, result: evidence.result, aiAssistanceType: computedAiAssistanceType },
            policyForResolution.minimumUnderstanding
          )
        ) {
          // Phase 2C-R: resolution SCOPE -- never a concept-wide bulk
          // resolve. Explicit scope wins when a caller supplies one
          // (no current writer does -- see MasteryUpdateInput.resolvedMisconceptionSignatureIds's
          // own doc comment); otherwise the conservative fallback: the
          // single ACTIVE signature on this concept resolves only when
          // there is EXACTLY one. Two or more ACTIVE signatures with no
          // explicit scope resolves NONE of them -- ambiguity is never
          // guessed away, closing the false-positive VALIDATED_MASTERY
          // path external review found in Phase 2C.
          let scopeIds: string[];
          if (input.resolvedMisconceptionSignatureIds && input.resolvedMisconceptionSignatureIds.length > 0) {
            scopeIds = input.resolvedMisconceptionSignatureIds;
          } else {
            const activeSignatureIds = await getActiveMisconceptionSignatureIdsForConcept(studentId, conceptId, client);
            scopeIds = activeSignatureIds.length === 1 ? activeSignatureIds : [];
          }

          if (scopeIds.length > 0) {
            const resolved = await resolveMisconceptionSignatures(studentId, conceptId, scopeIds, learningEvidenceId, client);
            for (const r of resolved) {
              await recordDecisionEvent(
                {
                  decisionType: 'MISCONCEPTION_RESOLVED',
                  engine: 'misconception-engine',
                  engineVersion: 'v1',
                  studentId,
                  subjectId,
                  conceptId,
                  sourceEventType: 'student_misconceptions',
                  sourceEventId: learningEvidenceId,
                  previousState: { status: 'ACTIVE' },
                  newState: { status: 'RESOLVED' },
                  reasonCode: 'RESOLUTION_EVIDENCE_QUALIFIED',
                  reasonDetails: { misconceptionCode: r.misconceptionCode, isCritical: r.isCritical, resolvingSourceType: evidence.sourceType },
                  aiExecutionId: null, // resolution is a DETERMINISTIC_DERIVATION from this evidence's own result/source-type -- never AI-attributed (Phase 2C Step 39).
                },
                client
              );
            }
          }
        }
      }

      // Phase 2.2A/2.2B, same transactional client (Phase 2B
      // correction): Knowledge State is a projection, never a second
      // source of truth. A failure here now rolls back the whole
      // operation instead of silently leaving Mastery updated but
      // Knowledge State stale -- deliberately, per Phase 2B's "if the
      // operation is considered applied, cognitive state must be
      // internally consistent" invariant. The caller (and,
      // transitively, the student) sees an error and can safely
      // retry: operation_key makes the retry itself idempotent.
      await recalculateConceptKnowledgeState(studentId, conceptId, client);

      await client.query('COMMIT');

      result = { oldMastery, newMastery, delta, confidenceScore, learningDebtCreated, learningDebtSeverity, eventId };
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (duplicate) {
    // Safe observability (Phase 2B Step 30/29): structural, opaque
    // identifiers only -- never a student id, raw answer, or AI
    // response.
    console.info('[idempotency] duplicate evidence application prevented', {
      operationType: identity!.operationType,
      conceptId,
    });
    const current = await readCurrentMasteryForDuplicateResponse(studentId, conceptId);
    result = {
      oldMastery: current.masteryScore,
      newMastery: current.masteryScore,
      delta: 0,
      confidenceScore: current.confidenceScore,
      learningDebtCreated: false,
      learningDebtSeverity: 0,
      eventId: current.eventId,
      duplicate: true,
    };
  }

  return result!;
}

/**
 * Get recent results for a concept (for confidence calculation)
 */
async function getRecentResults(
  studentId: string,
  conceptId: string,
  limit: number = 5,
  client: DbExecutor = db
) {
  const result = await client.query(
    `
    SELECT result
    FROM learning_evidence
    WHERE student_id = $1 AND concept_id = $2
    ORDER BY timestamp DESC
    LIMIT $3
    `,
    [studentId, conceptId, limit]
  );

  return result.rows;
}

/**
 * Calculate days since last attempt
 */
function getDaysSinceLastAttempt(lastPracticedDate: string | null): number {
  if (!lastPracticedDate) return 999; // Never attempted

  const last = new Date(lastPracticedDate).getTime();
  const now = new Date().getTime();
  const daysDiff = (now - last) / (1000 * 60 * 60 * 24);

  return Math.floor(daysDiff);
}

/**
 * Get mastery progression for a concept (for visualization)
 */
export async function getMasteryHistory(
  studentId: string,
  conceptId: string,
  limit: number = 20
) {
  const result = await db.query(
    `
    SELECT
      created_at as timestamp,
      old_score,
      new_score,
      delta_reason
    FROM mastery_events
    WHERE mastery_id IN (
      SELECT id FROM mastery_records
      WHERE student_id = $1 AND concept_id = $2
    )
    ORDER BY created_at DESC
    LIMIT $3
    `,
    [studentId, conceptId, limit]
  );

  return result.rows;
}

/**
 * Get all concepts for a student with current mastery
 */
export async function getStudentMastery(
  studentId: string,
  subjectId?: string,
  preferredLanguage: string = 'en',
  ensureLabels: boolean = false
) {
  if (ensureLabels) {
    const idsQuery = subjectId
      ? `SELECT c.id FROM mastery_records mr JOIN concepts c ON mr.concept_id = c.id WHERE mr.student_id = $1 AND mr.subject_id = $2`
      : `SELECT c.id FROM mastery_records mr JOIN concepts c ON mr.concept_id = c.id WHERE mr.student_id = $1`;
    const idsParams = subjectId ? [studentId, subjectId] : [studentId];
    const idsResult = await db.query(idsQuery, idsParams);
    // Non-blocking: a large subject could take a while to translate on
    // first view. Concepts fall back to canonical_id until it completes.
    ensureConceptLocalizations(idsResult.rows.map((r) => r.id), preferredLanguage).catch((err) =>
      console.error('Background concept localization failed:', err)
    );
  }

  let query = `
    SELECT
      c.id as concept_id,
      c.canonical_id,
      COALESCE(cl.label, c.canonical_id) as label,
      mr.mastery_score,
      mr.confidence_score,
      mr.attempt_count,
      mr.last_practiced,
      ld.severity as learning_debt_severity,
      ld.status as learning_debt_status
    FROM mastery_records mr
    JOIN concepts c ON mr.concept_id = c.id
    LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
    LEFT JOIN learning_debt ld ON mr.student_id = ld.student_id AND mr.concept_id = ld.concept_id AND ld.status = 'active'
    WHERE mr.student_id = $1
  `;

  const params: any[] = [studentId, preferredLanguage];

  if (subjectId) {
    query += ` AND mr.subject_id = $3`;
    params.push(subjectId);
  }

  query += ` ORDER BY mr.mastery_score ASC`;

  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Delete a concept. A mastery_records row, a concept_localizations
 * row, and (if generated) a concept_explanations row are all
 * structural -- created alongside the concept rather than being
 * "history" -- so they're removed as part of the same operation. Real
 * activity -- mastery_events, quiz_sessions, errors, learning_debt,
 * study_session_items, learning_evidence -- still blocks the delete
 * via the DB's own foreign keys (all NO ACTION), surfaced here as
 * HAS_HISTORY so the caller can suggest archiving instead.
 */
export async function deleteConcept(
  studentId: string,
  conceptId: string
): Promise<{ success: boolean; error?: 'NOT_FOUND' | 'HAS_HISTORY' }> {
  const client = await db.connect();
  try {
    const ownership = await client.query(
      `SELECT c.id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE c.id = $1 AND s.student_id = $2`,
      [conceptId, studentId]
    );
    if (ownership.rowCount === 0) {
      return { success: false, error: 'NOT_FOUND' };
    }

    await client.query('BEGIN');
    await client.query(`DELETE FROM concept_localizations WHERE concept_id = $1`, [conceptId]);
    await client.query(`DELETE FROM concept_explanations WHERE concept_id = $1`, [conceptId]);
    await client.query(`DELETE FROM mastery_records WHERE concept_id = $1 AND student_id = $2`, [
      conceptId,
      studentId,
    ]);
    await client.query(`DELETE FROM concepts WHERE id = $1`, [conceptId]);
    await client.query('COMMIT');
    return { success: true };
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error.code === '23503') {
      return { success: false, error: 'HAS_HISTORY' };
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Upserts today's average-mastery snapshot for a subject. Cheap and
 * idempotent (one row per subject per day) -- safe to call on every
 * dashboard load without awaiting it.
 */
export async function recordDailyMasterySnapshot(
  studentId: string,
  subjectId: string,
  avgMasteryScore: number
): Promise<void> {
  await db.query(
    `
    INSERT INTO subject_mastery_snapshots (student_id, subject_id, snapshot_date, avg_mastery_score)
    VALUES ($1, $2, CURRENT_DATE, $3)
    ON CONFLICT (subject_id, snapshot_date) DO UPDATE SET avg_mastery_score = EXCLUDED.avg_mastery_score
    `,
    [studentId, subjectId, Math.round(avgMasteryScore)]
  );
}

/**
 * Recent daily mastery trend for a subject, oldest first. Returns
 * however many snapshots exist within the window (0 to `days`) --
 * callers should treat fewer than 2 points as "not enough history yet"
 * rather than rendering a misleading single-point line.
 */
export async function getMasteryTrend(subjectId: string, days: number = 14): Promise<number[]> {
  const result = await db.query(
    `
    SELECT avg_mastery_score FROM subject_mastery_snapshots
    WHERE subject_id = $1 AND snapshot_date >= CURRENT_DATE - $2::int
    ORDER BY snapshot_date ASC
    `,
    [subjectId, days]
  );
  return result.rows.map((r) => Number(r.avg_mastery_score));
}
