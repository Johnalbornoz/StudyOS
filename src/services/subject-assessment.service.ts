/**
 * Subject Test ("Prueba por materia") / Subject Mock ("Simulacro por materia") sessions -- the ONE creation, answer,
 * start and submission path for both origins (STUDENT-created and TEACHER-assigned).
 *
 * Contract: docs/orchestration/OVERNIGHT_2026-10-16_CONTRACTS.md section 2. Rules: src/lib/subject-assessment/lifecycle.ts
 * (pure) and sizing.ts (counts). Substrate: quiz_sessions (quiz_mode cumulative_assessment / exam_simulation) with the
 * frozen configuration in quiz_sessions.subject_assessment_setup; responses and grades in quiz_responses /
 * quiz_response_grades; evidence = one learning_evidence row per concept (CUMULATIVE_ASSESSMENT / MOCK_EXAM). Never
 * writes Exam Readiness.
 *
 *   createSubjectAssessmentSession   plan (KS-aware Test / representative Mock, or an explicit TEACHER plan), generate
 *                                    exactly the planned per-concept distribution (avoiding items the Student has seen),
 *                                    freeze, and (NOW) start
 *   startSubjectAssessmentSession    start a SCHEDULED assessment (early start allowed; one attempt)
 *   recordSubjectAssessmentAnswer    save one answer server-side (Test -> { correct } only; Mock -> nothing)
 *   submitSubjectAssessmentSession   grade (answered + UNANSWERED in the denominator), write evidence, close; also the
 *                                    lazy TIME_UP auto-submit
 *   readSubjectAssessmentSession     state for a read (lazily auto-submits a timed attempt past its deadline)
 *   listStudentSubjectAssessments    the Student's scheduled / open / recent subject assessments
 *   heartbeatSubjectAssessmentSession  teacher-assigned attempts: the runner's liveness signal (window-close rule V)
 *   readCompletedSubjectAssessmentForStaff  full final feedback for an already-authorized Teacher drill-down
 */
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { ALL_QUESTION_TYPES } from '@/services/quiz-generation.service';
import { QUIZ_MODE_CONFIG } from '@/lib/quiz/quiz-mode-config';
import { activityTypeForQuizMode, evidenceModeForQuizMode, storeQuiz, completeQuiz } from '@/services/quiz-persistence.service';
import { fingerprintQuestion } from '@/lib/lx/exact-duplicate-novelty';
import { sessionQuestionHistory } from '@/lib/quiz/session-question-history';
import { resolveTargetDifficulty, aggregateEvidenceDifficulty } from '@/lib/lx/difficulty-contract';
import { normalizeResponseTiming, toResponseTimingEntries, withBehaviorMetadata, type ResponseTiming } from '@/lib/algorithms/response-timing';
import { isRecordableError, type PedagogicalGrade } from '@/lib/grading/pedagogical-grade';
import { pedagogicalFeedbackText } from '@/lib/grading/pedagogical-feedback';
import { toClientQuestion } from '@/lib/quiz/client-question';
import type { LearningEvidence } from '@/lib/algorithms/mastery';
import {
  SUBJECT_ASSESSMENT_MAX_QUESTIONS, planSubjectMock, planSubjectTest, subjectAssessmentPassed, SUBJECT_ASSESSMENT_PASS_PERCENT,
} from '@/lib/subject-assessment/sizing';
import {
  QUIZ_MODE_OF, SETUP_KIND_OF, STUDENT_MAX_ATTEMPTS, DIFFICULTY_PLAN_METHOD, answerCountsAt, assignLevelsAcrossConcepts, blueprintMatches, buildSchedule,
  buildSubjectReport, conceptNeedsReinforcement, feedbackPolicyFor, kindOfQuizMode, lifecycleState, mixedLevelCounts, normalizeDifficultyBand, readSetup, remainingSeconds,
  resolveTimezoneAuthority, sessionExpiresAt, startTiming, studentTimingFor, recommendedMockDurationMinutes,
  validateExplicitPlan, rankReuseCandidates,
  type CompletionReason, type ReuseSource, type DifficultyBand, type ExplicitPlan, type GradedItem, type LegacyDifficultyBand, type LifecycleState, type SubjectAssessmentKind, type SubjectAssessmentOrigin,
  type SubjectAssessmentSetup, type TimezoneAuthority, type TimingSpec,
} from '@/lib/subject-assessment/lifecycle';
import { knowledgeProfile, type KnowledgeProfile } from '@/lib/subject-assessment/knowledge-bucket';
import { ABANDONMENT_TOLERANCE_SECONDS, decideAssignmentAttemptGate } from '@/lib/teacher/subject-assessment-assignment.rules';

/** A frozen item: the generated question plus the level it was generated at (additive jsonb field, set at creation). */
type FrozenQuestion = GeneratedQuestion & { plannedDifficultyLevel?: number };
/** The level an item was generated at, else its recorded difficulty (rows frozen before 2026-10-17). */
export const itemLevel = (q: FrozenQuestion): number | null => {
  const v = typeof q.plannedDifficultyLevel === 'number' ? q.plannedDifficultyLevel : Number(q.difficulty);
  return Number.isFinite(v) ? v : null;
};

// ------------------------------------------------------------------ types ----------------------------------------------------------------

export interface CreateSubjectAssessmentParams {
  studentId: string;
  subjectId: string;
  kind: 'TEST' | 'MOCK';
  origin: 'STUDENT' | 'TEACHER';
  conceptIds: string[];
  /** TEACHER: the fixed group plan (planGroupAssessment). Omitted for STUDENT: StudyUs plans it (sizing.ts). */
  plan?: { questionCount: number; distribution: Record<string, number>; rule: string };
  /**
   * TEACHER: explicit band (BASIC / INTERMEDIATE / ADVANCED / MIXED; the legacy LOW / MEDIUM / HIGH of rows frozen before
   * 2026-10-17 are read as BASIC / INTERMEDIATE / ADVANCED). Omitted for STUDENT: AUTO (per-concept Knowledge State).
   */
  difficultyBand?: DifficultyBand | LegacyDifficultyBand;
  /**
   * NOW, or SCHEDULED for a local date: expires at 21:00 of that date in the authoritative timezone
   * (student_availability.timezone, else the Student's institution); none -> TIMEZONE_AUTHORITY_BLOCKER.
   */
  schedule: { mode: 'NOW' } | { mode: 'SCHEDULED'; date: string };
  /**
   * TEACHER: { timed, durationMinutes } (durationMinutes null -> the nominal recommendation). STUDENT: ignored -- the
   * Mock is always timed with the nominal recommendation, the Test is untimed. A Mock is always timed for any origin.
   */
  timing: { timed: boolean; durationMinutes: number | null };
  assignmentId?: string;
  attemptNumber?: number;
  /** Extra fingerprints to avoid (TEACHER: e.g. the previous attempt's items), on top of everything the Student has seen. */
  avoidFingerprints?: string[];
  /** Optional: language of the items (default: the subject's resolved language, else 'es'). */
  language?: string;
  /** TEACHER: attempts allowed by the assignment (recorded in the setup; enforcement belongs to the assignment). */
  maxAttempts?: number;
  /**
   * TEACHER: the immediately previous attempt's items. Avoided like every seen item; when supply forces a reuse they are
   * the LAST candidates (operator rule T).
   */
  previousAttemptFingerprints?: string[];
  /** TEACHER: the assignment window close, frozen into the attempt (resume / close-after-exit rule V). */
  assignmentWindow?: { closesAt: string; resumeAfterInactivity?: boolean };
}

export type ServiceError = { ok: false; status: number; error: string; message: string; detail?: Record<string, unknown> };

export interface SubjectAssessmentView {
  quizId: string;
  state: LifecycleState;
  setup: SubjectAssessmentSetup;
  remainingSeconds: number | null;
  expiresAt: string;
  /** Present when the attempt may be answered (ACTIVE). */
  questions?: ReturnType<typeof toClientQuestion>[];
  /** Indexes already answered (saved server-side), with the Test's correctness. */
  answered?: Array<{ questionIndex: number; correct?: boolean }>;
  /** Present when COMPLETED (or just auto-submitted). */
  results?: SubjectSubmissionData;
}

export interface GeneratorDeps {
  /** Generate exactly `count` items for one concept at one difficulty, or [] (never a partial set). */
  generate: (args: { conceptId: string; studentId: string; subjectId: string; count: number; difficulty: number; quizMode: 'cumulative_assessment' | 'exam_simulation'; language: string; parentOperationId: string }) => Promise<GeneratedQuestion[]>;
  /** Grade one answer (default: the shared per-question grader). */
  grade?: (question: GeneratedQuestion, answer: string, language: string, evidenceMode: string, ctx: { studentId: string; subjectId: string }) => Promise<GradeResultLike>;
}

export interface GradeResultLike {
  correct: boolean;
  score: number;
  feedback?: string;
  errorType?: string | null;
  pedagogical?: PedagogicalGrade;
  aiExecution?: { aiExecutionId?: string; aiProvider?: string; aiModel?: string; aiPromptId?: string; aiPromptVersion?: string };
  confidence?: number;
}

const fail = (status: number, error: string, message: string, detail?: Record<string, unknown>): ServiceError => ({ ok: false, status, error, message, ...(detail ? { detail } : {}) });

async function dbNow(): Promise<Date> {
  const r = await db.query(`SELECT now() AS now`);
  return new Date(r.rows[0].now);
}

async function defaultGenerate(args: Parameters<GeneratorDeps['generate']>[0]): Promise<GeneratedQuestion[]> {
  const { generateGatedQuestionBatch } = await import('@/services/gated-question-generation.service');
  const { getSubjectIBContext } = await import('@/services/subject-generation-context.service');
  const config = QUIZ_MODE_CONFIG[args.quizMode];
  const ibContext = await getSubjectIBContext(args.subjectId).catch(() => null);
  return generateGatedQuestionBatch(args.conceptId, args.studentId, args.subjectId, {
    count: args.count,
    difficulty: args.difficulty,
    types: ALL_QUESTION_TYPES,
    guidance: config.guidance,
    language: args.language,
    visualAidRate: config.visualAidRate,
    ibContext,
    activityType: activityTypeForQuizMode(args.quizMode),
    quizMode: args.quizMode,
    parentOperationId: args.parentOperationId,
  });
}

async function defaultGrade(question: GeneratedQuestion, answer: string, language: string, evidenceMode: string, ctx: { studentId: string; subjectId: string }): Promise<GradeResultLike> {
  const { gradeQuizAnswer } = await import('@/lib/quiz/grade-question');
  return (await gradeQuizAnswer(question, answer, language, evidenceMode as never, ctx)) as unknown as GradeResultLike;
}

// ---------------------------------------------------------------- planning ---------------------------------------------------------------

export interface SubjectAssessmentPlan {
  kind: SubjectAssessmentKind;
  origin: SubjectAssessmentOrigin;
  conceptIds: string[];
  questionCount: number;
  distribution: Record<string, number>;
  rule: string;
  difficulty: SubjectAssessmentSetup['difficulty'];
  knowledgeSignals?: SubjectAssessmentSetup['knowledgeSignals'];
  mockBand?: string;
  allSubject?: boolean;
  timed: boolean;
}

/** The subject belongs to the Student and every concept belongs to the subject. Returns the subject's concepts (in order). */
async function ownedSubjectConcepts(studentId: string, subjectId: string): Promise<string[] | null> {
  const s = await db.query(`SELECT 1 FROM subjects WHERE id = $1 AND student_id = $2`, [subjectId, studentId]);
  if (s.rows.length === 0) return null;
  const c = await db.query(`SELECT id FROM concepts WHERE subject_id = $1 ORDER BY created_at ASC NULLS LAST, id ASC`, [subjectId]);
  return c.rows.map((r: { id: string }) => r.id);
}

/**
 * Plan without generating (the setup preview uses this too). STUDENT: Test = planSubjectTest over the Knowledge State
 * signal of each concept; Mock = planSubjectMock (uniform; allSubject = every eligible concept selected). TEACHER: the
 * explicit plan, validated.
 */
export async function planSubjectAssessment(params: Pick<CreateSubjectAssessmentParams, 'studentId' | 'subjectId' | 'kind' | 'origin' | 'conceptIds' | 'plan' | 'difficultyBand'>): Promise<{ ok: true; plan: SubjectAssessmentPlan } | ServiceError> {
  const conceptIds = [...new Set(params.conceptIds)];
  if (conceptIds.length === 0) return fail(400, 'NO_CONCEPTS_SELECTED', 'Choose at least one concept.');
  const subjectConcepts = await ownedSubjectConcepts(params.studentId, params.subjectId);
  if (!subjectConcepts) return fail(403, 'FORBIDDEN', 'Cannot access this subject.');
  if (conceptIds.some((c) => !subjectConcepts.includes(c))) return fail(403, 'FORBIDDEN', 'A selected concept is not part of this subject.');
  const allSubject = subjectConcepts.length > 0 && subjectConcepts.every((c) => conceptIds.includes(c));
  const band = params.difficultyBand === undefined ? null : normalizeDifficultyBand(params.difficultyBand);
  if (params.difficultyBand !== undefined && !band) return fail(400, 'DIFFICULTY_INVALID', 'Unknown difficulty band.');
  const difficulty: SubjectAssessmentSetup['difficulty'] = band ? { band } : { mode: 'AUTO' };
  const timed = params.kind === 'MOCK';

  if (params.plan) {
    const v = validateExplicitPlan(params.plan as ExplicitPlan, conceptIds);
    if (!v.ok) return fail(400, v.error, 'The explicit plan is not valid for the selected concepts.');
    return { ok: true, plan: { kind: params.kind, origin: params.origin, conceptIds, questionCount: params.plan.questionCount, distribution: { ...params.plan.distribution }, rule: params.plan.rule, difficulty, timed, allSubject } };
  }
  if (params.origin === 'TEACHER') return fail(400, 'PLAN_REQUIRED', 'A teacher assignment passes its fixed group plan.');

  if (params.kind === 'MOCK') {
    const m = planSubjectMock(conceptIds, allSubject);
    if (m.uncovered.length > 0) return fail(400, 'TOO_MANY_CONCEPTS', `At most ${SUBJECT_ASSESSMENT_MAX_QUESTIONS} concepts can be assessed.`, { selected: conceptIds.length, max: SUBJECT_ASSESSMENT_MAX_QUESTIONS });
    return { ok: true, plan: { kind: 'MOCK', origin: 'STUDENT', conceptIds, questionCount: m.questionCount, distribution: m.distribution, rule: m.rule, difficulty, timed, mockBand: m.band, allSubject } };
  }

  if (conceptIds.length > SUBJECT_ASSESSMENT_MAX_QUESTIONS) {
    return fail(400, 'TOO_MANY_CONCEPTS', `A subject test covers every selected concept; at most ${SUBJECT_ASSESSMENT_MAX_QUESTIONS} concepts.`, { selected: conceptIds.length, max: SUBJECT_ASSESSMENT_MAX_QUESTIONS });
  }
  const { getActiveMasteryPolicy, getConceptKnowledgeState } = await import('@/services/knowledge-state.service');
  const policy = await getActiveMasteryPolicy();
  const knowledgeSignals: NonNullable<SubjectAssessmentSetup['knowledgeSignals']> = {};
  await Promise.all(conceptIds.map(async (c) => {
    const ks = await getConceptKnowledgeState(params.studentId, c).catch(() => null);
    knowledgeSignals[c] = conceptNeedsReinforcement(ks, policy);
  }));
  const t = planSubjectTest(conceptIds.map((c) => ({ conceptId: c, needsReinforcement: knowledgeSignals[c].needsReinforcement })));
  if (t.uncovered.length > 0) return fail(400, 'TOO_MANY_CONCEPTS', `At most ${SUBJECT_ASSESSMENT_MAX_QUESTIONS} concepts.`);
  return { ok: true, plan: { kind: 'TEST', origin: 'STUDENT', conceptIds, questionCount: t.questionCount, distribution: t.distribution, rule: t.rule, difficulty, timed: false, knowledgeSignals, allSubject } };
}

// --------------------------------------------------------------- generation --------------------------------------------------------------

/** Every question text the Student has been served for these concepts, in any quiz session (exact-novelty fingerprints). */
export async function loadSeenFingerprints(studentId: string, conceptIds: string[]): Promise<Map<string, Set<string>>> {
  return (await loadSeenWithRecency(studentId, conceptIds)).seen;
}

/** The same, plus when each fingerprint was last served to the Student (session creation time; for least-recently-used reuse). */
async function loadSeenWithRecency(studentId: string, conceptIds: string[]): Promise<{ seen: Map<string, Set<string>>; lastServedMs: Map<string, number> }> {
  const out = new Map<string, Set<string>>(conceptIds.map((c) => [c, new Set<string>()]));
  const lastServedMs = new Map<string, number>();
  const r = await db.query(`SELECT questions, created_at, concept_id, quiz_mode FROM quiz_sessions WHERE student_id = $1 AND concept_ids && $2::uuid[]`, [studentId, conceptIds]);
  for (const row of r.rows) {
    const at = row.created_at ? new Date(row.created_at).getTime() : 0;
    // C14-P0-01: every session of the Student counts, whatever its stored shape (an APPLY transfer ladder row holds an
    // object, not an array) -- normalized in ONE place; an unsupported shape adds no history and never throws.
    for (const q of sessionQuestionHistory(row.questions, { sessionConceptId: row.concept_id ?? null, quizMode: row.quiz_mode ?? null })) {
      if (q.conceptId !== null && out.has(q.conceptId)) {
        const fp = fingerprintQuestion(q);
        out.get(q.conceptId)!.add(fp);
        if (!(lastServedMs.get(fp)! >= at)) lastServedMs.set(fp, at);
      }
    }
  }
  return { seen: out, lastServedMs };
}

async function pool<T, R>(items: readonly T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const GENERATION_ROUNDS = 2;
const GENERATION_CONCURRENCY = 6;

/**
 * Exactly `distribution[c]` items per concept. Seen items (exact fingerprint) are avoided; when the generator can only
 * produce seen items, they are reused and RECORDED; when it cannot produce enough items at all, the whole creation
 * fails (no shrink, no silent partial).
 */
async function generateExactDistribution(input: {
  studentId: string; subjectId: string; quizMode: 'cumulative_assessment' | 'exam_simulation'; language: string; parentOperationId: string;
  distribution: Record<string, number>; levelPlanOf: (conceptId: string) => Promise<Array<{ level: number; count: number }>>; seen: Map<string, Set<string>>; avoid: Set<string>;
  generate: GeneratorDeps['generate'];
  /** Reuse ranking (teacher assignments): the previous attempt's items, and when each seen item was last served. */
  previousAttempt?: Set<string>; lastServedMs?: Map<string, number>;
}): Promise<{ ok: true; questions: FrozenQuestion[]; reused: SubjectAssessmentSetup['reusedItems'] } | { ok: false; shortConcepts: Array<{ conceptId: string; planned: number; generated: number }> }> {
  const concepts = Object.keys(input.distribution);
  const results = await pool(concepts, GENERATION_CONCURRENCY, async (conceptId) => {
    const planned = input.distribution[conceptId];
    const levelPlan = await input.levelPlanOf(conceptId);
    const exclude = new Set<string>([...(input.seen.get(conceptId) ?? []), ...input.avoid]);
    const accepted: FrozenQuestion[] = [];
    const reusable: FrozenQuestion[] = [];
    const acceptedFp = new Set<string>();
    for (const { level, count } of levelPlan) {
      let got = 0;
      for (let round = 0; round < GENERATION_ROUNDS && got < count; round++) {
        const batch = await input.generate({ conceptId, studentId: input.studentId, subjectId: input.subjectId, count: count - got, difficulty: level, quizMode: input.quizMode, language: input.language, parentOperationId: input.parentOperationId }).catch(() => [] as GeneratedQuestion[]);
        for (const q of batch) {
          if (got >= count) break;
          const item: FrozenQuestion = { ...q, conceptId, plannedDifficultyLevel: level };
          const fp = fingerprintQuestion(item);
          if (acceptedFp.has(fp)) continue;
          if (exclude.has(fp)) { reusable.push(item); continue; }
          acceptedFp.add(fp);
          accepted.push(item);
          got++;
        }
      }
    }
    // controlled reuse (only when supply is short of novel items): the Student's own older items first (least recently
    // used), then items of other students of the assignment, the immediately previous attempt last -- each recorded
    const reused: SubjectAssessmentSetup['reusedItems'] = [];
    const ranked = input.previousAttempt || input.lastServedMs
      ? rankReuseCandidates(reusable.map((q) => ({ q, fingerprint: fingerprintQuestion(q) })), { previousAttempt: input.previousAttempt ?? new Set(), group: input.avoid, lastServedMs: input.lastServedMs ?? new Map() })
      : reusable.map((q) => ({ q, fingerprint: fingerprintQuestion(q), source: undefined as ReuseSource | undefined, lastServedMs: null as number | null }));
    for (const { q, fingerprint: fp, source, lastServedMs } of ranked) {
      if (accepted.length >= planned) break;
      if (acceptedFp.has(fp)) continue;
      acceptedFp.add(fp);
      accepted.push(q);
      reused.push({ conceptId, fingerprint: fp, ...(source ? { source, lastServedAt: lastServedMs ? new Date(lastServedMs).toISOString() : null } : {}) });
    }
    return { conceptId, planned, questions: accepted.slice(0, planned), reused };
  });
  const short = results.filter((r) => r.questions.length < r.planned).map((r) => ({ conceptId: r.conceptId, planned: r.planned, generated: r.questions.length }));
  if (short.length > 0) return { ok: false, shortConcepts: short };
  return { ok: true, questions: results.flatMap((r) => r.questions), reused: results.flatMap((r) => r.reused) };
}

/** Interleave concepts so the order does not cluster (deterministic round-robin; the client never reorders). */
function interleaveByConcept(questions: GeneratedQuestion[]): GeneratedQuestion[] {
  const groups = new Map<string, GeneratedQuestion[]>();
  for (const q of questions) groups.set(q.conceptId, [...(groups.get(q.conceptId) ?? []), q]);
  const out: GeneratedQuestion[] = [];
  const lists = [...groups.values()];
  for (let i = 0; out.length < questions.length; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

/**
 * The Student's timezone authority (APPROVED 2026-10-17): student_availability.timezone, else the timezone of the
 * Student's institution -- the distinct institutions.timezone of the Student's ACTIVE class enrollments (exactly one).
 * No authority -> TIMEZONE_AUTHORITY_BLOCKER (never the browser's, never UTC).
 */
export async function loadTimezoneAuthority(studentId: string): Promise<TimezoneAuthority> {
  const own = await db.query(`SELECT timezone FROM student_availability WHERE student_id = $1`, [studentId]).catch(() => ({ rows: [] as Array<{ timezone: string | null }> }));
  const inst = await db.query(
    `SELECT DISTINCT i.timezone FROM class_enrollments ce JOIN classes c ON c.id = ce.class_id JOIN institutions i ON i.id = c.institution_id
      WHERE ce.student_id = $1 AND ce.status = 'ACTIVE' AND i.timezone IS NOT NULL`,
    [studentId],
  ).catch(() => ({ rows: [] as Array<{ timezone: string | null }> }));
  return resolveTimezoneAuthority(own.rows[0]?.timezone ?? null, inst.rows.map((r: { timezone: string | null }) => r.timezone));
}

// ----------------------------------------------------------------- create ----------------------------------------------------------------

/**
 * Create (and freeze) one subject assessment session. STUDENT origin: StudyUs plans count / distribution (Knowledge
 * State-aware Test, representative Mock), difficulty AUTO, one attempt, Mock timed by the nominal sum, Test untimed.
 * TEACHER origin: the explicit plan and band (no Knowledge State adaptation), its own timing, assignmentId /
 * attemptNumber recorded. NOW starts the attempt immediately; SCHEDULED freezes it until the Student starts it.
 */
export async function createSubjectAssessmentSession(
  params: CreateSubjectAssessmentParams,
  deps: Partial<GeneratorDeps> = {},
): Promise<{ ok: true; quizId: string; setup: SubjectAssessmentSetup; view: SubjectAssessmentView; questions: GeneratedQuestion[] } | ServiceError> {
  if (params.kind !== 'TEST' && params.kind !== 'MOCK') return fail(400, 'INVALID_KIND', 'kind must be TEST or MOCK.');
  if (params.origin === 'TEACHER' && (!params.plan || !params.difficultyBand)) return fail(400, 'PLAN_REQUIRED', 'A teacher assignment passes its fixed plan and difficulty band.');
  if (params.kind === 'MOCK' && params.origin === 'TEACHER' && !params.timing?.timed) return fail(400, 'MOCK_MUST_BE_TIMED', 'A subject mock is always timed.');
  if (params.origin === 'TEACHER' && params.timing?.timed && params.timing.durationMinutes !== null && !(Number.isInteger(params.timing.durationMinutes) && params.timing.durationMinutes >= 1 && params.timing.durationMinutes <= 600)) {
    return fail(400, 'DURATION_INVALID', 'durationMinutes must be a whole number of minutes (1-600) or null.');
  }

  const planned = await planSubjectAssessment({ ...params, difficultyBand: params.origin === 'STUDENT' ? undefined : params.difficultyBand });
  if (!planned.ok) return planned;
  const plan = planned.plan;

  const now = await dbNow();
  const tz = await loadTimezoneAuthority(params.studentId);
  const sched = buildSchedule(params.schedule, tz.ok ? tz.timezone : null, now);
  if (!sched.ok && sched.error === 'TIMEZONE_AUTHORITY_BLOCKER') {
    return fail(409, 'TIMEZONE_AUTHORITY_BLOCKER', 'No timezone is recorded for this student or their institution, so a scheduled assessment cannot be given its 21:00 expiry. Do it now, or ask for the timezone to be set.', { reason: tz.ok ? 'INVALID_TIMEZONE' : tz.reason });
  }
  if (!sched.ok) return fail(400, sched.error, 'The selected date is not valid.');

  const quizMode = QUIZ_MODE_OF[params.kind];
  let language = params.language;
  if (!language) {
    const { resolveLanguageForSubject } = await import('@/services/subject-generation-context.service');
    language = await resolveLanguageForSubject(params.subjectId, params.studentId).catch(() => 'es');
  }

  // difficulty levels per concept: AUTO = the canonical target-difficulty authority over the concept's Knowledge State;
  // an explicit band = the approved level table, assigned deterministically across concepts (assignLevelsAcrossConcepts:
  // MIXED is exactly 30 / 50 / 20 over the whole assessment). No Knowledge State adaptation for a band.
  const activityType = activityTypeForQuizMode(quizMode);
  const bandPlan = 'band' in plan.difficulty ? assignLevelsAcrossConcepts(plan.distribution, plan.difficulty.band as DifficultyBand) : null;
  const levelPlanOf = async (conceptId: string): Promise<Array<{ level: number; count: number }>> => {
    if (bandPlan) return bandPlan[conceptId] ?? [];
    const { getConceptKnowledgeState } = await import('@/services/knowledge-state.service');
    const ks = await getConceptKnowledgeState(params.studentId, conceptId).catch(() => null);
    return [{ level: resolveTargetDifficulty({ activityType, knowledgeState: ks ? { masteryState: ks.masteryState, criticalMisconceptionCount: ks.criticalMisconceptionCount } : null }).level, count: plan.distribution[conceptId] }];
  };

  const { seen, lastServedMs } = await loadSeenWithRecency(params.studentId, plan.conceptIds);
  const previousAttempt = params.previousAttemptFingerprints ? new Set(params.previousAttemptFingerprints) : undefined;
  const generated = await generateExactDistribution({
    studentId: params.studentId, subjectId: params.subjectId, quizMode, language, parentOperationId: randomUUID(),
    distribution: plan.distribution, levelPlanOf, seen, avoid: new Set([...(params.avoidFingerprints ?? []), ...(params.previousAttemptFingerprints ?? [])]), generate: deps.generate ?? defaultGenerate,
    ...(params.origin === 'TEACHER' ? { previousAttempt: previousAttempt ?? new Set<string>(), lastServedMs } : {}),
  });
  if (!generated.ok) {
    return fail(500, 'GENERATION_INSUFFICIENT', 'Could not prepare every planned question. Nothing was created; try again later.', { shortConcepts: generated.shortConcepts, questionCount: plan.questionCount });
  }
  const questions = interleaveByConcept(generated.questions);
  const blueprint: Record<string, number> = {};
  for (const q of questions) blueprint[q.conceptId] = (blueprint[q.conceptId] ?? 0) + 1;
  if (questions.length !== plan.questionCount || !blueprintMatches(plan.distribution, blueprint)) {
    return fail(500, 'GENERATION_INSUFFICIENT', 'The generated items do not match the planned distribution. Nothing was created.');
  }

  // timing: STUDENT Mock = nominal sum (always timed), STUDENT Test = untimed; TEACHER = as assigned (Mock always timed;
  // the Teacher's duration -- frozen on the assignment at publication -- is authoritative and never recomputed here;
  // durationMinutes null -> the nominal recommendation over these frozen items, adjusted by each item's level).
  const items = questions.map((q) => ({ type: q.type, difficulty: itemLevel(q) }));
  let timing: TimingSpec;
  if (params.origin === 'STUDENT') timing = studentTimingFor(params.kind, items);
  else if (params.timing.timed) {
    const rec = recommendedMockDurationMinutes(items);
    timing = { timed: true, durationMinutes: params.timing.durationMinutes ?? Math.max(1, rec.minutes), durationRule: params.timing.durationMinutes ? 'TEACHER_SET' : rec.rule };
  } else timing = { timed: false, durationMinutes: null };

  const startsNow = sched.schedule.mode === 'NOW';
  if (startsNow) timing = startTiming(timing, now);

  const setup: SubjectAssessmentSetup = {
    version: 'subject-assessment-v2',
    kind: SETUP_KIND_OF[params.kind],
    origin: params.origin,
    ...(params.assignmentId ? { assignmentId: params.assignmentId } : {}),
    ...(params.attemptNumber ? { attemptNumber: params.attemptNumber } : {}),
    quizMode,
    subjectId: params.subjectId,
    selectedConceptIds: plan.conceptIds,
    questionCount: plan.questionCount,
    distribution: plan.distribution,
    rule: plan.rule,
    difficulty: plan.difficulty,
    schedule: sched.schedule,
    timing,
    feedbackPolicy: feedbackPolicyFor(params.kind),
    maxAttempts: params.origin === 'STUDENT' ? STUDENT_MAX_ATTEMPTS : params.maxAttempts,
    frozenAt: now.toISOString(),
    timezoneSource: tz.ok ? tz.source : null,
    ...(bandPlan && 'band' in plan.difficulty
      ? { difficultyPlan: { counts: plan.difficulty.band === 'MIXED' ? mixedLevelCounts(plan.questionCount) : { BASIC: 0, INTERMEDIATE: 0, ADVANCED: 0, [plan.difficulty.band]: plan.questionCount } as Record<'BASIC' | 'INTERMEDIATE' | 'ADVANCED', number>, perConcept: bandPlan, method: DIFFICULTY_PLAN_METHOD } }
      : {}),
    ...(plan.knowledgeSignals ? { knowledgeSignals: plan.knowledgeSignals } : {}),
    ...(plan.mockBand ? { mockBand: plan.mockBand } : {}),
    allSubject: plan.allSubject,
    blueprint,
    reusedItems: generated.reused,
    priorFingerprintCount: [...seen.values()].reduce((a, s) => a + s.size, 0),
    ...(params.origin === 'TEACHER' && params.assignmentWindow ? { assignmentWindow: { closesAt: params.assignmentWindow.closesAt, resumeAfterInactivity: params.assignmentWindow.resumeAfterInactivity === true } } : {}),
  };

  const quizId = await storeQuiz(params.studentId, null, params.subjectId, questions, language, quizMode, plan.conceptIds, null);
  const expiresAt = sessionExpiresAt(setup, now);
  await db.query(`UPDATE quiz_sessions SET subject_assessment_setup = $2::jsonb, expires_at = $3::timestamptz WHERE id = $1`, [quizId, JSON.stringify(setup), expiresAt.toISOString()]);

  const state: LifecycleState = startsNow ? 'ACTIVE' : 'SCHEDULED_NOT_STARTED';
  return {
    ok: true, quizId, setup, questions,
    view: {
      quizId, state, setup, expiresAt: expiresAt.toISOString(), remainingSeconds: remainingSeconds(setup.timing, now),
      ...(startsNow ? { questions: questions.map((q, i) => toClientQuestion(q, i)), answered: [] } : {}),
    },
  };
}

// ------------------------------------------------------------- session reads -------------------------------------------------------------

interface SessionRow {
  id: string; student_id: string; subject_id: string; questions: GeneratedQuestion[]; language: string; status: string;
  expires_at: string; created_at: string; db_now: string; quiz_mode: string; activity_type: string | null; evidence_mode: string | null;
  setup: unknown;
}

async function loadSession(quizId: string): Promise<SessionRow | null> {
  try {
    const r = await db.query(
      `SELECT id, student_id, subject_id, questions, language, status, expires_at, created_at, now() AS db_now, quiz_mode,
              activity_type, evidence_mode, subject_assessment_setup AS setup
         FROM quiz_sessions WHERE id = $1`,
      [quizId],
    );
    return r.rows[0] ?? null;
  } catch (e) {
    if ((e as { code?: string })?.code === '42703') return null; // column not migrated: no v2 subject sessions exist here
    throw e;
  }
}

/** True when this quiz session is a v2 subject assessment (the route branches to this service for it). */
export async function isSubjectAssessmentSession(quizId: string): Promise<boolean> {
  const row = await loadSession(quizId);
  return !!row && !!kindOfQuizMode(row.quiz_mode) && !!readSetup(row.setup);
}

async function savedResponses(quizId: string): Promise<Map<number, { answer: string; answeredAt: Date; grade: GradeResultLike | null }>> {
  const r = await db.query(
    `SELECT r.question_index, r.student_answer, r.created_at,
            g.is_correct, g.score, g.feedback_text, g.error_type
       FROM quiz_responses r
       LEFT JOIN LATERAL (SELECT * FROM quiz_response_grades g WHERE g.response_id = r.id ORDER BY g.graded_at ASC LIMIT 1) g ON true
      WHERE r.quiz_session_id = $1`,
    [quizId],
  );
  const out = new Map<number, { answer: string; answeredAt: Date; grade: GradeResultLike | null }>();
  for (const row of r.rows) {
    out.set(Number(row.question_index), {
      answer: row.student_answer,
      answeredAt: new Date(row.created_at),
      grade: row.is_correct === null || row.is_correct === undefined ? null : { correct: row.is_correct, score: Number(row.score), feedback: row.feedback_text ?? undefined, errorType: row.error_type ?? null },
    });
  }
  return out;
}

async function markExpired(quizId: string): Promise<void> {
  await db.query(`UPDATE quiz_sessions SET status = 'expired' WHERE id = $1 AND status = 'active'`, [quizId]);
}

// ------------------------------------------------- teacher assignment attempts (rule V) -------------------------------------------------

/**
 * "The same continuous session" after the window close (APPROVED 2026-10-17): the last activity within 180 s (heartbeat
 * every 30 s). More than 180 s without activity after the 21:00 close = LEFT: closed as is, never resumed.
 */
export const ASSIGNMENT_LIVENESS_WINDOW_SECONDS = ABANDONMENT_TOLERANCE_SECONDS;

/** The attempt's last activity: its start, the latest saved answer, or the latest runner heartbeat. */
async function lastActivityAt(quizId: string, setup: SubjectAssessmentSetup): Promise<Date | null> {
  const r = await db.query(`SELECT max(created_at) AS at FROM quiz_responses WHERE quiz_session_id = $1`, [quizId]);
  const times = [setup.timing.startedAt, setup.liveness?.lastActivityAt, r.rows[0]?.at ? new Date(r.rows[0].at).toISOString() : null]
    .filter((x): x is string => !!x).map((x) => new Date(x).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

/**
 * Operator rule V for a TEACHER-assigned attempt (setup.assignmentWindow present), decided on every read / answer /
 * submit / heartbeat:
 *   before the close   an untimed attempt left idle 45 minutes (inactivity expiry) is CLOSED AS IS by default (saved
 *                      progress graded and kept, the same attempt never resumes) -- APPROVED D70; only when the
 *                      Teacher froze resumeAfterInactivity = true is it REVIVED (the same attempt, saved answers kept,
 *                      no extra attempt consumed);
 *   after the close    an attempt still in its continuous session continues (it may be finished after 21:00); one
 *                      whose session was left (no activity within ASSIGNMENT_LIVENESS_WINDOW_SECONDS), or one already
 *                      idle-expired, is CLOSED AS IS (answered graded, unanswered in the denominator).
 * A timed attempt past its deadline is the ordinary TIME_UP auto-submit, untouched. Every other session: OK.
 */
async function assignmentAttemptGate(row: SessionRow, setup: SubjectAssessmentSetup, state: LifecycleState, now: Date): Promise<'OK' | 'REVIVE' | 'CLOSE_AS_IS'> {
  if (setup.origin !== 'TEACHER' || !setup.assignmentWindow || !setup.timing.startedAt) return 'OK';
  const closed = now.getTime() >= new Date(setup.assignmentWindow.closesAt).getTime();
  const resumeAfterInactivity = setup.assignmentWindow.resumeAfterInactivity === true;
  if (state !== 'ACTIVE' || !closed) return decideAssignmentAttemptGate({ state, closed, resumeAfterInactivity, liveSession: true });
  const last = await lastActivityAt(row.id, setup);
  return decideAssignmentAttemptGate({ state, closed, resumeAfterInactivity, liveSession: !!last && now.getTime() - last.getTime() <= ASSIGNMENT_LIVENESS_WINDOW_SECONDS * 1000 });
}

/** D70: a CLOSE_AS_IS of an idle-expired attempt BEFORE the window close is an inactivity close (not a window close). */
function inactivityClose(setup: SubjectAssessmentSetup, state: LifecycleState, now: Date): boolean {
  return state === 'EXPIRED' && !!setup.assignmentWindow && now.getTime() < new Date(setup.assignmentWindow.closesAt).getTime();
}

async function reviveAssignmentAttempt(quizId: string, setup: SubjectAssessmentSetup, _studentId: string, now: Date): Promise<void> {
  await db.query(
    `UPDATE quiz_sessions SET status = 'active', expires_at = $2::timestamptz WHERE id = $1 AND status IN ('active', 'expired')`,
    [quizId, sessionExpiresAt(setup, now).toISOString()],
  );
}

/**
 * The runner's heartbeat for a TEACHER-assigned attempt in progress (every ~30 s while the attempt is open): records
 * the last activity, so the attempt may be finished after the window close while its session lives. Owner only (the
 * caller authorizes); any other session -> no-op.
 */
export async function heartbeatSubjectAssessmentSession(studentId: string, quizId: string): Promise<{ ok: true; data: { alive: boolean; state: LifecycleState } } | ServiceError> {
  const row = await loadSession(quizId);
  const setup = row ? readSetup(row.setup) : null;
  if (!row || row.student_id !== studentId || !setup) return fail(404, 'NOT_FOUND', 'Assessment not found.');
  const now = new Date(row.db_now);
  const state = lifecycleState(setup, row.status, new Date(row.expires_at), now);
  if (setup.origin !== 'TEACHER' || !setup.assignmentWindow) return { ok: true, data: { alive: state === 'ACTIVE', state } };
  const gate = await assignmentAttemptGate(row, setup, state, now);
  if (gate === 'CLOSE_AS_IS') {
    const closed = await submitSubjectAssessmentSession({ studentId, quizId });
    if (!closed.ok) return closed;
    return { ok: true, data: { alive: false, state: 'COMPLETED' } };
  }
  if (gate === 'REVIVE') await reviveAssignmentAttempt(quizId, setup, studentId, now);
  if (state !== 'ACTIVE' && gate !== 'REVIVE') return { ok: true, data: { alive: false, state } };
  await db.query(
    `UPDATE quiz_sessions SET subject_assessment_setup = subject_assessment_setup || jsonb_build_object('liveness', jsonb_build_object('lastActivityAt', $2::text))
      WHERE id = $1 AND status = 'active'`,
    [quizId, now.toISOString()],
  );
  return { ok: true, data: { alive: true, state: 'ACTIVE' } };
}

/**
 * Operator rule AB for a TEACHER-assigned attempt's final feedback: full when the assignment's versions are truly
 * diverse (or the window has closed); otherwise the score and general performance (per concept, concepts to
 * reinforce) now, and the per-question review (questions, answers, expected answers, explanations) held until the
 * window closes. Every other session: unchanged.
 */
async function applyFeedbackRelease(data: SubjectSubmissionData, setup: SubjectAssessmentSetup, now: Date): Promise<SubjectSubmissionData> {
  if (setup.origin !== 'TEACHER' || !setup.assignmentId || !setup.assignmentWindow) return data;
  const { resolveAssignmentFeedbackRelease } = await import('@/lib/teacher/subject-assessment-release.service');
  const release = await resolveAssignmentFeedbackRelease(setup.assignmentId, setup.assignmentWindow.closesAt, now);
  if (release.level === 'FULL') return { ...data, feedbackRelease: { level: 'FULL', reason: release.reason } };
  return { ...data, review: [], feedbackRelease: { level: 'SCORE_ONLY', reason: release.reason, releaseAt: release.releaseAt } };
}

/**
 * The state of one subject assessment for its Student. A timed attempt past its deadline is auto-submitted here
 * (server-side, lazily, on this read). Questions are only sent while the attempt is ACTIVE.
 */
export async function readSubjectAssessmentSession(studentId: string, quizId: string, deps: Partial<GeneratorDeps> = {}): Promise<{ ok: true; view: SubjectAssessmentView } | ServiceError> {
  const row = await loadSession(quizId);
  const setup = row ? readSetup(row.setup) : null;
  if (!row || row.student_id !== studentId || !setup) return fail(404, 'NOT_FOUND', 'Assessment not found.');
  const now = new Date(row.db_now);
  const state = lifecycleState(setup, row.status, new Date(row.expires_at), now);
  if (state === 'TIME_UP') {
    const sub = await submitSubjectAssessmentSession({ studentId, quizId }, deps);
    if (!sub.ok) return sub;
    return readSubjectAssessmentSession(studentId, quizId, deps);
  }
  const gate = await assignmentAttemptGate(row, setup, state, now);
  if (gate === 'CLOSE_AS_IS') {
    const closed = await submitSubjectAssessmentSession({ studentId, quizId }, deps);
    if (!closed.ok) return closed;
    return readSubjectAssessmentSession(studentId, quizId, deps);
  }
  if (gate === 'REVIVE') {
    await reviveAssignmentAttempt(quizId, setup, studentId, now);
    return readSubjectAssessmentSession(studentId, quizId, deps);
  }
  if (state === 'EXPIRED') await markExpired(quizId);
  const view: SubjectAssessmentView = { quizId, state, setup, expiresAt: new Date(row.expires_at).toISOString(), remainingSeconds: remainingSeconds(setup.timing, now) };
  if (state === 'ACTIVE') {
    const saved = await savedResponses(quizId);
    view.questions = row.questions.map((q, i) => toClientQuestion(q, i));
    view.answered = [...saved.entries()].map(([questionIndex, s]) => ({ questionIndex, ...(setup.feedbackPolicy === 'TEST_CORRECTNESS_ONLY' && s.grade ? { correct: s.grade.correct } : {}) }));
  }
  if (state === 'COMPLETED') view.results = await applyFeedbackRelease(await rebuildResults(row, setup), setup, now);
  return { ok: true, view };
}

// ------------------------------------------------------------------ start ----------------------------------------------------------------

/** Start a SCHEDULED assessment (any time before it expires: early start allowed). One attempt: a started / completed one is not restarted. */
export async function startSubjectAssessmentSession(studentId: string, quizId: string): Promise<{ ok: true; view: SubjectAssessmentView } | ServiceError> {
  const row = await loadSession(quizId);
  const setup = row ? readSetup(row.setup) : null;
  if (!row || row.student_id !== studentId || !setup) return fail(404, 'NOT_FOUND', 'Assessment not found.');
  const now = new Date(row.db_now);
  const state = lifecycleState(setup, row.status, new Date(row.expires_at), now);
  if (state === 'COMPLETED') return fail(409, 'ATTEMPT_ALREADY_USED', 'This assessment was already completed. Create a new one to try again.');
  if (state === 'EXPIRED') { await markExpired(quizId); return fail(410, 'ASSESSMENT_EXPIRED', 'This assessment expired (21:00 of its scheduled date, or 45 minutes without activity).'); }
  if (state !== 'SCHEDULED_NOT_STARTED') return readSubjectAssessmentSession(studentId, quizId); // already active: resume, never restart
  const started: SubjectAssessmentSetup = { ...setup, timing: startTiming(setup.timing, now) };
  const expiresAt = sessionExpiresAt(started, now);
  const upd = await db.query(
    `UPDATE quiz_sessions SET subject_assessment_setup = $2::jsonb, expires_at = $3::timestamptz
      WHERE id = $1 AND status = 'active' AND (subject_assessment_setup->'timing'->>'startedAt') IS NULL`,
    [quizId, JSON.stringify(started), expiresAt.toISOString()],
  );
  if ((upd.rowCount ?? 0) === 0) return readSubjectAssessmentSession(studentId, quizId); // a concurrent start won
  return readSubjectAssessmentSession(studentId, quizId);
}

// ------------------------------------------------------------------ answer ---------------------------------------------------------------

/**
 * Save one answer server-side while the attempt is ACTIVE. Test: graded now and only { correct } is returned (no
 * explanation, no hint, no answer); the first answer is final. Mock: saved, nothing returned about correctness (an
 * answer may be changed until the deadline). Past the deadline nothing is saved and the attempt is auto-submitted.
 */
export async function recordSubjectAssessmentAnswer(
  input: { studentId: string; quizId: string; questionIndex: number; answer: string },
  deps: Partial<GeneratorDeps> = {},
): Promise<{ ok: true; data: { saved: true; correct?: boolean; locked?: boolean } } | { ok: true; data: { timeUp: true; results: SubjectSubmissionData } } | ServiceError> {
  const row = await loadSession(input.quizId);
  const setup = row ? readSetup(row.setup) : null;
  if (!row || row.student_id !== input.studentId || !setup) return fail(404, 'NOT_FOUND', 'Assessment not found.');
  const now = new Date(row.db_now);
  const state = lifecycleState(setup, row.status, new Date(row.expires_at), now);
  if (state === 'TIME_UP') {
    const sub = await submitSubjectAssessmentSession({ studentId: input.studentId, quizId: input.quizId }, deps);
    if (!sub.ok) return sub;
    return { ok: true, data: { timeUp: true, results: sub.data } };
  }
  const gate = await assignmentAttemptGate(row, setup, state, now);
  if (gate === 'CLOSE_AS_IS') {
    const closed = await submitSubjectAssessmentSession({ studentId: input.studentId, quizId: input.quizId }, deps);
    if (!closed.ok) return closed;
    if (inactivityClose(setup, state, now)) return fail(409, 'INACTIVITY_CLOSED', 'This attempt was closed after 45 minutes without activity; the answers saved before were kept.', { state: 'COMPLETED' });
    return fail(409, 'WINDOW_CLOSED_AFTER_EXIT', 'The assignment window closed after this attempt was left; it was closed with the answers saved before.', { state: 'COMPLETED' });
  }
  if (gate === 'REVIVE') {
    await reviveAssignmentAttempt(input.quizId, setup, input.studentId, now);
    return recordSubjectAssessmentAnswer(input, deps);
  }
  if (state !== 'ACTIVE') return fail(409, 'SESSION_NOT_ACTIVE', `This assessment is ${state}.`, { state });
  const question = row.questions[input.questionIndex];
  if (!question) return fail(400, 'INVALID_INPUT', 'No such question.');
  const { questionFingerprint } = await import('@/services/quiz-response-audit.service');
  const evidenceMode = row.evidence_mode ?? evidenceModeForQuizMode(row.quiz_mode as never);

  // an untimed attempt in progress: each saved answer resets its 45-minute inactivity window (never shortens it)
  if (!setup.timing.timed) {
    await db.query(`UPDATE quiz_sessions SET expires_at = GREATEST(expires_at, $2::timestamptz) WHERE id = $1 AND status = 'active'`, [input.quizId, sessionExpiresAt(setup, now).toISOString()]);
  }

  if (setup.feedbackPolicy === 'MOCK_NONE') {
    await db.query(
      `INSERT INTO quiz_responses (quiz_session_id, question_index, question_id, question_fingerprint, question_type, answer_format,
                                   canonical_activity_type, evidence_mode, student_id, concept_id, student_answer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (quiz_session_id, question_index) DO UPDATE SET student_answer = EXCLUDED.student_answer, created_at = now()
       WHERE NOT EXISTS (SELECT 1 FROM quiz_response_grades g WHERE g.response_id = quiz_responses.id)`,
      [input.quizId, input.questionIndex, question.id ?? null, questionFingerprint(question), question.type, question.answerFormat ?? 'text',
        row.activity_type, evidenceMode, input.studentId, question.conceptId ?? null, input.answer],
    );
    return { ok: true, data: { saved: true } };
  }

  // TEST: the first answer is final; a repeat returns the recorded verdict.
  const existing = (await savedResponses(input.quizId)).get(input.questionIndex);
  if (existing?.grade) return { ok: true, data: { saved: true, correct: existing.grade.correct, locked: true } };
  const grade = await (deps.grade ?? defaultGrade)(question, input.answer, row.language, evidenceMode, { studentId: input.studentId, subjectId: row.subject_id });
  const { recordQuizResponses } = await import('@/services/quiz-response-audit.service');
  await recordQuizResponses({
    quizSessionId: input.quizId, studentId: input.studentId, canonicalActivityType: row.activity_type, evidenceMode, language: row.language,
    responses: [{ questionIndex: input.questionIndex, question, rawAnswer: existing?.answer ?? input.answer, gradeResult: grade as never }],
  });
  const recorded = (await savedResponses(input.quizId)).get(input.questionIndex);
  return { ok: true, data: { saved: true, correct: recorded?.grade?.correct ?? grade.correct } };
}

// ----------------------------------------------------------------- submit ----------------------------------------------------------------

export interface SubjectReviewItem {
  questionIndex: number; conceptId: string; conceptLabel: string; type: string; question: string; visualAid?: unknown;
  status: 'CORRECT' | 'INCORRECT' | 'UNANSWERED'; unanswered: boolean; correct: boolean; score: number;
  studentAnswer: string; correctAnswer: string; explanation: string; feedback: string; errorType: string | null;
  finalJudgment?: string; feedbackParts?: { didWell: string | null; missing: string[]; toFix: string | null };
}

export interface SubjectSubmissionData {
  quizId: string;
  results: { score: number; correctCount: number; incorrectCount: number; totalQuestions: number };
  subjectAssessment: {
    kind: SubjectAssessmentSetup['kind']; origin: SubjectAssessmentOrigin; assignmentId: string | null; attemptNumber: number | null;
    scorePercent: number; passed: boolean; passPercent: number; total: number; correct: number; incorrect: number; unanswered: number;
    perConcept: Array<{ conceptId: string; conceptLabel: string; total: number; correct: number; incorrect: number; unanswered: number; scorePercent: number; passed: boolean }>;
    conceptsToReinforce: Array<{ conceptId: string; conceptLabel: string }>;
    completionReason: CompletionReason;
    oneAttempt: boolean;
    /** Diagnostic knowledge bucket + per-difficulty scores (knowledge-bucket.ts), derived from the frozen items. */
    knowledge: KnowledgeProfile;
  };
  /** Teacher assignments (rule AB): FULL, or SCORE_ONLY with the per-question review held until `releaseAt`. */
  feedbackRelease?: { level: 'FULL'; reason: string } | { level: 'SCORE_ONLY'; reason: string; releaseAt: string };
  perConceptResults: Array<{ conceptId: string; conceptLabel: string; score: number; previousMastery?: number; newMastery?: number; delta?: number }>;
  review: SubjectReviewItem[];
  messageKey: 'excellent' | 'good' | 'keep_going';
  proveSufficiency: null; canonicalResults: null; canonicalResultsStatus: 'NOT_V1'; canonicalErrorCode: null;
  verificationNeeded: []; examReadinessCalibration: null;
}

function optionText(q: GeneratedQuestion, id: string): string { return q.options?.find((o) => o.id === id)?.text ?? id; }

/** Same display transforms as the legacy submission (generate-and-take/route.ts). */
export function formatAnswerForDisplay(q: GeneratedQuestion, raw: string | undefined): string {
  if (!raw) return '';
  try {
    switch (q.answerFormat) {
      case 'single_choice': return optionText(q, raw);
      case 'multi_choice': return raw.split(',').map((id) => optionText(q, id.trim())).filter(Boolean).join(', ');
      case 'matching': return Object.entries(JSON.parse(raw) as Record<string, string>).map(([l, r]) => `${l} → ${r}`).join('; ');
      case 'ordering': return (JSON.parse(raw) as string[]).join(' → ');
      case 'classification': return Object.entries(JSON.parse(raw) as Record<string, string>).map(([i, c]) => `${i}: ${c}`).join('; ');
      default: return raw;
    }
  } catch { return raw; }
}
export function correctAnswerForDisplay(q: GeneratedQuestion): string {
  switch (q.answerFormat) {
    case 'single_choice': return optionText(q, q.correctAnswer);
    case 'multi_choice': return q.correctAnswer.split(',').map((id) => optionText(q, id.trim())).join(', ');
    case 'matching': return (q.matchingPairs || []).map((p) => `${p.left} → ${p.right}`).join('; ');
    case 'ordering': return (q.orderingItems || []).join(' → ');
    case 'classification': return (q.classificationItems || []).map((it) => `${it.item}: ${it.category}`).join('; ');
    default: return q.correctAnswer;
  }
}

async function conceptLabels(ids: string[], language: string): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const r = await db.query(
    `SELECT c.id, c.canonical_id, cl.label FROM concepts c
       LEFT JOIN LATERAL (SELECT label FROM concept_localizations WHERE concept_id = c.id ORDER BY (language = $2) DESC LIMIT 1) cl ON true
      WHERE c.id = ANY($1::uuid[])`,
    [ids, language],
  );
  return new Map(r.rows.map((x: { id: string; label: string | null; canonical_id: string }) => [x.id, x.label || x.canonical_id]));
}

export interface SubmitAnswerInput { questionIndex: number; answer: string; confidence?: 'NOT_SURE' | 'SOMEWHAT_SURE' | 'VERY_SURE'; questionPresentedAt?: string; answerSubmittedAt?: string }

/**
 * Close the attempt: grade every answered item (saved server-side, or sent now while the attempt is still within its
 * time), count every unanswered item as UNANSWERED in the denominator, write one learning_evidence row per concept
 * (CUMULATIVE_ASSESSMENT / MOCK_EXAM, scorePercent = that concept's score), and close the session. Called by the submit
 * route, by the lazy TIME_UP auto-submit on a read / answer, and by the scenario. Idempotent per (session, concept).
 */
export async function submitSubjectAssessmentSession(
  input: { studentId: string; quizId: string; answers?: SubmitAnswerInput[] },
  deps: Partial<GeneratorDeps> = {},
): Promise<{ ok: true; alreadySubmitted?: boolean; data: SubjectSubmissionData } | ServiceError> {
  const row = await loadSession(input.quizId);
  const setup = row ? readSetup(row.setup) : null;
  if (!row || row.student_id !== input.studentId || !setup) return fail(404, 'NOT_FOUND', 'Assessment not found.');
  const now = new Date(row.db_now);
  const state = lifecycleState(setup, row.status, new Date(row.expires_at), now);
  if (state === 'COMPLETED') return { ok: true, alreadySubmitted: true, data: await applyFeedbackRelease(await rebuildResults(row, setup), setup, now) };
  if (state === 'SCHEDULED_NOT_STARTED') return fail(409, 'ASSESSMENT_NOT_STARTED', 'Start this assessment before submitting it.');
  // a teacher-assigned attempt: left across the window close -> closed as is (client answers not saved before do not
  // count); idle before the close -> the same attempt continues
  const gate = state === 'TIME_UP' ? 'OK' : await assignmentAttemptGate(row, setup, state, now);
  if (state === 'EXPIRED' && gate === 'OK') { await markExpired(input.quizId); return fail(410, 'SESSION_EXPIRED', 'This assessment expired; no result was recorded.'); }
  const closedAsIs = gate === 'CLOSE_AS_IS';
  const timeUp = state === 'TIME_UP' || closedAsIs;
  const reason: CompletionReason = closedAsIs ? (inactivityClose(setup, state, now) ? 'INACTIVITY_CLOSED' : 'WINDOW_CLOSED_AFTER_EXIT') : state === 'TIME_UP' ? 'TIME_UP_AUTO_SUBMIT' : 'SUBMITTED';

  const saved = await savedResponses(input.quizId);
  const evidenceMode = row.evidence_mode ?? evidenceModeForQuizMode(row.quiz_mode as never);
  const activityType = row.activity_type ?? activityTypeForQuizMode(row.quiz_mode as never);
  const grade = deps.grade ?? defaultGrade;
  // answers: saved server-side answers are authoritative (Test's first answer is final); a client answer only fills a
  // gap while the attempt is within its time. Past the deadline only answers saved before the deadline count.
  const clientByIndex = new Map((input.answers ?? []).map((a) => [a.questionIndex, a]));
  type Graded = { questionIndex: number; question: GeneratedQuestion; raw: string | null; grade: GradeResultLike | null; fresh: boolean; timing: ResponseTiming; confidence?: SubmitAnswerInput['confidence'] };
  const graded: Graded[] = await Promise.all(row.questions.map(async (question, questionIndex): Promise<Graded> => {
    const s = saved.get(questionIndex);
    const c = clientByIndex.get(questionIndex);
    const timing = normalizeResponseTiming({ questionPresentedAt: c?.questionPresentedAt, answerSubmittedAt: c?.answerSubmittedAt });
    const sCounts = s && answerCountsAt(setup.timing, s.answeredAt);
    if (s && sCounts && s.grade) return { questionIndex, question, raw: s.answer, grade: s.grade, fresh: false, timing, confidence: c?.confidence };
    const raw = s && sCounts ? s.answer : !timeUp && c && c.answer.trim().length > 0 ? c.answer : null;
    if (raw === null) return { questionIndex, question, raw: null, grade: null, fresh: false, timing };
    const g = await grade(question, raw, row.language, evidenceMode, { studentId: input.studentId, subjectId: row.subject_id });
    return { questionIndex, question, raw, grade: g, fresh: true, timing, confidence: c?.confidence };
  }));

  // the audit rows for every newly graded answer (verbatim answer + grade), before the evidence
  const fresh = graded.filter((g) => g.fresh && g.grade && g.raw !== null);
  if (fresh.length > 0) {
    const { recordQuizResponses } = await import('@/services/quiz-response-audit.service');
    await recordQuizResponses({
      quizSessionId: input.quizId, studentId: input.studentId, canonicalActivityType: activityType, evidenceMode, language: row.language,
      responses: fresh.map((g) => ({ questionIndex: g.questionIndex, question: g.question, rawAnswer: g.raw as string, gradeResult: g.grade as never })),
    }).catch((e) => console.error('[subject-assessment] response audit failed', e));
  }

  const config = QUIZ_MODE_CONFIG[row.quiz_mode as 'cumulative_assessment' | 'exam_simulation'];
  // real mistakes feed error intelligence (not an incomplete-but-right answer), as the legacy submission does
  const { recordError } = await import('@/services/error-intelligence.service');
  await Promise.all(fresh.filter((g) => g.grade && !g.grade.correct && g.grade.errorType && (g.grade.pedagogical ? isRecordableError(g.grade.pedagogical) : true)).map((g) =>
    recordError({ studentId: input.studentId, conceptId: g.question.conceptId, subjectId: row.subject_id, errorType: g.grade!.errorType as never, sourceType: config.evidenceSource }).catch(() => {}),
  ));

  const items: GradedItem[] = graded.map((g) => ({ questionIndex: g.questionIndex, conceptId: g.question.conceptId, correct: g.grade ? g.grade.correct : null, score: g.grade ? g.grade.score : null }));
  const report = buildSubjectReport(items);
  const labels = await conceptLabels(setup.selectedConceptIds, row.language);

  // one learning_evidence row per concept: scorePercent = the concept's score with UNANSWERED in the denominator
  const { updateMastery } = await import('@/services/mastery.service');
  const perConceptResults: SubjectSubmissionData['perConceptResults'] = [];
  for (const pc of report.perConcept) {
    const mine = graded.filter((g) => g.question.conceptId === pc.conceptId);
    const evidence: LearningEvidence = {
      result: subjectAssessmentPassed(pc.scorePercent) ? 'correct' : pc.scorePercent >= 50 ? 'partial' : 'incorrect',
      difficulty: aggregateEvidenceDifficulty(mine.map((g) => g.question.difficulty)),
      sourceType: config.evidenceSource,
      confidenceWeight: 0.9,
      scorePercent: pc.scorePercent,
      sampleSize: pc.total,
    };
    const aiGrading = mine.filter((g) => g.grade?.aiExecution).map((g) => ({ questionIndex: g.questionIndex, ...g.grade!.aiExecution }));
    const pedagogicalGrades = mine.filter((g) => g.grade?.pedagogical).map((g) => ({
      questionIndex: g.questionIndex, finalJudgment: g.grade!.pedagogical!.finalJudgment, learnerSignal: g.grade!.pedagogical!.learnerSignal, misconception: g.grade!.pedagogical!.misconception,
    }));
    const r = await updateMastery({
      studentId: input.studentId,
      conceptId: pc.conceptId,
      subjectId: row.subject_id,
      evidence,
      identity: { operationType: 'QUIZ_SUBMISSION', operationId: input.quizId, conceptId: pc.conceptId },
      telemetry: { activityType: 'quiz', learningMode: 'SOLO', hintsUsed: 0, confidenceBeforeAnswer: mine.find((g) => g.confidence)?.confidence },
      metadata: withBehaviorMetadata(
        {
          activityType,
          evidenceMode,
          origin: setup.origin,
          ...(setup.assignmentId ? { assignmentId: setup.assignmentId } : {}),
          ...(setup.attemptNumber ? { attemptNumber: setup.attemptNumber } : {}),
          scorePercent: pc.scorePercent,
          subjectAssessment: {
            version: setup.version,
            kind: setup.kind,
            explicitlyMock: setup.kind === 'SUBJECT_MOCK_EXAM',
            origin: setup.origin,
            assignmentId: setup.assignmentId ?? null,
            attemptNumber: setup.attemptNumber ?? null,
            quizSessionId: input.quizId,
            conceptScorePercent: pc.scorePercent,
            conceptTotal: pc.total,
            conceptCorrect: pc.correct,
            conceptUnanswered: pc.unanswered,
            sessionScorePercent: report.scorePercent,
            sessionPassed: report.passed,
            completionReason: reason,
            rule: setup.rule,
          },
          ...(aiGrading.length > 0 ? { aiGrading } : {}),
          ...(pedagogicalGrades.length > 0 ? { gradingModel: 'PEDAGOGICAL_V1', pedagogicalGrades } : {}),
        },
        toResponseTimingEntries(mine.filter((g) => g.raw !== null).map((g) => ({ questionIndex: g.questionIndex, timing: g.timing }))),
      ),
    });
    perConceptResults.push({ conceptId: pc.conceptId, conceptLabel: labels.get(pc.conceptId) ?? pc.conceptId, score: pc.scorePercent, previousMastery: r.oldMastery, newMastery: r.newMastery, delta: r.delta });
  }

  const knowledge = knowledgeProfile(graded.map((g) => ({ conceptId: g.question.conceptId, level: itemLevel(g.question), correct: g.grade ? g.grade.correct : null })));
  const completion = { completedAt: now.toISOString(), reason, scorePercent: report.scorePercent, passed: report.passed, knowledge };
  await completeQuiz(input.quizId);
  await db.query(`UPDATE quiz_sessions SET subject_assessment_setup = subject_assessment_setup || jsonb_build_object('completion', $2::jsonb) WHERE id = $1`, [input.quizId, JSON.stringify(completion)]);

  const data = buildSubmissionData(input.quizId, row, { ...setup, completion }, graded.map((g) => ({ questionIndex: g.questionIndex, raw: g.raw, grade: g.grade })), labels);
  data.perConceptResults = perConceptResults;
  return { ok: true, data: await applyFeedbackRelease(data, setup, now) };
}

/**
 * The final feedback of a COMPLETED subject assessment for an already-authorized STAFF reader (the Teacher's
 * drill-down of their own assignment): full detail, never the Student's release gate. The caller must have authorized
 * the reader for this Student AND this assignment; this function checks nothing but the session itself.
 */
export async function readCompletedSubjectAssessmentForStaff(quizId: string): Promise<{ setup: SubjectAssessmentSetup; studentId: string; data: SubjectSubmissionData; questions: GeneratedQuestion[] } | null> {
  const row = await loadSession(quizId);
  const setup = row ? readSetup(row.setup) : null;
  if (!row || !setup || row.status !== 'completed') return null;
  return { setup, studentId: row.student_id, data: await rebuildResults(row, setup), questions: row.questions };
}

function buildSubmissionData(
  quizId: string, row: Pick<SessionRow, 'questions' | 'language'>, setup: SubjectAssessmentSetup,
  graded: Array<{ questionIndex: number; raw: string | null; grade: GradeResultLike | null }>, labels: Map<string, string>,
): SubjectSubmissionData {
  const items: GradedItem[] = graded.map((g) => ({ questionIndex: g.questionIndex, conceptId: row.questions[g.questionIndex].conceptId, correct: g.grade ? g.grade.correct : null, score: g.grade?.score ?? null }));
  const report = buildSubjectReport(items);
  const label = (id: string) => labels.get(id) ?? id;
  const review: SubjectReviewItem[] = graded.map((g) => {
    const q = row.questions[g.questionIndex];
    const p = g.grade?.pedagogical;
    const text = p ? pedagogicalFeedbackText(p, row.language) : null;
    return {
      questionIndex: g.questionIndex, conceptId: q.conceptId, conceptLabel: label(q.conceptId), type: q.type, question: q.question, visualAid: q.visualAid,
      status: g.grade === null ? 'UNANSWERED' : g.grade.correct ? 'CORRECT' : 'INCORRECT', unanswered: g.grade === null, correct: !!g.grade?.correct, score: g.grade?.score ?? 0,
      studentAnswer: formatAnswerForDisplay(q, g.raw ?? undefined), correctAnswer: correctAnswerForDisplay(q), explanation: q.explanation,
      feedback: g.grade?.feedback ?? '', errorType: g.grade?.errorType ?? null,
      ...(p ? { finalJudgment: p.finalJudgment, feedbackParts: { didWell: text!.didWell, missing: text!.missing, toFix: text!.toFix } } : {}),
    };
  });
  return {
    quizId,
    results: { score: Math.round(report.scorePercent), correctCount: report.correct, incorrectCount: report.incorrect, totalQuestions: report.total },
    subjectAssessment: {
      kind: setup.kind, origin: setup.origin, assignmentId: setup.assignmentId ?? null, attemptNumber: setup.attemptNumber ?? null,
      scorePercent: report.scorePercent, passed: report.passed, passPercent: SUBJECT_ASSESSMENT_PASS_PERCENT,
      total: report.total, correct: report.correct, incorrect: report.incorrect, unanswered: report.unanswered,
      perConcept: report.perConcept.map((c) => ({ ...c, conceptLabel: label(c.conceptId) })),
      conceptsToReinforce: report.conceptsToReinforce.map((id) => ({ conceptId: id, conceptLabel: label(id) })),
      completionReason: setup.completion?.reason ?? 'SUBMITTED',
      oneAttempt: setup.origin === 'STUDENT',
      // derived at read time from the frozen items + recorded grades (rows completed before 2026-10-17 included)
      knowledge: knowledgeProfile(items.map((it) => ({ conceptId: it.conceptId, level: itemLevel(row.questions[it.questionIndex]), correct: it.correct }))),
    },
    perConceptResults: report.perConcept.map((c) => ({ conceptId: c.conceptId, conceptLabel: label(c.conceptId), score: c.scorePercent })),
    review,
    messageKey: report.passed ? 'excellent' : report.scorePercent >= 50 ? 'good' : 'keep_going',
    proveSufficiency: null, canonicalResults: null, canonicalResultsStatus: 'NOT_V1', canonicalErrorCode: null,
    verificationNeeded: [], examReadinessCalibration: null,
  };
}

/** The final feedback of a completed attempt, rebuilt from the frozen questions and the recorded grades. */
async function rebuildResults(row: SessionRow, setup: SubjectAssessmentSetup): Promise<SubjectSubmissionData> {
  const saved = await savedResponses(row.id);
  const graded = row.questions.map((_, questionIndex) => {
    const s = saved.get(questionIndex);
    return { questionIndex, raw: s?.grade && answerCountsAt(setup.timing, s.answeredAt) ? s.answer : null, grade: s?.grade && answerCountsAt(setup.timing, s.answeredAt) ? s.grade : null };
  });
  return buildSubmissionData(row.id, row, setup, graded, await conceptLabels(setup.selectedConceptIds, row.language));
}

// ------------------------------------------------------------------ list -----------------------------------------------------------------

export interface SubjectAssessmentListItem {
  quizId: string; subjectId: string; kind: SubjectAssessmentSetup['kind']; origin: SubjectAssessmentOrigin; state: LifecycleState;
  scheduledDate: string | null; expiresAt: string; questionCount: number; conceptCount: number; timed: boolean; durationMinutes: number | null;
  remainingSeconds: number | null; scorePercent: number | null; passed: boolean | null; createdAt: string;
}

/**
 * The Student's OWN subject assessments (scheduled, open, and the last completed / expired ones) -- "Mis evaluaciones
 * programadas". Teacher-assigned attempts are listed with their assignment (window, attempts) on the Student's
 * assignments page instead (src/lib/teacher/subject-assessment-assignment.service.ts), never here.
 */
export async function listStudentSubjectAssessments(studentId: string, subjectId?: string | null, limit = 20, finalizeTimeUp = true): Promise<SubjectAssessmentListItem[]> {
  let rows: Array<{ id: string; subject_id: string; status: string; expires_at: string; created_at: string; db_now: string; setup: unknown }> = [];
  try {
    const r = await db.query(
      `SELECT id, subject_id, status, expires_at, created_at, now() AS db_now, subject_assessment_setup AS setup
         FROM quiz_sessions
        WHERE student_id = $1 AND quiz_mode IN ('cumulative_assessment', 'exam_simulation')
          AND subject_assessment_setup->>'version' = 'subject-assessment-v2'
          AND COALESCE(subject_assessment_setup->>'origin', 'STUDENT') <> 'TEACHER'
          AND ($2::uuid IS NULL OR subject_id = $2::uuid)
        ORDER BY created_at DESC LIMIT $3`,
      [studentId, subjectId ?? null, limit],
    );
    rows = r.rows;
  } catch (e) {
    if ((e as { code?: string })?.code === '42703') return [];
    throw e;
  }
  // a read: a timed attempt whose time ran out is auto-submitted now (lazily), then listed as COMPLETED
  const timeUp = rows.filter((row) => { const st = readSetup(row.setup); return !!st && lifecycleState(st, row.status, new Date(row.expires_at), new Date(row.db_now)) === 'TIME_UP'; });
  if (finalizeTimeUp && timeUp.length > 0) {
    for (const row of timeUp) await submitSubjectAssessmentSession({ studentId, quizId: row.id }).catch((e) => console.error('[subject-assessment] lazy auto-submit failed', row.id, e));
    return listStudentSubjectAssessments(studentId, subjectId, limit, false);
  }
  return rows.flatMap((row) => {
    const setup = readSetup(row.setup);
    if (!setup) return [];
    const now = new Date(row.db_now);
    const state = lifecycleState(setup, row.status, new Date(row.expires_at), now);
    return [{
      quizId: row.id, subjectId: row.subject_id, kind: setup.kind, origin: setup.origin, state,
      scheduledDate: setup.schedule.mode === 'SCHEDULED' ? setup.schedule.date : null, expiresAt: new Date(row.expires_at).toISOString(),
      questionCount: setup.questionCount, conceptCount: setup.selectedConceptIds.length, timed: setup.timing.timed, durationMinutes: setup.timing.durationMinutes,
      remainingSeconds: remainingSeconds(setup.timing, now), scorePercent: setup.completion?.scorePercent ?? null, passed: setup.completion?.passed ?? null,
      createdAt: new Date(row.created_at).toISOString(),
    }];
  });
}
