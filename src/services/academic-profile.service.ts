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
  /** REM-T1-03: structured time context (null on legacy rows: `academicYear` text is then the only value). */
  academicYearStart: number | null;
  academicYearEnd: number | null;
  examSeries: string | null;
  examYear: number | null;
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
    academicYearStart: row.academic_year_start ?? null,
    academicYearEnd: row.academic_year_end ?? null,
    examSeries: row.exam_series ?? null,
    examYear: row.exam_year ?? null,
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
  /** REM-T1-03: structured time context columns (time-context.ts `timeContextColumns`). */
  timeColumns?: { academicYearStart: number | null; academicYearEnd: number | null; examSeries: string | null; examYear: number | null };
}

export async function upsertAcademicProfile(studentId: string, input: AcademicProfileInput): Promise<AcademicProfile> {
  const result = await db.query(
    `
    INSERT INTO student_academic_profile (
      student_id, country_of_study, school_year, curriculum_type,
      ib_programme, ib_year, academic_year, school_name, profile_completed,
      academic_year_start, academic_year_end, exam_series, exam_year
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (student_id) DO UPDATE SET
      country_of_study = EXCLUDED.country_of_study,
      school_year = EXCLUDED.school_year,
      curriculum_type = EXCLUDED.curriculum_type,
      ib_programme = EXCLUDED.ib_programme,
      ib_year = EXCLUDED.ib_year,
      academic_year = EXCLUDED.academic_year,
      school_name = EXCLUDED.school_name,
      profile_completed = EXCLUDED.profile_completed,
      academic_year_start = EXCLUDED.academic_year_start,
      academic_year_end = EXCLUDED.academic_year_end,
      exam_series = EXCLUDED.exam_series,
      exam_year = EXCLUDED.exam_year,
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
      input.timeColumns?.academicYearStart ?? null,
      input.timeColumns?.academicYearEnd ?? null,
      input.timeColumns?.examSeries ?? null,
      input.timeColumns?.examYear ?? null,
    ]
  );
  return toProfile(result.rows[0]);
}
