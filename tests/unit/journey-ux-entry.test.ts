/**
 * Student Exam Journey V2 -- entry UX (J1.3 / J1.4 / J3.3 / J3.4 / J3.5).
 * Scenarios 1-12 of the phase brief, the schedule API, the flag gating, the copy in all
 * five locales and the "no technical enum / no percentage" rendering rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  gate: vi.fn(),
  loadRow: vi.fn(),
  columns: vi.fn(),
  updateDetails: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: unknown }) => createElement('a', { href, ...rest }, children as never) }));
vi.mock('@/lib/db', () => ({ db: { query: h.dbQuery } }));
vi.mock('@/lib/ai/request-metrics', () => ({ withAiRequestMetrics: (_n: string, fn: unknown) => fn }));
vi.mock('@/app/api/exam-preparation/route-helpers', () => ({ studentGate: h.gate, preparationErrorResponse: () => new Response(null, { status: 500 }) }));
vi.mock('@/lib/exam-journey/ux.server', () => ({ loadExamTargetRow: h.loadRow, scheduleColumnsAvailable: h.columns }));
vi.mock('@/lib/exam-core/objectives/preparation.service', () => ({ updatePreparationDetails: h.updateDetails }));

import { resolveInstitutionalAcademicContext, summariseInstitutionalContext, type InstitutionalEnrollmentFact, type InstitutionalContextFacts } from '@/lib/exam-journey/institutional-context';
import { resolveStudentExamJourney } from '@/lib/exam-journey/resolver';
import { resolveTargetSchedule, type TargetScheduleFacts } from '@/lib/exam-journey/exam-target';
import type { LearnerFacts, StudentExamJourneyFacts, StudentExamJourneyResolution } from '@/lib/exam-journey/types';
import {
  ALL_NEXT_ACTION_KINDS,
  examPrepIsPrimary,
  formatScheduleValue,
  isActivePreparation,
  mocksVisible,
  predictionVisible,
  presentNextAction,
  studentBlockerKeys,
  targetScheduleLines,
} from '@/lib/exam-journey/ux';
import { studentJourneyV2Mode, isStudentJourneyShadowEnabled, isStudentJourneyUxEnabled } from '@/lib/exam-journey/feature-flag';
import { discoverExamSuggestions, discoveryCountries } from '@/lib/exam-journey/discovery';
import { examObjectives } from '@/lib/exam-core/objectives/objective-catalog';
import { JOURNEY_MESSAGES } from '@/lib/i18n/journey-messages';
import { getMessages, LOCALES } from '@/lib/i18n/messages';
import { buildLearnerNav } from '@/lib/lx/learner-navigation';
import { decideStudentOnboardingGate, studentOnboardingStage, type GateState } from '@/lib/student/onboarding-gate';
import { resolveFirstDestination, onboardingRouteRedirect } from '@/lib/lx/first-destination';
import { InstitutionalContextCard, EntryChoice } from '@/app/dashboard/profile/InstitutionalContextCard';
import { ExamTargetOverview, ScheduleSummary, parseOverviewTab, type ExamTargetOverviewProps } from '@/app/dashboard/exam-prep/journey/ExamTargetOverview';
import { PATCH as schedulePATCH } from '@/app/api/exam-preparation/[id]/schedule/route';

const ROOT = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf-8');
const ES = getMessages('es') as Record<string, string>;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
/** Raw enum names (BLUEPRINT_INCOMPLETE, EXAM_ONLY_PROFILE, ...) never reach the Student. */
const ENUM_LEAK = /\b[A-Z]{2,}_[A-Z_]{3,}\b/;
const textOf = (markup: string) => markup.replace(/<[^>]+>/g, ' ');

// ------------------------------------------------------------------ fixtures
const IB = { id: 'prog-ib-dp', label: 'IB Diploma Programme' };
const enrollment = (over: Partial<InstitutionalEnrollmentFact> = {}): InstitutionalEnrollmentFact => ({
  enrollmentStatus: 'ACTIVE',
  institution: { id: 'inst-1', name: 'Colegio Andino', country: 'CO' },
  class: { id: 'class-math', name: 'Math AA HL', period: null },
  grade: { id: 'grade-dp1', name: 'DP Year 1', academicLevel: 'DP1', academicYear: '2026-2027', programme: IB },
  classSubject: { canonicalSubjectId: 'cs-math', label: 'Matemáticas' },
  curriculum: { id: 'cur-math', sourceType: 'INTERNATIONAL_PROGRAMME', academicYear: '2026-2027', structureVersionId: 'sv-1', programme: IB, academicSubject: { id: 'as-math-aa-hl', label: 'Mathematics AA', level: 'HL' }, levelOptionsExist: true },
  ...over,
});
const ctxFacts = (enrollments: InstitutionalEnrollmentFact[], student: InstitutionalContextFacts['student'] = null): InstitutionalContextFacts => ({ enrollments, student });
const UNMAPPED = enrollment({
  grade: { id: 'grade-11', name: 'Grado 11', academicLevel: null, academicYear: null, programme: null },
  curriculum: { id: 'cur-lp', sourceType: 'INSTITUTION_DEFINED', academicYear: null, structureVersionId: null, programme: null, academicSubject: null, levelOptionsExist: false },
});

function journeyFacts(learner: Partial<LearnerFacts> = {}, target: Partial<NonNullable<StudentExamJourneyFacts['target']>> = {}, over: Partial<StudentExamJourneyFacts> = {}): StudentExamJourneyFacts {
  return {
    asOf: '2026-10-05',
    learner: { academicProfile: null, institution: { activeEnrollments: 0, classProgrammes: [], assignedObjectiveKeys: [] }, subjectCount: 0, examTargetCount: 1, ...learner },
    target: { examTargetId: 't-1', objectiveKey: 'paa', framework: 'PAA', objectiveKind: 'EXAM', examDefinitionId: null, level: null, examDate: null, sessionCode: null, status: 'ACTIVE', source: 'STUDENT', confirmation: 'CONFIRMED', satConfirmed: false, optedInEarly: false, previousResult: null, actualResult: null, ...target },
    blueprint: { readiness: 'REDUCED_MOCK_READY', structureVisible: true, publishedVersion: true, versionValidity: 'UNVERIFIED', programmePlan: false, institutionalRelease: 'NOT_APPLICABLE' },
    content: { practice: true, diagnostic: true, reducedMock: true, fullMock: false, learningBridge: true, unavailable: [], reducedMockLengthCoveragePercent: 21 },
    learning: null,
    exam: { instances: [], openAttempt: false },
    prediction: { modelClass: 'NO_MODEL', components: [], estimates: [] },
    ...over,
  };
}
const NO_CONTENT: StudentExamJourneyFacts['content'] = {
  practice: false, diagnostic: false, reducedMock: false, fullMock: false, learningBridge: true,
  unavailable: [{ capability: 'PRACTICE', reason: 'BANK_IN_PROGRESS' }, { capability: 'DIAGNOSTIC', reason: 'BANK_IN_PROGRESS' }, { capability: 'REDUCED_MOCK', reason: 'BANK_IN_PROGRESS' }],
  reducedMockLengthCoveragePercent: null,
};
const noSchedule: TargetScheduleFacts = { officialSession: null, authoritativeExamDate: null, studentReportedExamDate: null, personalTargetDate: null, estimatedMonth: null };

const entry = (over: Record<string, unknown> = {}) => ({ nodeKey: 'paa.math', label: 'Matemáticas', purpose: 'AREA', modes: ['PRACTICE'], state: 'PRACTICE_READY', lengthCoveragePercent: null, ...over });
function view(over: { practice?: boolean; reduced?: boolean; plan?: unknown } = {}) {
  return {
    profile: { id: 't-1', examDate: null },
    objective: { key: 'paa', label: 'PAA', framework: 'PAA', description: null, catalogParts: [], context: { level: null, version: null, programme: null, groups: [], subject: null, syllabusCode: null } },
    capabilities: {
      canRunDiagnostic: over.practice !== false,
      practiceModes: over.practice === false ? [] : [entry()],
      reducedMocks: over.reduced === false ? [] : [entry({ nodeKey: 'paa.mock', label: 'PAA', purpose: 'FULL_TEST', lengthCoveragePercent: 21 })],
      fullMocks: [],
      unavailableReasons: [],
    },
    plan: over.plan ?? null,
    next: { kind: 'DIAGNOSTIC', requirement: null },
    openAttemptId: null,
    diagnostic: null,
  } as unknown as ExamTargetOverviewProps['view'];
}
const labelsFor = (locale: string) => getMessages(locale) as Record<string, string>;
function overview(resolution: StudentExamJourneyResolution, over: Partial<ExamTargetOverviewProps> = {}, locale = 'es') {
  return html(
    createElement(ExamTargetOverview, {
      profileId: 't-1', resolution, view: view(), scheduleLines: [], newScheduleFieldsAvailable: false, tab: 'summary', attempts: [], destinationInstitution: null, labels: labelsFor(locale), locale, ...over,
    })
  );
}

beforeEach(() => {
  for (const m of Object.values(h)) m.mockReset();
  vi.unstubAllEnvs();
});

// ------------------------------------------------------------------ 1-3: J1.3 institutional path
describe('Scenario 1 -- institution complete: "Tu ruta académica" read-only', () => {
  const ctx = resolveInstitutionalAcademicContext(ctxFacts([enrollment()]));
  it('shows what the institution provided, asks nothing, no notice, no conflict', () => {
    const m = html(createElement(InstitutionalContextCard, { context: ctx, labels: ES }));
    expect(m).toContain('Tu ruta académica');
    expect(m).toContain('Colegio Andino');
    expect(m).toContain('IB Diploma Programme');
    expect(m).toContain('Matemáticas · HL');
    expect(m).not.toMatch(/<input|<select|<textarea|<form/);
    expect(m).not.toContain(ES['jx.inst.incomplete']);
    expect(m).not.toContain(ES['jx.inst.conflict.cta']);
    expect(textOf(m)).not.toMatch(ENUM_LEAK);
  });
  it('the learner is ACADEMIC_PATH_DEFINED and no academic input is required', () => {
    const r = resolveStudentExamJourney(journeyFacts({ institution: { activeEnrollments: 1, classProgrammes: [], assignedObjectiveKeys: [], context: summariseInstitutionalContext(ctx) } }, {}, { target: null }));
    expect(r.learner).toMatchObject({ state: 'ACADEMIC_PATH_DEFINED', requiresAcademicInput: false });
  });
  it('the gate never sends an institutional learner to the subject picker (UX only)', () => {
    expect(studentOnboardingStage(null, 0, 0, 1)).toBe('READY');
    const s: GateState = { accountStatus: 'ACTIVE', roles: ['STUDENT'], storedWorkspace: 'STUDENT', profile: null, subjectCount: 0, institutionalPathCount: 1, journeyUx: true };
    expect(decideStudentOnboardingGate('/dashboard/today', s)).toBeNull();
    // without the UX flag the institutional path is ignored: Student v1 unchanged
    expect(decideStudentOnboardingGate('/dashboard/today', { ...s, journeyUx: false })).toBe('/dashboard/profile');
    expect(resolveFirstDestination({ hasSubject: false, hasInstitutionalPath: true }).path).toBe('/dashboard/today');
    expect(onboardingRouteRedirect({ hasSubject: false, hasInstitutionalPath: true })).toBe('/dashboard/today');
  });
});

describe('Scenario 2 -- PROGRAMME_UNMAPPED: one neutral line, the Student is never asked to fix it', () => {
  const ctx = resolveInstitutionalAcademicContext(ctxFacts([UNMAPPED]));
  it('exact neutral copy, the programme reads "pending", no form, no code', () => {
    expect(ctx.missingInformation.map((x) => x.code)).toContain('PROGRAMME_UNMAPPED');
    const m = html(createElement(InstitutionalContextCard, { context: ctx, labels: ES }));
    expect(ES['jx.inst.incomplete']).toBe('Tu institución todavía está completando algunos datos de tu programa. Puedes seguir usando StudyUs mientras tanto.');
    expect(m).toContain(ES['jx.inst.incomplete']);
    expect(m).toContain(ES['jx.inst.unknown']);
    expect(m).not.toMatch(/<input|<select|<textarea|<form|<button/);
    expect(textOf(m)).not.toMatch(ENUM_LEAK);
  });
  it('INSTITUTION_CONTEXT_INCOMPLETE blocker copy is the approved text', () => {
    expect(ES['jx.blocker.INSTITUTION_CONTEXT_INCOMPLETE']).toBe('Tu institución todavía está completando información de tu programa.');
    expect(studentBlockerKeys({ blockers: [{ code: 'INSTITUTION_CONTEXT_INCOMPLETE', scope: 'LEARNER' } as never] })).toEqual(['jx.blocker.INSTITUTION_CONTEXT_INCOMPLETE']);
  });
});

describe('Scenario 3 -- conflict: both values shown, neither chosen, "Revisar información"', () => {
  const ctx = resolveInstitutionalAcademicContext(ctxFacts([enrollment()], { programme: IB, gradeLevel: 12, academicYear: null }));
  it('renders the institutional and the Student value side by side', () => {
    expect(ctx.status).toBe('CONFLICT');
    const m = html(createElement(InstitutionalContextCard, { context: ctx, labels: ES }));
    expect(m).toContain('Revisar información');
    expect(m).toContain(`${ES['jx.inst.conflict.institution']}: ${ES['jx.inst.gradeValue'].replace('{n}', '11')}`);
    expect(m).toContain(`${ES['jx.inst.conflict.student']}: ${ES['jx.inst.gradeValue'].replace('{n}', '12')}`);
    // nothing is resolved for the Student: the grade stays the institution's, the effective value stays empty
    expect(ctx.institutions[0].gradeYearStage.gradeLevel.effective.value).toBeNull();
    expect(m).not.toMatch(/<form|<input/);
  });
  it('the profile page never lets the Student declaration overwrite the institution (separate disclosure)', () => {
    const s = read('src/app/dashboard/profile/page.tsx');
    expect(s).toMatch(/InstitutionalContextCard context=\{context\}/);
    expect(s).toMatch(/jx\.inst\.personal\.title/);
  });
});

// ------------------------------------------------------------------ 4: independent PAA
describe('Scenario 4 -- independent PAA without subjects', () => {
  const r = resolveStudentExamJourney(journeyFacts());
  it('exam-only learner, Exam Prep reachable without subject or school profile', () => {
    expect(r.learner.state).toBe('EXAM_ONLY_PROFILE');
    expect(studentOnboardingStage(null, 0, 1)).toBe('READY');
  });
  it('Exam Prep entry is offered first; subjects are never asked first', () => {
    const m = html(createElement(EntryChoice, { labels: ES }));
    const exam = m.indexOf('/dashboard/exam-prep');
    expect(exam).toBeGreaterThan(-1);
    expect(exam).toBeLessThan(m.indexOf('entry=curriculum'));
    expect(m).not.toContain('/dashboard/subjects');
    const s: GateState = { accountStatus: 'ACTIVE', roles: ['STUDENT'], storedWorkspace: 'STUDENT', profile: null, subjectCount: 0, journeyUx: true };
    expect(decideStudentOnboardingGate('/dashboard/exam-prep/discover', s)).toBeNull();
    expect(decideStudentOnboardingGate('/dashboard/notifications', s)).toBeNull();
  });
  it('"Añadir a mi plan" (would create a subject) is never offered to an exam-only learner', () => {
    const plan = { requirements: [], recommendations: [{ learningObjectiveId: 'lo-1', description: 'Funciones', area: 'Matemáticas', status: 'NO_EVIDENCE', concepts: [{ canonicalConceptId: 'cc-1', name: 'Funciones', learner: null, label: 'NO_EVIDENCE', alsoRelevantFor: [] }], recommendation: { action: 'ADD_TO_PLAN', canonicalConceptId: 'cc-1', reasons: [] }, priority: { band: 'HIGH', factors: [] } }], counts: {}, coverage: { mapped: 1, mappedWithEvidence: 0 } };
    const m = overview(r, { tab: 'prepare', view: view({ plan }) });
    expect(m).toContain('Funciones');
    expect(m).toContain(ES['jx.prep.reinforce.addUnavailable']);
    expect(ES['prep.action.ADD_TO_PLAN']).toBeTruthy();
    expect(m).not.toContain(ES['prep.action.ADD_TO_PLAN']);
    // control: a learner whose academic path is defined keeps the existing action
    const inst = resolveStudentExamJourney(journeyFacts({ institution: { activeEnrollments: 1, classProgrammes: [], assignedObjectiveKeys: [], context: summariseInstitutionalContext(resolveInstitutionalAcademicContext(ctxFacts([enrollment()]))) } }));
    expect(inst.learner.state).toBe('ACADEMIC_PATH_DEFINED');
    const withPath = overview(inst, { tab: 'prepare', view: view({ plan }) });
    expect(withPath).toContain(ES['prep.action.ADD_TO_PLAN']);
    expect(withPath).not.toContain(ES['jx.prep.reinforce.addUnavailable']);
  });
  it('discovery suggests only governed EXAM objectives, at most three, every one TARGET_REQUIREMENT_UNCONFIRMED', () => {
    const pr = discoveryCountries().find((c) => c.value === 'PR')!;
    const s = discoverExamSuggestions({ country: 'PR', schoolYear: pr.grades[pr.grades.length - 1] }, examObjectives());
    expect(s.map((x) => x.objectiveKey)).toContain('paa');
    const co = discoverExamSuggestions({ country: 'CO', schoolYear: '11' }, examObjectives());
    for (const x of [...s, ...co]) {
      expect(examObjectives().find((o) => o.key === x.objectiveKey)?.kind).toBe('EXAM');
      expect(x.requirement).toBe('TARGET_REQUIREMENT_UNCONFIRMED');
    }
    expect(co.length).toBeLessThanOrEqual(3);
    expect(discoverExamSuggestions({ country: 'OTHER', schoolYear: null }, examObjectives())).toEqual([]);
    expect(ES['jx.requirement.unconfirmedGeneric']).toBe('Confirma con tu institución qué examen necesitas presentar.');
  });
  it('a named destination is only a "confirm with them" note, never a requirement', () => {
    const m = overview(r, { destinationInstitution: 'Universidad de Puerto Rico' });
    expect(m).toContain('Confirma con Universidad de Puerto Rico qué examen necesitas presentar.');
  });
});

// ------------------------------------------------------------------ 5-7: J3.4 dates
describe('Scenario 5 -- no date: the target stays valid, only the date step is offered', () => {
  const r = resolveStudentExamJourney(journeyFacts({}, { schedule: noSchedule }));
  it('summary asks "¿Para cuándo quieres prepararte?" and offers "Todavía no lo sé"', () => {
    expect(r.examTargetId).toBe('t-1');
    expect(r.schedule?.targetDateSource).toBe('UNKNOWN');
    const m = overview(r);
    expect(m).toContain('¿Para cuándo quieres prepararte?');
    expect(m).toContain(ES['jx.date.none']);
    expect(m).toContain(ES['jx.date.opt.UNKNOWN']);
    expect(m).toContain(ES['jx.date.opt.EXAM_DATE']);
    // un-migrated database: no personal date / month option is faked
    expect(m).not.toContain(ES['jx.date.opt.PERSONAL']);
    expect(m).not.toContain(ES['jx.date.opt.MONTH']);
    // no official-session selector exists (no session data is loaded)
    expect(m).not.toContain(ES['jx.date.label.STUDENT_SELECTED_OFFICIAL_SESSION']);
    expect(textOf(m)).not.toMatch(ENUM_LEAK);
  });
  it('with the J3.2 columns, the personal date and the month are offered too', () => {
    const m = overview(r, { newScheduleFieldsAvailable: true });
    expect(m).toContain(ES['jx.date.opt.PERSONAL']);
    expect(m).toContain(ES['jx.date.opt.MONTH']);
  });
  it('SET_EXAM_DATE is the approved question copy', () => {
    expect(ES['jx.next.SET_EXAM_DATE']).toBe('¿Para cuándo quieres prepararte?');
  });
});

describe('Scenario 6 -- personal date only: "Tu fecha meta", never an exam date or official', () => {
  const facts = { ...noSchedule, personalTargetDate: '2027-04-15' };
  it('resolves PERSONAL_TARGET_DATE and renders it with its own label', () => {
    expect(resolveTargetSchedule(facts).targetDateSource).toBe('PERSONAL_TARGET_DATE');
    const lines = targetScheduleLines(facts);
    expect(lines).toEqual([{ key: 'jx.date.label.PERSONAL_TARGET_DATE', value: '2027-04-15', precision: 'DAY' }]);
    const m = html(createElement(ScheduleSummary, { lines, labels: ES, locale: 'es' }));
    expect(m).toContain('Tu fecha meta');
    expect(m).toContain('15 de abril de 2027');
    expect(m).not.toMatch(/oficial/i);
  });
  it('an estimated month stays a month (never a day)', () => {
    expect(formatScheduleValue('2027-05', 'MONTH', 'es')).toBe('mayo de 2027');
    const m = html(createElement(ScheduleSummary, { lines: targetScheduleLines({ ...noSchedule, estimatedMonth: '2027-05' }), labels: ES, locale: 'es' }));
    expect(m).toContain('Mes aproximado');
    expect(m).not.toMatch(/\b15\b/);
  });
});

describe('Scenario 7 -- Student-reported exam_date stays STUDENT_REPORTED (never relabelled official)', () => {
  const facts = { ...noSchedule, studentReportedExamDate: '2027-03-07' };
  it('label says it was reported by the Student', () => {
    expect(resolveTargetSchedule(facts).targetDateSource).toBe('STUDENT_REPORTED_EXAM_DATE');
    const m = html(createElement(ScheduleSummary, { lines: targetScheduleLines(facts), labels: ES, locale: 'es' }));
    expect(m).toContain('Fecha del examen (indicada por ti)');
    expect(m).not.toContain(ES['jx.date.label.AUTHORITATIVE_EXAM_DATE']);
  });
  it('each source keeps its own line; the official wording appears only for authoritative sources', () => {
    const lines = targetScheduleLines({ ...facts, personalTargetDate: '2027-02-20', authoritativeExamDate: { date: '2027-03-06', provenance: 'OFFICIAL_PUBLIC' } });
    expect(lines.map((x) => x.key)).toEqual(['jx.date.label.AUTHORITATIVE_EXAM_DATE', 'jx.date.label.STUDENT_REPORTED_EXAM_DATE', 'jx.date.label.PERSONAL_TARGET_DATE']);
  });
});

// ------------------------------------------------------------------ 8: multiple targets
describe('Scenario 8 -- multiple targets: each its own date, state, next action, blockers', () => {
  const paa = resolveStudentExamJourney(journeyFacts({ examTargetCount: 2 }, { examTargetId: 't-paa', examDate: '2026-12-05' }));
  const ib = resolveStudentExamJourney(journeyFacts({ examTargetCount: 2 }, { examTargetId: 't-ib', objectiveKey: 'ib.math.aa.sl', framework: 'IB', examDate: '2029-05-01' }, { content: NO_CONTENT }));
  it('resolutions are independent (no merged readiness)', () => {
    expect(paa.examTargetId).toBe('t-paa');
    expect(ib.examTargetId).toBe('t-ib');
    expect(isActivePreparation(paa)).toBe(true);
    expect(isActivePreparation(ib)).toBe(false);
    expect(studentBlockerKeys(paa)).not.toContain('jx.blocker.CONTENT_UNAVAILABLE');
    expect(studentBlockerKeys(ib)).toContain('jx.blocker.CONTENT_UNAVAILABLE');
    expect(examPrepIsPrimary([paa, ib])).toBe(true);
  });
  it('the list renders one card per target with its own date / state / next step, active first, no pill', () => {
    const s = read('src/app/dashboard/exam-prep/page.tsx');
    const ux = s.slice(s.indexOf('if (isStudentJourneyUxEnabled())'), s.indexOf('return (\n    <div className="xp-page xp-page--wide">\n      {/* Objective first'));
    expect(ux).toMatch(/ScheduleSummary lines=\{targetScheduleLines\(scheduleFactsFromRow\(stored\)\)\}/);
    expect(ux).toMatch(/jx\.state\.\$\{resolution\.state\}/);
    expect(ux).toMatch(/jx\.card\.next/);
    expect(ux).toMatch(/studentBlockerKeys\(resolution\)/);
    expect(ux).toMatch(/isActivePreparation/);
    expect(ux).not.toMatch(/prep-status|StatusBadge|readiness|%/);
  });
});

// ------------------------------------------------------------------ 9-10: content / prediction
describe('Scenario 9 -- CONTENT_UNAVAILABLE: friendly copy, no mock offered', () => {
  const r = resolveStudentExamJourney(journeyFacts({}, {}, { blueprint: { readiness: 'STRUCTURE_READY', structureVisible: true, publishedVersion: true, versionValidity: 'UNVERIFIED', programmePlan: false, institutionalRelease: 'NOT_APPLICABLE' }, content: NO_CONTENT }));
  it('one blocker line with the approved copy; mocks hidden', () => {
    expect(studentBlockerKeys(r)).toEqual(['jx.blocker.CONTENT_UNAVAILABLE']);
    expect(ES['jx.blocker.CONTENT_UNAVAILABLE']).toBe('Todavía estamos preparando contenido suficiente para esta evaluación.');
    expect(mocksVisible(r)).toBe(false);
    expect(overview(r)).toContain(ES['jx.blocker.CONTENT_UNAVAILABLE']);
    const prep = overview(r, { tab: 'prepare', view: view({ practice: false }) });
    expect(prep).toContain('data-mocks="hidden"');
    expect(prep).toContain(ES['jx.prep.mocks.unavailable']);
    expect(prep).not.toContain('paa.mock');
  });
  it('BLUEPRINT_INCOMPLETE copy is the approved text (version-invalid maps to it too)', () => {
    expect(ES['jx.blocker.BLUEPRINT_INCOMPLETE']).toBe('Todavía no tenemos completa la estructura necesaria para preparar esta evaluación.');
    expect(studentBlockerKeys({ blockers: [{ code: 'BLUEPRINT_VERSION_INVALID' }, { code: 'BLUEPRINT_INCOMPLETE' }] as never })).toEqual(['jx.blocker.BLUEPRINT_INCOMPLETE']);
  });
  it('technical blockers stay silent', () => {
    expect(studentBlockerKeys({ blockers: [{ code: 'NO_CONCEPT_MAPPINGS' }, { code: 'PREDICTION_MODEL_UNAVAILABLE' }, { code: 'EXAM_DATE_UNKNOWN' }, { code: 'CROSS_EXAM_EVIDENCE_RISK' }] as never })).toEqual([]);
  });
  it('with content, the reduced mock is offered without any percentage', () => {
    const ok = resolveStudentExamJourney(journeyFacts({}, { examDate: '2026-12-05' }));
    expect(mocksVisible(ok)).toBe(true);
    const prep = overview(ok, { tab: 'prepare' });
    expect(prep).toContain('data-mocks="visible"');
    expect(prep).toContain(ES['jx.prep.mocks.reducedNoLength']);
    expect(textOf(prep)).not.toMatch(/%/);
  });
});

describe('Scenario 10 -- prediction unavailable: no section, no placeholder', () => {
  const r = resolveStudentExamJourney(journeyFacts({}, { examDate: '2026-12-05' }));
  it('NO_MODEL -> predictionVisible false and nothing rendered on any tab', () => {
    expect(r.predictionStatus.modelClass).toBe('NO_MODEL');
    expect(predictionVisible(r)).toBe(false);
    const attempts = [{ id: 'a-1', name: 'PAA · Simulacro', status: 'COMPLETED', createdAt: '2026-10-01T10:00:00Z', result: '31/36' }];
    for (const tab of ['summary', 'prepare', 'results'] as const) {
      const m = textOf(overview(r, { tab, attempts }));
      expect(m).not.toMatch(/predicci|proyecci|pronóstico|readiness|%/i);
      expect(m).not.toMatch(ENUM_LEAK);
    }
  });
  it('Resultados exists only with completed attempts', () => {
    expect(overview(r)).not.toContain('tab=results');
    expect(parseOverviewTab('results', false)).toBe('summary');
    const attempts = [{ id: 'a-1', name: 'PAA · Simulacro', status: 'COMPLETED', createdAt: '2026-10-01T10:00:00Z', result: '31/36' }];
    expect(overview(r, { attempts })).toContain('tab=results');
  });
});

// ------------------------------------------------------------------ 11-12: learning-only / nav
describe('Scenario 11 -- learning-only Student unaffected', () => {
  it('no targets -> Exam Prep is not primary; the nav equals Student v1', () => {
    expect(examPrepIsPrimary([])).toBe(false);
    const v1 = buildLearnerNav({ isAdmin: false, debtCount: 0, notifCount: 0 });
    expect(buildLearnerNav({ isAdmin: false, debtCount: 0, notifCount: 0, examPrepPrimary: false })).toEqual(v1);
  });
  it('flag modes: only the exact "UX" enables the entry UX; SHADOW stays shadow-only', () => {
    expect(studentJourneyV2Mode({ STUDENT_JOURNEY_V2: 'UX' })).toBe('UX');
    expect(isStudentJourneyUxEnabled({ STUDENT_JOURNEY_V2: 'SHADOW' })).toBe(false);
    expect(isStudentJourneyUxEnabled({ STUDENT_JOURNEY_V2: 'ux' })).toBe(false);
    expect(isStudentJourneyUxEnabled({})).toBe(false);
    expect(isStudentJourneyShadowEnabled({ STUDENT_JOURNEY_V2: 'UX' })).toBe(true);
  });
  it('the gate is unchanged without the UX flag (profile first, Exam Prep closed before the profile)', () => {
    const s: GateState = { accountStatus: 'ACTIVE', roles: ['STUDENT'], storedWorkspace: 'STUDENT', profile: null, subjectCount: 0 };
    expect(decideStudentOnboardingGate('/dashboard/exam-prep', s)).toBe('/dashboard/profile');
    expect(decideStudentOnboardingGate('/dashboard/notifications', s)).toBe('/dashboard/profile');
  });
  it('Today is not rewritten', () => {
    expect(read('src/app/dashboard/today/page.tsx')).not.toMatch(/exam-journey/);
  });
});

describe('Scenario 12 -- a future milestone does not activate the navigation', () => {
  const far = resolveStudentExamJourney(journeyFacts({}, { source: 'INSTITUTION', confirmation: 'ASSIGNED', examDate: '2029-05-01' }));
  it('HORIZON target -> not active, Exam Prep stays secondary', () => {
    expect(far.phase).toBe('HORIZON');
    expect(isActivePreparation(far)).toBe(false);
    expect(examPrepIsPrimary([far])).toBe(false);
    const primary = buildLearnerNav({ isAdmin: false, debtCount: 0, notifCount: 0, examPrepPrimary: false }).find((g) => g.kind === 'PRIMARY')!;
    expect(primary.items.some((i) => i.key === 'examPrep')).toBe(false);
  });
  it('an active target makes Exam Prep primary (and not duplicated in secondary)', () => {
    const groups = buildLearnerNav({ isAdmin: false, debtCount: 0, notifCount: 0, examPrepPrimary: true });
    const keys = (k: string) => groups.find((g) => g.kind === k)?.items.map((i) => i.key) ?? [];
    expect(keys('PRIMARY')).toContain('examPrep');
    expect(keys('SECONDARY')).not.toContain('examPrep');
  });
  it('a recorded result is not active preparation', () => {
    expect(isActivePreparation({ examTargetId: 't', phase: 'CLOSING', state: 'RESULT_RECORDED', recommendedNextAction: { kind: 'REVIEW_RESULT' } } as never)).toBe(false);
  });
});

// ------------------------------------------------------------------ schedule API (J3.4)
describe('PATCH /api/exam-preparation/[id]/schedule', () => {
  const ID = '8c9f5c1e-2b1a-4c35-9a52-6f9d2c1b7a10';
  const req = (body: unknown) => new NextRequest(`http://localhost/api/exam-preparation/${ID}/schedule`, { method: 'PATCH', body: JSON.stringify(body) });
  const ctx = { params: Promise.resolve({ id: ID }) };
  const ROW = { id: ID, status: 'ACTIVE', exam_date: null };
  const call = (body: unknown) => (schedulePATCH as unknown as (r: NextRequest, c: typeof ctx) => Promise<Response>)(req(body), ctx);

  it('404 unless STUDENT_JOURNEY_V2=UX (SHADOW included)', async () => {
    vi.stubEnv('STUDENT_JOURNEY_V2', 'SHADOW');
    expect((await call({ examDate: '2027-03-07' })).status).toBe(404);
    expect(h.gate).not.toHaveBeenCalled();
  });
  it('409 for the personal date / month on a database without the J3.2 columns (nothing written)', async () => {
    vi.stubEnv('STUDENT_JOURNEY_V2', 'UX');
    h.gate.mockResolvedValue({ ok: true, studentId: 's-1' });
    h.loadRow.mockResolvedValue(ROW);
    h.columns.mockResolvedValue(false);
    const r = await call({ personalTargetDate: '2027-02-01' });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('SCHEDULE_FIELDS_UNAVAILABLE');
    expect(h.dbQuery).not.toHaveBeenCalled();
    expect(h.updateDetails).not.toHaveBeenCalled();
  });
  it('the legacy exam date works without the columns and stays STUDENT_REPORTED', async () => {
    vi.stubEnv('STUDENT_JOURNEY_V2', 'UX');
    h.gate.mockResolvedValue({ ok: true, studentId: 's-1' });
    h.loadRow.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, exam_date: '2027-03-07' });
    const r = await call({ examDate: '2027-03-07' });
    expect(r.status).toBe(200);
    expect(h.updateDetails).toHaveBeenCalledWith('s-1', ID, { examDate: '2027-03-07' });
    expect((await r.json()).data).toEqual({ targetDateSource: 'STUDENT_REPORTED_EXAM_DATE', officialSession: 'UNKNOWN' });
  });
  it('a personal date after the sitting is refused with its own code', async () => {
    vi.stubEnv('STUDENT_JOURNEY_V2', 'UX');
    h.gate.mockResolvedValue({ ok: true, studentId: 's-1' });
    h.loadRow.mockResolvedValue({ ...ROW, exam_date: '2027-03-07' });
    h.columns.mockResolvedValue(true);
    const r = await call({ personalTargetDate: '2027-04-01' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('PERSONAL_DATE_AFTER_SITTING');
    expect(h.dbQuery).not.toHaveBeenCalled();
  });
  it('strict body: no official session, no target result, malformed month refused', async () => {
    vi.stubEnv('STUDENT_JOURNEY_V2', 'UX');
    h.gate.mockResolvedValue({ ok: true, studentId: 's-1' });
    for (const body of [{ officialSessionKey: 'may-2027' }, { targetResult: '7' }, { estimatedMonth: '2027-13' }, { estimatedMonth: '2027-05-01' }]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(h.loadRow).not.toHaveBeenCalled();
  });
  it('archived or foreign targets are 404', async () => {
    vi.stubEnv('STUDENT_JOURNEY_V2', 'UX');
    h.gate.mockResolvedValue({ ok: true, studentId: 's-1' });
    h.loadRow.mockResolvedValueOnce(null);
    expect((await call({ examDate: '2027-03-07' })).status).toBe(404);
    h.loadRow.mockResolvedValueOnce({ ...ROW, status: 'ARCHIVED' });
    expect((await call({ examDate: '2027-03-07' })).status).toBe(404);
  });
  it('a month is written as a month with STUDENT_ENTERED provenance', async () => {
    vi.stubEnv('STUDENT_JOURNEY_V2', 'UX');
    h.gate.mockResolvedValue({ ok: true, studentId: 's-1' });
    h.loadRow.mockResolvedValue({ ...ROW, estimated_exam_month: '2027-05' });
    h.columns.mockResolvedValue(true);
    h.dbQuery.mockResolvedValue({ rows: [] });
    const r = await call({ estimatedMonth: '2027-05', personalTargetDate: null });
    expect(r.status).toBe(200);
    const [, params] = h.dbQuery.mock.calls[0];
    expect(params[5]).toBe('2027-05');
    expect(JSON.parse(params[6])).toEqual({ estimatedMonth: 'STUDENT_ENTERED' });
    expect((await r.json()).data.targetDateSource).toBe('ESTIMATED_MONTH');
  });
});

// ------------------------------------------------------------------ copy: five locales, no leakage
describe('copy -- all five locales, no enum leakage', () => {
  const keys = Object.keys(JOURNEY_MESSAGES.es);
  it('every journey key exists, non-empty, in every locale (and reaches getMessages)', () => {
    for (const loc of LOCALES) {
      const cat = JOURNEY_MESSAGES[loc as keyof typeof JOURNEY_MESSAGES] as Record<string, string>;
      const all = getMessages(loc) as Record<string, string>;
      for (const k of keys) {
        expect(cat[k], `${loc}:${k}`).toBeTruthy();
        expect(all[k], `${loc}:${k}`).toBe(cat[k]);
        expect(cat[k], `${loc}:${k}`).not.toMatch(ENUM_LEAK);
      }
    }
  });
  it('every next action, state, phase and Student blocker has copy', () => {
    for (const kind of ALL_NEXT_ACTION_KINDS) expect(ES[presentNextAction(kind).labelKey], kind).toBeTruthy();
    for (const k of keys.filter((x) => x.startsWith('jx.blocker.'))) expect(ES[k]).toBeTruthy();
  });
  it('the overview renders in every locale without raw keys or enums', () => {
    const r = resolveStudentExamJourney(journeyFacts({}, { examDate: '2026-12-05' }));
    for (const loc of LOCALES) {
      for (const tab of ['summary', 'prepare'] as const) {
        const t = textOf(overview(r, { tab, scheduleLines: targetScheduleLines({ ...noSchedule, studentReportedExamDate: '2026-12-05' }) }, loc));
        expect(t, `${loc}/${tab}`).not.toMatch(/\bjx\.|\bprep\.[a-z]/);
        expect(t, `${loc}/${tab}`).not.toMatch(ENUM_LEAK);
      }
    }
  });
  it('no readiness percentage anywhere in the new UX sources', () => {
    for (const f of ['src/app/dashboard/exam-prep/journey/ExamTargetOverview.tsx', 'src/app/dashboard/profile/InstitutionalContextCard.tsx', 'src/app/dashboard/exam-prep/discover/page.tsx']) {
      const s = read(f);
      expect(s, f).not.toMatch(/lengthCoveragePercent|readinessPercent|coverage\.mapped|prep\.home\.coverage|StatusBadge/);
    }
  });
});
