/**
 * T1 FINAL REMEDIATION DELTA -- Student Account / Academic Profile / Exam Prep / Learn.
 *
 * CASE 01-25 follow section J of the delta brief. Pure logic is exercised directly; services with a
 * mocked DB (no network, no real database); components with renderToStaticMarkup; wiring that only
 * exists in server pages with source guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => ({ dbQueryMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => h.dbQueryMock(...a) }, query: (...a: any[]) => h.dbQueryMock(...a) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => createElement('a', { href, ...rest }, children) }));

import { getMessages } from '@/lib/i18n/messages';
import { ObjectivePicker, GROUPING_THRESHOLD, groupBySubject, landingEntries, type PickerObjective } from '@/app/dashboard/exam-prep/ObjectivePicker';
import { PreparationChooser } from '@/app/dashboard/exam-prep/PreparationChooser';
import { PreparationHome } from '@/app/dashboard/exam-prep/[examProfileId]/PreparationHome';
import { GoalDetailsForm } from '@/app/dashboard/exam-prep/[examProfileId]/PrepActions';
import CurriculumTopics from '@/app/dashboard/learn/CurriculumTopics';
import { examObjectives, familyOfFramework, objectiveByKey, OBJECTIVE_FAMILIES, OBJECTIVE_FRAMEWORKS } from '@/lib/exam-core/objectives/objective-catalog';
import { objectiveDisplayLabel, presentObjective } from '@/lib/exam-core/objectives/objective-display';
import { acceptExamSession, examSessionLabel, examSessionOptions, FRAMEWORK_SESSION_PROGRAMME, objectiveSessionModel, storedExamSession } from '@/lib/exam-core/objectives/objective-session';
import { computeCapabilities } from '@/lib/exam-core/objectives/capabilities';
import { nextStep } from '@/lib/exam-core/objectives/preparation-plan';
import { PreparationError, updatePreparationDetails } from '@/lib/exam-core/objectives/preparation.service';
import { availableSeries, SESSION_CATALOG, type SessionCatalog } from '@/lib/exam-core/catalog/programme-sessions';
import { canonicalSubjectOf, localizeCatalogSubjectName } from '@/lib/exam-core/catalog/subject-localization';
import { INTEREST_AREAS, interestAreaLabel, interestAreaOptions, normalizeInterestArea } from '@/lib/student/interest-areas';
import { buildCurriculumTopics, type CurriculumTopicRow } from '@/lib/learning-plan/subject-curriculum-topics';
import { learningObjectiveLabel } from '@/lib/exam-core/catalog/objective-localization';
import { activePreparationSummary, selectGoalProfile } from '@/lib/experience/goal';
import { suggestSubjects } from '@/lib/experience/subject-catalog';
import { gradeDisplayLabel, localizeSubjectName } from '@/lib/i18n/catalog-labels';
import { cancelOutcome, isProfileDraftDirty, type ProfileDraft } from '@/lib/student/academic-profile-draft';
import { effectiveContextType } from '@/lib/student/student-context';
import { parseTimeContextKey, timeContextKey } from '@/lib/student/time-context';
import type { StudentExamProfile } from '@/lib/assessment/types';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const msgs = (locale: string) => getMessages(locale) as Record<string, string>;
const prepLabels = (locale: string) => Object.fromEntries(Object.entries(msgs(locale)).filter(([k]) => k.startsWith('prep.') || k.startsWith('elig.') || k.startsWith('acp.prep.') || k.startsWith('acp.goal.')));
const clean = (html: string) => expect(html).not.toMatch(/undefined|>prep\.|>acp\.|>elig\.|NaN/);
const NOW = new Date('2026-10-10T12:00:00Z');

/** Picker rows as loadPickerData builds them (display label + canonical group per locale). */
const rows = (locale: string, mark: (key: string) => Partial<PickerObjective> = () => ({})): PickerObjective[] =>
  examObjectives().map((o) => {
    const shown = presentObjective(o, locale);
    const strip = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return {
      key: o.key, framework: o.framework, kind: o.kind, label: shown.label, context: o.context, status: 'canAdd', preparationId: null,
      searchText: `${o.searchText} ${strip(shown.label)} ${strip(shown.groupLabel ?? '')} ${strip(presentObjective(o, 'en').label)}`, groupKey: shown.groupKey, groupLabel: shown.groupLabel, recommended: false, reason: null, yourSubject: false, ...mark(o.key),
    };
  });
const frameworks = OBJECTIVE_FRAMEWORKS.map((f) => ({ ...f, family: familyOfFramework(f.key) }));
const chooser = (locale: string, props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(PreparationChooser, { objectives: rows(locale), frameworks, suggested: [], frameworkReasons: {}, hasAcademicContext: false, labels: prepLabels(locale), ...props } as any));
const picker = (locale: string, initial: { family?: string | null; framework?: string; query?: string }, objectives = rows(locale)) =>
  renderToStaticMarkup(createElement(ObjectivePicker, { objectives, frameworks, suggested: [], labels: prepLabels(locale), initial }));

const profile = (over: Partial<StudentExamProfile> = {}): StudentExamProfile => ({
  id: 'p1', studentId: 's1', examDefinitionId: null, examVersionId: null, purpose: null, programmeContext: null, subjectFocus: null, examDate: null, timezone: null,
  institutionTargetId: null, status: 'ACTIVE', targetInstitutionName: null, targetQualification: null, ...over,
});
const profileRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1', student_id: 's1', exam_definition_id: null, exam_version_id: null, objective_key: 'ib.dp.math-aa.hl', objective_framework: 'IB_DP', purpose: null, programme_context: null,
  subject_focus: null, exam_date: null, timezone: null, institution_target_id: null, status: 'ACTIVE', ...over,
});

beforeEach(() => h.dbQueryMock.mockReset());

// ------------------------------------------------------------------ A. EXAM_PREP landing

describe('A. EXAM_PREP landing is the exam selector', () => {
  it('CASE 01. an EXAM_PREP Student without a profile enters the catalogue directly', () => {
    // The stored context decides (never a profile): EXAM_PREP with no academic profile at all.
    expect(effectiveContextType({ stored: 'EXAM_PREP', profileCompleted: false, examTargetCount: 0 })).toBe('EXAM_PREP');
    const page = code('src/app/dashboard/exam-prep/page.tsx');
    expect(page).toMatch(/const examPrepContext = studentContext\.contextType === 'EXAM_PREP'/);
    expect(page).toMatch(/examPrepContext \? tr\['acp\.prep\.examLead'\] : tr\['prep\.lead'\]/);
    expect(page).toMatch(/examPrepContext=\{examPrepContext\}/);
    expect(msgs('es')['prep.question']).toBe('¿Para qué examen quieres prepararte?');
    expect(msgs('es')['acp.prep.examLead']).toBe('Elige el examen que quieres presentar. Después configuraremos la convocatoria, asignatura o sección que corresponda.');

    const html = chooser('es', { examPrepContext: true });
    clean(html);
    expect(html).toContain('data-exam-selector');
    // The whole catalogue is there straight away: every test and the Cambridge family, nothing behind a toggle.
    for (const name of ['PAA', 'PISA', 'Saber 11', 'Cambridge International']) expect(html).toContain(name);
    expect(html).toContain(msgs('es')['prep.fw.IB_DP'].replace(/&/g, '&amp;'));
    expect(html).not.toContain(msgs('es')['elig.explore.toggle']);
  });

  it('CASE 02. EXAM_PREP never gets the "Revisar / Completar mi perfil académico" CTA or any profile requirement', () => {
    for (const locale of ['es', 'en', 'de', 'fr', 'pt']) {
      const m = msgs(locale);
      // Even when the eligibility data carries reasons / profile subjects, the EXAM_PREP landing shows none of it.
      const html = renderToStaticMarkup(
        createElement(PreparationChooser, {
          objectives: rows(locale, (k) => (k === 'ib.dp.physics.hl' ? { recommended: true, reason: 'REASON-TEXT', yourSubject: true } : {})),
          frameworks, suggested: ['IB_DP'], frameworkReasons: { IB_DP: 'FRAMEWORK-REASON' }, hasAcademicContext: false, examPrepContext: true, labels: prepLabels(locale),
        } as any)
      );
      clean(html);
      for (const key of ['elig.empty.cta', 'elig.empty.noProfile', 'elig.empty.noMatch', 'elig.empty.title', 'elig.recommended.title', 'elig.recommended.lead']) expect(html).not.toContain(m[key]);
      expect(html).not.toContain('/dashboard/profile');
      expect(html).not.toMatch(/REASON-TEXT|FRAMEWORK-REASON|data-your-subjects/);
    }
    expect(msgs('es')['acp.prep.examLead']).not.toMatch(/perfil|currículo|grado|institución|escuela/i);
  });

  it('CASE 03. ACADEMIC keeps profile-based recommendations (and its profile CTA when nothing matches)', () => {
    const m = msgs('es');
    const recommended = renderToStaticMarkup(
      createElement(PreparationChooser, {
        objectives: rows('es', (k) => (k.startsWith('ib.dp.physics') ? { recommended: true, reason: 'Porque cursas Física', yourSubject: true } : {})),
        frameworks, suggested: ['IB_DP'], frameworkReasons: {}, hasAcademicContext: true, examPrepContext: false, labels: prepLabels('es'),
      } as any)
    );
    clean(recommended);
    expect(recommended).toContain(m['elig.recommended.title']);
    expect(recommended).toContain(m['elig.recommended.lead']);
    expect(recommended).toContain('data-your-subjects');
    expect(recommended).toContain(m['elig.explore.toggle']);

    const nothing = chooser('es', { examPrepContext: false, hasAcademicContext: false });
    expect(nothing).toContain(m['elig.empty.cta']);
    expect(nothing).toContain('/dashboard/profile');
    // An ACADEMIC context is never treated as EXAM_PREP.
    expect(effectiveContextType({ stored: 'ACADEMIC', profileCompleted: true, examTargetCount: 3 })).toBe('ACADEMIC');
  });
});

// ------------------------------------------------------------------ B1. Cambridge family

describe('B1. Cambridge is one family, then its programmes', () => {
  it('CASE 04. the landing shows Cambridge as a single family', () => {
    const entries = landingEntries(frameworks);
    const families = entries.filter((e) => e.kind === 'FAMILY');
    expect(families).toHaveLength(1);
    expect(families[0]).toMatchObject({ kind: 'FAMILY', family: 'CAMBRIDGE' });
    expect(entries.filter((e) => e.kind === 'FRAMEWORK').map((e) => (e as any).framework.key)).toEqual(['PAA', 'SABER11', 'PISA', 'IB_DP']);

    const html = picker('es', {});
    clean(html);
    expect(html.match(/data-family="CAMBRIDGE"/g)).toHaveLength(1);
    expect(html).toContain('>Cambridge International</h3>');
    expect(html).toContain(msgs('es')['acp.prep.chooseProgramme']);
    expect(msgs('es')['acp.prep.chooseProgramme']).toBe('Elegir programa');
    // No separate landing card per Cambridge programme.
    for (const key of ['CIE_IGCSE', 'CIE_AS_A', 'CIE_AICE']) expect(html).not.toContain(`>${msgs('es')[`prep.fw.${key}`].replace(/&/g, '&amp;')}</h3>`);
  });

  it('CASE 05. the Cambridge family opens IGCSE / International AS & A Level / AICE Diploma', () => {
    expect(OBJECTIVE_FAMILIES).toEqual([{ key: 'CAMBRIDGE', frameworks: ['CIE_IGCSE', 'CIE_AS_A', 'CIE_AICE'] }]);
    const m = msgs('es');
    expect(m['acp.prep.familyQuestion.CAMBRIDGE']).toBe('¿Qué programa de Cambridge quieres preparar?');
    expect([m['prep.fw.CIE_IGCSE'], m['prep.fw.CIE_AS_A'], m['prep.fw.CIE_AICE']]).toEqual(['Cambridge IGCSE', 'Cambridge International AS & A Level', 'Cambridge AICE Diploma']);

    const html = picker('es', { family: 'CAMBRIDGE' });
    clean(html);
    expect(html).toContain('data-family-level="CAMBRIDGE"');
    expect(html).toContain(m['acp.prep.familyQuestion.CAMBRIDGE']);
    for (const name of ['Cambridge IGCSE', 'Cambridge International AS &amp; A Level', 'Cambridge AICE Diploma']) expect(html).toContain(`>${name}</h3>`);
    expect(html).not.toMatch(/<h3[^>]*>(PISA|PAA|IB )/); // only Cambridge programmes at this level
    // Qualification, syllabus code and level survive the grouping: every Cambridge subject row keeps them.
    const asal = picker('es', { framework: 'CIE_AS_A', query: '9709' });
    expect(asal).toContain('Mathematics (9709) · AS Level');
    expect(asal).toContain('Mathematics (9709) · A Level');
    const igcse = picker('es', { framework: 'CIE_IGCSE' });
    expect(igcse).toContain('Mathematics (0580) · Extended');
    expect(igcse).toContain('Mathematics (0580) · Core');
  });

  it('CASE 06. Cambridge series governance is unchanged (canonical MARCH / JUNE / NOVEMBER, March fail-closed)', () => {
    const q = { programmeName: 'Cambridge Advanced', year: 2027 };
    expect(availableSeries({ ...q, country: 'IN', syllabusCodes: ['9709'] })).toEqual(['JUNE', 'NOVEMBER']); // syllabus availability unknown
    expect(availableSeries({ ...q, country: 'IN' })).toEqual(['JUNE', 'NOVEMBER']);
    expect(availableSeries({ ...q, country: 'MX', syllabusCodes: ['9709'] })).toEqual(['JUNE', 'NOVEMBER']);
    const governed: SessionCatalog = { ...SESSION_CATALOG, syllabusSeries: { '9709': ['MARCH', 'JUNE', 'NOVEMBER'] } };
    expect(availableSeries({ ...q, country: 'IN', syllabusCodes: ['9709'] }, governed)).toEqual(['MARCH', 'JUNE', 'NOVEMBER']);
    expect(availableSeries({ ...q, country: 'MX', syllabusCodes: ['9709'] }, governed)).toEqual(['JUNE', 'NOVEMBER']);
    expect(availableSeries({ programmeName: 'IB Diploma Programme', country: 'MX', year: 2027 })).toEqual(['MAY', 'NOVEMBER']);
    // The grouping reuses the session catalogue's own programme entries; nothing new is defined for availability.
    for (const name of Object.values(FRAMEWORK_SESSION_PROGRAMME)) expect(Object.keys(SESSION_CATALOG.programmes)).toContain(name);
    expect(SESSION_CATALOG.syllabusSeries).toEqual({});
  });
});

// ------------------------------------------------------------------ B2. long catalogues by subject

describe('B2. long catalogues are organised by canonical subject', () => {
  const ib = () => rows('es').filter((o) => o.framework === 'IB_DP');

  it('CASE 07. the IB catalogue is grouped by canonical subject, closed by default, nothing hidden', () => {
    const list = ib();
    expect(list.length).toBeGreaterThan(GROUPING_THRESHOLD);
    const { groups, ungrouped } = groupBySubject(list);
    expect(ungrouped).toEqual([]);
    expect(groups.reduce((n, g) => n + g.options.length, 0)).toBe(list.length); // every option keeps its own row
    const maths = groups.find((g) => g.key === 'mathematics')!;
    expect(maths.label).toBe('Matemáticas');
    expect(maths.options.map((o) => o.key).sort()).toEqual(['ib.dp.math-aa.hl', 'ib.dp.math-aa.sl', 'ib.dp.math-ai.hl', 'ib.dp.math-ai.sl']);
    // Canonical identity comes from catalogue identifiers, never from the label text.
    expect(canonicalSubjectOf({ subjectNodeKey: 'ib.dp.math-ai', syllabusCode: null })).toEqual({ key: 'mathematics', canonical: true });
    expect(canonicalSubjectOf({ subjectNodeKey: 'cie.aice.g1.9709', syllabusCode: '9709' })).toEqual({ key: 'mathematics', canonical: true });
    expect(canonicalSubjectOf({ subjectNodeKey: 'cie.aice.g3.9395', syllabusCode: '9395' })).toEqual({ key: 'cie.aice.g3.9395', canonical: false }); // unmapped: its own group
    expect(code('src/lib/exam-core/objectives/objective-display.ts')).not.toMatch(/label\.(includes|match|startsWith)|\.test\(o\.label/);

    const html = picker('es', { framework: 'IB_DP' });
    clean(html);
    expect(html).toContain('data-subject-groups');
    expect(html.match(/<details/g)!.length).toBe(groups.length);
    expect(html).not.toMatch(/<details[^>]* open/); // closed by default
    expect(html).toMatch(/Matemáticas<\/span><span[^>]*>4 opciones/);
    // AA / AI and HL / SL stay visible as their own rows, each with its own CTA.
    for (const label of ['Matemáticas: Análisis y Enfoques · Nivel Superior (NS)', 'Matemáticas: Análisis y Enfoques · Nivel Medio (NM)', 'Matemáticas: Aplicaciones e Interpretación · Nivel Superior (NS)', 'Matemáticas: Aplicaciones e Interpretación · Nivel Medio (NM)']) expect(html).toContain(label);
    expect(html.match(new RegExp(`>${msgs('es')['prep.cta.add']}</button>`, 'g'))!.length).toBe(list.length);
    // No subject is selected for the Student.
    expect(html).not.toMatch(/aria-pressed="true"[^>]*data-subject|checked/);
  });

  it('CASE 08. search finds the option and opens the subject that holds it (subject, variant, level, syllabus code)', () => {
    const byVariant = picker('es', { query: 'análisis y enfoques' });
    expect(byVariant).toContain('Matemáticas: Análisis y Enfoques · Nivel Superior (NS)');
    expect(byVariant).not.toContain('Aplicaciones e Interpretación');

    // A long result set is grouped and every subject with a match is open.
    const bySubject = picker('es', { query: 'matematicas' });
    expect(bySubject).toMatch(/<details[^>]*data-subject-group="mathematics"[^>]* open/);
    expect(bySubject).not.toMatch(/<details(?![^>]* open)[^>]*>/);
    expect(bySubject).toContain('Mathematics (9709) · AS Level'); // Cambridge maths found through the canonical subject
    expect(bySubject).not.toContain('Física ·');

    const byCode = picker('es', { query: '9702' });
    expect(byCode).toContain('Physics (9702) · AS Level');
    expect(byCode).not.toContain('Chemistry (9701)');

    const byLevel = picker('es', { framework: 'IB_DP', query: 'superior fisica' });
    expect(byLevel).toContain('Física · Nivel Superior (NS)');
    expect(byLevel).not.toContain('Física · Nivel Medio (NM)');
    // The English official name still finds it in the Spanish interface (catalogue text is searchable too).
    expect(picker('es', { query: 'physics hl' })).toContain('Física · Nivel Superior (NS)');
  });
});

// ------------------------------------------------------------------ C. exam session

describe('C. Exam Preparation uses the canonical session catalogue', () => {
  const mathAA = objectiveByKey('ib.dp.math-aa.hl')!;
  const home = (timing: any, locale = 'es') => {
    const capabilities = computeCapabilities(mathAA, [], 0);
    const view = { profile: { ...profile(), objectiveKey: mathAA.key }, objective: mathAA, capabilities, plan: null, next: nextStep({ openAttemptId: null, plan: null, canPractice: false, canRunDiagnostic: false, diagnosticDone: false, canViewStructure: false, canPlanDiploma: false, hasExamDate: !!timing.sessionLabel }), openAttemptId: null, diagnostic: null };
    const shown = presentObjective(mathAA, locale);
    return renderToStaticMarkup(createElement(PreparationHome, { view: view as any, labels: prepLabels(locale), language: locale, timing, display: { subject: shown.subject, level: shown.level }, aspiration: { areas: interestAreaOptions(locale), areaLabel: null } }));
  };

  it('CASE 09. an IB preparation asks for a canonical session + year; the detail shows it afterwards', () => {
    const model = objectiveSessionModel(mathAA, null)!;
    expect(model).not.toBeNull();
    expect(model.scope.programmeName).toBe('IB Diploma Programme');
    const options = examSessionOptions(model, NOW, null, 'es');
    expect(options.map((o) => o.key)).toEqual(['ES:NOVEMBER:2026', 'ES:MAY:2027', 'ES:NOVEMBER:2027', 'ES:MAY:2028']);
    expect(options.map((o) => o.label)).toEqual(['Noviembre 2026', 'Mayo 2027', 'Noviembre 2027', 'Mayo 2028']);
    expect(examSessionOptions(model, NOW, null, 'en')[1].label).toBe('May 2027');

    const pending = home({ session: { options, value: null }, sessionLabel: null, dateLine: null });
    clean(pending);
    expect(pending).toContain('data-session-pending');
    expect(pending).toContain(msgs('es')['acp.goal.session.required.title']);
    expect(pending).toContain('<option value="ES:MAY:2027">Mayo 2027</option>');
    expect(pending).not.toContain(msgs('es')['examPrep.noExamDateSet']);

    const stored = storedExamSession({ targetExamSeries: 'MAY', targetExamYear: 2027 })!;
    const done = home({ session: { options, value: timeContextKey(stored) }, sessionLabel: examSessionLabel(stored, 'es'), dateLine: null });
    expect(done).not.toContain('data-session-pending');
    expect(done).toMatch(/data-exam-session-fact[^>]*><dt>Convocatoria<\/dt><dd>Mayo 2027<\/dd>/);
    expect(done).not.toContain(msgs('es')['examPrep.noExamDateSet']);
    // A chosen session configures the timing (the "add your exam date" step no longer applies).
    expect(code('src/lib/exam-core/objectives/preparation.service.ts')).toMatch(/hasExamDate: !!profile\.examDate \|\| !!storedExamSession\(profile\)/);
    // The list page and Home read the same stored session.
    expect(code('src/app/dashboard/exam-prep/page.tsx')).toMatch(/examSessionLabel\(session, locale\)/);
    // Exams without governed series keep the date mode.
    for (const key of ['paa', 'pisa.2022']) {
      const o = examObjectives().find((x) => x.key === key || x.key.startsWith(key))!;
      expect(objectiveSessionModel(o, 'MX')).toBeNull();
    }
  });

  it('CASE 10. a new IB save stores the canonical series + year, never an arbitrary date as the configuration', async () => {
    const updates: Array<{ sql: string; params: unknown[] }> = [];
    h.dbQueryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (/^\s*UPDATE student_exam_profiles/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
      if (/FROM student_exam_profiles/.test(sql)) return { rows: [profileRow()] };
      if (/country_of_study/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    await updatePreparationDetails('s1', 'p1', { examSession: 'ES:MAY:2027' }, NOW);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(/target_exam_series = \$2, target_exam_year = \$3/);
    expect(updates[0].sql).not.toMatch(/exam_date/);
    expect(updates[0].params).toEqual(['p1', 'MAY', 2027]);

    // Not a series the IB runs, not a controlled option, or a free-form value: refused, nothing written.
    for (const bad of ['ES:MARCH:2027', 'ES:JUNE:2027', 'ES:MAY:2040', 'ES:MAY:2020']) {
      updates.length = 0;
      await expect(updatePreparationDetails('s1', 'p1', { examSession: bad }, NOW)).rejects.toMatchObject({ code: 'INVALID_EXAM_SESSION' });
      expect(updates).toHaveLength(0);
    }
    expect(new PreparationError('INVALID_EXAM_SESSION').code).toBe('INVALID_EXAM_SESSION');
    const route = code('src/app/api/exam-preparation/[id]/route.ts');
    expect(route).toMatch(/examSession: z\.string\(\)\.regex\(\/\^ES:/);

    // The form of a session-governed exam has no free date picker; it posts the session key.
    const model = objectiveSessionModel(mathAA, null)!;
    const form = renderToStaticMarkup(createElement(GoalDetailsForm, { profileId: 'p1', initial: { examDate: null, targetInstitutionName: null, interestArea: null, interestAreaDetail: null }, session: { options: examSessionOptions(model, NOW, null, 'es'), value: null }, areas: interestAreaOptions('es'), labels: prepLabels('es') }));
    clean(form);
    expect(form).not.toMatch(/type="date"/);
    expect(form).toContain('data-exam-session');
    expect(code('src/app/dashboard/exam-prep/[examProfileId]/PrepActions.tsx')).toMatch(/session \? \{ examSession: examSession \|\| null \} : \{ examDate: examDate \|\| null \}/);
    // An exam without governed series keeps its date field.
    const dated = renderToStaticMarkup(createElement(GoalDetailsForm, { profileId: 'p1', initial: { examDate: null, targetInstitutionName: null, interestArea: null, interestAreaDetail: null }, session: null, areas: interestAreaOptions('es'), labels: prepLabels('es') }));
    expect(dated).toMatch(/type="date"/);
    expect(dated).not.toContain('data-exam-session');
  });

  it('CASE 11. a Cambridge preparation uses availableSeries, fail-closed; legacy identifiers stay readable', () => {
    const maths = objectiveByKey('cie.asal.9709.as')!;
    const india = objectiveSessionModel(maths, 'IN')!;
    expect(india.scope).toMatchObject({ programmeName: 'Cambridge Advanced', syllabusCodes: ['9709'], country: 'IN' });
    const keys = examSessionOptions(india, NOW, null, 'en').map((o) => o.key);
    expect(keys).toEqual(['ES:NOVEMBER:2026', 'ES:JUNE:2027', 'ES:NOVEMBER:2027', 'ES:JUNE:2028']);
    expect(keys.some((k) => k.includes('MARCH') || k.includes(':MAY:'))).toBe(false);
    expect(acceptExamSession('ES:MARCH:2027', india, NOW, null)).toBeNull(); // India + unknown syllabus availability
    expect(acceptExamSession('ES:JUNE:2027', india, NOW, null)).toEqual({ kind: 'EXAM_SESSION', series: 'JUNE', year: 2027 });
    expect(acceptExamSession('ES:JUNE:2027', objectiveSessionModel(maths, null)!, NOW, null)).not.toBeNull(); // no country known: unrestricted series only
    expect(objectiveSessionModel(objectiveByKey('cie.igcse.0580.extended')!, 'MX')!.scope.programmeName).toBe('Cambridge IGCSE');

    // Backward compatibility: a legacy identifier is READ as canonical; a new save writes the canonical one.
    expect(storedExamSession({ targetExamSeries: 'OCT_NOV', targetExamYear: 2027 })).toEqual({ kind: 'EXAM_SESSION', series: 'NOVEMBER', year: 2027 });
    expect(acceptExamSession('ES:MAY_JUNE:2027', india, NOW, null)).toEqual({ kind: 'EXAM_SESSION', series: 'JUNE', year: 2027 });
    expect(timeContextKey(parseTimeContextKey('ES:FEB_MARCH:2027')!)).toBe('ES:MARCH:2027');
    // An older stored choice stays selectable in the edit form (never rejected, never dropped).
    const past = storedExamSession({ targetExamSeries: 'JUNE', targetExamYear: 2025 })!;
    expect(examSessionOptions(india, NOW, past, 'en')[0]).toEqual({ key: 'ES:JUNE:2025', label: 'June 2025' });
    expect(acceptExamSession('ES:JUNE:2025', india, NOW, past)).not.toBeNull();
    // No availability is written in the UI.
    for (const f of ['src/app/dashboard/exam-prep/[examProfileId]/PrepActions.tsx', 'src/app/dashboard/exam-prep/[examProfileId]/PreparationHome.tsx', 'src/app/dashboard/exam-prep/ObjectivePicker.tsx']) {
      expect(code(f)).not.toMatch(/'MARCH'|'JUNE'|'NOVEMBER'|'MAY'|FEB_MARCH|MAY_JUNE|OCT_NOV/);
    }
    expect(code('src/lib/exam-core/objectives/objective-session.ts')).not.toMatch(/'MARCH'|'JUNE'|'NOVEMBER'|'IN'|'RO'/);
  });
});

// ------------------------------------------------------------------ D. academic aspiration

describe('D. academic aspiration is apart from the exam, optional, canonical', () => {
  const dbFor = (updates: Array<{ sql: string; params: unknown[] }>) =>
    h.dbQueryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (/^\s*UPDATE student_exam_profiles/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
      if (/FROM student_exam_profiles/.test(sql)) return { rows: [profileRow()] };
      return { rows: [] };
    });

  it('CASE 12. the area of interest saves a canonical ID; labels are display only', async () => {
    expect([...INTEREST_AREAS]).toEqual([
      'BUSINESS_FINANCE_ECONOMICS', 'ENGINEERING_TECHNOLOGY', 'COMPUTING_DATA', 'HEALTH_SCIENCES', 'NATURAL_SCIENCES', 'SOCIAL_SCIENCES_POLITICS', 'LAW',
      'ARCHITECTURE_DESIGN', 'ARTS_HUMANITIES', 'COMMUNICATION_MARKETING_MEDIA', 'EDUCATION', 'SPORTS_SCIENCE', 'TOURISM_HOSPITALITY', 'OTHER',
    ]);
    expect(interestAreaOptions('es').map((o) => o.label)).toEqual([
      'Negocios, Finanzas y Economía', 'Ingeniería y Tecnología', 'Computación y Datos', 'Ciencias de la Salud', 'Ciencias Naturales', 'Ciencias Sociales y Política', 'Derecho',
      'Arquitectura y Diseño', 'Arte y Humanidades', 'Comunicación, Marketing y Medios', 'Educación', 'Deportes y Ciencias del Deporte', 'Turismo y Hospitalidad', 'Otro',
    ]);
    const updates: Array<{ sql: string; params: unknown[] }> = [];
    dbFor(updates);
    await updatePreparationDetails('s1', 'p1', { interestArea: 'HEALTH_SCIENCES', targetInstitutionName: 'Universidad Nacional' }, NOW);
    expect(updates[0].sql).toMatch(/interest_area = \$2, interest_area_detail = \$3, target_institution_name = \$4/);
    expect(updates[0].params).toEqual(['p1', 'HEALTH_SCIENCES', null, 'Universidad Nacional']);
    // A label is never accepted as a value.
    await expect(updatePreparationDetails('s1', 'p1', { interestArea: 'Ciencias de la Salud' as any }, NOW)).rejects.toMatchObject({ code: 'INVALID_INTEREST_AREA' });
    expect(normalizeInterestArea('NOT_AN_AREA', null)).toBeNull();
    expect(normalizeInterestArea(null, 'x')).toEqual({ interestArea: null, interestAreaDetail: null });

    // Separated in the UI: "Tu examen" vs "Tu objetivo académico (opcional)", with the required copy.
    const m = msgs('es');
    expect([m['acp.goal.exam.title'], m['acp.goal.aspiration.title'], m['acp.goal.institution'], m['acp.goal.area'], m['acp.goal.optional']]).toEqual(['Tu examen', 'Tu objetivo académico', 'Universidad o institución objetivo', 'Área académica o profesional de interés', 'opcional']);
    const form = renderToStaticMarkup(createElement(GoalDetailsForm, { profileId: 'p1', initial: { examDate: null, targetInstitutionName: null, interestArea: 'LAW', interestAreaDetail: null }, session: null, areas: interestAreaOptions('es'), labels: prepLabels('es') }));
    clean(form);
    expect(form.indexOf('data-goal-exam')).toBeGreaterThan(-1);
    expect(form.indexOf('data-goal-aspiration')).toBeGreaterThan(form.indexOf('data-goal-exam'));
    expect(form).toContain('<option value="LAW" selected="">Derecho</option>');
    expect(form).not.toMatch(/required/); // optional: never blocks Exam Prep
    expect(code('src/lib/exam-core/objectives/preparation-plan.ts')).not.toMatch(/interestArea|targetInstitution/);
  });

  it('CASE 13. OTHER allows an optional free-text detail (and only OTHER keeps one)', async () => {
    expect(normalizeInterestArea('OTHER', '  Gastronomía  ')).toEqual({ interestArea: 'OTHER', interestAreaDetail: 'Gastronomía' });
    expect(normalizeInterestArea('OTHER', '')).toEqual({ interestArea: 'OTHER', interestAreaDetail: null });
    expect(normalizeInterestArea('LAW', 'ignored')).toEqual({ interestArea: 'LAW', interestAreaDetail: null });
    const updates: Array<{ sql: string; params: unknown[] }> = [];
    dbFor(updates);
    await updatePreparationDetails('s1', 'p1', { interestArea: 'OTHER', interestAreaDetail: 'Gastronomía' }, NOW);
    expect(updates[0].params).toEqual(['p1', 'OTHER', 'Gastronomía']);

    const render = (interestArea: string | null) =>
      renderToStaticMarkup(createElement(GoalDetailsForm, { profileId: 'p1', initial: { examDate: null, targetInstitutionName: null, interestArea, interestAreaDetail: interestArea === 'OTHER' ? 'Gastronomía' : null }, session: null, areas: interestAreaOptions('es'), labels: prepLabels('es') }));
    expect(render('OTHER')).toContain('data-interest-area-detail');
    expect(render('OTHER')).toContain(msgs('es')['acp.goal.area.otherDetail']);
    expect(msgs('es')['acp.goal.area.otherDetail']).toBe('¿Qué área te interesa?');
    expect(render('LAW')).not.toContain('data-interest-area-detail');
    expect(render(null)).not.toContain('data-interest-area-detail');
    // The migration keeps the same rule in the database.
    const sql = read('database/migrations/20261107_1000_exam_target_session_and_aspiration.sql');
    expect(sql).toMatch(/interest_area_detail IS NULL OR \(interest_area = 'OTHER'/);
  });
});

// ------------------------------------------------------------------ E. curriculum -> Learn

describe('E. the curriculum reaches the content of a Learn subject', () => {
  const row = (over: Partial<CurriculumTopicRow>): CurriculumTopicRow => ({ nodeId: 'n1', nodeType: 'EXAM_SECTION', nodeLabel: 'Paper 1A (multiple choice)', nodeOrder: 0, objectiveId: 'lo', objectiveCode: null, objectiveDescription: '', canonicalConceptId: null, ...over });
  const labels = new Map([['c-kin', 'Cinemática'], ['c-mom', 'Conservación del momento lineal'], ['c-gas', 'Gases ideales'], ['c-unc', 'Incertidumbres y análisis de datos']]);
  const ibPhysics: CurriculumTopicRow[] = [
    row({ objectiveId: 'lo-a', objectiveCode: 'phy.p1a.motion', objectiveDescription: 'A Space, time and motion: kinematics, forces, momentum.', canonicalConceptId: 'c-kin' }),
    row({ objectiveId: 'lo-a', objectiveCode: 'phy.p1a.motion', objectiveDescription: 'A Space, time and motion: kinematics, forces, momentum.', canonicalConceptId: 'c-mom' }),
    row({ objectiveId: 'lo-b', objectiveCode: 'phy.p1a.particulate', objectiveDescription: 'B The particulate nature of matter: thermal energy, gases.', canonicalConceptId: 'c-gas' }),
    row({ nodeId: 'n2', nodeLabel: 'Paper 1B (data-based questions)', objectiveId: 'lo-d', objectiveCode: 'phy.p1b.data', objectiveDescription: 'Data-based: graphs, gradients, uncertainties, systematic error.', canonicalConceptId: 'c-unc' }),
    row({ nodeId: 'n3', nodeLabel: 'Paper 2', objectiveId: 'lo-p2', objectiveCode: 'phy.p2.mechanics', objectiveDescription: 'Paper 2 — mechanics: momentum, energy, projectiles (method marks).', canonicalConceptId: 'c-mom' }),
    row({ nodeId: 'n3', nodeLabel: 'Paper 2', objectiveId: 'lo-none', objectiveCode: 'phy.p2.x', objectiveDescription: 'An objective with no published concept mapping.', canonicalConceptId: null }),
  ];

  it('CASE 14. Learn does NOT auto-activate the profile subjects (subject autonomy untouched)', () => {
    const service = code('src/lib/learning-plan/subject-curriculum-topics.ts');
    expect(service).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(service).not.toMatch(/enrollCanonicalConcept|createSubject|addConceptToStudentLearning/);
    const page = code('src/app/dashboard/learn/page.tsx');
    expect(page).not.toMatch(/\b(INSERT|UPDATE)\b|subjects\/create|enrollCanonicalConcept/);
    // A catalogue concept enters the plan only through the Student's explicit button.
    const component = code('src/app/dashboard/learn/CurriculumTopics.tsx');
    expect(component).toMatch(/<AddToPlanButton\s+canonicalConceptId=\{c\.canonicalConceptId\}\s+source="CURRICULUM_RECOMMENDATION"/);
    // "Tus materias" stays what the Student chose: the picker never creates the profile's subjects for them.
    const pickerServer = code('src/lib/experience/subject-picker.server.ts');
    expect(pickerServer).not.toMatch(/\bINSERT\b/);
  });

  it('CASE 15. "Para ti" still derives from the Academic Profile', () => {
    const s = suggestSubjects({
      profile: { curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP2', schoolYear: '3° Preparatoria' },
      locale: 'es', examSubjectFocus: [], ownedSubjectNames: [],
      profileSubjects: [{ catalogKey: 'mathematics', label: 'Mathematics: analysis and approaches · HL', level: 'HL' }, { catalogKey: 'physics', label: 'Physics · HL', level: 'HL' }],
    });
    expect(s.slice(0, 2).map((x) => [x.key, x.reason])).toEqual([['mathematics', 'PROFILE_SUBJECT'], ['physics', 'PROFILE_SUBJECT']]);
    expect(code('src/lib/experience/subject-picker.server.ts')).toMatch(/profileSubjects/);
    expect(code('src/app/dashboard/subjects/SubjectPicker.tsx')).toMatch(/t\['sp\.forYou'\]/);
  });

  it('CASE 16. a subject with a known curriculum shows that curriculum\'s topics with their concepts', () => {
    const learner = new Map([['c-kin', { conceptId: 'learner-kin', subjectId: 'sub1' }]]);
    const topics = buildCurriculumTopics(ibPhysics, labels, learner);
    // The nodes are exam papers, so the curriculum's learning objectives are the topics; a paper that only
    // re-assesses listed concepts is not repeated; an unmapped objective is not shown as a topic.
    expect(topics.map((t) => t.title)).toEqual(['A Space, time and motion: kinematics, forces, momentum', 'B The particulate nature of matter: thermal energy, gases', 'Data-based: graphs, gradients, uncertainties, systematic error']);
    expect(topics[0].component).toBe('Paper 1A (multiple choice)');
    expect(topics[0].concepts).toEqual([
      { canonicalConceptId: 'c-kin', label: 'Cinemática', learnerConceptId: 'learner-kin', learnerSubjectId: 'sub1', added: true },
      { canonicalConceptId: 'c-mom', label: 'Conservación del momento lineal', learnerConceptId: null, learnerSubjectId: null, added: false },
    ]);
    // Topic titles follow the interface locale through the catalogue's reviewed labels (keyed by objective code);
    // an objective without one is shown as stored.
    expect(buildCurriculumTopics(ibPhysics, labels, learner, 'es').map((t) => t.title)).toEqual(['A. Espacio, tiempo y movimiento: cinemática, fuerzas, momento lineal', 'B. La naturaleza corpuscular de la materia: energía térmica, gases', 'Preguntas basadas en datos: gráficas, pendientes, incertidumbres, error sistemático']);
    expect(learningObjectiveLabel('phy.p1a.motion', 'en')).toBeNull();
    expect(learningObjectiveLabel('aice.9709.p3.vectors', 'es')).toBeNull();
    // Syllabus units, where the catalogue has them, are the topics.
    const units = buildCurriculumTopics(
      [row({ nodeId: 'u1', nodeType: 'TOPIC', nodeLabel: 'Mecánica', objectiveId: 'l1', canonicalConceptId: 'c-kin' }), row({ nodeId: 'u1', nodeType: 'TOPIC', nodeLabel: 'Mecánica', objectiveId: 'l2', canonicalConceptId: 'c-mom' }), row({ nodeId: 'u2', nodeType: 'UNIT', nodeLabel: 'Termodinámica', objectiveId: 'l3', canonicalConceptId: 'c-gas' })],
      labels, new Map()
    );
    expect(units.map((t) => [t.title, t.component, t.concepts.length])).toEqual([['Mecánica', null, 2], ['Termodinámica', null, 1]]);
    // Nothing is invented: no mapping -> no topics.
    expect(buildCurriculumTopics([row({ objectiveDescription: 'Paper 1: case study', canonicalConceptId: null })], labels, new Map())).toEqual([]);

    const l = Object.fromEntries(Object.entries(msgs('es')).filter(([k]) => k.startsWith('acp.learn.') || k.startsWith('lp.')));
    const title = l['acp.learn.curriculum.title'].replace('{curriculum}', ['IB Diploma Programme', localizeCatalogSubjectName('Physics', 'es'), 'HL'].join(' · '));
    expect(title).toBe('Temas de tu currículo — IB Diploma Programme · Física · HL');
    const html = renderToStaticMarkup(createElement(CurriculumTopics, { subjectId: 'sub1', title, reason: l['acp.learn.curriculum.reason.EXAM_PROFILE'], topics, labels: l }));
    clean(html);
    expect(html).toContain('data-curriculum-topics');
    expect(html).toContain(title);
    expect(html.match(/data-curriculum-topic="true"/g)).toHaveLength(3);
    expect(html).toContain('href="/dashboard/subjects/sub1/concepts/learner-kin"');
    expect(html).toContain('Conservación del momento lineal');
    expect(html).toContain(l['lp.explore.add']);
    expect(html).toContain(l['acp.learn.curriculum.reason.EXAM_PROFILE']); // the "why", when the metadata exists
    // Honest state when the curriculum has no loaded structure.
    const empty = renderToStaticMarkup(createElement(CurriculumTopics, { subjectId: 'sub1', title, reason: null, topics: [], labels: l }));
    expect(empty).toContain('data-curriculum-empty');
    expect(empty).toContain(l['acp.learn.curriculum.empty']);

    // The page reads it from the governed chain and orders the three blocks: next challenge, curriculum, search.
    const service = code('src/lib/learning-plan/subject-curriculum-topics.ts');
    for (const table of ['structure_nodes', 'learning_objectives', 'objective_concept_mappings', 'canonical_concepts', 'concept_catalog_mapping']) expect(service).toContain(table);
    expect(service).toMatch(/resolveCurriculumContext\(studentId, catalogKey\)/);
    expect(service).toMatch(/if \(!context\) return null/); // no known curriculum -> no section
    const page = read('src/app/dashboard/learn/page.tsx');
    const tail = page.slice(page.lastIndexOf('<NextChallengeCard'));
    expect(tail.indexOf('{curriculumSection}')).toBeGreaterThan(-1);
    expect(tail.indexOf('{curriculumSection}')).toBeLessThan(tail.indexOf('id="ln-find"'));
    // No topic-level assessment / practice generation was added.
    expect(code('src/app/dashboard/learn/CurriculumTopics.tsx')).not.toMatch(/quiz|practice|diagnostic|blueprint/i);
  });

  it('CASE 17. the free search and document upload stay available', () => {
    const page = code('src/app/dashboard/learn/page.tsx');
    expect(page.match(/<ConceptFinder /g)).toHaveLength(2); // first-concept state and the regular state
    expect(page.match(/<DocumentImport /g)).toHaveLength(2);
    expect(page).toMatch(/curriculum \? tr\['acp\.learn\.findOther'\] : t\['ln\.findTitle'\]/);
    expect(msgs('es')['acp.learn.findOther']).toBe('Buscar o añadir otro tema');
    expect(msgs('es')['acp.learn.nextTitle']).toBe('Tu siguiente reto');
  });
});

// ------------------------------------------------------------------ F. Home

describe('F. Home names its two contexts', () => {
  it('CASE 18. Home tells the learning context from the exam-preparation context', () => {
    const m = msgs('es');
    expect([m['acp.home.learningNow'], m['acp.home.activePrep'], m['acp.home.activePreps']]).toEqual(['Aprendiendo ahora', 'Preparación activa', 'Preparaciones activas']);
    const home = code('src/app/dashboard/today/page.tsx');
    expect(home).toMatch(/tx\['acp\.home\.learningNow'\]/);
    expect(home).toMatch(/preparations\.activeCount > 1 \? tx\['acp\.home\.activePreps'\] : tx\['acp\.home\.activePrep'\]/);
    expect(home).not.toMatch(/t\['xp\.goalLabel'\]/); // no generic "Tu objetivo"
    // Several preparations are never presented as a single objective.
    const paa = profile({ id: 'paa', objectiveKey: 'paa' });
    const ib = profile({ id: 'ib', objectiveKey: 'ib.dp.physics.hl', examDate: '2027-05-10' });
    expect(activePreparationSummary([paa], '2026-10-10')).toMatchObject({ primary: { id: 'paa' }, activeCount: 1 });
    expect(activePreparationSummary([paa, ib, profile({ id: 'old', status: 'ARCHIVED' as any })], '2026-10-10')).toMatchObject({ primary: { id: 'ib' }, activeCount: 2 });
    expect(activePreparationSummary([], '2026-10-10')).toEqual({ primary: null, activeCount: 0 });
    expect(home).toMatch(/preparations\.activeCount > 1 \? '\/dashboard\/exam-prep' :/);
    // Copy only: the same selection rule, no new architecture.
    expect(selectGoalProfile([paa, ib], '2026-10-10')!.id).toBe('ib');
    expect(objectiveDisplayLabel(examObjectives().find((o) => o.framework === 'PAA')!.key, 'es')).toMatch(/PAA/);
  });
});

// ------------------------------------------------------------------ G. localization

describe('G. catalogue labels follow the interface locale; stored values never do', () => {
  it('CASE 19. Spanish interface: academic labels in Spanish', () => {
    expect(localizeSubjectName('Physics', 'es')).toBe('Física');
    expect(localizeCatalogSubjectName('Business management', 'es')).toBe('Gestión Empresarial');
    expect(localizeCatalogSubjectName('Literature and performance (interdisciplinary, SL only)', 'es')).toBe('Literatura y Representación Teatral');
    expect(localizeCatalogSubjectName('Mathematics: analysis and approaches', 'es')).toBe('Matemáticas: Análisis y Enfoques');
    expect(localizeCatalogSubjectName('Mathematics: Analysis and Approaches', 'es')).toBe('Matemáticas: Análisis y Enfoques'); // catalogue capitalisation variants
    expect(localizeCatalogSubjectName('Visual arts', 'es')).toBe('Artes Visuales');
    expect(presentObjective(objectiveByKey('ib.dp.physics.hl')!, 'es')).toMatchObject({ label: 'Física · Nivel Superior (NS)', subject: 'Física', level: 'Nivel Superior (NS)', groupLabel: 'Física' });
    expect(gradeDisplayLabel('3° Preparatoria', 'es')).toBe('3° Preparatoria');
    // Concepts / topics: the catalogue's own localization (DB), never runtime translation.
    const loader = code('src/services/learning-os-snapshot.service.ts');
    expect(loader).toMatch(/COALESCE\(own\.label, cat\.label,/);
    expect(loader).toMatch(/canonical_concept_localizations l ON l\.canonical_concept_id = m\.canonical_concept_id AND l\.language = \$2/);
    const learn = code('src/app/dashboard/learn/page.tsx');
    expect(learn).toMatch(/t\['ln\.topicsTitle'\]\.replace\('\{subject\}', subjectLabel\)/); // "Temas de Física", not "Temas de Physics"
    expect(learn).toMatch(/const titleOf = \(c: ConceptPathView\) => catalogLabels\.get\(c\.conceptId\) \?\? c\.title/);
    for (const f of ['src/lib/exam-core/catalog/subject-localization.ts', 'src/lib/exam-core/objectives/objective-display.ts', 'src/lib/learning-plan/subject-curriculum-topics.ts']) expect(code(f)).not.toMatch(/translate\(|openai|anthropic|generateText/i);
    // Every surface named in the brief goes through the catalogue helpers.
    expect(code('src/app/dashboard/profile/AcademicProfileWizard.tsx')).toMatch(/localizeCatalogSubjectName\(s\.name, locale\)/);
    expect(code('src/app/dashboard/profile/page.tsx')).toMatch(/localizeCatalogSubjectName\(s\.name, locale\)/);
    expect(code('src/app/dashboard/today/page.tsx')).toMatch(/objectiveDisplayLabel\(goalProfile\?\.objectiveKey, locale\)/);
    expect(code('src/lib/exam-core/objectives/picker.ts')).toMatch(/presentObjective\(o, language\)/);
    expect(code('src/app/dashboard/subjects/SubjectPicker.tsx')).toMatch(/profileSubjectLabel\(s\.label\)/);
  });

  it('CASE 20. English interface: labels in English', () => {
    expect(gradeDisplayLabel('3° Preparatoria', 'en')).toBe('Grade 12');
    expect(gradeDisplayLabel('2° Secundaria', 'en')).toBe('Grade 8');
    expect(gradeDisplayLabel('3° Preparatoria', 'en')).not.toMatch(/Preparatoria|year 3/);
    expect(localizeSubjectName('Física', 'en')).toBe('Physics');
    expect(localizeCatalogSubjectName('Mathematics: analysis and approaches', 'en')).toBe('Mathematics: analysis and approaches');
    expect(presentObjective(objectiveByKey('ib.dp.physics.hl')!, 'en')).toMatchObject({ label: 'Physics · Higher Level (HL)', level: 'Higher Level (HL)', groupLabel: 'Physics' });
    expect(presentObjective(objectiveByKey('ib.dp.math-aa.sl')!, 'en').label).toBe('Mathematics: analysis and approaches · Standard Level (SL)');
    expect(interestAreaLabel('LAW', 'en')).toBe('Law');
    expect(examSessionLabel({ kind: 'EXAM_SESSION', series: 'MAY', year: 2027 }, 'en')).toBe('May 2027');
    const html = picker('en', { framework: 'IB_DP', query: 'physics' });
    clean(html);
    expect(html).toContain('Physics · Higher Level (HL)');
    expect(html).not.toMatch(/Nivel Superior|Física/);
  });

  it('CASE 21. changing the language never changes a stored value', () => {
    const o = objectiveByKey('ib.dp.math-aa.hl')!;
    const before = JSON.stringify(o);
    const shown = ['es', 'en', 'de', 'fr', 'pt'].map((l) => presentObjective(o, l));
    expect(new Set(shown.map((s) => s.groupKey))).toEqual(new Set(['mathematics'])); // one canonical group in every locale
    expect(JSON.stringify(o)).toBe(before); // the catalogue objective is not mutated
    expect(new Set(['es', 'en', 'de'].map((l) => rows(l).find((r) => r.key === o.key)!.key))).toEqual(new Set(['ib.dp.math-aa.hl']));
    // What is persisted is locale-free: objective key, canonical series + year, area ID.
    for (const l of ['es', 'en', 'pt'] as const) {
      expect(examSessionOptions(objectiveSessionModel(o, null)!, NOW, null, l).map((x) => x.key)).toEqual(['ES:NOVEMBER:2026', 'ES:MAY:2027', 'ES:NOVEMBER:2027', 'ES:MAY:2028']);
      expect(interestAreaOptions(l).map((x) => x.id)).toEqual([...INTEREST_AREAS]);
    }
    const service = code('src/lib/exam-core/objectives/preparation.service.ts');
    expect(service).toMatch(/objectiveContext: \{ label: o\.label, \.\.\.o\.context/); // stored context = catalogue values, not display labels
    expect(code('src/lib/learning-plan/subject-curriculum-topics.ts')).not.toMatch(/\bUPDATE\b/);
  });

  it('CASE 22. official programme / qualification names and syllabus codes are preserved', () => {
    for (const locale of ['es', 'en', 'de', 'fr', 'pt']) {
      const m = msgs(locale);
      expect(m['prep.fw.CIE_IGCSE']).toBe('Cambridge IGCSE');
      expect(m['prep.fw.CIE_AS_A']).toBe('Cambridge International AS & A Level');
      expect(m['prep.fw.CIE_AICE']).toBe('Cambridge AICE Diploma');
      expect(m['acp.prep.family.CAMBRIDGE']).toBe('Cambridge International');
      // Cambridge syllabus titles are official English names: kept, with their code and level.
      expect(presentObjective(objectiveByKey('cie.asal.9709.as')!, locale).label).toBe('Mathematics (9709) · AS Level');
      expect(presentObjective(objectiveByKey('cie.igcse.0580.extended')!, locale).label).toBe('Mathematics (0580) · Extended');
      expect(presentObjective(objectiveByKey('ib.dp.physics.hl')!, locale).label).toMatch(/\((NS|HL)\)$/); // the level code is never dropped
    }
    expect(objectiveByKey('ib.dp.physics.hl')!.context.programme).toBe('IB Diploma Programme');
    expect(localizeCatalogSubjectName('Travel & Tourism (9395)', 'es')).toBe('Travel & Tourism (9395)');
    expect(localizeCatalogSubjectName('Robótica del colegio', 'en')).toBe('Robótica del colegio'); // unknown: shown as stored
  });
});

// ------------------------------------------------------------------ H. no regression

describe('H. validated behaviour is not regressed', () => {
  it('CASE 23. Cancel / discard still works', () => {
    const persisted: ProfileDraft = { country: 'MX', grade: '3° Preparatoria', scope: 'INTERNATIONAL', programme: 'p-ib', qualification: null, subjects: ['a', 'b'], timeKey: 'ES:MAY:2027' };
    expect(isProfileDraftDirty(persisted, { ...persisted })).toBe(false);
    expect(cancelOutcome(isProfileDraftDirty(persisted, { ...persisted }))).toBe('EXIT');
    expect(isProfileDraftDirty(persisted, { ...persisted, subjects: ['a'] })).toBe(true);
    expect(cancelOutcome(isProfileDraftDirty(persisted, { ...persisted, grade: '2° Preparatoria' }))).toBe('CONFIRM_DISCARD');
    // The IB session ("Mayo 2027") is part of the draft: keeping it is clean, changing it is dirty.
    expect(isProfileDraftDirty(persisted, { ...persisted, timeKey: 'ES:NOVEMBER:2027' })).toBe(true);
    const wizard = code('src/app/dashboard/profile/AcademicProfileWizard.tsx');
    expect(wizard).toMatch(/cancelOutcome\(/);
    expect(wizard.match(/method: 'POST'/g)).toHaveLength(1); // Finish is still the only write
    expect(wizard).toMatch(/function exitWizard\(\) \{\s+resetToPersisted\(\);/); // discard restores the persisted draft
    expect(msgs('es')['acp.discard.title']).toBe('¿Descartar los cambios sin guardar?');
  });

  it('CASE 24. class enrolment / curriculum never modifies the personal profile', () => {
    // The delta's new code paths read the personal profile; none writes it.
    for (const f of ['src/lib/learning-plan/subject-curriculum-topics.ts', 'src/lib/exam-core/objectives/objective-session.ts', 'src/lib/exam-core/objectives/objective-display.ts', 'src/lib/exam-core/objectives/picker.ts', 'src/app/dashboard/exam-prep/page.tsx', 'src/app/dashboard/learn/page.tsx']) {
      expect(code(f)).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?(student_academic_profile|student_academic_subjects|students)\b/);
    }
    const service = code('src/lib/exam-core/objectives/preparation.service.ts');
    expect(service).toMatch(/SELECT country_of_study FROM student_academic_profile WHERE student_id = \$1/);
    expect(service).not.toMatch(/(INSERT INTO|UPDATE)\s+student_academic_profile/);
    // Class code paths still do not touch the personal profile tables.
    expect(code('src/lib/learning-plan/institution-curriculum.service.ts')).not.toMatch(/(INSERT INTO|UPDATE)\s+student_academic_(profile|subjects)/);
    // The EXAM_PREP landing ignores class / profile reasons entirely (CASE 02) and ACADEMIC keeps institution reasons.
    expect(code('src/app/dashboard/exam-prep/PreparationChooser.tsx')).toMatch(/recommended: false, reason: null, yourSubject: false/);
  });

  it('CASE 25. historical preparations and progress survive profile changes and this delta', async () => {
    const sql = read('database/migrations/20261107_1000_exam_target_session_and_aspiration.sql');
    const statements = sql.replace(/^\s*--.*$/gm, '');
    expect(statements).not.toMatch(/\b(DROP|DELETE|TRUNCATE|RENAME)\b/i);
    expect(statements).not.toMatch(/\bUPDATE\b/i); // nothing is backfilled or rewritten
    expect(statements.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(4);
    expect(statements).not.toMatch(/NOT NULL/); // every new column is nullable: existing rows stay valid
    // An existing preparation with only a date keeps it; saving a session never clears the date.
    const updates: Array<{ sql: string; params: unknown[] }> = [];
    h.dbQueryMock.mockImplementation(async (q: string, params: unknown[]) => {
      if (/^\s*UPDATE student_exam_profiles/.test(q)) { updates.push({ sql: q, params }); return { rows: [] }; }
      if (/FROM student_exam_profiles/.test(q)) return { rows: [profileRow({ exam_date: '2027-05-10', target_qualification: 'Medicina' })] };
      return { rows: [] };
    });
    const saved = await updatePreparationDetails('s1', 'p1', { examSession: 'ES:MAY:2027' }, NOW);
    expect(updates[0].sql).not.toMatch(/exam_date|target_qualification|status|objective_key/);
    expect(saved.examDate).toBe('2027-05-10');
    expect(saved.targetQualification).toBe('Medicina');
    // Rows written before this delta (no new columns) read as "no session / no area", never as an error.
    expect(storedExamSession(profile())).toBeNull();
    expect(interestAreaLabel(undefined, 'es')).toBe('');
    // A preparation is keyed by its objective, not by the profile: the profile API never touches preparations.
    const profileApi = code('src/app/api/academic-profile/route.ts') + code('src/services/academic-profile.service.ts');
    expect(profileApi).not.toMatch(/(DELETE FROM|UPDATE)\s+(student_exam_profiles|subjects|concepts|mastery_records)/);
    // Another Student's preparation still does not exist for the caller.
    h.dbQueryMock.mockImplementation(async (q: string) => (/FROM student_exam_profiles/.test(q) ? { rows: [profileRow({ student_id: 'someone-else' })] } : { rows: [] }));
    await expect(updatePreparationDetails('s1', 'p1', { interestArea: 'LAW' }, NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
