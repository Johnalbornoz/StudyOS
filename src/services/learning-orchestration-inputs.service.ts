/**
 * Phase 8 -- Step 8C1: the canonical batched Phase 8 INPUT layer.
 *
 * `getLearningOrchestrationInputs` gathers ONE deterministic read-only
 * snapshot for a planning / replanning pass:
 *   - now + resolved planning timezone (+ assumed flag + source)
 *   - the rolling 14-day horizon in the learner's timezone
 *   - capacity (student_availability, or the established execution-policy
 *     default when unconfirmed -- capacityAssumed distinguishes them)
 *   - Phase 4 LearningDecisions (getLearningDecisions -- ONE call)
 *   - Phase 6 memory obligations (getPhase4MemorySignalsForStudent -- ONE batch)
 *   - Phase 7 transfer state (getPhase4TransferSignalsForStudent -- ONE batch)
 *   - upcoming assessment occurrences (plain SELECT -- ONE batch; NOT
 *     assessment.service::getUpcomingForStudent, which has a hidden
 *     write side effect)
 *   - active remediation paths (plain SELECT -- ONE batch)
 *   - curriculum-eligible NOT_STARTED concepts (ONE call)
 *   - the student's current ACTIVE learning_plan (read boundary)
 *
 * It NEVER ranks a concept, NEVER re-derives Phase 4/5/6/7 state, and
 * NEVER writes -- the SOLE exception is `captureLearnerTimezone`, a
 * narrowly-scoped mutation invoked ONLY when a caller explicitly asks
 * to record a confirmed IANA timezone (not from any read, not from any
 * UI in 8C1).
 *
 * Verification readiness is NOT read separately: Phase 4 already emits
 * a `SOLO_VERIFY` decision in `decisions` when Phase 3 says the learner
 * is ready. 8D consumes that.
 */
import { db, type DbExecutor } from '@/lib/db';
import { getLearningDecisions } from '@/services/adaptive-learning-orchestrator.service';
import { getPhase4MemorySignalsForStudent, type Phase4MemorySignal } from '@/services/memory-read.service';
import { getPhase4TransferSignalsForStudent, type Phase4TransferSignal } from '@/services/transfer-read.service';
import { getActiveLearningPlan } from '@/services/learning-plan-read.service';
import { getCurriculumEligibleConcepts, type EligibleCurriculumConcept } from '@/services/curriculum-eligibility-read.service';
import {
  computeOrchestrationHorizon,
  isValidIanaTimezone,
  ORCHESTRATION_HORIZON_DAYS,
} from '@/lib/learning-orchestration-policy';
import type { LearningPlanRow } from '@/lib/learning-plan-state';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';

const DEFAULT_PLANNING_MINUTES = 30; // == learning-execution-scheduler.DEFAULT_AVAILABLE_MINUTES (established product default)
const DEFAULT_STUDY_START = '16:30:00';
const DEFAULT_STUDY_END = '18:30:00';

export type TimezoneSource = 'STUDENT_AVAILABILITY' | 'STUDENT_PROFILE' | 'DEFAULT_UTC';

export interface OrchestrationCapacity {
  maxDailyMinutes: number;
  studyStartTime: string;
  studyEndTime: string;
  /** true when there is no student_availability row -- capacity is a documented default, not a learner-confirmed value. */
  capacityAssumed: boolean;
}

export interface UpcomingAssessment {
  id: string;
  subjectId: string;
  scheduledDate: string; // YYYY-MM-DD
  status: string;
  topics: string[];
  examReadiness: number | null;
}

export interface ActiveRemediation {
  remediationPathId: string;
  rootCauseConceptId: string;
  targetConceptId: string;
  state: string;
}

export interface OrchestrationInputsDiagnostics {
  phase4DecisionReads: number;
  memoryBatchReads: number;
  transferBatchReads: number;
  assessmentBatchReads: number;
  remediationBatchReads: number;
  curriculumReads: number;
  /** 8F1: one batched read of student_unavailable_dates over the horizon. */
  unavailableDateReads: number;
}

export interface OrchestrationInputs {
  studentId: string;
  now: string; // ISO
  timezone: string;
  timezoneAssumed: boolean;
  timezoneSource: TimezoneSource;
  horizonStart: string; // YYYY-MM-DD (learner tz)
  horizonEnd: string;
  horizonDays: number;

  capacity: OrchestrationCapacity;

  decisions: LearningDecision[];
  memorySignals: Map<string, Phase4MemorySignal>;
  transferSignals: Map<string, Phase4TransferSignal>;
  assessments: UpcomingAssessment[];
  activeRemediations: ActiveRemediation[];
  curriculumEligible: EligibleCurriculumConcept[];
  activePlan: LearningPlanRow | null;

  /** 8F1: learner-declared unavailable dates within the horizon (YYYY-MM-DD, ascending). */
  unavailableDates: string[];

  diagnostics: OrchestrationInputsDiagnostics;
}

export interface OrchestrationInputsContext {
  now?: Date;
  preferredLanguage?: string;
  /** curriculum-eligibility per-subject cap (default 3). */
  curriculumPerSubjectLimit?: number;
}

interface ResolvedTimezone {
  timezone: string;
  timezoneAssumed: boolean;
  timezoneSource: TimezoneSource;
}

/**
 * Canonical planning-timezone resolution:
 *   1. a `student_availability` row (its existence = explicit capture,
 *      even if the value is 'UTC') -> STUDENT_AVAILABILITY, not assumed
 *   2. a credible non-default `students.timezone` -> STUDENT_PROFILE, not assumed
 *   3. otherwise -> UTC, assumed
 * A stored value that fails IANA validation falls through to the next rule.
 */
function resolveTimezone(availabilityTz: string | null, availabilityRowExists: boolean, profileTz: string | null): ResolvedTimezone {
  if (availabilityRowExists && availabilityTz && isValidIanaTimezone(availabilityTz)) {
    return { timezone: availabilityTz, timezoneAssumed: false, timezoneSource: 'STUDENT_AVAILABILITY' };
  }
  if (profileTz && profileTz !== 'UTC' && isValidIanaTimezone(profileTz)) {
    return { timezone: profileTz, timezoneAssumed: false, timezoneSource: 'STUDENT_PROFILE' };
  }
  return { timezone: 'UTC', timezoneAssumed: true, timezoneSource: 'DEFAULT_UTC' };
}

export async function getLearningOrchestrationInputs(
  studentId: string,
  ctx: OrchestrationInputsContext = {},
  client: DbExecutor = db,
): Promise<OrchestrationInputs> {
  const now = ctx.now ?? new Date();
  const perSubjectLimit = ctx.curriculumPerSubjectLimit ?? 3;

  const [availabilityRes, profileRes] = await Promise.all([
    client.query(
      `SELECT study_start_time, study_end_time, max_daily_minutes, timezone FROM student_availability WHERE student_id = $1`,
      [studentId],
    ),
    client.query(`SELECT timezone FROM students WHERE id = $1`, [studentId]),
  ]);
  const availRow = availabilityRes.rows[0] ?? null;
  const profileTz: string | null = profileRes.rows[0]?.timezone ?? null;

  const tz = resolveTimezone(availRow?.timezone ?? null, availRow != null, profileTz);

  const capacity: OrchestrationCapacity = availRow
    ? {
        maxDailyMinutes: Number(availRow.max_daily_minutes),
        studyStartTime: String(availRow.study_start_time),
        studyEndTime: String(availRow.study_end_time),
        capacityAssumed: false,
      }
    : {
        maxDailyMinutes: DEFAULT_PLANNING_MINUTES,
        studyStartTime: DEFAULT_STUDY_START,
        studyEndTime: DEFAULT_STUDY_END,
        capacityAssumed: true,
      };

  const horizon = computeOrchestrationHorizon(now, tz.timezone, ORCHESTRATION_HORIZON_DAYS);
  // computeOrchestrationHorizon only fails on an invalid tz/now; tz here
  // is always validated above (worst case 'UTC'), and `now` is a Date.
  const horizonStart = horizon.horizonStart!;
  const horizonEnd = horizon.horizonEnd!;

  const [decisions, memorySignals, transferSignals, assessmentsRes, remediationRes, curriculumEligible, activePlan, unavailableRes] =
    await Promise.all([
    getLearningDecisions(studentId, ctx.preferredLanguage), // Phase 4 -- ONE call
    getPhase4MemorySignalsForStudent(client, studentId, now), // Phase 6 -- ONE batch
    getPhase4TransferSignalsForStudent(client, studentId), // Phase 7 -- ONE batch
    // Plain read -- deliberately NOT getUpcomingForStudent (hidden write).
    client.query(
      `SELECT id, subject_id, scheduled_date, status, topics, exam_readiness
       FROM assessment_occurrences ao
       WHERE ao.scheduled_date >= $2
         AND ao.status NOT IN ('cancelled', 'completed')
         AND EXISTS (SELECT 1 FROM subjects s WHERE s.id = ao.subject_id AND s.student_id = $1 AND s.status = 'active')
       ORDER BY ao.scheduled_date ASC`,
      [studentId, horizonStart],
    ),
    client.query(
      `SELECT id, root_cause_concept_id, target_concept_id, state
       FROM remediation_paths
       WHERE student_id = $1 AND state IN ('CONFIRMED', 'REPAIRING', 'VERIFYING')
       ORDER BY started_at ASC`,
      [studentId],
    ),
    getCurriculumEligibleConcepts(studentId, perSubjectLimit, client),
    getActiveLearningPlan(studentId, client),
    // 8F1 -- learner-declared unavailable dates over the horizon (ONE batch).
    client.query(
      `SELECT unavailable_date
       FROM student_unavailable_dates
       WHERE student_id = $1 AND unavailable_date >= $2 AND unavailable_date <= $3
       ORDER BY unavailable_date ASC`,
      [studentId, horizonStart, horizonEnd],
    ),
  ]);

  const assessments: UpcomingAssessment[] = assessmentsRes.rows.map((r) => ({
    id: r.id,
    subjectId: r.subject_id,
    scheduledDate: String(r.scheduled_date).slice(0, 10),
    status: r.status,
    topics: Array.isArray(r.topics) ? r.topics : [],
    examReadiness: r.exam_readiness == null ? null : Number(r.exam_readiness),
  }));

  const activeRemediations: ActiveRemediation[] = remediationRes.rows.map((r) => ({
    remediationPathId: r.id,
    rootCauseConceptId: r.root_cause_concept_id,
    targetConceptId: r.target_concept_id,
    state: r.state,
  }));

  return {
    studentId,
    now: now.toISOString(),
    timezone: tz.timezone,
    timezoneAssumed: tz.timezoneAssumed,
    timezoneSource: tz.timezoneSource,
    horizonStart,
    horizonEnd,
    horizonDays: ORCHESTRATION_HORIZON_DAYS,
    capacity,
    decisions,
    memorySignals,
    transferSignals,
    assessments,
    activeRemediations,
    curriculumEligible,
    activePlan,
    unavailableDates: unavailableRes.rows.map((r) => String(r.unavailable_date).slice(0, 10)),
    diagnostics: {
      phase4DecisionReads: 1,
      memoryBatchReads: 1,
      transferBatchReads: 1,
      assessmentBatchReads: 1,
      remediationBatchReads: 1,
      curriculumReads: 1,
      unavailableDateReads: 1,
    },
  };
}

// ---------------------------------------------------------------------
// Timezone capture -- the ONLY write in this module. Not invoked from
// any read or any UI in 8C1 (8F1 wires the client capture flow).
// ---------------------------------------------------------------------

export type TimezoneCaptureResult =
  | { ok: true; timezone: string; created: boolean }
  | { ok: false; error: 'INVALID_TIMEZONE' };

/**
 * Record a learner-confirmed IANA timezone by UPSERTing ONLY the
 * `student_availability.timezone` column. Row existence is what marks
 * the timezone as confirmed (`timezoneAssumed = false`), even when the
 * value is 'UTC'. On INSERT the other availability columns take their
 * schema defaults; on conflict ONLY `timezone` + `updated_at` change --
 * a previously-set study window / max minutes is never overwritten.
 */
export async function captureLearnerTimezone(
  studentId: string,
  ianaTimezone: string,
  client: DbExecutor = db,
): Promise<TimezoneCaptureResult> {
  if (typeof ianaTimezone !== 'string' || !isValidIanaTimezone(ianaTimezone)) {
    return { ok: false, error: 'INVALID_TIMEZONE' };
  }
  const res = await client.query(
    `INSERT INTO student_availability (student_id, timezone)
     VALUES ($1, $2)
     ON CONFLICT (student_id) DO UPDATE SET timezone = EXCLUDED.timezone, updated_at = NOW()
     RETURNING (xmax = 0) AS created`,
    [studentId, ianaTimezone],
  );
  return { ok: true, timezone: ianaTimezone, created: res.rows[0]?.created === true };
}

// ---------------------------------------------------------------------
// Capacity capture -- a second narrowly-scoped write, added in 8F1 so
// the learner can set a real daily study budget. It UPSERTs ONLY the
// `student_availability.max_daily_minutes` column; the study window and
// timezone are never touched here. Like timezone capture it is invoked
// ONLY from an explicit learner action, never from a read.
// ---------------------------------------------------------------------

/** Product-safe bounds for a learner-chosen daily study budget (minutes). */
export const MIN_DAILY_STUDY_MINUTES = 15;
export const MAX_DAILY_STUDY_MINUTES = 300;

export type CapacityCaptureResult =
  | { ok: true; maxDailyMinutes: number; created: boolean }
  | { ok: false; error: 'OUT_OF_RANGE' };

export async function captureLearnerCapacity(
  studentId: string,
  maxDailyMinutes: number,
  client: DbExecutor = db,
): Promise<CapacityCaptureResult> {
  if (!Number.isFinite(maxDailyMinutes) || !Number.isInteger(maxDailyMinutes)) {
    return { ok: false, error: 'OUT_OF_RANGE' };
  }
  if (maxDailyMinutes < MIN_DAILY_STUDY_MINUTES || maxDailyMinutes > MAX_DAILY_STUDY_MINUTES) {
    return { ok: false, error: 'OUT_OF_RANGE' };
  }
  const res = await client.query(
    `INSERT INTO student_availability (student_id, max_daily_minutes)
     VALUES ($1, $2)
     ON CONFLICT (student_id) DO UPDATE SET max_daily_minutes = EXCLUDED.max_daily_minutes, updated_at = NOW()
     RETURNING (xmax = 0) AS created`,
    [studentId, maxDailyMinutes],
  );
  return { ok: true, maxDailyMinutes, created: res.rows[0]?.created === true };
}

// ---------------------------------------------------------------------
// Unavailable-date capture -- 8F1. Additive rows only; deleting a row
// makes the day available again on the next rebuild. Never blocks
// canonical evidence, never penalises cognitive state.
// ---------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type UnavailableDateResult =
  | { ok: true; date: string; action: 'ADDED' | 'REMOVED' | 'ALREADY' }
  | { ok: false; error: 'INVALID_DATE' };

export async function setLearnerUnavailableDate(
  studentId: string,
  isoDate: string,
  unavailable: boolean,
  client: DbExecutor = db,
): Promise<UnavailableDateResult> {
  if (typeof isoDate !== 'string' || !ISO_DATE_RE.test(isoDate) || Number.isNaN(Date.parse(isoDate))) {
    return { ok: false, error: 'INVALID_DATE' };
  }
  if (unavailable) {
    const res = await client.query(
      `INSERT INTO student_unavailable_dates (student_id, unavailable_date)
       VALUES ($1, $2)
       ON CONFLICT (student_id, unavailable_date) DO NOTHING`,
      [studentId, isoDate],
    );
    return { ok: true, date: isoDate, action: (res.rowCount ?? 0) > 0 ? 'ADDED' : 'ALREADY' };
  }
  await client.query(
    `DELETE FROM student_unavailable_dates WHERE student_id = $1 AND unavailable_date = $2`,
    [studentId, isoDate],
  );
  return { ok: true, date: isoDate, action: 'REMOVED' };
}
