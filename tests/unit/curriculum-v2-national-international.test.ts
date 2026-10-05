/**
 * Institution Curriculum Configuration V2 -- national + international curricula.
 * Pure catalogue logic + source-level guarantees (exam separation, explicit
 * binding, security, mobile).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  availableScopes,
  countryLabel,
  curriculumScope,
  internationalAuthorities,
  internationalProgrammes,
  nationalCountries,
  nationalProgrammes,
  programmeQualifications,
  type ScopedSource,
} from '@/lib/curriculum/catalog-scope';
import { rankCurriculumCandidates } from '@/lib/institution/curriculum-identity';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/** Source without comments: guarantees are about code, not the prose explaining it. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let n = 0;
const src = (o: Partial<ScopedSource> & Pick<ScopedSource, 'programme' | 'authority' | 'subject'>): ScopedSource => ({
  academicSubjectId: `s${++n}`,
  versionId: `v${n}`,
  level: null,
  qualification: null,
  programmeId: `p:${o.programme}`,
  authorityId: `a:${o.authority}`,
  country: null,
  sourceType: 'INTERNATIONAL_PROGRAMME',
  ...o,
});

// A catalogue shaped like DEV / Preview after classification (exam programmes never reach it).
const CATALOGUE: ScopedSource[] = [
  src({ authority: 'Secretaría de Educación Pública (SEP)', programme: 'Educación Secundaria — Plan de Estudio 2022', subject: 'Matemáticas', country: 'MX', sourceType: 'GOVERNMENT_AUTHORITY' }),
  src({ authority: 'Secretaría de Educación Pública (SEP)', programme: 'Educación Media Superior — MCCEMS', subject: 'Matemáticas', country: 'MX', sourceType: 'GOVERNMENT_AUTHORITY' }),
  src({ authority: 'Ministerio de Educación Nacional (MEN)', programme: 'Estándares Básicos de Competencias y DBA', subject: 'Matemáticas', country: 'CO', sourceType: 'GOVERNMENT_AUTHORITY' }),
  src({ authority: 'Secretaría de Educación de Antioquia', programme: 'Educación Media (10.º–11.º)', subject: 'Matemáticas', country: 'CO', sourceType: 'GOVERNMENT_AUTHORITY' }),
  src({ authority: 'International Baccalaureate', programme: 'IB Diploma Programme', subject: 'Mathematics: analysis and approaches', level: 'SL' }),
  src({ authority: 'International Baccalaureate', programme: 'IB Diploma Programme', subject: 'Biology', level: 'HL' }),
  src({ authority: 'Cambridge International', programme: 'Cambridge AICE Diploma', subject: 'Mathematics', qualification: 'Cambridge International AS Level' }),
  src({ authority: 'Cambridge International', programme: 'Cambridge AICE Diploma', subject: 'Mathematics', qualification: 'Cambridge International A Level' }),
  src({ authority: 'Cambridge International Education', programme: 'Cambridge IGCSE', subject: 'Mathematics (0580)', qualification: 'Cambridge IGCSE' }),
];

describe('source type selector (Nacional / Internacional), derived from catalogue metadata', () => {
  it('scope comes from the authority: a country (or a government authority) = NATIONAL, otherwise INTERNATIONAL', () => {
    expect(curriculumScope({ country: 'MX', sourceType: 'GOVERNMENT_AUTHORITY' })).toBe('NATIONAL');
    expect(curriculumScope({ country: null, sourceType: 'GOVERNMENT_AUTHORITY' })).toBe('NATIONAL');
    expect(curriculumScope({ country: null, sourceType: 'INTERNATIONAL_PROGRAMME' })).toBe('INTERNATIONAL');
    expect(availableScopes(CATALOGUE)).toEqual(['NATIONAL', 'INTERNATIONAL']);
    expect(availableScopes(CATALOGUE.filter((s) => s.country))).toEqual(['NATIONAL']);
    expect(availableScopes([])).toEqual([]);
  });

  it('Nacional -> the supported countries come from the catalogue (México, Colombia), then their authorities / programmes', () => {
    expect(nationalCountries(CATALOGUE).map((c) => countryLabel(c))).toEqual(['Colombia', 'México']);
    expect(nationalProgrammes(CATALOGUE, 'MX').map((p) => p.programme)).toEqual(['Educación Secundaria — Plan de Estudio 2022', 'Educación Media Superior — MCCEMS']);
    expect(nationalProgrammes(CATALOGUE, 'CO').map((p) => p.authority)).toEqual(['Ministerio de Educación Nacional (MEN)', 'Secretaría de Educación de Antioquia']);
    // A newly catalogued country appears without a code change.
    expect(nationalCountries([...CATALOGUE, src({ authority: 'MINEDU', programme: 'Currículo Nacional', subject: 'Matemática', country: 'PE', sourceType: 'GOVERNMENT_AUTHORITY' })])).toContain('PE');
  });

  it('Internacional -> IB and Cambridge (as catalogued) with their programmes / qualifications', () => {
    const authorities = internationalAuthorities(CATALOGUE).map((a) => a.name);
    expect(authorities).toEqual(expect.arrayContaining(['International Baccalaureate', 'Cambridge International']));
    expect(internationalProgrammes(CATALOGUE, 'a:International Baccalaureate').map((p) => p.programme)).toEqual(['IB Diploma Programme']);
    expect(internationalProgrammes(CATALOGUE, 'a:Cambridge International').map((p) => p.programme)).toEqual(['Cambridge AICE Diploma']);
    expect(programmeQualifications(CATALOGUE, 'p:Cambridge AICE Diploma')).toEqual(['Cambridge International A Level', 'Cambridge International AS Level']);
    expect(programmeQualifications(CATALOGUE, 'p:IB Diploma Programme')).toEqual([]);
    // Nothing national leaks into the international list and vice versa.
    expect(internationalAuthorities(CATALOGUE).some((a) => a.name.includes('SEP'))).toBe(false);
    expect(nationalCountries(CATALOGUE)).not.toContain(null);
  });

  it('the wizard is catalogue-driven: no hardcoded country or IB / Cambridge list', () => {
    const ui = code('src/app/dashboard/institution/[institutionId]/curriculum/CurriculumManager.tsx');
    expect(ui).toMatch(/availableScopes\(sources\)/);
    expect(ui).toMatch(/nationalCountries\(sources\)/);
    expect(ui).toMatch(/internationalAuthorities\(sources\)/);
    expect(ui).not.toMatch(/'MX'|'CO'|International Baccalaureate|Cambridge/);
  });
});

describe('exams are never curricula (PISA, PAA, Saber stay in Preparación para el examen)', () => {
  it('the curriculum catalogue lists CURRICULUM programmes only', () => {
    const svc = read('src/lib/institution/curriculum-management.service.ts');
    const fn = svc.slice(svc.indexOf('export async function listCurriculumSourceOptions'), svc.indexOf('// Institution curriculum subjects'));
    expect(fn).toMatch(/p\.programme_type = 'CURRICULUM'/);
    expect(fn).not.toMatch(/ADMISSION_EXAM|ASSESSMENT_FRAMEWORK/);
  });

  it('no exam entity or exam objective is imported into curriculum configuration', () => {
    for (const f of ['src/app/dashboard/institution/[institutionId]/curriculum/CurriculumManager.tsx', 'src/app/dashboard/institution/[institutionId]/curriculum/page.tsx', 'src/lib/curriculum/catalog-scope.ts']) {
      const s = code(f);
      expect(s, f).not.toMatch(/exam-core|objective-catalog|PISA|\bPAA\b|Saber|ICFES|Icfes/i);
    }
  });

  it('catalogue classification never touches exam programmes, curricula, bindings or learner data', () => {
    const s = read('src/lib/curriculum/catalog-classification.service.ts');
    expect(s.match(/p\.programme_type = 'CURRICULUM'/g)?.length).toBe(3);
    expect(s).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM)\s+(institution_curricula|classes|class_enrollments|learning_evidence|structure_nodes|structure_versions)/);
    expect(s.match(/UPDATE (\w+)/g)).toEqual(['UPDATE academic_organizations', 'UPDATE academic_organizations', 'UPDATE academic_subjects', 'UPDATE academic_subjects']);
    expect(s).toMatch(/WHERE source_type IS NULL/);
    expect(s).toMatch(/a\.canonical_subject_id IS NULL/);
  });
});

describe('multi-curriculum institution + explicit class binding', () => {
  it('national and international curricula of the same domain coexist (unique per base subject + version, not per canonical subject)', () => {
    const svc = read('src/lib/institution/curriculum-management.service.ts');
    expect(svc).toMatch(/base_academic_subject_id = \$2 AND base_structure_version_id = \$3/);
    const page = read('src/app/dashboard/institution/[institutionId]/curriculum/page.tsx');
    expect(page).toMatch(/cur2\.addAnother/);
    expect(page).toMatch(/configured-curricula/);
  });

  it('class candidates span every configured curriculum; the domain only ranks, nothing is selected', () => {
    const base = { title: '', code: null, versionLabel: 'v', academicYear: null, gradeId: null, gradeName: null, status: 'ACTIVE' as const };
    const curricula = [
      { ...base, curriculumId: 'mx', subject: 'Matemáticas', level: null, programme: 'MCCEMS', authority: 'SEP', academicDomain: 'MATHEMATICS' },
      { ...base, curriculumId: 'ib', subject: 'Mathematics: analysis and approaches', level: 'SL', programme: 'IB Diploma Programme', authority: 'International Baccalaureate', academicDomain: 'MATHEMATICS' },
      { ...base, curriculumId: 'aice', subject: 'Mathematics', level: 'A Level', programme: 'Cambridge AICE Diploma', authority: 'Cambridge International', academicDomain: 'MATHEMATICS' },
      { ...base, curriculumId: 'bio', subject: 'Biology', level: 'HL', programme: 'IB Diploma Programme', authority: 'International Baccalaureate', academicDomain: 'BIOLOGY' },
    ];
    const ranked = rankCurriculumCandidates(curricula, { academicDomain: 'MATHEMATICS', gradeId: null });
    expect(ranked.map((r) => r.curriculum.curriculumId)).toEqual(expect.arrayContaining(['mx', 'ib', 'aice', 'bio']));
    expect(ranked.filter((r) => r.compatible).map((r) => r.curriculum.curriculumId).sort()).toEqual(['aice', 'ib', 'mx']);
    // Binding stays an explicit coordinator action (no auto-binding by name / language / grade / domain).
    const page = read('src/app/dashboard/institution/[institutionId]/curriculum/page.tsx');
    expect(page).toMatch(/a suggestion, never a binding/);
    expect(read('src/lib/curriculum/catalog-classification.service.ts')).not.toMatch(/institution_curriculum_id/);
  });
});

describe('architecture preserved', () => {
  it('structure isolation: a curriculum seeds from its own published structure version only', () => {
    const svc = read('src/lib/institution/curriculum-management.service.ts');
    expect(svc).toMatch(/seedFromPublishedStructure\(id, option\.versionId, option\.canonicalSubjectId/);
  });

  it('canonical knowledge reuse: curricula of the same domain share the canonical subject, never the structure', () => {
    const s = read('src/lib/curriculum/catalog-classification.service.ts');
    expect(s).toMatch(/lower\(cs\.name\) = lower\(a\.name\)/);
    expect(s).toMatch(/LIKE lower\(cs\.name\) \|\| '%' ORDER BY char_length\(cs\.name\) DESC LIMIT 1/);
    expect(s).not.toMatch(/INSERT INTO canonical_subjects/);
  });

  it('existing data: the summary is built from the existing ACTIVE rows; nothing is rewritten on render', () => {
    const page = read('src/app/dashboard/institution/[institutionId]/curriculum/page.tsx');
    expect(page).toMatch(/for \(const g of groups\.values\(\)\)/);
    expect(page).not.toMatch(/db\.query|UPDATE |INSERT /);
  });
});

describe('security + mobile', () => {
  it('curriculum configuration stays coordinator/admin only; teachers are not given administration', () => {
    const page = read('src/app/dashboard/institution/[institutionId]/curriculum/page.tsx');
    expect(page).toMatch(/canAccessInstitution\(actor\.id, institutionId, 'TEACHER_ASSIGNMENT_MANAGE'\)\)\) notFound\(\)/);
    expect(read('src/app/api/institutions/[id]/curriculum/subjects/route.ts')).toMatch(/guard|canAccessInstitution|requireInstitution/i);
  });

  it('cards and selects never overflow on mobile; the ClassCurriculumSelect fix is kept', () => {
    const css = read('src/app/globals.css');
    expect(css).toMatch(/\.cur2-binding-select \{ width: 100%; max-width: 100%; min-width: 0; text-overflow: ellipsis; \}/);
    expect(css).toMatch(/\.cur2-scope \{ display: grid; grid-template-columns: 1fr;/);
    expect(css).toMatch(/\.cur2-configured-body \{[^}]*min-width: 0; overflow-wrap: anywhere;/);
  });
});
