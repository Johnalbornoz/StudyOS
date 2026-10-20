/**
 * Exam eligibility -- server render of "Preparaciones recomendadas para ti" with
 * the real copy in every locale: only recommended objectives by default (with
 * their reason), the rest hidden behind "Buscar otra preparación", and an
 * actionable empty state. Plus the class exam assignment card shell.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => createElement('a', { href, ...rest }, children) }));

import { getMessages } from '@/lib/i18n/messages';
import { PreparationChooser } from '@/app/dashboard/exam-prep/PreparationChooser';
import { ClassExamAssignments } from '@/components/exam-eligibility/ClassExamAssignments';
import { examObjectives, OBJECTIVE_FRAMEWORKS } from '@/lib/exam-core/objectives/objective-catalog';

const labels = (locale: string) => Object.fromEntries(Object.entries(getMessages(locale) as Record<string, string>).filter(([k]) => k.startsWith('prep.') || k.startsWith('elig.')));
const rows = (recommendedFramework: string | null) =>
  examObjectives().map((o) => ({
    key: o.key, framework: o.framework, kind: o.kind, label: o.label, context: o.context, status: 'canAdd', preparationId: null, searchText: o.searchText,
    recommended: o.framework === recommendedFramework,
    reason: o.framework === recommendedFramework ? 'Disponible porque sigues Cambridge IGCSE.' : null,
  }));

describe('PreparationChooser render', () => {
  it.each(['es', 'en', 'de', 'fr', 'pt'])('%s: only the recommended framework is shown, with its reason; others behind the explicit toggle', (locale) => {
    const l = labels(locale);
    const html = renderToStaticMarkup(createElement(PreparationChooser, { objectives: rows('CIE_IGCSE'), frameworks: OBJECTIVE_FRAMEWORKS, suggested: ['CIE_IGCSE'], frameworkReasons: { CIE_IGCSE: 'Disponible porque sigues Cambridge IGCSE.' }, hasAcademicContext: true, labels: l }));
    expect(html).not.toMatch(/undefined|>elig\.|>prep\./);
    expect(html).toContain(l['elig.recommended.title']);
    expect(html).toContain(l['prep.fw.CIE_IGCSE']);
    expect(html).toContain('Disponible porque sigues Cambridge IGCSE.');
    for (const other of ['IB_DP', 'PISA', 'PAA', 'SABER11', 'CIE_AS_A']) expect(html).not.toContain(`>${l[`prep.fw.${other}`].replace(/&/g, '&amp;')}<`);
    expect(html).toContain(l['elig.explore.toggle']);
    expect(html).toMatch(/aria-expanded="false"/);
  });
  it('no recommendation: actionable empty state pointing to the academic profile', () => {
    const l = labels('es');
    const html = renderToStaticMarkup(createElement(PreparationChooser, { objectives: rows(null), frameworks: OBJECTIVE_FRAMEWORKS, suggested: [], frameworkReasons: {}, hasAcademicContext: false, labels: l }));
    expect(html).toContain(l['elig.empty.title']);
    expect(html).toContain(l['elig.empty.noProfile']);
    expect(html).toContain('href="/dashboard/profile"');
    expect(html).toContain(l['elig.explore.toggle']);
  });
});

describe('ClassExamAssignments render', () => {
  it('renders its card shell (loading) with resolved copy', () => {
    const html = renderToStaticMarkup(createElement(ClassExamAssignments, { apiBase: '/api/teacher/classes/x/exam-assignments', labels: labels('es') }));
    expect(html).toContain(labels('es')['elig.assign.title']);
    expect(html).toContain(labels('es')['elig.assign.loading']);
    expect(html).not.toMatch(/undefined|>elig\./);
  });
});
