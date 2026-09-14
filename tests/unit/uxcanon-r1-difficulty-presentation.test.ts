/**
 * UX/CANON-R1 -- required tests 1-11 (DIFFICULTY).
 *
 * Difficulty is SYSTEM-DEFINED, LEARNER-VISIBLE, NOT LEARNER-EDITABLE.
 * `getDifficultyPresentation` is the ONE presentation authority --
 * these tests prove it maps the ALREADY-canonical 1-5 value to the
 * correct localized label and nothing more (never a second difficulty
 * algorithm), and that the active-question/Results surfaces render it
 * without ever introducing an editable control.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

import { getDifficultyPresentation, formatDifficultyCompact, formatDifficultyAccessible, formatDifficultyWorked } from '@/lib/lx/difficulty-presentation';
import { getMessages } from '@/lib/i18n/messages';

const es = getMessages('es');
const en = getMessages('en');

/* ================================================================= *
 * REQUIRED TESTS 1-5 -- the five tier labels.                          *
 * ================================================================= */
describe('UX/CANON-R1 1-5 -- getDifficultyPresentation maps each canonical level to its ES label', () => {
  it('1. difficulty 1 -> Inicial', () => {
    expect(getDifficultyPresentation(1, es)).toEqual({ value: 1, max: 5, label: 'Inicial' });
  });
  it('2. difficulty 2 -> Básica', () => {
    expect(getDifficultyPresentation(2, es)).toEqual({ value: 2, max: 5, label: 'Básica' });
  });
  it('3. difficulty 3 -> Intermedia', () => {
    expect(getDifficultyPresentation(3, es)).toEqual({ value: 3, max: 5, label: 'Intermedia' });
  });
  it('4. difficulty 4 -> Alta', () => {
    expect(getDifficultyPresentation(4, es)).toEqual({ value: 4, max: 5, label: 'Alta' });
  });
  it('5. difficulty 5 -> Avanzada', () => {
    expect(getDifficultyPresentation(5, es)).toEqual({ value: 5, max: 5, label: 'Avanzada' });
  });

  it('the EN locale maps the same 5 levels correctly', () => {
    expect(getDifficultyPresentation(1, en).label).toBe('Initial');
    expect(getDifficultyPresentation(2, en).label).toBe('Basic');
    expect(getDifficultyPresentation(3, en).label).toBe('Intermediate');
    expect(getDifficultyPresentation(4, en).label).toBe('High');
    expect(getDifficultyPresentation(5, en).label).toBe('Advanced');
  });

  it('clamps a malformed/out-of-range value defensively -- never invents a 6th tier', () => {
    expect(getDifficultyPresentation(0, es).value).toBe(1);
    expect(getDifficultyPresentation(9, es).value).toBe(5);
    expect(getDifficultyPresentation(3.6, es).value).toBe(4); // rounds, never truncates silently
  });
});

/* ================================================================= *
 * REQUIRED TEST 6 -- active question shows canonical difficulty.       *
 * ================================================================= */
describe('UX/CANON-R1 6 -- the active question surface shows canonical difficulty', () => {
  it('quiz/page.tsx renders DifficultyBadge with the current question\'s own canonical difficulty', () => {
    const SRC = read('src/app/dashboard/quiz/page.tsx');
    expect(SRC).toMatch(/<DifficultyBadge difficulty=\{q\.difficulty\} t=\{at\} \/>/);
  });

  it('the compact visible text matches the required format ("Dificultad 4/5 · Alta")', () => {
    const p = getDifficultyPresentation(4, es);
    expect(formatDifficultyCompact(p, es)).toBe('Dificultad 4/5 · Alta');
  });

  it('the accessible text matches the recommended format ("Dificultad 4 de 5, Alta")', () => {
    const p = getDifficultyPresentation(4, es);
    expect(formatDifficultyAccessible(p, es)).toBe('Dificultad 4 de 5, Alta');
  });
});

/* ================================================================= *
 * REQUIRED TEST 7 -- Results show completed difficulty.                *
 * ================================================================= */
describe('UX/CANON-R1 7 -- Results shows the difficulty the activity was worked at', () => {
  it('quiz/page.tsx renders formatDifficultyWorked from the session\'s own question difficulties', () => {
    const SRC = read('src/app/dashboard/quiz/page.tsx');
    expect(SRC).toMatch(/formatDifficultyWorked\(at, \{/);
    expect(SRC).toMatch(/min: Math\.min\(\.\.\.questions\.map\(\(q\) => q\.difficulty\)\)/);
  });

  it('a single-difficulty activity shows one value, never inventing an average', () => {
    expect(formatDifficultyWorked(es, { min: 4, max: 4 })).toBe('Dificultad trabajada: 4/5 · Alta');
  });

  it('a mixed-difficulty activity shows a range, not an average', () => {
    const text = formatDifficultyWorked(es, { min: 3, max: 4 });
    expect(text).toBe('Dificultad trabajada: 3–4/5');
    expect(text).not.toMatch(/\d\.\d/); // no invented decimal average
  });
});

/* ================================================================= *
 * REQUIRED TESTS 8-9 -- learner cannot modify difficulty; no          *
 * selector/control introduced.                                        *
 * ================================================================= */
describe('UX/CANON-R1 8-9 -- difficulty remains system-defined, never learner-editable', () => {
  it('8. DifficultyBadge exposes no way to change the value -- no onChange, no setState, no callback prop', () => {
    const SRC = read('src/app/dashboard/quiz/DifficultyBadge.tsx');
    expect(SRC).not.toMatch(/onChange|onClick|onSelect|setDifficulty/);
    expect(SRC).not.toMatch(/useState/);
  });

  it('9. no selector/slider/dropdown/range control was introduced anywhere for difficulty', () => {
    const badgeSrc = read('src/app/dashboard/quiz/DifficultyBadge.tsx');
    const presentationSrc = read('src/lib/lx/difficulty-presentation.ts');
    for (const src of [badgeSrc, presentationSrc]) {
      expect(src).not.toMatch(/<select/i);
      expect(src).not.toMatch(/type=["']range["']/);
      expect(src).not.toMatch(/<input/i);
    }
    const quizSrc = read('src/app/dashboard/quiz/page.tsx');
    expect(quizSrc).not.toMatch(/<select[^>]*difficulty/i);
    expect(quizSrc).not.toMatch(/onChange.*setDifficulty/);
  });

  it('DifficultyBadge is not a control: no interactive ARIA role, not keyboard-focusable', () => {
    const SRC = read('src/app/dashboard/quiz/DifficultyBadge.tsx');
    expect(SRC).not.toMatch(/role=["'](button|slider|combobox|listbox)["']/);
    expect(SRC).not.toMatch(/tabIndex/);
  });
});

/* ================================================================= *
 * REQUIRED TEST 10 -- active learning uses ACTIVITY_LANGUAGE.          *
 * ================================================================= */
describe('UX/CANON-R1 10 -- difficulty labels follow ACTIVITY_LANGUAGE, never the shell/interface locale', () => {
  it('quiz/page.tsx passes the activity-language messages (`at`), not a global interface `t`, to DifficultyBadge', () => {
    const SRC = read('src/app/dashboard/quiz/page.tsx');
    // The exact same `at` LearningSupportStatus/ContextualHelp/every other
    // active-learning string on this screen already uses.
    expect(SRC).toMatch(/<DifficultyBadge difficulty=\{q\.difficulty\} t=\{at\} \/>/);
    expect(SRC).not.toMatch(/<DifficultyBadge[^>]*t=\{t\}/); // never the shell-language `t`
  });

  it('no locale is hardcoded into DifficultyBadge or difficulty-presentation.ts -- both take `t` as a parameter', () => {
    const badgeSrc = read('src/app/dashboard/quiz/DifficultyBadge.tsx');
    const presentationSrc = read('src/lib/lx/difficulty-presentation.ts');
    expect(badgeSrc).not.toMatch(/'es'|"es"|Español/);
    expect(presentationSrc).not.toMatch(/'es'|"es"|Español/);
  });

  it('all 5 supported locales define every difficulty message key -- getMessages never falls back to a missing key', () => {
    for (const locale of ['es', 'en', 'de', 'fr', 'pt'] as const) {
      const t = getMessages(locale);
      for (let d = 1; d <= 5; d++) {
        expect(getDifficultyPresentation(d, t).label).toBeTruthy();
      }
      expect(t['difficulty.label']).toBeTruthy();
      expect(t['difficulty.of']).toBeTruthy();
    }
  });
});

/* ================================================================= *
 * REQUIRED TEST 11 -- no second difficulty algorithm exists.           *
 * ================================================================= */
describe('UX/CANON-R1 11 -- no second difficulty algorithm exists', () => {
  it('getDifficultyPresentation only clamps and labels an ALREADY-canonical value -- it computes no score, no threshold, no policy', () => {
    const SRC = read('src/lib/lx/difficulty-presentation.ts');
    // Real usage signal, not a prose ban -- the doc comment may explain
    // WHERE canonical difficulty comes from; the CODE itself must never
    // read a raw dimension score/state/policy to derive one.
    expect(SRC).not.toMatch(/\.understandingScore|\.masteryState|\.evidenceCount|resolveTargetDifficulty\(/);
    expect(SRC).toMatch(/NEVER re-derives, re-computes, or overrides/);
  });

  it('describeDifficultyTier (the ONE canonical difficulty-semantics authority, quiz-generation.service.ts) is untouched by this phase', () => {
    const SRC = read('src/services/quiz-generation.service.ts');
    expect(SRC).toMatch(/export function describeDifficultyTier\(difficulty: number\): string/);
  });
});
