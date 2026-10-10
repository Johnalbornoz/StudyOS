/**
 * T1 FINAL MICRO-REMEDIATION (post-manual-retest) -- M01 .. M05.
 *
 * Numbered tests follow the brief's "POST-FIX TESTS" (1-11). Services run against a small in-memory
 * fake of the three independent things an ACADEMIC Student can have at once (personal profile, class
 * enrolment, teacher assignment); no network, no real database. Components with renderToStaticMarkup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => ({ dbQueryMock: vi.fn() }));
vi.mock('@/lib/db', () => {
  const query = (...a: any[]) => h.dbQueryMock(...a);
  return { db: { query, connect: async () => ({ query, release: () => undefined }) }, query };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => createElement('a', { href, ...rest }, children) }));

import { getMessages } from '@/lib/i18n/messages';
import { ObjectivePicker, type PickerObjective } from '@/app/dashboard/exam-prep/ObjectivePicker';
import CurriculumTopics from '@/app/dashboard/learn/CurriculumTopics';
import { ConceptActionRow } from '@/components/ui/ConceptActionRow';
import { examObjectives, familyOfFramework, objectiveByKey, OBJECTIVE_FRAMEWORKS } from '@/lib/exam-core/objectives/objective-catalog';
import { presentObjective } from '@/lib/exam-core/objectives/objective-display';
import { objectiveSuggestions, searchTokens, suggestionKey, SUGGEST_MIN_CHARS } from '@/lib/exam-core/objectives/objective-suggest';
import { updatePreparationDetails } from '@/lib/exam-core/objectives/preparation.service';
import { levelDisplayLabel, localizeCatalogSubjectName, localizeComponentLabel, localizeIbComponentLabel } from '@/lib/exam-core/catalog/subject-localization';
import { hasCambridgeComponentLabel, localizeCambridgeComponentLabel } from '@/lib/exam-core/catalog/cambridge-localization';
import { learningObjectiveLabel, localizedObjectiveCodes } from '@/lib/exam-core/catalog/objective-localization';
import { buildCurriculumTopics, type CurriculumTopicRow, type LearnerConceptRef } from '@/lib/learning-plan/subject-curriculum-topics';
import { hasAcademicProfileData, suggestSubjects, SUBJECT_CATALOG } from '@/lib/experience/subject-catalog';
import { saveAcademicProfileSelection } from '@/services/academic-profile-catalogue.service';
import { upsertAcademicProfile } from '@/services/academic-profile.service';
import { setStudentContextType } from '@/services/student-context.service';
import { getStudentPendingTeacherInterventions, countPendingTeacherInterventionsForStudent } from '@/lib/student/teacher-intervention-execution.service';
import { INTEREST_AREAS, interestAreaOptions } from '@/lib/student/interest-areas';
import { openTopicsStorageKey, parseOpenTopics, toggleOpenTopic } from '@/lib/learning-plan/open-topics';
import { objectiveStatusKey, preparationBadgeKey, preparationBadgeLabelKey } from '@/lib/exam-core/objectives/capabilities';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const msgs = (locale: string) => getMessages(locale) as Record<string, string>;
const NOW = new Date('2026-10-10T12:00:00Z');

// ------------------------------------------------------------------ the fake world for M01

const STUDENT = 's-academic';
interface World {
  profile: Record<string, unknown> | null;
  enrollments: Array<{ id: string; class_id: string; student_id: string; status: string }>;
  interventions: Array<Record<string, any>>;
  preparation: Record<string, any>;
  statements: string[];
}
let world: World;
const freshWorld = (): World => ({
  // personal IB profile
  profile: { student_id: STUDENT, country_of_study: 'MX', school_year: '3° Preparatoria', curriculum_type: 'ib', ib_programme: 'DP', ib_year: 'DP2', academic_year: 'May 2027', exam_series: 'MAY', exam_year: 2027, profile_completed: true },
  // active class enrolment
  enrollments: [{ id: 'e1', class_id: 'class-math', student_id: STUDENT, status: 'ACTIVE' }],
  // active teacher assignment in that class
  interventions: [{ id: 't1', student_id: STUDENT, class_id: 'class-math', title: 'Diferenciales', status: 'IN_PROGRESS', target_type: 'CONCEPT', intervention_type: 'CONCEPT_REINFORCEMENT', reason: null, instructions: null, assigned_at: '2026-10-04T23:09:18.375Z', due_at: null, starts_at: null }],
  preparation: { id: 'p1', student_id: STUDENT, exam_definition_id: null, exam_version_id: null, objective_key: 'ib.dp.math-aa.sl', objective_framework: 'IB_DP', purpose: null, programme_context: null, subject_focus: null, exam_date: null, timezone: null, institution_target_id: null, status: 'ACTIVE' },
  statements: [],
});

const CLASS_SIDE = /(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?(class_enrollments|classes|teacher_interventions|teacher_intervention_executions|institution_\w+|class_plan_concepts)\b/i;
const PROFILE_SIDE = /(INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?(student_academic_profile|student_academic_subjects)\b/i;

function installWorld() {
  h.dbQueryMock.mockImplementation(async (sql: string, params: any[] = []) => {
    world.statements.push(sql.replace(/\s+/g, ' ').trim());
    if (/FROM teacher_intervention_executions/.test(sql)) return { rows: [] };
    if (/FROM teacher_interventions WHERE student_id = \$1 AND status IN/.test(sql)) {
      const rows = world.interventions.filter((t) => t.student_id === params[0] && ['ASSIGNED', 'IN_PROGRESS'].includes(t.status));
      return /COUNT\(\*\)/i.test(sql) ? { rows: [{ n: rows.length }] } : { rows };
    }
    if (/INSERT INTO student_academic_profile/.test(sql)) {
      world.profile = { ...(world.profile ?? {}), student_id: params[0], country_of_study: params[1], school_year: params[2], curriculum_type: params[3] };
      return { rows: [world.profile] };
    }
    if (/FROM student_academic_profile/.test(sql)) return { rows: world.profile ? [world.profile] : [] };
    if (/^\s*UPDATE student_exam_profiles/.test(sql)) return { rows: [] };
    if (/FROM student_exam_profiles/.test(sql)) return { rows: [world.preparation] };
    return { rows: [] };
  });
}
const mutations = () => world.statements.filter((s) => /^(INSERT|UPDATE|DELETE)\b/i.test(s));
/** The page's own read: state reconstructed from the database on every request (what a new login does). */
const visibleAssignments = async () => (await getStudentPendingTeacherInterventions(STUDENT)).map((t) => [t.title, t.effectiveStatus]);

beforeEach(() => {
  h.dbQueryMock.mockReset();
  world = freshWorld();
  installWorld();
});

// ------------------------------------------------------------------ M01

describe('M01. personal Academic Profile and class context are independent', () => {
  it('1. class enrolment survives personal-profile operations (save, edit, cancel)', async () => {
    const before = JSON.stringify([world.enrollments, world.interventions]);
    // Profile edit through both write paths the app has.
    await upsertAcademicProfile(STUDENT, { countryOfStudy: 'MX', schoolYear: '2° Preparatoria', curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP1', academicYear: 'May 2028' } as any);
    await saveAcademicProfileSelection(STUDENT, { countryOfStudy: 'MX', schoolYear: '3° Preparatoria', curriculumScope: null, academicProgrammeId: null, academicQualificationId: null, academicSubjectIds: [], curriculumType: 'other', academicYear: '2026–2027', profileCompleted: true }, 'user-1');
    await setStudentContextType(STUDENT, 'ACADEMIC');
    const writes = mutations();
    expect(writes.some((s) => PROFILE_SIDE.test(s))).toBe(true); // the profile really was written...
    expect(writes.filter((s) => CLASS_SIDE.test(s))).toEqual([]); // ...and nothing on the class side was
    expect(JSON.stringify([world.enrollments, world.interventions])).toBe(before);
    // Cancel / discard is client-only: the wizard has exactly one write, in finish().
    const wizard = code('src/app/dashboard/profile/AcademicProfileWizard.tsx');
    expect(wizard.match(/method: 'POST'/g)).toHaveLength(1);
    expect(wizard).toMatch(/function exitWizard\(\) \{\s+resetToPersisted\(\);/);
    // The write paths themselves never name a class-side table.
    for (const f of ['src/services/academic-profile.service.ts', 'src/services/academic-profile-catalogue.service.ts', 'src/services/student-context.service.ts', 'src/app/api/academic-profile/route.ts', 'src/app/api/student/context/route.ts']) {
      expect(code(f), f).not.toMatch(CLASS_SIDE);
    }
  });

  it('2. an active assignment stays visible after the state is reconstructed (logout / login)', async () => {
    expect(await visibleAssignments()).toEqual([['Diferenciales', 'IN_PROGRESS']]);
    // A profile save, then a brand-new read with nothing cached -- what a new session does.
    await upsertAcademicProfile(STUDENT, { countryOfStudy: 'MX', schoolYear: '3° Preparatoria', curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP2', academicYear: 'May 2027' } as any);
    expect(await visibleAssignments()).toEqual([['Diferenciales', 'IN_PROGRESS']]);
    expect(await countPendingTeacherInterventionsForStudent(STUDENT)).toBe(1);
    // Visibility depends ONLY on the assignment's own student + status: never on the profile, the context
    // type, the programme, a workspace or an exam preparation.
    const service = code('src/lib/student/teacher-intervention-execution.service.ts');
    expect(service).toMatch(/SELECT \* FROM teacher_interventions WHERE student_id = \$1 AND status IN \('ASSIGNED', 'IN_PROGRESS'\) ORDER BY assigned_at DESC/);
    const listQuery = service.slice(service.indexOf('export async function getStudentPendingTeacherInterventions'), service.indexOf('export async function reconcileCompletionsForStudent'));
    expect(listQuery).not.toMatch(/student_academic_profile|student_context_type|academic_programme|active_workspace|student_exam_profiles/);
    const page = code('src/app/dashboard/assignments/page.tsx');
    expect(page).toMatch(/getStudentPendingTeacherInterventions\(studentId\)/);
    expect(page).not.toMatch(/student_academic_profile|student_context_type|contextType/);
    // An assignment belongs to the Student it was assigned to: another Student of the same class does not see it.
    world.interventions.push({ ...world.interventions[0], id: 't2', student_id: 'another-student', title: 'De otra persona' });
    expect(await visibleAssignments()).toEqual([['Diferenciales', 'IN_PROGRESS']]);
    // The T1 migrations touched no class-side table.
    for (const m of ['20261106_1000_student_context_and_time_context.sql', '20261106_1100_exam_series_canonical.sql', '20261107_1000_exam_target_session_and_aspiration.sql']) {
      const sql = read(`database/migrations/${m}`).replace(/^\s*--.*$/gm, '');
      expect(sql, m).not.toMatch(/class_enrollments|teacher_interventions|\bclasses\b/);
      expect(sql, m).not.toMatch(/\b(DELETE|TRUNCATE|DROP TABLE)\b/i);
    }
  });

  it('3. exam-preparation changes do not detach the class assignment (nor the personal profile)', async () => {
    const profileBefore = JSON.stringify(world.profile);
    await updatePreparationDetails(STUDENT, 'p1', { examSession: 'ES:MAY:2027', interestArea: 'ENGINEERING_TECHNOLOGY', targetInstitutionName: 'UNAM' }, NOW);
    const writes = mutations();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^UPDATE student_exam_profiles SET /);
    expect(writes.filter((s) => CLASS_SIDE.test(s) || PROFILE_SIDE.test(s))).toEqual([]);
    expect(JSON.stringify(world.profile)).toBe(profileBefore); // class / exam context never overwrites the personal profile
    expect(await visibleAssignments()).toEqual([['Diferenciales', 'IN_PROGRESS']]);
    expect(world.enrollments).toEqual([{ id: 'e1', class_id: 'class-math', student_id: STUDENT, status: 'ACTIVE' }]);
    for (const f of ['src/lib/exam-core/objectives/preparation.service.ts', 'src/app/api/exam-preparation/route.ts', 'src/app/api/exam-preparation/[id]/route.ts', 'src/lib/assessment/student-exam-profile.service.ts']) {
      expect(code(f), f).not.toMatch(CLASS_SIDE);
      expect(code(f), f).not.toMatch(PROFILE_SIDE);
    }
  });
});

// ------------------------------------------------------------------ M02

describe('M02. concept + action rows', () => {
  const row = (over: Partial<CurriculumTopicRow>): CurriculumTopicRow => ({ nodeId: 'n1', nodeType: 'EXAM_SECTION', nodeLabel: 'Paper 1 (no calculator)', nodeOrder: 0, objectiveId: 'lo-a', objectiveCode: 'aasl.p1.algebra', objectiveDescription: 'Number and algebra: logarithms, sequences and series.', canonicalConceptId: null, ...over });
  const labels = new Map([['c-log', 'Logaritmos'], ['c-seq', 'Sucesiones y series'], ['c-long', 'Funciones racionales, funciones inversas y resolución de inecuaciones cuadráticas en contexto']]);
  const rows = [row({ canonicalConceptId: 'c-log' }), row({ canonicalConceptId: 'c-seq' }), row({ canonicalConceptId: 'c-long' })];
  const l = (locale: string) => Object.fromEntries(Object.entries(msgs(locale)).filter(([k]) => k.startsWith('acp.learn.') || k.startsWith('lp.')));
  const render = (locale: string, learner = new Map<string, LearnerConceptRef>(), inPlan = new Set<string>()) =>
    renderToStaticMarkup(createElement(CurriculumTopics, { subjectId: 'sub1', title: 'T', reason: null, topics: buildCurriculumTopics(rows, labels, learner, locale, inPlan), labels: l(locale) }));

  it('4. a topic\'s concept rows render a semantic concept / action pairing', () => {
    const html = render('es');
    expect(html).not.toMatch(/undefined|>acp\.|>lp\./);
    expect(html.match(/data-concept-row="true"/g)).toHaveLength(3);
    // Each row: the name in its own element with an id, and the action referencing that id.
    const m = /<span class="concept-action-name" id="(ln-cur-0-1)">Sucesiones y series<\/span><span class="concept-action-side">(.*?)<\/span><\/div>/.exec(html)!;
    expect(m).not.toBeNull();
    expect(m[2]).toContain(`aria-describedby="${m[1]}"`);
    expect(m[2]).toContain('aria-label="Añadir a mi plan: Sucesiones y series"'); // unambiguous about the concept it affects
    expect(m[2]).toContain('>Añadir a mi plan</button>');
    // The whole label is one text node: never split per character, never truncated.
    expect(html).toContain('>Funciones racionales, funciones inversas y resolución de inecuaciones cuadráticas en contexto</span>');
    // One shared component and one stylesheet rule set -- the same for every locale.
    const en = render('en');
    expect(en.match(/data-concept-row="true"/g)).toHaveLength(3);
    expect(en).toContain('aria-label="Add to my plan: Sucesiones y series"');
    expect(code('src/app/dashboard/learn/CurriculumTopics.tsx').match(/<ConceptActionRow/g)).toHaveLength(2);
    expect(renderToStaticMarkup(createElement(ConceptActionRow, { nameId: 'x', name: 'Cinemática', action: createElement('button', null, 'Go') }))).toBe(
      '<div class="concept-action-row" data-concept-row="true" data-concept-state="available"><span class="concept-action-name" id="x">Cinemática</span><span class="concept-action-side"><button>Go</button></span></div>'
    );
    // Layout contract: flexible name that wraps by words; natural-width action; CTA below on narrow viewports.
    const css = read('src/app/globals.css');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.-]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)![1];
    expect(rule('.concept-action-row')).toMatch(/display: flex/);
    expect(rule('.concept-action-row')).toMatch(/flex-wrap: wrap/);
    expect(rule('.concept-action-name')).toMatch(/flex: 1 1 14rem/);
    expect(rule('.concept-action-name')).toMatch(/min-width: 0/);
    expect(rule('.concept-action-name')).toMatch(/overflow-wrap: break-word/);
    expect(rule('.concept-action-name')).not.toMatch(/anywhere|break-all/); // never character-by-character
    expect(rule('.concept-action-side')).toMatch(/flex: 0 0 auto/);
    // The regression: the row must not reuse the 4-column .ln-concept grid (its first column is the 20px icon slot).
    expect(code('src/app/dashboard/learn/CurriculumTopics.tsx')).not.toMatch(/className="ln-concept\b/);
    expect(css).not.toMatch(/\.ln-concept--catalog/);
  });

  it('5. a concept that is already added shows the Added state instead of the same CTA', () => {
    const learner = new Map<string, LearnerConceptRef>([['c-log', { conceptId: 'lc-log', subjectId: 'sub-other' }]]);
    const topics = buildCurriculumTopics(rows, labels, learner, 'es', new Set(['c-seq']));
    expect(topics[0].concepts.map((c) => [c.canonicalConceptId, c.added, c.learnerConceptId, c.learnerSubjectId])).toEqual([
      ['c-log', true, 'lc-log', 'sub-other'], // studied already (in whichever subject holds it)
      ['c-seq', true, null, null], // in the plan
      ['c-long', false, null, null],
    ]);
    const html = render('es', learner, new Set(['c-seq']));
    const rowsHtml = html.split('data-concept-row="true"').slice(1);
    expect(rowsHtml[0]).toContain('data-concept-state="added"');
    expect(rowsHtml[0]).toContain('>Añadido</span>');
    expect(rowsHtml[0]).toContain('href="/dashboard/subjects/sub-other/concepts/lc-log"'); // opens it where it lives
    expect(rowsHtml[0]).not.toContain('Añadir a mi plan');
    expect(rowsHtml[1]).toContain('>Añadido</span>');
    expect(rowsHtml[1]).not.toContain('Añadir a mi plan');
    expect(rowsHtml[2]).toContain('data-concept-state="available"');
    expect(rowsHtml[2]).toContain('>Añadir a mi plan</button>');
    expect(render('en', learner, new Set(['c-seq']))).toContain('>Added</span>');
    // After a successful add the button itself becomes the Added state (no second identical CTA).
    const button = code('src/app/dashboard/plan/PlanActions.tsx');
    expect(button).toMatch(/if \(done && labels\.added\) return <span[^>]*data-concept-added>\{labels\.added\}<\/span>;/);
    expect(button).toMatch(/if \(res\.ok\) \{\s+setDone\(true\);/);
    // Topic -> concept resolution is unchanged: same governed chain, read-only.
    const service = code('src/lib/learning-plan/subject-curriculum-topics.ts');
    expect(service).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(service).toMatch(/resolveCurriculumContext\(studentId, catalogKey\)/);
  });
});

// ------------------------------------------------------------------ M04

describe('M04. exam catalogue typeahead', () => {
  const strip = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const rows = (locale: string): PickerObjective[] =>
    examObjectives().map((o) => {
      const shown = presentObjective(o, locale);
      return {
        key: o.key, framework: o.framework, kind: o.kind, label: shown.label, context: o.context, status: 'canAdd', preparationId: null,
        searchText: `${o.searchText} ${strip(shown.label)} ${strip(shown.groupLabel ?? '')} ${strip(presentObjective(o, 'en').label)}`,
        groupKey: shown.groupKey, groupLabel: shown.groupLabel, subjectLabel: shown.subject, levelLabel: shown.level,
      };
    });
  const frameworks = OBJECTIVE_FRAMEWORKS.map((f) => ({ ...f, family: familyOfFramework(f.key) }));
  const labels = (locale: string) => Object.fromEntries(Object.entries(msgs(locale)).filter(([k]) => k.startsWith('prep.') || k.startsWith('acp.prep.')));
  const suggest = (query: string, locale = 'es') => {
    const l = labels(locale);
    return objectiveSuggestions({ query, objectives: rows(locale).map((o) => ({ ...o, syllabusCode: o.context.syllabusCode })), frameworks, frameworkName: (k) => l[`prep.fw.${k}`], familyName: (k) => l[`acp.prep.family.${k}`] });
  };
  const picker = (locale: string, initial: Record<string, unknown>) => renderToStaticMarkup(createElement(ObjectivePicker, { objectives: rows(locale), frameworks, suggested: [], labels: labels(locale), initial }));

  it('6. autocomplete returns canonical subject / variant / level suggestions (and family, exam, syllabus code)', () => {
    expect(SUGGEST_MIN_CHARS).toBe(2);
    expect(suggest('a')).toEqual([]);
    // "ana" -> the course, with its two levels beneath it.
    const ana = suggest('ana');
    expect(ana.map((s) => [s.kind, s.label, s.depth])).toEqual([
      ['VARIANT', 'Matemáticas: Análisis y Enfoques', 0],
      ['OPTION', 'Nivel Medio (NM)', 1],
      ['OPTION', 'Nivel Superior (NS)', 1],
    ]);
    expect(ana[0].detail).toBe(msgs('es')['prep.fw.IB_DP']);
    // Word-prefix matching: "ana" does not offer "Management" / "Lenguas".
    expect(ana.some((s) => /Gesti|Management/i.test(s.label))).toBe(false);
    // Canonical subject + courses.
    const mat = suggest('mat');
    expect(mat[0]).toMatchObject({ kind: 'SUBJECT', label: 'Matemáticas', apply: { query: 'Matemáticas' } });
    expect(mat.filter((s) => s.kind === 'VARIANT').map((s) => s.label)).toEqual(expect.arrayContaining(['Matemáticas: Análisis y Enfoques', 'Matemáticas: Aplicaciones e Interpretación']));
    // Exam family and exam.
    expect(suggest('cam')[0]).toMatchObject({ kind: 'FAMILY', label: 'Cambridge International', apply: { family: 'CAMBRIDGE' } });
    expect(suggest('cambridge ig').some((s) => s.kind === 'FRAMEWORK' && s.apply.framework === 'CIE_IGCSE')).toBe(true);
    expect(suggest('pis').map((s) => s.kind)).toEqual(['FRAMEWORK']); // a test is offered once, as its exam
    // Level and syllabus code.
    expect(suggest('superior fis').map((s) => [s.kind, s.label])).toEqual([['VARIANT', 'Física'], ['OPTION', 'Nivel Superior (NS)']]);
    const code9709 = suggest('9709');
    expect(code9709[0]).toMatchObject({ kind: 'VARIANT', label: 'Mathematics (9709)', apply: { framework: 'CIE_AS_A', query: 'Mathematics (9709)' } });
    expect(code9709.slice(1).map((s) => s.label)).toEqual(['AS Level', 'A Level']);
    // English interface: English labels, the same keys underneath.
    expect(suggest('ana', 'en').map((s) => s.label)).toEqual(['Mathematics: analysis and approaches', 'Standard Level (SL)', 'Higher Level (HL)']);
    expect(suggest('ana', 'en').map((s) => s.id)).toEqual(suggest('ana').map((s) => s.id).map((id) => id.replace('Matemáticas: Análisis y Enfoques', 'Mathematics: analysis and approaches')));

    // Selecting a suggestion filters to the canonical result: the course -> its two levels only...
    const chosen = picker('es', { framework: ana[0].apply.framework, query: ana[0].apply.query });
    expect(chosen).toContain('Matemáticas: Análisis y Enfoques · Nivel Medio (NM)');
    expect(chosen).toContain('Matemáticas: Análisis y Enfoques · Nivel Superior (NS)');
    expect(chosen).not.toContain('Aplicaciones e Interpretación');
    expect(chosen).toMatch(/2 (resultados|opciones)|>2</);
    // ...a level -> exactly that option...
    const level = picker('es', { framework: ana[2].apply.framework, query: ana[2].apply.query });
    expect(level).toContain('Matemáticas: Análisis y Enfoques · Nivel Superior (NS)');
    expect(level).not.toContain('Matemáticas: Análisis y Enfoques · Nivel Medio (NM)');
    // ...and a canonical subject -> its group, opened (grouping applies to the long result).
    const subject = picker('es', { query: mat[0].apply.query });
    expect(subject).toMatch(/<details[^>]*data-subject-group="mathematics"[^>]* open/);
    // A suggestion only changes the picker's filter: nothing is added or selected.
    const ui = code('src/app/dashboard/exam-prep/ObjectivePicker.tsx');
    const apply = ui.slice(ui.indexOf('function applySuggestion'), ui.indexOf('function onSearchKey'));
    expect(apply).not.toMatch(/fetch\(|choose\(|router\./);
  });

  it('7. keyboard navigation works (Arrow Up / Down, Enter, Escape)', () => {
    const closed = { open: false, active: -1 };
    const down1 = suggestionKey(closed, 'ArrowDown', 3);
    expect(down1).toMatchObject({ open: true, active: 0, handled: true, select: null });
    const down2 = suggestionKey(down1, 'ArrowDown', 3);
    expect(down2.active).toBe(1);
    expect(suggestionKey({ open: true, active: 2 }, 'ArrowDown', 3).active).toBe(0); // wraps
    expect(suggestionKey(down2, 'ArrowUp', 3).active).toBe(0);
    expect(suggestionKey({ open: true, active: 0 }, 'ArrowUp', 3).active).toBe(2); // wraps
    expect(suggestionKey(closed, 'ArrowUp', 3)).toMatchObject({ open: true, active: 2 });
    expect(suggestionKey(down2, 'Enter', 3)).toMatchObject({ select: 1, open: false, handled: true });
    expect(suggestionKey({ open: true, active: 1 }, 'Escape', 3)).toMatchObject({ open: false, active: -1, select: null, handled: true });
    // Enter with nothing highlighted is NOT taken over: the typed search stays as it is.
    expect(suggestionKey({ open: true, active: -1 }, 'Enter', 3)).toMatchObject({ handled: false, select: null });
    expect(suggestionKey(closed, 'Escape', 3).handled).toBe(false);
    expect(suggestionKey(closed, 'ArrowDown', 0)).toMatchObject({ open: false, handled: false });
    expect(suggestionKey({ open: true, active: 0 }, 'a', 3).handled).toBe(false);

    // The control is a real combobox with a listbox popup.
    const html = picker('es', { query: 'ana', suggest: true });
    expect(html).toMatch(/<input[^>]*role="combobox"[^>]*aria-autocomplete="list"[^>]*aria-expanded="true"[^>]*aria-controls="prep-suggest"/);
    expect(html).toMatch(/<ul class="prep-suggest" id="prep-suggest" role="listbox"/);
    expect(html.match(/role="option"/g)).toHaveLength(3);
    expect(html).toContain('id="prep-suggest-hint"');
    expect(picker('es', { query: 'ana' })).toMatch(/aria-expanded="false"/);
    expect(picker('es', { query: 'ana' })).not.toContain('role="listbox"');
    const ui = code('src/app/dashboard/exam-prep/ObjectivePicker.tsx');
    expect(ui).toMatch(/onKeyDown=\{onSearchKey\}/);
    expect(ui).toMatch(/const next = suggestionKey\(\{ open: suggestOpen, active: suggest\.active \}, e\.key, suggestions\.length\);\s+if \(!next\.handled\) return;/);
    expect(ui).toMatch(/aria-activedescendant=\{suggestOpen && suggest\.active >= 0 \? `prep-suggest-\$\{suggest\.active\}` : undefined\}/);
    for (const locale of ['es', 'en', 'de', 'fr', 'pt']) for (const k of ['acp.prep.suggest.label', 'acp.prep.suggest.hint', 'acp.prep.suggest.kind.VARIANT', 'acp.prep.suggest.kind.OPTION']) expect(msgs(locale)[k], `${locale} ${k}`).toBeTruthy();
  });

  it('8. the existing free search still works when suggestions are ignored', () => {
    // "anális" still narrows IB from 60 options to the two Math AA variants.
    const ib = rows('es').filter((o) => o.framework === 'IB_DP');
    expect(ib).toHaveLength(60);
    const words = searchTokens('anális');
    expect(words).toEqual(['analis']);
    expect(ib.filter((o) => words.every((w) => o.searchText.includes(w))).map((o) => o.key).sort()).toEqual(['ib.dp.math-aa.hl', 'ib.dp.math-aa.sl']);
    const html = picker('es', { framework: 'IB_DP', query: 'anális' });
    expect(html).toContain('Matemáticas: Análisis y Enfoques · Nivel Medio (NM)');
    expect(html).toContain('Matemáticas: Análisis y Enfoques · Nivel Superior (NS)');
    expect(html).not.toContain('Aplicaciones e Interpretación');
    expect(html).not.toContain('Física ·');
    // Substring search is kept for the results (suggestions alone use word prefixes).
    expect(picker('es', { framework: 'IB_DP', query: 'sica' })).toContain('Física · Nivel Superior (NS)');
    expect(picker('es', { query: '9702' })).toContain('Physics (9702) · AS Level');
    expect(picker('es', { query: 'zzzz' })).toContain(msgs('es')['prep.noResults']);
    // Typing keeps filtering: onChange still sets the query; the popup is separate state.
    const ui = code('src/app/dashboard/exam-prep/ObjectivePicker.tsx');
    expect(ui).toMatch(/onChange=\{\(e\) => \{ setQuery\(e\.target\.value\); setLimit\(PAGE\); setSuggest\(\{ open: true, active: -1 \}\); \}\}/);
  });
});

// ------------------------------------------------------------------ M05

describe('M05. "Para ti" only holds subjects with a real source', () => {
  const base = { locale: 'es' as const, ownedSubjectNames: [] as string[] };

  it('9. an EXAM_PREP Student with no Academic Profile gets no unjustified generic subjects', () => {
    // The manual case: no profile, one active IB Math AA NM preparation.
    const s = suggestSubjects({ ...base, profile: null, examSubjectFocus: ['Mathematics: analysis and approaches'], profileSubjects: [] });
    expect(s.map((x) => [x.key, x.reason])).toEqual([['mathematics', 'EXAM']]);
    for (const generic of ['language_literature', 'english', 'natural_sciences', 'history', 'geography']) expect(s.map((x) => x.key)).not.toContain(generic);
    // An empty profile row is not a source either.
    const emptyRow = { curriculumType: null, ibProgramme: null, ibYear: null, schoolYear: null };
    expect(hasAcademicProfileData(emptyRow)).toBe(false);
    expect(hasAcademicProfileData(null)).toBe(false);
    expect(suggestSubjects({ ...base, profile: emptyRow, examSubjectFocus: [], profileSubjects: [] })).toEqual([]);
    // No source at all -> "Para ti" is not rendered and Explore opens by default.
    const pickerUi = code('src/app/dashboard/subjects/SubjectPicker.tsx');
    expect(pickerUi).toMatch(/\{suggestions\.length > 0 && \(/);
    expect(pickerUi).toMatch(/<details className="sp-all" open=\{suggestions\.length === 0 \|\| undefined\}>/);
    // The server only passes a profile that is real (completed, or with a chosen programme).
    expect(code('src/lib/experience/subject-picker.server.ts')).toMatch(/profile: profile && \(profile\.profileCompleted \|\| resolved\?\.programme\)/);
    // Every suggestion carries its reason; each reason is a real source.
    expect(new Set(s.map((x) => x.reason))).toEqual(new Set(['EXAM']));
    expect(msgs('es')['sp.examBadge']).toBe('Por tu preparación de examen');
    expect(pickerUi).toMatch(/s\.reason === 'EXAM' \? t\['sp\.examBadge'\] : undefined/);
    // Nothing is auto-activated: the picker only creates a subject from the Student's own click.
    expect(code('src/lib/experience/subject-picker.server.ts')).not.toMatch(/\bINSERT\b/);
    expect(pickerUi).toMatch(/onClick=\{\(\) => choose\(key\)\}/);
  });

  it('10. generic subjects stay available under "Explorar materias"; real sources still recommend', () => {
    expect([msgs('es')['sp.all'], msgs('en')['sp.all']]).toEqual(['Explorar materias', 'Explore subjects']);
    const pickerUi = code('src/app/dashboard/subjects/SubjectPicker.tsx');
    expect(pickerUi).toMatch(/<summary className="sp-all-summary">\{t\['sp\.all'\]\}<\/summary>/);
    // The whole catalogue remains reachable there (it is not filtered by any source).
    expect(SUBJECT_CATALOG.map((e) => e.key)).toEqual(expect.arrayContaining(['mathematics', 'language_literature', 'english', 'natural_sciences', 'history', 'geography']));
    expect(pickerUi).toMatch(/rest\.map\(\(e\) => option\(e\.key\)\)/);
    // ACADEMIC with a real profile keeps its profile-aware recommendations...
    const academic = suggestSubjects({ ...base, profile: { curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP2', schoolYear: '3° Preparatoria' }, examSubjectFocus: [], profileSubjects: [] });
    expect(academic.length).toBeGreaterThan(3);
    expect(new Set(academic.map((x) => x.reason))).toEqual(new Set(['PROFILE']));
    // ...and selected profile subjects are still exactly "Para ti".
    const selected = suggestSubjects({ ...base, profile: { curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP2', schoolYear: '3° Preparatoria' }, examSubjectFocus: [], profileSubjects: [{ catalogKey: 'physics', label: 'Physics · HL', level: 'HL' }] });
    expect(selected).toEqual([{ key: 'physics', reason: 'PROFILE_SUBJECT', label: 'Physics · HL', level: 'HL' }]);
    // A subject the Student already has is "Tus materias", never suggested again.
    expect(suggestSubjects({ ...base, ownedSubjectNames: ['Matemáticas'], profile: null, examSubjectFocus: ['Mathematics'], profileSubjects: [] })).toEqual([]);
  });
});

// ------------------------------------------------------------------ M03

describe('M03. ES / EN change display labels, never stored IDs', () => {
  it('11. display labels follow the interface language; canonical values do not', () => {
    // Levels: the product's display, with the code kept; official level names untouched.
    expect([levelDisplayLabel('SL', 'es'), levelDisplayLabel('HL', 'es')]).toEqual(['Nivel Medio (NM)', 'Nivel Superior (NS)']);
    expect([levelDisplayLabel('SL', 'en'), levelDisplayLabel('HL', 'en')]).toEqual(['Standard Level (SL)', 'Higher Level (HL)']);
    for (const official of ['AS Level', 'A Level', 'Extended', 'Core']) expect(levelDisplayLabel(official, 'es')).toBe(official);
    expect(levelDisplayLabel(null, 'es')).toBe('');
    expect([msgs('es')['sp.levelHL'], msgs('es')['sp.levelSL']]).toEqual(['Nivel Superior (NS)', 'Nivel Medio (NM)']);
    // IB assessment components: the IB's own Spanish terms; English and non-IB labels unchanged.
    expect(localizeIbComponentLabel('Paper 1 (no calculator)', 'es')).toBe('Prueba 1 (sin calculadora)');
    expect(localizeIbComponentLabel('Paper 2 (GDC)', 'es')).toBe('Prueba 2 (con calculadora gráfica)');
    expect(localizeIbComponentLabel('Paper 1A (multiple choice)', 'es')).toBe('Prueba 1A (opción múltiple)');
    expect(localizeIbComponentLabel('Paper 1B (data-based questions)', 'es')).toBe('Prueba 1B (preguntas basadas en datos)');
    expect(localizeIbComponentLabel('Internal assessment', 'es')).toBe('Evaluación interna');
    expect(localizeIbComponentLabel('Paper 1 (no calculator)', 'en')).toBe('Paper 1 (no calculator)');
    expect(localizeIbComponentLabel('Algo no catalogado', 'es')).toBe('Algo no catalogado');
    // Applied on the T1 surfaces: Learn (title level + topic component), Exam Prep (areas, modes, requirements,
    // concepts), Profile (wizard + summary), "Para ti".
    const learn = code('src/app/dashboard/learn/page.tsx');
    expect(learn).toMatch(/levelDisplayLabel\(curriculum\.context\.level, locale\)/);
    expect(code('src/lib/learning-plan/subject-curriculum-topics.ts')).toMatch(/localizeComponentLabel\(context\.programme, t\.component, locale\)/);
    const home = code('src/app/dashboard/exam-prep/[examProfileId]/PreparationHome.tsx');
    expect(home).toMatch(/localizeComponentLabel\(objective\.framework, label, language\)/);
    expect(home.match(/comp\(/g)!.length).toBeGreaterThanOrEqual(6);
    const service = code('src/lib/exam-core/objectives/preparation.service.ts');
    expect(service).toMatch(/description: learningObjectiveLabel\(r\.code, language\) \?\? r\.description/);
    expect(service).toMatch(/name: conceptLabels\.get\(c\.id\) \?\? c\.name/);
    expect(service).toMatch(/canonicalConceptLabels\(canonicalIds, language\)/);
    expect(code('src/app/dashboard/profile/page.tsx')).toMatch(/levelDisplayLabel\(s\.level, locale\)/);
    expect(code('src/app/dashboard/profile/AcademicProfileWizard.tsx')).toMatch(/levelDisplayLabel\(s\.level, locale\)/);
    expect(code('src/app/dashboard/subjects/SubjectPicker.tsx')).toMatch(/levelDisplayLabel\(part, locale\)/);
    // Catalogue localization only -- no runtime translation.
    for (const f of ['src/lib/exam-core/catalog/subject-localization.ts', 'src/lib/exam-core/catalog/objective-localization.ts', 'src/lib/exam-core/objectives/objective-suggest.ts']) expect(code(f)).not.toMatch(/translate\(|openai|anthropic|generateText|fetch\(/i);

    // Stored / canonical values are identical in both languages.
    const o = objectiveByKey('ib.dp.math-aa.sl')!;
    const snapshot = JSON.stringify(o);
    const [es, en] = [presentObjective(o, 'es'), presentObjective(o, 'en')];
    expect([es.label, en.label]).toEqual(['Matemáticas: Análisis y Enfoques · Nivel Medio (NM)', 'Mathematics: analysis and approaches · Standard Level (SL)']);
    expect(es.groupKey).toBe(en.groupKey);
    expect(JSON.stringify(o)).toBe(snapshot);
    expect(o.context.level).toBe('Nivel Medio (NM)'); // the catalogue value itself is not rewritten
    expect(interestAreaOptions('es').map((x) => x.id)).toEqual(interestAreaOptions('en').map((x) => x.id));
    expect(interestAreaOptions('es').map((x) => x.id)).toEqual([...INTEREST_AREAS]);
    // Official programme / qualification names and codes stay official.
    for (const locale of ['es', 'en']) {
      expect(msgs(locale)['prep.fw.CIE_AS_A']).toBe('Cambridge International AS & A Level');
      expect(presentObjective(objectiveByKey('cie.asal.9709.as')!, locale).label).toBe('Mathematics (9709) · AS Level');
    }
    expect(localizeCatalogSubjectName('Mathematics (9709)', 'es')).toBe('Mathematics (9709)');
  });
});

// ================================================================== T1 FINAL UI POLISH (post-final-smoke)

describe('UI polish M02b. the topic stays expanded after "Add to my plan"', () => {
  const row = (id: string, lo = 'lo-a', code = 'aasl.p1.algebra'): CurriculumTopicRow => ({ nodeId: 'n1', nodeType: 'EXAM_SECTION', nodeLabel: 'Paper 1 (no calculator)', nodeOrder: 0, objectiveId: lo, objectiveCode: code, objectiveDescription: 'x', canonicalConceptId: id });
  const labels = new Map([['c-log', 'Logaritmos'], ['c-seq', 'Sucesiones y series'], ['c-der', 'Derivación']]);
  const rows = [row('c-log'), row('c-seq'), row('c-der', 'lo-b', 'aasl.p1.calculus')];
  const l = Object.fromEntries(Object.entries(msgs('es')).filter(([k]) => k.startsWith('acp.learn.') || k.startsWith('lp.')));
  const render = (topics: ReturnType<typeof buildCurriculumTopics>, initialOpen: string[]) => renderToStaticMarkup(createElement(CurriculumTopics, { subjectId: 'sub1', title: 'T', reason: null, topics, labels: l, initialOpen }));

  it('open topics are controlled state that survives the data refresh; siblings stay actionable', () => {
    const before = buildCurriculumTopics(rows, labels, new Map(), 'es');
    expect(before.map((t) => t.key)).toEqual(['lo:lo-a', 'lo:lo-b']);
    // Closed by default; the topic the Student opened is the only one open.
    expect(render(before, [])).not.toMatch(/<details[^>]* open/);
    const opened = render(before, ['lo:lo-a']);
    expect(opened.match(/<details[^>]* open=""/g)).toHaveLength(1);
    // After the add, the SAME open set renders the refreshed data: the clicked concept is "Añadido" + "Abrir"
    // in place, its sibling is still there with its own CTA, and the topic is still expanded.
    const after = buildCurriculumTopics(rows, labels, new Map<string, LearnerConceptRef>([['c-seq', { conceptId: 'lc-seq', subjectId: 'sub1' }]]), 'es');
    expect(after.map((t) => t.key)).toEqual(before.map((t) => t.key)); // stable keys: the open set still points at the same topic
    const html = render(after, ['lo:lo-a']);
    const topic = /<details[^>]* open=""[^>]*>(.*?)<\/details>/.exec(html)![1];
    const [first, second] = topic.split('data-concept-row="true"').slice(1);
    expect(first).toContain('>Logaritmos</span>');
    expect(first).toContain('>Añadir a mi plan</button>'); // sibling still visible and actionable
    expect(second).toContain('>Sucesiones y series</span>');
    expect(second).toContain('>Añadido</span>');
    expect(second).toContain('>Abrir</a>');
    expect(second).not.toContain('Añadir a mi plan');

    // Pure helpers.
    expect(toggleOpenTopic([], 'a', true)).toEqual(['a']);
    expect(toggleOpenTopic(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleOpenTopic(['a', 'b'], 'a', true)).toEqual(['b', 'a']);
    expect(toggleOpenTopic(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(openTopicsStorageKey('sub1')).toBe('studyus.learn.openTopics:sub1'); // per subject
    expect(parseOpenTopics('["lo:lo-a","gone"]', ['lo:lo-a', 'lo:lo-b'])).toEqual(['lo:lo-a']);
    for (const bad of [null, '', 'not json', '{"a":1}', '[1,2]']) expect(parseOpenTopics(bad, ['lo:lo-a'])).toEqual([]);

    // Wiring: controlled <details>, opened explicitly on a successful add, refresh in place (no navigation).
    const ui = code('src/app/dashboard/learn/CurriculumTopics.tsx');
    expect(ui).toMatch(/open=\{open\.includes\(topic\.key\)\}/);
    expect(ui).toMatch(/onToggle=\{\(e\) => setTopicOpen\(topic\.key, \(e\.currentTarget as HTMLDetailsElement\)\.open\)\}/);
    expect(ui).toMatch(/onAdded=\{\(\) => setTopicOpen\(topic\.key, true\)\}/);
    expect(ui).toMatch(/window\.sessionStorage\.setItem\(storageKey, JSON\.stringify\(next\)\)/);
    expect(ui.match(/try \{/g)!.length).toBeGreaterThanOrEqual(2); // storage is optional: every access is guarded
    const button = code('src/app/dashboard/plan/PlanActions.tsx');
    expect(button).toMatch(/setDone\(true\);\s+onAdded\?\.\(\);\s+router\.refresh\(\);/);
    const add = button.slice(button.indexOf('export function AddToPlanButton'), button.indexOf('export function ArchiveToggle'));
    expect(add).not.toMatch(/router\.push|location\.|scrollTo/); // context and scroll are not reset
  });
});

describe('UI polish M05b. recommended subject row layout', () => {
  it('the subject name is the flexible column and wraps by words; badge and arrow keep their width', () => {
    const css = read('src/app/globals.css');
    const rules = (sel: string) => [...css.matchAll(new RegExp(`(?:^|\\n)${sel.replace(/[.\[\]>-]/g, '\\$&')} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(' ');
    expect(rules('.sp-option')).toMatch(/grid-template-columns: minmax\(0, 1fr\) auto/);
    const name = rules('.sp-option-name');
    expect(name).toMatch(/grid-column: 1/);
    expect(name).toMatch(/min-width: 0/);
    expect(name).toMatch(/overflow-wrap: break-word/);
    expect(name).toMatch(/word-break: normal/);
    expect(name).not.toMatch(/anywhere|break-all/); // never character-by-character ("Informática")
    expect(rules('.sp-option-go')).toMatch(/grid-column: 2/); // the arrow stays aligned right
    const badge = rules('.sp-option > .sp-badge');
    expect(badge).toMatch(/grid-row: 2/); // provenance sits under the subject, natural width
    expect(badge).toMatch(/justify-self: start/);
    // One shared row for every recommendation and every locale; the whole row is the control.
    const ui = code('src/app/dashboard/subjects/SubjectPicker.tsx');
    expect(ui.match(/className="sp-option"/g)!.length).toBeGreaterThanOrEqual(2);
    expect(ui).toMatch(/<button type="button" className="sp-option" onClick=\{\(\) => choose\(key\)\}/);
    expect(ui).toMatch(/<span className="sp-option-name">\{label \?\? name\(key\)\}<\/span>\s+\{badge && <span id=\{`sp-b-\$\{key\}`\} className="sp-badge">\{badge\}<\/span>\}/);
    expect(ui).toMatch(/<ul className="sp-grid" data-for-you>/);
  });
});

describe('UI polish M03b / M03c. remaining catalogue labels', () => {
  it('Spanish paper qualifiers and English group names use the catalogue labels; IDs and codes untouched', () => {
    expect(localizeIbComponentLabel('Paper 3 (GDC, problem solving)', 'es')).toBe('Prueba 3 (con calculadora gráfica, resolución de problemas)');
    expect(localizeIbComponentLabel('Paper 3 (GDC, investigation)', 'es')).toBe('Prueba 3 (con calculadora gráfica, investigación)');
    expect(localizeIbComponentLabel('Paper 2 (calculator)', 'es')).toBe('Prueba 2 (con calculadora)');
    expect(localizeIbComponentLabel('Paper 1 (no calculator)', 'es')).toBe('Prueba 1 (sin calculadora)');
    expect(localizeIbComponentLabel('Paper 9 (GDC, unknown thing)', 'es')).toBe('Prueba 9 (con calculadora gráfica, unknown thing)'); // unknown term kept as stored
    expect(localizeIbComponentLabel('Paper 3 (GDC, problem solving)', 'en')).toBe('Paper 3 (GDC, problem solving)');

    const cs = objectiveByKey('cie.asal.9618.as')!;
    const stored = JSON.stringify(cs.context);
    expect(presentObjective(cs, 'en').groups).toEqual(['Group 1: Mathematics and Sciences']);
    expect(presentObjective(cs, 'es').groups).toEqual(['Group 1: Matemáticas y Ciencias']);
    expect(JSON.stringify(cs.context)).toBe(stored); // what a preparation stores is not changed
    expect(cs.context.syllabusCode).toBe('9618');
    expect(cs.key).toBe('cie.asal.9618.as');
    // A syllabus listed in several groups keeps every group, in both languages, in the same order.
    const multi = examObjectives().find((o) => o.context.groups.length > 1)!;
    expect(multi.groupNames).toHaveLength(multi.context.groups.length);
    expect(presentObjective(multi, 'es').groups).toEqual(multi.context.groups);
    expect(presentObjective(multi, 'en').groups.every((g) => !/Matemáticas|Idiomas|Artes y|Interdisciplinario|obligatorio/.test(g))).toBe(true);
    // No English group name is left in Spanish anywhere in the catalogue, and IB groups are bilingual too.
    for (const o of examObjectives()) for (const g of presentObjective(o, 'en').groups) expect(g, o.key).not.toMatch(/^Grupo |Matemáticas y Ciencias|Idiomas$/);
    expect(presentObjective(objectiveByKey('ib.dp.physics.hl')!, 'es').groups[0]).toMatch(/^Grupo 4/);
    expect(presentObjective(objectiveByKey('ib.dp.physics.hl')!, 'en').groups[0]).toMatch(/^Group 4/);
    // AICE Diploma parts carry both names.
    const aice = objectiveByKey('cie.aice.diploma')!;
    expect(aice.catalogParts.find((p) => p.key.endsWith('.g1'))).toMatchObject({ label: 'Group 1: Matemáticas y Ciencias', labelEn: 'Group 1: Mathematics and Sciences' });
    // Used on the picker rows and the preparation page.
    expect(code('src/lib/exam-core/objectives/picker.ts')).toMatch(/groupNames: shown\.groups/);
    expect(code('src/app/dashboard/exam-prep/ObjectivePicker.tsx')).toMatch(/\(o\.groupNames \?\? o\.context\.groups\)\.join\(' \/ '\)/);
    const home = code('src/app/dashboard/exam-prep/[examProfileId]/PreparationHome.tsx');
    expect(home).toMatch(/\(display\.groups \?\? objective\.context\.groups\)\.join\(' \/ '\)/);
    expect(home).toMatch(/comp\(language === 'es' \? p\.label : p\.labelEn \?\? p\.label\)/);
  });
});

describe('UI polish M06. an active preparation never shows an add-eligible badge', () => {
  it('the badge comes from the actual preparation state', () => {
    expect(preparationBadgeKey('canAdd', true)).toBe('inPreparation');
    expect(preparationBadgeKey('canAdd', false)).toBe('canAdd');
    for (const s of ['structure', 'bankInProgress', 'practice', 'reducedMock', 'fullMock', 'plan']) expect(preparationBadgeKey(s, true)).toBe(s); // real capabilities are kept
    expect(preparationBadgeLabelKey('inPreparation')).toBe('acp.prep.status.inPreparation');
    expect(preparationBadgeLabelKey('practice')).toBe('prep.status.practice');
    expect([msgs('es')['acp.prep.status.inPreparation'], msgs('en')['acp.prep.status.inPreparation']]).toEqual(['En tu preparación', 'In your preparation']);
    // The catalogue-only case of the smoke: Cambridge Computer Science 9618.
    const noCapabilities = { canPlanDiploma: false, canRunFullMock: false, canRunReducedMock: false, canPractice: false, canViewStructure: false, unavailableReasons: [] };
    expect(objectiveStatusKey(noCapabilities as any)).toBe('canAdd');

    const labels = Object.fromEntries(Object.entries(msgs('en')).filter(([k]) => k.startsWith('prep.') || k.startsWith('acp.prep.')));
    const cs = objectiveByKey('cie.asal.9618.as')!;
    const shown = presentObjective(cs, 'en');
    const rowFor = (preparationId: string | null): PickerObjective => ({ key: cs.key, framework: cs.framework, kind: cs.kind, label: shown.label, context: cs.context, status: 'canAdd', preparationId, searchText: '9618 computer science', groupKey: shown.groupKey, groupLabel: shown.groupLabel });
    const frameworks = OBJECTIVE_FRAMEWORKS.map((f) => ({ ...f, family: familyOfFramework(f.key) }));
    const render = (preparationId: string | null) => renderToStaticMarkup(createElement(ObjectivePicker, { objectives: [rowFor(preparationId)], frameworks, suggested: [], labels, initial: { framework: 'CIE_AS_A' } }));
    const active = render('prep-1');
    expect(active).toContain(labels['prep.cta.view']); // "View my preparation"
    expect(active).toContain('data-prep-badge="inPreparation"');
    expect(active).toContain('>In your preparation</span>');
    expect(active).not.toContain(labels['prep.status.canAdd']); // never "You can add it to your preparation"
    const notYet = render(null);
    expect(notYet).toContain(labels['prep.status.canAdd']);
    expect(notYet).not.toContain('In your preparation');
    // "My preparations" lists only existing preparations: its badge always takes the in-preparation branch.
    const page = code('src/app/dashboard/exam-prep/page.tsx');
    expect(page).toMatch(/preparationBadgeKey\(objectiveStatusKey\(capabilities\), true\)/);
    expect(page).not.toMatch(/tr\[`prep\.status\.\$\{objectiveStatusKey\(capabilities\)\}`\]/);
    // Display only: no write is involved.
    expect(code('src/lib/exam-core/objectives/capabilities.ts')).not.toMatch(/db\.query|\bUPDATE\b|\bINSERT\b/);
  });
});

// ================================================================== T1 FINAL LOCALIZATION RESIDUAL (M03d)

describe('M03d. Cambridge assessment structure and requirement statements', () => {
  /** Every component name the loaded Cambridge preparations use as a plan area (DEV catalogue, 2026-10). */
  const COMPONENTS = [
    'Paper 1 — Pure Mathematics 1', 'Paper 2 — Pure Mathematics 2', 'Paper 3 — Pure Mathematics 3', 'Paper 4 — Mechanics', 'Paper 5 — Probability & Statistics 1', 'Paper 6 — Probability & Statistics 2',
    'Paper 1 — Multiple Choice', 'Paper 2 — AS Level Structured Questions', 'Paper 3 — Advanced Practical Skills', 'Paper 4 — A Level Structured Questions', 'Paper 5 — Planning, Analysis and Evaluation',
    'Paper 1 — AS Level Multiple Choice', 'Paper 2 — AS Level Data Response and Essays', 'Paper 3 — A Level Multiple Choice', 'Paper 4 — A Level Data Response and Essays',
    'Paper 1 — Reading', 'Paper 2 — Writing', 'Paper 3 — Language Analysis', 'Paper 4 — Language Topics',
    'Paper 1 — Written Exam', 'Component 2 — Essay', 'Component 3 — Team Project', 'Component 4 — Cambridge Research Report',
    'Paper 2 (Extended, non-calculator)', 'Paper 4 (Extended, calculator)', 'Paper 1 (Core, non-calculator)', 'Paper 3 (Core, calculator)',
  ];

  it('Spanish shows the reviewed display label; English keeps the stored one; the manual examples', () => {
    const es = (label: string) => localizeComponentLabel('CIE_AS_A', label, 'es');
    expect(es('Paper 1 — Pure Mathematics 1')).toBe('Prueba 1 — Matemáticas Puras 1');
    expect(es('Paper 4 — Mechanics')).toBe('Prueba 4 — Mecánica');
    expect(es('Paper 5 — Probability & Statistics 1')).toBe('Prueba 5 — Probabilidad y Estadística 1');
    expect(es('Component 3 — Team Project')).toBe('Componente 3 — Proyecto en equipo');
    expect(localizeComponentLabel('CIE_IGCSE', 'Paper 2 (Extended, non-calculator)', 'es')).toBe('Prueba 2 (Extended, sin calculadora)'); // tier name kept
    expect(learningObjectiveLabel('aice.9709.p1.differentiation', 'es')).toBe('Puras 1 · Derivación (puntos estacionarios y su naturaleza).');
    expect(learningObjectiveLabel('aice.9709.p1.integration', 'es')).toBe('Puras 1 · Integración (integrales definidas, áreas).');
    expect(learningObjectiveLabel('aice.9709.p4.energy', 'es')).toBe('Mecánica · Energía, trabajo y potencia.');
    expect(learningObjectiveLabel('aice.9709.p5.normal', 'es')).toBe('Probabilidad y Estadística 1 · La distribución normal.');
    // Every component the loaded Cambridge preparations use is covered -- and English is always the stored value.
    for (const c of COMPONENTS) {
      expect(hasCambridgeComponentLabel(c), c).toBe(true);
      expect(localizeCambridgeComponentLabel(c, 'es'), c).toMatch(/^(Prueba|Componente) \d/);
      expect(localizeCambridgeComponentLabel(c, 'en')).toBe(c);
      for (const other of ['de', 'fr', 'pt']) expect(localizeCambridgeComponentLabel(c, other)).toBe(c);
    }
    // Statements: no code resolves outside Spanish (the stored English statement is shown).
    for (const code of localizedObjectiveCodes()) {
      expect(learningObjectiveLabel(code, 'en'), code).toBeNull();
      expect(learningObjectiveLabel(code, 'es'), code).toBeTruthy();
    }
    // Coverage of the loaded Cambridge syllabuses (statement codes are stable identifiers).
    const cambridge = localizedObjectiveCodes().filter((c) => c.startsWith('aice.') || c.startsWith('cie.'));
    expect(cambridge.length).toBeGreaterThanOrEqual(86);
    for (const syllabus of ['9709', '9702', '9701', '9700', '9708', '9093', '9239']) expect(cambridge.some((c) => c.startsWith(`aice.${syllabus}.`)), syllabus).toBe(true);
    // Reviewed labels never leave an English statement behind.
    for (const code of cambridge) expect(learningObjectiveLabel(code, 'es')!, code).not.toMatch(/\b(and|the|of|with|Section|Paper|Pure)\b/);
  });

  it('no label -> the stored value, whole and unchanged; codes, qualification names and IDs are untouched', () => {
    // A component that has no reviewed label (a catalogue-only syllabus) is not half-translated.
    expect(localizeComponentLabel('CIE_AS_A', 'Paper 1 — Theory Fundamentals', 'es')).toBe('Paper 1 — Theory Fundamentals');
    expect(localizeComponentLabel('CIE_AS_A', 'Paper 9 (Extended, something new)', 'es')).toBe('Paper 9 (Extended, something new)');
    expect(localizeComponentLabel('CIE_AS_A', 'Coursework portfolio', 'es')).toBe('Coursework portfolio');
    expect(learningObjectiveLabel('aice.9999.p1.unknown', 'es')).toBeNull();
    expect(localizeComponentLabel('PAA', 'Paper 1 — Mechanics', 'es')).toBe('Paper 1 — Mechanics'); // only the awarding body's own vocabulary
    expect(localizeComponentLabel(null, 'Paper 1 — Mechanics', 'es')).toBe('Paper 1 — Mechanics');
    // Official names stay official in the Spanish labels themselves.
    expect(localizeCambridgeComponentLabel('Paper 2 — AS Level Structured Questions', 'es')).toBe('Prueba 2 — Preguntas estructuradas de AS Level');
    expect(localizeCambridgeComponentLabel('Paper 4 — A Level Structured Questions', 'es')).toContain('A Level');
    const maths = objectiveByKey('cie.asal.9709.as')!;
    const before = JSON.stringify(maths);
    for (const locale of ['es', 'en']) {
      expect(presentObjective(maths, locale).label).toBe('Mathematics (9709) · AS Level'); // syllabus title, code and level
      expect(msgs(locale)['prep.fw.CIE_AS_A']).toBe('Cambridge International AS & A Level');
    }
    expect(JSON.stringify(maths)).toBe(before);
    expect(maths.catalogParts.find((p) => p.label.includes('Pure Mathematics 1'))!.label).toBe('Paper 1 — Pure Mathematics 1'); // catalogue data itself unchanged
    // Catalogue data only: no runtime translation, no I/O.
    for (const f of ['src/lib/exam-core/catalog/cambridge-localization.ts', 'src/lib/exam-core/catalog/objective-localization.ts']) expect(code(f)).not.toMatch(/translate\(|openai|anthropic|generateText|fetch\(|db\.query/i);
  });

  it('one display path for IB and Cambridge, on the preparation page and in Learn', () => {
    // The same function serves both bodies (by framework or by programme name).
    expect(localizeComponentLabel('IB_DP', 'Paper 3 (GDC, problem solving)', 'es')).toBe('Prueba 3 (con calculadora gráfica, resolución de problemas)');
    expect(localizeComponentLabel('IB Diploma Programme', 'Paper 1 (no calculator)', 'es')).toBe('Prueba 1 (sin calculadora)');
    expect(localizeComponentLabel('Cambridge Advanced', 'Paper 4 — Mechanics', 'es')).toBe('Prueba 4 — Mecánica');
    expect(localizeComponentLabel('Cambridge IGCSE', 'Paper 4 (Extended, calculator)', 'es')).toBe('Prueba 4 (Extended, con calculadora)');
    expect(localizeComponentLabel('CIE_AICE', 'Paper 1 — Written Exam', 'es')).toBe('Prueba 1 — Examen escrito');
    const home = code('src/app/dashboard/exam-prep/[examProfileId]/PreparationHome.tsx');
    expect(home).toMatch(/const comp = \(label: string \| null \| undefined\) => localizeComponentLabel\(objective\.framework, label, language\);/);
    expect(home).not.toMatch(/localizeIbComponentLabel/); // no body-specific branch left on the page
    expect(code('src/lib/learning-plan/subject-curriculum-topics.ts')).not.toMatch(/localizeIbComponentLabel/);
    // Requirement statements go through the one statement path for every body (plan + Learn topics).
    expect(code('src/lib/exam-core/objectives/preparation.service.ts')).toMatch(/description: learningObjectiveLabel\(r\.code, language\) \?\? r\.description/);
    expect(code('src/lib/learning-plan/subject-curriculum-topics.ts')).toMatch(/learningObjectiveLabel\(r\.objectiveCode, locale\) \?\? clean\(r\.objectiveDescription\)/);

    // Re-checks from the previous round.
    expect(localizeIbComponentLabel('Paper 3 (GDC, problem solving)', 'es')).toBe('Prueba 3 (con calculadora gráfica, resolución de problemas)');
    expect(presentObjective(objectiveByKey('cie.asal.9618.as')!, 'en').groups).toEqual(['Group 1: Mathematics and Sciences']);
    expect(presentObjective(objectiveByKey('cie.asal.9709.as')!, 'en').groups).toEqual(['Group 1: Mathematics and Sciences']);
  });
});
