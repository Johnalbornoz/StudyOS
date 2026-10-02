/**
 * F9 -- Simulation Attempt lifecycle (task §23-26). Wraps F7's real
 * startExamAttempt/completeExamAttempt -- never re-implements the
 * frozen_configuration mechanism. pause/resume/navigation are entirely
 * new F9 facts, carried on the additive simulation_attempts table (see
 * F9_SIMULATION_PLAN_MODEL.md for why this isn't an ALTER TABLE on
 * F7's own exam_attempts).
 */
import { db } from '@/lib/db';
import { startExamAttempt, completeExamAttempt, getExamAttempt } from '@/lib/assessment/exam-attempt.service';
import { buildSimulationPlan } from './plan.service';
import { parseDeliveryPolicy, resolveDeliveryPolicy, isModeAllowed } from '@/lib/exam-core/delivery-policy';
import { initNavState, isInactiveExpired, type ExamNavState, type ExamItemState } from '@/lib/exam-core/navigation-state';
import type { SimulationPlan } from './types';
import type { SimulationAttempt, SimulationType, TimingMode } from './types';

/** Track B: the version's delivery policy (navigation_rules) is present but invalid -- the attempt never starts on a guessed policy. */
export class DeliveryPolicyConfigurationError extends Error {
  constructor(detail: string) {
    super(`DELIVERY_POLICY_INVALID: ${detail}`);
    this.name = 'DeliveryPolicyConfigurationError';
  }
}

/** Track B: the version's delivery policy does not offer this simulation type / timing mode. */
export class SimulationModeNotAllowedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'SimulationModeNotAllowedError';
  }
}

function toAttempt(row: any): SimulationAttempt {
  return {
    id: row.id,
    examAttemptId: row.exam_attempt_id,
    studentId: row.student_id,
    examProfileId: row.exam_profile_id,
    examVersionId: row.exam_version_id,
    simulationType: row.simulation_type,
    simulationPlanId: row.simulation_plan_id,
    readinessSnapshotId: row.readiness_snapshot_id,
    timingMode: row.timing_mode,
    pauseAllowed: row.pause_allowed,
    status: row.status,
    pausedAt: row.paused_at instanceof Date ? row.paused_at.toISOString() : row.paused_at,
    resumedAt: row.resumed_at instanceof Date ? row.resumed_at.toISOString() : row.resumed_at,
    elapsedSecondsAtPause: row.elapsed_seconds_at_pause,
    navigationState: row.navigation_state ?? {},
    language: row.language,
    timezone: row.timezone,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export async function startSimulationAttempt(params: {
  studentId: string;
  examProfileId: string;
  examVersionId: string;
  simulationType: SimulationType;
  timingMode: TimingMode;
  learningObjectiveId?: string;
  academicSubjectId?: string;
  readinessSnapshotId?: string;
  institutionExamPolicyId?: string;
  language: string;
  timezone?: string;
  /** Exam V2: only these components (an exam instance's selected papers). */
  assessmentComponentIds?: string[];
  /** Exam V2: only these objectives (skill-level practice). */
  learningObjectiveIds?: string[];
  /** Exam V2: per-item feedback override (a Mock / Challenge forces NEVER). */
  itemFeedback?: 'NEVER' | 'AFTER_EACH_ITEM';
  /**
   * Exam V2: a FROZEN form. Called with the built plan, returns the server-held
   * items to preset per plan position, so nothing is sourced or generated
   * during the attempt. Positions it leaves out are sourced as usual.
   */
  presetItems?: (plan: SimulationPlan) => Promise<Record<number, ExamItemState>>;
}): Promise<{ examAttempt: Awaited<ReturnType<typeof getExamAttempt>>; simulationAttempt: SimulationAttempt; planId: string }> {
  // Track B: validate the version's delivery policy BEFORE writing anything.
  const versionRow = await db.query(`SELECT navigation_rules FROM exam_versions WHERE id = $1`, [params.examVersionId]);
  const parsedPolicy = parseDeliveryPolicy(versionRow.rows[0]?.navigation_rules ?? null);
  if (!parsedPolicy.ok) throw new DeliveryPolicyConfigurationError(parsedPolicy.detail);
  const modeCheck = isModeAllowed(parsedPolicy.policy, params.simulationType, params.timingMode);
  if (!modeCheck.allowed) throw new SimulationModeNotAllowedError(modeCheck.reason!);
  const deliveryPolicy = resolveDeliveryPolicy(parsedPolicy.policy, params.simulationType, params.timingMode);
  if (params.itemFeedback === 'NEVER' || (params.itemFeedback === 'AFTER_EACH_ITEM' && params.timingMode !== 'OFFICIAL_SIMULATION_TIMED')) deliveryPolicy.itemFeedback = params.itemFeedback;

  const plan = await buildSimulationPlan({
    studentId: params.studentId,
    examVersionId: params.examVersionId,
    simulationType: params.simulationType,
    learningObjectiveId: params.learningObjectiveId,
    academicSubjectId: params.academicSubjectId,
    timingMode: params.timingMode,
    readinessSnapshotId: params.readinessSnapshotId,
    assessmentComponentIds: params.assessmentComponentIds,
    learningObjectiveIds: params.learningObjectiveIds,
  });
  const preset = params.presetItems ? await params.presetItems(plan) : {};

  const examAttempt = await startExamAttempt({
    studentExamProfileId: params.examProfileId,
    examVersionId: params.examVersionId,
    institutionExamPolicyId: params.institutionExamPolicyId,
  });

  // INV-F9-10 restated: official simulation timing never permits pause. Training/Mini Mock may -- never hard-coded uniformly (task §25).
  const pauseAllowed = deliveryPolicy.pauseAllowed;

  // Track B: the resolved delivery policy + section layout are FROZEN on the attempt.
  const navigationRules = (examAttempt?.frozenConfiguration as any)?.examVersion?.navigationRules ?? null;
  const navigationState = initNavState({ policy: deliveryPolicy, sections: plan.sections ?? [], now: new Date().toISOString(), rules: navigationRules });
  for (const [index, state] of Object.entries(preset)) navigationState.items[String(index)] = state;

  const result = await db.query(
    `
    INSERT INTO simulation_attempts (
      exam_attempt_id, student_id, exam_profile_id, exam_version_id, simulation_type, simulation_plan_id,
      readiness_snapshot_id, timing_mode, pause_allowed, language, timezone, navigation_state
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
    `,
    [
      examAttempt!.id,
      params.studentId,
      params.examProfileId,
      params.examVersionId,
      params.simulationType,
      plan.id,
      params.readinessSnapshotId ?? null,
      params.timingMode,
      pauseAllowed,
      params.language,
      params.timezone ?? null,
      JSON.stringify(navigationState),
    ]
  );

  return { examAttempt, simulationAttempt: toAttempt(result.rows[0]), planId: plan.id };
}

export async function getSimulationAttempt(id: string): Promise<SimulationAttempt | null> {
  const result = await db.query(`SELECT * FROM simulation_attempts WHERE id = $1`, [id]);
  return result.rows.length === 0 ? null : toAttempt(result.rows[0]);
}

export async function pauseSimulationAttempt(id: string): Promise<SimulationAttempt> {
  const current = await getSimulationAttempt(id);
  if (!current) throw new Error(`simulation attempt ${id} not found`);
  if (!current.pauseAllowed) throw new Error('PAUSE_NOT_ALLOWED');
  if (current.status !== 'ACTIVE') throw new Error(`simulation attempt ${id} is not ACTIVE`);

  // F7's own ExamAttempt type does not expose started_at, so
  // simulation_attempts.created_at (stamped in the same
  // startSimulationAttempt call) is the real, accurate proxy for "when
  // this attempt's clock began" on a first pause; resumedAt is used for
  // every subsequent pause/resume cycle.
  const startedAtMs = new Date(current.createdAt).getTime();
  const priorElapsed = current.elapsedSecondsAtPause ?? 0;
  const sinceStartOrResume = Math.floor((Date.now() - (current.resumedAt ? new Date(current.resumedAt).getTime() : startedAtMs)) / 1000);

  const result = await db.query(
    `UPDATE simulation_attempts SET status = 'PAUSED', paused_at = now(), elapsed_seconds_at_pause = $2 WHERE id = $1 AND status = 'ACTIVE' RETURNING *`,
    [id, priorElapsed + Math.max(0, sinceStartOrResume)]
  );
  if (result.rows.length === 0) throw new Error(`simulation attempt ${id} could not be paused`);
  return toAttempt(result.rows[0]);
}

export async function resumeSimulationAttempt(id: string): Promise<SimulationAttempt> {
  // Track B: the paused interval is added to the running section's clock
  // (server timestamps only), so a pause never consumes section time; the
  // revision bump invalidates any in-flight compare-and-swap write.
  const result = await db.query(
    `UPDATE simulation_attempts
        SET status = 'ACTIVE', resumed_at = now(), paused_at = NULL,
            navigation_state = CASE WHEN (navigation_state->>'v') = '2' THEN
              jsonb_set(jsonb_set(jsonb_set(navigation_state,
                '{sectionPausedSeconds}', to_jsonb(COALESCE((navigation_state->>'sectionPausedSeconds')::int, 0) + GREATEST(0, EXTRACT(EPOCH FROM (now() - paused_at))::int))),
                '{lastActivityAt}', to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
                '{rev}', to_jsonb(COALESCE((navigation_state->>'rev')::int, 0) + 1))
            ELSE navigation_state END
      WHERE id = $1 AND status = 'PAUSED' RETURNING *`,
    [id]
  );
  if (result.rows.length === 0) throw new Error(`simulation attempt ${id} could not be resumed from its current status`);
  return toAttempt(result.rows[0]);
}

export async function completeSimulationAttempt(id: string): Promise<SimulationAttempt> {
  const current = await getSimulationAttempt(id);
  if (!current) throw new Error(`simulation attempt ${id} not found`);
  await completeExamAttempt(current.examAttemptId);
  const result = await db.query(`UPDATE simulation_attempts SET status = 'COMPLETED' WHERE id = $1 AND status IN ('ACTIVE','PAUSED') RETURNING *`, [id]);
  if (result.rows.length === 0) throw new Error(`simulation attempt ${id} could not be completed from its current status`);
  return toAttempt(result.rows[0]);
}

export async function abandonSimulationAttempt(id: string): Promise<SimulationAttempt> {
  const result = await db.query(`UPDATE simulation_attempts SET status = 'ABANDONED' WHERE id = $1 AND status IN ('ACTIVE','PAUSED') RETURNING *`, [id]);
  if (result.rows.length === 0) throw new Error(`simulation attempt ${id} could not be abandoned from its current status`);
  // Track B: the wrapped F7 exam attempt follows (it used to stay IN_PROGRESS forever).
  await db.query(`UPDATE exam_attempts SET status = 'ABANDONED' WHERE id = $1 AND status = 'IN_PROGRESS'`, [result.rows[0].exam_attempt_id]);
  return toAttempt(result.rows[0]);
}

/** Track B: the Student's open (ACTIVE / PAUSED) attempt for a profile, if any -- a start never silently creates a second one. */
export async function findOpenSimulationAttemptForProfile(examProfileId: string): Promise<SimulationAttempt | null> {
  const result = await db.query(
    `SELECT * FROM simulation_attempts WHERE exam_profile_id = $1 AND status IN ('ACTIVE','PAUSED') ORDER BY created_at DESC LIMIT 1`,
    [examProfileId]
  );
  return result.rows.length === 0 ? null : toAttempt(result.rows[0]);
}

/**
 * Track B integrity: closes (ABANDONED) an open attempt idle beyond the
 * inactivity expiry frozen in its delivery policy. Returns true when it did.
 */
export async function expireSimulationAttemptIfInactive(attempt: SimulationAttempt): Promise<boolean> {
  if (attempt.status !== 'ACTIVE' && attempt.status !== 'PAUSED') return false;
  const nav = attempt.navigationState as Partial<ExamNavState>;
  const lastActivityAt = typeof nav?.lastActivityAt === 'string' ? nav.lastActivityAt : attempt.resumedAt ?? attempt.createdAt;
  if (!isInactiveExpired({ ...(nav as ExamNavState), lastActivityAt }, Date.now())) return false;
  await db.query(`UPDATE simulation_attempts SET status = 'ABANDONED' WHERE id = $1 AND status IN ('ACTIVE','PAUSED')`, [attempt.id]);
  await db.query(`UPDATE exam_attempts SET status = 'ABANDONED' WHERE id = $1 AND status = 'IN_PROGRESS'`, [attempt.examAttemptId]);
  return true;
}
