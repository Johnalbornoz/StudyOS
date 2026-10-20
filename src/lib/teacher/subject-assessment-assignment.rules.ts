/**
 * Teacher-assigned subject Test ("Prueba por materia") / Mock ("Simulacro por materia") -- the assignment rules (pure,
 * no IO). Contract: docs/orchestration/OVERNIGHT_2026-10-16_CONTRACTS.md section 3. Sessions themselves are the subject
 * service's (src/services/subject-assessment.service.ts, contract section 2); this file only decides the assignment
 * layer: window, attempts, resume / close, result, feedback release, group read-model aggregation.
 *
 * Operator rules (overnight 2026-10-16):
 *   U  window: every calendar day from startDate to endDate inclusive; opens 00:00 of startDate and closes 21:00 of
 *      endDate in the AUTHORITATIVE timezone = the class's institution `institutions.timezone`. No timezone -> the
 *      assignment is refused (TIMEZONE_AUTHORITY_BLOCKER). Never a hard-coded timezone.
 *   S  up to maxAttempts (1-3, APPROVED 2026-10-17); none is required; retry after a pass is allowed; the result = the LAST COMPLETED attempt
 *      (not the best, not the average); history kept.
 *   V  an attempt STARTED before the close may be finished after it while the session lives; after the close an
 *      attempt whose session was left (no activity within the liveness window) cannot be resumed and is closed as is
 *      (answered graded, unanswered in the denominator); no new attempt starts after the close. Before the close a
 *      left attempt is resumed (same attempt, saved answers kept, no extra attempt consumed).
 *      APPROVED 2026-10-17: "the same continuous session" = the attempt's last activity (start, a saved answer, or a
 *      runner heartbeat every HEARTBEAT_INTERVAL_SECONDS = 30) is within ABANDONMENT_TOLERANCE_SECONDS = 180 of now.
 *      After the 21:00 close, more than 180 s without activity counts as LEFT: a resume / answer / submit is refused
 *      and the attempt is closed as is. A reconnect before 21:00 may still resume.
 *   AB feedback release: full feedback immediately when the versions are truly diverse (no item fingerprint served to
 *      two different students of the assignment); otherwise score + general performance now, correct answers and
 *      explanations held until the window closes. Computed at read time from the items actually served.
 *   Y  pass >= 80 inclusive (sizing.ts).
 */
import { subjectAssessmentPassed } from '@/lib/subject-assessment/sizing';
import { isIsoDate, isValidTimeZone, zonedWallTimeToUtc, resolveTimezoneAuthority, type DifficultyBand, type TimezoneAuthority } from '@/lib/subject-assessment/lifecycle';
import { bucketDistribution, type KnowledgeBucket } from '@/lib/subject-assessment/knowledge-bucket';

export { zonedWallTimeToUtc };
export type { DifficultyBand };

export type SubjectAssignmentKind = 'TEST' | 'MOCK';
export type SubjectAssignmentInterventionType = 'SUBJECT_TEST' | 'SUBJECT_MOCK';

export const INTERVENTION_TYPE_OF: Record<SubjectAssignmentKind, SubjectAssignmentInterventionType> = { TEST: 'SUBJECT_TEST', MOCK: 'SUBJECT_MOCK' };
export const kindOfInterventionType = (t: string): SubjectAssignmentKind | null => (t === 'SUBJECT_TEST' ? 'TEST' : t === 'SUBJECT_MOCK' ? 'MOCK' : null);
export const SUBJECT_ASSIGNMENT_TYPES: readonly SubjectAssignmentInterventionType[] = ['SUBJECT_TEST', 'SUBJECT_MOCK'];

/** UI difficulty -> the approved bands (APPROVED 2026-10-17: BASIC 2, INTERMEDIATE 3, ADVANCED 4, MIXED 30/50/20). */
export const UI_DIFFICULTY_TO_BAND = { BASICO: 'BASIC', INTERMEDIO: 'INTERMEDIATE', AVANZADO: 'ADVANCED', MIXTO: 'MIXED' } as const satisfies Record<string, DifficultyBand>;
export type UiDifficulty = keyof typeof UI_DIFFICULTY_TO_BAND;

/** Closing wall-clock time on endDate in the institution's timezone (operator rule U). */
export const WINDOW_CLOSE_HOUR = 21;
export const WINDOW_CLOSE_MINUTE = 0;
/** Teacher-chosen attempts allowed: 1, 2 or 3 (APPROVED 2026-10-17); the server rejects any other value. */
export const MAX_ATTEMPTS_LIMIT = 3;
export const MAX_ATTEMPTS_OPTIONS = [1, 2, 3] as const;
/** Runner heartbeat cadence and the abandonment tolerance after the 21:00 close (APPROVED 2026-10-17). */
export const HEARTBEAT_INTERVAL_SECONDS = 30;
export const ABANDONMENT_TOLERANCE_SECONDS = 180;
/** The window that defines "the same continuous session" = the abandonment tolerance. */
export const LIVENESS_WINDOW_SECONDS = ABANDONMENT_TOLERANCE_SECONDS;

export interface AssignmentWindow {
  startDate: string;
  endDate: string;
  timezone: string;
  /** D71: the recipient's own timezone (student_availability) beats the class institution's. */
  timezoneSource: 'INSTITUTION' | 'STUDENT_AVAILABILITY';
  opensAt: string;
  closesAt: string;
}

export type FeedbackPolicy = 'TEST_CORRECTNESS_ONLY' | 'MOCK_NONE';

/** The per-assignment configuration frozen on every recipient row (teacher_interventions.subject_assessment_assignment). */
export interface SubjectAssessmentAssignmentConfig {
  version: 'teacher-subject-assessment-v1';
  kind: SubjectAssignmentKind;
  /** The class's canonical subject and the selected canonical concepts (group level). */
  subjectId: string;
  conceptIds: string[];
  allSubject: boolean;
  difficultyBand: DifficultyBand;
  /** planGroupAssessment over the canonical concepts: identical for every student (never per-student). */
  plan: { questionCount: number; distribution: Record<string, number>; rule: string };
  timing: { timed: boolean; durationMinutes: number | null; recommendedDurationMinutes: number | null; recommendationRule: string | null; durationSource: 'STUDYUS_RECOMMENDED' | 'TEACHER_ADJUSTED' | null;
    /** D70 (APPROVED 2026-10-17): untimed Teacher Test only; absent on older rows = false. */
    resumeAfterInactivity?: boolean };
  maxAttempts: number;
  window: AssignmentWindow;
  feedbackPolicy: FeedbackPolicy;
  feedbackRelease: 'DIVERSE_IMMEDIATE_ELSE_AT_CLOSE';
  /** Attempts link through quiz_sessions.subject_assessment_setup.assignmentId = this row's intervention id. */
  attemptLink: 'INTERVENTION_ID';
  /** Per recipient: the learner's own subject and concept ids for each canonical concept. */
  learner?: { subjectId: string; conceptIds: Record<string, string> };
  frozenAt: string;
}

// ------------------------------------------------------------------ time -----------------------------------------------------------------

/** The local calendar date (YYYY-MM-DD) of `now` in `tz`. */
export function localDateIn(tz: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export type WindowError = 'TIMEZONE_AUTHORITY_BLOCKER' | 'WINDOW_DATES_INVALID' | 'WINDOW_END_BEFORE_START' | 'WINDOW_ALREADY_CLOSED';

/**
 * Build the application window. `institutionTimezone` = institutions.timezone of the class's institution (the only
 * authority). Null / invalid -> TIMEZONE_AUTHORITY_BLOCKER (nothing is created). A window whose close is already past
 * is refused (it could never be taken).
 */
export function buildAssignmentWindow(input: { startDate: unknown; endDate: unknown }, institutionTimezone: string | null | undefined, now: Date, timezoneSource: AssignmentWindow['timezoneSource'] = 'INSTITUTION'): { ok: true; window: AssignmentWindow } | { ok: false; error: WindowError } {
  if (!isValidTimeZone(institutionTimezone)) return { ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER' };
  if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate)) return { ok: false, error: 'WINDOW_DATES_INVALID' };
  if (input.endDate < input.startDate) return { ok: false, error: 'WINDOW_END_BEFORE_START' };
  const opensAt = zonedWallTimeToUtc(input.startDate, 0, 0, institutionTimezone);
  const closesAt = zonedWallTimeToUtc(input.endDate, WINDOW_CLOSE_HOUR, WINDOW_CLOSE_MINUTE, institutionTimezone);
  if (closesAt.getTime() <= now.getTime()) return { ok: false, error: 'WINDOW_ALREADY_CLOSED' };
  return { ok: true, window: { startDate: input.startDate, endDate: input.endDate, timezone: institutionTimezone, timezoneSource, opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString() } };
}

/**
 * D71 (APPROVED 2026-10-17) -- the timezone authority of ONE recipient of a Teacher assignment: the Student's own
 * timezone (student_availability) first, even when the class's institution has another one; else the class's
 * institution (the single, deterministic applicable institution of a class assignment); else
 * TIMEZONE_AUTHORITY_BLOCKER. Never the browser's, never the server's, never a fixture default.
 */
export function recipientTimezoneAuthority(studentTimezone: string | null | undefined, classInstitutionTimezone: string | null | undefined): TimezoneAuthority {
  return resolveTimezoneAuthority(studentTimezone, classInstitutionTimezone ? [classInstitutionTimezone] : []);
}

/** The recipient's window: the group's dates at 00:00 / 21:00 in the recipient's authoritative timezone. */
export function recipientAssignmentWindow(group: Pick<AssignmentWindow, 'startDate' | 'endDate'>, tz: TimezoneAuthority, now: Date): { ok: true; window: AssignmentWindow } | { ok: false; error: WindowError } {
  if (!tz.ok) return { ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER' };
  return buildAssignmentWindow({ startDate: group.startDate, endDate: group.endDate }, tz.timezone, now, tz.source === 'STUDENT_AVAILABILITY' ? 'STUDENT_AVAILABILITY' : 'INSTITUTION');
}

export type WindowPhase = 'NOT_OPEN' | 'OPEN' | 'CLOSED';
export function windowPhase(window: Pick<AssignmentWindow, 'opensAt' | 'closesAt'>, now: Date): WindowPhase {
  if (now.getTime() < new Date(window.opensAt).getTime()) return 'NOT_OPEN';
  if (now.getTime() >= new Date(window.closesAt).getTime()) return 'CLOSED';
  return 'OPEN';
}

/** The calendar days the assessment is available on (startDate..endDate inclusive). */
export function windowDays(window: Pick<AssignmentWindow, 'startDate' | 'endDate'>): string[] {
  const out: string[] = [];
  const [y, m, d] = window.startDate.split('-').map(Number);
  for (let i = 0; i < 400; i++) {
    const n = new Date(Date.UTC(y, m - 1, d + i));
    const s = `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
    if (s > window.endDate) break;
    out.push(s);
  }
  return out;
}

// --------------------------------------------------------------- liveness ----------------------------------------------------------------

/** "The same continuous session": the last activity is within the liveness window of now. */
export function sessionAlive(lastActivityAt: Date | null, now: Date, windowSeconds = LIVENESS_WINDOW_SECONDS): boolean {
  return !!lastActivityAt && now.getTime() - lastActivityAt.getTime() <= windowSeconds * 1000;
}

/**
 * May this ACTIVE attempt be continued (resumed / answered / submitted) at `now`? Before the close: always (a left
 * attempt is resumed, no extra attempt). After the close: only while the session lives.
 */
export function attemptContinuable(closesAt: Date, lastActivityAt: Date | null, now: Date): { ok: true } | { ok: false; reason: 'WINDOW_CLOSED_AFTER_EXIT' } {
  if (now.getTime() < closesAt.getTime()) return { ok: true };
  return sessionAlive(lastActivityAt, now) ? { ok: true } : { ok: false, reason: 'WINDOW_CLOSED_AFTER_EXIT' };
}

// ---------------------------------------------------------------- attempts ---------------------------------------------------------------

export interface AttemptSummary {
  attemptNumber: number;
  quizId: string;
  /** ACTIVE (in progress), COMPLETED (graded), or ABANDONED (closed without a result: never counted as a result). */
  state: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  startedAt: string | null;
  completedAt: string | null;
  scorePercent: number | null;
  passed: boolean | null;
  completionReason?: string | null;
  lastActivityAt?: string | null;
}

/** The result = the LAST COMPLETED attempt (by completion time, then attempt number) -- never the best, never the average. */
export function latestCompletedAttempt<T extends AttemptSummary>(attempts: readonly T[]): T | null {
  const done = attempts.filter((a) => a.state === 'COMPLETED' && a.completedAt);
  if (done.length === 0) return null;
  return [...done].sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime() || a.attemptNumber - b.attemptNumber).at(-1)!;
}

export type AttemptDecision =
  | { action: 'RESUME'; quizId: string; attemptNumber: number }
  | { action: 'START'; attemptNumber: number }
  | { action: 'NONE'; reason: 'CANCELLED' | 'NOT_OPEN_YET' | 'WINDOW_CLOSED' | 'ATTEMPTS_EXHAUSTED' | 'WINDOW_CLOSED_AFTER_EXIT' };

/**
 * What the Student may do now. An active attempt is resumed (never a second one in parallel, never an extra attempt
 * consumed); after the close it continues only while its session lives. A new attempt needs the window OPEN and an
 * unused attempt (every started attempt counts, completed or not). Retry after a pass is allowed.
 */
export function decideAttemptAction(input: { cancelled: boolean; window: Pick<AssignmentWindow, 'opensAt' | 'closesAt'>; maxAttempts: number; attempts: readonly AttemptSummary[]; now: Date }): AttemptDecision {
  if (input.cancelled) return { action: 'NONE', reason: 'CANCELLED' };
  const active = input.attempts.find((a) => a.state === 'ACTIVE');
  const phase = windowPhase(input.window, input.now);
  if (active) {
    const c = attemptContinuable(new Date(input.window.closesAt), active.lastActivityAt ? new Date(active.lastActivityAt) : null, input.now);
    return c.ok ? { action: 'RESUME', quizId: active.quizId, attemptNumber: active.attemptNumber } : { action: 'NONE', reason: c.reason };
  }
  if (phase === 'NOT_OPEN') return { action: 'NONE', reason: 'NOT_OPEN_YET' };
  if (phase === 'CLOSED') return { action: 'NONE', reason: 'WINDOW_CLOSED' };
  const used = input.attempts.length === 0 ? 0 : Math.max(input.attempts.length, ...input.attempts.map((a) => a.attemptNumber));
  if (used >= input.maxAttempts) return { action: 'NONE', reason: 'ATTEMPTS_EXHAUSTED' };
  return { action: 'START', attemptNumber: used + 1 };
}

export type AssignmentEffectiveStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

/**
 * The assignment row's effective status (lazy, never a cron): CANCELLED stays; an attempt in progress -> IN_PROGRESS;
 * every attempt used, or the window closed, -> COMPLETED when a result exists, else EXPIRED; otherwise ASSIGNED (no
 * attempt yet) / IN_PROGRESS (a result exists and retries remain).
 */
export function effectiveAssignmentStatus(input: { storedStatus: string; window: Pick<AssignmentWindow, 'opensAt' | 'closesAt'>; maxAttempts: number; attempts: readonly AttemptSummary[]; now: Date }): AssignmentEffectiveStatus {
  if (input.storedStatus === 'CANCELLED') return 'CANCELLED';
  const hasResult = input.attempts.some((a) => a.state === 'COMPLETED');
  if (input.attempts.some((a) => a.state === 'ACTIVE')) return 'IN_PROGRESS';
  const exhausted = input.attempts.length >= input.maxAttempts;
  if (exhausted || windowPhase(input.window, input.now) === 'CLOSED') return hasResult ? 'COMPLETED' : 'EXPIRED';
  return input.attempts.length === 0 ? 'ASSIGNED' : 'IN_PROGRESS';
}

// ------------------------------------------------------------ feedback release -----------------------------------------------------------

/** The fingerprints served to MORE THAN ONE student of the assignment (a student's own repeats across attempts do not count). */
export function crossStudentSharedFingerprints(served: ReadonlyArray<{ studentId: string; fingerprints: readonly string[] }>): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const s of served) for (const fp of s.fingerprints) owners.set(fp, (owners.get(fp) ?? new Set()).add(s.studentId));
  return new Set([...owners.entries()].filter(([, o]) => o.size > 1).map(([fp]) => fp));
}

export type FeedbackRelease = { level: 'FULL'; reason: 'VERSIONS_DIVERSE' | 'WINDOW_CLOSED' } | { level: 'SCORE_ONLY'; reason: 'SHARED_ITEMS_HELD_UNTIL_CLOSE'; releaseAt: string };

/** AB: full immediately when the versions are truly diverse (no shared item), else score now and the rest at close. */
export function feedbackReleaseFor(input: { sharedItemCount: number; closesAt: string; now: Date }): FeedbackRelease {
  if (input.now.getTime() >= new Date(input.closesAt).getTime()) return { level: 'FULL', reason: 'WINDOW_CLOSED' };
  if (input.sharedItemCount === 0) return { level: 'FULL', reason: 'VERSIONS_DIVERSE' };
  return { level: 'SCORE_ONLY', reason: 'SHARED_ITEMS_HELD_UNTIL_CLOSE', releaseAt: input.closesAt };
}

// --------------------------------------------------------------- planning ----------------------------------------------------------------

/** The group plan keyed by canonical concept, re-keyed onto one learner's own concept ids (identical counts). */
export function planForLearner(plan: SubjectAssessmentAssignmentConfig['plan'], learnerConceptOf: Record<string, string>): { ok: true; plan: SubjectAssessmentAssignmentConfig['plan'] } | { ok: false; missing: string[] } {
  const missing = Object.keys(plan.distribution).filter((cc) => !learnerConceptOf[cc]);
  if (missing.length > 0) return { ok: false, missing };
  const distribution: Record<string, number> = {};
  for (const [cc, n] of Object.entries(plan.distribution)) distribution[learnerConceptOf[cc]] = n;
  return { ok: true, plan: { questionCount: plan.questionCount, distribution, rule: plan.rule } };
}

/** Group equivalence check: two plans have the same count, rule and per-concept counts under the concept mapping. */
export function plansEquivalent(a: { questionCount: number; distribution: Record<string, number>; rule: string }, b: { questionCount: number; distribution: Record<string, number>; rule: string }): boolean {
  if (a.questionCount !== b.questionCount || a.rule !== b.rule) return false;
  const av = Object.values(a.distribution).sort((x, y) => x - y);
  const bv = Object.values(b.distribution).sort((x, y) => x - y);
  return av.length === bv.length && av.every((v, i) => v === bv[i]);
}

/** Validate the teacher's timing for the kind (Mock always timed; a timed duration 1..600 whole minutes). */
export function validateTiming(kind: SubjectAssignmentKind, timing: { timed: boolean; durationMinutes: number | null }): { ok: true } | { ok: false; error: 'MOCK_MUST_BE_TIMED' | 'DURATION_INVALID' } {
  if (kind === 'MOCK' && !timing.timed) return { ok: false, error: 'MOCK_MUST_BE_TIMED' };
  if (timing.timed && timing.durationMinutes !== null && !(Number.isInteger(timing.durationMinutes) && timing.durationMinutes >= 1 && timing.durationMinutes <= 600)) return { ok: false, error: 'DURATION_INVALID' };
  return { ok: true };
}

/**
 * D70 (APPROVED 2026-10-17) -- `resumeAfterInactivity` exists only for a Teacher-assigned, UNTIMED subject TEST.
 * Default false. Mock and timed Test never carry it (a true value there is refused, never silently dropped).
 */
export const resumeAfterInactivityApplies = (kind: SubjectAssignmentKind, timed: boolean): boolean => kind === 'TEST' && !timed;
export function validateResumeAfterInactivity(kind: SubjectAssignmentKind, timed: boolean, value: boolean | undefined): { ok: true; value: boolean } | { ok: false; error: 'RESUME_AFTER_INACTIVITY_NOT_APPLICABLE' } {
  if (value === true && !resumeAfterInactivityApplies(kind, timed)) return { ok: false, error: 'RESUME_AFTER_INACTIVITY_NOT_APPLICABLE' };
  return { ok: true, value: value === true };
}

/**
 * Rule V + D70 for one Teacher-assigned attempt, decided on every read / answer / submit / heartbeat (pure):
 *   EXPIRED (an untimed attempt idle 45 min) before the close -> REVIVE only when resumeAfterInactivity, else CLOSE_AS_IS
 *     (saved progress graded and kept; the same attempt never resumes);
 *   EXPIRED after the close -> CLOSE_AS_IS (resumeAfterInactivity NEVER overrides the post-close rule);
 *   ACTIVE after the close -> continues while its session lives (liveSession), else CLOSE_AS_IS;
 *   anything else -> OK.
 */
export function decideAssignmentAttemptGate(input: { state: string; closed: boolean; resumeAfterInactivity: boolean; liveSession: boolean }): 'OK' | 'REVIVE' | 'CLOSE_AS_IS' {
  if (input.state === 'EXPIRED') return !input.closed && input.resumeAfterInactivity ? 'REVIVE' : 'CLOSE_AS_IS';
  if (input.state !== 'ACTIVE' || !input.closed) return 'OK';
  return input.liveSession ? 'OK' : 'CLOSE_AS_IS';
}

// ------------------------------------------------------------- group results -------------------------------------------------------------

/** Result distribution buckets -- a DISTRIBUTION for reading, not a policy (only the 80 pass mark is a rule). */
export const RESULT_BUCKETS = [
  { key: '0-59', min: 0, max: 59.99 },
  { key: '60-79', min: 60, max: 79.99 },
  { key: '80-100', min: 80, max: 100 },
] as const;

export function resultDistribution(scores: readonly number[]): Record<(typeof RESULT_BUCKETS)[number]['key'], number> {
  const out = { '0-59': 0, '60-79': 0, '80-100': 0 };
  for (const s of scores) out[s >= 80 ? '80-100' : s >= 60 ? '60-79' : '0-59']++;
  return out;
}

export interface StudentLatestReport {
  studentId: string;
  scorePercent: number;
  perConcept: Array<{ conceptKey: string; total: number; correct: number; unanswered: number }>;
  items: Array<{ conceptKey: string; questionKey: string; status: 'CORRECT' | 'INCORRECT' | 'UNANSWERED' }>;
  /** The attempt's knowledge bucket (knowledge-bucket.ts; null = the unclassified edge case). */
  knowledgeBucket?: KnowledgeBucket | null;
}

/**
 * The group read model over each student's LATEST COMPLETED attempt: average, distribution, per-concept performance
 * (pooled correct / total), strongest concepts and largest gaps, and high-error questions (a question shared by several
 * students, or a concept area when every version differs). `conceptKey` = the canonical concept id.
 */
export function aggregateGroup(reports: readonly StudentLatestReport[], opts: { highErrorMinRate?: number } = {}) {
  const minRate = opts.highErrorMinRate ?? 0.5;
  const scores = reports.map((r) => r.scorePercent);
  const average = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
  const concepts = new Map<string, { total: number; correct: number; unanswered: number; students: number }>();
  for (const r of reports) for (const c of r.perConcept) {
    const x = concepts.get(c.conceptKey) ?? { total: 0, correct: 0, unanswered: 0, students: 0 };
    x.total += c.total; x.correct += c.correct; x.unanswered += c.unanswered; x.students++;
    concepts.set(c.conceptKey, x);
  }
  const perConcept = [...concepts.entries()].map(([conceptKey, x]) => {
    const scorePercent = x.total ? Math.round((x.correct / x.total) * 1000) / 10 : 0;
    return { conceptKey, ...x, scorePercent, passed: subjectAssessmentPassed(scorePercent), errorRate: x.total ? Math.round(((x.total - x.correct) / x.total) * 1000) / 1000 : 0 };
  });
  const byScore = [...perConcept].sort((a, b) => b.scorePercent - a.scorePercent || a.conceptKey.localeCompare(b.conceptKey));
  const questions = new Map<string, { conceptKey: string; served: number; wrong: number }>();
  for (const r of reports) for (const it of r.items) {
    const q = questions.get(it.questionKey) ?? { conceptKey: it.conceptKey, served: 0, wrong: 0 };
    q.served++; if (it.status !== 'CORRECT') q.wrong++;
    questions.set(it.questionKey, q);
  }
  const highErrorQuestions = [...questions.entries()]
    .filter(([, q]) => q.served >= 2 && q.wrong / q.served >= minRate)
    .map(([questionKey, q]) => ({ questionKey, conceptKey: q.conceptKey, served: q.served, wrong: q.wrong, errorRate: Math.round((q.wrong / q.served) * 1000) / 1000 }))
    .sort((a, b) => b.errorRate - a.errorRate || b.served - a.served);
  const highErrorAreas = perConcept.filter((c) => c.errorRate >= minRate).sort((a, b) => b.errorRate - a.errorRate).map((c) => ({ conceptKey: c.conceptKey, errorRate: c.errorRate }));
  return {
    completedStudents: reports.length,
    averageScorePercent: average,
    distribution: resultDistribution(scores),
    passedCount: scores.filter((s) => subjectAssessmentPassed(s)).length,
    perConcept,
    strongestConcepts: byScore.filter((c) => c.passed).slice(0, 3).map((c) => c.conceptKey),
    largestGaps: [...byScore].reverse().filter((c) => !c.passed).slice(0, 3).map((c) => c.conceptKey),
    highErrorQuestions,
    highErrorAreas,
    /** Diagnostic: how many latest completed attempts fall in each knowledge bucket (B1..B4, INSUFFICIENT_DIFFICULTY_EVIDENCE). */
    bucketDistribution: bucketDistribution(reports.map((r) => r.knowledgeBucket ?? null)),
  };
}
