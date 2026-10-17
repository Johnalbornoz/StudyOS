/**
 * Subject Test ("Prueba por materia") / Subject Mock ("Simulacro por materia") -- lifecycle rules (pure, no IO).
 *
 * Operator rules (overnight pilot, 2026-10-16; contract docs/orchestration/OVERNIGHT_2026-10-16_CONTRACTS.md section 2):
 *   - StudyUs decides count, distribution and difficulty (sizing.ts); the Student only picks concepts and NOW / SCHEDULE.
 *   - The configuration is frozen before the attempt (`SubjectAssessmentSetup`, quiz_sessions.subject_assessment_setup).
 *   - Student-created: ONE attempt. NOW starts immediately. SCHEDULED may be started early; once started it is active;
 *     if it is not started by the selected date it EXPIRES at 21:00 of that date in the AUTHORITATIVE timezone
 *     (APPROVED 2026-10-17): student_availability.timezone, else the timezone of the Student's institution (active
 *     class enrollment -> classes.institution_id -> institutions.timezone, exactly one distinct value). No authority
 *     -> SCHEDULED is refused with TIMEZONE_AUTHORITY_BLOCKER (never a browser / UTC guess); NOW still works.
 *   - Feedback: Test = correct / incorrect only after each answer; Mock = none during the attempt; both = full final
 *     feedback.
 *   - Timing: Mock ALWAYS timed, duration = sum of the frozen items' nominal response seconds (adjusted by each item's
 *     difficulty) rounded up to minutes (rule NOMINAL_RESPONSE_TIME_SUM, APPROVED 2026-10-17). Before items exist a
 *     planning estimate over the planned levels may be shown. The recommendation is advisory: a Teacher-chosen duration
 *     is authoritative and frozen in the setup (never overwritten). Student Test untimed: it closes after 45 minutes
 *     without saved activity (APPROVED 2026-10-17), saved responses kept, no resume. Wall clock from startedAt; a
 *     lost connection never pauses it; at zero the attempt is submitted (answered graded, unanswered in the denominator).
 *   - Pass >= 80 inclusive (sizing.ts subjectAssessmentPassed).
 */
import { nominalResponseSeconds } from '@/lib/assessment-foundation/nominal-response-time';
import { SUBJECT_ASSESSMENT_MAX_QUESTIONS, subjectAssessmentPassed, subjectAssessmentScorePercent } from './sizing';

export type SubjectAssessmentKind = 'TEST' | 'MOCK';
export type SubjectAssessmentOrigin = 'STUDENT' | 'TEACHER';
export type SubjectAssessmentSetupKind = 'SUBJECT_CUMULATIVE_TEST' | 'SUBJECT_MOCK_EXAM';
/** APPROVED 2026-10-17: BASIC = level 2, INTERMEDIATE = 3, ADVANCED = 4, MIXED = 30 / 50 / 20 of the question count. */
export type DifficultyBand = 'BASIC' | 'INTERMEDIATE' | 'ADVANCED' | 'MIXED';
/** Names written by the 2026-10-16 build (still present in frozen jsonb rows): read, never written. */
export type LegacyDifficultyBand = 'LOW' | 'MEDIUM' | 'HIGH';
export const LEGACY_DIFFICULTY_BAND_ALIAS: Record<LegacyDifficultyBand, DifficultyBand> = { LOW: 'BASIC', MEDIUM: 'INTERMEDIATE', HIGH: 'ADVANCED' };
export const DIFFICULTY_BANDS: readonly DifficultyBand[] = ['BASIC', 'INTERMEDIATE', 'ADVANCED', 'MIXED'];
/** Read a band from any source (new name, legacy name): the new name, or null when it is neither. */
export function normalizeDifficultyBand(x: unknown): DifficultyBand | null {
  if (typeof x !== 'string') return null;
  if ((DIFFICULTY_BANDS as readonly string[]).includes(x)) return x as DifficultyBand;
  return (LEGACY_DIFFICULTY_BAND_ALIAS as Record<string, DifficultyBand>)[x] ?? null;
}
export type FeedbackPolicy = 'TEST_CORRECTNESS_ONLY' | 'MOCK_NONE';

export const SETUP_KIND_OF: Record<SubjectAssessmentKind, SubjectAssessmentSetupKind> = { TEST: 'SUBJECT_CUMULATIVE_TEST', MOCK: 'SUBJECT_MOCK_EXAM' };
export const QUIZ_MODE_OF: Record<SubjectAssessmentKind, 'cumulative_assessment' | 'exam_simulation'> = { TEST: 'cumulative_assessment', MOCK: 'exam_simulation' };
export const kindOfQuizMode = (mode: string): SubjectAssessmentKind | null => (mode === 'cumulative_assessment' ? 'TEST' : mode === 'exam_simulation' ? 'MOCK' : null);
export const feedbackPolicyFor = (kind: SubjectAssessmentKind): FeedbackPolicy => (kind === 'TEST' ? 'TEST_CORRECTNESS_ONLY' : 'MOCK_NONE');

/** Student-created assessments allow exactly one attempt (operator). */
export const STUDENT_MAX_ATTEMPTS = 1;
/** A timed attempt's submission may arrive this long after the deadline (transport only; answers saved after the deadline never count). */
export const SUBJECT_SUBMIT_GRACE_SECONDS = 120;
/**
 * An untimed attempt's inactivity window (APPROVED 2026-10-17): 45 minutes, reset by every saved answer. Past it the
 * attempt is closed (EXPIRED), its saved responses are kept, and it cannot be resumed.
 */
export const SUBJECT_UNTIMED_INACTIVITY_MINUTES = 45;
/** @deprecated name kept for callers: the untimed inactivity window. */
export const SUBJECT_NOW_MIN_WINDOW_MINUTES = SUBJECT_UNTIMED_INACTIVITY_MINUTES;
/** A self-scheduled assessment not started by its date expires at this local wall time of that date (APPROVED 2026-10-17). */
export const SELF_SCHEDULED_EXPIRY_HOUR = 21;
export const SELF_SCHEDULED_EXPIRY_MINUTE = 0;
export const MOCK_DURATION_RULE = 'NOMINAL_RESPONSE_TIME_SUM' as const;

export type ScheduleSpec = { mode: 'NOW' } | { mode: 'SCHEDULED'; date: string; timezone: string; expiresAt: string };
export interface TimingSpec {
  timed: boolean;
  durationMinutes: number | null;
  startedAt?: string;
  deadlineAt?: string;
  durationRule?: string;
}

/** The frozen configuration (contract section 2 shape, plus additive audit fields). */
export interface SubjectAssessmentSetup {
  version: 'subject-assessment-v2';
  kind: SubjectAssessmentSetupKind;
  origin: SubjectAssessmentOrigin;
  assignmentId?: string;
  attemptNumber?: number;
  quizMode: 'cumulative_assessment' | 'exam_simulation';
  subjectId: string;
  selectedConceptIds: string[];
  questionCount: number;
  distribution: Record<string, number>;
  rule: string;
  difficulty: { mode: 'AUTO' } | { band: DifficultyBand };
  schedule: ScheduleSpec;
  timing: TimingSpec;
  feedbackPolicy: FeedbackPolicy;
  maxAttempts?: number;
  frozenAt: string;
  /**
   * Where the timezone authority came from (null: none -- only a NOW assessment can exist without one). The legacy
   * values BROWSER_ASSUMED / DEFAULT_UTC_ASSUMED may appear on rows frozen before 2026-10-17; they are never written.
   */
  timezoneSource?: TimezoneSource | 'BROWSER_ASSUMED' | 'DEFAULT_UTC_ASSUMED' | null;
  /** Explicit band: the per-concept level plan the items were generated at (assignLevelsAcrossConcepts). */
  difficultyPlan?: { counts: Record<'BASIC' | 'INTERMEDIATE' | 'ADVANCED', number>; perConcept: Record<string, Array<{ level: number; count: number }>>; method: string };
  /** Test only: the Knowledge State signal per concept that sized the plan (STUDENT origin). */
  knowledgeSignals?: Record<string, { needsReinforcement: boolean; reasons: string[] }>;
  /** Mock only: the operator band and whether the selection is the whole subject. */
  mockBand?: string;
  allSubject?: boolean;
  /** The per-concept blueprint of the generated items (must equal `distribution`). */
  blueprint: Record<string, number>;
  /**
   * Items served although the Student had seen them before (supply short of novel items), recorded, never silent.
   * `source` / `lastServedAt` (teacher assignments): which pool the reused item came from -- the Student's own older
   * items first (least recently used), then items served to other students of the assignment, the immediately previous
   * attempt last.
   */
  reusedItems: Array<{ conceptId: string; fingerprint: string; source?: ReuseSource; lastServedAt?: string | null }>;
  priorFingerprintCount: number;
  /** Teacher assignment attempts: the assignment window close (operator rule V) -- frozen at the attempt's creation. */
  assignmentWindow?: { closesAt: string };
  /** Teacher assignment attempts: the last runner activity (heartbeat), for the "same continuous session" rule. */
  liveness?: { lastActivityAt: string };
  /** Set when the attempt is closed. */
  completion?: { completedAt: string; reason: CompletionReason; scorePercent: number; passed: boolean; knowledge?: import('./knowledge-bucket').KnowledgeProfile };
}

export type TimezoneSource = 'STUDENT_AVAILABILITY' | 'INSTITUTION';

export type ReuseSource = 'OWN_LEAST_RECENTLY_USED' | 'ASSIGNMENT_GROUP' | 'PREVIOUS_ATTEMPT';
/** WINDOW_CLOSED_AFTER_EXIT: a teacher-assigned attempt left before / across the window close, closed as is. */
export type CompletionReason = 'SUBMITTED' | 'TIME_UP_AUTO_SUBMIT' | 'WINDOW_CLOSED_AFTER_EXIT';

/**
 * Controlled reuse order (operator rule T): a candidate the Student has seen is ranked by its pool -- the Student's own
 * older items (OWN_LEAST_RECENTLY_USED), then items served to other students of the same assignment
 * (ASSIGNMENT_GROUP), and the immediately previous attempt's items last (PREVIOUS_ATTEMPT) -- and inside a pool by
 * least recently used (never served = oldest).
 */
export function rankReuseCandidates<T extends { fingerprint: string }>(candidates: readonly T[], ctx: { previousAttempt: ReadonlySet<string>; group: ReadonlySet<string>; lastServedMs: ReadonlyMap<string, number> }): Array<T & { source: ReuseSource; lastServedMs: number | null }> {
  const tier = (fp: string): ReuseSource => (ctx.previousAttempt.has(fp) ? 'PREVIOUS_ATTEMPT' : ctx.lastServedMs.has(fp) ? 'OWN_LEAST_RECENTLY_USED' : ctx.group.has(fp) ? 'ASSIGNMENT_GROUP' : 'OWN_LEAST_RECENTLY_USED');
  const order: Record<ReuseSource, number> = { OWN_LEAST_RECENTLY_USED: 0, ASSIGNMENT_GROUP: 1, PREVIOUS_ATTEMPT: 2 };
  return candidates
    .map((c, i) => ({ ...c, source: tier(c.fingerprint), lastServedMs: ctx.lastServedMs.get(c.fingerprint) ?? null, i }))
    .sort((a, b) => order[a.source] - order[b.source] || (a.lastServedMs ?? -Infinity) - (b.lastServedMs ?? -Infinity) || a.i - b.i)
    .map(({ i: _i, ...rest }) => rest as T & { source: ReuseSource; lastServedMs: number | null });
}

// ----------------------------------------------------------------- timezone --------------------------------------------------------------

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `tz` at instant `utcMs`: local wall time - UTC. */
function tzOffsetMs(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The UTC instant of local wall time `hour:minute` on `date` in `tz` (DST-safe: the offset is the one in force at that
 * local time, found by two Intl iterations). A wall time inside a spring-forward gap resolves to the instant after the
 * gap; an ambiguous fall-back time resolves to its first occurrence.
 */
export function zonedWallTimeToUtc(date: string, hour: number, minute: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let t = guess - tzOffsetMs(tz, guess);
  t = guess - tzOffsetMs(tz, t);
  return new Date(t);
}

/** A self-scheduled assessment's expiry: 21:00 of the selected date in the authoritative timezone (APPROVED 2026-10-17). */
export function selfScheduledExpiryUtc(date: string, tz: string): Date {
  return zonedWallTimeToUtc(date, SELF_SCHEDULED_EXPIRY_HOUR, SELF_SCHEDULED_EXPIRY_MINUTE, tz);
}

/** The local calendar date (YYYY-MM-DD) of `now` in `tz`. */
export function localDateIn(tz: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export type TimezoneAuthority =
  | { ok: true; timezone: string; source: TimezoneSource }
  | { ok: false; error: 'TIMEZONE_AUTHORITY_BLOCKER'; reason: 'NO_TIMEZONE_AUTHORITY' | 'INSTITUTION_TIMEZONES_CONFLICT' };

/**
 * The authoritative timezone of a Student (APPROVED 2026-10-17): student_availability.timezone first; else the
 * timezone of the Student's institution (`institutionTimezones` = the distinct institutions.timezone values of the
 * Student's ACTIVE class enrollments) when exactly one valid value exists. Several different institution timezones
 * are a conflict, not a choice. Nothing found -> TIMEZONE_AUTHORITY_BLOCKER: never the browser's, never UTC.
 */
export function resolveTimezoneAuthority(studentTz: string | null | undefined, institutionTimezones: ReadonlyArray<string | null | undefined> = []): TimezoneAuthority {
  if (isValidTimeZone(studentTz)) return { ok: true, timezone: studentTz, source: 'STUDENT_AVAILABILITY' };
  const valid = [...new Set(institutionTimezones.filter(isValidTimeZone))];
  if (valid.length === 1) return { ok: true, timezone: valid[0], source: 'INSTITUTION' };
  return { ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER', reason: valid.length > 1 ? 'INSTITUTION_TIMEZONES_CONFLICT' : 'NO_TIMEZONE_AUTHORITY' };
}

export type ScheduleError = 'SCHEDULE_DATE_INVALID' | 'SCHEDULE_DATE_IN_PAST' | 'TIMEZONE_AUTHORITY_BLOCKER';

/**
 * NOW needs no timezone. SCHEDULED needs the timezone authority (`tz` null -> TIMEZONE_AUTHORITY_BLOCKER) and a date
 * whose 21:00 local expiry is still ahead (today before 21:00, or a later date).
 */
export function buildSchedule(input: { mode: 'NOW' } | { mode: 'SCHEDULED'; date: string }, tz: string | null, now: Date): { ok: true; schedule: ScheduleSpec } | { ok: false; error: ScheduleError } {
  if (input.mode === 'NOW') return { ok: true, schedule: { mode: 'NOW' } };
  if (!isIsoDate(input.date)) return { ok: false, error: 'SCHEDULE_DATE_INVALID' };
  if (!isValidTimeZone(tz)) return { ok: false, error: 'TIMEZONE_AUTHORITY_BLOCKER' };
  if (input.date < localDateIn(tz, now)) return { ok: false, error: 'SCHEDULE_DATE_IN_PAST' };
  const expiresAt = selfScheduledExpiryUtc(input.date, tz);
  if (expiresAt.getTime() <= now.getTime()) return { ok: false, error: 'SCHEDULE_DATE_IN_PAST' };
  return { ok: true, schedule: { mode: 'SCHEDULED', date: input.date, timezone: tz, expiresAt: expiresAt.toISOString() } };
}

// ------------------------------------------------------------------ timing ---------------------------------------------------------------

/** Items as frozen: question type and difficulty (1-5) -- the two facts nominal-response-time reads. */
export interface TimedItem { type: string | null | undefined; difficulty: number | null | undefined }

/**
 * Mock duration recommendation (APPROVED 2026-10-17): the sum of the frozen items' nominal response seconds, rounded
 * UP to whole minutes -- assessment-foundation/nominal-response-time.ts, which adjusts each item's base time by its
 * difficulty (factor 0.75 / 0.85 / 1 / 1.25 / 1.5 for levels 1-5). The caller passes each item's planned level (the
 * level it was generated at) as `difficulty`. A difficulty is clamped to the 1-5 scale before the lookup; an item that
 * still cannot be planned is counted in `unplannedItems` (never silently zero). Advisory only: a Teacher-chosen
 * duration is authoritative and frozen.
 */
export function recommendedMockDurationMinutes(items: readonly TimedItem[]): { minutes: number; totalSeconds: number; unplannedItems: number; rule: typeof MOCK_DURATION_RULE } {
  let total = 0;
  let unplanned = 0;
  for (const it of items) {
    const d = typeof it.difficulty === 'number' && Number.isFinite(it.difficulty) ? Math.min(5, Math.max(1, Math.round(it.difficulty))) : null;
    const s = nominalResponseSeconds(it.type ?? null, d);
    if (s === null) unplanned++;
    else total += s;
  }
  return { minutes: Math.ceil(total / 60), totalSeconds: total, unplannedItems: unplanned, rule: MOCK_DURATION_RULE };
}

/** Student-created timing: Mock always timed (nominal sum), Test untimed. */
export function studentTimingFor(kind: SubjectAssessmentKind, items: readonly TimedItem[]): TimingSpec {
  if (kind === 'TEST') return { timed: false, durationMinutes: null };
  const rec = recommendedMockDurationMinutes(items);
  return { timed: true, durationMinutes: Math.max(1, rec.minutes), durationRule: rec.rule };
}

/** When the attempt starts: the wall-clock deadline (never paused). */
export function startTiming(timing: TimingSpec, startedAt: Date): TimingSpec {
  const started: TimingSpec = { ...timing, startedAt: startedAt.toISOString() };
  if (timing.timed && timing.durationMinutes) started.deadlineAt = new Date(startedAt.getTime() + timing.durationMinutes * 60_000).toISOString();
  return started;
}

/**
 * The session's own expiry (quiz_sessions.expires_at) -- never the ordinary TTL counted from creation:
 *   not started + SCHEDULED -> 21:00 of the selected date in the authoritative timezone (frozen in schedule.expiresAt)
 *   started + timed         -> deadline + grace (the deadline itself is the wall clock from startedAt)
 *   started + untimed       -> `now` (the last saved activity: start or a saved answer) + 45 min (APPROVED
 *                              2026-10-17): each saved answer resets it; past it the attempt is closed, its saved
 *                              responses kept, no resume
 */
export function sessionExpiresAt(setup: Pick<SubjectAssessmentSetup, 'schedule' | 'timing'>, now: Date): Date {
  const { schedule, timing } = setup;
  if (!timing.startedAt) {
    if (schedule.mode === 'SCHEDULED') return new Date(schedule.expiresAt);
    return new Date(now.getTime() + SUBJECT_UNTIMED_INACTIVITY_MINUTES * 60_000);
  }
  if (timing.timed && timing.deadlineAt) return new Date(new Date(timing.deadlineAt).getTime() + SUBJECT_SUBMIT_GRACE_SECONDS * 1000);
  return new Date(now.getTime() + SUBJECT_UNTIMED_INACTIVITY_MINUTES * 60_000);
}

export type LifecycleState = 'SCHEDULED_NOT_STARTED' | 'ACTIVE' | 'TIME_UP' | 'EXPIRED' | 'COMPLETED';

/**
 * The attempt's state at `now`. TIME_UP = a timed attempt past its deadline that is not closed yet: it must be
 * auto-submitted (on the next read / submit). EXPIRED = a scheduled assessment not completed on its date, or an untimed
 * attempt past its window: no evidence.
 */
export function lifecycleState(setup: Pick<SubjectAssessmentSetup, 'schedule' | 'timing'>, status: string, expiresAt: Date, now: Date): LifecycleState {
  if (status === 'completed') return 'COMPLETED';
  const { timing } = setup;
  if (timing.startedAt && timing.timed && timing.deadlineAt && now.getTime() >= new Date(timing.deadlineAt).getTime()) return 'TIME_UP';
  if (status === 'expired' || now.getTime() >= expiresAt.getTime()) return 'EXPIRED';
  return timing.startedAt ? 'ACTIVE' : 'SCHEDULED_NOT_STARTED';
}

export function remainingSeconds(timing: TimingSpec, now: Date): number | null {
  if (!timing.timed || !timing.deadlineAt) return null;
  return Math.max(0, Math.ceil((new Date(timing.deadlineAt).getTime() - now.getTime()) / 1000));
}

/** An answer counts only when it was saved before the deadline (+ no grace: the grace is transport for the submit). */
export function answerCountsAt(timing: TimingSpec, answeredAt: Date): boolean {
  if (!timing.timed || !timing.deadlineAt) return true;
  return answeredAt.getTime() <= new Date(timing.deadlineAt).getTime();
}

// ------------------------------------------------------------ knowledge state ------------------------------------------------------------

/** The Knowledge State facts the Test plan reads (services/knowledge-state.service.ts ConceptKnowledgeState). */
export interface KnowledgeStateFacts {
  masteryState: string;
  understandingScore: number | null;
  activeMisconceptionCount: number;
  criticalMisconceptionCount: number;
  evidenceCount: number;
  validationReadiness: string;
}

/**
 * needsReinforcement (operator: "weaker mastery / recent errors / IN PROCESS / insufficient evidence / validation
 * needed"), mapped onto the existing concept_knowledge_state facts:
 *   NO_KNOWLEDGE_STATE            no row (never assessed)                     -> insufficient evidence
 *   IN_PROCESS                    masteryState UNKNOWN / LEARNING / DEVELOPING -> in process
 *   AT_RISK                       masteryState AT_RISK / INTERVENTION_REQUIRED -> weaker mastery / recent errors
 *   VALIDATION_NEEDED             masteryState PROVISIONAL_MASTERY            -> validation needed
 *   INSUFFICIENT_EVIDENCE         validationReadiness INSUFFICIENT_EVIDENCE or evidenceCount < minimumEvidenceCount
 *   ACTIVE_MISCONCEPTION          activeMisconceptionCount > 0 or criticalMisconceptionCount > 0 -> recent errors
 *   UNDERSTANDING_BELOW_POLICY    understandingScore < policy minimumUnderstanding (80) -> weaker mastery
 * A VALIDATED_MASTERY concept with none of these does not need reinforcement.
 */
export function conceptNeedsReinforcement(ks: KnowledgeStateFacts | null, policy: { minimumUnderstanding: number; minimumEvidenceCount: number }): { needsReinforcement: boolean; reasons: string[] } {
  if (!ks) return { needsReinforcement: true, reasons: ['NO_KNOWLEDGE_STATE'] };
  const reasons: string[] = [];
  if (['UNKNOWN', 'LEARNING', 'DEVELOPING'].includes(ks.masteryState)) reasons.push('IN_PROCESS');
  if (['AT_RISK', 'INTERVENTION_REQUIRED'].includes(ks.masteryState)) reasons.push('AT_RISK');
  if (ks.masteryState === 'PROVISIONAL_MASTERY') reasons.push('VALIDATION_NEEDED');
  if (ks.validationReadiness === 'INSUFFICIENT_EVIDENCE' || ks.evidenceCount < policy.minimumEvidenceCount) reasons.push('INSUFFICIENT_EVIDENCE');
  if (ks.activeMisconceptionCount > 0 || ks.criticalMisconceptionCount > 0) reasons.push('ACTIVE_MISCONCEPTION');
  if (ks.understandingScore !== null && ks.understandingScore < policy.minimumUnderstanding) reasons.push('UNDERSTANDING_BELOW_POLICY');
  return { needsReinforcement: reasons.length > 0, reasons };
}

// ------------------------------------------------------------- plans / bands -------------------------------------------------------------

export interface ExplicitPlan { questionCount: number; distribution: Record<string, number>; rule: string }

/** A TEACHER (or any explicit) plan must cover every concept, sum to its count, and stay within 1..50. */
export function validateExplicitPlan(plan: ExplicitPlan, conceptIds: readonly string[]): { ok: true } | { ok: false; error: string } {
  const keys = Object.keys(plan.distribution);
  if (!Number.isInteger(plan.questionCount) || plan.questionCount < 1 || plan.questionCount > SUBJECT_ASSESSMENT_MAX_QUESTIONS) return { ok: false, error: 'PLAN_COUNT_OUT_OF_RANGE' };
  if (keys.some((k) => !conceptIds.includes(k))) return { ok: false, error: 'PLAN_CONCEPT_NOT_SELECTED' };
  if (conceptIds.some((c) => !(plan.distribution[c] >= 1))) return { ok: false, error: 'PLAN_CONCEPT_UNCOVERED' };
  if (Object.values(plan.distribution).some((n) => !Number.isInteger(n) || n < 1)) return { ok: false, error: 'PLAN_DISTRIBUTION_INVALID' };
  if (Object.values(plan.distribution).reduce((a, b) => a + b, 0) !== plan.questionCount) return { ok: false, error: 'PLAN_DISTRIBUTION_SUM_MISMATCH' };
  return { ok: true };
}

/**
 * Explicit difficulty band -> generator difficulty levels (1-5 scale), APPROVED 2026-10-17: BASIC = 2,
 * INTERMEDIATE = 3, ADVANCED = 4; MIXED = all three in the MIXED_SHARE proportions (30 / 50 / 20).
 */
export const DIFFICULTY_LEVEL_OF = { BASIC: 2, INTERMEDIATE: 3, ADVANCED: 4 } as const;
export type DifficultyLevelName = keyof typeof DIFFICULTY_LEVEL_OF;
export const DIFFICULTY_BAND_LEVELS: Record<DifficultyBand, number[]> = { BASIC: [2], INTERMEDIATE: [3], ADVANCED: [4], MIXED: [2, 3, 4] };
/** MIXED / Balanced shares in percent of the question count (APPROVED 2026-10-17). */
export const MIXED_SHARE_PERCENT: Record<DifficultyLevelName, number> = { BASIC: 30, INTERMEDIATE: 50, ADVANCED: 20 };
/** Remainder / tie preference: Intermediate first, so Intermediate stays the largest share. */
const MIXED_TIE_ORDER: readonly DifficultyLevelName[] = ['INTERMEDIATE', 'BASIC', 'ADVANCED'];
export const DIFFICULTY_PLAN_METHOD = 'LARGEST_REMAINDER_30_50_20_INTERMEDIATE_FIRST:EVEN_SPREAD_OVER_ROUND_ROBIN_SLOTS' as const;

/**
 * MIXED counts for `count` questions: largest-remainder (Hamilton) over 30 / 50 / 20 percent in integer arithmetic,
 * the total exact; remainder seats go to the largest fractional parts, ties broken Intermediate > Basic > Advanced; then
 * Intermediate is guaranteed to be at least as large as each other level (a seat moves to it if a tiny count left it
 * behind). 4 -> 1/2/1, 5 -> 1/3/1, 10 -> 3/5/2, 14 -> 4/7/3, 36 -> 11/18/7, 50 -> 15/25/10.
 */
export function mixedLevelCounts(count: number): Record<DifficultyLevelName, number> {
  const n = Math.max(0, Math.floor(count));
  const out: Record<DifficultyLevelName, number> = { BASIC: 0, INTERMEDIATE: 0, ADVANCED: 0 };
  const rem: Record<DifficultyLevelName, number> = { BASIC: 0, INTERMEDIATE: 0, ADVANCED: 0 };
  for (const k of MIXED_TIE_ORDER) { out[k] = Math.floor((n * MIXED_SHARE_PERCENT[k]) / 100); rem[k] = (n * MIXED_SHARE_PERCENT[k]) % 100; }
  let left = n - out.BASIC - out.INTERMEDIATE - out.ADVANCED;
  const order = [...MIXED_TIE_ORDER].sort((a, b) => rem[b] - rem[a] || MIXED_TIE_ORDER.indexOf(a) - MIXED_TIE_ORDER.indexOf(b));
  for (let i = 0; left > 0; i++, left--) out[order[i % order.length]]++;
  for (const k of ['BASIC', 'ADVANCED'] as const) while (out[k] > out.INTERMEDIATE) { out[k]--; out.INTERMEDIATE++; }
  return out;
}

/** The level counts of a band for `count` questions (only non-zero), lowest level first. */
export function bandLevelCounts(band: DifficultyBand, count: number): Array<{ level: number; count: number }> {
  if (band !== 'MIXED') return count > 0 ? [{ level: DIFFICULTY_LEVEL_OF[band], count }] : [];
  const c = mixedLevelCounts(count);
  return (['BASIC', 'INTERMEDIATE', 'ADVANCED'] as const).map((k) => ({ level: DIFFICULTY_LEVEL_OF[k], count: c[k] })).filter((x) => x.count > 0);
}

/**
 * Deterministic level assignment across concepts (APPROVED band table). Method (DIFFICULTY_PLAN_METHOD):
 *   1. the session's level counts = bandLevelCounts(band, total) -- MIXED is exact over the whole assessment, not per
 *      concept;
 *   2. the items are laid out as round-robin slots over the concepts in the plan's order (round 0: one slot per
 *      concept, round 1: one per concept with >= 2 items, ...), the same interleaving the runner shows;
 *   3. a level sequence of the same length spreads every level evenly: the j-th item of a level with k items sits at
 *      position (2j + 1) / 2k, merged in position order (exact integer comparison; ties Intermediate > Basic >
 *      Advanced);
 *   4. slot i takes the i-th level of the sequence.
 * Returns concept id -> [{ level, count }] (lowest level first, only non-zero); the per-concept sums equal the plan.
 */
export function assignLevelsAcrossConcepts(distribution: Record<string, number>, band: DifficultyBand): Record<string, Array<{ level: number; count: number }>> {
  const concepts = Object.keys(distribution).filter((c) => distribution[c] > 0);
  const total = concepts.reduce((a, c) => a + distribution[c], 0);
  const slots: string[] = [];
  for (let r = 0; slots.length < total; r++) for (const c of concepts) if (distribution[c] > r) slots.push(c);
  const tieRank = (level: number) => MIXED_TIE_ORDER.findIndex((k) => DIFFICULTY_LEVEL_OF[k] === level);
  const seq = bandLevelCounts(band, total)
    .flatMap(({ level, count }) => Array.from({ length: count }, (_, j) => ({ level, num: 2 * j + 1, den: 2 * count })))
    .sort((a, b) => a.num * b.den - b.num * a.den || tieRank(a.level) - tieRank(b.level))
    .map((x) => x.level);
  const out: Record<string, Map<number, number>> = {};
  slots.forEach((c, i) => { const m = (out[c] ??= new Map()); m.set(seq[i], (m.get(seq[i]) ?? 0) + 1); });
  return Object.fromEntries(concepts.map((c) => [c, [...(out[c] ?? new Map()).entries()].sort((a, b) => a[0] - b[0]).map(([level, count]) => ({ level, count }))]));
}

/** Split `count` questions over `levels` round-robin -> [{ level, count }] (only non-zero). */
export function splitByLevels(count: number, levels: readonly number[]): Array<{ level: number; count: number }> {
  const out = levels.map((level) => ({ level, count: 0 }));
  for (let i = 0; i < count; i++) out[i % out.length].count++;
  return out.filter((x) => x.count > 0);
}

// ------------------------------------------------------------- final report --------------------------------------------------------------

export interface GradedItem {
  questionIndex: number;
  conceptId: string;
  /** null = UNANSWERED (counts 0 in the denominator). */
  correct: boolean | null;
  /** 0..1 partial credit when answered; ignored when unanswered. */
  score: number | null;
}

export interface ConceptPerformance { conceptId: string; total: number; correct: number; incorrect: number; unanswered: number; scorePercent: number; passed: boolean }

/**
 * Score with UNANSWERED in the denominator (subjectAssessmentScorePercent), per concept and overall; pass >= 80
 * inclusive; concepts to reinforce = the concepts below the pass mark.
 */
export function buildSubjectReport(items: readonly GradedItem[]): {
  total: number; correct: number; incorrect: number; unanswered: number; scorePercent: number; passed: boolean;
  perConcept: ConceptPerformance[]; conceptsToReinforce: string[];
} {
  const per = new Map<string, ConceptPerformance>();
  let correct = 0, incorrect = 0, unanswered = 0;
  for (const it of items) {
    const c = per.get(it.conceptId) ?? { conceptId: it.conceptId, total: 0, correct: 0, incorrect: 0, unanswered: 0, scorePercent: 0, passed: false };
    c.total++;
    if (it.correct === null) { c.unanswered++; unanswered++; }
    else if (it.correct) { c.correct++; correct++; }
    else { c.incorrect++; incorrect++; }
    per.set(it.conceptId, c);
  }
  const perConcept = [...per.values()].map((c) => {
    const scorePercent = subjectAssessmentScorePercent(c.correct, c.total);
    return { ...c, scorePercent, passed: subjectAssessmentPassed(scorePercent) };
  });
  const scorePercent = subjectAssessmentScorePercent(correct, items.length);
  return {
    total: items.length, correct, incorrect, unanswered, scorePercent, passed: subjectAssessmentPassed(scorePercent),
    perConcept, conceptsToReinforce: perConcept.filter((c) => !c.passed).map((c) => c.conceptId),
  };
}

/** Exact distribution check: the generated items' per-concept counts equal the plan. */
export function blueprintMatches(distribution: Record<string, number>, blueprint: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(distribution), ...Object.keys(blueprint)]);
  for (const k of keys) if ((distribution[k] ?? 0) !== (blueprint[k] ?? 0)) return false;
  return true;
}

/** Backward-compatible read of a frozen setup (pre-v2 rows carried scheduledDate / recommendedDate / requestedQuestionCount). */
export function readSetup(raw: unknown): SubjectAssessmentSetup | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.version !== 'subject-assessment-v2') return null;
  const setup = s as unknown as SubjectAssessmentSetup;
  // read old band names (LOW / MEDIUM / HIGH) as the approved ones; the stored row is never rewritten here
  const d = setup.difficulty as { band?: unknown } | undefined;
  if (d && 'band' in d) {
    const band = normalizeDifficultyBand(d.band);
    if (band && band !== d.band) return { ...setup, difficulty: { band } };
  }
  return setup;
}
