/**
 * Phase 8 -- Step 8B1: the SOLE canonical writer of `learning_plan` and
 * `learning_plan_item`.
 *
 * No other module inserts / updates / deletes those tables. Every plan
 * mutation -- first creation, incremental replan, policy-version
 * replacement, and (8E+) narrowly-scoped learner-control changes --
 * goes through this boundary.
 *
 * Concurrency: one per-student serialization via
 * `SELECT id FROM students WHERE id = $1 FOR UPDATE` at the top of the
 * transaction. The partial unique index (one ACTIVE plan per student)
 * is a safety net, not the serializer -- two concurrent FIRST-creation
 * writers must produce exactly one ACTIVE plan and a deterministic
 * final state, which the row lock guarantees.
 *
 * Determinism + idempotency: the plan proposal is computed by the pure
 * 8A policy (`diffLearningPlanItems`). Re-projecting the SAME proposal
 * against the SAME persisted plan is a strict no-op -- 0 new plan rows,
 * 0 new item rows, 0 supersedes, 0 audit events, no `updated_at` churn.
 *
 * Phase 8 boundary: this file NEVER writes Mastery / Knowledge State /
 * memory / transfer / verification / misconception state, NEVER runs
 * inside `updateMastery`'s cognitive transaction, and NEVER calls an AI
 * model. `intended_activity_type` and `priority_at_plan_time` are
 * CARRIED from the proposal (Phase 4's own values), never recomputed.
 */
import { db, type DbExecutor } from '@/lib/db';
import { recordDecisionEvent } from '@/lib/audit';
import {
  diffLearningPlanItems,
  ORCHESTRATION_POLICY_VERSION,
  type LearningPlanItemStatus,
  type OrchestrationReasonCode,
  type OrchestrationSource,
  type OrchestrationProvenance,
} from '@/lib/learning-orchestration-policy';
import type { ActivityType } from '@/lib/activity-taxonomy';
import type { LearningPlanRow, LearningPlanItemRow } from '@/lib/learning-plan-state';

/** A fully-formed proposed plan item (8D builds these; 8A computes `operationKey`). */
export interface ProposedLearningPlanItem {
  subjectId: string;
  conceptId: string | null;
  scheduledDate: string; // YYYY-MM-DD
  timeWindow: string | null;
  intendedActivityType: ActivityType;
  reasonCode: OrchestrationReasonCode;
  source: OrchestrationSource;
  /** Phase 4's own priorityScore at plan time -- carried, never recomputed. */
  priorityAtPlanTime: number;
  estimatedMinutes: number;
  /** buildLearningPlanItemOperationKey(...) from the pure policy. */
  operationKey: string;
  provenance: OrchestrationProvenance | Record<string, unknown>;
}

export interface ProjectLearningPlanInput {
  studentId: string;
  orchestrationPolicyVersion: number;
  horizonStart: string; // YYYY-MM-DD
  horizonEnd: string; // YYYY-MM-DD
  planningAnchorAt: string; // ISO timestamp
  timezone: string;
  timezoneAssumed: boolean;
  goalContext?: Record<string, unknown>;
  proposedItems: ProposedLearningPlanItem[];
  /**
   * Test/composition seam only. When provided, this executor is used
   * directly and the projector does NOT open its own BEGIN/COMMIT --
   * the caller owns the transaction AND the per-student lock. Omit in
   * production (8D) so the projector owns everything.
   */
  client?: DbExecutor;
}

export type PlanAction = 'CREATED' | 'RETAINED' | 'VERSION_REPLACED';

export interface ProjectLearningPlanResult {
  planId: string;
  planAction: PlanAction;
  diff: { added: number; unchanged: number; superseded: number };
  stateChanged: boolean;
}

const PLAN_COLS =
  'id, student_id, status, orchestration_policy_version, horizon_start, horizon_end, planning_anchor_at, timezone, timezone_assumed, goal_context, created_at, updated_at';

function rowToPlan(r: Record<string, any>): LearningPlanRow {
  return {
    id: r.id,
    studentId: r.student_id,
    status: r.status,
    orchestrationPolicyVersion: Number(r.orchestration_policy_version),
    horizonStart: isoDate(r.horizon_start),
    horizonEnd: isoDate(r.horizon_end),
    planningAnchorAt: r.planning_anchor_at instanceof Date ? r.planning_anchor_at.toISOString() : String(r.planning_anchor_at),
    timezone: r.timezone,
    timezoneAssumed: r.timezone_assumed === true,
    goalContext: r.goal_context ?? {},
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

function isoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

interface LiveItem {
  id: string;
  operationKey: string;
  status: LearningPlanItemStatus;
  conceptId: string | null;
  subjectId: string;
  reasonCode: OrchestrationReasonCode;
  scheduledDate: string;
}

/** True when any persisted plan-header field the projector owns differs from the proposal. */
function planHeaderChanged(existing: LearningPlanRow, input: ProjectLearningPlanInput): boolean {
  return (
    existing.horizonStart !== input.horizonStart ||
    existing.horizonEnd !== input.horizonEnd ||
    existing.planningAnchorAt !== input.planningAnchorAt ||
    existing.timezone !== input.timezone ||
    existing.timezoneAssumed !== input.timezoneAssumed ||
    JSON.stringify(existing.goalContext ?? {}) !== JSON.stringify(input.goalContext ?? {})
  );
}

async function insertPlan(client: DbExecutor, input: ProjectLearningPlanInput): Promise<string> {
  const res = await client.query(
    `INSERT INTO learning_plan
       (student_id, status, orchestration_policy_version, horizon_start, horizon_end, planning_anchor_at, timezone, timezone_assumed, goal_context)
     VALUES ($1, 'ACTIVE', $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.studentId,
      input.orchestrationPolicyVersion,
      input.horizonStart,
      input.horizonEnd,
      input.planningAnchorAt,
      input.timezone,
      input.timezoneAssumed,
      JSON.stringify(input.goalContext ?? {}),
    ],
  );
  return res.rows[0].id;
}

async function insertItem(client: DbExecutor, planId: string, studentId: string, item: ProposedLearningPlanItem, policyVersion: number): Promise<string> {
  const res = await client.query(
    `INSERT INTO learning_plan_item
       (plan_id, student_id, subject_id, concept_id, scheduled_date, time_window, intended_activity_type,
        reason_code, source, priority_at_plan_time, estimated_minutes, status, orchestration_policy_version, operation_key, provenance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PLANNED',$12,$13,$14)
     RETURNING id`,
    [
      planId,
      studentId,
      item.subjectId,
      item.conceptId,
      item.scheduledDate,
      item.timeWindow,
      item.intendedActivityType,
      item.reasonCode,
      item.source,
      item.priorityAtPlanTime,
      item.estimatedMinutes,
      policyVersion,
      item.operationKey,
      JSON.stringify(item.provenance ?? {}),
    ],
  );
  return res.rows[0].id;
}

async function core(client: DbExecutor, input: ProjectLearningPlanInput): Promise<ProjectLearningPlanResult> {
  // 1. Serialize every plan mutation for this student.
  const lock = await client.query(`SELECT id FROM students WHERE id = $1 FOR UPDATE`, [input.studentId]);
  if (lock.rowCount === 0) throw new Error(`LEARNING_PLAN_PROJECTOR: unknown student ${JSON.stringify(input.studentId)}`);

  // 2. Current ACTIVE plan (0 or 1 -- partial unique index).
  const activeRes = await client.query(`SELECT ${PLAN_COLS} FROM learning_plan WHERE student_id = $1 AND status = 'ACTIVE'`, [input.studentId]);
  const active = activeRes.rows[0] ? rowToPlan(activeRes.rows[0]) : null;

  // 3. Decide the plan path.
  let planId: string;
  let planAction: PlanAction;
  let existingLive: LiveItem[] = [];

  if (!active) {
    planId = await insertPlan(client, input);
    planAction = 'CREATED';
  } else if (active.orchestrationPolicyVersion !== input.orchestrationPolicyVersion) {
    await client.query(`UPDATE learning_plan SET status = 'SUPERSEDED', updated_at = NOW() WHERE id = $1`, [active.id]);
    planId = await insertPlan(client, input);
    planAction = 'VERSION_REPLACED';
    // A new plan at a new policy version -> every proposed operation_key
    // is new (the key embeds the policy version), so there is nothing to
    // diff against.
  } else {
    planId = active.id;
    planAction = 'RETAINED';
    const liveRes = await client.query(
      `SELECT id, operation_key, status, concept_id, subject_id, reason_code, scheduled_date
       FROM learning_plan_item WHERE plan_id = $1`,
      [planId],
    );
    existingLive = liveRes.rows.map((r) => ({
      id: r.id,
      operationKey: r.operation_key,
      status: r.status as LearningPlanItemStatus,
      conceptId: r.concept_id ?? null,
      subjectId: r.subject_id,
      reasonCode: r.reason_code as OrchestrationReasonCode,
      scheduledDate: isoDate(r.scheduled_date),
    }));
  }

  // 4. Pure minimal diff.
  const diff = diffLearningPlanItems(
    existingLive.map((i) => ({ operationKey: i.operationKey, status: i.status })),
    input.proposedItems.map((p) => ({ operationKey: p.operationKey })),
  );
  const proposedByKey = new Map(input.proposedItems.map((p) => [p.operationKey, p]));
  const liveByKey = new Map(existingLive.map((i) => [i.operationKey, i]));

  const addedKeys = diff.filter((d) => d.kind === 'ADDED').map((d) => d.operationKey);
  const supersededKeys = diff.filter((d) => d.kind === 'SUPERSEDED').map((d) => d.operationKey);
  const unchangedCount = diff.filter((d) => d.kind === 'UNCHANGED').length;

  // 5. Persist ADDED items first (so a superseded item can point at its replacement).
  const newIdByKey = new Map<string, string>();
  for (const key of addedKeys) {
    const item = proposedByKey.get(key)!;
    const id = await insertItem(client, planId, input.studentId, item, input.orchestrationPolicyVersion);
    newIdByKey.set(key, id);
  }

  // 6. Supersede removed live items. A "move" (same student + concept
  //    (or subject) + reason, different date) links old -> new via
  //    superseded_by_item_id when exactly one such ADDED item exists.
  const supersededByIdForKey = new Map<string, string | null>();
  for (const key of supersededKeys) {
    const old = liveByKey.get(key)!;
    const replacementKeys = addedKeys.filter((ak) => {
      const p = proposedByKey.get(ak)!;
      return (
        (p.conceptId ?? `subject:${p.subjectId}`) === (old.conceptId ?? `subject:${old.subjectId}`) &&
        p.reasonCode === old.reasonCode &&
        p.scheduledDate !== old.scheduledDate
      );
    });
    const supersededBy = replacementKeys.length === 1 ? newIdByKey.get(replacementKeys[0]) ?? null : null;
    supersededByIdForKey.set(key, supersededBy);
    await client.query(
      `UPDATE learning_plan_item SET status = 'SUPERSEDED', superseded_by_item_id = $2, updated_at = NOW() WHERE id = $1`,
      [old.id, supersededBy],
    );
  }

  // 7. Plan-header update only on a real change (no updated_at churn on a no-op).
  const headerChanged = planAction === 'RETAINED' && planHeaderChanged(active!, input);
  if (headerChanged) {
    await client.query(
      `UPDATE learning_plan
       SET horizon_start = $2, horizon_end = $3, planning_anchor_at = $4, timezone = $5, timezone_assumed = $6, goal_context = $7, updated_at = NOW()
       WHERE id = $1`,
      [planId, input.horizonStart, input.horizonEnd, input.planningAnchorAt, input.timezone, input.timezoneAssumed, JSON.stringify(input.goalContext ?? {})],
    );
  }

  const stateChanged = planAction !== 'RETAINED' || addedKeys.length > 0 || supersededKeys.length > 0 || headerChanged;

  // 8. Audit -- ONLY on a real change; never on a semantic no-op.
  if (stateChanged) {
    const engineVersion = String(input.orchestrationPolicyVersion);
    if (planAction === 'CREATED' || planAction === 'VERSION_REPLACED') {
      await recordDecisionEvent(
        {
          decisionType: 'PLAN_CREATED',
          engine: 'orchestration-engine',
          engineVersion,
          studentId: input.studentId,
          sourceEventType: 'learning_plan',
          sourceEventId: planId,
          previousState: active ? { planId: active.id, policyVersion: active.orchestrationPolicyVersion, replaced: planAction === 'VERSION_REPLACED' } : null,
          newState: { planId, horizonStart: input.horizonStart, horizonEnd: input.horizonEnd, itemCount: addedKeys.length },
          reasonCode: planAction === 'VERSION_REPLACED' ? 'ORCHESTRATION_POLICY_VERSION_CHANGED' : 'FIRST_ACTIVE_PLAN',
        },
        client,
      );
    } else {
      await recordDecisionEvent(
        {
          decisionType: 'PLAN_REPLANNED',
          engine: 'orchestration-engine',
          engineVersion,
          studentId: input.studentId,
          sourceEventType: 'learning_plan',
          sourceEventId: planId,
          newState: { added: addedKeys.length, superseded: supersededKeys.length, unchanged: unchangedCount, headerChanged },
          reasonCode: 'ORCHESTRATION_REPLAN',
        },
        client,
      );
    }
    for (const key of supersededKeys) {
      const old = liveByKey.get(key)!;
      await recordDecisionEvent(
        {
          decisionType: 'PLAN_ITEM_SUPERSEDED',
          engine: 'orchestration-engine',
          engineVersion,
          studentId: input.studentId,
          subjectId: old.subjectId,
          conceptId: old.conceptId,
          sourceEventType: 'learning_plan_item',
          sourceEventId: old.id,
          previousState: { status: old.status, scheduledDate: old.scheduledDate, reasonCode: old.reasonCode },
          newState: { status: 'SUPERSEDED', supersededByItemId: supersededByIdForKey.get(key) ?? null },
          reasonCode: 'ORCHESTRATION_REPLAN',
        },
        client,
      );
    }
  }

  return {
    planId,
    planAction,
    diff: { added: addedKeys.length, unchanged: unchangedCount, superseded: supersededKeys.length },
    stateChanged,
  };
}

/**
 * Project a proposed rolling plan into `learning_plan` / `learning_plan_item`.
 * Owns its own transaction + per-student lock unless `input.client` is
 * supplied (test/composition seam -- caller then owns both).
 */
export async function projectLearningPlan(input: ProjectLearningPlanInput): Promise<ProjectLearningPlanResult> {
  if (input.client) {
    return core(input.client, input);
  }
  const conn = await db.connect();
  try {
    await conn.query('BEGIN');
    const result = await core(conn, input);
    await conn.query('COMMIT');
    return result;
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/** Re-export for callers that need the canonical version at plan time. */
export { ORCHESTRATION_POLICY_VERSION };
export type { LearningPlanRow, LearningPlanItemRow };
