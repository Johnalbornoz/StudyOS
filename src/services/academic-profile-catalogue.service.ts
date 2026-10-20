/**
 * Student Academic Profile -> canonical curriculum catalogue (Phase A).
 *
 *   Country -> Grade -> Nacional | Internacional -> Programme -> Qualification
 *   (when the programme has several) -> Subjects (optional)
 *
 * Options come from the catalogue only (CURRICULUM programmes; exams such as
 * PISA, PAA or Saber 11 are never curricula), grouped by scope with Phase B's
 * catalog-scope rules, and marked compatible with the Student's grade from the
 * programme's governed grade range (NULL range = always offered). Nothing is
 * hardcoded per country or per international body.
 *
 * Saving is persistent (asked once; changed only on purpose), validated against
 * the catalogue, audited (academic_governance_events, actor STUDENT) and never
 * deletes learning history: learner state, attempts, results and evidence are
 * not touched; a previous subject selection is ENDED, not deleted. The legacy
 * columns stay coherent for older readers (curriculum_type, ib_programme / ib_year).
 */
import { db } from '@/lib/db';
import { curriculumScope, countryLabel, type CurriculumScope } from '@/lib/curriculum/catalog-scope';
import { recordGovernanceEvent } from '@/lib/institution/academic-governance';
import { normaliseGradeLevel } from '@/lib/exam-core/eligibility/grade-level';
import { loadEligibilityGraph } from '@/lib/exam-core/eligibility/graph';
import { programmesForFramework } from '@/lib/exam-core/eligibility/rules';
import type { CountryOfStudy, CurriculumType } from '@/lib/academic-options';

// ------------------------------------------------------------------ options

export interface ProgrammeOption {
  id: string;
  name: string;
  authorityId: string;
  authority: string;
  country: string | null;
  scope: CurriculumScope;
  gradeMin: number | null;
  gradeMax: number | null;
  /** Compatible with the Student's grade (or the programme's range is unknown). */
  compatible: boolean;
  qualifications: Array<{ id: string; name: string }>;
  subjects: Array<{ id: string; name: string; level: string | null; qualificationId: string | null }>;
}

export interface StudentCurriculumOptions {
  national: { country: string | null; countryName: string | null; programmes: ProgrammeOption[] };
  international: Array<{ authorityId: string; authority: string; programmes: ProgrammeOption[] }>;
}

interface CatalogueRow {
  subject_id: string;
  subject: string;
  level: string | null;
  qualification_id: string | null;
  qualification: string | null;
  programme_id: string;
  programme: string;
  grade_min: number | null;
  grade_max: number | null;
  authority_id: string;
  authority: string;
  country: string | null;
  source_type: string;
}

async function loadCatalogue(): Promise<CatalogueRow[]> {
  const r = await db.query(
    `SELECT a.id AS subject_id, a.name AS subject, a.level, q.id AS qualification_id, q.name AS qualification,
            p.id AS programme_id, p.name AS programme, p.grade_min, p.grade_max,
            o.id AS authority_id, o.name AS authority, o.country, COALESCE(o.source_type, 'INTERNATIONAL_PROGRAMME') AS source_type
       FROM academic_subjects a
       JOIN academic_programmes p ON p.id = a.programme_id AND p.status = 'ACTIVE' AND p.programme_type = 'CURRICULUM'
       JOIN academic_organizations o ON o.id = p.organization_id AND o.status = 'ACTIVE'
       LEFT JOIN academic_qualifications q ON q.id = a.qualification_id AND q.status = 'ACTIVE'
      WHERE a.status = 'ACTIVE'
      ORDER BY o.name, p.name, q.name NULLS FIRST, a.name, a.level NULLS FIRST`
  );
  return r.rows as CatalogueRow[];
}

/** Pure: group catalogue rows into the Student's options (exported for tests). */
export function buildCurriculumOptions(rows: CatalogueRow[], country: string | null, gradeLevel: number | null): StudentCurriculumOptions {
  const programmes = new Map<string, ProgrammeOption>();
  for (const r of rows) {
    const scope = curriculumScope({ country: r.country, sourceType: r.source_type });
    const p = programmes.get(r.programme_id) ?? {
      id: r.programme_id, name: r.programme, authorityId: r.authority_id, authority: r.authority, country: r.country, scope,
      gradeMin: r.grade_min, gradeMax: r.grade_max,
      compatible: gradeLevel === null || ((r.grade_min === null || gradeLevel >= r.grade_min) && (r.grade_max === null || gradeLevel <= r.grade_max)),
      qualifications: [], subjects: [],
    };
    if (r.qualification_id && !p.qualifications.some((q) => q.id === r.qualification_id)) p.qualifications.push({ id: r.qualification_id, name: r.qualification! });
    p.subjects.push({ id: r.subject_id, name: r.subject, level: r.level, qualificationId: r.qualification_id });
    programmes.set(r.programme_id, p);
  }
  const all = [...programmes.values()];
  const international = new Map<string, { authorityId: string; authority: string; programmes: ProgrammeOption[] }>();
  for (const p of all.filter((x) => x.scope === 'INTERNATIONAL')) {
    const e = international.get(p.authorityId) ?? { authorityId: p.authorityId, authority: p.authority, programmes: [] };
    e.programmes.push(p);
    international.set(p.authorityId, e);
  }
  return {
    national: { country, countryName: country ? countryLabel(country) : null, programmes: all.filter((p) => p.scope === 'NATIONAL' && !!country && p.country === country) },
    international: [...international.values()].sort((a, b) => a.authority.localeCompare(b.authority, 'es')),
  };
}

export async function listStudentCurriculumOptions(country: string | null, schoolYear: string | null): Promise<StudentCurriculumOptions> {
  const gradeLevel = normaliseGradeLevel({ countryOfStudy: country, schoolYear });
  return buildCurriculumOptions(await loadCatalogue(), country && country !== 'OTHER' ? country : null, gradeLevel);
}

// ------------------------------------------------------------------ save

export class AcademicProfileSelectionError extends Error {
  constructor(public readonly code: 'PROGRAMME_NOT_FOUND' | 'SCOPE_MISMATCH' | 'COUNTRY_MISMATCH' | 'QUALIFICATION_NOT_IN_PROGRAMME' | 'QUALIFICATION_REQUIRED' | 'SUBJECT_NOT_IN_PROGRAMME') {
    super(code);
    this.name = 'AcademicProfileSelectionError';
  }
}

export interface AcademicProfileSelectionInput {
  countryOfStudy: CountryOfStudy;
  schoolYear: string | null;
  /** NATIONAL / INTERNATIONAL; null with curriculumType 'other' | 'not_sure'. */
  curriculumScope: CurriculumScope | null;
  /** null = the Student's programme is not catalogued yet ("no aparece"). */
  academicProgrammeId: string | null;
  academicQualificationId: string | null;
  academicSubjectIds: string[];
  /** Only for no-scope answers: 'other' | 'not_sure'. */
  curriculumType?: Extract<CurriculumType, 'other' | 'not_sure'>;
  academicYear: string | null;
  profileCompleted: boolean;
  /** REM-T1-03: structured time context columns (time-context.ts `timeContextColumns`). */
  timeColumns?: { academicYearStart: number | null; academicYearEnd: number | null; examSeries: string | null; examYear: number | null };
}

/** Pure: the legacy columns that keep older readers coherent (exported for tests). */
export function legacyColumns(input: { curriculumScope: CurriculumScope | null; curriculumType?: string; isIbDiploma: boolean; gradeLevel: number | null }): { curriculumType: CurriculumType; ibProgramme: 'DP' | null; ibYear: string | null } {
  if (input.isIbDiploma) return { curriculumType: 'ib', ibProgramme: 'DP', ibYear: input.gradeLevel !== null && input.gradeLevel >= 12 ? 'DP2' : 'DP1' };
  if (input.curriculumScope === 'NATIONAL') return { curriculumType: 'national', ibProgramme: null, ibYear: null };
  if (input.curriculumScope === 'INTERNATIONAL') return { curriculumType: 'other', ibProgramme: null, ibYear: null };
  return { curriculumType: input.curriculumType === 'not_sure' ? 'not_sure' : 'other', ibProgramme: null, ibYear: null };
}

export async function saveAcademicProfileSelection(studentId: string, input: AcademicProfileSelectionInput, actorUserId: string | null): Promise<{ changed: boolean }> {
  const scope = input.curriculumScope;
  let programme: CatalogueRow[] = [];
  if (input.academicProgrammeId) {
    programme = (await loadCatalogue()).filter((r) => r.programme_id === input.academicProgrammeId);
    if (programme.length === 0) throw new AcademicProfileSelectionError('PROGRAMME_NOT_FOUND');
    const pScope = curriculumScope({ country: programme[0].country, sourceType: programme[0].source_type });
    if (pScope !== scope) throw new AcademicProfileSelectionError('SCOPE_MISMATCH');
    if (pScope === 'NATIONAL' && programme[0].country !== input.countryOfStudy) throw new AcademicProfileSelectionError('COUNTRY_MISMATCH');
    const quals = new Set(programme.map((r) => r.qualification_id).filter(Boolean));
    if (input.academicQualificationId && !quals.has(input.academicQualificationId)) throw new AcademicProfileSelectionError('QUALIFICATION_NOT_IN_PROGRAMME');
    if (!input.academicQualificationId && quals.size > 1) throw new AcademicProfileSelectionError('QUALIFICATION_REQUIRED');
    const allowed = new Set(programme.filter((r) => !input.academicQualificationId || !r.qualification_id || r.qualification_id === input.academicQualificationId).map((r) => r.subject_id));
    if (input.academicSubjectIds.some((s) => !allowed.has(s))) throw new AcademicProfileSelectionError('SUBJECT_NOT_IN_PROGRAMME');
  } else if (input.academicQualificationId || input.academicSubjectIds.length) {
    throw new AcademicProfileSelectionError('PROGRAMME_NOT_FOUND');
  }
  const qualificationId = input.academicQualificationId ?? (programme.length && new Set(programme.map((r) => r.qualification_id)).size === 1 ? programme[0].qualification_id : null);
  const gradeLevel = normaliseGradeLevel({ countryOfStudy: input.countryOfStudy, schoolYear: input.schoolYear });
  const isIbDiploma = !!input.academicProgrammeId && programmesForFramework(await loadEligibilityGraph(), 'IB_DP').some((p) => p.programmeId === input.academicProgrammeId);
  const legacy = legacyColumns({ curriculumScope: scope, curriculumType: input.curriculumType, isIbDiploma, gradeLevel });
  const subjects = [...new Set(input.academicSubjectIds)].sort();

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const before = (await client.query(`SELECT curriculum_scope, academic_programme_id, academic_qualification_id, curriculum_type, country_of_study, school_year FROM student_academic_profile WHERE student_id = $1 FOR UPDATE`, [studentId])).rows[0] ?? null;
    const beforeSubjects = (await client.query(`SELECT academic_subject_id FROM student_academic_subjects WHERE student_id = $1 AND ended_at IS NULL ORDER BY academic_subject_id`, [studentId])).rows.map((r: any) => r.academic_subject_id as string);
    const curriculumChanged =
      !before || before.curriculum_scope !== scope || before.academic_programme_id !== input.academicProgrammeId || before.academic_qualification_id !== qualificationId || beforeSubjects.join() !== subjects.join();
    await client.query(
      `INSERT INTO student_academic_profile (student_id, country_of_study, school_year, curriculum_type, ib_programme, ib_year, academic_year, profile_completed,
                                             curriculum_scope, academic_programme_id, academic_qualification_id, grade_level, curriculum_selected_at,
                                             academic_year_start, academic_year_end, exam_series, exam_year)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $14, $15, $16, $17)
       ON CONFLICT (student_id) DO UPDATE SET
         country_of_study = EXCLUDED.country_of_study, school_year = EXCLUDED.school_year, curriculum_type = EXCLUDED.curriculum_type,
         ib_programme = EXCLUDED.ib_programme, ib_year = EXCLUDED.ib_year, academic_year = EXCLUDED.academic_year, profile_completed = EXCLUDED.profile_completed,
         curriculum_scope = EXCLUDED.curriculum_scope, academic_programme_id = EXCLUDED.academic_programme_id, academic_qualification_id = EXCLUDED.academic_qualification_id,
         grade_level = EXCLUDED.grade_level,
         curriculum_selected_at = CASE WHEN $13 THEN now() ELSE student_academic_profile.curriculum_selected_at END,
         academic_year_start = EXCLUDED.academic_year_start, academic_year_end = EXCLUDED.academic_year_end,
         exam_series = EXCLUDED.exam_series, exam_year = EXCLUDED.exam_year,
         updated_at = now()`,
      [studentId, input.countryOfStudy, input.schoolYear, legacy.curriculumType, legacy.ibProgramme, legacy.ibYear, input.academicYear, input.profileCompleted,
       scope, input.academicProgrammeId, qualificationId, gradeLevel, curriculumChanged,
       input.timeColumns?.academicYearStart ?? null, input.timeColumns?.academicYearEnd ?? null, input.timeColumns?.examSeries ?? null, input.timeColumns?.examYear ?? null]
    );
    // Subjects: end what is no longer followed, add what is new. Nothing is deleted.
    await client.query(`UPDATE student_academic_subjects SET ended_at = now() WHERE student_id = $1 AND ended_at IS NULL AND NOT (academic_subject_id = ANY($2::uuid[]))`, [studentId, subjects]);
    for (const s of subjects) {
      await client.query(`INSERT INTO student_academic_subjects (student_id, academic_subject_id) VALUES ($1, $2) ON CONFLICT (student_id, academic_subject_id) WHERE ended_at IS NULL DO NOTHING`, [studentId, s]);
    }
    if (curriculumChanged) {
      await recordGovernanceEvent(
        {
          institutionId: null,
          actorUserId,
          actorScope: 'STUDENT',
          objectType: 'STUDENT_ACADEMIC_PROFILE',
          objectId: studentId,
          action: before?.academic_programme_id || before?.curriculum_scope ? 'CURRICULUM_CHANGE' : 'CURRICULUM_SELECT',
          fields: ['curriculum_scope', 'academic_programme_id', 'academic_qualification_id', 'academic_subject_ids'],
          oldValues: { curriculumScope: before?.curriculum_scope ?? null, academicProgrammeId: before?.academic_programme_id ?? null, academicQualificationId: before?.academic_qualification_id ?? null, academicSubjectIds: beforeSubjects },
          newValues: { curriculumScope: scope, academicProgrammeId: input.academicProgrammeId, academicQualificationId: qualificationId, academicSubjectIds: subjects },
        },
        client
      );
    }
    await client.query('COMMIT');
    return { changed: curriculumChanged };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------ read

export interface ProfileCurriculum {
  scope: CurriculumScope | null;
  programmeId: string | null;
  programme: string | null;
  authority: string | null;
  qualificationId: string | null;
  qualification: string | null;
  subjects: Array<{ id: string; name: string; level: string | null }>;
  gradeLevel: number | null;
}

export async function getProfileCurriculum(studentId: string): Promise<ProfileCurriculum | null> {
  const r = await db.query(
    `SELECT sap.curriculum_scope, sap.academic_programme_id, p.name AS programme, o.name AS authority, sap.academic_qualification_id, q.name AS qualification, sap.grade_level
       FROM student_academic_profile sap
       LEFT JOIN academic_programmes p ON p.id = sap.academic_programme_id
       LEFT JOIN academic_organizations o ON o.id = p.organization_id
       LEFT JOIN academic_qualifications q ON q.id = sap.academic_qualification_id
      WHERE sap.student_id = $1`,
    [studentId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const subjects = await db.query(
    `SELECT a.id, a.name, a.level FROM student_academic_subjects s JOIN academic_subjects a ON a.id = s.academic_subject_id
      WHERE s.student_id = $1 AND s.ended_at IS NULL ORDER BY a.name, a.level NULLS FIRST`,
    [studentId]
  );
  return {
    scope: row.curriculum_scope,
    programmeId: row.academic_programme_id,
    programme: row.programme,
    authority: row.authority,
    qualificationId: row.academic_qualification_id,
    qualification: row.qualification,
    subjects: subjects.rows.map((s: any) => ({ id: s.id, name: s.name, level: s.level })),
    gradeLevel: row.grade_level,
  };
}
