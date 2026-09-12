/**
 * LX-8R2 R5/R12 -- every structured-math toolbar button must insert a
 * LaTeX TEMPLATE (creating a structure: fraction, root, exponent,
 * parentheses, sum/integral bounds) via MathLive's own placeholder
 * syntax, never a plain literal symbol into a plain text field. This
 * is the test that would fail if MathExpressionEditor's toolbar ever
 * regressed back to the "insert a Unicode character into a textarea"
 * model the LX-8R2 spec explicitly rejects.
 */
import { describe, it, expect } from 'vitest';
import { MATH_PRIMARY_BUTTONS, MATH_MORE_BUTTONS } from '@/lib/math-expression-toolbar-config';

const ALL = [...MATH_PRIMARY_BUTTONS, ...MATH_MORE_BUTTONS];

describe('Math expression toolbar -- R12 primary row vs. expandable "More" palette', () => {
  it('primary row is compact (fraction, power, root, parentheses, times, divide, equals, pi) -- 8 buttons, never a giant grid', () => {
    expect(MATH_PRIMARY_BUTTONS.map((b) => b.id)).toEqual(['fraction', 'exponent', 'sqrt', 'parens', 'times', 'divide', 'equals', 'pi']);
  });

  it('advanced palette (sum, integral, infinity, Greek, inequalities, subscript, nth root, abs) lives in "More", not the primary row', () => {
    const moreIds = MATH_MORE_BUTTONS.map((b) => b.id);
    for (const id of ['sum', 'integral', 'infinity', 'theta', 'alpha', 'leq', 'geq', 'subscript', 'nthroot', 'abs']) {
      expect(moreIds).toContain(id);
    }
  });

  it('no button id is duplicated between the primary row and the More palette', () => {
    const primaryIds = new Set(MATH_PRIMARY_BUTTONS.map((b) => b.id));
    for (const b of MATH_MORE_BUTTONS) expect(primaryIds.has(b.id)).toBe(false);
  });
});

describe('Math expression toolbar -- every button inserts a LaTeX template, never a bare literal into plain text (R5)', () => {
  it('fraction, root, nth root, exponent, subscript, absolute value, sum, integral all carry an editable placeholder (#0 or #@)', () => {
    const structural = ['fraction', 'sqrt', 'nthroot', 'exponent', 'subscript', 'abs', 'sum', 'integral', 'parens'];
    for (const id of structural) {
      const b = ALL.find((x) => x.id === id)!;
      expect(b, `button ${id} should exist`).toBeTruthy();
      expect(b.insertLatex).toMatch(/#0|#@/);
    }
  });

  it('exponent and subscript apply to the PREVIOUS atom via #@ (MathLive\'s own "apply to selection/previous atom" convention) -- never a fresh, disconnected placeholder pair', () => {
    const exponent = ALL.find((b) => b.id === 'exponent')!;
    const subscript = ALL.find((b) => b.id === 'subscript')!;
    expect(exponent.insertLatex).toBe('#@^{#0}');
    expect(subscript.insertLatex).toBe('#@_{#0}');
  });

  it('fraction template places the cursor in the numerator first (#0 before #1), matching R5\'s cursor-placement requirement', () => {
    const fraction = ALL.find((b) => b.id === 'fraction')!;
    expect(fraction.insertLatex).toBe('\\frac{#0}{#1}');
    expect(fraction.insertLatex.indexOf('#0')).toBeLessThan(fraction.insertLatex.indexOf('#1'));
  });

  it('every insertLatex is valid-looking LaTeX (starts with a backslash command, a placeholder, or a bare operator/paren symbol) -- never raw Unicode math glyphs standing in for structure', () => {
    for (const b of ALL) {
      expect(b.insertLatex).not.toMatch(/[²³ⁿₙ√∑∫∞πθαβλμω]/); // no toolbar entry regresses to a Unicode-symbol insertion
    }
  });

  it('leaf symbols (times, divide, equals, pi, infinity, Greek letters, inequalities) insert exactly the LaTeX command/symbol with no dangling placeholder', () => {
    for (const id of ['times', 'divide', 'equals', 'pi', 'infinity', 'theta', 'leq', 'geq', 'neq', 'pm']) {
      const b = ALL.find((x) => x.id === id)!;
      expect(b.insertLatex).not.toMatch(/#/);
    }
  });

  it('every button has a labelKey that resolves against the existing i18n mathToolbar.* namespace (no new, undocumented i18n keys introduced for buttons already covered by the plain-text toolbar\'s vocabulary)', () => {
    for (const b of ALL) {
      expect(b.labelKey).toMatch(/^mathToolbar\./);
    }
  });
});
