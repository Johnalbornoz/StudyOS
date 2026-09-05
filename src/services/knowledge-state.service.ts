/**
 * Knowledge State Projector (Phase 2.2A): a deterministic projection
 * from Learning Evidence (the canonical source of truth) onto a
 * persisted Concept Knowledge State. This module never invents a
 * second source of truth about what a student knows -- it only reads
 * learning_evidence (plus the existing Phase 2 misconception/transfer
 * services) and derives five KPI dimensions, a Mastery State, and a
 * Validation Readiness from them.
 *
 * See docs/architecture/phase-2-2-knowledge-validation.md for the full
 * design and the reasoning behind every threshold and evidence pool
 * below -- this file implements that design, it does not redecide it.
 */

import { db, type DbExecutor } from '@/lib/db';
import type { EvidenceResult, EvidenceSourceType } from '@/lib/algorithms/mastery';
import { getTransferScore } from './transfer.service';
import { getMisconceptionCountsForConcept } from './misconception.service';
import { evaluateValidationLifecycle } from './validation-cycle.service';
import { getPhase2MemoryInput } from './memory-read.service';
import { track } from '@/lib/analytics';
import { recordDecisionEvent } from '@/lib/audit';

export type MasteryState =
  | 'UNKNOWN'
  | 'LEARNING'
  | 'DEVELOPING'
  | 'PROVISIONAL_MASTERY'
  | 'VALIDATED_MASTERY'
  | 'AT_RISK'
  | 'INTERVENTION_REQUIRED';

export type ValidationReadiness =
  | 'READY'
  | 'INSUFFICIENT_EVIDENCE'
  | 'WAITING_FOR_RETENTION'
  | 'TRANSFER_REQUIRED'
  | 'ACTIVE_CRITICAL_MISCONCEPTION';

export interface MasteryPolicy {
  version: number;
  minimumUnderstanding: number;
  minimumIndependence: number;
  minimumApplication: number;
  minimumRetention: number;
  minimumTransfer: number;
  requiresTransfer: boolean;
  maximumCriticalMisconceptions: number;
  minimumEvidenceCount: number;
  minimumIndependentEvidenceCount: number;
  validationWindowDays: number;
}

/**
 * The highest-version row in mastery_policies -- there is always
 * exactly one active policy at a time.
 *
 * Step 6J-B2: the `retention_min_gap_days` DB column still exists
 * (deprecated schema, not dropped) but is deliberately no longer
 * selected/exposed here -- its only former runtime reader was
 * classifyRetention(), now deleted; Retention qualification belongs
 * exclusively to MemoryPolicy v1 (Step 6G Section 10).
 */
export async function getActiveMasteryPolicy(client: DbExecutor = db): Promise<MasteryPolicy> {
  const result = await client.query(
    `SELECT version, minimum_understanding, minimum_independence, minimum_application, minimum_retention,
            minimum_transfer, requires_transfer, maximum_critical_misconceptions, minimum_evidence_count,
            minimum_independent_evidence_count, validation_window_days
     FROM mastery_policies ORDER BY version DESC LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) throw new Error('NO_MASTERY_POLICY');
  return {
    version: row.version,
    minimumUnderstanding: Number(row.minimum_understanding),
    minimumIndependence: Number(row.minimum_independence),
    minimumApplication: Number(row.minimum_application),
    minimumRetention: Number(row.minimum_retention),
    minimumTransfer: Number(row.minimum_transfer),
    requiresTransfer: row.requires_transfer,
    maximumCriticalMisconceptions: row.maximum_critical_misconceptions,
    minimumEvidenceCount: row.minimum_evidence_count,
    minimumIndependentEvidenceCount: row.minimum_independent_evidence_count,
    validationWindowDays: row.validation_window_days,
  };
}

export interface EvidenceRow {
  sourceType: EvidenceSourceType | string;
  result: EvidenceResult;
  scorePercent: number | null;
  aiAssistanceType: string;
  timestamp: string | Date;
}

function scoreOf(row: Pick<EvidenceRow, 'result' | 'scorePercent'>): number {
  if (row.scorePercent !== null && row.scorePercent !== undefined) return row.scorePercent;
  return row.result === 'correct' ? 100 : row.result === 'partial' ? 50 : 0;
}

function average(rows: EvidenceRow[], limit = 10): number | null {
  if (rows.length === 0) return null;
  const recent = rows.slice(0, limit);
  return Math.round(recent.reduce((sum, r) => sum + scoreOf(r), 0) / recent.length);
}

const UNDERSTANDING_FALLBACK_SOURCES = new Set([
  'PRACTICE_QUIZ',
  'PRACTICE_QUESTION',
  'CUMULATIVE_ASSESSMENT',
  'EXAM_SIMULATION',
  'GUIDED_EXERCISE',
  'TOPIC_ASSESSMENT',
  'REAL_SCHOOL_EXAM',
]);
const APPLICATION_SOURCES = new Set(['CUMULATIVE_ASSESSMENT', 'EXAM_SIMULATION', 'TOPIC_ASSESSMENT']);

/**
 * Understanding: EXPLANATION evidence (rubric-graded reasoning) if any
 * exists -- the strongest available "really understood it" signal.
 * Otherwise falls back to general quiz evidence, explicitly excluding
 * DIAGNOSTIC (deliberately adversarial, not a fair sample) and
 * TRANSFER/REMEDIATION (separate dimensions/not-yet-proven practice).
 * Assumes rows are already sorted most-recent-first.
 */
export function classifyUnderstanding(rows: EvidenceRow[]): number | null {
  const explanationRows = rows.filter((r) => r.sourceType === 'EXPLANATION');
  if (explanationRows.length > 0) return average(explanationRows);
  const fallback = rows.filter((r) => UNDERSTANDING_FALLBACK_SOURCES.has(r.sourceType as string));
  return average(fallback);
}

/**
 * Independence: direct reuse of the existing Phase 1 semantics
 * (getIndependentMastery in learner-model.service.ts) -- average result
 * over unassisted (ai_assistance_type = 'NONE') evidence only, null
 * with fewer than 2 samples. Exposed here as a pure function over
 * already-filtered rows so it's independently testable; the
 * orchestration below still queries ai_assistance_type = 'NONE'
 * directly rather than importing the Phase 1 function, to avoid a
 * second DB round trip for the same rows already loaded.
 */
export function classifyIndependence(unassistedRows: EvidenceRow[]): number | null {
  if (unassistedRows.length < 2) return null;
  return average(unassistedRows);
}

/**
 * Application: evidence from quiz modes whose own design intent is
 * testing connections/application across ideas (cumulative_assessment,
 * exam_simulation, topic_assessment), never single-concept practice
 * drilling. A known proxy, not a purpose-built per-question tag -- see
 * the design doc's documented limitation.
 */
export function classifyApplication(rows: EvidenceRow[]): number | null {
  return average(rows.filter((r) => APPLICATION_SOURCES.has(r.sourceType as string)));
}

export interface EvidenceSufficiency {
  evidenceCount: number;
  independentEvidenceCount: number;
  passed: boolean;
}

export function evaluateEvidenceSufficiency(rows: EvidenceRow[], policy: MasteryPolicy): EvidenceSufficiency {
  const evidenceCount = rows.length;
  const independentEvidenceCount = rows.filter((r) => r.aiAssistanceType === 'NONE').length;
  return {
    evidenceCount,
    independentEvidenceCount,
    passed: evidenceCount >= policy.minimumEvidenceCount && independentEvidenceCount >= policy.minimumIndependentEvidenceCount,
  };
}

export interface DimensionScores {
  understanding: number | null;
  independence: number | null;
  application: number | null;
  /** Step 6G: sourced verbatim from Phase 6's concept_memory_state.demonstrated_retention_score in the canonical live path -- see recalculateConceptKnowledgeState. No transformation, no second weighting, no fallback. */
  retention: number | null;
  transfer: number | null;
}

export interface MisconceptionState {
  activeCount: number;
  criticalCount: number;
  recurringCount: number;
}

/** Priority order matters: a critical misconception blocks validation before anything else is even checked. */
export function determineValidationReadiness(
  scores: DimensionScores,
  misconceptions: MisconceptionState,
  sufficiency: EvidenceSufficiency,
  policy: MasteryPolicy
): ValidationReadiness {
  if (misconceptions.criticalCount > policy.maximumCriticalMisconceptions) return 'ACTIVE_CRITICAL_MISCONCEPTION';
  if (!sufficiency.passed) return 'INSUFFICIENT_EVIDENCE';
  if (policy.requiresTransfer && scores.transfer === null) return 'TRANSFER_REQUIRED';
  if (scores.retention === null) return 'WAITING_FOR_RETENTION';
  return 'READY';
}

function passes(score: number | null, threshold: number): boolean {
  return score !== null && score >= threshold;
}

/**
 * The core Mastery State determination. Deliberately NOT a compensating
 * average: each required dimension is checked independently against
 * its own policy threshold. A high Understanding can never substitute
 * for a failing Application -- see the design doc §10 and the
 * corresponding unit test ("no compensating average").
 *
 * 2.2A never produces AT_RISK/INTERVENTION_REQUIRED -- those require
 * the time-based decay/persistence signals that are Phase 2.2B's job.
 */
export function determineMasteryState(
  scores: DimensionScores,
  misconceptions: MisconceptionState,
  sufficiency: EvidenceSufficiency,
  policy: MasteryPolicy
): Exclude<MasteryState, 'AT_RISK' | 'INTERVENTION_REQUIRED'> {
  if (sufficiency.evidenceCount === 0) return 'UNKNOWN';

  const understandingOk = passes(scores.understanding, policy.minimumUnderstanding);
  const independenceOk = passes(scores.independence, policy.minimumIndependence);
  const applicationOk = passes(scores.application, policy.minimumApplication);
  const retentionOk = passes(scores.retention, policy.minimumRetention);
  const transferOk = !policy.requiresTransfer || passes(scores.transfer, policy.minimumTransfer);
  const criticalOk = misconceptions.criticalCount <= policy.maximumCriticalMisconceptions;

  if (understandingOk && independenceOk && applicationOk && retentionOk && transferOk && criticalOk && sufficiency.passed) {
    return 'VALIDATED_MASTERY';
  }
  if (understandingOk && independenceOk) return 'PROVISIONAL_MASTERY';
  if (understandingOk) return 'DEVELOPING';
  return 'LEARNING';
}

export interface StateReason {
  policyVersion: number;
  dimensions: Record<
    'understanding' | 'independence' | 'application' | 'retention' | 'transfer',
    { score: number | null; threshold: number; passed: boolean; required?: boolean }
  >;
  criticalMisconceptions: number;
  evidenceSufficiency: EvidenceSufficiency & { requiredEvidenceCount: number; requiredIndependentEvidenceCount: number };
  resultingState: MasteryState;
  validationReadiness: ValidationReadiness;
}

export function buildStateReason(
  scores: DimensionScores,
  misconceptions: MisconceptionState,
  sufficiency: EvidenceSufficiency,
  policy: MasteryPolicy,
  resultingState: MasteryState,
  validationReadiness: ValidationReadiness
): StateReason {
  return {
    policyVersion: policy.version,
    dimensions: {
      understanding: { score: scores.understanding, threshold: policy.minimumUnderstanding, passed: passes(scores.understanding, policy.minimumUnderstanding) },
      independence: { score: scores.independence, threshold: policy.minimumIndependence, passed: passes(scores.independence, policy.minimumIndependence) },
      application: { score: scores.application, threshold: policy.minimumApplication, passed: passes(scores.application, policy.minimumApplication) },
      retention: { score: scores.retention, threshold: policy.minimumRetention, passed: passes(scores.retention, policy.minimumRetention) },
      transfer: { score: scores.transfer, threshold: policy.minimumTransfer, passed: passes(scores.transfer, policy.minimumTransfer) || !policy.requiresTransfer, required: policy.requiresTransfer },
    },
    criticalMisconceptions: misconceptions.criticalCount,
    evidenceSufficiency: { ...sufficiency, requiredEvidenceCount: policy.minimumEvidenceCount, requiredIndependentEvidenceCount: policy.minimumIndependentEvidenceCount },
    resultingState,
    validationReadiness,
  };
}

export interface ConceptKnowledgeState {
  studentId: string;
  conceptId: string;
  subjectId: string;
  masteryState: MasteryState;
  understandingScore: number | null;
  independenceScore: number | null;
  applicationScore: number | null;
  /**
   * Step 6G: after this integration, this column is a MATERIALIZED
   * MIRROR of the canonical Phase 6 demonstratedRetentionScore for any
   * concept recalculated through the live path -- it is NOT an
   * independent source of truth. It remains physically present (and
   * historical rows recalculated before this step may still carry a
   * legacy classifyRetention()-derived value until their next live
   * recalculation) purely for backward compatibility; do not read it
   * as authoritative without confirming when it was last projected.
   */
  retentionScore: number | null;
  transferScore: number | null;
  activeMisconceptionCount: number;
  criticalMisconceptionCount: number;
  recurringMisconceptionCount: number;
  evidenceCount: number;
  independentEvidenceCount: number;
  firstEvidenceAt: string | null;
  lastEvidenceAt: string | null;
  validationReadiness: ValidationReadiness;
  stateReason: StateReason | null;
  projectionVersion: number;
  masteryPolicyVersion: number;
  updatedAt: string;
}

function rowToState(row: any): ConceptKnowledgeState {
  return {
    studentId: row.student_id,
    conceptId: row.concept_id,
    subjectId: row.subject_id,
    masteryState: row.mastery_state,
    understandingScore: row.understanding_score !== null ? Number(row.understanding_score) : null,
    independenceScore: row.independence_score !== null ? Number(row.independence_score) : null,
    applicationScore: row.application_score !== null ? Number(row.application_score) : null,
    retentionScore: row.retention_score !== null ? Number(row.retention_score) : null,
    transferScore: row.transfer_score !== null ? Number(row.transfer_score) : null,
    activeMisconceptionCount: row.active_misconception_count,
    criticalMisconceptionCount: row.critical_misconception_count,
    recurringMisconceptionCount: row.recurring_misconception_count,
    evidenceCount: row.evidence_count,
    independentEvidenceCount: row.independent_evidence_count,
    firstEvidenceAt: row.first_evidence_at,
    lastEvidenceAt: row.last_evidence_at,
    validationReadiness: row.validation_readiness,
    stateReason: row.state_reason,
    projectionVersion: row.projection_version,
    masteryPolicyVersion: row.mastery_policy_version,
    updatedAt: row.updated_at,
  };
}

/**
 * The Knowledge Projector: loads learning_evidence + misconceptions +
 * Transfer for one (student, concept), computes all five dimensions,
 * determines Mastery State and Validation Readiness, and persists the
 * result. Deterministic and idempotent -- running this twice against
 * the same underlying evidence produces the same stored row every
 * time (verified directly in tests/unit/knowledge-state.test.ts).
 */
/**
 * Phase 2B: `client` is optional and additive -- every pre-existing
 * caller (dashboards, other engines, this file's own tests) keeps
 * calling this with no client and gets exactly the previous behavior,
 * running against the pool. The ONE new caller that matters is
 * mastery.service.ts's atomic evidence-application transaction: when
 * `client` is that transaction's own checked-out connection, this
 * entire projection (including the Phase 2.2B validation-cycle
 * overlay it calls into, and the KNOWLEDGE_STATE_PROJECTED decision
 * event it records) becomes part of the SAME atomic operation as the
 * evidence/mastery writes that triggered it -- so "the operation is
 * applied" and "Knowledge State is internally consistent with it" can
 * never come apart, even under a mid-operation failure (Phase 2B's
 * corrected design; see the Phase 2B report's Transaction Semantics
 * section). No algorithm, threshold, or query result changes -- this
 * is purely which connection runs the same SQL.
 */
export async function recalculateConceptKnowledgeState(
  studentId: string,
  conceptId: string,
  client: DbExecutor = db
): Promise<ConceptKnowledgeState | null> {
  const conceptRow = await client.query(`SELECT subject_id FROM concepts WHERE id = $1`, [conceptId]);
  const subjectId = conceptRow.rows[0]?.subject_id;
  if (!subjectId) return null;

  const evidenceRows = await client.query(
    `SELECT source_type, result, score_percent, ai_assistance_type, timestamp
     FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC`,
    [studentId, conceptId]
  );
  const rows: EvidenceRow[] = evidenceRows.rows.map((r) => ({
    sourceType: r.source_type,
    result: r.result,
    scorePercent: r.score_percent !== null ? Number(r.score_percent) : null,
    aiAssistanceType: r.ai_assistance_type,
    timestamp: r.timestamp,
  }));

  const policy = await getActiveMasteryPolicy(client);
  const [transferScore, misconceptionCounts] = await Promise.all([
    getTransferScore(studentId, conceptId, client),
    getMisconceptionCountsForConcept(studentId, conceptId, client),
  ]);

  // Step 6G: Phase 6 is the sole Retention-dimension authority in this
  // canonical live path. The projector (mastery.service.ts::
  // updateMastery) always runs immediately before this function, in the
  // same transaction, so concept_memory_state already reflects this
  // transaction's own (possibly still-uncommitted) evidence. A missing
  // row here is an invariant violation, not a case to fall back to
  // classifyRetention()/legacy retention_score/getRetention() -- letting
  // getPhase2MemoryInput throw rolls back the whole transaction instead
  // of committing two inconsistent truths. policy.retentionMinGapDays is
  // deliberately NOT read here anymore -- qualification belongs
  // exclusively to MemoryPolicy v1 (Step 6G Section 10).
  const memoryInput = await getPhase2MemoryInput(client, studentId, conceptId);

  const unassistedRows = rows.filter((r) => r.aiAssistanceType === 'NONE');
  const scores: DimensionScores = {
    understanding: classifyUnderstanding(rows),
    independence: classifyIndependence(unassistedRows),
    application: classifyApplication(rows),
    // Direct passthrough -- no transformation, no second weighting, no
    // averaging, no fallback (Step 6G Section 6). null stays null.
    retention: memoryInput.demonstratedRetentionScore,
    transfer: transferScore,
  };

  const misconceptions: MisconceptionState = {
    activeCount: misconceptionCounts.activeCount,
    criticalCount: misconceptionCounts.criticalCount,
    recurringCount: misconceptionCounts.recurringCount,
  };
  const sufficiency = evaluateEvidenceSufficiency(rows, policy);
  const validationReadiness = determineValidationReadiness(scores, misconceptions, sufficiency, policy);
  const baseMasteryState = determineMasteryState(scores, misconceptions, sufficiency, policy);

  const sortedAsc = [...rows].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const firstEvidenceAt = sortedAsc[0]?.timestamp ?? null;
  const lastEvidenceAt = rows[0]?.timestamp ?? null;

  const previousStateResult = await client.query(
    `SELECT mastery_state FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = $2`,
    [studentId, conceptId]
  );
  const previousState: MasteryState | null = previousStateResult.rows[0]?.mastery_state ?? null;

  // Phase 2.2B: overlays the time dimension on top of 2.2A's pure
  // dimension-based state -- opens/closes Validation Cycles, detects
  // decay from a previously-validated concept, and is the only source
  // of AT_RISK/INTERVENTION_REQUIRED. Same transactional client -- a
  // Validation Cycle opened/closed here commits (or rolls back) with
  // everything else in this projection.
  const masteryState = await evaluateValidationLifecycle(
    {
      studentId,
      conceptId,
      subjectId,
      previousState,
      baseState: baseMasteryState,
      scores,
      misconceptions,
      policy,
      knowledgeStateSnapshot: { scores, evidenceCount: sufficiency.evidenceCount },
    },
    client
  );

  const stateReason = buildStateReason(scores, misconceptions, sufficiency, policy, masteryState, validationReadiness);

  const upserted = await client.query(
    `INSERT INTO concept_knowledge_state (
       student_id, concept_id, subject_id, mastery_state,
       understanding_score, independence_score, application_score, retention_score, transfer_score,
       active_misconception_count, critical_misconception_count, recurring_misconception_count,
       evidence_count, independent_evidence_count,
       first_evidence_at, last_evidence_at,
       validation_readiness, state_reason, projection_version, mastery_policy_version, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,1,$19,NOW())
     ON CONFLICT (student_id, concept_id) DO UPDATE SET
       subject_id = EXCLUDED.subject_id,
       mastery_state = EXCLUDED.mastery_state,
       understanding_score = EXCLUDED.understanding_score,
       independence_score = EXCLUDED.independence_score,
       application_score = EXCLUDED.application_score,
       retention_score = EXCLUDED.retention_score,
       transfer_score = EXCLUDED.transfer_score,
       active_misconception_count = EXCLUDED.active_misconception_count,
       critical_misconception_count = EXCLUDED.critical_misconception_count,
       recurring_misconception_count = EXCLUDED.recurring_misconception_count,
       evidence_count = EXCLUDED.evidence_count,
       independent_evidence_count = EXCLUDED.independent_evidence_count,
       first_evidence_at = EXCLUDED.first_evidence_at,
       last_evidence_at = EXCLUDED.last_evidence_at,
       validation_readiness = EXCLUDED.validation_readiness,
       state_reason = EXCLUDED.state_reason,
       mastery_policy_version = EXCLUDED.mastery_policy_version,
       updated_at = NOW()
     RETURNING *`,
    [
      studentId,
      conceptId,
      subjectId,
      masteryState,
      scores.understanding,
      scores.independence,
      scores.application,
      scores.retention,
      scores.transfer,
      misconceptions.activeCount,
      misconceptions.criticalCount,
      misconceptions.recurringCount,
      sufficiency.evidenceCount,
      sufficiency.independentEvidenceCount,
      firstEvidenceAt,
      lastEvidenceAt,
      validationReadiness,
      JSON.stringify(stateReason),
      policy.version,
    ]
  );

  if (previousState !== masteryState) {
    track(studentId, 'knowledge_state_updated', { conceptId, previousState, newState: masteryState, policyVersion: policy.version });
  }

  // Phase 0E2 Step 16: cross-engine auditability for this projection.
  // Runs on every successful projection (paired 1:1 with the
  // MASTERY_UPDATED event that triggered it, since updateMastery calls
  // this synchronously) -- not gated on a state change, since "we
  // recomputed and it stayed the same" is itself part of the auditable
  // record, not noise. concept_knowledge_state remains the domain
  // source of truth; this is its cross-engine-queryable twin.
  await recordDecisionEvent(
    {
      decisionType: 'KNOWLEDGE_STATE_PROJECTED',
      engine: 'knowledge-state-projector',
      engineVersion: String(policy.version),
      studentId,
      subjectId,
      conceptId,
      sourceEventType: 'concept_knowledge_state',
      sourceEventId: upserted.rows[0]?.id ?? null,
      previousState: previousState ? { masteryState: previousState } : null,
      newState: {
        masteryState,
        understanding: scores.understanding,
        independence: scores.independence,
        application: scores.application,
        retention: scores.retention,
        transfer: scores.transfer,
        validationReadiness,
      },
      reasonCode: previousState !== masteryState ? 'STATE_TRANSITION' : 'STATE_UNCHANGED',
      reasonDetails: stateReason as unknown as Record<string, unknown>,
    },
    client
  );

  return rowToState(upserted.rows[0]);
}

export async function getConceptKnowledgeState(studentId: string, conceptId: string): Promise<ConceptKnowledgeState | null> {
  const result = await db.query(`SELECT * FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = $2`, [studentId, conceptId]);
  return result.rows[0] ? rowToState(result.rows[0]) : null;
}

/** Reads persisted rows only -- does not recompute. Aggregation over whatever's already been projected. */
export async function getSubjectKnowledgeState(studentId: string, subjectId: string): Promise<ConceptKnowledgeState[]> {
  const result = await db.query(
    `SELECT * FROM concept_knowledge_state WHERE student_id = $1 AND subject_id = $2 ORDER BY updated_at DESC`,
    [studentId, subjectId]
  );
  return result.rows.map(rowToState);
}
