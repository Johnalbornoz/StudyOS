import { describe, it, expect } from 'vitest';
import {
  MATH_BUTTONS,
  mathToolbarConfig,
  inferMathToolbarSubject,
  buttonsForCategory,
  priorityButtons,
} from '@/lib/math-toolbar-config';
import { getMessages } from '@/lib/i18n/messages';

describe('MATH_BUTTONS', () => {
  it('has unique ids', () => {
    const ids = MATH_BUTTONS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every literal button has non-empty insertText', () => {
    for (const b of MATH_BUTTONS) {
      if (b.kind === 'literal') expect(b.insertText.length).toBeGreaterThan(0);
    }
  });

  it('every structure button uses MathLive\'s own \\placeholder{} command for its editable slots (except fixed x^2)', () => {
    for (const b of MATH_BUTTONS) {
      if (b.kind === 'structure' && b.id !== 'square') {
        expect(b.latex).toContain('\\placeholder{}');
      }
    }
  });

  it('every button has a labelKey that resolves to real, non-empty text in all 5 locales', () => {
    for (const locale of ['es', 'en', 'de', 'fr', 'pt'] as const) {
      const t = getMessages(locale);
      for (const b of MATH_BUTTONS) {
        const label = t[b.labelKey as keyof typeof t];
        expect(label, `${b.id} (${locale})`).toBeTruthy();
        expect(String(label).length, `${b.id} (${locale})`).toBeGreaterThan(0);
      }
    }
  });
});

describe('inferMathToolbarSubject', () => {
  it('detects physics by name in multiple languages', () => {
    expect(inferMathToolbarSubject('Physics HL')).toBe('physics');
    expect(inferMathToolbarSubject('Física')).toBe('physics');
  });

  it('detects mathematics by name', () => {
    expect(inferMathToolbarSubject('Mathematics AA')).toBe('mathematics');
    expect(inferMathToolbarSubject('Matemáticas')).toBe('mathematics');
  });

  it('detects chemistry by name', () => {
    expect(inferMathToolbarSubject('Chemistry SL')).toBe('chemistry');
    expect(inferMathToolbarSubject('Química')).toBe('chemistry');
  });

  it('falls back to default for anything else, including empty/missing names', () => {
    expect(inferMathToolbarSubject('History')).toBe('default');
    expect(inferMathToolbarSubject(null)).toBe('default');
    expect(inferMathToolbarSubject(undefined)).toBe('default');
    expect(inferMathToolbarSubject('')).toBe('default');
  });
});

describe('priorityButtons / buttonsForCategory / mathToolbarConfig', () => {
  it('every id referenced in mathToolbarConfig exists as a real button', () => {
    for (const ids of Object.values(mathToolbarConfig)) {
      for (const id of ids) {
        expect(MATH_BUTTONS.some((b) => b.id === id), `missing button for id "${id}"`).toBe(true);
      }
    }
  });

  it('priorityButtons resolves every configured id to its actual button object', () => {
    const buttons = priorityButtons('physics');
    expect(buttons.length).toBe(mathToolbarConfig.physics.length);
    expect(buttons.map((b) => b.id)).toEqual(mathToolbarConfig.physics);
  });

  it('buttonsForCategory only returns buttons from that category', () => {
    const structures = buttonsForCategory('structures');
    expect(structures.length).toBeGreaterThan(0);
    expect(structures.every((b) => b.category === 'structures')).toBe(true);
  });

  it('every category has at least one button', () => {
    for (const category of ['basic', 'structures', 'greek', 'physics', 'more'] as const) {
      expect(buttonsForCategory(category).length).toBeGreaterThan(0);
    }
  });
});
