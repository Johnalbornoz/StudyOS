/**
 * Exam preparation, objective first -- server render of the Explorer picker and
 * the preparation home with the real Spanish / English copy: every label
 * resolves (no "undefined", no raw keys), catalogue-only stays addable, and the
 * home never presents an official score / readiness.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => createElement('a', { href, ...rest }, children) }));

import { getMessages } from '@/lib/i18n/messages';
import { ObjectivePicker } from '@/app/dashboard/exam-prep/ObjectivePicker';
import { PreparationHome } from '@/app/dashboard/exam-prep/[examProfileId]/PreparationHome';
import { examObjectives, objectiveByKey, OBJECTIVE_FRAMEWORKS } from '@/lib/exam-core/objectives/objective-catalog';
import { computeCapabilities } from '@/lib/exam-core/objectives/capabilities';
import { buildPreparationPlan, nextStep } from '@/lib/exam-core/objectives/preparation-plan';

const labels = (locale: string) => Object.fromEntries(Object.entries(getMessages(locale) as Record<string, string>).filter(([k]) => k.startsWith('prep.')));
const clean = (html: string) => {
  expect(html).not.toMatch(/undefined|>prep\.|NaN/);
};

describe('ObjectivePicker render', () => {
  it.each(['es', 'en', 'de', 'fr', 'pt'])('%s: every framework card renders with its copy; nothing disabled by readiness', (locale) => {
    const objectives = examObjectives().map((o, i) => ({ key: o.key, framework: o.framework, kind: o.kind, label: o.label, context: o.context, status: i % 3 === 0 ? 'canAdd' : 'practice', preparationId: null, searchText: o.searchText }));
    const html = renderToStaticMarkup(createElement(ObjectivePicker, { objectives, frameworks: OBJECTIVE_FRAMEWORKS, suggested: ['IB_DP'], labels: labels(locale) }));
    clean(html);
    for (const f of OBJECTIVE_FRAMEWORKS) expect(html).toContain(labels(locale)[`prep.fw.${f.key}`].replace(/&/g, '&amp;'));
    expect(html).not.toMatch(/disabled=""/);
  });
});

describe('PreparationHome render', () => {
  const base = { id: 'p1', studentId: 's1', examDefinitionId: null, examVersionId: null, purpose: null, programmeContext: null, subjectFocus: null, examDate: null, timezone: null, institutionTargetId: null, status: 'ACTIVE' as const, targetInstitutionName: null, targetQualification: null };
  it('catalogue-only: added, transparent, no activity, no invented structure', () => {
    const objective = objectiveByKey('cie.asal.9990.a')!;
    const capabilities = computeCapabilities(objective, [], 0);
    const view = { profile: { ...base, objectiveKey: objective.key }, objective, capabilities, plan: null, next: nextStep({ openAttemptId: null, plan: null, canPractice: false, canRunDiagnostic: false, diagnosticDone: false, canViewStructure: false, canPlanDiploma: false, hasExamDate: false }), openAttemptId: null, diagnostic: null };
    const l = labels('es');
    const html = renderToStaticMarkup(createElement(PreparationHome, { view: view as any, labels: l, language: 'es', timing: { session: null, sessionLabel: null, dateLine: 'Sin fecha' }, display: { subject: null, level: null }, aspiration: { areas: [], areaLabel: null } }));
    clean(html);
    expect(html).toContain(l['prep.home.empty.title']);
    expect(html).toContain(l['prep.unavailable.NOT_CONFIGURED']);
    expect(html).toContain(l['prep.next.SET_GOAL_DETAILS']);
    expect(html).not.toContain(l['prep.cap.reducedMock']);
  });
  it('with a plan: covered / reinforce / explained reasons / reduced mock with coverage; "Preparación estimada StudyUs"', () => {
    const objective = objectiveByKey('pisa.2022')!;
    const capabilities = computeCapabilities(objective, [{ key: 'pisa.2022.math', type: 'DOMAIN', label: 'Matemáticas', purpose: null, state: 'REDUCED_MOCK_READY', modes: ['PRACTICE', 'MOCK'], selectable: true, bankInProgress: false, sectionBound: true, lengthCoveragePercent: 27 }], 5);
    const learner = { studentConceptId: 'sc', subjectId: 'sub', masteryState: 'VALIDATED_MASTERY' as const, validationReadiness: 'READY' as const, memoryStatus: 'STABLE' as const, retentionDue: false, criticalMisconceptions: 0, evidenceCount: 5 };
    const plan = buildPreparationPlan(
      [
        { learningObjectiveId: 'lo1', code: 'a', description: 'Interpretar gráficos', area: 'Matemáticas', weight: 0.5, ownEvidence: { classification: 'GAP', at: '2026-10-01', examName: 'PAA', sameExam: false }, concepts: [{ canonicalConceptId: 'c1', name: 'Ecuaciones lineales', learner: null, examEvidence: null, alsoRelevantFor: ['PAA (Prueba de Aptitud Académica)'] }] },
        { learningObjectiveId: 'lo2', code: 'b', description: 'Proporcionalidad', area: 'Matemáticas', weight: 0.5, ownEvidence: null, concepts: [{ canonicalConceptId: 'c2', name: 'Proporciones', learner, examEvidence: null, alsoRelevantFor: [] }] },
      ],
      { examDaysLeft: 12, canPractice: true, canRunDiagnostic: true }
    );
    const view = { profile: { ...base, objectiveKey: objective.key }, objective, capabilities, plan, next: nextStep({ openAttemptId: null, plan, canPractice: true, canRunDiagnostic: true, diagnosticDone: false, canViewStructure: true, canPlanDiploma: false, hasExamDate: true }), openAttemptId: null, diagnostic: null };
    for (const locale of ['es', 'en']) {
      const l = labels(locale);
      const html = renderToStaticMarkup(createElement(PreparationHome, { view: view as any, labels: l, language: locale, timing: { session: null, sessionLabel: null, dateLine: '1 junio 2027' }, display: { subject: null, level: null }, aspiration: { areas: [], areaLabel: null } }));
      clean(html);
      expect(html).toContain(l['prep.home.estimate']);
      expect(html).toContain(l['prep.concept.DEMONSTRATED']);
      expect(html).toContain(l['prep.reason.EXAM_GAP'].replace('{exam}', 'PAA'));
      expect(html).toContain(l['prep.cap.reducedMockCoverage'].replace('{n}', '27'));
      expect(html).toContain(l['prep.home.alsoFor'].replace('{exam}', 'PAA (Prueba de Aptitud Académica)'));
      expect(html).not.toMatch(/Official readiness|Simulacro oficial|puntuación PISA/i);
    }
  });
  it('AICE Diploma: the planner is the next step; subjects are prepared separately', () => {
    const objective = objectiveByKey('cie.aice.diploma')!;
    const capabilities = computeCapabilities(objective, [], 0);
    const view = { profile: { ...base, objectiveKey: objective.key }, objective, capabilities, plan: null, next: nextStep({ openAttemptId: null, plan: null, canPractice: false, canRunDiagnostic: false, diagnosticDone: false, canViewStructure: true, canPlanDiploma: true, hasExamDate: false }), openAttemptId: null, diagnostic: null };
    const l = labels('es');
    const html = renderToStaticMarkup(createElement(PreparationHome, { view: view as any, labels: l, language: 'es', timing: { session: null, sessionLabel: null, dateLine: null }, display: { subject: null, level: null }, aspiration: { areas: [], areaLabel: null } }));
    clean(html);
    expect(html).toContain('href="/dashboard/exams/aice"');
    expect(html).toContain(l['prep.home.aiceSubjects'].replace(/&/g, '&amp;'));
  });
});
