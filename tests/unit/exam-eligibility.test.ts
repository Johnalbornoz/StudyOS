/**
 * Exam eligibility (Phase C/D) -- Academic Profile -> Curriculum binding -> Exam Eligibility.
 * Pure resolver against the REAL objective catalogue with a graph built the same
 * way loadEligibilityGraph builds it (hosting rows -> buildEligibilityGraph).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { examObjectives, type ObjectiveFramework } from '@/lib/exam-core/objectives/objective-catalog';
import { normaliseGradeLevel } from '@/lib/exam-core/eligibility/grade-level';
import { buildEligibilityGraph, frameworkByConfigKey } from '@/lib/exam-core/eligibility/graph';
import { buildAcademicContext } from '@/lib/exam-core/eligibility/academic-context';
import { assignableFrameworks } from '@/lib/exam-core/eligibility/class-exam-assignment.service';
import { resolveObjectiveEligibility, NON_CURRICULUM_FRAMEWORKS, type EligibilityGraph, type StudentAcademicContext } from '@/lib/exam-core/eligibility/rules';
import { orderFrameworks, reasonText } from '@/lib/exam-core/objectives/picker';
import { EXAM_ELIGIBILITY_MESSAGES } from '@/lib/i18n/exam-eligibility-messages';

const ROOT = join(__dirname, '..', '..');
const OBJECTIVES = examObjectives();

// Programme ids as on DEV / Preview: each curriculum programme hosts the config keys of its framework.
const IB_DP = 'prog-ib-dp';
const CIE_IGCSE = 'prog-cie-igcse';
const CIE_AICE = 'prog-cie-aice';
const CIE_UPPER_SECONDARY = 'prog-cie-upper-secondary';
const SUBJECT_0580 = 'subj-0580';
const SUBJECT_IB_MATH_AA = 'subj-ib-math-aa';
const SUBJECT_9709 = 'subj-9709';

function hostingRows() {
  const rows: Array<{ config_key: string; programme_id: string; programme_name: string; organization_name: string; academic_subject_id: string | null }> = [];
  for (const o of OBJECTIVES) {
    for (const k of o.configKeys) {
      if (o.framework === 'IB_DP') rows.push({ config_key: k, programme_id: IB_DP, programme_name: 'IB Diploma Programme', organization_name: 'International Baccalaureate', academic_subject_id: /math-aa/.test(k) ? SUBJECT_IB_MATH_AA : `subj-${k}` });
      if (o.framework === 'CIE_IGCSE') rows.push({ config_key: k, programme_id: CIE_IGCSE, programme_name: 'Cambridge IGCSE', organization_name: 'Cambridge International Education', academic_subject_id: SUBJECT_0580 });
      if (o.framework === 'CIE_AS_A') rows.push({ config_key: k, programme_id: CIE_AICE, programme_name: 'Cambridge AICE Diploma', organization_name: 'Cambridge International', academic_subject_id: /9709/.test(k) ? SUBJECT_9709 : `subj-${k}` });
    }
  }
  // A DEV certification fixture hosted by another programme is NOT an objective config key: no link.
  rows.push({ config_key: 'dev-cert.cambridge.0580', programme_id: CIE_UPPER_SECONDARY, programme_name: 'Cambridge Upper Secondary', organization_name: 'Cambridge International', academic_subject_id: 'subj-dev' });
  return rows;
}
const GRAPH: EligibilityGraph = buildEligibilityGraph(hostingRows(), frameworkByConfigKey());

const ctx = (over: Partial<StudentAcademicContext> = {}): StudentAcademicContext => ({ country: null, gradeLevel: null, programmes: [], assignments: [], profileCompleted: true, ...over });
const eligibleFrameworks = (c: StudentAcademicContext) => new Set(resolveObjectiveEligibility(OBJECTIVES, c, GRAPH).filter((e) => e.eligible).map((e) => e.framework));
const byKey = (c: StudentAcademicContext) => new Map(resolveObjectiveEligibility(OBJECTIVES, c, GRAPH).map((e) => [e.key, e]));
const classProgramme = (programmeId: string, programmeName: string, subjects: Array<[string, string]> = []) => ({
  programmeId, programmeName, academicSubjectIds: subjects.map((s) => s[0]), subjectNames: subjects.map((s) => s[1]), source: 'CLASS' as const, classId: 'class-1', className: 'Math 11',
});

// ------------------------------------------------------------------ grade
describe('grade normalisation (years of schooling, US scale)', () => {
  it.each([
    [{ countryOfStudy: 'CO', schoolYear: '11°' }, 11],
    [{ countryOfStudy: 'CO', schoolYear: '11' }, 11],
    [{ countryOfStudy: 'CO', schoolYear: '10' }, 10],
    [{ countryOfStudy: 'MX', schoolYear: '2° Secundaria' }, 8],
    [{ countryOfStudy: 'MX', schoolYear: '1° Preparatoria' }, 10],
    [{ countryOfStudy: 'MX', schoolYear: '3° Preparatoria' }, 12],
    [{ countryOfStudy: 'US', schoolYear: 'Grade 9' }, 9],
    [{ countryOfStudy: 'DE', schoolYear: 'Klasse 10' }, 10],
    [{ countryOfStudy: 'OTHER', schoolYear: null, curriculumType: 'ib', ibYear: 'DP1' }, 11],
    [{ countryOfStudy: 'OTHER', schoolYear: '', curriculumType: 'ib', ibYear: 'MYP 4' }, 9],
    [{ countryOfStudy: 'CO', schoolYear: 'abc' }, null],
    [{ countryOfStudy: 'MX', schoolYear: '5° Preparatoria' }, null],
    [null, null],
  ])('%j -> %s', (input, expected) => {
    expect(normaliseGradeLevel(input as never)).toBe(expected);
  });
});

// ------------------------------------------------------------------ graph
describe('evidence graph (catalogue only, never by name)', () => {
  it('links each curriculum programme only to the frameworks whose config keys it hosts', () => {
    const fw = (id: string) => GRAPH.programmes.find((p) => p.programmeId === id)?.frameworks ?? [];
    expect(fw(IB_DP)).toEqual(['IB_DP']);
    expect(fw(CIE_IGCSE)).toEqual(['CIE_IGCSE']);
    expect(fw(CIE_AICE)).toEqual(['CIE_AS_A']);
  });
  it('a programme that hosts only non-objective fixtures gets no link', () => {
    expect(GRAPH.programmes.find((p) => p.programmeId === CIE_UPPER_SECONDARY)).toBeUndefined();
  });
  it('subject-level evidence: config key -> academic subject', () => {
    const k0580 = OBJECTIVES.find((o) => o.key === 'cie.igcse.0580.extended')!.configKeys[0];
    expect(GRAPH.subjectsByConfigKey[k0580]).toEqual([SUBJECT_0580]);
  });
});

// ------------------------------------------------------------------ eligibility
describe('curriculum -> exam eligibility', () => {
  it('no academic context -> nothing recommended (the global catalogue is never the default)', () => {
    expect(eligibleFrameworks(ctx({ profileCompleted: false })).size).toBe(0);
  });

  it('IB DP Student sees IB DP, never Cambridge by default', () => {
    const f = eligibleFrameworks(ctx({ programmes: [{ ...classProgramme(IB_DP, 'IB Diploma Programme'), source: 'PROFILE', className: undefined, classId: undefined }] }));
    expect([...f]).toEqual(['IB_DP']);
  });

  it('Cambridge AICE class sees AS & A Level + the AICE planner, not IGCSE, IB, PISA, PAA or Saber', () => {
    const f = eligibleFrameworks(ctx({ programmes: [classProgramme(CIE_AICE, 'Cambridge AICE Diploma', [[SUBJECT_9709, 'Mathematics']])] }));
    expect([...f].sort()).toEqual(['CIE_AICE', 'CIE_AS_A']);
  });

  it('Cambridge IGCSE Mathematics class: 0580 Extended by subject, 0580 Core by programme; subject first', () => {
    const m = byKey(ctx({ programmes: [classProgramme(CIE_IGCSE, 'Cambridge IGCSE', [[SUBJECT_0580, 'Mathematics (0580)']])] }));
    const ext = m.get('cie.igcse.0580.extended')!;
    const core = m.get('cie.igcse.0580.core')!;
    expect(ext.eligible && core.eligible).toBe(true);
    expect(ext.reasons[0]).toMatchObject({ code: 'CURRICULUM_SUBJECT', programme: 'Cambridge IGCSE', subject: 'Mathematics (0580)', className: 'Math 11' });
    expect(core.reasons[0].code).toBe('CURRICULUM');
    expect(ext.rank).toBeLessThan(core.rank);
  });

  it('IB class with Mathematics AA ranks the AA objectives first', () => {
    const m = byKey(ctx({ programmes: [classProgramme(IB_DP, 'IB Diploma Programme', [[SUBJECT_IB_MATH_AA, 'Mathematics: analysis and approaches']])] }));
    const aa = OBJECTIVES.filter((o) => o.framework === 'IB_DP' && /analysis/i.test(o.label));
    expect(aa.length).toBeGreaterThan(0);
    for (const o of aa) expect(m.get(o.key)!.reasons[0].code).toBe('CURRICULUM_SUBJECT');
    const other = OBJECTIVES.find((o) => o.framework === 'IB_DP' && !/analysis/i.test(o.label))!;
    expect(m.get(other.key)!.reasons[0].code).toBe('CURRICULUM');
  });

  it('Saber 11 only for Colombia, grades 10-11', () => {
    expect(eligibleFrameworks(ctx({ country: 'CO', gradeLevel: 11 })).has('SABER11')).toBe(true);
    expect(eligibleFrameworks(ctx({ country: 'CO', gradeLevel: 8 })).has('SABER11')).toBe(false);
    expect(eligibleFrameworks(ctx({ country: 'MX', gradeLevel: 11 })).has('SABER11')).toBe(false);
  });

  it('PAA only for Mexico (and Puerto Rico) upper secondary', () => {
    expect(eligibleFrameworks(ctx({ country: 'MX', gradeLevel: 12 })).has('PAA')).toBe(true);
    expect(eligibleFrameworks(ctx({ country: 'MX', gradeLevel: 8 })).has('PAA')).toBe(false);
    expect(eligibleFrameworks(ctx({ country: 'CO', gradeLevel: 11 })).has('PAA')).toBe(false);
  });

  it('PISA only at the PISA age stage (grade 9-10), any country', () => {
    expect(eligibleFrameworks(ctx({ country: 'DE', gradeLevel: 10 })).has('PISA')).toBe(true);
    expect(eligibleFrameworks(ctx({ country: 'CO', gradeLevel: 11 })).has('PISA')).toBe(false);
    expect(eligibleFrameworks(ctx({ country: null, gradeLevel: null })).has('PISA')).toBe(false);
  });

  it('a supported assessment never appears just because StudyUs supports it', () => {
    const f = eligibleFrameworks(ctx({ country: 'US', gradeLevel: 6 }));
    for (const nc of NON_CURRICULUM_FRAMEWORKS) expect(f.has(nc)).toBe(false);
  });

  it('an institution assignment adds an assessment, with the strongest rank and a reason', () => {
    const m = byKey(ctx({ country: 'CO', gradeLevel: 7, assignments: [{ objectiveKey: 'pisa.2022', classId: 'c', className: 'Math 9B', institutionName: 'Colegio' }] }));
    expect(m.get('pisa.2022')).toMatchObject({ eligible: true, rank: 0 });
    expect(m.get('pisa.2022')!.reasons[0]).toMatchObject({ code: 'INSTITUTION_ASSIGNED', className: 'Math 9B' });
  });

  it('two curricula side by side each give their own reason (never merged)', () => {
    const f = eligibleFrameworks(ctx({ programmes: [classProgramme(IB_DP, 'IB Diploma Programme'), { ...classProgramme(CIE_IGCSE, 'Cambridge IGCSE'), source: 'PROFILE' }] }));
    expect([...f].sort()).toEqual(['CIE_IGCSE', 'IB_DP']);
  });

  it('framework order follows specificity: assignment, subject, programme, governed rule', () => {
    const e = resolveObjectiveEligibility(OBJECTIVES, ctx({ country: 'CO', gradeLevel: 11, programmes: [classProgramme(IB_DP, 'IB Diploma Programme')], assignments: [{ objectiveKey: 'cie.igcse.0580.core', classId: 'c', className: 'X', institutionName: 'Y' }] }), GRAPH);
    expect(orderFrameworks(e)).toEqual(['CIE_IGCSE', 'IB_DP', 'SABER11']);
  });
});

// ------------------------------------------------------------------ context adapter
describe('academic context adapter', () => {
  const base = { classRows: [], assignments: [], graph: GRAPH };
  it('legacy IB + DP profile resolves to the programme hosting IB DP (catalogue evidence)', () => {
    const c = buildAcademicContext({ ...base, profile: { countryOfStudy: 'MX', schoolYear: '3° Preparatoria', curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP2', profileCompleted: true } });
    expect(c.programmes).toEqual([expect.objectContaining({ programmeId: IB_DP, source: 'PROFILE' })]);
    expect(c.gradeLevel).toBe(12);
    expect(c.country).toBe('MX');
  });
  it('IB without a programme counts as DP only at the DP stage (grade 11+)', () => {
    expect(buildAcademicContext({ ...base, profile: { countryOfStudy: 'US', schoolYear: '11', curriculumType: 'ib', ibProgramme: null, profileCompleted: true } }).programmes.map((p) => p.programmeId)).toEqual([IB_DP]);
    expect(buildAcademicContext({ ...base, profile: { countryOfStudy: 'US', schoolYear: 'Grade 9', curriculumType: 'ib', ibProgramme: null, profileCompleted: true } }).programmes).toEqual([]);
  });
  it('IB MYP and "national" declare no exam programme (none catalogued)', () => {
    expect(buildAcademicContext({ ...base, profile: { countryOfStudy: 'CO', schoolYear: '9', curriculumType: 'ib', ibProgramme: 'MYP', profileCompleted: true } }).programmes).toEqual([]);
    expect(buildAcademicContext({ ...base, profile: { countryOfStudy: 'CO', schoolYear: '11', curriculumType: 'national', profileCompleted: true } }).programmes).toEqual([]);
  });
  it('explicit class binding is read as its own CLASS programme with its subject', () => {
    const c = buildAcademicContext({ ...base, profile: null, classRows: [{ class_id: 'k', class_name: 'Math 11', programme_id: CIE_AICE, programme_name: 'Cambridge AICE Diploma', academic_subject_id: SUBJECT_9709, subject_name: 'Mathematics', organization_country: null }] });
    expect(c.programmes).toEqual([expect.objectContaining({ programmeId: CIE_AICE, source: 'CLASS', className: 'Math 11', academicSubjectIds: [SUBJECT_9709] })]);
    expect(c.profileCompleted).toBe(false);
  });
  it('a class without curriculum binding contributes no programme (no implicit binding)', () => {
    const c = buildAcademicContext({ ...base, profile: null, classRows: [{ class_id: 'k', class_name: 'X', programme_id: null, programme_name: null, academic_subject_id: null, subject_name: null, organization_country: null }] });
    expect(c.programmes).toEqual([]);
  });
  it('country falls back to the national authority of the class curriculum only when unambiguous', () => {
    const row = (country: string) => ({ class_id: country, class_name: 'X', programme_id: 'p', programme_name: 'SEP', academic_subject_id: null, subject_name: null, organization_country: country });
    expect(buildAcademicContext({ ...base, profile: null, classRows: [row('MX')] }).country).toBe('MX');
    expect(buildAcademicContext({ ...base, profile: null, classRows: [row('MX'), row('CO')] }).country).toBeNull();
    expect(buildAcademicContext({ ...base, profile: { countryOfStudy: 'CO', profileCompleted: true }, classRows: [row('MX')] }).country).toBe('CO');
  });
});

// ------------------------------------------------------------------ assignment governance
describe('class exam assignment governance', () => {
  it('a class may receive its own curriculum exams + assessments outside the curriculum', () => {
    expect([...assignableFrameworks(IB_DP, GRAPH)].sort()).toEqual(['IB_DP', 'PAA', 'PISA', 'SABER11']);
    expect([...assignableFrameworks(CIE_AICE, GRAPH)].sort()).toEqual(['CIE_AICE', 'CIE_AS_A', 'PAA', 'PISA', 'SABER11']);
  });
  it('an IB class is never assignable Cambridge; a class without curriculum only outside-curriculum assessments', () => {
    expect(assignableFrameworks(IB_DP, GRAPH).has('CIE_IGCSE' as ObjectiveFramework)).toBe(false);
    expect([...assignableFrameworks(null, GRAPH)].sort()).toEqual(['PAA', 'PISA', 'SABER11']);
  });
});

// ------------------------------------------------------------------ copy
describe('reasons are plain language, in every locale', () => {
  it('no internal mapping terms, and nothing claims official content', () => {
    for (const [locale, catalog] of Object.entries(EXAM_ELIGIBILITY_MESSAGES)) {
      for (const [k, v] of Object.entries(catalog)) {
        expect(v, `${locale} ${k}`).not.toMatch(/config|framework|programme_id|eligib|mapping|objective_key/i);
        expect(v, `${locale} ${k}`).not.toMatch(/oficial|official|officiel/i);
      }
    }
  });
  it('the Spanish reasons read as the brief asks', () => {
    const t = EXAM_ELIGIBILITY_MESSAGES.es as Record<string, string>;
    expect(reasonText({ code: 'CURRICULUM_SUBJECT', programme: 'Cambridge IGCSE', subject: 'Mathematics (0580)' }, t, { subjectLevel: true })).toBe('Disponible porque sigues Cambridge IGCSE · Mathematics (0580).');
    expect(reasonText({ code: 'INSTITUTION_ASSIGNED', className: 'Math 11' }, t, { subjectLevel: true })).toBe('Asignado por tu institución (Math 11).');
    expect(reasonText({ code: 'CURRICULUM_SUBJECT', programme: 'IB Diploma Programme', subject: 'X', className: 'Math 11' }, t, { subjectLevel: false })).toBe('Disponible porque tu clase Math 11 sigue IB Diploma Programme.');
  });
});

// ------------------------------------------------------------------ non-regression guards (source)
describe('eligibility never touches scoring, evidence or learner state', () => {
  const dir = join(ROOT, 'src/lib/exam-core/eligibility');
  const files = ['rules.ts', 'graph.ts', 'academic-context.ts', 'eligibility.service.ts', 'class-exam-assignment.service.ts', 'grade-level.ts'];
  it('reads only catalogue / profile / enrollment tables and writes only class_exam_assignments + audit', () => {
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf-8');
      expect(src, f).not.toMatch(/INSERT INTO (?!class_exam_assignments)/);
      expect(src, f).not.toMatch(/UPDATE (?!class_exam_assignments)[a-z_]+ SET/);
      expect(src, f).not.toMatch(/DELETE FROM|TRUNCATE/);
      expect(src, f).not.toMatch(/learner_concept|mastery|exam_attempt|readiness_snapshot/i);
    }
  });
  it('preparation creation records eligibility but never refuses a personal goal', () => {
    const src = readFileSync(join(ROOT, 'src/lib/exam-core/objectives/preparation.service.ts'), 'utf-8');
    expect(src).toMatch(/eligibility: eligibilityContext/);
    expect(src).not.toMatch(/NOT_ELIGIBLE/);
  });
  it('assignment routes are scoped: institution admin permission / teacher of the class', () => {
    const inst = readFileSync(join(ROOT, 'src/app/api/institutions/[id]/classes/[classId]/exam-assignments/route.ts'), 'utf-8');
    const instDel = readFileSync(join(ROOT, 'src/app/api/institutions/[id]/classes/[classId]/exam-assignments/[assignmentId]/route.ts'), 'utf-8');
    const teach = readFileSync(join(ROOT, 'src/app/api/teacher/classes/[classId]/exam-assignments/route.ts'), 'utf-8');
    const teachDel = readFileSync(join(ROOT, 'src/app/api/teacher/classes/[classId]/exam-assignments/[assignmentId]/route.ts'), 'utf-8');
    for (const s of [inst, instDel]) expect(s.match(/requireInstitutionAdminActor\(id, 'TEACHER_ASSIGNMENT_MANAGE'\)/g)?.length).toBeGreaterThanOrEqual(1);
    expect(inst.match(/requireInstitutionAdminActor/g)?.length).toBe(3); // import + GET + POST
    for (const s of [teach, teachDel]) expect(s).toMatch(/getTeacherClass\(actor\.userId, classId\)/);
    expect(teach).toMatch(/actorScope: 'TEACHER'/);
    expect(inst).toMatch(/actorScope: 'INSTITUTION'/);
  });
});

describe('migration 20261029_1000 is additive', () => {
  const sql = readFileSync(join(ROOT, 'database/migrations/20261029_1000_class_exam_assignments.sql'), 'utf-8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  it('creates one table + indexes; drops / alters nothing', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.class_exam_assignments/);
    expect(sql).toMatch(/uq_class_exam_assignments_active[\s\S]*WHERE status = 'ACTIVE'/);
    expect(sql).not.toMatch(/DROP |ALTER TABLE|DELETE FROM|TRUNCATE|UPDATE /);
  });
});
