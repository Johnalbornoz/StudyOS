/**
 * DifficultyIndicator -- "Dificultad" + 5 segments + tier label; no "X/5"
 * visually; accessible "Dificultad: nivel 2 de 5, Básico".
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMessages } from '@/lib/i18n/messages';
import { getDifficultyIndicatorModel } from '@/lib/lx/difficulty-presentation';
import DifficultyIndicator from '@/components/DifficultyIndicator';

const es = getMessages('es');
const visibleText = (html: string) => html.replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '');

describe('model', () => {
  it('tier labels per spec: Inicial, Básico, Intermedio, Avanzado, Reto', () => {
    expect([1, 2, 3, 4, 5].map((v) => getDifficultyIndicatorModel({ value: v }, es).label)).toEqual(['Inicial', 'Básico', 'Intermedio', 'Avanzado', 'Reto']);
  });

  it('segments fill according to the level', () => {
    expect(getDifficultyIndicatorModel({ value: 2 }, es).segments).toEqual(['filled', 'filled', 'empty', 'empty', 'empty']);
    expect(getDifficultyIndicatorModel({ value: 5 }, es).segments).toEqual(['filled', 'filled', 'filled', 'filled', 'filled']);
  });

  it('accessible text keeps "Dificultad: nivel 2 de 5, Básico"', () => {
    expect(getDifficultyIndicatorModel({ value: 2 }, es).accessible).toBe('Dificultad: nivel 2 de 5, Básico');
  });

  it('a range (Results / Prove contract) shows both tiers and a range segment', () => {
    const m = getDifficultyIndicatorModel({ range: { min: 3, max: 4 } }, es);
    expect(m.label).toBe('Intermedio – Avanzado');
    expect(m.segments).toEqual(['filled', 'filled', 'filled', 'range', 'empty']);
    expect(m.accessible).toBe('Dificultad: nivel 3 a 4 de 5, Intermedio a Avanzado');
  });

  it('never invents difficulty: out-of-range input is only clamped', () => {
    expect(getDifficultyIndicatorModel({ value: 9 }, es).min).toBe(5);
    expect(getDifficultyIndicatorModel({ value: 0 }, es).min).toBe(1);
  });

  it('ready for adaptive changes: a trend is carried (↑/↓) with accessible wording', () => {
    const up = getDifficultyIndicatorModel({ value: 3 }, es, 'up');
    expect(up.trend).toBe('up');
    expect(up.trendAccessible).toBe(es['difficulty.trendUp']);
    expect(getDifficultyIndicatorModel({ value: 3 }, es).trend).toBeNull();
  });

  it('respects the language it is given', () => {
    expect(getDifficultyIndicatorModel({ value: 5 }, getMessages('en')).accessible).toBe('Difficulty: level 5 of 5, Challenge');
  });
});

describe('component', () => {
  it('renders "Dificultad", 5 segments and the tier -- never "X/5" visibly', () => {
    const html = renderToStaticMarkup(createElement(DifficultyIndicator, { t: es, value: 2 }));
    expect(html.match(/data-segment=/g)).toHaveLength(5);
    const text = visibleText(html);
    expect(text).toContain('Dificultad');
    expect(text).toContain('Básico');
    expect(text).not.toMatch(/\d\s*\/\s*5/);
    expect(html).toContain('Dificultad: nivel 2 de 5, Básico');
  });

  it('renders the trend arrow only when given', () => {
    expect(renderToStaticMarkup(createElement(DifficultyIndicator, { t: es, value: 3, trend: 'down' }))).toContain('data-trend="down"');
    expect(renderToStaticMarkup(createElement(DifficultyIndicator, { t: es, value: 3 }))).not.toContain('data-trend');
  });
});

describe('applied across the Learning Engine surfaces', () => {
  it('every activity question, the Results summary and the Prove contract use the indicator; no "X/5" formatter remains in the UI', () => {
    const quiz = readFileSync(join(process.cwd(), 'src/app/dashboard/quiz/page.tsx'), 'utf-8');
    const prove = readFileSync(join(process.cwd(), 'src/components/ProveFocusLoading.tsx'), 'utf-8');
    expect(quiz).toMatch(/<DifficultyIndicator value=\{q\.difficulty\} t=\{at\} \/>/);
    expect(quiz).toMatch(/<DifficultyIndicator\s+t=\{at\}\s+range=\{\{/);
    expect(prove).toMatch(/<DifficultyIndicator t=\{at\} range=\{difficultyRange\} size="xs" \/>/);
    for (const src of [quiz, prove]) {
      expect(src).not.toMatch(/formatDifficultyCompact|formatDifficultyWorked|DifficultyBadge/);
    }
  });
});
