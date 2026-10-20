/**
 * Phase A -- Student Academic Profile -> canonical curriculum catalogue.
 * Pure option building, legacy coherence, eligibility through the selected
 * programme, render of the wizard, and source / migration guards.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { buildCurriculumOptions, legacyColumns } from '@/services/academic-profile-catalogue.service';
import { buildAcademicContext } from '@/lib/exam-core/eligibility/academic-context';
import { buildEligibilityGraph, frameworkByConfigKey } from '@/lib/exam-core/eligibility/graph';
import { resolveObjectiveEligibility } from '@/lib/exam-core/eligibility/rules';
import { examObjectives } from '@/lib/exam-core/objectives/objective-catalog';
import { isAcademicProfileComplete } from '@/lib/student/onboarding-gate';
import { getMessages } from '@/lib/i18n/messages';
import { ACADEMIC_PROFILE_MESSAGES } from '@/lib/i18n/academic-profile-messages';
import AcademicProfileWizard from '@/app/dashboard/profile/AcademicProfileWizard';

const ROOT = join(__dirname, '..', '..');

const row = (o: Partial<Record<string, unknown>>) => ({
  subject_id: 's', subject: 'Mathematics', level: null, qualification_id: null, qualification: null,
  programme_id: 'p', programme: 'P', grade_min: null, grade_max: null,
  authority_id: 'a', authority: 'A', country: null, source_type: 'INTERNATIONAL_PROGRAMME', ...o,
}) as never;

const CATALOGUE = [
  row({ subject_id: 'sep-sec', programme_id: 'sep-sec', programme: 'Educación Secundaria — Plan de Estudio 2022', grade_min: 7, grade_max: 9, authority_id: 'sep', authority: 'SEP', country: 'MX', source_type: 'GOVERNMENT_AUTHORITY' }),
  row({ subject_id: 'sep-ms', programme_id: 'sep-ms', programme: 'MCCEMS', grade_min: 10, grade_max: 12, authority_id: 'sep', authority: 'SEP', country: 'MX', source_type: 'GOVERNMENT_AUTHORITY' }),
  row({ subject_id: 'men', programme_id: 'men', programme: 'Estándares Básicos', grade_min: 1, grade_max: 11, authority_id: 'men', authority: 'MEN', country: 'CO', source_type: 'GOVERNMENT_AUTHORITY' }),
  row({ subject_id: 'ib-bio-hl', subject: 'Biology', level: 'HL', programme_id: 'ib-dp', programme: 'IB Diploma Programme', grade_min: 11, grade_max: 12, authority_id: 'ib', authority: 'International Baccalaureate' }),
  row({ subject_id: 'ib-bio-sl', subject: 'Biology', level: 'SL', programme_id: 'ib-dp', programme: 'IB Diploma Programme', grade_min: 11, grade_max: 12, authority_id: 'ib', authority: 'International Baccalaureate' }),
  row({ subject_id: 'igcse-0580', subject: 'Mathematics (0580)', level: 'Extended', qualification_id: 'q-igcse', qualification: 'Cambridge IGCSE', programme_id: 'cie-igcse', programme: 'Cambridge IGCSE', grade_min: 9, grade_max: 10, authority_id: 'cie', authority: 'Cambridge International Education' }),
  row({ subject_id: 'aice-9709-as', subject: 'Mathematics', level: 'AS Level', qualification_id: 'q-as', qualification: 'AS Level', programme_id: 'cie-aice', programme: 'Cambridge AICE Diploma', grade_min: 11, grade_max: 12, authority_id: 'cie2', authority: 'Cambridge International' }),
  row({ subject_id: 'aice-9709-a', subject: 'Mathematics', level: 'A Level', qualification_id: 'q-a', qualification: 'A Level', programme_id: 'cie-aice', programme: 'Cambridge AICE Diploma', grade_min: 11, grade_max: 12, authority_id: 'cie2', authority: 'Cambridge International' }),
  row({ subject_id: 'unknown', programme_id: 'unknown-range', programme: 'Some International Programme', authority_id: 'x', authority: 'X' }),
];

describe('curriculum options from the catalogue', () => {
  it('national = only the Student country; international grouped by authority', () => {
    const o = buildCurriculumOptions(CATALOGUE, 'MX', 10);
    expect(o.national.programmes.map((p) => p.id).sort()).toEqual(['sep-ms', 'sep-sec']);
    expect(o.international.map((a) => a.authority)).toEqual(['Cambridge International', 'Cambridge International Education', 'International Baccalaureate', 'X']);
  });
  it('grade compatibility: IGCSE is not offered as compatible to a grade-7 Student; unknown ranges always are', () => {
    const o = buildCurriculumOptions(CATALOGUE, 'MX', 7);
    const p = (id: string) => [...o.national.programmes, ...o.international.flatMap((a) => a.programmes)].find((x) => x.id === id)!;
    expect(p('cie-igcse').compatible).toBe(false);
    expect(p('ib-dp').compatible).toBe(false);
    expect(p('sep-sec').compatible).toBe(true);
    expect(p('sep-ms').compatible).toBe(false);
    expect(p('unknown-range').compatible).toBe(true);
  });
  it('Cambridge and IB appear for a compatible grade, with qualifications and subjects', () => {
    const o = buildCurriculumOptions(CATALOGUE, 'CO', 11);
    const all = o.international.flatMap((a) => a.programmes);
    const aice = all.find((p) => p.id === 'cie-aice')!;
    expect(aice.compatible).toBe(true);
    expect(aice.qualifications.map((q) => q.name).sort()).toEqual(['A Level', 'AS Level']);
    expect(all.find((p) => p.id === 'ib-dp')!.subjects.map((s) => `${s.name} ${s.level}`)).toEqual(['Biology HL', 'Biology SL']);
    expect(o.national.programmes.map((p) => p.id)).toEqual(['men']);
  });
  it('no country -> no national programmes', () => {
    expect(buildCurriculumOptions(CATALOGUE, null, 10).national.programmes).toEqual([]);
  });
});

describe('legacy columns stay coherent for older readers and the onboarding gate', () => {
  it('IB DP from the catalogue -> ib + DP + DP1 / DP2', () => {
    expect(legacyColumns({ curriculumScope: 'INTERNATIONAL', isIbDiploma: true, gradeLevel: 11 })).toEqual({ curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP1' });
    expect(legacyColumns({ curriculumScope: 'INTERNATIONAL', isIbDiploma: true, gradeLevel: 12 })).toEqual({ curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP2' });
  });
  it('national / international / other / not sure', () => {
    expect(legacyColumns({ curriculumScope: 'NATIONAL', isIbDiploma: false, gradeLevel: 10 }).curriculumType).toBe('national');
    expect(legacyColumns({ curriculumScope: 'INTERNATIONAL', isIbDiploma: false, gradeLevel: 10 }).curriculumType).toBe('other');
    expect(legacyColumns({ curriculumScope: null, curriculumType: 'not_sure', isIbDiploma: false, gradeLevel: 10 }).curriculumType).toBe('not_sure');
  });
  it('an IB DP selection passes the onboarding completeness rule', () => {
    const l = legacyColumns({ curriculumScope: 'INTERNATIONAL', isIbDiploma: true, gradeLevel: 11 });
    expect(isAcademicProfileComplete({ profileCompleted: true, countryOfStudy: 'CO', schoolYear: '11', curriculumType: l.curriculumType, ibProgramme: l.ibProgramme, ibYear: l.ibYear, academicYear: '2026' } as never)).toBe(true);
  });
});

describe('eligibility through the selected programme', () => {
  const objectives = examObjectives();
  type Host = { config_key: string; programme_id: string; programme_name: string; organization_name: string; academic_subject_id: string | null };
  const rows = objectives.flatMap<Host>((o) =>
    o.framework === 'CIE_IGCSE' ? o.configKeys.map((k) => ({ config_key: k, programme_id: 'cie-igcse', programme_name: 'Cambridge IGCSE', organization_name: 'Cambridge International Education', academic_subject_id: 'igcse-0580' }))
    : o.framework === 'IB_DP' ? o.configKeys.map((k) => ({ config_key: k, programme_id: 'ib-dp', programme_name: 'IB Diploma Programme', organization_name: 'IB', academic_subject_id: null }))
    : []
  );
  const graph = buildEligibilityGraph(rows, frameworkByConfigKey());
  it('a self-selected Cambridge IGCSE Student sees Cambridge (subject reason), never IB', () => {
    const ctx = buildAcademicContext({
      profile: { countryOfStudy: 'MX', schoolYear: '3° Secundaria', curriculumType: 'other', profileCompleted: true },
      profileCurriculum: { programmeId: 'cie-igcse', programme: 'Cambridge IGCSE', subjects: [{ id: 'igcse-0580', name: 'Mathematics (0580)', level: 'Extended' }] },
      classRows: [], assignments: [], graph,
    });
    const e = new Map(resolveObjectiveEligibility(objectives, ctx, graph).map((x) => [x.key, x]));
    expect(e.get('cie.igcse.0580.extended')!.reasons[0]).toMatchObject({ code: 'CURRICULUM_SUBJECT', subject: 'Mathematics (0580) Extended' });
    expect([...e.values()].some((x) => x.eligible && x.framework === 'IB_DP')).toBe(false);
  });
  it('a stored programme replaces the legacy inference (no double IB)', () => {
    const ctx = buildAcademicContext({
      profile: { countryOfStudy: 'CO', schoolYear: '11', curriculumType: 'ib', ibProgramme: 'DP', profileCompleted: true },
      profileCurriculum: { programmeId: 'cie-igcse', programme: 'Cambridge IGCSE', subjects: [] },
      classRows: [], assignments: [], graph,
    });
    expect(ctx.programmes.map((p) => p.programmeId)).toEqual(['cie-igcse']);
  });
});

describe('wizard', () => {
  const t = getMessages('es') as Record<string, string>;
  const base = { countryOfStudy: null, schoolYear: null, curriculumType: null, curriculumScope: null, academicProgrammeId: null, academicQualificationId: null, academicSubjectIds: [], academicYear: null, profileCompleted: false };
  it('a new Student starts at Country', () => {
    const html = renderToStaticMarkup(createElement(AcademicProfileWizard, { t, initial: base }));
    expect(html).toContain(t['profile.stepCountryQuestion']);
    expect(html).not.toMatch(/undefined/);
  });
  it('a completed profile is NOT asked again: only an explicit "Cambiar" action', () => {
    const html = renderToStaticMarkup(createElement(AcademicProfileWizard, { t, initial: { ...base, countryOfStudy: 'CO', schoolYear: '11', curriculumType: 'national', curriculumScope: 'NATIONAL', academicYear: '2026', profileCompleted: true } }));
    expect(html).toContain(t['acp.summary.change']);
    expect(html).not.toContain(t['profile.stepCountryQuestion']);
  });
  it('copy exists in every locale and never claims official status', () => {
    for (const [locale, c] of Object.entries(ACADEMIC_PROFILE_MESSAGES)) for (const [k, v] of Object.entries(c)) expect(v, `${locale} ${k}`).not.toMatch(/oficial de Cambridge|official Cambridge|eligib|programme_id/i);
  });
});

describe('source guards', () => {
  const svc = readFileSync(join(ROOT, 'src/services/academic-profile-catalogue.service.ts'), 'utf-8');
  it('a curriculum change never deletes: subjects are ENDED, learner tables untouched, change audited', () => {
    expect(svc).not.toMatch(/DELETE FROM/);
    expect(svc).toMatch(/UPDATE student_academic_subjects SET ended_at = now\(\)/);
    expect(svc).not.toMatch(/(INSERT INTO|UPDATE|FROM|JOIN)\s+(learner|concept_|mastery|exam_attempt|learning_evidence|student_exam_profiles)/i);
    expect(svc).toMatch(/objectType: 'STUDENT_ACADEMIC_PROFILE'/);
  });
  it('only CURRICULUM programmes are options (exams are never curricula)', () => {
    expect(svc).toMatch(/p\.programme_type = 'CURRICULUM'/);
  });
  it('the API validates the selection against the catalogue and reports 422', () => {
    const route = readFileSync(join(ROOT, 'src/app/api/academic-profile/route.ts'), 'utf-8');
    expect(route).toMatch(/saveAcademicProfileSelection/);
    expect(route).toMatch(/AcademicProfileSelectionError\) return NextResponse\.json\(\{ error: error\.code \}, \{ status: 422 \}\)/);
    expect(route).toMatch(/academicSubjectIds: z\.array\(z\.string\(\)\.uuid\(\)\)\.max\(40\)/);
  });
});

describe('migration 20261030_1000 is additive', () => {
  const sql = readFileSync(join(ROOT, 'database/migrations/20261030_1000_student_academic_profile_catalogue.sql'), 'utf-8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  it('adds nullable columns / one table / checks; the only UPDATE fills NULL grade ranges', () => {
    expect(sql).not.toMatch(/DROP |DELETE FROM|TRUNCATE|ALTER COLUMN|SET NOT NULL/);
    expect(sql.match(/UPDATE /g)).toHaveLength(1);
    expect(sql).toMatch(/p\.grade_min IS NULL AND p\.grade_max IS NULL/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.student_academic_subjects/);
  });
});
