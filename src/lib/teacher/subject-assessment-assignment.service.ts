/**
 * Teacher-assigned subject Test ("Prueba por materia") / subject Mock ("Simulacro por materia") -- overnight
 * 2026-10-16, contract docs/orchestration/OVERNIGHT_2026-10-16_CONTRACTS.md section 3. Rules (pure):
 * subject-assessment-assignment.rules.ts. Sessions: the subject service (src/services/subject-assessment.service.ts),
 * the ONE creation / answer / submission / evidence path -- this file never grades, never writes evidence.
 *
 *   previewSubjectAssessmentAssignment  the group plan (planGroupAssessment), the StudyUs recommended duration, the
 *                                       window in the institution's timezone -- nothing written
 *   publishSubjectAssessmentAssignment  one teacher_interventions row per recipient (SUBJECT_TEST / SUBJECT_MOCK,
 *                                       grouped, idempotent) through the certified assignTeacherIntervention; the
 *                                       frozen configuration on every row
 *   startSubjectAssignmentAttempt       Student (owner only): resume the active attempt, or generate attempt n for
 *                                       THIS student (own unseen items, avoiding the group's and the previous
 *                                       attempt's) with the group's frozen plan
 *   listStudentSubjectAssignments       the Student's assigned Tests / Mocks: window, attempts used / max, actions,
 *                                       result = the latest completed attempt, history
 *   listClassSubjectAssessmentAssignments / getSubjectAssessmentGroupResults / getSubjectAssessmentStudentResult
 *                                       the Teacher's group view and per-student drill-down (classes they teach only)
 *
 * Linking: every attempt is a quiz_sessions row whose subject_assessment_setup.assignmentId = the RECIPIENT's
 * teacher_interventions.id (one per student; the group is that row's assignment_group_id) and attemptNumber 1..max,
 * registered in teacher_intervention_executions (execution_type SUBJECT_ASSESSMENT, idempotency key attempt:<n> -- the
 * concurrency guard for starting attempt n).
 */
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { canTeacherAccessLearner, isOwner } from '@/lib/authorization';
import { fingerprintQuestion } from '@/lib/lx/exact-duplicate-novelty';
import { notifyUser } from '@/lib/notifications/role-notifications.service';
import { planGroupAssessment, subjectAssessmentPassed, SUBJECT_ASSESSMENT_PASS_PERCENT } from '@/lib/subject-assessment/sizing';
import { bandLevelCounts, feedbackPolicyFor, normalizeDifficultyBand, recommendedMockDurationMinutes, readSetup, type LegacyDifficultyBand } from '@/lib/subject-assessment/lifecycle';
import { knowledgeProfile } from '@/lib/subject-assessment/knowledge-bucket';
import { ensureConceptInLearnerPlan } from './plan-enrollment.service';
import { assignTeacherIntervention, TeacherInterventionAccessDeniedError } from './intervention.service';
import { isTeacherOfClass, resolvePublishRecipients, TeacherClassAccessDeniedError, InvalidClassAssignmentError } from './class-assignment.service';
import { loadGroupServedItems } from './subject-assessment-release.service';
import {
  INTERVENTION_TYPE_OF, MAX_ATTEMPTS_LIMIT, UI_DIFFICULTY_TO_BAND, WINDOW_CLOSE_HOUR, aggregateGroup, buildAssignmentWindow, decideAttemptAction,
  effectiveAssignmentStatus, kindOfInterventionType, latestCompletedAttempt, planForLearner, validateTiming, validateResumeAfterInactivity, resumeAfterInactivityApplies, recipientTimezoneAuthority, recipientAssignmentWindow, windowPhase,
  type AttemptDecision, type AttemptSummary, type AssignmentEffectiveStatus, type DifficultyBand, type StudentLatestReport, type SubjectAssessmentAssignmentConfig,
  type SubjectAssignmentKind,
} from './subject-assessment-assignment.rules';

export class SubjectAssignmentError extends Error {
  constructor(public readonly code: string, public readonly status: number = 422, public readonly detail?: Record<string, unknown>) {
    super(code);
    this.name = 'SubjectAssignmentError';
  }
}

const SUBJECT_TYPES_SQL = `('SUBJECT_TEST', 'SUBJECT_MOCK')`;

async function dbNow(): Promise<Date> {
  return new Date((await db.query(`SELECT now() AS now`)).rows[0].now);
}

// ----------------------------------------------------------------- context ---------------------------------------------------------------

interface ClassContext { classId: string; className: string; institutionId: string; subjectId: string | null; subjectName: string | null; timezone: string | null }

/** The class as its TEACHER sees it (never an institution admin), with the institution's timezone (the window authority). */
async function teacherClassContext(actorUserId: string, classId: string): Promise<ClassContext> {
  if (!(await isTeacherOfClass(actorUserId, classId))) throw new TeacherClassAccessDeniedError(classId);
  const r = await db.query(
    `SELECT c.id, c.name, c.institution_id, c.canonical_subject_id, cs.name AS subject_name, i.timezone
       FROM classes c JOIN institutions i ON i.id = c.institution_id LEFT JOIN canonical_subjects cs ON cs.id = c.canonical_subject_id
      WHERE c.id = $1`,
    [classId]
  );
  const row = r.rows[0];
  if (!row) throw new TeacherClassAccessDeniedError(classId);
  return { classId: row.id, className: row.name, institutionId: row.institution_id, subjectId: row.canonical_subject_id ?? null, subjectName: row.subject_name ?? null, timezone: row.timezone ?? null };
}

/** The eligible concepts of the class's subject: its ACTIVE catalog concepts (the same set the class assignment composer offers). */
async function eligibleConcepts(subjectId: string): Promise<Array<{ id: string; name: string }>> {
  const r = await db.query(`SELECT id, name FROM canonical_concepts WHERE canonical_subject_id = $1 AND status = 'ACTIVE' ORDER BY name, id`, [subjectId]);
  return r.rows.map((x: any) => ({ id: x.id, name: x.name }));
}

// ---------------------------------------------------------------- planning ---------------------------------------------------------------

export interface SubjectAssignmentDraft {
  classId: string;
  kind: SubjectAssignmentKind;
  /** Canonical concept ids of the class's subject (>= 1). */
  conceptIds: string[];
  /** Básico / Intermedio / Avanzado / Mixto, or the band itself (legacy LOW / MEDIUM / HIGH read as the approved names). */
  difficulty: keyof typeof UI_DIFFICULTY_TO_BAND | DifficultyBand | LegacyDifficultyBand;
  startDate: string;
  endDate: string;
  maxAttempts: number;
  /** TEST: timed or untimed; MOCK: always timed. durationMinutes null = the StudyUs recommendation. */
  timing: { timed: boolean; durationMinutes: number | null; resumeAfterInactivity?: boolean };
}

export interface SubjectAssignmentPreview {
  kind: SubjectAssignmentKind;
  subjectId: string;
  subjectName: string | null;
  conceptIds: string[];
  allSubject: boolean;
  difficultyBand: DifficultyBand;
  plan: SubjectAssessmentAssignmentConfig['plan'];
  timing: SubjectAssessmentAssignmentConfig['timing'];
  maxAttempts: number;
  window: SubjectAssessmentAssignmentConfig['window'];
  closesAtLocal: { time: string; timezone: string };
  feedbackPolicy: SubjectAssessmentAssignmentConfig['feedbackPolicy'];
}

const toBand = (d: string): DifficultyBand | null => (d in UI_DIFFICULTY_TO_BAND ? UI_DIFFICULTY_TO_BAND[d as keyof typeof UI_DIFFICULTY_TO_BAND] : normalizeDifficultyBand(d));

/**
 * StudyUs recommended duration BEFORE generation -- the approved planning estimate (APPROVED 2026-10-17): the subject
 * service's nominal recommendation (NOMINAL_RESPONSE_TIME_SUM, difficulty-adjusted) over the PLANNED items -- the
 * planned count at the band's approved level counts (MIXED 30 / 50 / 20). The item types are not known before
 * generation, so each item is planned with nominal-response-time's own default for an unnamed type (an open response).
 * Advisory: the Teacher's chosen duration is authoritative and frozen on the assignment for the whole group.
 */
export function recommendedDurationForPlan(questionCount: number, band: DifficultyBand): { minutes: number; rule: string } {
  const items = bandLevelCounts(band, questionCount).flatMap(({ level, count }) => Array.from({ length: count }, () => ({ type: 'PLANNED_UNSPECIFIED_TYPE', difficulty: level })));
  const rec = recommendedMockDurationMinutes(items);
  return { minutes: Math.max(1, rec.minutes), rule: `${rec.rule}:PLANNED_ITEMS_DEFAULT_TYPE` };
}

/** Validate the draft and build the group configuration (no learner part). Pure over its inputs except `now`. */
export function buildGroupConfig(draft: SubjectAssignmentDraft, ctx: { subjectId: string; eligible: string[]; timezone: string | null }, now: Date): { ok: true; config: SubjectAssessmentAssignmentConfig } | { ok: false; error: string } {
  if (draft.kind !== 'TEST' && draft.kind !== 'MOCK') return { ok: false, error: 'INVALID_KIND' };
  const conceptIds = [...new Set(draft.conceptIds)];
  if (conceptIds.length === 0) return { ok: false, error: 'NO_CONCEPTS_SELECTED' };
  if (conceptIds.some((c) => !ctx.eligible.includes(c))) return { ok: false, error: 'CONCEPT_NOT_IN_CLASS_SUBJECT' };
  const band = toBand(String(draft.difficulty));
  if (!band) return { ok: false, error: 'DIFFICULTY_INVALID' };
  if (!Number.isInteger(draft.maxAttempts) || draft.maxAttempts < 1 || draft.maxAttempts > MAX_ATTEMPTS_LIMIT) return { ok: false, error: 'MAX_ATTEMPTS_INVALID' };
  const t = validateTiming(draft.kind, draft.timing);
  if (!t.ok) return { ok: false, error: t.error };
  const resume = validateResumeAfterInactivity(draft.kind, draft.timing.timed, draft.timing.resumeAfterInactivity);
  if (!resume.ok) return { ok: false, error: resume.error };
  const w = buildAssignmentWindow({ startDate: draft.startDate, endDate: draft.endDate }, ctx.timezone, now);
  if (!w.ok) return { ok: false, error: w.error };
  // keep the subject's order (stable distribution), never the click order
  const ordered = ctx.eligible.filter((c) => conceptIds.includes(c));
  const allSubject = ctx.eligible.length > 0 && ctx.eligible.every((c) => conceptIds.includes(c));
  const p = planGroupAssessment(draft.kind, ordered, allSubject);
  if (p.uncovered.length > 0 || p.questionCount < 1) return { ok: false, error: 'TOO_MANY_CONCEPTS' };
  const rec = draft.timing.timed ? recommendedDurationForPlan(p.questionCount, band) : null;
  const durationMinutes = draft.timing.timed ? draft.timing.durationMinutes ?? rec!.minutes : null;
  return {
    ok: true,
    config: {
      version: 'teacher-subject-assessment-v1',
      kind: draft.kind,
      subjectId: ctx.subjectId,
      conceptIds: ordered,
      allSubject,
      difficultyBand: band,
      plan: { questionCount: p.questionCount, distribution: p.distribution, rule: p.rule },
      timing: {
        timed: draft.timing.timed,
        durationMinutes,
        recommendedDurationMinutes: rec?.minutes ?? null,
        recommendationRule: rec?.rule ?? null,
        durationSource: !draft.timing.timed ? null : draft.timing.durationMinutes === null || draft.timing.durationMinutes === rec!.minutes ? 'STUDYUS_RECOMMENDED' : 'TEACHER_ADJUSTED',
        resumeAfterInactivity: resume.value,
      },
      maxAttempts: draft.maxAttempts,
      window: w.window,
      feedbackPolicy: feedbackPolicyFor(draft.kind),
      feedbackRelease: 'DIVERSE_IMMEDIATE_ELSE_AT_CLOSE',
      attemptLink: 'INTERVENTION_ID',
      frozenAt: now.toISOString(),
    },
  };
}

function toPreview(config: SubjectAssessmentAssignmentConfig, subjectName: string | null): SubjectAssignmentPreview {
  return {
    kind: config.kind, subjectId: config.subjectId, subjectName, conceptIds: config.conceptIds, allSubject: config.allSubject, difficultyBand: config.difficultyBand,
    plan: config.plan, timing: config.timing, maxAttempts: config.maxAttempts, window: config.window,
    closesAtLocal: { time: `${String(WINDOW_CLOSE_HOUR).padStart(2, '0')}:00`, timezone: config.window.timezone }, feedbackPolicy: config.feedbackPolicy,
  };
}

/** What the composer offers: the class's subject, its eligible concepts (all ON by default), and the timezone authority. */
export async function getSubjectAssessmentComposerContext(actorUserId: string, classId: string): Promise<{ subjectId: string | null; subjectName: string | null; concepts: Array<{ id: string; name: string }>; timezone: string | null; timezoneBlocker: boolean; activeLearners: Array<{ id: string; name: string }> }> {
  const ctx = await teacherClassContext(actorUserId, classId);
  const concepts = ctx.subjectId ? await eligibleConcepts(ctx.subjectId) : [];
  const learners = await db.query(`SELECT s.id, COALESCE(s.name, s.email, '') AS name FROM class_enrollments ce JOIN students s ON s.id = ce.student_id WHERE ce.class_id = $1 AND ce.status = 'ACTIVE' ORDER BY s.name NULLS LAST, s.email`, [classId]);
  const referenceTz = await groupReferenceTimezone(classId, ctx.timezone);
  return { subjectId: ctx.subjectId, subjectName: ctx.subjectName, concepts, timezone: referenceTz, timezoneBlocker: !buildAssignmentWindow({ startDate: '2000-01-01', endDate: '2999-01-01' }, referenceTz, new Date(0)).ok, activeLearners: learners.rows.map((l: any) => ({ id: l.id, name: l.name })) };
}

export async function previewSubjectAssessmentAssignment(actorUserId: string, draft: SubjectAssignmentDraft, deps: { now?: Date } = {}): Promise<SubjectAssignmentPreview> {
  const ctx = await teacherClassContext(actorUserId, draft.classId);
  if (!ctx.subjectId) throw new InvalidClassAssignmentError('CLASS_SUBJECT_REQUIRED');
  const eligible = (await eligibleConcepts(ctx.subjectId)).map((c) => c.id);
  const built = buildGroupConfig(draft, { subjectId: ctx.subjectId, eligible, timezone: await groupReferenceTimezone(draft.classId, ctx.timezone) }, deps.now ?? (await dbNow()));
  if (!built.ok) throw new SubjectAssignmentError(built.error, built.error === 'TIMEZONE_AUTHORITY_BLOCKER' ? 409 : 422);
  return toPreview(built.config, ctx.subjectName);
}

/** D71: each recipient's timezone authority -- student_availability.timezone first, else the class institution's. */
async function recipientTimezones(studentIds: string[], classInstitutionTimezone: string | null): Promise<Map<string, ReturnType<typeof recipientTimezoneAuthority>>> {
  const own = studentIds.length
    ? await db.query(`SELECT student_id, timezone FROM student_availability WHERE student_id = ANY($1::uuid[])`, [studentIds]).catch(() => ({ rows: [] as Array<{ student_id: string; timezone: string | null }> }))
    : { rows: [] as Array<{ student_id: string; timezone: string | null }> };
  const byId = new Map<string, string | null>(own.rows.map((r: any) => [r.student_id, r.timezone ?? null]));
  return new Map(studentIds.map((id) => [id, recipientTimezoneAuthority(byId.get(id) ?? null, classInstitutionTimezone)]));
}

/**
 * The group's reference timezone (composer + preview; every recipient still gets their own window at publish): the
 * class institution's; else -- only when EVERY active learner of the class has their own timezone -- the first one's;
 * else null (TIMEZONE_AUTHORITY_BLOCKER). Never guessed.
 */
async function groupReferenceTimezone(classId: string, classInstitutionTimezone: string | null): Promise<string | null> {
  if (classInstitutionTimezone) return classInstitutionTimezone;
  const learners = await db.query(`SELECT ce.student_id FROM class_enrollments ce WHERE ce.class_id = $1 AND ce.status = 'ACTIVE'`, [classId]).catch(() => ({ rows: [] as any[] }));
  const ids = learners.rows.map((r: any) => r.student_id as string);
  if (ids.length === 0) return null;
  const tz = await recipientTimezones(ids, null);
  const all = [...tz.values()];
  return all.every((t) => t.ok) && all[0]?.ok ? all[0].timezone : null;
}

// ---------------------------------------------------------------- publish ----------------------------------------------------------------

export interface PublishSubjectAssignmentInput extends SubjectAssignmentDraft {
  title?: string | null;
  instructions?: string | null;
  /** Selected learners; omitted / empty = the whole class. */
  studentIds?: string[] | null;
  /** Idempotency key (= the group id). */
  requestId?: string | null;
}

export interface PublishSubjectAssignmentResult {
  assignmentGroupId: string;
  replayed: boolean;
  preview: SubjectAssignmentPreview;
  assigned: Array<{ studentId: string; interventionId: string }>;
  skipped: Array<{ studentId: string; name: string; reason: 'NOT_AUTHORIZED' | 'LEARNER_SUBJECT_SPLIT' }>;
}

/**
 * Publish one subject Test / Mock to one student, several, or the whole class. Every check runs before any write
 * (teacher of the class, class subject, eligible concepts, difficulty, attempts, timing, window in the institution's
 * timezone -- TIMEZONE_AUTHORITY_BLOCKER when it has none). Per recipient: the selected canonical concepts are put in
 * the learner's plan when missing (ensureConceptInLearnerPlan, no evidence), then one row through the certified
 * assignTeacherIntervention with the frozen configuration (identical plan for everyone + the learner's own concept
 * ids). A learner whose concepts for this subject live in more than one of their subjects is skipped and reported
 * (LEARNER_SUBJECT_SPLIT), never silently given a different set.
 */
export async function publishSubjectAssessmentAssignment(actorUserId: string, input: PublishSubjectAssignmentInput, deps: { now?: Date } = {}): Promise<PublishSubjectAssignmentResult> {
  const ctx = await teacherClassContext(actorUserId, input.classId);
  if (!ctx.subjectId) throw new InvalidClassAssignmentError('CLASS_SUBJECT_REQUIRED');
  const eligibleRows = await eligibleConcepts(ctx.subjectId);
  const now = deps.now ?? (await dbNow());
  const { learners, assignmentGroupId, existingRows, existingByStudent } = await resolvePublishRecipients(actorUserId, input);
  // D71: every new recipient needs a timezone authority (own timezone first, else the class institution's) before any write
  const tzByStudent = await recipientTimezones(learners.rows.filter((l: any) => !existingByStudent.has(l.id)).map((l: any) => l.id), ctx.timezone);
  const unresolved = [...tzByStudent.entries()].filter(([, tz]) => !tz.ok).map(([id]) => id);
  if (unresolved.length > 0) throw new SubjectAssignmentError('TIMEZONE_AUTHORITY_BLOCKER', 409, { studentIds: unresolved });
  const firstResolved = [...tzByStudent.values()].find((tz) => tz.ok);
  // the group reference (validation + preview): the class institution's timezone, else a recipient's own
  const referenceTz = ctx.timezone ?? (firstResolved?.ok ? firstResolved.timezone : null);
  const built = buildGroupConfig(input, { subjectId: ctx.subjectId, eligible: eligibleRows.map((c) => c.id), timezone: referenceTz }, now);
  if (!built.ok) throw new SubjectAssignmentError(built.error, built.error === 'TIMEZONE_AUTHORITY_BLOCKER' ? 409 : 422);
  const config = built.config;
  const interventionType = INTERVENTION_TYPE_OF[config.kind];
  const windowByStudent = new Map<string, SubjectAssessmentAssignmentConfig['window']>();
  for (const [id, tz] of tzByStudent) {
    const w = recipientAssignmentWindow(config.window, tz, now);
    if (!w.ok) throw new SubjectAssignmentError(w.error, w.error === 'TIMEZONE_AUTHORITY_BLOCKER' ? 409 : 422, { studentIds: [id] });
    windowByStudent.set(id, w.window);
  }
  if (existingRows.rows.length > 0) {
    const kinds = await db.query(`SELECT DISTINCT intervention_type FROM teacher_interventions WHERE assignment_group_id = $1`, [assignmentGroupId]);
    if (kinds.rows.some((r: any) => r.intervention_type !== interventionType)) throw new InvalidClassAssignmentError('REQUEST_CONFLICT');
  }

  const title = input.title?.trim() || null;
  const assigned: PublishSubjectAssignmentResult['assigned'] = [];
  const skipped: PublishSubjectAssignmentResult['skipped'] = [];
  for (const l of learners.rows) {
    const prior = existingByStudent.get(l.id);
    if (prior) { assigned.push({ studentId: l.id, interventionId: prior.id }); continue; }
    if (!(await canTeacherAccessLearner(actorUserId, l.id))) { skipped.push({ studentId: l.id, name: l.name || l.email || '', reason: 'NOT_AUTHORIZED' }); continue; }
    const learnerConceptIds: Record<string, string> = {};
    let addedToPlan = false;
    for (const cc of config.conceptIds) {
      const pc = await ensureConceptInLearnerPlan({ studentId: l.id, canonicalConceptId: cc, classId: input.classId, actorUserId });
      learnerConceptIds[cc] = pc.conceptId;
      addedToPlan = addedToPlan || pc.added;
    }
    const subjects = await db.query(`SELECT DISTINCT subject_id FROM concepts WHERE id = ANY($1::uuid[])`, [Object.values(learnerConceptIds)]);
    if (subjects.rows.length !== 1) { skipped.push({ studentId: l.id, name: l.name || l.email || '', reason: 'LEARNER_SUBJECT_SPLIT' }); continue; }
    const window = windowByStudent.get(l.id) ?? config.window;
    const rowConfig: SubjectAssessmentAssignmentConfig = { ...config, window, learner: { subjectId: subjects.rows[0].subject_id, conceptIds: learnerConceptIds } };
    try {
      const intervention = await assignTeacherIntervention(actorUserId, {
        classId: input.classId,
        studentId: l.id,
        interventionType,
        target: { targetType: 'SUBJECT' },
        instructions: input.instructions ?? undefined,
        title: title ?? undefined,
        startsAt: window.opensAt,
        dueAt: window.closesAt,
        assignmentGroupId,
        addedToPlan,
        subjectAssessmentAssignment: rowConfig as unknown as Record<string, unknown>,
      });
      assigned.push({ studentId: l.id, interventionId: intervention.id });
      if (l.user_id) {
        await notifyUser({
          recipientUserId: l.user_id,
          workspace: 'STUDENT',
          type: 'ASSIGNMENT_PUBLISHED',
          title: config.kind === 'MOCK' ? 'Nuevo simulacro asignado' : 'Nueva prueba asignada',
          message: `${title ?? ctx.subjectName ?? ''} · ${config.window.startDate} – ${config.window.endDate}`,
          payload: { kind: config.kind, startDate: config.window.startDate, endDate: config.window.endDate },
          actionHref: '/dashboard/assignments',
        });
      }
    } catch (error: any) {
      if (error instanceof TeacherInterventionAccessDeniedError) { skipped.push({ studentId: l.id, name: l.name || l.email || '', reason: 'NOT_AUTHORIZED' }); continue; }
      if (error?.code === '23505') {
        const row = await db.query(`SELECT id FROM teacher_interventions WHERE assignment_group_id = $1 AND student_id = $2`, [assignmentGroupId, l.id]);
        if (row.rows[0]) { assigned.push({ studentId: l.id, interventionId: row.rows[0].id }); continue; }
      }
      throw error;
    }
  }
  return { assignmentGroupId, replayed: existingRows.rows.length > 0, preview: toPreview(config, ctx.subjectName), assigned, skipped };
}

// ---------------------------------------------------------------- attempts ---------------------------------------------------------------

interface InterventionRow { id: string; student_id: string; class_id: string; assignment_group_id: string | null; intervention_type: string; status: string; title: string | null; instructions: string | null; assigned_at: string; config: SubjectAssessmentAssignmentConfig }

/** Backward-compatible read: rows frozen with LOW / MEDIUM / HIGH read as BASIC / INTERMEDIATE / ADVANCED (never rewritten). */
function readConfig(raw: unknown): SubjectAssessmentAssignmentConfig | null {
  const c = raw as SubjectAssessmentAssignmentConfig | null;
  if (!c || c.version !== 'teacher-subject-assessment-v1') return null;
  const band = normalizeDifficultyBand(c.difficultyBand);
  return band && band !== c.difficultyBand ? { ...c, difficultyBand: band } : c;
}

export interface AttemptRecord extends AttemptSummary { questionCount: number; timed: boolean; durationMinutes: number | null; deadlineAt: string | null; reusedItemCount: number }

/**
 * Every attempt of one recipient row, each brought up to date first by the subject service's own read (it auto-submits
 * a timed attempt whose time ran out, revives an attempt left before the close, and closes as is one left across the
 * close -- rule V), then the registry / row status synced: an execution is COMPLETED with its attempt; the row is
 * COMPLETED once nothing more can be done and a result exists.
 */
async function loadAttempts(row: InterventionRow, now?: Date): Promise<AttemptRecord[]> {
  const { readSubjectAssessmentSession } = await import('@/services/subject-assessment.service');
  const r = await db.query(
    `SELECT id, status, subject_assessment_setup AS setup, created_at FROM quiz_sessions
      WHERE student_id = $1 AND subject_assessment_setup->>'assignmentId' = $2 ORDER BY created_at ASC`,
    [row.student_id, row.id]
  );
  const out: AttemptRecord[] = [];
  for (const s of r.rows) {
    let setup = readSetup(s.setup);
    if (!setup) continue;
    let state: AttemptSummary['state'] = s.status === 'completed' ? 'COMPLETED' : 'ACTIVE';
    if (state !== 'COMPLETED') {
      const read = await readSubjectAssessmentSession(row.student_id, s.id).catch(() => null);
      const fresh = await db.query(`SELECT subject_assessment_setup AS s FROM quiz_sessions WHERE id = $1`, [s.id]);
      setup = readSetup(fresh.rows[0]?.s) ?? setup;
      state = !read || !read.ok ? 'ABANDONED' : read.view.state === 'COMPLETED' ? 'COMPLETED' : read.view.state === 'ACTIVE' ? 'ACTIVE' : 'ABANDONED';
    }
    out.push({
      attemptNumber: setup.attemptNumber ?? out.length + 1,
      quizId: s.id,
      state,
      startedAt: setup.timing.startedAt ?? null,
      completedAt: setup.completion?.completedAt ?? null,
      scorePercent: setup.completion?.scorePercent ?? null,
      passed: setup.completion?.passed ?? null,
      completionReason: setup.completion?.reason ?? null,
      // an attempt still ACTIVE after the subject service's read is, by rule V, within its continuous session
      lastActivityAt: state === 'ACTIVE' ? (now ?? new Date()).toISOString() : null,
      questionCount: setup.questionCount,
      timed: setup.timing.timed,
      durationMinutes: setup.timing.durationMinutes,
      deadlineAt: setup.timing.deadlineAt ?? null,
      reusedItemCount: setup.reusedItems?.length ?? 0,
    });
  }
  const completedIds = out.filter((a) => a.state === 'COMPLETED').map((a) => a.quizId);
  if (completedIds.length > 0) {
    await db.query(
      `UPDATE teacher_intervention_executions SET status = 'COMPLETED', completed_at = COALESCE(completed_at, now()), updated_at = now()
        WHERE teacher_intervention_id = $1 AND execution_type = 'SUBJECT_ASSESSMENT' AND execution_reference = ANY($2::text[]) AND status = 'ACTIVE'`,
      [row.id, completedIds]
    );
  }
  return out;
}

async function syncRowStatus(row: InterventionRow, effective: AssignmentEffectiveStatus): Promise<void> {
  if (effective === 'COMPLETED' && (row.status === 'ASSIGNED' || row.status === 'IN_PROGRESS')) {
    await db.query(`UPDATE teacher_interventions SET status = 'COMPLETED', updated_at = now() WHERE id = $1 AND status IN ('ASSIGNED', 'IN_PROGRESS')`, [row.id]);
  } else if (effective === 'IN_PROGRESS' && row.status === 'ASSIGNED') {
    await db.query(`UPDATE teacher_interventions SET status = 'IN_PROGRESS', updated_at = now() WHERE id = $1 AND status = 'ASSIGNED'`, [row.id]);
  }
}

async function loadRow(interventionId: string): Promise<InterventionRow | null> {
  const r = await db.query(
    `SELECT id, student_id, class_id, assignment_group_id, intervention_type, status, title, instructions, assigned_at, subject_assessment_assignment AS config
       FROM teacher_interventions WHERE id = $1 AND intervention_type IN ${SUBJECT_TYPES_SQL}`,
    [interventionId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const config = readConfig(row.config);
  return config ? { ...row, config, assigned_at: new Date(row.assigned_at).toISOString() } : null;
}

export type StartAttemptResult = { outcome: 'STARTED' | 'RESUMED'; quizId: string; attemptNumber: number; subjectId: string; quizMode: 'cumulative_assessment' | 'exam_simulation' };

/**
 * Student (owner ONLY -- never Teacher, never Parent): resume the active attempt (never a second one, never an extra
 * attempt consumed), or start attempt n while the window is open and attempts remain. Attempt n is generated for THIS
 * student with the group's frozen plan, band and timing, avoiding every item the student was served (subject service)
 * plus the items already served to the other students of the assignment, the previous attempt's items being the last
 * reuse candidates.
 */
export async function startSubjectAssignmentAttempt(
  actorUserId: string,
  interventionId: string,
  deps: { now?: Date; generate?: any; grade?: any } = {}
): Promise<StartAttemptResult> {
  const row = await loadRow(interventionId);
  if (!row) throw new SubjectAssignmentError('NOT_FOUND', 404);
  if (!(await isOwner(actorUserId, row.student_id))) throw new SubjectAssignmentError('FORBIDDEN', 403);
  const quizMode = row.config.kind === 'MOCK' ? 'exam_simulation' : 'cumulative_assessment';
  const learner = row.config.learner;
  if (!learner) throw new SubjectAssignmentError('ASSIGNMENT_INCOMPLETE', 409);
  const now = deps.now ?? (await dbNow());
  const attempts = await loadAttempts(row, now);
  const decision = decideAttemptAction({ cancelled: row.status === 'CANCELLED', window: row.config.window, maxAttempts: row.config.maxAttempts, attempts, now });
  if (decision.action === 'RESUME') return { outcome: 'RESUMED', quizId: decision.quizId, attemptNumber: decision.attemptNumber, subjectId: learner.subjectId, quizMode };
  if (decision.action === 'NONE') throw new SubjectAssignmentError(decision.reason, decision.reason === 'CANCELLED' ? 410 : 409);
  return createAttempt(row, decision, attempts, deps, quizMode);
}

async function createAttempt(row: InterventionRow, decision: Extract<AttemptDecision, { action: 'START' }>, attempts: AttemptRecord[], deps: { generate?: any; grade?: any }, quizMode: StartAttemptResult['quizMode']): Promise<StartAttemptResult> {
  const learner = row.config.learner!;
  const key = `attempt:${decision.attemptNumber}`;
  const claim = async () => db.query(
    `INSERT INTO teacher_intervention_executions (teacher_intervention_id, execution_type, execution_reference, idempotency_key, status)
     VALUES ($1, 'SUBJECT_ASSESSMENT', $2, $3, 'ACTIVE') RETURNING id`,
    [row.id, `pending:${randomUUID()}`, key]
  );
  let claimId: string;
  try {
    claimId = (await claim()).rows[0].id;
  } catch (error: any) {
    if (error?.code !== '23505') throw error;
    // a concurrent start holds attempt n; a claim left pending > 10 minutes by a crashed start is released once
    const stale = await db.query(
      `DELETE FROM teacher_intervention_executions WHERE teacher_intervention_id = $1 AND idempotency_key = $2 AND execution_reference LIKE 'pending:%' AND created_at < now() - interval '10 minutes' RETURNING id`,
      [row.id, key]
    );
    if (stale.rows.length === 0) throw new SubjectAssignmentError('ATTEMPT_STARTING', 409);
    claimId = (await claim()).rows[0].id;
  }
  try {
    const plan = planForLearner(row.config.plan, learner.conceptIds);
    if (!plan.ok) throw new SubjectAssignmentError('ASSIGNMENT_INCOMPLETE', 409, { missing: plan.missing });
    const served = await loadGroupServedItems(row.id);
    const groupFps = [...new Set(served.filter((s) => s.studentId !== row.student_id).flatMap((s) => s.fingerprints))];
    const previous = [...attempts].sort((a, b) => a.attemptNumber - b.attemptNumber).at(-1);
    const previousFps = previous ? served.find((s) => s.quizId === previous.quizId)?.fingerprints ?? [] : [];
    const { createSubjectAssessmentSession } = await import('@/services/subject-assessment.service');
    const created = await createSubjectAssessmentSession(
      {
        studentId: row.student_id,
        subjectId: learner.subjectId,
        kind: row.config.kind,
        origin: 'TEACHER',
        conceptIds: Object.keys(plan.plan.distribution),
        plan: plan.plan,
        difficultyBand: row.config.difficultyBand,
        schedule: { mode: 'NOW' },
        timing: { timed: row.config.timing.timed, durationMinutes: row.config.timing.durationMinutes },
        assignmentId: row.id,
        attemptNumber: decision.attemptNumber,
        maxAttempts: row.config.maxAttempts,
        avoidFingerprints: groupFps,
        previousAttemptFingerprints: previousFps,
        assignmentWindow: { closesAt: row.config.window.closesAt, resumeAfterInactivity: row.config.timing.resumeAfterInactivity === true && resumeAfterInactivityApplies(row.config.kind, row.config.timing.timed) },
      },
      { ...(deps.generate ? { generate: deps.generate } : {}), ...(deps.grade ? { grade: deps.grade } : {}) }
    );
    if (!created.ok) throw new SubjectAssignmentError(created.error, created.status >= 500 ? 503 : created.status, created.detail);
    await db.query(`UPDATE teacher_intervention_executions SET execution_reference = $2, started_at = now(), updated_at = now() WHERE id = $1`, [claimId, created.quizId]);
    await db.query(`UPDATE teacher_interventions SET status = 'IN_PROGRESS', updated_at = now() WHERE id = $1 AND status = 'ASSIGNED'`, [row.id]);
    return { outcome: 'STARTED', quizId: created.quizId, attemptNumber: decision.attemptNumber, subjectId: learner.subjectId, quizMode };
  } catch (error) {
    await db.query(`DELETE FROM teacher_intervention_executions WHERE id = $1 AND execution_reference LIKE 'pending:%'`, [claimId]).catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------- student view -----------------------------------------------------------

export interface StudentSubjectAssignment {
  interventionId: string;
  kind: SubjectAssignmentKind;
  title: string | null;
  instructions: string | null;
  className: string | null;
  subjectName: string | null;
  questionCount: number;
  conceptCount: number;
  difficultyBand: DifficultyBand;
  timed: boolean;
  durationMinutes: number | null;
  window: SubjectAssessmentAssignmentConfig['window'];
  windowPhase: 'NOT_OPEN' | 'OPEN' | 'CLOSED';
  maxAttempts: number;
  attemptsUsed: number;
  status: AssignmentEffectiveStatus;
  /** START (a new attempt) / RESUME (the active one) / NONE with the reason. */
  action: AttemptDecision;
  /** The result = the LAST COMPLETED attempt (not the best, not the average). */
  result: { attemptNumber: number; quizId: string; scorePercent: number; passed: boolean; completedAt: string } | null;
  history: Array<Pick<AttemptRecord, 'attemptNumber' | 'quizId' | 'state' | 'startedAt' | 'completedAt' | 'scorePercent' | 'passed' | 'completionReason'>>;
  subjectId: string;
  quizMode: 'cumulative_assessment' | 'exam_simulation';
  passPercent: number;
}

/** The Student's assigned subject Tests / Mocks (studentId is server-resolved by the caller from the actor's own identity). */
export async function listStudentSubjectAssignments(studentId: string, deps: { now?: Date } = {}): Promise<StudentSubjectAssignment[]> {
  let r;
  try {
    r = await db.query(
      `SELECT ti.id, ti.student_id, ti.class_id, ti.assignment_group_id, ti.intervention_type, ti.status, ti.title, ti.instructions, ti.assigned_at,
              ti.subject_assessment_assignment AS config, k.name AS class_name, cs.name AS subject_name
         FROM teacher_interventions ti
         LEFT JOIN classes k ON k.id = ti.class_id
         LEFT JOIN canonical_subjects cs ON cs.id = (ti.subject_assessment_assignment->>'subjectId')::uuid
        WHERE ti.student_id = $1 AND ti.intervention_type IN ${SUBJECT_TYPES_SQL} AND ti.status <> 'CANCELLED'
        ORDER BY ti.assigned_at DESC LIMIT 50`,
      [studentId]
    );
  } catch (e) {
    if ((e as { code?: string })?.code === '42703') return []; // column not migrated here
    throw e;
  }
  const now = deps.now ?? (await dbNow());
  const out: StudentSubjectAssignment[] = [];
  for (const raw of r.rows) {
    const config = readConfig(raw.config);
    if (!config || !config.learner) continue;
    const row: InterventionRow = { ...raw, config, assigned_at: new Date(raw.assigned_at).toISOString() };
    const attempts = await loadAttempts(row, now);
    const status = effectiveAssignmentStatus({ storedStatus: row.status, window: config.window, maxAttempts: config.maxAttempts, attempts, now });
    await syncRowStatus(row, status);
    const latest = latestCompletedAttempt(attempts);
    out.push({
      interventionId: row.id, kind: config.kind, title: row.title, instructions: row.instructions, className: raw.class_name ?? null, subjectName: raw.subject_name ?? null,
      questionCount: config.plan.questionCount, conceptCount: config.conceptIds.length, difficultyBand: config.difficultyBand,
      timed: config.timing.timed, durationMinutes: config.timing.durationMinutes, window: config.window, windowPhase: windowPhase(config.window, now),
      maxAttempts: config.maxAttempts, attemptsUsed: attempts.length, status,
      action: decideAttemptAction({ cancelled: false, window: config.window, maxAttempts: config.maxAttempts, attempts, now }),
      result: latest ? { attemptNumber: latest.attemptNumber, quizId: latest.quizId, scorePercent: latest.scorePercent!, passed: !!latest.passed, completedAt: latest.completedAt! } : null,
      history: attempts.map(({ attemptNumber, quizId, state, startedAt, completedAt, scorePercent, passed, completionReason }) => ({ attemptNumber, quizId, state, startedAt, completedAt, scorePercent, passed, completionReason })),
      subjectId: config.learner.subjectId,
      quizMode: config.kind === 'MOCK' ? 'exam_simulation' : 'cumulative_assessment',
      passPercent: SUBJECT_ASSESSMENT_PASS_PERCENT,
    });
  }
  return out;
}

// ---------------------------------------------------------------- teacher view -----------------------------------------------------------

async function conceptNames(ids: string[], locale: string): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const r = await db.query(
    `SELECT cc.id, COALESCE((SELECT label FROM canonical_concept_localizations l WHERE l.canonical_concept_id = cc.id ORDER BY (l.language = $2) DESC LIMIT 1), cc.name) AS name
       FROM canonical_concepts cc WHERE cc.id = ANY($1::uuid[])`,
    [ids, locale]
  ).catch(async () => db.query(`SELECT id, name FROM canonical_concepts WHERE id = ANY($1::uuid[])`, [ids]));
  return new Map(r.rows.map((x: any) => [x.id, x.name]));
}

async function groupRows(classId: string, groupId?: string): Promise<Array<InterventionRow & { student_name: string }>> {
  const r = await db.query(
    `SELECT ti.id, ti.student_id, ti.class_id, ti.assignment_group_id, ti.intervention_type, ti.status, ti.title, ti.instructions, ti.assigned_at,
            ti.subject_assessment_assignment AS config, COALESCE(s.name, s.email, '') AS student_name
       FROM teacher_interventions ti JOIN students s ON s.id = ti.student_id
      WHERE ti.class_id = $1 AND ti.intervention_type IN ${SUBJECT_TYPES_SQL} AND ti.status <> 'CANCELLED'
        AND ($2::uuid IS NULL OR ti.assignment_group_id = $2::uuid)
      ORDER BY ti.assigned_at DESC, s.name NULLS LAST`,
    [classId, groupId ?? null]
  );
  return r.rows.flatMap((row: any) => {
    const config = readConfig(row.config);
    return config ? [{ ...row, config, assigned_at: new Date(row.assigned_at).toISOString() }] : [];
  });
}

export interface ClassSubjectAssignmentSummary {
  assignmentGroupId: string;
  kind: SubjectAssignmentKind;
  title: string | null;
  assignedAt: string;
  window: SubjectAssessmentAssignmentConfig['window'];
  windowPhase: 'NOT_OPEN' | 'OPEN' | 'CLOSED';
  questionCount: number;
  conceptCount: number;
  difficultyBand: DifficultyBand;
  timed: boolean;
  durationMinutes: number | null;
  maxAttempts: number;
  recipients: number;
  completedStudents: number;
  averageScorePercent: number | null;
  counts: Record<AssignmentEffectiveStatus, number>;
}

/** The class's subject Test / Mock assignments (the actor must TEACH the class). */
export async function listClassSubjectAssessmentAssignments(actorUserId: string, classId: string, deps: { now?: Date } = {}): Promise<ClassSubjectAssignmentSummary[]> {
  await teacherClassContext(actorUserId, classId);
  const rows = await groupRows(classId);
  const now = deps.now ?? (await dbNow());
  const groups = new Map<string, ClassSubjectAssignmentSummary & { scores: number[] }>();
  for (const row of rows) {
    const key = row.assignment_group_id ?? row.id;
    let g = groups.get(key);
    if (!g) {
      g = {
        assignmentGroupId: key, kind: row.config.kind, title: row.title, assignedAt: row.assigned_at, window: row.config.window, windowPhase: windowPhase(row.config.window, now),
        questionCount: row.config.plan.questionCount, conceptCount: row.config.conceptIds.length, difficultyBand: row.config.difficultyBand,
        timed: row.config.timing.timed, durationMinutes: row.config.timing.durationMinutes, maxAttempts: row.config.maxAttempts,
        recipients: 0, completedStudents: 0, averageScorePercent: null, counts: { ASSIGNED: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0, EXPIRED: 0 }, scores: [],
      };
      groups.set(key, g);
    }
    const attempts = await loadAttempts(row, now);
    const status = effectiveAssignmentStatus({ storedStatus: row.status, window: row.config.window, maxAttempts: row.config.maxAttempts, attempts, now });
    await syncRowStatus(row, status);
    g.recipients++;
    g.counts[status]++;
    const latest = latestCompletedAttempt(attempts);
    if (latest) { g.completedStudents++; g.scores.push(latest.scorePercent!); }
  }
  return [...groups.values()].map(({ scores, ...g }) => ({ ...g, averageScorePercent: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null }));
}

interface LatestDetail {
  attempt: AttemptRecord;
  report: StudentLatestReport;
  data: import('@/services/subject-assessment.service').SubjectSubmissionData;
  servedDifficulty: number[];
}

/** The latest completed attempt of one recipient, mapped onto canonical concepts (for pooling across learners). */
async function latestDetail(row: InterventionRow, attempts: AttemptRecord[]): Promise<LatestDetail | null> {
  const latest = latestCompletedAttempt(attempts);
  if (!latest) return null;
  const { readCompletedSubjectAssessmentForStaff } = await import('@/services/subject-assessment.service');
  const read = await readCompletedSubjectAssessmentForStaff(latest.quizId);
  if (!read || read.studentId !== row.student_id) return null;
  const canonicalOf = new Map(Object.entries(row.config.learner?.conceptIds ?? {}).map(([cc, lc]) => [lc, cc]));
  const ck = (learnerConceptId: string) => canonicalOf.get(learnerConceptId) ?? learnerConceptId;
  return {
    attempt: latest,
    data: read.data,
    servedDifficulty: read.questions.map((q) => Number(q.difficulty)).filter((d) => Number.isFinite(d)),
    report: {
      studentId: row.student_id,
      scorePercent: read.data.subjectAssessment.scorePercent,
      perConcept: read.data.subjectAssessment.perConcept.map((c) => ({ conceptKey: ck(c.conceptId), total: c.total, correct: c.correct, unanswered: c.unanswered })),
      items: read.data.review.map((it) => ({ conceptKey: ck(it.conceptId), questionKey: fingerprintQuestion(read.questions[it.questionIndex]), status: it.status })),
      knowledgeBucket: read.data.subjectAssessment.knowledge.knowledgeBucket,
    },
  };
}

async function requireGroupInClass(actorUserId: string, classId: string, groupId: string) {
  const ctx = await teacherClassContext(actorUserId, classId);
  const rows = await groupRows(classId, groupId);
  if (rows.length === 0) throw new SubjectAssignmentError('NOT_FOUND', 404);
  return { ctx, rows };
}

/** P: the Teacher's GROUP view of one assignment -- every student's LATEST COMPLETED attempt, pooled. */
export async function getSubjectAssessmentGroupResults(actorUserId: string, classId: string, groupId: string, opts: { locale?: string; now?: Date } = {}) {
  const { ctx, rows } = await requireGroupInClass(actorUserId, classId, groupId);
  const now = opts.now ?? (await dbNow());
  const config = rows[0].config;
  const students: Array<{ studentId: string; name: string; interventionId: string; status: AssignmentEffectiveStatus; attemptsUsed: number; maxAttempts: number; latest: { attemptNumber: number; scorePercent: number; passed: boolean; completedAt: string; knowledge: ReturnType<typeof knowledgeProfile> } | null }> = [];
  const reports: StudentLatestReport[] = [];
  const difficulties: number[] = [];
  let reusedItems = 0;
  for (const row of rows) {
    const attempts = await loadAttempts(row, now);
    const status = effectiveAssignmentStatus({ storedStatus: row.status, window: row.config.window, maxAttempts: row.config.maxAttempts, attempts, now });
    await syncRowStatus(row, status);
    reusedItems += attempts.reduce((a, x) => a + x.reusedItemCount, 0);
    const detail = await latestDetail(row, attempts);
    if (detail) { reports.push(detail.report); difficulties.push(...detail.servedDifficulty); }
    students.push({
      studentId: row.student_id, name: row.student_name, interventionId: row.id, status, attemptsUsed: attempts.length, maxAttempts: row.config.maxAttempts,
      latest: detail ? { attemptNumber: detail.attempt.attemptNumber, scorePercent: detail.report.scorePercent, passed: subjectAssessmentPassed(detail.report.scorePercent), completedAt: detail.attempt.completedAt!, knowledge: detail.data.subjectAssessment.knowledge } : null,
    });
  }
  const aggregate = aggregateGroup(reports);
  const names = await conceptNames(config.conceptIds, opts.locale ?? 'es');
  const label = (k: string) => names.get(k) ?? k;
  const served = await loadGroupServedItems(rows[0].id);
  const { crossStudentSharedFingerprints } = await import('./subject-assessment-assignment.rules');
  return {
    assignmentGroupId: groupId,
    className: ctx.className,
    subjectName: ctx.subjectName,
    kind: config.kind,
    title: rows[0].title,
    window: config.window,
    windowPhase: windowPhase(config.window, now),
    plan: config.plan,
    difficultyBand: config.difficultyBand,
    /** The difficulty actually served (mean generator level 1-5 of the latest attempts' items). */
    servedDifficultyMean: difficulties.length ? Math.round((difficulties.reduce((a, b) => a + b, 0) / difficulties.length) * 10) / 10 : null,
    timing: config.timing,
    maxAttempts: config.maxAttempts,
    passPercent: SUBJECT_ASSESSMENT_PASS_PERCENT,
    students,
    ...aggregate,
    perConcept: aggregate.perConcept.map((c) => ({ ...c, conceptName: label(c.conceptKey) })),
    strongestConcepts: aggregate.strongestConcepts.map((k) => ({ conceptId: k, conceptName: label(k) })),
    largestGaps: aggregate.largestGaps.map((k) => ({ conceptId: k, conceptName: label(k) })),
    highErrorAreas: aggregate.highErrorAreas.map((a) => ({ ...a, conceptName: label(a.conceptKey) })),
    highErrorQuestions: aggregate.highErrorQuestions.map((q) => ({ ...q, conceptName: label(q.conceptKey) })),
    versions: { sharedItemCount: crossStudentSharedFingerprints(served).size, reusedItemCount: reusedItems, attempts: served.length },
  };
}

/** P: the Teacher's drill-down of ONE student of the assignment (the actor must teach the class AND this learner). */
export async function getSubjectAssessmentStudentResult(actorUserId: string, classId: string, groupId: string, studentId: string, opts: { locale?: string; now?: Date } = {}) {
  const { rows } = await requireGroupInClass(actorUserId, classId, groupId);
  const row = rows.find((r) => r.student_id === studentId);
  if (!row) throw new SubjectAssignmentError('NOT_FOUND', 404);
  if (!(await canTeacherAccessLearner(actorUserId, studentId))) throw new SubjectAssignmentError('FORBIDDEN', 403);
  const now = opts.now ?? (await dbNow());
  const attempts = await loadAttempts(row, now);
  const status = effectiveAssignmentStatus({ storedStatus: row.status, window: row.config.window, maxAttempts: row.config.maxAttempts, attempts, now });
  await syncRowStatus(row, status);
  const detail = await latestDetail(row, attempts);
  return {
    studentId,
    name: row.student_name,
    kind: row.config.kind,
    status,
    maxAttempts: row.config.maxAttempts,
    attemptsUsed: attempts.length,
    passPercent: SUBJECT_ASSESSMENT_PASS_PERCENT,
    /** The result = the LAST COMPLETED attempt; every attempt stays in the history. */
    result: detail
      ? {
          attemptNumber: detail.attempt.attemptNumber,
          completedAt: detail.attempt.completedAt,
          completionReason: detail.attempt.completionReason,
          scorePercent: detail.data.subjectAssessment.scorePercent,
          passed: detail.data.subjectAssessment.passed,
          total: detail.data.subjectAssessment.total,
          correct: detail.data.subjectAssessment.correct,
          incorrect: detail.data.subjectAssessment.incorrect,
          unanswered: detail.data.subjectAssessment.unanswered,
          perConcept: detail.data.subjectAssessment.perConcept,
          conceptsToReinforce: detail.data.subjectAssessment.conceptsToReinforce,
          /** Diagnostic: knowledge bucket, per-difficulty scores, highest difficulty demonstrated (never alters evidence). */
          knowledge: detail.data.subjectAssessment.knowledge,
          responses: detail.data.review,
          errors: detail.data.review.filter((r) => r.status !== 'CORRECT'),
        }
      : null,
    history: attempts.map(({ attemptNumber, state, startedAt, completedAt, scorePercent, passed, completionReason, reusedItemCount }) => ({ attemptNumber, state, startedAt, completedAt, scorePercent, passed, completionReason, reusedItemCount })),
  };
}

export { kindOfInterventionType };
