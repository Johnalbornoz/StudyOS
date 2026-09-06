/**
 * Study Plan Adherence (student, learner-level -- a plan spans subjects,
 * so this is not subject-scoped).
 *
 * Phase 8 -- Step 8H1 migration. The canonical source is now
 * `learning_plan` / `learning_plan_item` (`CANONICAL_PLAN_AUTHORITY`),
 * NOT the frozen legacy `study_plans` / `study_sessions` /
 * `study_session_items` tables. Model version bumped to `v2` so a
 * consumer can detect the source change.
 *
 * Numerator / denominator (both reported):
 *   denominator = ACTIVE-plan items whose `scheduled_date` falls in the
 *     window AND has already come due, EXCLUDING auto-`SUPERSEDED`
 *     items -- a replan that supersedes an item is the orchestrator's
 *     doing, never a learner miss, so it must not count against the
 *     learner.
 *   numerator = those items that are `COMPLETED` OR have canonical
 *     `learning_evidence` for their concept on/after the scheduled date.
 *     Completion is thus always derived from canonical evidence (either
 *     already reconciled onto the item status by 8E maintenance, or
 *     read straight from `learning_evidence` here) -- never from a
 *     self-report and never from a dead status column.
 *
 * Remains purely observational: never a motivation / personality /
 * "disciplined" label, and no shame framing -- just the two counts and
 * their ratio.
 */
import { db } from '@/lib/db';
import { type StudyPlanAdherenceSummary, type MetricResult, STUDY_PLAN_ADHERENCE_MODEL_VERSION, metricAvailable, metricUnavailable, quality } from './types';

export interface StudyPlanAdherenceOptions {
  /** Trailing N days ending today, overriding the ACTIVE plan's own horizon_start as the window start. */
  windowDays?: number;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function readStudyPlanAdherence(
  studentId: string,
  options: StudyPlanAdherenceOptions = {}
): Promise<MetricResult<StudyPlanAdherenceSummary>> {
  const planResult = await db.query<{ id: string; horizon_start: string; horizon_end: string }>(
    `SELECT id, horizon_start, horizon_end FROM learning_plan
     WHERE student_id = $1 AND status = 'ACTIVE'
     LIMIT 1`,
    [studentId]
  );
  const plan = planResult.rows[0];
  if (!plan) {
    return metricUnavailable('NOT_APPLICABLE', 'No active learning plan exists for this student.');
  }

  const today = toDateString(new Date());
  const horizonStart = String(plan.horizon_start).slice(0, 10);
  const horizonEnd = String(plan.horizon_end).slice(0, 10);
  const windowStart = options.windowDays
    ? toDateString(new Date(Date.now() - options.windowDays * 24 * 60 * 60 * 1000))
    : horizonStart;
  const windowEnd = today < horizonEnd ? today : horizonEnd;

  // denominator excludes auto-SUPERSEDED items; numerator is
  // canonical-evidence-derived (item already COMPLETED, or fresh
  // learning_evidence for the item's concept on/after its date).
  const itemsResult = await db.query<{ completed: boolean }>(
    `SELECT (
       lpi.status = 'COMPLETED'
       OR (
         lpi.concept_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM learning_evidence le
           WHERE le.student_id = $4
             AND le.concept_id = lpi.concept_id
             AND le.timestamp::date >= lpi.scheduled_date
         )
       )
     ) AS completed
     FROM learning_plan_item lpi
     WHERE lpi.plan_id = $1
       AND lpi.scheduled_date >= $2
       AND lpi.scheduled_date <= $3
       AND lpi.status <> 'SUPERSEDED'`,
    [plan.id, windowStart, windowEnd, studentId]
  );

  const scheduledSessions = itemsResult.rows.length;
  if (scheduledSessions === 0) {
    return metricUnavailable('INSUFFICIENT_EVIDENCE', 'No scheduled plan items have come due yet within this window.');
  }

  const completedSessions = itemsResult.rows.filter((r) => r.completed === true).length;

  return metricAvailable({
    windowStart,
    windowEnd,
    scheduledSessions,
    completedSessions,
    missedSessions: scheduledSessions - completedSessions,
    completionRate: Math.round((completedSessions / scheduledSessions) * 100) / 100,
    quality: quality(scheduledSessions, today, STUDY_PLAN_ADHERENCE_MODEL_VERSION),
  });
}
