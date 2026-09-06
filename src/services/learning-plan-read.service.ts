/**
 * Phase 8 -- Step 8B1: the STRICTLY READ-ONLY learning-plan boundary.
 *
 * ARCHITECTURAL INVARIANT (8A0 correction): nothing here writes. No
 * INSERT / UPDATE / DELETE, no call to the projector, no lazy rebuild,
 * no horizon roll, no PLANNED->READY promotion. A GET / RSC read of the
 * plan must never create, mutate, roll, or reconcile it -- that is the
 * projector's job (8B), invoked by an explicit trigger (8E), never from
 * a read. A unit test greps this file to enforce the invariant.
 *
 * Presentation-only derivations (`effectiveDueState`, `maintenanceNeeded`)
 * are PURE and clock-injected -- they compute a display hint, they do
 * NOT persist it.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { LearningPlanRow, LearningPlanItemRow } from '@/lib/learning-plan-state';

const PLAN_COLS =
  'id, student_id, status, orchestration_policy_version, horizon_start, horizon_end, planning_anchor_at, timezone, timezone_assumed, goal_context, created_at, updated_at';
const ITEM_COLS =
  'id, plan_id, student_id, subject_id, concept_id, scheduled_date, time_window, intended_activity_type, reason_code, source, priority_at_plan_time, estimated_minutes, status, orchestration_policy_version, operation_key, provenance, superseded_by_item_id, created_at, updated_at';

function isoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
function isoTs(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function rowToPlan(r: Record<string, any>): LearningPlanRow {
  return {
    id: r.id,
    studentId: r.student_id,
    status: r.status,
    orchestrationPolicyVersion: Number(r.orchestration_policy_version),
    horizonStart: isoDate(r.horizon_start),
    horizonEnd: isoDate(r.horizon_end),
    planningAnchorAt: isoTs(r.planning_anchor_at),
    timezone: r.timezone,
    timezoneAssumed: r.timezone_assumed === true,
    goalContext: r.goal_context ?? {},
    createdAt: isoTs(r.created_at),
    updatedAt: isoTs(r.updated_at),
  };
}

function rowToItem(r: Record<string, any>): LearningPlanItemRow {
  return {
    id: r.id,
    planId: r.plan_id,
    studentId: r.student_id,
    subjectId: r.subject_id,
    conceptId: r.concept_id ?? null,
    scheduledDate: isoDate(r.scheduled_date),
    timeWindow: r.time_window ?? null,
    intendedActivityType: r.intended_activity_type,
    reasonCode: r.reason_code,
    source: r.source,
    priorityAtPlanTime: Number(r.priority_at_plan_time),
    estimatedMinutes: Number(r.estimated_minutes),
    status: r.status,
    orchestrationPolicyVersion: Number(r.orchestration_policy_version),
    operationKey: r.operation_key,
    provenance: r.provenance ?? {},
    supersededByItemId: r.superseded_by_item_id ?? null,
    createdAt: isoTs(r.created_at),
    updatedAt: isoTs(r.updated_at),
  };
}

const LIVE_STATUSES = ['PLANNED', 'READY'] as const;

/** The student's single ACTIVE plan, or null. */
export async function getActiveLearningPlan(studentId: string, client: DbExecutor = db): Promise<LearningPlanRow | null> {
  const res = await client.query(`SELECT ${PLAN_COLS} FROM learning_plan WHERE student_id = $1 AND status = 'ACTIVE' LIMIT 1`, [studentId]);
  return res.rows[0] ? rowToPlan(res.rows[0]) : null;
}

export interface LearningPlanHorizon {
  plan: LearningPlanRow;
  /** Live items (PLANNED / READY) for the ACTIVE plan, ordered by (scheduled_date ASC, priority_at_plan_time DESC, id ASC). */
  items: LearningPlanItemRow[];
}

/** The ACTIVE plan plus its live items over the horizon. Null when no ACTIVE plan exists. */
export async function getLearningPlanHorizon(studentId: string, client: DbExecutor = db): Promise<LearningPlanHorizon | null> {
  const plan = await getActiveLearningPlan(studentId, client);
  if (!plan) return null;
  const res = await client.query(
    `SELECT ${ITEM_COLS} FROM learning_plan_item
     WHERE plan_id = $1 AND status = ANY($2)
     ORDER BY scheduled_date ASC, priority_at_plan_time DESC, id ASC`,
    [plan.id, LIVE_STATUSES],
  );
  return { plan, items: res.rows.map(rowToItem) };
}

/** Live items due on/before `isoDateStr` (today + any overdue), for the ACTIVE plan. */
export async function getTodayLearningPlanItems(studentId: string, isoDateStr: string, client: DbExecutor = db): Promise<LearningPlanItemRow[]> {
  const plan = await getActiveLearningPlan(studentId, client);
  if (!plan) return [];
  const res = await client.query(
    `SELECT ${ITEM_COLS} FROM learning_plan_item
     WHERE plan_id = $1 AND status = ANY($2) AND scheduled_date <= $3
     ORDER BY scheduled_date ASC, priority_at_plan_time DESC, id ASC`,
    [plan.id, LIVE_STATUSES, isoDateStr],
  );
  return res.rows.map(rowToItem);
}

/** One item scoped to the student (any status). Null if not found / not this student's. */
export async function getLearningPlanItem(studentId: string, itemId: string, client: DbExecutor = db): Promise<LearningPlanItemRow | null> {
  const res = await client.query(`SELECT ${ITEM_COLS} FROM learning_plan_item WHERE id = $1 AND student_id = $2 LIMIT 1`, [itemId, studentId]);
  return res.rows[0] ? rowToItem(res.rows[0]) : null;
}

// --- pure presentation-only derivations (NEVER persisted) -------------

export type EffectiveDueState = 'FUTURE' | 'DUE' | 'OVERDUE';

/** Pure: a display hint from `scheduled_date` vs an explicit `todayIso`. Not written back. */
export function effectiveDueState(item: Pick<LearningPlanItemRow, 'scheduledDate'>, todayIso: string): EffectiveDueState {
  if (item.scheduledDate > todayIso) return 'FUTURE';
  if (item.scheduledDate === todayIso) return 'DUE';
  return 'OVERDUE';
}

/**
 * Pure: whether the ACTIVE plan's horizon has fallen behind `todayIso`
 * and an explicit maintenance roll (8E) is warranted. This is a READ
 * hint only -- it never triggers a write from a read path.
 */
export function maintenanceNeeded(plan: Pick<LearningPlanRow, 'horizonStart'>, todayIso: string): boolean {
  return plan.horizonStart < todayIso;
}
