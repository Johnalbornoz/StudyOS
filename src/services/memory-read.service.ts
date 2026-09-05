/**
 * STUDYUS PHASE 6 -- RETENTION & MEMORY ENGINE
 * Step 6G: the canonical Phase 6 -> Phase 2 read boundary.
 * Step 6H-B: extended with the canonical Phase 6 -> Phase 4 read
 * boundary (getPhase4MemorySignalsForStudent, below).
 *
 * This is the ONLY place Phase 2 (Knowledge State) is allowed to read
 * concept_memory_state. It exposes exactly the fields Phase 2's
 * retention DIMENSION needs -- demonstratedRetentionScore plus a small
 * amount of supporting context -- and structurally EXCLUDES every
 * predicted/scheduling field (retrievabilityNow, forgettingRisk,
 * retentionDue, daysOverdue, predictionConfidence, nextReviewAt).
 * Predicted forgetting must never revoke mastery; the Phase2MemoryInput
 * type simply has nowhere to put such a value, so a caller cannot feed
 * it into a mastery decision even by mistake.
 *
 * Read-only. Transaction-aware: `client` is the CALLER's own
 * transaction executor (mastery.service.ts::updateMastery's checked-out
 * connection, in the canonical live path) -- this module never opens
 * its own connection or transaction.
 */
import { type DbExecutor } from '@/lib/db';
import { MEMORY_POLICY_V1, type MemoryPolicyV1, type MemoryStatus, type MemoryStability, type PredictionConfidence } from '@/lib/memory-policy';
import { computeLiveMemorySignals, type MemoryState } from '@/lib/algorithms/memory-model';

export interface ConceptMemoryStateRecord {
  readonly studentId: string;
  readonly conceptId: string;
  readonly policyVersion: number;
  readonly demonstratedRetentionScore: number | null;
  readonly retentionEvidenceCount: number;
  readonly memoryStatus: MemoryStatus;
  readonly lastSuccessfulRetentionAt: string | null;
}

/**
 * Structural read of concept_memory_state -- returns null if no row
 * exists yet (a legitimate state for a concept the live projector has
 * never touched). This is the general-purpose read; Phase 2 should
 * prefer getPhase2MemoryInput below, which fails closed instead of
 * returning null, since Phase 2's canonical path requires the row to
 * already exist.
 */
export async function getConceptMemoryState(
  client: DbExecutor,
  studentId: string,
  conceptId: string
): Promise<ConceptMemoryStateRecord | null> {
  const result = await client.query(
    `SELECT policy_version, demonstrated_retention_score, retention_evidence_count, memory_status, last_successful_retention_at
     FROM concept_memory_state
     WHERE student_id = $1 AND concept_id = $2
     LIMIT 1`,
    [studentId, conceptId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    studentId,
    conceptId,
    policyVersion: row.policy_version,
    demonstratedRetentionScore: row.demonstrated_retention_score === null ? null : Number(row.demonstrated_retention_score),
    retentionEvidenceCount: row.retention_evidence_count,
    memoryStatus: row.memory_status,
    lastSuccessfulRetentionAt: row.last_successful_retention_at === null ? null : new Date(row.last_successful_retention_at).toISOString(),
  };
}

/**
 * The Phase 2-specific contract. Deliberately does NOT contain
 * retrievabilityNow, forgettingRisk, retentionDue, daysOverdue, or
 * predictionConfidence -- those are Phase 6 prediction/scheduling
 * signals, and Phase 2 (Knowledge State / VALIDATED_MASTERY) must
 * never consume them. This is a structural guarantee, not a
 * convention: the type has no field to accidentally read.
 */
export interface Phase2MemoryInput {
  readonly demonstratedRetentionScore: number | null;
  readonly retentionEvidenceCount: number;
  readonly memoryStatus: MemoryStatus;
  readonly lastSuccessfulRetentionAt: string | null;
  readonly policyVersion: number;
}

export class MissingConceptMemoryStateError extends Error {
  constructor(studentId: string, conceptId: string) {
    super(
      `MISSING_CONCEPT_MEMORY_STATE: no concept_memory_state row for student=${studentId} concept=${conceptId}. ` +
        `The canonical order inside updateMastery always runs the Phase 6 projector immediately before Knowledge ` +
        `State recalculation, in the same transaction -- a missing row at this point is an invariant violation, ` +
        `not a case to fall back from. Never substitute the legacy classifyRetention()/retention_score/getRetention() ` +
        `value here; let this error propagate so the surrounding transaction rolls back instead of committing two ` +
        `inconsistent truths.`
    );
    this.name = 'MissingConceptMemoryStateError';
  }
}

/**
 * Phase 2's sole authorized read of Phase 6 state. Fails closed
 * (throws MissingConceptMemoryStateError) when no concept_memory_state
 * row exists rather than returning a default/null input -- see Step 6G
 * Section 4. Every canonical caller (mastery.service.ts::updateMastery)
 * already guarantees the row exists by running the projector first, in
 * the same transaction, so this should never throw on the live path;
 * if it does, that is exactly the bug it exists to catch.
 */
export async function getPhase2MemoryInput(client: DbExecutor, studentId: string, conceptId: string): Promise<Phase2MemoryInput> {
  const record = await getConceptMemoryState(client, studentId, conceptId);
  if (record === null) throw new MissingConceptMemoryStateError(studentId, conceptId);
  return {
    demonstratedRetentionScore: record.demonstratedRetentionScore,
    retentionEvidenceCount: record.retentionEvidenceCount,
    memoryStatus: record.memoryStatus,
    lastSuccessfulRetentionAt: record.lastSuccessfulRetentionAt,
    policyVersion: record.policyVersion,
  };
}

// ============================================================
// STEP 6H-B -- PHASE 4 READ BOUNDARY
// ============================================================

/**
 * The Phase 4-specific contract. Deliberately contains ONLY raw
 * canonical memory fields -- nextReviewAt, retentionDue, daysOverdue,
 * retrievabilityNow, forgettingRisk, memoryStatus,
 * lastSuccessfulRetentionAt, memoryStability, predictionConfidence,
 * policyVersion -- and nothing that ranks, scores, or selects an
 * activity. Phase 4's own pure policy (adaptive-learning-policy.ts)
 * remains the only place a priority/band/activityType is decided; this
 * type has no field for any of those, so it cannot be misused to
 * bypass that policy even by mistake.
 *
 * `retentionDue`/`daysOverdue` here are Phase 6's own "already due"
 * semantics (nextReviewAt <= now) -- NOT the same as Phase 4's
 * existing "due soon" lookahead window (nextReviewAt <= now + N days).
 * The lookahead window is a Phase-4-owned temporal-relevance decision
 * (mirrors how EXAM_APPROACHING's own window check lives in the
 * orchestrator, not in assessment.service.ts) -- callers that need the
 * lookahead behavior must apply it themselves against `nextReviewAt`,
 * exactly like adaptive-learning-orchestrator.service.ts does.
 */
export interface Phase4MemorySignal {
  readonly nextReviewAt: string | null;
  readonly retentionDue: boolean;
  readonly daysOverdue: number | null;
  readonly retrievabilityNow: number | null;
  readonly forgettingRisk: number | null;
  readonly memoryStatus: MemoryStatus;
  readonly lastSuccessfulRetentionAt: string | null;
  readonly memoryStability: MemoryStability;
  readonly predictionConfidence: PredictionConfidence;
  readonly policyVersion: number;
}

interface ConceptMemoryStateFullRow {
  concept_id: string;
  policy_version: number;
  initial_competence_anchor_at: string | Date | null;
  last_qualified_attempt_at: string | Date | null;
  last_successful_retention_at: string | Date | null;
  last_unsuccessful_retention_at: string | Date | null;
  demonstrated_retention_score: string | number | null;
  retention_evidence_count: number;
  consecutive_qualifying_successes: number;
  memory_stability: MemoryStability;
  memory_status: MemoryStatus;
  next_review_at: string | Date | null;
}

const FULL_MEMORY_STATE_COLUMNS = `concept_id, policy_version, initial_competence_anchor_at, last_qualified_attempt_at,
       last_successful_retention_at, last_unsuccessful_retention_at, demonstrated_retention_score,
       retention_evidence_count, consecutive_qualifying_successes, memory_stability, memory_status, next_review_at`;

function isoOrNull(value: string | Date | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function rowToMemoryState(studentId: string, conceptId: string, row: ConceptMemoryStateFullRow): MemoryState {
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

/**
 * Step 6I: the shared full-row query both getPhase4MemorySignalsForStudent
 * and the Twin readers below build on -- ONE canonical DB read + row
 * mapping, never duplicated per consumer (Section 2: "One Phase 6 read
 * boundary should own: DB read, live derived signal calculation, policy
 * version, canonical field mapping").
 */
async function queryConceptMemoryStatesForStudent(client: DbExecutor, studentId: string): Promise<Map<string, MemoryState>> {
  const result = await client.query(
    `SELECT ${FULL_MEMORY_STATE_COLUMNS} FROM concept_memory_state WHERE student_id = $1`,
    [studentId]
  );
  const states = new Map<string, MemoryState>();
  for (const row of result.rows as ConceptMemoryStateFullRow[]) {
    states.set(row.concept_id, rowToMemoryState(studentId, row.concept_id, row));
  }
  return states;
}

async function queryConceptMemoryStateForOne(client: DbExecutor, studentId: string, conceptId: string): Promise<MemoryState | null> {
  const result = await client.query(
    `SELECT ${FULL_MEMORY_STATE_COLUMNS} FROM concept_memory_state WHERE student_id = $1 AND concept_id = $2 LIMIT 1`,
    [studentId, conceptId]
  );
  const row = result.rows[0] as ConceptMemoryStateFullRow | undefined;
  return row ? rowToMemoryState(studentId, conceptId, row) : null;
}

function toPhase4MemorySignal(state: MemoryState, nowIso: string, policy: MemoryPolicyV1): Phase4MemorySignal {
  const live = computeLiveMemorySignals(state, nowIso, policy);
  return {
    nextReviewAt: state.nextReviewAt,
    retentionDue: live.retentionDue,
    daysOverdue: live.daysOverdue,
    retrievabilityNow: live.retrievabilityNow,
    forgettingRisk: live.forgettingRisk,
    memoryStatus: state.memoryStatus,
    lastSuccessfulRetentionAt: state.lastSuccessfulRetentionAt,
    memoryStability: state.memoryStability,
    predictionConfidence: live.predictionConfidence,
    policyVersion: state.policyVersion,
  };
}

/**
 * One query for every concept_memory_state row this student has --
 * never one query per concept (Step 6H-B Section 3: the orchestrator
 * already loads every other signal source in bounded, per-student
 * batches; a per-concept memory read would be the one N+1 in an
 * otherwise-bounded pipeline). A concept absent from the returned Map
 * has no canonical memory state yet -- callers MUST treat that as "no
 * Phase 6 memory signal available for this concept" and emit nothing
 * Phase-6-derived for it, never a fabricated zero and never a fallback
 * to legacy memory semantics (Step 6H-B Section 4).
 */
export async function getPhase4MemorySignalsForStudent(
  client: DbExecutor,
  studentId: string,
  now: Date = new Date(),
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): Promise<Map<string, Phase4MemorySignal>> {
  const states = await queryConceptMemoryStatesForStudent(client, studentId);
  const nowIso = now.toISOString();
  const signals = new Map<string, Phase4MemorySignal>();
  for (const [conceptId, state] of states) {
    signals.set(conceptId, toPhase4MemorySignal(state, nowIso, policy));
  }
  return signals;
}

// ============================================================
// STEP 6I -- DIGITAL LEARNING TWIN READ BOUNDARY
// ============================================================

/**
 * The full Phase 6B target contract for the Twin (Step 6I Section 3):
 * every canonical memory field a read/display surface may legitimately
 * want, evidence-driven and predicted fields both included (unlike
 * Phase2MemoryInput/Phase4MemorySignal, which each expose only their
 * own narrower slice for their own reasons). Still never exposes raw
 * learning_evidence or question/answer content -- only the already-
 * projected concept_memory_state row plus its live-derived signals.
 */
export interface TwinMemorySignal {
  readonly demonstratedRetentionScore: number | null;
  readonly retentionEvidenceCount: number;
  readonly memoryStatus: MemoryStatus;
  readonly memoryStability: MemoryStability;
  readonly consecutiveQualifyingSuccesses: number;
  readonly initialCompetenceAnchorAt: string | null;
  readonly lastQualifiedAttemptAt: string | null;
  readonly lastSuccessfulRetentionAt: string | null;
  readonly lastUnsuccessfulRetentionAt: string | null;
  readonly nextReviewAt: string | null;
  readonly retentionDue: boolean;
  readonly daysOverdue: number | null;
  readonly retrievabilityNow: number | null;
  readonly forgettingRisk: number | null;
  readonly predictionConfidence: PredictionConfidence;
  readonly policyVersion: number;
}

function toTwinMemorySignal(state: MemoryState, nowIso: string, policy: MemoryPolicyV1): TwinMemorySignal {
  const live = computeLiveMemorySignals(state, nowIso, policy);
  return {
    demonstratedRetentionScore: state.demonstratedRetentionScore,
    retentionEvidenceCount: state.retentionEvidenceCount,
    memoryStatus: state.memoryStatus,
    memoryStability: state.memoryStability,
    consecutiveQualifyingSuccesses: state.consecutiveQualifyingSuccesses,
    initialCompetenceAnchorAt: state.initialCompetenceAnchorAt,
    lastQualifiedAttemptAt: state.lastQualifiedAttemptAt,
    lastSuccessfulRetentionAt: state.lastSuccessfulRetentionAt,
    lastUnsuccessfulRetentionAt: state.lastUnsuccessfulRetentionAt,
    nextReviewAt: state.nextReviewAt,
    retentionDue: live.retentionDue,
    daysOverdue: live.daysOverdue,
    retrievabilityNow: live.retrievabilityNow,
    forgettingRisk: live.forgettingRisk,
    predictionConfidence: live.predictionConfidence,
    policyVersion: state.policyVersion,
  };
}

/**
 * Single-concept read -- for ConceptView/DecisionContext, which are
 * inherently one-concept-per-call already (not a batch surface), so
 * this is not the N+1 pattern Section 18 warns about; that concern
 * applies to SubjectView/Overview, which MUST use the batch reader
 * below instead. Returns null (never a fabricated zero/fallback) when
 * no concept_memory_state row exists yet -- callers must render this
 * as "memory unavailable," never as retention=0 or forgettingRisk=0.
 */
export async function getTwinMemorySignal(
  client: DbExecutor,
  studentId: string,
  conceptId: string,
  now: Date = new Date(),
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): Promise<TwinMemorySignal | null> {
  const state = await queryConceptMemoryStateForOne(client, studentId, conceptId);
  if (state === null) return null;
  return toTwinMemorySignal(state, now.toISOString(), policy);
}

/**
 * Batch read for SubjectView/Overview -- ONE query for every concept
 * this student has canonical memory state for, never one query per
 * concept (same discipline as getPhase4MemorySignalsForStudent). A
 * concept absent from the returned Map has no memory state yet;
 * aggregate callers must exclude it from any average rather than
 * treating it as a zero (Section 5/28's denominator semantics).
 */
export async function getTwinMemorySignalsForStudent(
  client: DbExecutor,
  studentId: string,
  now: Date = new Date(),
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): Promise<Map<string, TwinMemorySignal>> {
  const states = await queryConceptMemoryStatesForStudent(client, studentId);
  const nowIso = now.toISOString();
  const signals = new Map<string, TwinMemorySignal>();
  for (const [conceptId, state] of states) {
    signals.set(conceptId, toTwinMemorySignal(state, nowIso, policy));
  }
  return signals;
}

// ============================================================
// STEP 6J-B1 -- CANONICAL READ BOUNDARY FOR OTHER LIVE CONSUMERS
// (subject cognitive summary, topic hierarchy, learning debt)
// ============================================================

/**
 * The smallest neutral canonical contract for consumers that are
 * neither Phase 4 (priority/activity selection) nor the Twin's own
 * "full detail" projection -- subject-level cognitive summaries, topic
 * hierarchy display, and Learning Debt's resolution criteria all want
 * exactly this predictive-memory slice, nothing more. Deliberately
 * excludes demonstratedRetentionScore (a DIFFERENT, evidence-based
 * concept these callers must never substitute for their existing
 * predictive "retention"/"forgetting risk" semantics -- see Step 6J-A's
 * audit) and excludes any priority/activity/rank field, so none of
 * these callers can become a second Phase 4 authority even by mistake.
 */
export interface CanonicalMemorySignal {
  readonly retrievabilityNow: number | null;
  readonly forgettingRisk: number | null;
  readonly lastSuccessfulRetentionAt: string | null;
  readonly memoryStatus: MemoryStatus;
  readonly predictionConfidence: PredictionConfidence;
  readonly policyVersion: number;
}

function toCanonicalMemorySignal(state: MemoryState, nowIso: string, policy: MemoryPolicyV1): CanonicalMemorySignal {
  const live = computeLiveMemorySignals(state, nowIso, policy);
  return {
    retrievabilityNow: live.retrievabilityNow,
    forgettingRisk: live.forgettingRisk,
    lastSuccessfulRetentionAt: state.lastSuccessfulRetentionAt,
    memoryStatus: state.memoryStatus,
    predictionConfidence: live.predictionConfidence,
    policyVersion: state.policyVersion,
  };
}

/**
 * Single-concept read (Learning Debt's getLearningDebtCriteriaProgress
 * is inherently one-concept-per-call). Returns null (never a fabricated
 * zero/100 fallback) when no concept_memory_state row exists yet.
 */
export async function getCanonicalMemorySignal(
  client: DbExecutor,
  studentId: string,
  conceptId: string,
  now: Date = new Date(),
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): Promise<CanonicalMemorySignal | null> {
  const state = await queryConceptMemoryStateForOne(client, studentId, conceptId);
  if (state === null) return null;
  return toCanonicalMemorySignal(state, now.toISOString(), policy);
}

/**
 * Batch read for topic hierarchy (many concepts across a subject) and
 * Learning Debt's getActiveDebts resolution re-check (many debt rows
 * for a student) -- ONE query, never one per concept/row (same
 * discipline as every other batch reader in this file).
 */
export async function getCanonicalMemorySignalsForStudent(
  client: DbExecutor,
  studentId: string,
  now: Date = new Date(),
  policy: MemoryPolicyV1 = MEMORY_POLICY_V1
): Promise<Map<string, CanonicalMemorySignal>> {
  const states = await queryConceptMemoryStatesForStudent(client, studentId);
  const nowIso = now.toISOString();
  const signals = new Map<string, CanonicalMemorySignal>();
  for (const [conceptId, state] of states) {
    signals.set(conceptId, toCanonicalMemorySignal(state, nowIso, policy));
  }
  return signals;
}
