/**
 * Subject Test ("Prueba por materia") / Subject Mock ("Simulacro por materia") -- lifecycle rules (pure, no IO).
 *
 * Operator rules (overnight pilot, 2026-10-16; contract docs/orchestration/OVERNIGHT_2026-10-16_CONTRACTS.md section 2):
 *   - StudyUs decides count, distribution and difficulty (sizing.ts); the Student only picks concepts and NOW / SCHEDULE.
 *   - The configuration is frozen before the attempt (`SubjectAssessmentSetup`, quiz_sessions.subject_assessment_setup).
 *   - Student-created: ONE attempt. NOW starts immediately. SCHEDULED may be started early; once started it is active;
 *     if it is not completed on the selected date it EXPIRES at the end of that local date in the Student's timezone
 *     (interpretation SELF_SCHEDULED_EXPIRY_TIME = the date boundary, reported for confirmation).
 *   - Feedback: Test = correct / incorrect only after each answer; Mock = none during the attempt; both = full final
 *     feedback.
 *   - Timing: Mock ALWAYS timed, duration = sum of the frozen items' nominal response seconds rounded up to minutes
 *     (rule NOMINAL_RESPONSE_TIME_SUM, OPERATOR_DECISION_REQUIRED). Student Test untimed. Wall clock from startedAt; a
 *     lost connection never pauses it; at zero the attempt is submitted (answered graded, unanswered in the denominator).
 *   - Pass >= 80 inclusive (sizing.ts subjectAssessmentPassed).
 */
import { nominalResponseSeconds } from '@/lib/assessment-foundation/nominal-response-time';
import { SUBJECT_ASSESSMENT_MAX_QUESTIONS, subjectAssessmentPassed, subjectAssessmentScorePercent } from './sizing';

export type SubjectAssessmentKind = 'TEST' | 'MOCK';
export type SubjectAssessmentOrigin = 'STUDENT' | 'TEACHER';
export type SubjectAssessmentSetupKind = 'SUBJECT_CUMULATIVE_TEST' | 'SUBJECT_MOCK_EXAM';
export type DifficultyBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'MIXED';
export type FeedbackPolicy = 'TEST_CORRECTNESS_ONLY' | 'MOCK_NONE';

export const SETUP_KIND_OF: Record<SubjectAssessmentKind, SubjectAssessmentSetupKind> = { TEST: 'SUBJECT_CUMULATIVE_TEST', MOCK: 'SUBJECT_MOCK_EXAM' };
export const QUIZ_MODE_OF: Record<SubjectAssessmentKind, 'cumulative_assessment' | 'exam_simulation'> = { TEST: 'cumulative_assessment', MOCK: 'exam_simulation' };
export const kindOfQuizMode = (mode: string): SubjectAssessmentKind | null => (mode === 'cumulative_assessment' ? 'TEST' : mode === 'exam_simulation' ? 'MOCK' : null);
export const feedbackPolicyFor = (kind: SubjectAssessmentKind): FeedbackPolicy => (kind === 'TEST' ? 'TEST_CORRECTNESS_ONLY' : 'MOCK_NONE');

/** Student-created assessments allow exactly one attempt (operator). */
export const STUDENT_MAX_ATTEMPTS = 1;
/** A timed attempt's submission may arrive this long after the deadline (transport only; answers saved after the deadline never count). */
export const SUBJECT_SUBMIT_GRACE_SECONDS = 120;
/** An untimed attempt's inactivity window: the ordinary quiz session lifetime (QUIZ_SESSION_TTL_MINUTES), extended by each saved answer. */
export const SUBJECT_NOW_MIN_WINDOW_MINUTES = 45;
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
  /** Where the timezone came from: the Student's record, or the browser's (recorded as assumed). */
  timezoneSource?: 'STUDENT_AVAILABILITY' | 'BROWSER_ASSUMED' | 'DEFAULT_UTC_ASSUMED';
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
  completion?: { completedAt: string; reason: CompletionReason; scorePercent: number; passed: boolean };
}

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

/** The UTC instant of local midnight at the START of `date` (YYYY-MM-DD) in `tz` (DST-safe). */
export function localMidnightUtc(date: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(tz, guess);
  t = guess - tzOffsetMs(tz, t);
  return new Date(t);
}

const nextDate = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number);
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
};

/** End of the selected local date = the next local midnight (exclusive). SELF_SCHEDULED_EXPIRY_TIME interpretation. */
export function endOfLocalDateUtc(date: string, tz: string): Date {
  return localMidnightUtc(nextDate(date), tz);
}

/** The local calendar date (YYYY-MM-DD) of `now` in `tz`. */
export function localDateIn(tz: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Resolve the timezone authority: the Student's record first; the browser's only when absent (recorded as assumed). */
export function resolveStudentTimezone(studentTz: string | null | undefined, browserTz: string | null | undefined): { timezone: string; source: NonNullable<SubjectAssessmentSetup['timezoneSource']> } {
  if (isValidTimeZone(studentTz)) return { timezone: studentTz, source: 'STUDENT_AVAILABILITY' };
  if (isValidTimeZone(browserTz)) return { timezone: browserTz, source: 'BROWSER_ASSUMED' };
  return { timezone: 'UTC', source: 'DEFAULT_UTC_ASSUMED' };
}

/** A SCHEDULED date must be today or later in the Student's timezone. */
export function buildSchedule(input: { mode: 'NOW' } | { mode: 'SCHEDULED'; date: string }, tz: string, now: Date): { ok: true; schedule: ScheduleSpec } | { ok: false; error: 'SCHEDULE_DATE_INVALID' | 'SCHEDULE_DATE_IN_PAST' } {
  if (input.mode === 'NOW') return { ok: true, schedule: { mode: 'NOW' } };
  if (!isIsoDate(input.date)) return { ok: false, error: 'SCHEDULE_DATE_INVALID' };
  if (input.date < localDateIn(tz, now)) return { ok: false, error: 'SCHEDULE_DATE_IN_PAST' };
  return { ok: true, schedule: { mode: 'SCHEDULED', date: input.date, timezone: tz, expiresAt: endOfLocalDateUtc(input.date, tz).toISOString() } };
}

// ------------------------------------------------------------------ timing ---------------------------------------------------------------

/** Items as frozen: question type and difficulty (1-5) -- the two facts nominal-response-time reads. */
export interface TimedItem { type: string | null | undefined; difficulty: number | null | undefined }

/**
 * Mock duration recommendation: the sum of the frozen items' nominal response seconds, rounded UP to whole minutes.
 * The only existing per-item planning algorithm (assessment-foundation/nominal-response-time.ts). A generated item's
 * difficulty is clamped to the 1-5 scale before the lookup; an item that still cannot be planned is counted in
 * `unplannedItems` (never silently zero).
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
 * The session's own expiry (quiz_sessions.expires_at) -- never the ordinary 45-minute TTL counted from creation:
 *   not started + SCHEDULED -> end of the selected local date (SELF_SCHEDULED_EXPIRY_TIME interpretation)
 *   started + timed         -> deadline + grace (the deadline itself is the wall clock from startedAt)
 *   started + untimed       -> `now` (the last activity: start or a saved answer) + 45 min, an inactivity window
 *                              that each saved answer extends (SUBJECT_TEST_INACTIVITY_WINDOW interpretation: the
 *                              ordinary quiz TTL, sliding, so an untimed Test in progress is never cut off and an
 *                              abandoned one stops restricting the Tutor 45 minutes after the last answer)
 * `tz` is kept for callers; the date boundary is already frozen in `schedule.expiresAt`.
 */
export function sessionExpiresAt(setup: Pick<SubjectAssessmentSetup, 'schedule' | 'timing'>, _tz: string, now: Date): Date {
  const { schedule, timing } = setup;
  if (!timing.startedAt) {
    if (schedule.mode === 'SCHEDULED') return new Date(schedule.expiresAt);
    return new Date(now.getTime() + SUBJECT_NOW_MIN_WINDOW_MINUTES * 60_000);
  }
  if (timing.timed && timing.deadlineAt) return new Date(new Date(timing.deadlineAt).getTime() + SUBJECT_SUBMIT_GRACE_SECONDS * 1000);
  return new Date(now.getTime() + SUBJECT_NOW_MIN_WINDOW_MINUTES * 60_000);
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
 * Explicit difficulty band -> generator difficulty levels (1-5 scale). OPERATOR_DECISION_REQUIRED: no governed band
 * table exists; LOW = 2, MEDIUM = 3, HIGH = 4, MIXED = 2 / 3 / 4 in rotation.
 */
export const DIFFICULTY_BAND_LEVELS: Record<DifficultyBand, number[]> = { LOW: [2], MEDIUM: [3], HIGH: [4], MIXED: [2, 3, 4] };

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
  if (s.version === 'subject-assessment-v2') return s as unknown as SubjectAssessmentSetup;
  return null;
}
