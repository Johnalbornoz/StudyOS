/**
 * Phase 8 -- Step 8A1: pure TypeScript mirror of the additive
 * `learning_plan` / `learning_plan_item` schema
 * (database/migrations/20260909_1000_phase8_learning_plan.sql).
 *
 * TYPE ONLY. No DB, no service behavior, no projector, no reads. The
 * 8B1 projector and the 8B1 read boundary build against these shapes;
 * the migration test asserts the column mirrors match the SQL exactly.
 *
 * `status` / `orchestration_policy_version` / the source + reason-code
 * unions reuse the canonical definitions in
 * `src/lib/learning-orchestration-policy.ts` rather than redefining
 * them.
 */
import type {
  LearningPlanStatus,
  LearningPlanItemStatus,
  OrchestrationSource,
  OrchestrationReasonCode,
  OrchestrationProvenance,
} from '@/lib/learning-orchestration-policy';
import type { ActivityType } from '@/lib/activity-taxonomy';

/**
 * One row of `learning_plan` -- the canonical persisted Phase 8
 * rolling-horizon plan for a student. At most ONE row per student has
 * `status = 'ACTIVE'` (enforced by a partial unique index). No row
 * exists until the 8B1 projector writes one.
 */
export interface LearningPlanRow {
  id: string;
  studentId: string;
  status: LearningPlanStatus;
  orchestrationPolicyVersion: number;

  /** YYYY-MM-DD (learner timezone). */
  horizonStart: string;
  horizonEnd: string;
  planningAnchorAt: string;

  timezone: string;
  /** true until a real IANA timezone has been captured for the learner. */
  timezoneAssumed: boolean;

  /** Objective/context references only -- never learner-state truth. */
  goalContext: Record<string, unknown>;

  createdAt: string;
  updatedAt: string;
}

/**
 * One row of `learning_plan_item` -- an orchestration commitment /
 * scheduled opportunity. It NEVER stores canonical Mastery / Knowledge
 * State / memory / transfer values; those are always re-read live at
 * execution time (8B+ revalidation).
 */
export interface LearningPlanItemRow {
  id: string;
  planId: string;
  studentId: string;
  subjectId: string;
  /** null for a subject-level item (e.g. MOCK_EXAM). */
  conceptId: string | null;

  /** YYYY-MM-DD. */
  scheduledDate: string;
  /** Optional soft label (e.g. 'MORNING'), never a hard clock. */
  timeWindow: string | null;

  /** Revalidated against Phase 4 before launch -- a hint, not an authority. */
  intendedActivityType: ActivityType;

  reasonCode: OrchestrationReasonCode;
  source: OrchestrationSource;

  /** Phase 4's own priorityScore at plan time -- carried for sequencing / history, never re-derived. */
  priorityAtPlanTime: number;
  estimatedMinutes: number;

  status: LearningPlanItemStatus;
  orchestrationPolicyVersion: number;

  /** Deterministic identity (buildLearningPlanItemOperationKey); globally UNIQUE. */
  operationKey: string;

  provenance: OrchestrationProvenance | Record<string, unknown>;

  /** Set when a replan replaced this item; points at the newer item. */
  supersededByItemId: string | null;

  createdAt: string;
  updatedAt: string;
}

/** Column list of `learning_plan`, in migration order -- asserted against the SQL by the migration test. */
export const LEARNING_PLAN_COLUMNS = [
  'id',
  'student_id',
  'status',
  'orchestration_policy_version',
  'horizon_start',
  'horizon_end',
  'planning_anchor_at',
  'timezone',
  'timezone_assumed',
  'goal_context',
  'created_at',
  'updated_at',
] as const;

/** Column list of `learning_plan_item`, in migration order. */
export const LEARNING_PLAN_ITEM_COLUMNS = [
  'id',
  'plan_id',
  'student_id',
  'subject_id',
  'concept_id',
  'scheduled_date',
  'time_window',
  'intended_activity_type',
  'reason_code',
  'source',
  'priority_at_plan_time',
  'estimated_minutes',
  'status',
  'orchestration_policy_version',
  'operation_key',
  'provenance',
  'superseded_by_item_id',
  'created_at',
  'updated_at',
] as const;
