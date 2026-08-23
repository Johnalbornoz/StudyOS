import { db } from '@/lib/db';
import type { CountryOfStudy, CurriculumType } from '@/lib/academic-options';

export interface AcademicProfile {
  studentId: string;
  countryOfStudy: CountryOfStudy;
  schoolYear: string | null;
  curriculumType: CurriculumType;
  ibProgramme: 'MYP' | 'DP' | null;
  ibYear: string | null;
  academicYear: string | null;
  schoolName: string | null;
  profileCompleted: boolean;
}

function toProfile(row: any): AcademicProfile {
  return {
    studentId: row.student_id,
    countryOfStudy: row.country_of_study,
    schoolYear: row.school_year,
    curriculumType: row.curriculum_type,
    ibProgramme: row.ib_programme,
    ibYear: row.ib_year,
    academicYear: row.academic_year,
    schoolName: row.school_name,
    profileCompleted: row.profile_completed,
  };
}

export async function getAcademicProfile(studentId: string): Promise<AcademicProfile | null> {
  const result = await db.query(`SELECT * FROM student_academic_profile WHERE student_id = $1`, [studentId]);
  const row = result.rows[0];
  return row ? toProfile(row) : null;
}

export interface AcademicProfileInput {
  countryOfStudy: CountryOfStudy;
  schoolYear?: string | null;
  curriculumType: CurriculumType;
  ibProgramme?: 'MYP' | 'DP' | null;
  ibYear?: string | null;
  academicYear?: string | null;
  schoolName?: string | null;
  profileCompleted?: boolean;
}

export async function upsertAcademicProfile(studentId: string, input: AcademicProfileInput): Promise<AcademicProfile> {
  const result = await db.query(
    `
    INSERT INTO student_academic_profile (
      student_id, country_of_study, school_year, curriculum_type,
      ib_programme, ib_year, academic_year, school_name, profile_completed
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (student_id) DO UPDATE SET
      country_of_study = EXCLUDED.country_of_study,
      school_year = EXCLUDED.school_year,
      curriculum_type = EXCLUDED.curriculum_type,
      ib_programme = EXCLUDED.ib_programme,
      ib_year = EXCLUDED.ib_year,
      academic_year = EXCLUDED.academic_year,
      school_name = EXCLUDED.school_name,
      profile_completed = EXCLUDED.profile_completed,
      updated_at = NOW()
    RETURNING *
    `,
    [
      studentId,
      input.countryOfStudy,
      input.schoolYear ?? null,
      input.curriculumType,
      input.curriculumType === 'ib' ? input.ibProgramme ?? null : null,
      input.curriculumType === 'ib' ? input.ibYear ?? null : null,
      input.academicYear ?? null,
      input.schoolName ?? null,
      input.profileCompleted ?? true,
    ]
  );
  return toProfile(result.rows[0]);
}
