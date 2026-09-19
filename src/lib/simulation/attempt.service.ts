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
import type { SimulationAttempt, SimulationType, TimingMode } from './types';

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
}): Promise<{ examAttempt: Awaited<ReturnType<typeof getExamAttempt>>; simulationAttempt: SimulationAttempt; planId: string }> {
  const plan = await buildSimulationPlan({
    studentId: params.studentId,
    examVersionId: params.examVersionId,
    simulationType: params.simulationType,
    learningObjectiveId: params.learningObjectiveId,
    academicSubjectId: params.academicSubjectId,
    timingMode: params.timingMode,
    readinessSnapshotId: params.readinessSnapshotId,
  });

  const examAttempt = await startExamAttempt({
    studentExamProfileId: params.examProfileId,
    examVersionId: params.examVersionId,
    institutionExamPolicyId: params.institutionExamPolicyId,
  });

  // INV-F9-10 restated: official simulation timing never permits pause. Training/Mini Mock may -- never hard-coded uniformly (task §25).
  const pauseAllowed = params.timingMode !== 'OFFICIAL_SIMULATION_TIMED';

  const navigationRules = (examAttempt?.frozenConfiguration as any)?.examVersion?.navigationRules ?? null;
  const navigationState = { currentTargetIndex: 0, visitedTargetIds: [], mode: navigationRules ? 'CONFIGURED' : 'UNKNOWN', rules: navigationRules };

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
  const result = await db.query(`UPDATE simulation_attempts SET status = 'ACTIVE', resumed_at = now(), paused_at = NULL WHERE id = $1 AND status = 'PAUSED' RETURNING *`, [id]);
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
  return toAttempt(result.rows[0]);
}
