/**
 * Exam history delete -- discoverability. The real components are rendered
 * (react-dom/server): every deletable exam shows a "⋯" menu, rows carry
 * name / status / date / result and the "Continuar" / "Ver resultado" actions,
 * and each state's action and confirmation copy exists in every locale.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

import { MESSAGES, LOCALES } from '@/lib/i18n/messages';
import { AttemptHistory } from '@/app/dashboard/exam-prep/[examProfileId]/AttemptHistory';
import { InstanceCard, type InstanceView } from '@/app/dashboard/exams/InstanceCard';

const es = MESSAGES.es as unknown as Record<string, string>;
const labels = Object.fromEntries(Object.entries(es).filter(([k]) => k.startsWith('exv2.') || k.startsWith('examPrep.history.') || k.startsWith('examPrep.attempt.status.')));

describe('state-specific delete copy', () => {
  it('Spanish wording is exactly the agreed one', () => {
    expect(es['exv2.delete.NOT_STARTED.action']).toBe('Eliminar examen');
    expect(es['exv2.delete.NOT_STARTED.title']).toBe('¿Quieres eliminar este examen?');
    expect(es['exv2.delete.IN_PROGRESS.action']).toBe('Cancelar y eliminar intento');
    expect(es['exv2.delete.IN_PROGRESS.body']).toBe('No podrás continuar este intento.');
    expect(es['exv2.delete.COMPLETED.action']).toBe('Eliminar de mi historial');
    expect(es['exv2.delete.COMPLETED.title']).toMatch(/historial\?$/);
  });
  it('every state has action, title and body in every locale', () => {
    for (const loc of LOCALES) {
      const m = MESSAGES[loc] as unknown as Record<string, string>;
      for (const kind of ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ENDED']) for (const part of ['action', 'title', 'body']) expect(m[`exv2.delete.${kind}.${part}`], `${loc} ${kind}.${part}`).toBeTruthy();
      for (const k of ['exv2.menu.more', 'exv2.delete.done', 'exv2.history.score']) expect(m[k], `${loc} ${k}`).toBeTruthy();
    }
  });
});

describe('Exam Prep history rows', () => {
  const html = renderToStaticMarkup(
    createElement(AttemptHistory, {
      locale: 'es',
      labels,
      rows: [
        { id: 'a1', name: 'PAA · Simulacro de formato reducido', status: 'COMPLETED', createdAt: '2026-10-01T12:00:00Z', result: '31/36' },
        { id: 'a2', name: 'PAA · Simulacro corto', status: 'ACTIVE', createdAt: '2026-10-02T12:00:00Z', result: null },
        { id: 'a3', name: 'PAA · Simulacro corto', status: 'ABANDONED', createdAt: '2026-10-02T12:00:00Z', result: null },
      ],
    })
  );
  it('every row has the ⋯ menu, named after the exam', () => {
    expect(html.match(/aria-haspopup="menu"/g)?.length).toBe(3);
    expect(html).toContain('aria-label="Más acciones: PAA · Simulacro de formato reducido"');
  });
  it('rows show name, status, date and result', () => {
    expect(html).toContain('PAA · Simulacro de formato reducido');
    expect(html).toContain(es['examPrep.attempt.status.COMPLETED']);
    expect(html).toContain(es['examPrep.attempt.status.ACTIVE']);
    expect(html).toContain('Resultado: 31/36');
    expect(html).toMatch(/1 oct 2026/);
  });
  it('"Ver resultado" for completed, "Continuar" for in progress -- by link, no typed id or URL', () => {
    expect(html).toContain('href="/dashboard/exam-prep/attempt/a1/result"');
    expect(html).toContain(`>${es['examPrep.history.view']}<`);
    expect(html).toContain('href="/dashboard/exam-prep/attempt/a2"');
    expect(html).toContain(`>${es['exv2.action.continue']}<`);
    expect(html).not.toContain('href="/dashboard/exam-prep/attempt/a3"');
  });
});

describe('Mis exámenes cards', () => {
  const base: InstanceView = {
    id: 'i1', mode: 'MOCK', rigor: 'STANDARD', practiceLevel: null, timingMode: 'OFFICIAL_SIMULATION_TIMED', status: 'READY',
    exam: { definitionName: 'PAA (Prueba de Aptitud Académica)', family: 'PAA', versionLabel: 'V2.1' }, components: [{ id: 'c', name: 'Lectura' }],
    form: { fidelity: 'REDUCED', coveragePercent: 21, difficultyIndex: 1, targetDifficulty: 1, difficultyBandMet: true, notes: [], positions: 36, filled: 36 },
    frozen: true, simulationAttemptId: null, createdAt: '2026-10-01T12:00:00Z', completedAt: null, result: null,
  };
  const card = (over: Partial<InstanceView>) => renderToStaticMarkup(createElement(InstanceCard, { instance: { ...base, ...over }, labels, language: 'es' }));
  it.each(['DRAFT', 'READY', 'IN_PROGRESS', 'COMPLETED'] as const)('%s shows the ⋯ menu', (status) => {
    const html = card({ status, simulationAttemptId: status === 'IN_PROGRESS' || status === 'COMPLETED' ? 's1' : null, result: status === 'COMPLETED' ? { rawScore: 31, maxScore: 36 } : null, completedAt: status === 'COMPLETED' ? '2026-10-01T13:00:00Z' : null });
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label="Más acciones: PAA (Prueba de Aptitud Académica)"');
  });
  it('a completed card shows its date, result and "Ver resultados"', () => {
    const html = card({ status: 'COMPLETED', simulationAttemptId: 's1', result: { rawScore: 31, maxScore: 36 }, completedAt: '2026-10-01T13:00:00Z' });
    expect(html).toContain('Resultado: 31/36');
    expect(html).toContain('href="/dashboard/exam-prep/attempt/s1/result"');
  });
  it('an in-progress card shows "Continuar"', () => {
    expect(card({ status: 'IN_PROGRESS', simulationAttemptId: 's1' })).toContain('href="/dashboard/exam-prep/attempt/s1"');
  });
  it('the old bare "Eliminar" button is gone (deletion lives in the menu)', () => {
    expect(card({ status: 'READY' })).not.toContain(`>${es['exv2.action.delete']}</button>`);
  });
});
