/**
 * Track B / B1 + B10 -- attempt RESULTS (exam truth).
 *
 * `scoreAndRecordAttemptResult` builds the scoring input from the database's
 * own committed responses (the UNIQUE (attempt, target_index) rows are the
 * authority -- never client data, never the navigation state alone), runs the
 * deterministic engine with the scoring policy FROZEN on the attempt, and
 * persists exactly one `exam_attempt_results` row per attempt (UNIQUE): a
 * retried submission returns the existing result and never re-scores.
 *
 * A result NEVER writes cognition. Learning evidence was written per response
 * (and only for valid responses to server-delivered items) through
 * `updateMastery`; the score itself is never evidence.
 */
import { db, type DbExecutor } from '@/lib/db';
import { deriveSections } from '@/lib/simulation/plan.service';
import type { SimulationPlan, SimulationPlanSection } from '@/lib/simulation/types';
import { parseScoringPolicy, type ScoringPolicy } from './scoring/scoring-policy';
import { scoreResponseSet, type ScoringCriterionAward, type ScoringItem, type ScoringOutcome } from './scoring/scoring-engine';
import { examItemMarks, type ExamItem } from './items';
import type { ExamNavState } from './navigation-state';

export type ExamLifecycleStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'PAUSED' | 'SUBMITTED' | 'SCORED' | 'INVALIDATED' | 'ABANDONED';

/** The canonical exam attempt lifecycle, derived from the stored facts (one truth, no duplicated status column). */
export function deriveExamLifecycle(params: { simulationStatus: string | null; examAttemptStatus: string | null; resultStatus: string | null }): ExamLifecycleStatus {
  if (!params.simulationStatus && !params.examAttemptStatus) return 'NOT_STARTED';
  if (params.resultStatus === 'INVALIDATED') return 'INVALIDATED';
  if (params.resultStatus === 'SCORED') return 'SCORED';
  if (params.simulationStatus === 'ABANDONED' || params.examAttemptStatus === 'ABANDONED') return 'ABANDONED';
  if (params.simulationStatus === 'COMPLETED' || params.examAttemptStatus === 'COMPLETED') return 'SUBMITTED';
  if (params.simulationStatus === 'PAUSED') return 'PAUSED';
  return 'IN_PROGRESS';
}

export interface StoredAttemptResult {
  id: string;
  examAttemptId: string;
  studentId: string;
  examVersionId: string;
  scoringModelId: string | null;
  scoringEngineVersion: string;
  scoringPolicyHash: string | null;
  status: 'SCORED' | 'INVALIDATED';
  scoringStatus: 'SCORED' | 'NO_SCORING_POLICY';
  rawScore: number;
  maxScore: number;
  finalScore: number | null;
  finalLabel: string | null;
  sectionResults: ScoringOutcome['sections'];
  objectiveResults: ScoringOutcome['objectives'];
  provenance: Record<string, any>;
  responseSetHash: string;
  scoredAt: string;
  invalidatedAt: string | null;
  invalidationReason: string | null;
  /** Exam V2: STRICT_READINESS -- a separate, stricter internal metric. Never an official score. */
  strictReadiness: StrictReadiness | null;
  reviewRequiredCount: number;
}

export interface StrictReadiness {
  v: 1;
  earned: number;
  available: number;
  percent: number | null;
  sections: Array<{ componentId: string; earned: number; available: number }>;
  /** Responses scored by an older grader without a strict score count as their official score (and are listed). */
  legacyResponses: number;
}

/**
 * Pure: strict readiness over committed responses. Only fully correct work
 * counts on deterministic targets; rubric work takes the lower assessor.
 * `available` is the same denominator as the official raw score.
 */
export function computeStrictReadiness(responses: Array<{ assessment_component_id: string; score: unknown; max_score: unknown; strict_score?: unknown }>, available: number): StrictReadiness {
  const bySection = new Map<string, { componentId: string; earned: number; available: number }>();
  let earned = 0;
  let legacy = 0;
  for (const r of responses) {
    const strict = r.strict_score === null || r.strict_score === undefined ? null : Number(r.strict_score);
    if (strict === null) legacy += 1;
    const e = strict ?? (Number(r.score) || 0);
    earned += e;
    const sec = bySection.get(r.assessment_component_id) ?? { componentId: r.assessment_component_id, earned: 0, available: 0 };
    sec.earned += e;
    sec.available += Number(r.max_score) || 0;
    bySection.set(r.assessment_component_id, sec);
  }
  return { v: 1, earned, available, percent: available > 0 ? Math.round((earned / available) * 1000) / 10 : null, sections: [...bySection.values()], legacyResponses: legacy };
}

function toResult(r: any): StoredAttemptResult {
  return {
    id: r.id,
    examAttemptId: r.exam_attempt_id,
    studentId: r.student_id,
    examVersionId: r.exam_version_id,
    scoringModelId: r.scoring_model_id,
    scoringEngineVersion: r.scoring_engine_version,
    scoringPolicyHash: r.scoring_policy_hash,
    status: r.status,
    scoringStatus: r.scoring_status,
    rawScore: Number(r.raw_score),
    maxScore: Number(r.max_score),
    finalScore: r.final_score === null || r.final_score === undefined ? null : Number(r.final_score),
    finalLabel: r.final_label,
    sectionResults: r.section_results,
    objectiveResults: r.objective_results,
    provenance: r.provenance,
    responseSetHash: r.response_set_hash,
    scoredAt: r.scored_at instanceof Date ? r.scored_at.toISOString() : r.scored_at,
    invalidatedAt: r.invalidated_at instanceof Date ? r.invalidated_at.toISOString() : r.invalidated_at,
    invalidationReason: r.invalidation_reason,
    strictReadiness: r.strict_readiness ?? null,
    reviewRequiredCount: r.review_required_count === null || r.review_required_count === undefined ? 0 : Number(r.review_required_count),
  };
}

export async function getAttemptResult(examAttemptId: string, client: DbExecutor = db): Promise<StoredAttemptResult | null> {
  const r = await client.query(`SELECT * FROM exam_attempt_results WHERE exam_attempt_id = $1`, [examAttemptId]);
  return r.rows.length === 0 ? null : toResult(r.rows[0]);
}

function criteriaFromResponse(row: any): ScoringCriterionAward[] | undefined {
  const parts = row.criteria_breakdown?.parts as Record<string, { awarded: number; max: number; criterion: string }> | undefined;
  if (!parts) return undefined;
  const acc = new Map<string, ScoringCriterionAward>();
  for (const p of Object.values(parts)) {
    const c = acc.get(p.criterion) ?? { criterionId: p.criterion, awarded: 0, max: 0 };
    c.awarded += Number(p.awarded) || 0;
    c.max += Number(p.max) || 0;
    acc.set(p.criterion, c);
  }
  return [...acc.values()];
}

function zeroCriteria(item: ExamItem | undefined): ScoringCriterionAward[] | undefined {
  if (!item?.exam?.parts) return undefined;
  const acc = new Map<string, ScoringCriterionAward>();
  for (const p of item.exam.parts) {
    const c = acc.get(p.criterion) ?? { criterionId: p.criterion, awarded: 0, max: 0 };
    c.max += p.marks;
    acc.set(p.criterion, c);
  }
  return [...acc.values()];
}

/**
 * Pure: the engine input for one attempt, from its plan, its (upgraded)
 * navigation state and its committed response rows. Responses win over the
 * navigation state (a committed response is always counted). Pre-Track-B
 * responses (no target_index) are appended as answered items.
 */
export function buildScoringItems(plan: Pick<SimulationPlan, 'selectedTargets'>, nav: Pick<ExamNavState, 'items'> | null, responses: any[], objectiveByTarget: Map<number, string | null>): ScoringItem[] {
  const byTarget = new Map<number, any>();
  const legacy: any[] = [];
  for (const row of responses) {
    // An attempt that never had a Track B navigation state is scored exactly as before: its committed responses only.
    if (nav === null || row.target_index === null || row.target_index === undefined) legacy.push(row);
    else byTarget.set(Number(row.target_index), row);
  }
  const positional = nav === null ? [] : plan.selectedTargets;
  const items: ScoringItem[] = positional.map((t, i) => {
    const row = byTarget.get(i);
    const state = nav?.items?.[String(i)];
    const questionType = (row?.item_snapshot?.type as string | undefined) ?? state?.item?.type ?? t.questionType ?? null;
    const learningObjectiveId = row?.learning_objective_id ?? state?.ctx?.learningObjectiveId ?? objectiveByTarget.get(i) ?? null;
    if (row) {
      const max = Number(row.max_score) || 0;
      return {
        targetIndex: i,
        componentId: row.assessment_component_id,
        learningObjectiveId,
        questionType,
        status: row.criteria_breakdown?.invalidResponse ? 'INVALID' : 'ANSWERED',
        fraction: max > 0 ? Number(row.score) / max : 0,
        maxMarks: max > 0 ? max : null,
        criteria: criteriaFromResponse(row),
      };
    }
    if (state?.status === 'EXCLUDED' || state?.status === 'UNAVAILABLE') {
      return { targetIndex: i, componentId: t.assessmentComponentId, learningObjectiveId, questionType, status: 'EXCLUDED', fraction: null, maxMarks: null };
    }
    return {
      targetIndex: i,
      componentId: t.assessmentComponentId,
      learningObjectiveId,
      questionType,
      status: 'MISSING',
      fraction: null,
      maxMarks: state?.item ? examItemMarks(state.item) : null,
      criteria: zeroCriteria(state?.item),
    };
  });
  legacy
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .forEach((row, n) => {
      const max = Number(row.max_score) || 0;
      items.push({
        targetIndex: positional.length + n,
        componentId: row.assessment_component_id,
        learningObjectiveId: row.learning_objective_id ?? null,
        questionType: row.item_snapshot?.type ?? null,
        status: 'ANSWERED',
        fraction: max > 0 ? Number(row.score) / max : 0,
        maxMarks: max > 0 ? max : null,
      });
    });
  return items;
}

export class AttemptNotSubmittedError extends Error {
  constructor(status: string) {
    super(`exam attempt is ${status}; only a submitted (COMPLETED) attempt can be scored`);
    this.name = 'AttemptNotSubmittedError';
  }
}

/**
 * Scores a SUBMITTED attempt and records its result exactly once. Safe to call
 * repeatedly (and concurrently): the UNIQUE exam_attempt_id makes the second
 * insert a no-op and the existing row is returned unchanged.
 */
export async function scoreAndRecordAttemptResult(simulationAttemptId: string): Promise<StoredAttemptResult> {
  const sa = await db.query(
    `SELECT sa.*, ea.status AS exam_status, ea.frozen_configuration, ea.scoring_model_id AS ea_scoring_model_id, sp.plan
       FROM simulation_attempts sa
       JOIN exam_attempts ea ON ea.id = sa.exam_attempt_id
       JOIN simulation_plans sp ON sp.id = sa.simulation_plan_id
      WHERE sa.id = $1`,
    [simulationAttemptId]
  );
  const row = sa.rows[0];
  if (!row) throw new Error(`simulation attempt ${simulationAttemptId} not found`);
  if (row.exam_status !== 'COMPLETED') throw new AttemptNotSubmittedError(row.exam_status);

  const existing = await getAttemptResult(row.exam_attempt_id);
  if (existing) return existing;

  const frozen = row.frozen_configuration ?? {};
  const plan = row.plan ?? {};
  const components: any[] = Array.isArray(frozen.components) ? frozen.components : [];
  const sections: SimulationPlanSection[] = Array.isArray(plan.sections) && plan.sections.length > 0 ? plan.sections : deriveSections(plan.selectedTargets ?? [], components, row.timing_mode);

  // Policy: frozen with the attempt (Track B). Attempts started before Track B
  // carry no frozen policy -> the live row is used and the provenance says so.
  let policySource: 'FROZEN' | 'LIVE_ROW_LEGACY' | 'NONE' = 'NONE';
  let scoringModel: { id: string; name: string; scoringType: string; config: unknown } | null = null;
  if (frozen.scoringModel) {
    scoringModel = frozen.scoringModel;
    policySource = 'FROZEN';
  } else if (row.ea_scoring_model_id) {
    const live = await db.query(`SELECT id, name, scoring_type, config FROM scoring_models WHERE id = $1`, [row.ea_scoring_model_id]);
    if (live.rows[0]) {
      scoringModel = { id: live.rows[0].id, name: live.rows[0].name, scoringType: live.rows[0].scoring_type, config: live.rows[0].config };
      policySource = 'LIVE_ROW_LEGACY';
    }
  }
  const parsed = parseScoringPolicy(scoringModel?.config ?? null);
  const policy: ScoringPolicy | null = parsed.ok ? parsed.policy : null;

  const responses = (await db.query(`SELECT * FROM exam_attempt_item_responses WHERE exam_attempt_id = $1 ORDER BY created_at ASC, id ASC`, [row.exam_attempt_id])).rows;
  const objectiveByTarget = new Map<number, string | null>();
  const targetsById = new Map<string, any>((Array.isArray(frozen.objectiveTargets) ? frozen.objectiveTargets : []).map((t: any) => [t.id, t]));
  (plan.selectedTargets ?? []).forEach((t: any, i: number) => objectiveByTarget.set(i, targetsById.get(t.blueprintObjectiveTargetId)?.learningObjectiveId ?? null));

  const items = buildScoringItems({ selectedTargets: plan.selectedTargets ?? [] }, (row.navigation_state?.v === 2 ? row.navigation_state : null) as ExamNavState | null, responses, objectiveByTarget);
  const outcome = scoreResponseSet({ policy, sections: sections.map((s) => ({ componentId: s.componentId, key: s.key, name: s.name, order: s.order })), items });

  const sourceCounts: Record<string, number> = {};
  const contentCounts: Record<string, number> = {};
  for (const r of responses) {
    const src = r.item_source ?? 'LEGACY_UNKNOWN';
    sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
    const cs = r.item_snapshot?.exam?.contentStatus ?? 'LEGACY_UNKNOWN';
    contentCounts[cs] = (contentCounts[cs] ?? 0) + 1;
  }

  const provenance = {
    engineVersion: outcome.engineVersion,
    strategy: outcome.strategy,
    policySource,
    policyInvalid: !parsed.ok && parsed.reason === 'INVALID_SCORING_POLICY' ? parsed.detail ?? true : undefined,
    scoringModel: scoringModel ? { id: scoringModel.id, name: scoringModel.name, scoringType: scoringModel.scoringType } : null,
    policy,
    transformations: outcome.transformations,
    criteria: outcome.criteria,
    counts: outcome.counts,
    final: outcome.final,
    itemSources: sourceCounts,
    contentStatus: contentCounts,
    frozenAt: frozen.frozenAt ?? null,
  };

  await db.query(
    `INSERT INTO exam_attempt_results (
       exam_attempt_id, student_id, exam_version_id, scoring_model_id, scoring_engine_version, scoring_policy_hash,
       status, scoring_status, raw_score, max_score, final_score, final_label, section_results, objective_results, provenance, response_set_hash
     ) VALUES ($1, $2, $3, $4, $5, $6, 'SCORED', $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (exam_attempt_id) DO NOTHING`,
    [
      row.exam_attempt_id,
      row.student_id,
      row.exam_version_id,
      scoringModel?.id ?? null,
      outcome.engineVersion,
      outcome.policyHash,
      outcome.scoringStatus,
      outcome.raw.earned,
      outcome.raw.available,
      outcome.final.value,
      outcome.final.label,
      JSON.stringify(outcome.sections),
      JSON.stringify(outcome.objectives),
      JSON.stringify(provenance),
      outcome.responseSetHash,
    ]
  );
  // Exam V2: strict readiness + responses awaiting review (written once, with the result).
  const strict = computeStrictReadiness(responses, outcome.raw.available);
  const reviewRequired = responses.filter((r: any) => r.review_status === 'REVIEW_REQUIRED').length;
  await db.query(`UPDATE exam_attempt_results SET strict_readiness = $2, review_required_count = $3 WHERE exam_attempt_id = $1 AND strict_readiness IS NULL`, [row.exam_attempt_id, JSON.stringify(strict), reviewRequired]);
  const stored = await getAttemptResult(row.exam_attempt_id);
  if (!stored) throw new Error(`result for exam attempt ${row.exam_attempt_id} was not recorded`);
  return stored;
}

/** Re-runs the engine over the stored inputs and compares hashes -- proves a result is reproducible from its frozen configuration. */
export async function verifyAttemptResultReproducible(simulationAttemptId: string): Promise<{ reproducible: boolean; stored: string; recomputed: string }> {
  const sa = await db.query(`SELECT sa.exam_attempt_id FROM simulation_attempts sa WHERE sa.id = $1`, [simulationAttemptId]);
  const examAttemptId = sa.rows[0]?.exam_attempt_id;
  const stored = examAttemptId ? await getAttemptResult(examAttemptId) : null;
  if (!stored) return { reproducible: false, stored: '', recomputed: '' };
  const row = (await db.query(`SELECT sa.*, ea.frozen_configuration, sp.plan FROM simulation_attempts sa JOIN exam_attempts ea ON ea.id = sa.exam_attempt_id JOIN simulation_plans sp ON sp.id = sa.simulation_plan_id WHERE sa.id = $1`, [simulationAttemptId])).rows[0];
  const frozen = row.frozen_configuration ?? {};
  const plan = row.plan ?? {};
  const responses = (await db.query(`SELECT * FROM exam_attempt_item_responses WHERE exam_attempt_id = $1 ORDER BY created_at ASC, id ASC`, [examAttemptId])).rows;
  const targetsById = new Map<string, any>((frozen.objectiveTargets ?? []).map((t: any) => [t.id, t]));
  const objectiveByTarget = new Map<number, string | null>();
  (plan.selectedTargets ?? []).forEach((t: any, i: number) => objectiveByTarget.set(i, targetsById.get(t.blueprintObjectiveTargetId)?.learningObjectiveId ?? null));
  const items = buildScoringItems({ selectedTargets: plan.selectedTargets ?? [] }, row.navigation_state?.v === 2 ? row.navigation_state : null, responses, objectiveByTarget);
  const policy = stored.provenance?.policy ?? null;
  const sections: SimulationPlanSection[] = plan.sections ?? [];
  const outcome = scoreResponseSet({ policy, sections: sections.map((s) => ({ componentId: s.componentId, key: s.key, name: s.name, order: s.order })), items });
  const recomputed = `${outcome.responseSetHash}:${outcome.policyHash}:${outcome.raw.earned}/${outcome.raw.available}:${outcome.final.value}:${outcome.final.label}`;
  const storedKey = `${stored.responseSetHash}:${stored.scoringPolicyHash}:${stored.rawScore}/${stored.maxScore}:${stored.finalScore}:${stored.finalLabel}`;
  return { reproducible: recomputed === storedKey, stored: storedKey, recomputed };
}

/**
 * Invalidation (StudyUS admin / integrity process only): stamps the result,
 * never deletes or re-scores it. An invalidated result is excluded from
 * readiness simulation history. It never writes or removes cognition.
 */
export async function invalidateAttemptResult(examAttemptId: string, reason: string): Promise<StoredAttemptResult | null> {
  const trimmed = reason.trim().slice(0, 500);
  if (!trimmed) throw new Error('an invalidation reason is required');
  const r = await db.query(
    `UPDATE exam_attempt_results SET status = 'INVALIDATED', invalidated_at = now(), invalidation_reason = $2
      WHERE exam_attempt_id = $1 AND status = 'SCORED' RETURNING *`,
    [examAttemptId, trimmed]
  );
  return r.rows.length === 0 ? null : toResult(r.rows[0]);
}
