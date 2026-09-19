/**
 * F11-B -- Teacher Intervention domain: pedagogical intent + assignment
 * ONLY, never the execution itself. A row here is never read by F5's
 * mastery pipeline, F8's diagnosis/session pipeline, or F9's readiness
 * engine, and this file never writes to learning_evidence,
 * mastery_records, or any F8 table -- see
 * docs/implementation/f11/F11_B_TEACHER_INTERVENTION_DOMAIN.md for the
 * full architecture rationale and the explicit scope corrections
 * (no resulting_intervention_session_id, no class-batch assignment;
 * both deferred).
 *
 * Every function re-validates authorization itself, through the
 * Teacher-specific canonical primitives ONLY (canAccessClass,
 * canTeacherAccessLearner, via canTeacherManageIntervention) -- never
 * the generic canAccessLearner.
 */
import { db } from '@/lib/db';
import { canAccessClass, canTeacherManageIntervention } from '@/lib/authorization';
import { getStudentExamProfile } from '@/lib/assessment/student-exam-profile.service';
import type { SimulationType } from '@/lib/simulation/types';

export class TeacherInterventionAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeacherInterventionAccessDeniedError';
  }
}

export class TeacherInterventionNotFoundError extends Error {
  constructor(interventionId: string) {
    super(`No teacher_interventions row found for id ${interventionId}`);
    this.name = 'TeacherInterventionNotFoundError';
  }
}

/** The supplied target (conceptId/skillId/competencyId/learningObjectiveId) does not reference a real row -- a clean, predictable error instead of a raw FK-violation 500. */
export class TeacherInterventionInvalidTargetError extends Error {
  constructor(targetType: string) {
    super(`No ${targetType} row exists for the supplied target id`);
    this.name = 'TeacherInterventionInvalidTargetError';
  }
}

/** F11-C4 (task §7): the supplied examProfileId is real but belongs to a DIFFERENT student -- never silently reassigned, never a raw FK/500. */
export class TeacherInterventionExamProfileMismatchError extends Error {
  constructor(examProfileId: string, studentId: string) {
    super(`exam profile ${examProfileId} does not belong to student ${studentId}`);
    this.name = 'TeacherInterventionExamProfileMismatchError';
  }
}

const PG_FOREIGN_KEY_VIOLATION = '23503';

export type TeacherInterventionType = 'CONCEPT_REINFORCEMENT' | 'SKILL_PRACTICE' | 'COMPETENCY_PRACTICE' | 'EXAM_PRACTICE';
export type TeacherInterventionStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export type TeacherInterventionTarget =
  | { targetType: 'CONCEPT'; conceptId: string }
  | { targetType: 'SKILL'; skillId: string }
  | { targetType: 'COMPETENCY'; competencyId: string }
  | { targetType: 'LEARNING_OBJECTIVE'; learningObjectiveId: string }
  | (
      | { targetType: 'EXAM'; examProfileId: string; simulationType: 'TOPIC_EXAM'; learningObjectiveId: string }
      | { targetType: 'EXAM'; examProfileId: string; simulationType: 'DOMAIN_EXAM'; academicSubjectId: string }
      | { targetType: 'EXAM'; examProfileId: string; simulationType: 'MINI_MOCK' | 'FULL_MOCK' }
    );

export interface AssignTeacherInterventionParams {
  classId: string;
  studentId: string;
  interventionType: TeacherInterventionType;
  target: TeacherInterventionTarget;
  reason?: string;
  instructions?: string;
  dueAt?: string;
}

export interface TeacherIntervention {
  id: string;
  assignedByUserId: string;
  institutionId: string;
  classId: string;
  studentId: string;
  targetType: TeacherInterventionTarget['targetType'];
  conceptId: string | null;
  skillId: string | null;
  competencyId: string | null;
  learningObjectiveId: string | null;
  examProfileId: string | null;
  simulationType: SimulationType | null;
  academicSubjectId: string | null;
  interventionType: TeacherInterventionType;
  reason: string | null;
  instructions: string | null;
  assignedAt: string;
  dueAt: string | null;
  status: TeacherInterventionStatus;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
}

function toIntervention(row: any): TeacherIntervention {
  return {
    id: row.id,
    assignedByUserId: row.assigned_by_user_id,
    institutionId: row.institution_id,
    classId: row.class_id,
    studentId: row.student_id,
    targetType: row.target_type,
    conceptId: row.concept_id,
    skillId: row.skill_id,
    competencyId: row.competency_id,
    learningObjectiveId: row.learning_objective_id,
    examProfileId: row.exam_profile_id,
    simulationType: row.simulation_type,
    academicSubjectId: row.academic_subject_id,
    interventionType: row.intervention_type,
    reason: row.reason,
    instructions: row.instructions,
    assignedAt: row.assigned_at instanceof Date ? row.assigned_at.toISOString() : row.assigned_at,
    dueAt: row.due_at instanceof Date ? row.due_at.toISOString() : row.due_at,
    status: row.status,
    cancelledAt: row.cancelled_at instanceof Date ? row.cancelled_at.toISOString() : row.cancelled_at,
    cancelledByUserId: row.cancelled_by_user_id,
    cancellationReason: row.cancellation_reason,
  };
}

/**
 * Re-runs the FULL canonical authorization chain explicitly, per the
 * architecture's own requirement -- never inferred from stored ids
 * alone: (1) class belongs to an institution, (2) the Teacher can
 * access THIS EXACT class (canAccessClass), (3) the learner has an
 * ACTIVE enrollment in THIS EXACT class, (4) the Teacher can access
 * this learner at all (canTeacherManageIntervention /
 * canTeacherAccessLearner). (2) and (4) are deliberately both checked
 * even though they overlap in the common case: canAccessClass also
 * admits INSTITUTION_ADMINs, who are not necessarily this student's
 * real teacher -- (4) is what actually proves a genuine Teacher
 * relationship to this specific learner.
 */
async function requireAssignmentAuthorization(actorUserId: string, classId: string, studentId: string): Promise<string> {
  const classRow = await db.query(`SELECT institution_id FROM classes WHERE id = $1`, [classId]);
  if (classRow.rows.length === 0) throw new TeacherInterventionAccessDeniedError(`class ${classId} does not exist`);
  const institutionId = classRow.rows[0].institution_id;

  const canAccessThisClass = await canAccessClass(actorUserId, classId, 'TEACHER_ASSIGNMENT_MANAGE');
  if (!canAccessThisClass) throw new TeacherInterventionAccessDeniedError(`actor cannot access class ${classId}`);

  const enrollment = await db.query(
    `SELECT 1 FROM class_enrollments WHERE class_id = $1 AND student_id = $2 AND status = 'ACTIVE'`,
    [classId, studentId]
  );
  if (enrollment.rows.length === 0) throw new TeacherInterventionAccessDeniedError(`student ${studentId} has no ACTIVE enrollment in class ${classId}`);

  const canManage = await canTeacherManageIntervention(actorUserId, studentId, 'TEACHER_INTERVENTION_ASSIGN');
  if (!canManage) throw new TeacherInterventionAccessDeniedError(`actor is not a real teacher of student ${studentId}`);

  return institutionId;
}

export async function assignTeacherIntervention(actorUserId: string, params: AssignTeacherInterventionParams): Promise<TeacherIntervention> {
  const institutionId = await requireAssignmentAuthorization(actorUserId, params.classId, params.studentId);

  const conceptId = params.target.targetType === 'CONCEPT' ? params.target.conceptId : null;
  const skillId = params.target.targetType === 'SKILL' ? params.target.skillId : null;
  const competencyId = params.target.targetType === 'COMPETENCY' ? params.target.competencyId : null;
  const learningObjectiveId =
    params.target.targetType === 'LEARNING_OBJECTIVE'
      ? params.target.learningObjectiveId
      : params.target.targetType === 'EXAM' && params.target.simulationType === 'TOPIC_EXAM'
        ? params.target.learningObjectiveId
        : null;
  const examProfileId = params.target.targetType === 'EXAM' ? params.target.examProfileId : null;
  const simulationType = params.target.targetType === 'EXAM' ? params.target.simulationType : null;
  const academicSubjectId = params.target.targetType === 'EXAM' && params.target.simulationType === 'DOMAIN_EXAM' ? params.target.academicSubjectId : null;

  // F11-C4 (task §7): a Student Exam Profile is a per-student resource --
  // its existence alone (checked below via FK) is not enough; it must
  // ALSO genuinely belong to the student this intervention targets.
  // Never inferred from the id being merely well-formed or Teacher-
  // supplied, and re-validated again at start time (defense in depth,
  // matching this codebase's convention of never trusting an earlier
  // layer alone for a security-relevant check).
  if (examProfileId) {
    const profile = await getStudentExamProfile(examProfileId);
    if (!profile || profile.studentId !== params.studentId) {
      throw new TeacherInterventionExamProfileMismatchError(examProfileId, params.studentId);
    }
  }

  try {
    const result = await db.query(
      `
      INSERT INTO teacher_interventions (
        assigned_by_user_id, institution_id, class_id, student_id,
        target_type, concept_id, skill_id, competency_id, learning_objective_id,
        exam_profile_id, simulation_type, academic_subject_id,
        intervention_type, reason, instructions, due_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
      `,
      [
        actorUserId,
        institutionId,
        params.classId,
        params.studentId,
        params.target.targetType,
        conceptId,
        skillId,
        competencyId,
        learningObjectiveId,
        examProfileId,
        simulationType,
        academicSubjectId,
        params.interventionType,
        params.reason ?? null,
        params.instructions ?? null,
        params.dueAt ?? null,
      ]
    );
    return toIntervention(result.rows[0]);
  } catch (error: any) {
    if (error?.code === PG_FOREIGN_KEY_VIOLATION) throw new TeacherInterventionInvalidTargetError(params.target.targetType);
    throw error;
  }
}

/** TEACHER_INTERVENTION_VIEW: every intervention (any status, any class) ever assigned to this exact student, visible only to a teacher who can currently access this learner. */
export async function listTeacherInterventionsForStudent(actorUserId: string, studentId: string): Promise<TeacherIntervention[]> {
  const allowed = await canTeacherManageIntervention(actorUserId, studentId, 'TEACHER_INTERVENTION_VIEW');
  if (!allowed) throw new TeacherInterventionAccessDeniedError(`actor cannot view interventions for student ${studentId}`);

  const result = await db.query(`SELECT * FROM teacher_interventions WHERE student_id = $1 ORDER BY assigned_at DESC`, [studentId]);
  return result.rows.map(toIntervention);
}

/**
 * TEACHER_INTERVENTION_CANCEL: gated by the actor's CURRENT
 * relationship to the student (not restricted to whoever originally
 * assigned it) -- matches this codebase's existing convention that
 * revocation-style actions are always gated by the current live
 * relationship, never frozen to the original actor (see F2's parent
 * relationship model). Only ASSIGNED or IN_PROGRESS can be cancelled;
 * cancelling an already-terminal row is a no-op, never re-decides
 * history.
 */
export async function cancelTeacherIntervention(actorUserId: string, interventionId: string, cancellationReason?: string): Promise<TeacherIntervention> {
  const existing = await db.query(`SELECT student_id, status FROM teacher_interventions WHERE id = $1`, [interventionId]);
  if (existing.rows.length === 0) throw new TeacherInterventionNotFoundError(interventionId);
  const { student_id: studentId, status } = existing.rows[0];

  const allowed = await canTeacherManageIntervention(actorUserId, studentId, 'TEACHER_INTERVENTION_CANCEL');
  if (!allowed) throw new TeacherInterventionAccessDeniedError(`actor cannot cancel interventions for student ${studentId}`);

  if (status !== 'ASSIGNED' && status !== 'IN_PROGRESS') {
    return toIntervention((await db.query(`SELECT * FROM teacher_interventions WHERE id = $1`, [interventionId])).rows[0]);
  }

  const result = await db.query(
    `
    UPDATE teacher_interventions
    SET status = 'CANCELLED', cancelled_at = now(), cancelled_by_user_id = $1, cancellation_reason = $2, updated_at = now()
    WHERE id = $3 AND status IN ('ASSIGNED', 'IN_PROGRESS')
    RETURNING *
    `,
    [actorUserId, cancellationReason ?? null, interventionId]
  );
  if (result.rows.length === 0) {
    // Lost a race with another concurrent cancel/transition -- re-read the current (already-terminal) row rather than error.
    return toIntervention((await db.query(`SELECT * FROM teacher_interventions WHERE id = $1`, [interventionId])).rows[0]);
  }
  return toIntervention(result.rows[0]);
}
