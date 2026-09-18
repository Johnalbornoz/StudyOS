/**
 * F7 -- Student Exam Profile / Preparation Goal (task 18/19). Every
 * field beyond studentId/examDefinitionId is nullable/optional --
 * target score, institution, and exam date are never required.
 * Authorization (who may read/write a profile) is the CALLER's
 * responsibility via F1/F2 (src/lib/authorization) -- this service does
 * not re-implement it, matching the established pattern of every prior
 * phase's service layer.
 */
import { db } from '@/lib/db';
import type { GoalType, PreparationGoal, StudentExamProfile } from './types';

function toProfile(r: any): StudentExamProfile {
  return {
    id: r.id,
    studentId: r.student_id,
    examDefinitionId: r.exam_definition_id,
    examVersionId: r.exam_version_id,
    purpose: r.purpose,
    programmeContext: r.programme_context,
    subjectFocus: r.subject_focus,
    examDate: r.exam_date,
    timezone: r.timezone,
    institutionTargetId: r.institution_target_id,
    status: r.status,
  };
}
function toGoal(r: any): PreparationGoal {
  return { id: r.id, studentExamProfileId: r.student_exam_profile_id, goalType: r.goal_type, targetValue: r.target_value, competencyId: r.competency_id };
}

export async function createStudentExamProfile(params: {
  studentId: string;
  examDefinitionId: string;
  examVersionId?: string;
  purpose?: string;
  programmeContext?: string;
  subjectFocus?: string;
  examDate?: string;
  timezone?: string;
  institutionTargetId?: string;
}): Promise<StudentExamProfile> {
  const result = await db.query(
    `INSERT INTO student_exam_profiles (
       student_id, exam_definition_id, exam_version_id, purpose, programme_context, subject_focus, exam_date, timezone, institution_target_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      params.studentId,
      params.examDefinitionId,
      params.examVersionId ?? null,
      params.purpose ?? null,
      params.programmeContext ?? null,
      params.subjectFocus ?? null,
      params.examDate ?? null,
      params.timezone ?? null,
      params.institutionTargetId ?? null,
    ]
  );
  return toProfile(result.rows[0]);
}

export async function addPreparationGoal(params: { studentExamProfileId: string; goalType: GoalType; targetValue?: string; competencyId?: string }): Promise<PreparationGoal> {
  const result = await db.query(
    `INSERT INTO preparation_goals (student_exam_profile_id, goal_type, target_value, competency_id) VALUES ($1, $2, $3, $4) RETURNING *`,
    [params.studentExamProfileId, params.goalType, params.targetValue ?? null, params.competencyId ?? null]
  );
  return toGoal(result.rows[0]);
}

export async function getStudentExamProfile(profileId: string): Promise<StudentExamProfile | null> {
  const result = await db.query(`SELECT * FROM student_exam_profiles WHERE id = $1`, [profileId]);
  return result.rows.length === 0 ? null : toProfile(result.rows[0]);
}

export async function listGoalsForProfile(profileId: string): Promise<PreparationGoal[]> {
  const result = await db.query(`SELECT * FROM preparation_goals WHERE student_exam_profile_id = $1`, [profileId]);
  return result.rows.map(toGoal);
}
