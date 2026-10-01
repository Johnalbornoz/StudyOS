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
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
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

export interface AssignableCanonicalConcept {
  canonicalConceptId: string;
  name: string;
  matchedLearners: number;
}

/**
 * Catalog concepts at least one ACTIVE learner of this class has a MATCHED
 * mapping for (only those can actually be practised), with the count.
 */
export async function listAssignableConceptsForClass(actorUserId: string, classId: string): Promise<{ concepts: AssignableCanonicalConcept[]; activeLearners: number }> {
  await requireTeacherOfClass(actorUserId, classId);
  const [concepts, learners] = await Promise.all([
    db.query(
      `
      SELECT cc.id, cc.name, COUNT(DISTINCT ce.student_id)::int AS matched
      FROM class_enrollments ce
      JOIN subjects s ON s.student_id = ce.student_id
      JOIN concepts c ON c.subject_id = s.id
      JOIN concept_catalog_mapping ccm ON ccm.learner_concept_id = c.id AND ccm.status = 'MATCHED'
      JOIN canonical_concepts cc ON cc.id = ccm.canonical_concept_id AND cc.status = 'ACTIVE'
      WHERE ce.class_id = $1 AND ce.status = 'ACTIVE'
      GROUP BY cc.id, cc.name
      ORDER BY cc.name
      `,
      [classId]
    ),
    db.query(`SELECT COUNT(*)::int AS n FROM class_enrollments WHERE class_id = $1 AND status = 'ACTIVE'`, [classId]),
  ]);
  return {
    concepts: concepts.rows.map((r: any) => ({ canonicalConceptId: r.id, name: r.name, matchedLearners: r.matched })),
    activeLearners: learners.rows[0]?.n ?? 0,
  };
}

export interface PublishClassAssignmentInput {
  classId: string;
  canonicalConceptId: string;
  instructions?: string | null;
  dueAt?: string | null;
}

export interface PublishClassAssignmentResult {
  assignmentGroupId: string;
  assigned: Array<{ studentId: string; interventionId: string }>;
  skipped: Array<{ studentId: string; name: string; reason: 'NO_MATCHED_CONCEPT' | 'NOT_AUTHORIZED' }>;
}

export class NoLearnersToAssignError extends Error {
  constructor() {
    super('NO_LEARNERS_TO_ASSIGN');
    this.name = 'NoLearnersToAssignError';
  }
}

/**
 * Publish one class assignment. Every per-learner row goes through
 * `assignTeacherIntervention` (class access + ACTIVE enrollment + genuine
 * teacher relationship, per learner). Nothing is written when no learner
 * can receive it (NoLearnersToAssignError).
 */
export async function publishClassAssignment(actorUserId: string, input: PublishClassAssignmentInput): Promise<PublishClassAssignmentResult> {
  await requireTeacherOfClass(actorUserId, input.classId);

  const canonical = await db.query(`SELECT id, name FROM canonical_concepts WHERE id = $1 AND status = 'ACTIVE'`, [input.canonicalConceptId]);
  if (canonical.rows.length === 0) throw new NoLearnersToAssignError();
  const conceptName: string = canonical.rows[0].name;

  const learners = await db.query(
    `SELECT s.id, s.name, s.email, s.user_id FROM class_enrollments ce JOIN students s ON s.id = ce.student_id
     WHERE ce.class_id = $1 AND ce.status = 'ACTIVE' ORDER BY s.name NULLS LAST, s.email`,
    [input.classId]
  );

  const plan: Array<{ studentId: string; userId: string | null; conceptId: string }> = [];
  const skipped: PublishClassAssignmentResult['skipped'] = [];
  for (const l of learners.rows) {
    const conceptId = await resolveStudentConceptForCanonicalConcept(l.id, input.canonicalConceptId);
    if (!conceptId) {
      skipped.push({ studentId: l.id, name: l.name || l.email || '', reason: 'NO_MATCHED_CONCEPT' });
      continue;
    }
    plan.push({ studentId: l.id, userId: l.user_id, conceptId });
  }
  if (plan.length === 0) throw new NoLearnersToAssignError();

  const assignmentGroupId = randomUUID();
  const assigned: PublishClassAssignmentResult['assigned'] = [];
  for (const p of plan) {
    try {
      const intervention = await assignTeacherIntervention(actorUserId, {
        classId: input.classId,
        studentId: p.studentId,
        interventionType: 'CONCEPT_REINFORCEMENT',
        target: { targetType: 'CONCEPT', conceptId: p.conceptId },
        instructions: input.instructions ?? undefined,
        dueAt: input.dueAt ?? undefined,
        assignmentGroupId,
      });
      assigned.push({ studentId: p.studentId, interventionId: intervention.id });
      if (p.userId) {
        await notifyUser({
          recipientUserId: p.userId,
          workspace: 'STUDENT',
          type: 'ASSIGNMENT_PUBLISHED',
          title: 'Nueva tarea asignada',
          message: `Tu docente te asignó practicar: ${conceptName}.`,
          payload: { conceptName },
          actionHref: '/dashboard/assignments',
        });
      }
    } catch (error) {
      if (error instanceof TeacherInterventionAccessDeniedError) {
        const l = learners.rows.find((row: any) => row.id === p.studentId);
        skipped.push({ studentId: p.studentId, name: l?.name || l?.email || '', reason: 'NOT_AUTHORIZED' });
        continue;
      }
      throw error;
    }
  }
  return { assignmentGroupId, assigned, skipped };
}

export interface LearnerAssignmentOutcome {
  interventionId: string;
  studentId: string;
  studentName: string;
  status: TeacherInterventionStatus;
  /** The graded result of the activity the learner completed (counts only), or null when not completed / not gradable. */
  result: { correct: number; total: number } | null;
  completedAt: string | null;
}

export interface ClassAssignmentView {
  assignmentGroupId: string;
  title: string;
  instructions: string | null;
  assignedAt: string;
  dueAt: string | null;
  counts: Record<TeacherInterventionStatus, number>;
  learners: LearnerAssignmentOutcome[];
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
        title: r.title,
        instructions: r.instructions,
        assignedAt: iso(r.assigned_at)!,
        dueAt: iso(r.due_at),
        counts: { ASSIGNED: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0, EXPIRED: 0 },
        learners: [],
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
