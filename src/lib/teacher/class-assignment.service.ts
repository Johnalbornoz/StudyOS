/**
 * Track A -- class-level assignments over the Foundation assignment contract.
 *
 * A class assignment is PUBLISHED as N per-learner `teacher_interventions`
 * (one per ACTIVE enrolled learner) sharing one `assignment_group_id`. Each
 * row is created through the existing, certified `assignTeacherIntervention`
 * (full authorization chain per learner) -- this file adds no second write
 * path, no second lifecycle and no cognitive write of any kind:
 *  - the assignment SCHEDULES work; the learner (owner only) executes it
 *    through the existing execution orchestration;
 *  - the result reaches mastery only through the learner's own practice
 *    submission -> updateMastery (the canonical Learning Engine);
 *  - the Teacher reads back operational status and the activity's own
 *    graded result -- never writes evidence, mastery or knowledge state.
 *
 * Targets: a CANONICAL catalog concept (shared across learners). Each
 * learner's own concept is resolved through the existing F9 resolver
 * (`resolveStudentConceptForCanonicalConcept`, MATCHED mappings only --
 * never a guessed correspondence). A learner with no matched concept is
 * reported as skipped, never silently assigned something else.
 */
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { canTeacherAccessLearner } from '@/lib/authorization';
import { ensureConceptInLearnerPlan, learnersHavingCanonicalConcept } from './plan-enrollment.service';
import { reconcileCompletionsForStudent, getEffectiveStatus, type TeacherInterventionStatus } from '@/lib/student/teacher-intervention-execution.service';
import { notifyUser } from '@/lib/notifications/role-notifications.service';
import { assignTeacherIntervention, TeacherInterventionAccessDeniedError } from './intervention.service';

export class TeacherClassAccessDeniedError extends Error {
  constructor(classId: string) {
    super(`actor is not a teacher of class ${classId}`);
    this.name = 'TeacherClassAccessDeniedError';
  }
}

/**
 * The classes the actor TEACHES (approved TEACHER membership + active scope
 * covering the class, same institution). Deliberately NOT canAccessClass:
 * that also admits institution admins, who can see a class but are not its
 * teacher and must never publish learner work or read per-learner results.
 */
const TEACHER_CLASS_SQL = `
  SELECT DISTINCT c.id
  FROM teacher_assignments ta
  JOIN institution_memberships im ON im.id = ta.institution_membership_id
  JOIN classes c ON (c.id = ta.class_id OR (ta.class_id IS NULL AND ta.grade_id IS NOT NULL AND c.grade_id = ta.grade_id))
  WHERE im.user_id = $1 AND im.membership_role = 'TEACHER' AND im.status = 'APPROVED'
    AND ta.status = 'ACTIVE' AND c.institution_id = im.institution_id
`;

export async function isTeacherOfClass(actorUserId: string, classId: string): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM (${TEACHER_CLASS_SQL}) t WHERE t.id = $2 LIMIT 1`, [actorUserId, classId]);
  return r.rows.length > 0;
}

export async function listTeacherClassIds(actorUserId: string): Promise<string[]> {
  const r = await db.query(TEACHER_CLASS_SQL, [actorUserId]);
  return r.rows.map((row: any) => row.id);
}

async function requireTeacherOfClass(actorUserId: string, classId: string): Promise<void> {
  if (!(await isTeacherOfClass(actorUserId, classId))) throw new TeacherClassAccessDeniedError(classId);
}

export interface TeacherClassContext {
  id: string;
  name: string;
  institutionId: string;
  institutionName: string;
  gradeName: string | null;
  /** The class's canonical subject (set by the Institution Admin); null until linked. */
  subjectId: string | null;
  subjectName: string | null;
}

/** The class as its Teacher sees it -- null when the actor does not teach it (callers answer 403/404, never a hint). */
export async function getTeacherClass(actorUserId: string, classId: string): Promise<TeacherClassContext | null> {
  if (!(await isTeacherOfClass(actorUserId, classId))) return null;
  const r = await db.query(
    `SELECT c.id, c.name, c.institution_id, i.name AS institution_name, g.name AS grade_name, c.canonical_subject_id, cs.name AS subject_name
     FROM classes c JOIN institutions i ON i.id = c.institution_id
     LEFT JOIN grades g ON g.id = c.grade_id LEFT JOIN canonical_subjects cs ON cs.id = c.canonical_subject_id
     WHERE c.id = $1`,
    [classId]
  );
  const row = r.rows[0];
  return row
    ? {
        id: row.id,
        name: row.name,
        institutionId: row.institution_id,
        institutionName: row.institution_name,
        gradeName: row.grade_name,
        subjectId: row.canonical_subject_id,
        subjectName: row.subject_name,
      }
    : null;
}

/** Every class the actor teaches, with its context (Teacher home). */
export async function listTeacherClasses(actorUserId: string): Promise<Array<TeacherClassContext & { activeLearners: number; pendingInvitations: number }>> {
  const r = await db.query(
    `SELECT c.id, c.name, c.institution_id, i.name AS institution_name, g.name AS grade_name, c.canonical_subject_id, cs.name AS subject_name,
       (SELECT COUNT(*)::int FROM class_enrollments ce WHERE ce.class_id = c.id AND ce.status = 'ACTIVE') AS active_count,
       (SELECT COUNT(*)::int FROM class_enrollments ce WHERE ce.class_id = c.id AND ce.status = 'PENDING') AS pending_count
     FROM classes c JOIN institutions i ON i.id = c.institution_id
     LEFT JOIN grades g ON g.id = c.grade_id LEFT JOIN canonical_subjects cs ON cs.id = c.canonical_subject_id
     WHERE c.id IN (${TEACHER_CLASS_SQL}) AND i.status = 'ACTIVE'
     ORDER BY i.name, g.name NULLS LAST, c.name`,
    [actorUserId]
  );
  return r.rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    institutionId: row.institution_id,
    institutionName: row.institution_name,
    gradeName: row.grade_name,
    subjectId: row.canonical_subject_id,
    subjectName: row.subject_name,
    activeLearners: row.active_count,
    pendingInvitations: row.pending_count,
  }));
}

export interface AssignableCanonicalConcept {
  canonicalConceptId: string;
  name: string;
  matchedLearners: number;
  /** ACTIVE learners of the class who already have this concept in their plan (the rest would get it added on assignment). */
  matchedStudentIds: string[];
}

/**
 * The topics a Teacher can assign in this class: the ACTIVE catalog
 * concepts of the class's OWN canonical subject (the Teacher never picks
 * content outside it), each with how many ACTIVE learners have a MATCHED
 * concept for it (only those learners can actually practise it). A class
 * without a linked subject offers no topics (`subjectLinked: false`).
 */
export async function listAssignableConceptsForClass(
  actorUserId: string,
  classId: string
): Promise<{ concepts: AssignableCanonicalConcept[]; activeLearners: number; subjectLinked: boolean }> {
  await requireTeacherOfClass(actorUserId, classId);
  const [concepts, learners, klass] = await Promise.all([
    db.query(
      `
      SELECT cc.id, cc.name,
        (SELECT COUNT(DISTINCT ce.student_id)::int
         FROM class_enrollments ce
         JOIN subjects s ON s.student_id = ce.student_id
         JOIN concepts c ON c.subject_id = s.id
         JOIN concept_catalog_mapping ccm ON ccm.learner_concept_id = c.id AND ccm.status = 'MATCHED' AND ccm.canonical_concept_id = cc.id
         WHERE ce.class_id = $1 AND ce.status = 'ACTIVE') AS matched
      FROM classes k
      JOIN canonical_concepts cc ON cc.canonical_subject_id = k.canonical_subject_id AND cc.status = 'ACTIVE'
      WHERE k.id = $1
      ORDER BY cc.name
      `,
      [classId]
    ),
    db.query(`SELECT COUNT(*)::int AS n FROM class_enrollments WHERE class_id = $1 AND status = 'ACTIVE'`, [classId]),
    db.query(`SELECT canonical_subject_id FROM classes WHERE id = $1`, [classId]),
  ]);
  const activeIds = (await db.query(`SELECT student_id FROM class_enrollments WHERE class_id = $1 AND status = 'ACTIVE'`, [classId])).rows.map((r: any) => r.student_id);
  const withConcept = await Promise.all(concepts.rows.map((r: any) => learnersHavingCanonicalConcept(activeIds, r.id)));
  return {
    concepts: concepts.rows.map((r: any, i: number) => ({ canonicalConceptId: r.id, name: r.name, matchedLearners: r.matched, matchedStudentIds: [...withConcept[i]] })),
    activeLearners: learners.rows[0]?.n ?? 0,
    subjectLinked: Boolean(klass.rows[0]?.canonical_subject_id),
  };
}

export interface PublishClassAssignmentInput {
  classId: string;
  canonicalConceptId: string;
  /** Shown to learner and teacher; defaults to the topic name. */
  title?: string | null;
  instructions?: string | null;
  /** From when the learner can start it (default: now). */
  startsAt?: string | null;
  dueAt?: string | null;
  /** Selected learners (student ids). Omitted / empty = the whole class (every ACTIVE learner). */
  studentIds?: string[] | null;
  /**
   * Idempotency key chosen by the client once per composed assignment. It
   * becomes the assignment group id: a retried submit returns the same
   * assignment and never adds a recipient twice.
   */
  requestId?: string | null;
  /**
   * Track A governance (internal only, never accepted from a request body):
   * a task defined by the institution. Its group id is the institution
   * target's group; recipients' plans record INSTITUTION_ASSIGNMENT and the
   * rows are owner_scope INSTITUTION. The teacher only chooses recipients.
   */
  governed?: { institutionAssignmentId: string };
}

export interface PublishClassAssignmentResult {
  assignmentGroupId: string;
  assigned: Array<{ studentId: string; interventionId: string; addedToPlan: boolean }>;
  skipped: Array<{ studentId: string; name: string; reason: 'NOT_AUTHORIZED' }>;
  /** Recipients who already had the concept in their plan / who got it added by this assignment. */
  alreadyHadConcept: number;
  addedToPlan: number;
  /** true when this call replayed an assignment that already existed (retried submit). */
  replayed: boolean;
}

export class NoLearnersToAssignError extends Error {
  constructor() {
    super('NO_LEARNERS_TO_ASSIGN');
    this.name = 'NoLearnersToAssignError';
  }
}

/**
 * The assignment request itself is invalid -- nothing is written:
 *  - CLASS_SUBJECT_REQUIRED: the class has no linked subject yet;
 *  - CONCEPT_NOT_IN_CLASS_SUBJECT: the topic is not an ACTIVE concept of the class's subject;
 *  - RECIPIENT_NOT_IN_CLASS: a selected learner is not ACTIVE in this class;
 *  - INVALID_DATES: due date not after the start date;
 *  - REQUEST_CONFLICT: the request id belongs to another class / teacher.
 */
export class InvalidClassAssignmentError extends Error {
  constructor(public readonly code: 'CLASS_SUBJECT_REQUIRED' | 'CONCEPT_NOT_IN_CLASS_SUBJECT' | 'RECIPIENT_NOT_IN_CLASS' | 'INVALID_DATES' | 'REQUEST_CONFLICT' | 'FIELD_LOCKED_BY_INSTITUTION') {
    super(code);
    this.name = 'InvalidClassAssignmentError';
  }
}

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Publish one class assignment of a catalog concept of the class's subject.
 *
 * Every check runs before any write. Then, per recipient (ACTIVE learner of
 * this class the Teacher genuinely teaches):
 *  - if the learner already has the concept, it is reused untouched;
 *  - otherwise the concept is added to the learner's plan
 *    (`ensureConceptInLearnerPlan`, provenance TEACHER_ASSIGNMENT, no
 *    evidence / progress);
 *  - the per-learner row is created through `assignTeacherIntervention`.
 * A mixed selection never blocks. With a `requestId`, a retry returns the
 * existing assignment and only completes recipients still missing.
 */
export async function publishClassAssignment(actorUserId: string, input: PublishClassAssignmentInput): Promise<PublishClassAssignmentResult> {
  await requireTeacherOfClass(actorUserId, input.classId);

  const klass = await db.query(`SELECT canonical_subject_id FROM classes WHERE id = $1`, [input.classId]);
  const classSubjectId: string | null = klass.rows[0]?.canonical_subject_id ?? null;
  if (!classSubjectId) throw new InvalidClassAssignmentError('CLASS_SUBJECT_REQUIRED');
  const canonical = await db.query(
    `SELECT id, name FROM canonical_concepts WHERE id = $1 AND status = 'ACTIVE' AND canonical_subject_id = $2`,
    [input.canonicalConceptId, classSubjectId]
  );
  if (canonical.rows.length === 0) throw new InvalidClassAssignmentError('CONCEPT_NOT_IN_CLASS_SUBJECT');
  const conceptName: string = canonical.rows[0].name;
  const title = input.title?.trim() || conceptName;
  if (input.startsAt && input.dueAt && new Date(input.dueAt).getTime() <= new Date(input.startsAt).getTime()) {
    throw new InvalidClassAssignmentError('INVALID_DATES');
  }

  const learners = await db.query(
    `SELECT s.id, s.name, s.email, s.user_id FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
     WHERE ce.class_id = $1 AND ce.status = 'ACTIVE' ORDER BY s.name NULLS LAST, s.email`,
    [input.classId]
  );
  const selected = [...new Set(input.studentIds ?? [])];
  if (selected.length > 0) {
    // Every selected learner must be ACTIVE in THIS class -- otherwise the
    // whole request is refused (0 writes), never silently narrowed.
    const active = new Set(learners.rows.map((l: any) => l.id));
    if (selected.some((id) => !active.has(id))) throw new InvalidClassAssignmentError('RECIPIENT_NOT_IN_CLASS');
    learners.rows = learners.rows.filter((l: any) => selected.includes(l.id));
  }
  if (learners.rows.length === 0) throw new NoLearnersToAssignError();

  const assignmentGroupId = input.requestId ?? randomUUID();
  // An institution task's group can never be extended through the teacher's own
  // publish path (that would let a teacher add recipients with different dates).
  if (!input.governed) {
    const governedGroup = await db.query(`SELECT 1 FROM institution_assignment_targets WHERE assignment_group_id = $1`, [assignmentGroupId]);
    if (governedGroup.rows.length > 0) throw new InvalidClassAssignmentError('FIELD_LOCKED_BY_INSTITUTION');
  }
  const existingRows = await db.query(
    `SELECT id, student_id, class_id, assigned_by_user_id, concept_added_to_plan FROM teacher_interventions WHERE assignment_group_id = $1`,
    [assignmentGroupId]
  );
  if (existingRows.rows.some((r: any) => r.class_id !== input.classId || r.assigned_by_user_id !== actorUserId)) {
    throw new InvalidClassAssignmentError('REQUEST_CONFLICT');
  }
  const existingByStudent = new Map<string, any>(existingRows.rows.map((r: any) => [r.student_id, r]));

  const assigned: PublishClassAssignmentResult['assigned'] = [];
  const skipped: PublishClassAssignmentResult['skipped'] = [];
  for (const l of learners.rows) {
    const prior = existingByStudent.get(l.id);
    if (prior) {
      assigned.push({ studentId: l.id, interventionId: prior.id, addedToPlan: prior.concept_added_to_plan });
      continue;
    }
    // Authorize this learner BEFORE anything is written for them (their plan included).
    if (!(await canTeacherAccessLearner(actorUserId, l.id))) {
      skipped.push({ studentId: l.id, name: l.name || l.email || '', reason: 'NOT_AUTHORIZED' });
      continue;
    }
    const planConcept = await ensureConceptInLearnerPlan({ studentId: l.id, canonicalConceptId: input.canonicalConceptId, classId: input.classId, actorUserId, institutionAssignmentId: input.governed?.institutionAssignmentId ?? null });
    try {
      const intervention = await assignTeacherIntervention(actorUserId, {
        classId: input.classId,
        studentId: l.id,
        interventionType: 'CONCEPT_REINFORCEMENT',
        target: { targetType: 'CONCEPT', conceptId: planConcept.conceptId },
        instructions: input.instructions ?? undefined,
        dueAt: input.dueAt ?? undefined,
        startsAt: input.startsAt ?? undefined,
        title,
        assignmentGroupId,
        addedToPlan: planConcept.added,
      });
      assigned.push({ studentId: l.id, interventionId: intervention.id, addedToPlan: planConcept.added });
      if (input.governed) {
        await db.query(`UPDATE teacher_interventions SET owner_scope = 'INSTITUTION', institution_assignment_id = $2 WHERE id = $1`, [intervention.id, input.governed.institutionAssignmentId]);
      }
      if (l.user_id) {
        await notifyUser({
          recipientUserId: l.user_id,
          workspace: 'STUDENT',
          type: 'ASSIGNMENT_PUBLISHED',
          title: 'Nueva tarea asignada',
          message: `Tu docente te asignó: ${title} (${conceptName}).`,
          payload: { conceptName, title },
          actionHref: '/dashboard/assignments',
        });
      }
    } catch (error: any) {
      if (error instanceof TeacherInterventionAccessDeniedError) {
        skipped.push({ studentId: l.id, name: l.name || l.email || '', reason: 'NOT_AUTHORIZED' });
        continue;
      }
      // A concurrent identical submit already created this recipient: reuse it.
      if (error?.code === PG_UNIQUE_VIOLATION) {
        const row = await db.query(`SELECT id, concept_added_to_plan FROM teacher_interventions WHERE assignment_group_id = $1 AND student_id = $2`, [assignmentGroupId, l.id]);
        if (row.rows[0]) {
          assigned.push({ studentId: l.id, interventionId: row.rows[0].id, addedToPlan: row.rows[0].concept_added_to_plan });
          continue;
        }
      }
      throw error;
    }
  }
  return {
    assignmentGroupId,
    assigned,
    skipped,
    alreadyHadConcept: assigned.filter((a) => !a.addedToPlan).length,
    addedToPlan: assigned.filter((a) => a.addedToPlan).length,
    replayed: existingRows.rows.length > 0,
  };
}

export interface LearnerAssignmentOutcome {
  interventionId: string;
  studentId: string;
  studentName: string;
  status: TeacherInterventionStatus;
  /** This assignment put the concept into the learner's plan (they did not have it before). */
  addedToPlan: boolean;
  /** The graded result of the activity the learner completed (counts only), or null when not completed / not gradable. */
  result: { correct: number; total: number } | null;
  completedAt: string | null;
}

export interface ClassAssignmentView {
  assignmentGroupId: string;
  title: string;
  /** The catalog topic (concept) the assignment practises. */
  conceptName: string;
  instructions: string | null;
  assignedAt: string;
  startsAt: string | null;
  dueAt: string | null;
  counts: Record<TeacherInterventionStatus, number>;
  learners: LearnerAssignmentOutcome[];
  /** Track A governance: INSTITUTION tasks are read-only for the Teacher (only recipients). */
  ownerScope: 'INSTITUTION' | 'TEACHER';
}

function iso(v: any): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * The class's assignments with each learner's outcome. Completion is first
 * reconciled from the canonical activity records (the same lazy, read-back
 * reconciliation the Student's own assignments page runs) so the Teacher
 * never reads a stale IN_PROGRESS. Results are the activity's own grades
 * (quiz_response_grades), read-only.
 */
export async function listClassAssignments(actorUserId: string, classId: string): Promise<ClassAssignmentView[]> {
  await requireTeacherOfClass(actorUserId, classId);

  const learnerIds = await db.query(
    `SELECT DISTINCT student_id FROM teacher_interventions WHERE class_id = $1 AND status = 'IN_PROGRESS'`,
    [classId]
  );
  for (const row of learnerIds.rows) {
    await reconcileCompletionsForStudent(row.student_id).catch((error) =>
      console.error('[class-assignment] reconcile failed', (error as Error)?.message)
    );
  }

  const rows = await db.query(
    `
    SELECT ti.id, ti.assignment_group_id, ti.student_id, ti.status, ti.due_at, ti.assigned_at, ti.instructions, ti.target_type,
           ti.title AS assignment_title, ti.starts_at, ti.concept_added_to_plan, ti.owner_scope,
           COALESCE(cc.name, ccl.label, ti.intervention_type) AS title,
           s.name AS student_name, s.email AS student_email,
           tie.execution_type, tie.execution_reference, tie.completed_at
    FROM teacher_interventions ti
    JOIN students s ON s.id = ti.student_id
    LEFT JOIN concept_catalog_mapping ccm ON ccm.learner_concept_id = ti.concept_id AND ccm.status = 'MATCHED'
    LEFT JOIN canonical_concepts cc ON cc.id = ccm.canonical_concept_id
    LEFT JOIN LATERAL (
      SELECT label FROM concept_localizations WHERE concept_id = ti.concept_id ORDER BY (language = 'es') DESC, language LIMIT 1
    ) ccl ON true
    LEFT JOIN LATERAL (
      SELECT execution_type, execution_reference, completed_at FROM teacher_intervention_executions
      WHERE teacher_intervention_id = ti.id ORDER BY (status = 'COMPLETED') DESC, created_at DESC LIMIT 1
    ) tie ON true
    WHERE ti.class_id = $1 AND ti.status <> 'CANCELLED'
    ORDER BY ti.assigned_at DESC, s.name NULLS LAST
    `,
    [classId]
  );

  const quizIds = rows.rows.filter((r: any) => r.completed_at && r.execution_type !== 'EXAM_PRACTICE').map((r: any) => r.execution_reference);
  const results = new Map<string, { correct: number; total: number }>();
  if (quizIds.length > 0) {
    const graded = await db.query(
      `
      SELECT qr.quiz_session_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE g.is_correct)::int AS correct
      FROM quiz_responses qr
      JOIN LATERAL (SELECT is_correct FROM quiz_response_grades WHERE response_id = qr.id ORDER BY graded_at DESC LIMIT 1) g ON true
      WHERE qr.quiz_session_id = ANY($1::text[])
      GROUP BY qr.quiz_session_id
      `,
      [quizIds]
    );
    for (const g of graded.rows) results.set(g.quiz_session_id, { correct: g.correct, total: g.total });
  }

  const groups = new Map<string, ClassAssignmentView>();
  for (const r of rows.rows) {
    const key = r.assignment_group_id ?? r.id;
    let view = groups.get(key);
    if (!view) {
      view = {
        assignmentGroupId: key,
        title: r.assignment_title || r.title,
        conceptName: r.title,
        instructions: r.instructions,
        assignedAt: iso(r.assigned_at)!,
        startsAt: iso(r.starts_at),
        dueAt: iso(r.due_at),
        counts: { ASSIGNED: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0, EXPIRED: 0 },
        learners: [],
        ownerScope: r.owner_scope === 'INSTITUTION' ? 'INSTITUTION' : 'TEACHER',
      };
      groups.set(key, view);
    }
    const status = getEffectiveStatus(r.status, iso(r.due_at));
    view.counts[status] += 1;
    view.learners.push({
      interventionId: r.id,
      studentId: r.student_id,
      studentName: r.student_name || r.student_email || '',
      status,
      addedToPlan: Boolean(r.concept_added_to_plan),
      result: r.completed_at ? results.get(r.execution_reference) ?? null : null,
      completedAt: iso(r.completed_at),
    });
  }
  return [...groups.values()];
}

/** A learner's own concepts (label + subject) for a per-learner assignment picker -- the teacher must currently teach this learner. */
export async function listLearnerConceptsForTeacher(actorUserId: string, studentId: string): Promise<Array<{ conceptId: string; label: string; subjectName: string }>> {
  if (!(await canTeacherAccessLearner(actorUserId, studentId))) throw new TeacherClassAccessDeniedError(studentId);
  const r = await db.query(
    `
    SELECT c.id, s.name AS subject_name,
      COALESCE((SELECT label FROM concept_localizations WHERE concept_id = c.id ORDER BY (language = 'es') DESC, language LIMIT 1), c.canonical_id) AS label
    FROM concepts c JOIN subjects s ON s.id = c.subject_id
    WHERE s.student_id = $1 AND s.status = 'active'
    ORDER BY s.name, label
    LIMIT 300
    `,
    [studentId]
  );
  return r.rows.map((row: any) => ({ conceptId: row.id, label: row.label, subjectName: row.subject_name }));
}
