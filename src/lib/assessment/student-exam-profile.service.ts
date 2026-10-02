/**
 * F7 -- Student Exam Profile / Preparation Goal (task 18/19). Every
 * field beyond studentId/examDefinitionId is nullable/optional --
 * target score, institution, and exam date are never required.
 * Authorization (who may read/write a profile) is the CALLER's
 * responsibility via F1/F2 (src/lib/authorization) -- this service does
 * not re-implement it, matching the established pattern of every prior
 * phase's service layer.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { GoalType, PreparationGoal, StudentExamProfile } from './types';

function toProfile(r: any): StudentExamProfile {
  return {
    id: r.id,
    studentId: r.student_id,
    examDefinitionId: r.exam_definition_id,
    examVersionId: r.exam_version_id,
    objectiveKey: r.objective_key ?? null,
    objectiveFramework: r.objective_framework ?? null,
    objectiveContext: r.objective_context ?? null,
    targetInstitutionName: r.target_institution_name ?? null,
    targetQualification: r.target_qualification ?? null,
    source: r.source ?? null,
    purpose: r.purpose,
    programmeContext: r.programme_context,
    subjectFocus: r.subject_focus,
    examDate: r.exam_date,
    timezone: r.timezone,
    institutionTargetId: r.institution_target_id,
    status: r.status,
    archivedAt: r.archived_at ? (r.archived_at instanceof Date ? r.archived_at.toISOString() : r.archived_at) : null,
    replacedByProfileId: r.replaced_by_profile_id ?? null,
  };
}
function toGoal(r: any): PreparationGoal {
  return { id: r.id, studentExamProfileId: r.student_exam_profile_id, goalType: r.goal_type, targetValue: r.target_value, competencyId: r.competency_id };
}

export async function createStudentExamProfile(params: {
  studentId: string;
  /** Optional for a catalogue-only objective (then objectiveKey is required). */
  examDefinitionId?: string | null;
  examVersionId?: string;
  purpose?: string;
  programmeContext?: string;
  subjectFocus?: string;
  examDate?: string;
  timezone?: string;
  institutionTargetId?: string;
  objectiveKey?: string;
  objectiveFramework?: string;
  objectiveNodeId?: string | null;
  objectiveContext?: Record<string, unknown>;
  targetInstitutionName?: string;
  targetQualification?: string;
  source?: 'STUDENT' | 'EXAM_INSTANCE' | 'INSTITUTION';
}, client: DbExecutor = db): Promise<StudentExamProfile> {
  if (!params.examDefinitionId && !params.objectiveKey) throw new Error('EXAM_PROFILE_TARGET_REQUIRED');
  // Track B: at most one non-archived profile per Student and exam
  // (uq_student_exam_profiles_one_active) and per Student and objective
  // (uq_student_exam_profiles_one_active_objective). A double click or a retry
  // gets the SAME active profile back instead of a duplicate preparation.
  const result = await client.query(
    `INSERT INTO student_exam_profiles (
       student_id, exam_definition_id, exam_version_id, purpose, programme_context, subject_focus, exam_date, timezone, institution_target_id,
       objective_key, objective_framework, objective_node_id, objective_context, target_institution_name, target_qualification, source
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      params.studentId,
      params.examDefinitionId ?? null,
      params.examVersionId ?? null,
      params.purpose ?? null,
      params.programmeContext ?? null,
      params.subjectFocus ?? null,
      params.examDate ?? null,
      params.timezone ?? null,
      params.institutionTargetId ?? null,
      params.objectiveKey ?? null,
      params.objectiveFramework ?? null,
      params.objectiveNodeId ?? null,
      params.objectiveContext ? JSON.stringify(params.objectiveContext) : null,
      params.targetInstitutionName ?? null,
      params.targetQualification ?? null,
      params.source ?? null,
    ]
  );
  if (result.rows[0]) return toProfile(result.rows[0]);
  const existing = await client.query(
    `SELECT * FROM student_exam_profiles
      WHERE student_id = $1 AND status <> 'ARCHIVED' AND (($2::text IS NOT NULL AND objective_key = $2) OR ($3::uuid IS NOT NULL AND exam_definition_id = $3))
      ORDER BY (objective_key = $2) DESC NULLS LAST, created_at DESC LIMIT 1`,
    [params.studentId, params.objectiveKey ?? null, params.examDefinitionId ?? null]
  );
  return toProfile(existing.rows[0]);
}

export async function addPreparationGoal(params: { studentExamProfileId: string; goalType: GoalType; targetValue?: string; competencyId?: string }): Promise<PreparationGoal> {
  const result = await db.query(
    `INSERT INTO preparation_goals (student_exam_profile_id, goal_type, target_value, competency_id) VALUES ($1, $2, $3, $4) RETURNING *`,
    [params.studentExamProfileId, params.goalType, params.targetValue ?? null, params.competencyId ?? null]
  );
  return toGoal(result.rows[0]);
}

/**
 * UX-2 security fix -- ownership check for routes that accept an
 * `examProfileId` next to an already-authorized `studentId`. Authorizing
 * the learner is not enough: the profile id must also belong to that
 * learner, or a caller could read (or write a readiness snapshot against)
 * another learner's exam profile by passing its id.
 */
export async function isExamProfileOwnedByStudent(examProfileId: string, studentId: string): Promise<boolean> {
  const result = await db.query(`SELECT 1 FROM student_exam_profiles WHERE id = $1 AND student_id = $2`, [examProfileId, studentId]);
  return result.rows.length > 0;
}

/**
 * Foundation (Exam Core attempt integrity): an attempt may only be started
 * against a PUBLISHED version of the SAME exam definition the profile
 * targets. Without this a caller could start an attempt on a DRAFT /
 * SUPERSEDED version, or on another exam's version, through an owned
 * profile -- freezing a configuration the catalog never published.
 */
export async function isExamVersionStartableForProfile(examProfileId: string, examVersionId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM student_exam_profiles p
     JOIN exam_versions v ON v.exam_definition_id = p.exam_definition_id
     WHERE p.id = $1 AND v.id = $2 AND v.status = 'PUBLISHED'`,
    [examProfileId, examVersionId]
  );
  return result.rows.length > 0;
}

export async function getStudentExamProfile(profileId: string): Promise<StudentExamProfile | null> {
  const result = await db.query(`SELECT * FROM student_exam_profiles WHERE id = $1`, [profileId]);
  return result.rows.length === 0 ? null : toProfile(result.rows[0]);
}

/**
 * F14 -- the same read `GET /api/exam-profiles?studentId=` already
 * performs inline, extracted into a reusable function so a Server
 * Component (the new Student Exam Prep page) can call it directly
 * rather than making a self-HTTP-call, matching every other F13/F14
 * page's own established pattern.
 */
export async function listStudentExamProfiles(studentId: string, opts: { includeArchived?: boolean } = {}): Promise<StudentExamProfile[]> {
  // Track B: a profile the Student removed from their preparation (ARCHIVED) is not part of it any more.
  const result = await db.query(
    `SELECT * FROM student_exam_profiles WHERE student_id = $1 ${opts.includeArchived ? '' : `AND status <> 'ARCHIVED'`} ORDER BY created_at DESC`,
    [studentId]
  );
  return result.rows.map(toProfile);
}

export async function listGoalsForProfile(profileId: string): Promise<PreparationGoal[]> {
  const result = await db.query(`SELECT * FROM preparation_goals WHERE student_exam_profile_id = $1`, [profileId]);
  return result.rows.map(toGoal);
}
