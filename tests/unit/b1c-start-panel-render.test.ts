/**
 * B1-C -- the simulation start panel, rendered: with the types the exam-prep page now passes
 * (`preparationSimulationTypes`), it offers no full mock. Server-side render of the real component.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { preparationSimulationTypes } from '@/lib/simulation/preparation-simulation';
import { SIMULATION_TYPES, TIMING_MODES } from '@/lib/experience/exam-prep';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

let StartSimulationPanel: any;
beforeAll(async () => {
  (globalThis as any).React = React;
  ({ StartSimulationPanel } = await import('@/app/dashboard/exam-prep/[examProfileId]/StartSimulationPanel'));
});

const labels = {
  topicLabel: 'Tema', areaLabel: 'Área', inProgress: '', notAllowed: '', title: 'Práctica', lead: '', typeLegend: 'Tipo', timingLegend: 'Tiempo', advanced: 'Avanzado',
  learningObjectiveIdLabel: '', academicSubjectIdLabel: '', targetIdHint: '', submit: 'Empezar', submitting: '', error: '',
  types: Object.fromEntries(SIMULATION_TYPES.map((t) => [t, { title: `title:${t}`, body: `body:${t}` }])),
  timings: Object.fromEntries(TIMING_MODES.map((m) => [m, { title: `timing:${m}`, body: '' }])),
  reasons: {},
};

function render(allowedTypes: string[] | undefined): string[] {
  const html = renderToStaticMarkup(
    React.createElement(StartSimulationPanel, { studentId: 's', examProfileId: 'p', examVersionId: 'v', miniMockEligible: true, miniMockReasons: [], fullMockEligible: true, fullMockReasons: [], areas: [], allowedTypes, labels })
  );
  // every radio of the type group, whatever the attribute order (a checked input renders `checked` before `value`)
  return [...html.matchAll(/<input[^>]*name="simulationType"[^>]*>/g)].map((m) => /value="([A-Z_]+)"/.exec(m[0])![1]);
}

describe('B1-C -- simulation start panel offers preparation simulations only', () => {
  it('before B1 (no filter) the panel offered a full mock -- the behaviour being closed', () => {
    expect(render(undefined)).toContain('FULL_MOCK');
  });

  it('with the types the page passes now, FULL_MOCK is not an option, whatever the delivery policy allows', () => {
    expect(render(preparationSimulationTypes(undefined))).toEqual(['MINI_MOCK', 'TOPIC_EXAM', 'DOMAIN_EXAM']);
    expect(render(preparationSimulationTypes(['MINI_MOCK', 'FULL_MOCK', 'TOPIC_EXAM', 'DOMAIN_EXAM']))).toEqual(['MINI_MOCK', 'TOPIC_EXAM', 'DOMAIN_EXAM']);
    // a version whose policy offers only a full mock and topic practice (e.g. IB Visual Arts) keeps topic practice only
    expect(render(preparationSimulationTypes(['FULL_MOCK', 'TOPIC_EXAM']))).toEqual(['TOPIC_EXAM']);
  });

  it('even a full-mock-eligible version shows no full mock here (eligibility does not reopen the option)', () => {
    expect(render(preparationSimulationTypes(['MINI_MOCK', 'FULL_MOCK']))).toEqual(['MINI_MOCK']);
  });
});
