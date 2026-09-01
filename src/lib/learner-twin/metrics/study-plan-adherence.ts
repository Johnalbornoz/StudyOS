/**
 * Phase 1E (Steps 15-16), corrected by Phase 1E-R (external review
 * finding B): Study Plan Adherence (student, learner-level -- a study
 * plan spans subjects, so this is not subject-scoped).
 *
 * Source audit finding (disclosed, not silently worked around):
 * `study_sessions.completion_status` is written as `'pending'` at
 * creation time (study-plan.service.ts::storeStudyPlan) and is NEVER
 * updated anywhere in the codebase -- it is dead data, always
 * `'pending'` regardless of what the student actually did.
 *
 * Phase 1E's first implementation derived "completed" from ANY
 * learning_evidence on the session's scheduled_date, regardless of
 * subject/concept -- external review correctly identified this as too
 * strong a claim for a metric named "Study Plan Adherence": a student
 * who planned Mathematics but only produced Physics evidence that day
 * would have been counted as having completed the Mathematics session.
 *
 * Phase 1E-R re-audit (Step 9) found `study_session_items.concept_id`
 * IS populated for every planned item (study-plan.service.ts::
 * storeStudyPlan's own INSERT, `StudySessionItem.conceptId` is
 * non-optional) -- so `CAN_PLANNED_SESSION_COMPLETION_BE_PROVEN = YES`,
 * at concept granularity (not exact-question identity, which the data
 * model doesn't capture and which Step 10's own "YES" branch does not
 * require). "Completed" now requires `learning_evidence` for a concept
 * that session's OWN items actually planned, on that session's own
 * scheduled_date -- the strongest existing legitimate linkage, and the
 * fix that makes the Math/Physics cross-contamination case behave
 * correctly (see tests/unit/metrics-study-plan-adherence.test.ts).
 *
 * Step 16: the window is an explicit parameter, never hard-coded.
 * Default: the student's own current active study plan's own
 * [period_start, min(period_end, today)] -- an existing StudyUs
 * planning period, not an arbitrary invented duration. A caller may
 * instead pass `windowDays` for a fixed trailing window.
 *
 * Remains purely observational (Step 11): never LOW_MOTIVATION,
 * DISCIPLINED, ENGAGED_STUDENT, or any personality/behavior label.
 */
import { db } from '@/lib/db';
import { type StudyPlanAdherenceSummary, type MetricResult, STUDY_PLAN_ADHERENCE_MODEL_VERSION, metricAvailable, metricUnavailable, quality } from './types';

export interface StudyPlanAdherenceOptions {
  /** Trailing N days ending today, overriding the active plan's own period_start as the window start. */
  windowDays?: number;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function readStudyPlanAdherence(
  studentId: string,
  options: StudyPlanAdherenceOptions = {}
): Promise<MetricResult<StudyPlanAdherenceSummary>> {
  const planResult = await db.query<{ id: string; period_start: string; period_end: string }>(
    `SELECT id, period_start, period_end FROM study_plans
     WHERE student_id = $1 AND period_end >= CURRENT_DATE AND status = 'active'
     ORDER BY generated_at DESC LIMIT 1`,
    [studentId]
  );
  const plan = planResult.rows[0];
  if (!plan) {
    return metricUnavailable('NOT_APPLICABLE', 'No active study plan exists for this student.');
  }

  const today = toDateString(new Date());
  const windowStart = options.windowDays
    ? toDateString(new Date(Date.now() - options.windowDays * 24 * 60 * 60 * 1000))
    : String(plan.period_start).slice(0, 10);
  const windowEnd = today < String(plan.period_end).slice(0, 10) ? today : String(plan.period_end).slice(0, 10);

  // Phase 1E-R: a session counts as completed only when learning_evidence
  // exists for a CONCEPT THAT SESSION'S OWN ITEMS PLANNED (joined via
  // study_session_items.session_id = ss.id), on that session's own
  // scheduled_date. Evidence for an unrelated concept/subject that day
  // -- even a real, same-day one -- does not satisfy a DIFFERENT
  // session's completion. A session with no recorded items can never
  // match (conservatively never "completed"), which is correct: there
  // is nothing to have completed against.
  const sessionsResult = await db.query<{ scheduled_date: string; has_matching_evidence: boolean }>(
    `SELECT ss.scheduled_date,
            EXISTS (
              SELECT 1 FROM learning_evidence le
              JOIN study_session_items ssi ON ssi.concept_id = le.concept_id
              WHERE le.student_id = $1
                AND ssi.session_id = ss.id
                AND le.timestamp::date = ss.scheduled_date
            ) AS has_matching_evidence
     FROM study_sessions ss
     WHERE ss.plan_id = $2 AND ss.scheduled_date >= $3 AND ss.scheduled_date <= $4`,
    [studentId, plan.id, windowStart, today]
  );

  const scheduledSessions = sessionsResult.rows.length;
  if (scheduledSessions === 0) {
    return metricUnavailable('INSUFFICIENT_EVIDENCE', 'No scheduled study sessions have come due yet within this window.');
  }

  const completedSessions = sessionsResult.rows.filter((r) => r.has_matching_evidence).length;

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
