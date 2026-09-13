/**
 * LX-8R2 R2/R3/R7/R14 -- MathSpeechParser grammar coverage.
 *
 * Every exact example phrase from the LX-8R2 spec (Spanish and
 * English) is asserted verbatim, plus broader coverage of each
 * required grammar category (numbers, variables, operators,
 * fractions, parentheses, powers, roots, comparisons, pi, absolute
 * value), the non-solving guarantee (R3), and fail-closed behavior on
 * unrecognized/ambiguous/incomplete input (R2/R7) rather than a
 * silent guess.
 */
import { describe, it, expect } from 'vitest';
import { parseMathSpeech, isMathSpeechSupported } from '@/lib/lx/math-speech-parser';

function latex(transcript: string, lang: 'es' | 'en'): string {
  const r = parseMathSpeech(transcript, lang);
  if (!r.ok) throw new Error(`expected ok parse for "${transcript}" (${lang}), got failure: ${r.reason} ${r.detail ?? ''}`);
  return r.latex;
}

/* ================================================================ *
 * Spec-exact examples -- Spanish                                    *
 * ================================================================ */
describe('MathSpeechParser -- exact Spanish spec examples', () => {
  it('"dos equis al cuadrado más cinco" -> 2x^2+5', () => {
    expect(latex('dos equis al cuadrado más cinco', 'es')).toBe('2x^{2}+5');
  });

  it('"abre paréntesis dos equis al cuadrado más cinco cierra paréntesis al cubo" -> (2x^2+5)^3', () => {
    expect(latex('abre paréntesis dos equis al cuadrado más cinco cierra paréntesis al cubo', 'es')).toBe('(2x^{2}+5)^{3}');
  });

  it('"raíz cuadrada de equis más tres" -> sqrt(x+3)', () => {
    expect(latex('raíz cuadrada de equis más tres', 'es')).toBe('\\sqrt{x+3}');
  });

  it('"un medio de equis" -> x/2 (as a proper fraction)', () => {
    expect(latex('un medio de equis', 'es')).toBe('\\frac{x}{2}');
  });

  it('"equis elevado a cuatro" -> x^4', () => {
    expect(latex('equis elevado a cuatro', 'es')).toBe('x^{4}');
  });
});

/* ================================================================ *
 * Spec-exact examples -- English                                    *
 * ================================================================ */
describe('MathSpeechParser -- exact English spec examples', () => {
  it('"two x squared plus five" -> 2x^2+5', () => {
    expect(latex('two x squared plus five', 'en')).toBe('2x^{2}+5');
  });

  it('"open parenthesis two x squared plus five close parenthesis cubed" -> (2x^2+5)^3', () => {
    expect(latex('open parenthesis two x squared plus five close parenthesis cubed', 'en')).toBe('(2x^{2}+5)^{3}');
  });

  it('"square root of x plus three" -> sqrt(x+3)', () => {
    expect(latex('square root of x plus three', 'en')).toBe('\\sqrt{x+3}');
  });

  it('"x to the fourth" -> x^4', () => {
    expect(latex('x to the fourth', 'en')).toBe('x^{4}');
  });
});

/* ================================================================ *
 * R16 manual-QA-script phrases (sqrt(x+3), (x+1)/(x-2), x^4,        *
 * "2x + 3 = 7" -- no solving/simplification) across both languages. *
 * ================================================================ */
describe('MathSpeechParser -- R16 manual QA script phrases, both languages agree on canonical form', () => {
  it('(x+1)/(x-2) via "divided by"/"dividido entre"', () => {
    expect(latex('open parenthesis x plus one close parenthesis divided by open parenthesis x minus two close parenthesis', 'en')).toBe(
      '\\frac{(x+1)}{(x-2)}',
    );
    expect(latex('abre paréntesis equis más uno cierra paréntesis dividido entre abre paréntesis equis menos dos cierra paréntesis', 'es')).toBe(
      '\\frac{(x+1)}{(x-2)}',
    );
  });

  it('"2x + 3 = 7" spoken form is never solved -- both sides preserved exactly as spoken', () => {
    expect(latex('two x plus three equals seven', 'en')).toBe('2x+3 = 7');
    expect(latex('dos equis más tres igual a siete', 'es')).toBe('2x+3 = 7');
  });

  it('typed, toolbar-built, Spanish-spoken, and English-spoken all agree on the same canonical expression for (2x^2+5)^3', () => {
    const typed = '(2x^{2}+5)^{3}'; // what a learner would type directly, or what toolbar structure-building would canonically serialize to
    expect(latex('abre paréntesis dos equis al cuadrado más cinco cierra paréntesis al cubo', 'es')).toBe(typed);
    expect(latex('open parenthesis two x squared plus five close parenthesis cubed', 'en')).toBe(typed);
  });
});

/* ================================================================ *
 * R3 -- never solves/simplifies/computes.                           *
 * ================================================================ */
describe('MathSpeechParser R3 -- never simplifies, factors, expands, or solves', () => {
  it('"two x plus two x" stays "2x+2x", never simplifies to "4x"', () => {
    expect(latex('two x plus two x', 'en')).toBe('2x+2x');
  });

  it('"two plus three times four" respects standard precedence in STRUCTURE only -- grouped as 2+(3×4), never evaluated to 20 or reordered to (2+3)×4', () => {
    expect(latex('two plus three times four', 'en')).toBe('2+3\\times 4');
  });

  it('an equation is never rearranged or solved for the variable', () => {
    expect(latex('two x plus three equals seven', 'en')).toBe('2x+3 = 7');
  });
});

/* ================================================================ *
 * Grammar categories -- numbers, variables, operators.               *
 * ================================================================ */
describe('MathSpeechParser -- numbers, variables, basic operators', () => {
  it('bare number', () => {
    expect(latex('seven', 'en')).toBe('7');
    expect(latex('siete', 'es')).toBe('7');
  });

  it('bare variable', () => {
    expect(latex('x', 'en')).toBe('x');
    expect(latex('equis', 'es')).toBe('x');
  });

  it('addition and subtraction', () => {
    expect(latex('three plus four', 'en')).toBe('3+4');
    expect(latex('three minus four', 'en')).toBe('3-4');
    expect(latex('tres más cuatro', 'es')).toBe('3+4');
    expect(latex('tres menos cuatro', 'es')).toBe('3-4');
  });

  it('explicit multiplication uses \\times, never bare juxtaposition, when an operator word was spoken', () => {
    expect(latex('three times four', 'en')).toBe('3\\times 4');
    expect(latex('tres por cuatro', 'es')).toBe('3\\times 4');
    expect(latex('x times y', 'en')).toBe('x\\times y');
  });

  it('coefficient*variable juxtaposition with no operator word', () => {
    expect(latex('two x', 'en')).toBe('2x');
    expect(latex('dos equis', 'es')).toBe('2x');
  });

  it('multiple named variables', () => {
    expect(latex('y', 'en')).toBe('y');
    expect(latex('n', 'en')).toBe('n');
    expect(latex('ye', 'es')).toBe('y');
    expect(latex('zeta', 'es')).toBe('z');
    expect(latex('ene', 'es')).toBe('n');
  });
});

/* ================================================================ *
 * Fractions.                                                        *
 * ================================================================ */
describe('MathSpeechParser -- fractions', () => {
  it('explicit division renders as a proper fraction (a representation transform, not a computed simplification)', () => {
    expect(latex('x divided by two', 'en')).toBe('\\frac{x}{2}');
    expect(latex('equis dividido entre dos', 'es')).toBe('\\frac{x}{2}');
  });

  it('spoken fraction words: one third, one quarter/fourth, one fifth', () => {
    expect(latex('one third of x', 'en')).toBe('\\frac{x}{3}');
    expect(latex('one quarter of x', 'en')).toBe('\\frac{x}{4}');
    expect(latex('one fourth of x', 'en')).toBe('\\frac{x}{4}');
    expect(latex('one fifth of x', 'en')).toBe('\\frac{x}{5}');
    expect(latex('un tercio de equis', 'es')).toBe('\\frac{x}{3}');
    expect(latex('un cuarto de equis', 'es')).toBe('\\frac{x}{4}');
    expect(latex('un quinto de equis', 'es')).toBe('\\frac{x}{5}');
  });

  it('a half / una mitad also map to the 2-denominator fraction word', () => {
    expect(latex('a half of x', 'en')).toBe('\\frac{x}{2}');
    expect(latex('una mitad de equis', 'es')).toBe('\\frac{x}{2}');
  });
});

/* ================================================================ *
 * Parentheses and grouped powers.                                   *
 * ================================================================ */
describe('MathSpeechParser -- parentheses and grouped powers', () => {
  it('a bare parenthesized group with no power suffix', () => {
    expect(latex('open parenthesis x plus one close parenthesis', 'en')).toBe('(x+1)');
    expect(latex('abre paréntesis equis más uno cierra paréntesis', 'es')).toBe('(x+1)');
  });

  it('a coefficient multiplying a parenthesized group', () => {
    expect(latex('two open parenthesis x plus one close parenthesis', 'en')).toBe('2(x+1)');
  });
});

/* ================================================================ *
 * Powers: squared, cubed, generic exponent -- binds to the base only,*
 * never to a preceding coefficient.                                  *
 * ================================================================ */
describe('MathSpeechParser -- powers bind to the base, not to a preceding coefficient', () => {
  it('"three x squared" is 3*(x^2), never (3x)^2', () => {
    expect(latex('three x squared', 'en')).toBe('3x^{2}');
  });

  it('"three x cubed" is 3*(x^3)', () => {
    expect(latex('three x cubed', 'en')).toBe('3x^{3}');
  });

  it('a bare number can itself be squared/cubed', () => {
    expect(latex('five squared', 'en')).toBe('5^{2}');
    expect(latex('cinco al cuadrado', 'es')).toBe('5^{2}');
  });

  it('generic exponent via "to the Nth" (English ordinal) / "elevado a N" (Spanish cardinal)', () => {
    expect(latex('x to the fifth', 'en')).toBe('x^{5}');
    expect(latex('equis elevado a cinco', 'es')).toBe('x^{5}');
  });

  it('a parenthesized group raised to a power applies to the whole group', () => {
    expect(latex('open parenthesis x plus one close parenthesis squared', 'en')).toBe('(x+1)^{2}');
  });
});

/* ================================================================ *
 * Roots: square, cube, and generic nth root.                        *
 * ================================================================ */
describe('MathSpeechParser -- square, cube, and nth roots', () => {
  it('cube root', () => {
    expect(latex('cube root of x', 'en')).toBe('\\sqrt[3]{x}');
    expect(latex('raíz cúbica de equis', 'es')).toBe('\\sqrt[3]{x}');
  });

  it('fourth and fifth root', () => {
    expect(latex('fourth root of x', 'en')).toBe('\\sqrt[4]{x}');
    expect(latex('fifth root of x', 'en')).toBe('\\sqrt[5]{x}');
    expect(latex('raíz cuarta de equis', 'es')).toBe('\\sqrt[4]{x}');
    expect(latex('raíz quinta de equis', 'es')).toBe('\\sqrt[5]{x}');
  });

  it('a root over a compound expression', () => {
    expect(latex('square root of x plus one', 'en')).toBe('\\sqrt{x+1}');
  });
});

/* ================================================================ *
 * Comparisons: <, >, <=, >=, =.                                     *
 * ================================================================ */
describe('MathSpeechParser -- equality and inequalities', () => {
  it('less than / greater than', () => {
    expect(latex('x less than five', 'en')).toBe('x < 5');
    expect(latex('x greater than five', 'en')).toBe('x > 5');
    expect(latex('equis menor que cinco', 'es')).toBe('x < 5');
    expect(latex('equis mayor que cinco', 'es')).toBe('x > 5');
  });

  it('less/greater than or equal to', () => {
    expect(latex('x less than or equal to five', 'en')).toBe('x \\leq 5');
    expect(latex('x greater than or equal to five', 'en')).toBe('x \\geq 5');
    expect(latex('equis menor o igual que cinco', 'es')).toBe('x \\leq 5');
    expect(latex('equis mayor o igual que cinco', 'es')).toBe('x \\geq 5');
  });

  it('equals ("is equal to" / "igual a")', () => {
    expect(latex('x is equal to five', 'en')).toBe('x = 5');
    expect(latex('equis igual a cinco', 'es')).toBe('x = 5');
  });
});

/* ================================================================ *
 * Pi and absolute value.                                            *
 * ================================================================ */
describe('MathSpeechParser -- pi and absolute value', () => {
  it('pi alone and as a coefficbraced term', () => {
    expect(latex('pi', 'en')).toBe('\\pi ');
    expect(latex('two pi', 'en')).toBe('2\\pi ');
    expect(latex('dos pi', 'es')).toBe('2\\pi ');
  });

  it('absolute value of a compound expression', () => {
    expect(latex('absolute value of x minus one', 'en')).toBe('\\left|x-1\\right|');
    expect(latex('valor absoluto de equis menos uno', 'es')).toBe('\\left|x-1\\right|');
  });
});

/* ================================================================ *
 * R2/R7 -- fail-closed on unrecognized/incomplete/ambiguous input.  *
 * ================================================================ */
describe('MathSpeechParser -- fails closed rather than guessing (R2/R7)', () => {
  it('empty transcript', () => {
    expect(parseMathSpeech('', 'en')).toEqual({ ok: false, reason: 'EMPTY_TRANSCRIPT' });
    expect(parseMathSpeech('   ', 'es')).toEqual({ ok: false, reason: 'EMPTY_TRANSCRIPT' });
  });

  it('an unrecognized word never gets silently dropped or guessed at', () => {
    const r = parseMathSpeech('the quick brown fox', 'en');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('UNRECOGNIZED_WORD');
  });

  it('an incomplete expression (dangling operator) fails rather than assuming a missing operand', () => {
    const r = parseMathSpeech('two plus', 'en');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('INCOMPLETE_EXPRESSION');
  });

  it('an unmatched opening parenthesis fails rather than auto-closing it', () => {
    const r = parseMathSpeech('open parenthesis x plus one', 'en');
    expect(r.ok).toBe(false);
  });

  it('trailing unparsed words after a complete expression fail rather than being silently ignored', () => {
    const r = parseMathSpeech('two x plus five five', 'en');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('INCOMPLETE_EXPRESSION');
  });

  it('a root/absolute-value word with no following "of" fails rather than guessing an operand', () => {
    const r = parseMathSpeech('square root x', 'en');
    expect(r.ok).toBe(false);
  });

  it('R10: a compound spoken number outside the supported 0-20 vocabulary (e.g. "twenty five" for 25) fails closed rather than silently dropping a word or misreading it as two separate numbers', () => {
    const r = parseMathSpeech('twenty five', 'en');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('INCOMPLETE_EXPRESSION'); // both words are individually recognized (20, 5) but cannot be joined into one expression
  });

  it('R10: a literal digit string of any length (not limited to the 0-20 word vocabulary) still parses -- STT transcribing digits directly is unaffected by the spoken-word range limit', () => {
    const r = parseMathSpeech('42', 'en');
    expect(r).toEqual({ ok: true, latex: '42' });
  });
});

/* ================================================================ *
 * R14 -- architecture allows a future language without editor      *
 * changes; an unsupported locale fails closed, never falls back to  *
 * another language's vocabulary.                                    *
 * ================================================================ */
describe('MathSpeechParser R14 -- language table is isolated per locale; unsupported locales fail closed', () => {
  it('isMathSpeechSupported reports es/en supported today', () => {
    expect(isMathSpeechSupported('es')).toBe(true);
    expect(isMathSpeechSupported('en')).toBe(true);
  });

  it('German (not yet implemented) is reported unsupported and fails closed rather than silently using English/Spanish grammar', () => {
    expect(isMathSpeechSupported('de')).toBe(false);
    const r = parseMathSpeech('zwei x zum quadrat', 'de');
    expect(r).toEqual({ ok: false, reason: 'UNSUPPORTED_LANGUAGE', detail: 'de' });
  });

  it('Spanish vocabulary never leaks into an English parse or vice versa', () => {
    expect(parseMathSpeech('dos equis', 'en').ok).toBe(false);
    expect(parseMathSpeech('two x', 'es').ok).toBe(false);
  });
});

/* ================================================================ *
 * Diacritic robustness -- STT output may or may not include accents.*
 * ================================================================ */
describe('MathSpeechParser -- Spanish accented and unaccented STT spellings both parse identically', () => {
  it('"más"/"mas", "raíz"/"raiz" are treated the same', () => {
    expect(latex('dos mas tres', 'es')).toBe(latex('dos más tres', 'es'));
    expect(latex('raiz cuadrada de equis', 'es')).toBe(latex('raíz cuadrada de equis', 'es'));
  });
});
