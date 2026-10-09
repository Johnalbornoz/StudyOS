/**
 * UX-5 closure -- first-run, simplified Student IA, subject switching.
 *
 *   A. Controlled subject list + profile-based suggestions (only existing
 *      profile / exam-objective / owned-subject facts; nothing inferred).
 *   B. Concept discovery resolves to EXISTING concepts first; nothing is
 *      created silently.
 *   C. First-run and "Agregar materia" select from the list (no free text).
 *   D. Aprender: one place, the SAME authorities (no second engine).
 *   E. Subject switcher on Inicio / Aprender / Progreso; Progreso -> action.
 *   F. Localization.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SUBJECT_CATALOG,
  catalogSubject,
  catalogSubjectByName,
  normalizeName,
  suggestSubjects,
} from '@/lib/experience/subject-catalog';
import { matchConcepts, isSameConcept, tokens, type FinderConcept } from '@/lib/experience/concept-finder';
import { IB_SUBJECT_GROUPS } from '@/lib/ib';
import { getMessages, LOCALES } from '@/lib/i18n/messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const DP2 = { curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP2', schoolYear: null };
const MYP1 = { curriculumType: 'ib', ibProgramme: 'MYP', ibYear: 'MYP 1', schoolYear: null };

describe('A. controlled subject list and profile-based suggestions', () => {
  it('every catalog subject has a name in all 5 locales and a valid IB group; keys are unique', () => {
    const groups = new Set(IB_SUBJECT_GROUPS.map((g) => g.value));
    expect(new Set(SUBJECT_CATALOG.map((e) => e.key)).size).toBe(SUBJECT_CATALOG.length);
    for (const e of SUBJECT_CATALOG) {
      for (const l of LOCALES) expect(e.names[l], `${e.key} ${l}`).toBeTruthy();
      expect(groups.has(e.ibGroup), e.key).toBe(true);
    }
  });

  it('name resolution is exact (accent/case-insensitive), never fuzzy', () => {
    expect(catalogSubjectByName('matematicas')?.key).toBe('mathematics');
    expect(catalogSubjectByName('Mathématiques')?.key).toBe('mathematics');
    expect(catalogSubjectByName('Mate')).toBeNull();
    expect(catalogSubjectByName('Astrología')).toBeNull();
    expect(catalogSubject('astrology')).toBeNull();
    expect(normalizeName('  Física!! ')).toBe('fisica');
  });

  it('DP profile -> one subject per core diploma group; MYP 1 -> integrated sciences', () => {
    const dp = suggestSubjects({ profile: DP2, locale: 'es', examSubjectFocus: [], ownedSubjectNames: [] }).map((s) => s.key);
    expect(dp).toEqual(['mathematics', 'language_literature', 'english', 'physics', 'chemistry', 'biology']);
    const myp = suggestSubjects({ profile: MYP1, locale: 'es', examSubjectFocus: [], ownedSubjectNames: [] }).map((s) => s.key);
    expect(myp).toContain('natural_sciences');
    expect(myp).not.toContain('physics');
  });

  it('the exam objective comes first; owned subjects are never re-suggested; unknown profile still works', () => {
    const s = suggestSubjects({ profile: DP2, locale: 'es', examSubjectFocus: ['Historia'], ownedSubjectNames: ['Matemáticas', 'MATH 1'] });
    expect(s[0]).toEqual({ key: 'history', reason: 'EXAM' });
    expect(s.map((x) => x.key)).not.toContain('mathematics');
    // unmatched focus text is ignored (never inferred)
    expect(suggestSubjects({ profile: null, locale: 'en', examSubjectFocus: ['Maestria TEC'], ownedSubjectNames: [] }).every((x) => x.reason === 'PROFILE')).toBe(true);
    // English interface: the suggested foreign language is not English
    expect(suggestSubjects({ profile: null, locale: 'en', examSubjectFocus: [], ownedSubjectNames: [] }).map((x) => x.key)).not.toContain('english');
  });
});

describe('B. concept discovery resolves to existing concepts first', () => {
  const concepts: FinderConcept[] = [
    { id: 'c1', title: 'Ecuaciones de segundo grado', topic: 'Álgebra', subjectId: 'm', subjectName: 'Matemáticas' },
    { id: 'c2', title: 'Ecuaciones lineales', topic: 'Álgebra', subjectId: 'm', subjectName: 'Matemáticas' },
    { id: 'c3', title: 'Regla de tres simple directa', topic: 'Proporcionalidad', subjectId: 'm', subjectName: 'Matemáticas' },
    { id: 'c4', title: 'Enlace covalente', topic: 'Enlaces', subjectId: 'q', subjectName: 'Química' },
  ];
  it('natural language finds the existing concept (accents, stopwords, stems ignored)', () => {
    expect(matchConcepts('ecuaciones de segundo grado', concepts, 'm')[0].id).toBe('c1');
    expect(matchConcepts('regla de 3 directa', concepts, 'm')[0].id).toBe('c3');
    expect(matchConcepts('proporcionalidad', concepts, 'm').map((c) => c.id)).toEqual(['c3']); // via its topic
    expect(matchConcepts('ENLACES', concepts, 'm').map((c) => c.id)).toEqual(['c4']); // other subject still found
    expect(matchConcepts('de la', concepts, 'm')).toEqual([]);
    expect(tokens('de la y')).toEqual([]);
  });
  it('an AI proposal equal to an existing concept is never offered as new', () => {
    expect(isSameConcept('Ecuaciones de Segundo Grado', 'ecuaciones de segundo grado')).toBe(true);
    const ui = read('src/app/dashboard/learn/ConceptFinder.tsx');
    expect(ui).toMatch(/!concepts\.some\(\(c\) => isSameConcept\(c\.title, p\)\)/);
  });
  it('creation is an explicit, labelled Student action through the existing endpoint -- never automatic', () => {
    const ui = strip(read('src/app/dashboard/learn/ConceptFinder.tsx'));
    expect(ui.match(/fetch\('\/api\/concepts\/create'/g)).toHaveLength(1);
    expect(ui).toMatch(/onClick=\{\(\) => add\(p\)\}/);
    expect(ui).toMatch(/t\['cf\.addTo'\]/);
    // proposals only after nothing existing fits
    expect(ui).toMatch(/const wantsProposals = q\.trim\(\)\.length >= 3 && matches\.length < 2;/);
  });
});

describe('C. first-run and "Agregar materia" select from the list', () => {
  // REM-T1-05: the "Learn a subject" journey has its OWN step ("Choose what you want to learn"), reached from the
  // journey choice -- still profile suggestions, no tour, no free text.
  it('onboarding asks "¿Qué quieres aprender?" with profile suggestions -- no tour, no free text', () => {
    const choice = read('src/app/dashboard/onboarding/page.tsx');
    expect(choice).toMatch(/href=\{ONBOARDING_LEARN_PATH\}/);
    expect(choice).not.toMatch(/<SubjectPicker/);
    const src = read('src/app/dashboard/onboarding/learn/page.tsx');
    expect(src).toMatch(/<PageIntro title=\{tr\['acp\.onboarding\.learnTitle'\]\}/);
    expect(src).toMatch(/<SubjectPicker/);
    expect(src).toMatch(/loadSubjectPickerData\(studentId, locale\)/);
    expect(src).not.toMatch(/onboarding2\.whatTitle/);
  });
  it('the picker posts a catalog key only and continues into Aprender for that subject', () => {
    const ui = strip(read('src/app/dashboard/subjects/SubjectPicker.tsx'));
    expect(ui).toMatch(/body: JSON\.stringify\(\{ catalogKey: key, ibLevel: ibLevel \?\? null \}\)/);
    expect(ui).toMatch(/router\.push\(`\/dashboard\/learn\?subjectId=\$\{body\.subjectId\}`\)/);
    expect(ui).not.toMatch(/<input[^>]*name="subjectName"/);
    expect(read('src/app/dashboard/subjects/new/page.tsx')).toMatch(/<SubjectPicker/);
  });
  it('suggestions read only existing profile / exam / owned-subject data', () => {
    const src = strip(read('src/lib/experience/subject-picker.server.ts'));
    expect(src).toMatch(/getAcademicProfile\(studentId\)/);
    expect(src).toMatch(/listStudentExamProfiles\(studentId\)/);
    expect(src).toMatch(/FROM subjects WHERE student_id = \$1/);
    expect(src).not.toMatch(/INSERT|UPDATE|DELETE/);
  });
});

describe('D. Aprender -- one place, the same authorities', () => {
  const src = read('src/app/dashboard/learn/page.tsx');
  const code = strip(src);
  it('reads the same assembly as Mi ruta / Tu conocimiento and the same next-challenge presenter', () => {
    expect(code).toMatch(/loadMyPathContext\(studentId, locale\)/);
    expect(code).toMatch(/buildSubjectPathView\(context, selected\.id, selected\.name\)/);
    expect(code).toMatch(/loadConceptNextChallenge\(\{/);
    expect(code).toMatch(/<NextChallengeCard/);
    expect(code).toMatch(/knowledgeStateOf\(c\.journey, workedOn\(c\)\)/);
  });
  it('a subjectId from the URL is honoured only for the Student’s own subjects', () => {
    expect(code).toMatch(/subjects\.find\(\(s\) => s\.id === requested\)/);
  });
  it('the hero is the engine’s own first decision for the subject -- never a new pick', () => {
    expect(code).toMatch(/focusDecision\?\.subjectId === selected\.id \? focusDecision : null/);
    expect(code).toMatch(/snapshot\?\.dailyPlan\.items\.find\(\(i\) => i\.decision\.subjectId === selected\.id\)\?\.decision/);
    expect(code).not.toMatch(/sort\(|Math\.random|mastery_score|INSERT|UPDATE/);
  });
  it('an empty subject asks the first question; Mi ruta and Tu conocimiento stay linked as detail views', () => {
    expect(code).toMatch(/concepts\.length === 0 \?/);
    expect(code).toMatch(/t\['ln\.startTitle'\]/);
    expect(code).toMatch(/href=\{`\/dashboard\/path\/\$\{selected\.id\}`\}/);
    expect(src).toMatch(/href="\/dashboard\/knowledge"/);
  });
});

describe('E. subject switching and progress -> action', () => {
  it('the switcher is on Inicio, Aprender and Progreso and lands on that subject in Aprender', () => {
    for (const f of ['src/app/dashboard/today/page.tsx', 'src/app/dashboard/learn/page.tsx', 'src/app/dashboard/page.tsx']) {
      expect(read(f), f).toMatch(/<SubjectSwitcher/);
    }
    const sw = read('src/app/dashboard/SubjectSwitcher.tsx');
    expect(sw).toMatch(/hrefFor = \(id\) => `\/dashboard\/learn\?subjectId=\$\{id\}`/);
    expect(sw).toMatch(/href="\/dashboard\/subjects\/new"/);
  });
  it('Progreso attention items go straight to the concept (its canonical Start is one more tap)', () => {
    const src = read('src/app/dashboard/page.tsx');
    expect(src).toMatch(/<Link href=\{`\/dashboard\/subjects\/\$\{item\.subjectId\}\/concepts\/\$\{item\.conceptId\}`\}>[\s\S]*?t\['pg\.workOnIt'\]/);
  });
  it('a Student with a subject but no concept yet is sent on to choose one (never a dead end, no onboarding repeat)', () => {
    const src = read('src/app/dashboard/today/page.tsx');
    expect(src).toMatch(/isEmpty && noConceptYet &&/);
    expect(src).toMatch(/href=\{`\/dashboard\/learn\?subjectId=\$\{mySubjects!\[0\]\.id\}`\}/);
  });
});

describe('F. localization', () => {
  it('every new key exists in all 5 locales', () => {
    const keys = [
      'sp.title', 'sp.addTitle', 'sp.lead', 'sp.forYou', 'sp.forYouProfile', 'sp.examBadge', 'sp.yours', 'sp.all', 'sp.search',
      'sp.searchPlaceholder', 'sp.noMatch', 'sp.levelTitle', 'sp.levelHL', 'sp.levelSL', 'sp.cancel', 'sp.adding', 'sp.error',
      'cf.label', 'cf.placeholder', 'cf.hint', 'cf.existing', 'cf.proposals', 'cf.searching', 'cf.noProposals', 'cf.addTo', 'cf.adding', 'cf.error',
      'ss.label', 'ss.placeholder', 'ss.add', 'ln.title', 'ln.lead', 'ln.startTitle', 'ln.startBody', 'ln.quietTitle', 'ln.quietBody',
      'ln.findTitle', 'ln.topicsTitle', 'ln.pathLink', 'ln.next', 'nav.home', 'nav.learn', 'pg.workOnIt', 'xp.firstTopicBody', 'xp.firstTopicCta',
    ];
    for (const l of LOCALES) {
      const m = getMessages(l) as Record<string, string>;
      for (const k of keys) expect(m[k], `${l} ${k}`).toBeTruthy();
    }
  });
});
