/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6E: the canonical IO boundary between Phase 6's pure model
 * (src/lib/algorithms/memory-model.ts) and the database.
 *
 * SHADOW MODE: this service WRITES concept_memory_state (via the
 * caller's own transaction client) and its own decision_events audit
 * trail, but nothing anywhere in the product reads either yet. Its
 * only current caller is mastery.service.ts::updateMastery.
 *
 * This service does NOT:
 *   - open its own transaction (BEGIN/COMMIT/ROLLBACK stay entirely
 *     the caller's responsibility -- see projectConceptMemoryState's
 *     `client` parameter)
 *   - create a second evidence writer or a second idempotency system
 *     (it only ever READS learning_evidence, via the same client the
 *     caller is already using; a duplicate operation_key application
 *     never reaches this function at all, since updateMastery only
 *     calls it on the non-duplicate path)
 *   - grade, generate questions, call AI, modify Mastery/Knowledge
 *     State, or decide the next activity
 */
import { type DbExecutor } from '@/lib/db';
import {
  normalizeMemoryEvidence,
  projectMemoryStateFromEvidenceDetailed,
  type RawLearningEvidenceRow,
  type CanonicalMemoryEvidence,
  type MemoryState,
  type MemoryProjectionDetail,
} from '@/lib/algorithms/memory-model';
import { MEMORY_POLICY_V1, type MemoryPolicyV1 } from '@/lib/memory-policy';
import { recordDecisionEvent } from '@/lib/audit';

export interface MemoryProjectionDiagnostics {
  readonly totalEvidenceRows: number;
  readonly validMemoryEvidenceRows: number;
  readonly invalidMemoryEvidenceRows: number;
  readonly invalidReasonCounts: Readonly<Record<string, number>>;
  /** Lifetime count of qualifying attempts found across ALL history -- NOT capped at policy.demonstratedRetentionMaxEvidence (that cap only bounds MemoryState.retentionEvidenceCount, the score-backing window). */
  readonly qualifiedRetentionAttemptCount: number;
  readonly policyVersion: number;
}

export interface MemoryProjectionResult {
  readonly state: MemoryState;
  readonly stateChanged: boolean;
  readonly diagnostics: MemoryProjectionDiagnostics;
}

interface RawEvidenceDbRow {
  id: string;
  student_id: string;
  concept_id: string;
  /** The unreliable top-level column -- selected ONLY to populate RawLearningEvidenceRow.activityType, which normalizeMemoryEvidence structurally never reads (Step 6D/6C-R). */
  activity_type: string | null;
  result: 'correct' | 'incorrect' | 'partial';
  score_percent: string | number | null;
  timestamp: string | Date;
  ai_assistance_type: string;
  hints_used: number;
  operation_key: string | null;
  difficulty: string | number | null;
  metadata: { activityType?: unknown; evidenceMode?: unknown } | null;
}

function rowToRawEvidence(row: RawEvidenceDbRow): RawLearningEvidenceRow {
  return {
    id: row.id,
    studentId: row.student_id,
    conceptId: row.concept_id,
    activityType: row.activity_type,
    result: row.result,
    scorePercent: row.score_percent === null ? null : Number(row.score_percent),
    aiAssistanceType: row.ai_assistance_type,
    hintsUsed: row.hints_used,
    operationKey: row.operation_key,
    timestamp: new Date(row.timestamp).toISOString(),
    difficulty: row.difficulty === null || row.difficulty === undefined ? undefined : Number(row.difficulty),
    metadata: row.metadata,
  };
}

interface ConceptMemoryStateDbRow {
  policy_version: number;
  initial_competence_anchor_at: string | Date | null;
  last_qualified_attempt_at: string | Date | null;
  last_successful_retention_at: string | Date | null;
  last_unsuccessful_retention_at: string | Date | null;
  demonstrated_retention_score: string | number | null;
  retention_evidence_count: number;
  consecutive_qualifying_successes: number;
  memory_stability: MemoryState['memoryStability'];
  memory_status: MemoryState['memoryStatus'];
  next_review_at: string | Date | null;
}

function isoOrNull(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function rowToMemoryState(studentId: string, conceptId: string, row: ConceptMemoryStateDbRow): MemoryState {
  return {
    studentId,
    conceptId,
    policyVersion: row.policy_version,
    initialCompetenceAnchorAt: isoOrNull(row.initial_competence_anchor_at),
    lastQualifiedAttemptAt: isoOrNull(row.last_qualified_attempt_at),
    lastSuccessfulRetentionAt: isoOrNull(row.last_successful_retention_at),
    lastUnsuccessfulRetentionAt: isoOrNull(row.last_unsuccessful_retention_at),
    demonstratedRetentionScore: row.demonstrated_retention_score === null ? null : Number(row.demonstrated_retention_score),
    retentionEvidenceCount: row.retention_evidence_count,
    consecutiveQualifyingSuccesses: row.consecutive_qualifying_successes,
    memoryStability: row.memory_stability,
    memoryStatus: row.memory_status,
    nextReviewAt: isoOrNull(row.next_review_at),
  };
}

/** Plain structural equality over MemoryState -- a flat, fully-JSON-serializable shape (no nested objects, no undefined fields), so this is safe and exact. */
function memoryStatesEqual(a: MemoryState, b: MemoryState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Derives a deterministic, non-AI audit reason code by comparing the
 * previously-persisted state to the freshly-replayed one, using the
 * replay's own qualifiedAttempts list to distinguish SUCCESS/PARTIAL/
 * FAILURE (never inferred from question/answer content). Returns null
 * when nothing worth recording changed -- callers must not emit an
 * event in that case (Step 6E Section 15).
 */
function deriveTransitionReasonCode(previous: MemoryState | null, detail: MemoryProjectionDetail): string | null {
  const next = detail.state;

  const anchorNewlyEstablished =
    (previous === null || previous.initialCompetenceAnchorAt === null) && next.initialCompetenceAnchorAt !== null;

  const newQualifiedAttemptArrived = previous === null || next.lastQualifiedAttemptAt !== previous.lastQualifiedAttemptAt;

  if (newQualifiedAttemptArrived && detail.qualifiedAttempts.length > 0) {
    const mostRecent = detail.qualifiedAttempts[detail.qualifiedAttempts.length - 1];
    if (mostRecent.outcome === 'SUCCESS') return 'QUALIFIED_RETENTION_SUCCESS';
    if (mostRecent.outcome === 'PARTIAL') return 'QUALIFIED_RETENTION_PARTIAL';
    return 'QUALIFIED_RETENTION_FAILURE';
  }

  if (anchorNewlyEstablished) return 'MEMORY_ANCHOR_ESTABLISHED';

  // Something changed (stateChanged was already true, by construction of
  // the only caller) but not attributable to a specific new qualifying
  // attempt or a freshly-set anchor -- e.g. a policy-version reprojection.
  return 'MEMORY_STATE_REPROJECTED';
}

/**
 * Steps 1-4 of the projection pipeline: read canonical evidence + the
 * existing persisted row (both via `client`, no writes anywhere),
 * normalize, replay through the pure model, and diagnose -- everything
 * a caller needs to decide what WOULD happen, without committing to
 * doing it. Exported so Step 6F's backfill service can share this
 * exact read+compute path for its DRY_RUN mode (Section 2: one
 * canonical replay model, reused by every IO path, never a second
 * formula) -- `projectConceptMemoryState` below is simply this
 * function plus the write+audit steps.
 */
export interface MemoryProjectionComputation {
  readonly previousState: MemoryState | null;
  readonly detail: MemoryProjectionDetail;
  readonly stateChanged: boolean;
  readonly diagnostics: MemoryProjectionDiagnostics;
}

/**
 * Steps 1-3 of the projection pipeline, extracted so any caller that
 * needs a pure replay of Phase 6 state FROM EVIDENCE ONLY -- never
 * from the persisted concept_memory_state row -- can share the exact
 * same read+normalize+replay path. Step 6J-B2's knowledge-state-
 * backfill preview is the reason this needed its own name: it must
 * reconstruct current Phase 6 state without assuming
 * projectConceptMemoryState has ever run for this pair (a dry-run
 * preview has to work before backfill/live projection has populated
 * concept_memory_state at all), so it cannot go through
 * computeMemoryProjection (which reads that table). No second
 * formula: same query, same normalizeMemoryEvidence, same
 * projectMemoryStateFromEvidenceDetailed as the live/backfill write
 * path below.
 */
export async function replayMemoryProjectionFromEvidence(
  client: DbExecutor,
  studentId: string,
  conceptId: string,
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): Promise<{ detail: MemoryProjectionDetail; diagnostics: MemoryProjectionDiagnostics }> {
  // Same transaction client, so this sees the current call's own
  // just-inserted (still-uncommitted) row when called mid-transaction.
  // ORDER BY here is for query efficiency/readability only -- the pure
  // model (projectMemoryStateFromEvidenceDetailed) independently
  // re-sorts by timestamp ASC, evidenceId ASC regardless, so SQL
  // ordering is never the semantic guarantee.
  const evidenceResult = await client.query(
    `SELECT id, student_id, concept_id, activity_type, result, score_percent, timestamp,
            ai_assistance_type, hints_used, operation_key, difficulty, metadata
     FROM learning_evidence
     WHERE student_id = $1 AND concept_id = $2
     ORDER BY timestamp ASC, id ASC`,
    [studentId, conceptId]
  );
  const rawRows: RawEvidenceDbRow[] = evidenceResult.rows;

  // Normalize -- fail closed per row, never crash over one unusable
  // historical row.
  const invalidReasonCounts: Record<string, number> = {};
  const validEvidence: CanonicalMemoryEvidence[] = [];
  for (const row of rawRows) {
    const normalized = normalizeMemoryEvidence(rowToRawEvidence(row));
    if (normalized.valid) {
      validEvidence.push(normalized.evidence);
    } else {
      invalidReasonCounts[normalized.reason] = (invalidReasonCounts[normalized.reason] ?? 0) + 1;
    }
  }

  // Replay -- pure, deterministic, no DB/AI/clock inside.
  const detail = projectMemoryStateFromEvidenceDetailed(studentId, conceptId, validEvidence, policy);

  const diagnostics: MemoryProjectionDiagnostics = {
    totalEvidenceRows: rawRows.length,
    validMemoryEvidenceRows: validEvidence.length,
    invalidMemoryEvidenceRows: rawRows.length - validEvidence.length,
    invalidReasonCounts,
    qualifiedRetentionAttemptCount: detail.qualifiedAttempts.length,
    policyVersion: policy.version,
  };

  return { detail, diagnostics };
}

export async function computeMemoryProjection(
  client: DbExecutor,
  studentId: string,
  conceptId: string,
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): Promise<MemoryProjectionComputation> {
  // 1-3. Read canonical evidence, normalize, replay -- shared with the
  // preview-only path below.
  const { detail, diagnostics } = await replayMemoryProjectionFromEvidence(client, studentId, conceptId, policy);

  // 4. Read existing persisted state (same client) for the no-change comparison.
  const existingResult = await client.query(
    `SELECT policy_version, initial_competence_anchor_at, last_qualified_attempt_at, last_successful_retention_at,
            last_unsuccessful_retention_at, demonstrated_retention_score, retention_evidence_count,
            consecutive_qualifying_successes, memory_stability, memory_status, next_review_at
     FROM concept_memory_state
     WHERE student_id = $1 AND concept_id = $2
     LIMIT 1`,
    [studentId, conceptId]
  );
  const existingRow: ConceptMemoryStateDbRow | undefined = existingResult.rows[0];
  const previousState: MemoryState | null = existingRow ? rowToMemoryState(studentId, conceptId, existingRow) : null;

  const next = detail.state;
  const rowExists = existingRow !== undefined;
  const stateChanged = !rowExists || !memoryStatesEqual(previousState!, next);

  return { previousState, detail, stateChanged, diagnostics };
}

/**
 * The canonical, IO-only Phase 6 write path. Calls
 * computeMemoryProjection (steps 1-4) then upserts concept_memory_state
 * 1:1 with the replayed MemoryState, using the SAME transaction
 * client -- never a new connection, never its own BEGIN/COMMIT/
 * ROLLBACK. Skips the database write entirely when the freshly-
 * replayed state is identical to what is already persisted (Section 8
 * -- no updated_at churn, no duplicate audit event, from
 * re-projecting unrelated PRACTICE evidence or an idempotent replay).
 *
 * `options.skipAudit` (Step 6F): historical backfill reconstructs
 * CURRENT state from evidence that was never live-observed as it
 * happened -- it must never fabricate a MEMORY_ANCHOR_ESTABLISHED/
 * QUALIFIED_RETENTION_* decision_events row implying a transition
 * occurred at backfill time. The live path (Step 6E, called from
 * updateMastery) never sets this -- its default (false) is exactly
 * Step 6E's already-validated behavior, unchanged.
 *
 * If `client`'s enclosing transaction rolls back for any reason
 * (including this function throwing), every write this function made
 * rolls back with it -- there is no separate commit boundary.
 */
export async function projectConceptMemoryState(
  client: DbExecutor,
  studentId: string,
  conceptId: string,
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1,
  options: { skipAudit?: boolean } = {}
): Promise<MemoryProjectionResult> {
  const { previousState, detail, stateChanged, diagnostics } = await computeMemoryProjection(client, studentId, conceptId, policy);
  const next = detail.state;
  const rowExists = previousState !== null;

  // 5. Upsert -- insert if no row exists yet (even a NOT_ESTABLISHED
  // state is a legitimate first row); update only when something
  // semantically changed; otherwise skip the write entirely.
  if (!rowExists) {
    await client.query(
      `INSERT INTO concept_memory_state (
         student_id, concept_id, policy_version,
         initial_competence_anchor_at, last_qualified_attempt_at, last_successful_retention_at, last_unsuccessful_retention_at,
         demonstrated_retention_score, retention_evidence_count, consecutive_qualifying_successes,
         memory_stability, memory_status, next_review_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        studentId,
        conceptId,
        next.policyVersion,
        next.initialCompetenceAnchorAt,
        next.lastQualifiedAttemptAt,
        next.lastSuccessfulRetentionAt,
        next.lastUnsuccessfulRetentionAt,
        next.demonstratedRetentionScore,
        next.retentionEvidenceCount,
        next.consecutiveQualifyingSuccesses,
        next.memoryStability,
        next.memoryStatus,
        next.nextReviewAt,
      ]
    );
  } else if (stateChanged) {
    await client.query(
      `UPDATE concept_memory_state SET
         policy_version = $3, initial_competence_anchor_at = $4, last_qualified_attempt_at = $5,
         last_successful_retention_at = $6, last_unsuccessful_retention_at = $7,
         demonstrated_retention_score = $8, retention_evidence_count = $9, consecutive_qualifying_successes = $10,
         memory_stability = $11, memory_status = $12, next_review_at = $13, updated_at = NOW()
       WHERE student_id = $1 AND concept_id = $2`,
      [
        studentId,
        conceptId,
        next.policyVersion,
        next.initialCompetenceAnchorAt,
        next.lastQualifiedAttemptAt,
        next.lastSuccessfulRetentionAt,
        next.lastUnsuccessfulRetentionAt,
        next.demonstratedRetentionScore,
        next.retentionEvidenceCount,
        next.consecutiveQualifyingSuccesses,
        next.memoryStability,
        next.memoryStatus,
        next.nextReviewAt,
      ]
    );
  }
  // else: rowExists && !stateChanged -- no database write at all.

  // 6. Audit -- only on a genuine semantic change, and only when the
  // caller hasn't opted out (Step 6F backfill always sets skipAudit:
  // true, since it must never fabricate a historical decision_events
  // row for a transition that was never live-observed). Same
  // transaction client as everything else -- a failure here propagates
  // and rolls back the whole operation, exactly like every other step
  // of updateMastery's own atomic operation.
  if (stateChanged && !options.skipAudit) {
    const reasonCode = deriveTransitionReasonCode(previousState, detail);
    if (reasonCode !== null) {
      await recordDecisionEvent(
        {
          decisionType: reasonCode as
            | 'MEMORY_ANCHOR_ESTABLISHED'
            | 'QUALIFIED_RETENTION_SUCCESS'
            | 'QUALIFIED_RETENTION_PARTIAL'
            | 'QUALIFIED_RETENTION_FAILURE'
            | 'MEMORY_STATE_REPROJECTED',
          engine: 'memory-engine',
          engineVersion: 'v1',
          studentId,
          conceptId,
          sourceEventType: 'concept_memory_state',
          previousState: previousState ? { ...previousState } : null,
          newState: { ...next },
          reasonCode,
          reasonDetails: { policyVersion: policy.version },
        },
        client
      );
    }
  }

  return { state: next, stateChanged, diagnostics };
}
