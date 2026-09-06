/**
 * Phase 8 -- Step 8F1: narrowly-scoped LEARNER-AGENCY mutations on the
 * learning plan.
 *
 *   - rescheduleLearningPlanItem: move one live item to another day
 *     inside the horizon. Server-validated (in horizon, not in the
 *     past). The original canonical `reasonCode` is preserved; only the
 *     date changes and `source` becomes MANUAL_RESCHEDULE. Implemented
 *     as SUPERSEDE(old) + ADD(new) via the 8B projector -- never an
 *     in-place date mutation, so the full schedule history survives.
 *
 *   - skipLearningPlanItem: the learner drops a single item. ONLY the
 *     two lowest-precedence classes are skippable (ordinary curriculum
 *     progression, self-requested extra practice). Every integrity
 *     obligation is refused here -- the frontend cannot self-authorise.
 *
 *   - requestExtraPractice: the learner adds one PRACTICE item for an
 *     eligible concept, reasonCode LEARNER_REQUESTED. It sits at the
 *     lowest goal tier and never outranks an integrity obligation.
 *
 * Every write goes through the 8B SOLE writer (`projectLearningPlan` /
 * `applyPlanItemStatusChanges`). This module NEVER writes plan tables
 * directly, NEVER touches cognitive / memory / transfer state, and
 * NEVER calls an AI model. `getLearningPlanHorizon` gives the current
 * live set; a rebuild-style full projection then keeps every other item
 * UNCHANGED (same operation key) and applies just the one delta.
 */
import { db, type DbExecutor } from '@/lib/db';
import {
  buildLearningPlanItemOperationKey,
  isTerminalItemStatus,
  type OrchestrationSource,
} from '@/lib/learning-orchestration-policy';
import { canLearnerSkip } from '@/lib/learning-plan-presentation';
import { getLearningPlanHorizon, getLearningPlanItem } from '@/services/learning-plan-read.service';
import {
  projectLearningPlan,
  applyPlanItemStatusChanges,
  type ProposedLearningPlanItem,
  type ProjectLearningPlanResult,
} from '@/services/learning-plan-projector.service';
import type { LearningPlanItemRow, LearningPlanRow } from '@/lib/learning-plan-state';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXTRA_PRACTICE_MINUTES = 20;

type DiffSummary = ProjectLearningPlanResult['diff'];

function rowToProposed(
  it: LearningPlanItemRow,
  override?: { scheduledDate?: string; source?: OrchestrationSource },
): ProposedLearningPlanItem {
  const scheduledDate = override?.scheduledDate ?? it.scheduledDate;
  const source = override?.source ?? it.source;
  return {
    subjectId: it.subjectId,
    conceptId: it.conceptId,
    scheduledDate,
    timeWindow: it.timeWindow,
    intendedActivityType: it.intendedActivityType,
    reasonCode: it.reasonCode,
    source,
    priorityAtPlanTime: it.priorityAtPlanTime,
    estimatedMinutes: it.estimatedMinutes,
    operationKey: buildLearningPlanItemOperationKey({
      studentId: it.studentId,
      conceptId: it.conceptId,
      subjectId: it.subjectId,
      reasonCode: it.reasonCode,
      scheduledDate,
      orchestrationPolicyVersion: it.orchestrationPolicyVersion,
    }),
    provenance: it.provenance,
  };
}

function projectorClient(client: DbExecutor): DbExecutor | undefined {
  return client === db ? undefined : client;
}

async function project(
  studentId: string,
  plan: LearningPlanRow,
  proposedItems: ProposedLearningPlanItem[],
  client: DbExecutor,
): Promise<ProjectLearningPlanResult> {
  return projectLearningPlan({
    studentId,
    orchestrationPolicyVersion: plan.orchestrationPolicyVersion,
    horizonStart: plan.horizonStart,
    horizonEnd: plan.horizonEnd,
    planningAnchorAt: plan.planningAnchorAt,
    timezone: plan.timezone,
    timezoneAssumed: plan.timezoneAssumed,
    goalContext: plan.goalContext,
    proposedItems,
    client: projectorClient(client),
  });
}

// --- reschedule -----------------------------------------------------

export type RescheduleResult =
  | { ok: true; outcome: 'RESCHEDULED'; newDate: string; diff: DiffSummary }
  | {
      ok: false;
      error:
        | 'NO_ACTIVE_PLAN'
        | 'ITEM_NOT_FOUND'
        | 'ITEM_NOT_RESCHEDULABLE'
        | 'DATE_INVALID'
        | 'DATE_IN_PAST'
        | 'DATE_OUT_OF_HORIZON'
        | 'DATE_CONFLICT';
    };

export async function rescheduleLearningPlanItem(
  studentId: string,
  itemId: string,
  newDate: string,
  todayIso: string,
  client: DbExecutor = db,
): Promise<RescheduleResult> {
  if (typeof newDate !== 'string' || !ISO_DATE_RE.test(newDate) || Number.isNaN(Date.parse(newDate))) {
    return { ok: false, error: 'DATE_INVALID' };
  }

  const horizon = await getLearningPlanHorizon(studentId, client);
  if (!horizon) return { ok: false, error: 'NO_ACTIVE_PLAN' };

  const target = horizon.items.find((i) => i.id === itemId);
  if (!target) {
    const anyRow = await getLearningPlanItem(studentId, itemId, client);
    return { ok: false, error: anyRow ? 'ITEM_NOT_RESCHEDULABLE' : 'ITEM_NOT_FOUND' };
  }

  if (newDate < todayIso) return { ok: false, error: 'DATE_IN_PAST' };
  if (newDate < horizon.plan.horizonStart || newDate > horizon.plan.horizonEnd) {
    return { ok: false, error: 'DATE_OUT_OF_HORIZON' };
  }

  const proposedItems = horizon.items.map((it) =>
    it.id === itemId ? rowToProposed(it, { scheduledDate: newDate, source: 'MANUAL_RESCHEDULE' }) : rowToProposed(it),
  );

  // A move that lands on the exact identity (concept + reason + date) of
  // another live item would collide on the operation key.
  const keys = proposedItems.map((p) => p.operationKey);
  if (new Set(keys).size !== keys.length) return { ok: false, error: 'DATE_CONFLICT' };

  const result = await project(studentId, horizon.plan, proposedItems, client);
  return { ok: true, outcome: 'RESCHEDULED', newDate, diff: result.diff };
}

// --- skip ---------------------------------------------------------

export type SkipResult =
  | { ok: true; outcome: 'SKIPPED' }
  | { ok: false; error: 'ITEM_NOT_FOUND' | 'ITEM_NOT_LIVE' | 'SKIP_NOT_ALLOWED' };

export async function skipLearningPlanItem(
  studentId: string,
  itemId: string,
  client: DbExecutor = db,
): Promise<SkipResult> {
  const item = await getLearningPlanItem(studentId, itemId, client);
  if (!item) return { ok: false, error: 'ITEM_NOT_FOUND' };
  if (isTerminalItemStatus(item.status)) return { ok: false, error: 'ITEM_NOT_LIVE' };
  if (!canLearnerSkip(item.reasonCode)) return { ok: false, error: 'SKIP_NOT_ALLOWED' };

  const { updated } = await applyPlanItemStatusChanges(
    studentId,
    [{ itemId, status: 'SKIPPED' }],
    projectorClient(client),
  );
  if (updated === 0) return { ok: false, error: 'ITEM_NOT_LIVE' };
  return { ok: true, outcome: 'SKIPPED' };
}

// --- extra practice ---------------------------------------------

export type ExtraPracticeResult =
  | { ok: true; outcome: 'ADDED'; diff: DiffSummary }
  | { ok: true; outcome: 'ALREADY_PLANNED' }
  | { ok: false; error: 'NO_ACTIVE_PLAN' | 'CONCEPT_NOT_ELIGIBLE' };

export async function requestExtraPractice(
  studentId: string,
  conceptId: string,
  todayIso: string,
  client: DbExecutor = db,
): Promise<ExtraPracticeResult> {
  const horizon = await getLearningPlanHorizon(studentId, client);
  if (!horizon) return { ok: false, error: 'NO_ACTIVE_PLAN' };

  const conceptRes = await client.query(
    `SELECT c.id, c.subject_id
     FROM concepts c
     JOIN subjects s ON s.id = c.subject_id AND s.student_id = $1 AND s.status = 'active'
     WHERE c.id = $2`,
    [studentId, conceptId],
  );
  const subjectId: string | undefined = conceptRes.rows[0]?.subject_id;
  if (!subjectId) return { ok: false, error: 'CONCEPT_NOT_ELIGIBLE' };

  // Already something live for this concept -> nothing to add.
  if (horizon.items.some((i) => i.conceptId === conceptId)) {
    return { ok: true, outcome: 'ALREADY_PLANNED' };
  }

  const scheduledDate =
    todayIso < horizon.plan.horizonStart
      ? horizon.plan.horizonStart
      : todayIso > horizon.plan.horizonEnd
        ? horizon.plan.horizonEnd
        : todayIso;

  const newItem: ProposedLearningPlanItem = {
    subjectId,
    conceptId,
    scheduledDate,
    timeWindow: null,
    intendedActivityType: 'PRACTICE',
    reasonCode: 'LEARNER_REQUESTED',
    source: 'MANUAL_RESCHEDULE',
    priorityAtPlanTime: 0,
    estimatedMinutes: EXTRA_PRACTICE_MINUTES,
    operationKey: buildLearningPlanItemOperationKey({
      studentId,
      conceptId,
      subjectId,
      reasonCode: 'LEARNER_REQUESTED',
      scheduledDate,
      orchestrationPolicyVersion: horizon.plan.orchestrationPolicyVersion,
    }),
    provenance: { sourceType: 'learner_request', sourceRef: conceptId },
  };

  const proposedItems = [...horizon.items.map((it) => rowToProposed(it)), newItem];
  const result = await project(studentId, horizon.plan, proposedItems, client);
  return { ok: true, outcome: 'ADDED', diff: result.diff };
}
