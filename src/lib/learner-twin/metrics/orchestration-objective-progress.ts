/**
 * Phase 8 -- Step 8H1: the 14-day ORCHESTRATION OBJECTIVE PROGRESS
 * metric.
 *
 * A transparent, fully-derived readout of how far the learner has moved
 * on the OUTCOME objectives Phase 8 has scheduled toward in the current
 * horizon. It is NOT an opaque AI progress score and it is NOT a new
 * Knowledge-State dimension:
 *
 *   objective type            derived "achieved" test (canonical state)
 *   ------------------------   -----------------------------------------
 *   VALIDATED_MASTERY         concept_knowledge_state.mastery_state = 'VALIDATED_MASTERY'
 *   QUALIFIED_RETENTION       concept_memory_state.last_successful_retention_at >= item.scheduled_date
 *   TRANSFER_DEPTH_ADVANCE    concept_transfer_state.transfer_depth strictly deeper than the
 *                             depth captured in the item's provenance at plan time
 *                             (fallback: last_successful_transfer_at >= item.scheduled_date)
 *   ASSESSMENT_READINESS      concept_knowledge_state.mastery_state in
 *                             ('PROVISIONAL_MASTERY','VALIDATED_MASTERY')
 *
 * Blocker classes (misconception / prerequisite / remediation /
 * learning-debt), plain CURRICULUM_PROGRESSION, and LEARNER_REQUESTED
 * are NOT counted -- being scheduled is never "mastered".
 *
 * Read-only. Four bounded, indexed queries (plan items + one row per
 * canonical engine state). No AI, no clock beyond `today` for the
 * retention/transfer date comparison.
 */
import { db, type DbExecutor } from '@/lib/db';
import { orchestrationObjectiveType, type OrchestrationObjectiveKind } from '@/lib/learning-plan-presentation';
import { isDeeperTransferDepth, TRANSFER_DEPTH_VALUES, type TransferDepth } from '@/lib/transfer-policy';
import {
  type MetricResult,
  type OrchestrationObjectiveProgressSummary,
  ORCHESTRATION_OBJECTIVE_PROGRESS_MODEL_VERSION,
  metricAvailable,
  metricUnavailable,
  quality,
} from './types';

const VALIDATED = 'VALIDATED_MASTERY';
const ASSESSMENT_READY_STATES = new Set(['PROVISIONAL_MASTERY', 'VALIDATED_MASTERY']);

function isTransferDepth(v: unknown): v is TransferDepth {
  return typeof v === 'string' && (TRANSFER_DEPTH_VALUES as readonly string[]).includes(v);
}

function isoDatePart(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

interface PlanItemRow {
  concept_id: string;
  reason_code: string;
  scheduled_date: string;
  provenance: any;
}

export async function readOrchestrationObjectiveProgress(
  studentId: string,
  _options: Record<string, never> = {},
  dbx: DbExecutor = db,
): Promise<MetricResult<OrchestrationObjectiveProgressSummary>> {
  const planRes = await dbx.query<{ horizon_start: string; horizon_end: string }>(
    `SELECT horizon_start, horizon_end FROM learning_plan WHERE student_id = $1 AND status = 'ACTIVE' LIMIT 1`,
    [studentId],
  );
  const plan = planRes.rows[0];
  if (!plan) return metricUnavailable('NOT_APPLICABLE', 'No active learning plan exists for this student.');

  const itemsRes = await dbx.query<PlanItemRow>(
    `SELECT lpi.concept_id, lpi.reason_code, lpi.scheduled_date, lpi.provenance
     FROM learning_plan_item lpi
     JOIN learning_plan lp ON lp.id = lpi.plan_id AND lp.status = 'ACTIVE'
     WHERE lpi.student_id = $1
       AND lpi.concept_id IS NOT NULL
       AND lpi.status IN ('PLANNED', 'READY', 'COMPLETED')`,
    [studentId],
  );

  const tracked = itemsRes.rows
    .map((r) => ({ row: r, kind: orchestrationObjectiveType(r.reason_code as any) }))
    .filter((x): x is { row: PlanItemRow; kind: OrchestrationObjectiveKind } => x.kind !== null);

  if (tracked.length === 0) {
    return metricUnavailable('INSUFFICIENT_EVIDENCE', 'The active plan has no items scheduled toward a 14-day outcome objective yet.');
  }

  const conceptIds = [...new Set(tracked.map((t) => t.row.concept_id))];
  const [cksRes, cmsRes, ctsRes] = await Promise.all([
    dbx.query<{ concept_id: string; mastery_state: string }>(
      `SELECT concept_id, mastery_state FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = ANY($2)`,
      [studentId, conceptIds],
    ),
    dbx.query<{ concept_id: string; last_successful_retention_at: string | null }>(
      `SELECT concept_id, last_successful_retention_at FROM concept_memory_state WHERE student_id = $1 AND concept_id = ANY($2)`,
      [studentId, conceptIds],
    ),
    dbx.query<{ concept_id: string; transfer_depth: string; last_successful_transfer_at: string | null }>(
      `SELECT concept_id, transfer_depth, last_successful_transfer_at FROM concept_transfer_state WHERE student_id = $1 AND concept_id = ANY($2)`,
      [studentId, conceptIds],
    ),
  ]);

  const masteryByConcept = new Map(cksRes.rows.map((r) => [r.concept_id, r.mastery_state]));
  const retentionByConcept = new Map(cmsRes.rows.map((r) => [r.concept_id, r.last_successful_retention_at]));
  const transferByConcept = new Map(ctsRes.rows.map((r) => [r.concept_id, r]));

  const byType: OrchestrationObjectiveProgressSummary['byType'] = {
    VALIDATED_MASTERY: { tracked: 0, achieved: 0 },
    QUALIFIED_RETENTION: { tracked: 0, achieved: 0 },
    TRANSFER_DEPTH_ADVANCE: { tracked: 0, achieved: 0 },
    ASSESSMENT_READINESS: { tracked: 0, achieved: 0 },
  };

  let achieved = 0;
  for (const { row, kind } of tracked) {
    byType[kind].tracked += 1;
    const scheduled = isoDatePart(row.scheduled_date);
    let ok = false;

    if (kind === 'VALIDATED_MASTERY') {
      ok = masteryByConcept.get(row.concept_id) === VALIDATED;
    } else if (kind === 'ASSESSMENT_READINESS') {
      ok = ASSESSMENT_READY_STATES.has(masteryByConcept.get(row.concept_id) ?? '');
    } else if (kind === 'QUALIFIED_RETENTION') {
      const last = isoDatePart(retentionByConcept.get(row.concept_id));
      ok = last !== null && scheduled !== null && last >= scheduled;
    } else if (kind === 'TRANSFER_DEPTH_ADVANCE') {
      const cur = transferByConcept.get(row.concept_id);
      const planTime = row.provenance?.facts?.transferDepth;
      if (cur && isTransferDepth(cur.transfer_depth) && isTransferDepth(planTime)) {
        ok = isDeeperTransferDepth(cur.transfer_depth, planTime);
      } else {
        const last = isoDatePart(cur?.last_successful_transfer_at);
        ok = last !== null && scheduled !== null && last >= scheduled;
      }
    }

    if (ok) {
      achieved += 1;
      byType[kind].achieved += 1;
    }
  }

  return metricAvailable({
    horizonStart: String(plan.horizon_start).slice(0, 10),
    horizonEnd: String(plan.horizon_end).slice(0, 10),
    tracked: tracked.length,
    achieved,
    achievedRate: Math.round((achieved / tracked.length) * 100) / 100,
    byType,
    method:
      'Derived from canonical Phase 3 knowledge state, Phase 6 memory state, and Phase 7 transfer state. ' +
      'Scheduling an item never counts as achieving its objective; blocker / curriculum / learner-requested items are not tracked.',
    quality: quality(tracked.length, new Date().toISOString().slice(0, 10), ORCHESTRATION_OBJECTIVE_PROGRESS_MODEL_VERSION),
  });
}
