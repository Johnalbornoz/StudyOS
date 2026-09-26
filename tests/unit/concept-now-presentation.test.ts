/**
 * The concept page "AHORA" block never renders empty (LEARN_CHECK regression).
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const h = vi.hoisted(() => ({ dbQuery: vi.fn(), fetchSpy: vi.fn() }));

vi.mock('@/lib/db', () => ({ db: { query: h.dbQuery }, query: h.dbQuery }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => createElement('a', { href, ...rest }, children) }));
vi.mock('@/app/dashboard/StartSessionButton', () => ({
  default: ({ label, accessibleLabel, actionConceptId }: any) =>
    createElement('button', { 'aria-label': accessibleLabel, 'data-concept': actionConceptId }, label),
}));
vi.mock('@/app/dashboard/WhyThisV3', () => ({ default: () => createElement('div', { 'data-why': 'facts' }) }));
vi.mock('@/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptExplanationDisclosure', () => ({ default: () => null }));

import { resolveNowPresentation, isLaunchableConceptId } from '@/lib/lx/now-presentation';
import { getMessages, LOCALES } from '@/lib/i18n/messages';
import { activityCta } from '@/app/dashboard/activityCta';
import { activityLabel } from '@/app/dashboard/activityLabel';
import { deriveSubjectAcademicContext } from '@/lib/student/subject-academic-context';
import ConceptMission from '@/app/dashboard/subjects/[id]/concepts/[conceptId]/ConceptMission';

const CONCEPT = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const es = getMessages('es');
const ALL_ACTIVITY_TYPES = [
  'PRACTICE', 'REVIEW', 'SOLO_CHECK', 'DIAGNOSTIC_CHECK', 'REMEDIATION', 'SOLO_VERIFY',
  'TRANSFER', 'RETENTION_CHECK', 'CUMULATIVE_ASSESSMENT', 'MOCK_EXAM', 'LEARN_CHECK',
] as const;

function now(over: Record<string, unknown> = {}): any {
  return { kind: 'CANONICAL_ACTION', activityType: 'LEARN_CHECK', actionConceptId: CONCEPT, facts: [], fallback: null, nextEligibleReviewAt: null, ...over };
}

describe('i18n completeness (root cause guard)', () => {
  it('every ActivityType has a non-empty label and CTA in every locale', () => {
    for (const locale of LOCALES) {
      const t = getMessages(locale);
      for (const type of ALL_ACTIVITY_TYPES) {
        expect(activityLabel(type, t), `${locale} activityLabel.${type}`).toMatch(/\S/);
        expect(activityCta(type, t), `${locale} activityCta.${type}`).toMatch(/\S/);
      }
    }
  });
});

describe('resolveNowPresentation', () => {
  it('1. new concept in LEARN: first canonical step with title, why, CTA and accessible label (never Prove/Retain/Transfer)', () => {
    const p = resolveNowPresentation(now(), es);
    expect(p).toEqual({
      kind: 'ACTION',
      activityType: 'LEARN_CHECK',
      actionConceptId: CONCEPT,
      title: 'Comprobar comprensión',
      why: es['activityWhy.LEARN_CHECK'],
      ctaLabel: 'Empezar a aprender',
      accessibleLabel: 'Empezar a aprender: Comprobar comprensión',
    });
  });

  it('1b. interface language is respected', () => {
    const p = resolveNowPresentation(now(), getMessages('en'));
    expect(p).toMatchObject({ title: 'Understanding check', ctaLabel: 'Start learning' });
  });

  it('2. complete recommendation with facts: activity copy, facts explain the why', () => {
    const p = resolveNowPresentation(now({ activityType: 'PRACTICE', facts: [{ kind: 'X' }] }), es);
    expect(p).toMatchObject({ kind: 'ACTION', title: es['activityLabel.PRACTICE'], ctaLabel: es['activityCta.PRACTICE'], why: null });
  });

  it('3. recommendation whose CTA copy is blank falls back to a visible label', () => {
    const t = { ...es, 'activityCta.LEARN_CHECK': '   ' } as typeof es;
    const p = resolveNowPresentation(now(), t);
    expect(p).toMatchObject({ kind: 'ACTION', ctaLabel: es['conceptMission.nowFallbackCta'] });
    expect((p as any).accessibleLabel).toMatch(/\S+: \S+/);
  });

  it('4. no recommendation: safe no-action card, never an empty action', () => {
    expect(resolveNowPresentation(null, es)).toEqual({ kind: 'NO_ACTION', fallback: 'CANONICAL_ACTION_UNAVAILABLE' });
    expect(resolveNowPresentation(now({ kind: 'NO_CANONICAL_ACTION', activityType: null, actionConceptId: null, fallback: 'LEARN_FIRST' }), es))
      .toEqual({ kind: 'NO_ACTION', fallback: 'LEARN_FIRST' });
    expect(resolveNowPresentation(now({ kind: 'NO_CANONICAL_ACTION', activityType: null, actionConceptId: null, fallback: null }), es))
      .toEqual({ kind: 'NO_ACTION', fallback: 'CANONICAL_ACTION_UNAVAILABLE' });
  });

  it('5. missing translation (undefined) for title and CTA -> deterministic fallbacks', () => {
    const t = { ...es } as any;
    delete t['activityLabel.LEARN_CHECK'];
    delete t['activityCta.LEARN_CHECK'];
    delete t['activityWhy.LEARN_CHECK'];
    const p = resolveNowPresentation(now(), t);
    expect(p).toMatchObject({
      kind: 'ACTION',
      title: es['conceptMission.nowFallbackTitle'],
      ctaLabel: es['conceptMission.nowFallbackCta'],
      why: es['conceptMission.nowWhyDefault'],
    });
  });

  it('6. invalid CTA destination -> no dead button, safe unavailable card', () => {
    for (const bad of ['', 'not-a-uuid', null, undefined, 42]) {
      expect(isLaunchableConceptId(bad)).toBe(false);
      expect(resolveNowPresentation(now({ actionConceptId: bad }), es)).toEqual({ kind: 'NO_ACTION', fallback: 'CANONICAL_ACTION_UNAVAILABLE' });
    }
  });
});

describe('ConceptMission render', () => {
  const view: any = {
    identity: { subjectId: '11111111-1111-4111-8111-111111111111', subjectName: 'Matemáticas', conceptName: 'Un concepto nuevo' },
    goal: { text: 'Entender el concepto.' },
    journey: {
      status: 'RESOLVED', stage: 'LEARN', reasonCode: 'NOT_STARTED', intervention: null,
      milestones: ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'].map((rung, i) => ({ rung, position: i === 0 ? 'CURRENT' : 'AHEAD', demonstrated: false, readyToProve: false })),
    },
    learn: { state: 'NEW', prominence: 'PRIMARY_INLINE' },
    now: now(),
  };

  it('7. renders a non-empty action and CTA without creating evidence or calling any API', () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = h.fetchSpy as any;
    const html = renderToStaticMarkup(createElement(ConceptMission, { view, studentId: 'student-1', conceptId: CONCEPT, locale: 'es' }));
    globalThis.fetch = originalFetch;

    expect(html).toContain('Comprobar comprensión');
    expect(html).toContain('>Empezar a aprender</button>');
    expect(html).toContain('aria-label="Empezar a aprender: Comprobar comprensión"');
    expect(html).toContain(`data-concept="${CONCEPT}"`);
    expect(h.dbQuery).not.toHaveBeenCalled();
    expect(h.fetchSpy).not.toHaveBeenCalled();
    // the rail still shows the canonical order, LEARN first
    expect(html.indexOf('Aprender')).toBeLessThan(html.indexOf('Practicar'));
  });

  it('never renders a button without a label, whatever the translations say', () => {
    const html = renderToStaticMarkup(createElement(ConceptMission, { view: { ...view, now: now({ activityType: 'LEARN_CHECK' }) }, studentId: 's', conceptId: CONCEPT, locale: 'fr' }));
    expect(html).not.toMatch(/<button[^>]*><\/button>/);
  });

  it('8. an IB DP2 HL student keeps the inherited subject context (this path neither reads nor writes it)', () => {
    const ctx = deriveSubjectAcademicContext({ curriculumType: 'ib', ibProgramme: 'DP', ibYear: 'DP2' });
    expect(ctx).toEqual({ programme: 'DP', year: 'DP2', requiresLevel: true });
    renderToStaticMarkup(createElement(ConceptMission, { view, studentId: 's', conceptId: CONCEPT, locale: 'es' }));
    expect(h.dbQuery).not.toHaveBeenCalled();
  });
});
