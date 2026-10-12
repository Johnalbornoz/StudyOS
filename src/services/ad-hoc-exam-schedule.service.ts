/**
 * A Student's own partial exam -- its schedules (database).
 *
 * A schedule is the Student's own record: the Subject, the exact concepts, the size, the time available, a
 * moment (date AND time) and the Student's timezone. A Student may hold any number, several for one Subject.
 * It has nothing to do with the Subject's school "next exam" record and reads or writes none of it.
 *
 * Lifecycle: SCHEDULED -> STARTED -> COMPLETED, and SCHEDULED -> CANCELLED.
 *
 * A schedule holds no question. Starting one goes through the one start route, which reads the scope from
 * here (never from the request) and checks it again.
 *
 * Tables: student_scheduled_assessments, student_scheduled_assessment_concepts (migration 20261121_1000).
 * Where that migration is not applied yet there are no schedules: reads answer "none", writes "UNAVAILABLE".
 */
import { db } from '@/lib/db';
import { isUuid } from '@/lib/ad-hoc-exam/selection';
import { isValidIanaTimezone } from '@/lib/learning-orchestration-policy';
import { resolveAdHocExamScope, type AdHocScopeRefusal } from '@/services/ad-hoc-exam.service';

export const AD_HOC_SCHEDULE_STATUSES = ['SCHEDULED', 'STARTED', 'COMPLETED', 'CANCELLED'] as const;
export type AdHocScheduleStatus = (typeof AD_HOC_SCHEDULE_STATUSES)[number];
export const AD_HOC_SCHEDULE_DEPTHS = ['QUICK', 'BALANCED', 'DEEP'] as const;
export type AdHocScheduleDepth = (typeof AD_HOC_SCHEDULE_DEPTHS)[number];

/** How far ahead an exam may be scheduled, and the tolerance for "now" (a form submitted a moment late). */
export const AD_HOC_SCHEDULE_MAX_DAYS_AHEAD = 366;
const PAST_TOLERANCE_MS = 60_000;

export interface ScheduledAdHocExam {
  id: string;
  subjectId: string;
  /** The concepts of the schedule that still exist, sorted. */
  conceptIds: string[];
  /** false when a concept of the schedule no longer exists: the scope is not the one that was scheduled. */
  scopeIntact: boolean;
  depth: AdHocScheduleDepth;
  availableMinutes: number | null;
  /** ISO instant. */
  scheduledAt: string;
  /** The Student's IANA timezone when it was saved. */
  timezone: string;
  status: AdHocScheduleStatus;
  quizSessionId: string | null;
}

export type CreateScheduleRefusal = { reason: 'SCOPE_REJECTED'; detail: AdHocScopeRefusal } | { reason: 'INVALID_TIME' | 'INVALID_TIMEZONE' | 'INVALID_SIZE' | 'UNAVAILABLE' };

const isMissingTable = (e: unknown): boolean => (e as { code?: string } | null)?.code === '42P01';
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

const SELECT = `SELECT a.id, a.subject_id, a.depth, a.available_minutes, a.scheduled_at, a.timezone, a.status, a.quiz_session_id, a.concept_count,
                       COALESCE((SELECT array_agg(c.concept_id::text ORDER BY c.concept_id::text) FROM student_scheduled_assessment_concepts c WHERE c.scheduled_assessment_id = a.id), '{}') AS concept_ids
                  FROM student_scheduled_assessments a`;

function rowToSchedule(r: any): ScheduledAdHocExam {
  const conceptIds = (r.concept_ids ?? []) as string[];
  return {
    id: r.id,
    subjectId: r.subject_id,
    conceptIds,
    scopeIntact: conceptIds.length === Number(r.concept_count),
    depth: r.depth,
    availableMinutes: r.available_minutes === null || r.available_minutes === undefined ? null : Number(r.available_minutes),
    scheduledAt: iso(r.scheduled_at),
    timezone: r.timezone,
    status: r.status,
    quizSessionId: r.quiz_session_id ?? null,
  };
}

/**
 * May a scheduled exam start at `now`? Not before its moment: exactly at it, or any time after. The server's
 * clock decides; a page may show the same answer but cannot give it.
 */
export function isScheduledExamDue(schedule: Pick<ScheduledAdHocExam, 'scheduledAt'>, now: Date): boolean {
  return now.getTime() >= new Date(schedule.scheduledAt).getTime();
}

/** An instant with an explicit offset ("...Z" or "+hh:mm"): a date alone, or a wall time with no zone, is not a moment. */
export function parseScheduledInstant(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

export interface CreateScheduleInput {
  subjectId: unknown;
  conceptIds: readonly unknown[];
  depth: unknown;
  availableMinutes?: number | null;
  scheduledAt: unknown;
  timezone: unknown;
}

/**
 * Saves a new, independent schedule. The scope is checked here, whatever a page checked before: the Subject is
 * the Student's own and EVERY concept is one of its concepts, or nothing is saved. It never replaces or
 * touches another schedule.
 */
export async function createScheduledAdHocExam(studentId: string, input: CreateScheduleInput, now: Date = new Date()): Promise<{ ok: true; schedule: ScheduledAdHocExam } | ({ ok: false } & CreateScheduleRefusal)> {
  if (!(AD_HOC_SCHEDULE_DEPTHS as readonly unknown[]).includes(input.depth)) return { ok: false, reason: 'INVALID_SIZE' };
  const minutes = input.availableMinutes ?? null;
  if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 240)) return { ok: false, reason: 'INVALID_SIZE' };
  if (typeof input.timezone !== 'string' || input.timezone.length > 64 || !isValidIanaTimezone(input.timezone)) return { ok: false, reason: 'INVALID_TIMEZONE' };
  const at = parseScheduledInstant(input.scheduledAt);
  if (!at || at.getTime() < now.getTime() - PAST_TOLERANCE_MS || at.getTime() > now.getTime() + AD_HOC_SCHEDULE_MAX_DAYS_AHEAD * 86_400_000) return { ok: false, reason: 'INVALID_TIME' };

  const scope = await resolveAdHocExamScope(studentId, input.subjectId, input.conceptIds);
  if (!scope.ok) return { ok: false, reason: 'SCOPE_REJECTED', detail: scope.reason };

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO student_scheduled_assessments (student_id, subject_id, intent, scheduled_at, timezone, depth, available_minutes, concept_count)
       VALUES ($1, $2, 'AD_HOC_CONCEPT_EXAM', $3, $4, $5, $6, $7) RETURNING id`,
      [studentId, scope.subjectId, at.toISOString(), input.timezone, input.depth, minutes, scope.conceptIds.length]
    );
    const id = created.rows[0].id as string;
    await client.query(`INSERT INTO student_scheduled_assessment_concepts (scheduled_assessment_id, concept_id) SELECT $1, unnest($2::uuid[])`, [id, scope.conceptIds]);
    await client.query('COMMIT');
    return { ok: true, schedule: { id, subjectId: scope.subjectId, conceptIds: [...scope.conceptIds].sort(), scopeIntact: true, depth: input.depth as AdHocScheduleDepth, availableMinutes: minutes, scheduledAt: at.toISOString(), timezone: input.timezone, status: 'SCHEDULED', quizSessionId: null } };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (isMissingTable(e)) return { ok: false, reason: 'UNAVAILABLE' };
    throw e;
  } finally {
    client.release();
  }
}

/** The Student's own schedules that are still open (SCHEDULED or STARTED), soonest first; optionally of one Subject. */
export async function listScheduledAdHocExams(studentId: string, filter: { subjectId?: string | null } = {}): Promise<ScheduledAdHocExam[]> {
  if (filter.subjectId && !isUuid(filter.subjectId)) return [];
  try {
    const r = await db.query(`${SELECT} WHERE a.student_id = $1 AND a.status IN ('SCHEDULED', 'STARTED') AND ($2::uuid IS NULL OR a.subject_id = $2::uuid) ORDER BY a.scheduled_at, a.id LIMIT 200`, [studentId, filter.subjectId ?? null]);
    return r.rows.map(rowToSchedule);
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

/** One schedule of THIS Student. Another Student's schedule is indistinguishable from one that does not exist. */
export async function getScheduledAdHocExam(studentId: string, id: unknown): Promise<ScheduledAdHocExam | null> {
  if (!isUuid(id)) return null;
  try {
    const r = await db.query(`${SELECT} WHERE a.id = $1 AND a.student_id = $2`, [id, studentId]);
    return r.rows[0] ? rowToSchedule(r.rows[0]) : null;
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/** SCHEDULED -> CANCELLED, the Student's own only. A schedule that already started is not cancelled here. */
export async function cancelScheduledAdHocExam(studentId: string, id: unknown): Promise<boolean> {
  if (!isUuid(id)) return false;
  try {
    const r = await db.query(`UPDATE student_scheduled_assessments SET status = 'CANCELLED', cancelled_at = now(), updated_at = now() WHERE id = $1 AND student_id = $2 AND status = 'SCHEDULED' RETURNING id`, [id, studentId]);
    return r.rows.length > 0;
  } catch (e) {
    if (isMissingTable(e)) return false;
    throw e;
  }
}

/**
 * SCHEDULED -> STARTED, bound to the session that executes it. Idempotent for the same session. When the
 * session already executes another schedule (two schedules with the same scope, the first still open), this
 * one stays SCHEDULED: it starts its own session once that one is finished.
 */
export async function markScheduledAdHocExamStarted(studentId: string, id: string, quizSessionId: string): Promise<boolean> {
  try {
    const r = await db.query(
      `UPDATE student_scheduled_assessments SET status = 'STARTED', quiz_session_id = $3, started_at = now(), updated_at = now()
        WHERE id = $1 AND student_id = $2 AND status = 'SCHEDULED'
          AND NOT EXISTS (SELECT 1 FROM student_scheduled_assessments o WHERE o.quiz_session_id = $3)
        RETURNING id`,
      [id, studentId, quizSessionId]
    );
    return r.rows.length > 0;
  } catch (e) {
    if (isMissingTable(e) || (e as { code?: string } | null)?.code === '23505') return false;
    throw e;
  }
}

/** STARTED -> COMPLETED for the schedule this session executes, if any. A session that executes none changes nothing. */
export async function completeScheduledAdHocExamForSession(studentId: string, quizSessionId: string): Promise<boolean> {
  try {
    const r = await db.query(`UPDATE student_scheduled_assessments SET status = 'COMPLETED', completed_at = now(), updated_at = now() WHERE quiz_session_id = $1 AND student_id = $2 AND status = 'STARTED' RETURNING id`, [quizSessionId, studentId]);
    return r.rows.length > 0;
  } catch (e) {
    if (isMissingTable(e)) return false;
    throw e;
  }
}
