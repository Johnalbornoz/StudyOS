import { describe, it, expect } from 'vitest';
import { parseMathText } from '@/lib/math-text';

describe('parseMathText', () => {
  it('a plain string with no $ round-trips as a single text segment -- every historical answer is unaffected', () => {
    const input = 'The force points toward the centre because it changes the direction of velocity.';
    expect(parseMathText(input)).toEqual([{ type: 'text', value: input }]);
  });

  it('an empty string is a single empty text segment', () => {
    expect(parseMathText('')).toEqual([{ type: 'text', value: '' }]);
  });

  it('parses a single inline math segment surrounded by text', () => {
    const input = 'The equation is $F_c=\\frac{mv^2}{r}$, directed toward the center.';
    expect(parseMathText(input)).toEqual([
      { type: 'text', value: 'The equation is ' },
      { type: 'math', value: 'F_c=\\frac{mv^2}{r}' },
      { type: 'text', value: ', directed toward the center.' },
    ]);
  });

  it('parses math at the very start of the string (no leading text segment)', () => {
    const input = '$x^2$ is the square of x';
    expect(parseMathText(input)).toEqual([
      { type: 'math', value: 'x^2' },
      { type: 'text', value: ' is the square of x' },
    ]);
  });

  it('parses math at the very end of the string (no trailing text segment)', () => {
    const input = 'the square of x is $x^2$';
    expect(parseMathText(input)).toEqual([
      { type: 'text', value: 'the square of x is ' },
      { type: 'math', value: 'x^2' },
    ]);
  });

  it('parses multiple separate math segments', () => {
    const input = 'First $a+b$ then $c+d$ done';
    expect(parseMathText(input)).toEqual([
      { type: 'text', value: 'First ' },
      { type: 'math', value: 'a+b' },
      { type: 'text', value: ' then ' },
      { type: 'math', value: 'c+d' },
      { type: 'text', value: ' done' },
    ]);
  });

  it('a string that is only a math expression produces a single math segment', () => {
    expect(parseMathText('$\\pi r^2$')).toEqual([{ type: 'math', value: '\\pi r^2' }]);
  });

  it('an unterminated trailing $ does not crash, and everything before it still parses', () => {
    const input = 'partial $a+b$ and a stray $ at the end';
    const result = parseMathText(input);
    expect(result[0]).toEqual({ type: 'text', value: 'partial ' });
    expect(result[1]).toEqual({ type: 'math', value: 'a+b' });
    expect(result.map((s) => s.value).join('')).not.toContain('undefined');
  });

  it('parses a $$...$$ block equation as a single display-math segment, never as two adjacent inline segments with stray $ left over', () => {
    const input = 'Calculate the limit: $$\\lim_{x \\to 2} \\frac{x^2 - 4}{x - 2}$$ Show the algebraic steps.';
    expect(parseMathText(input)).toEqual([
      { type: 'text', value: 'Calculate the limit: ' },
      { type: 'math', value: '\\lim_{x \\to 2} \\frac{x^2 - 4}{x - 2}', display: true },
      { type: 'text', value: ' Show the algebraic steps.' },
    ]);
  });

  it('a string that is only a $$...$$ block produces a single display-math segment', () => {
    expect(parseMathText('$$\\int_0^1 x^2\\,dx$$')).toEqual([{ type: 'math', value: '\\int_0^1 x^2\\,dx', display: true }]);
  });

  it('a plain inline $...$ segment has no `display` key at all (never `display: false`), so old callers/tests comparing the bare {type, value} shape are unaffected', () => {
    const [, mathSeg] = parseMathText('The equation is $F=ma$ here.');
    expect(mathSeg).not.toHaveProperty('display');
  });

  it('$$...$$ and $...$ can both appear in the same string, each correctly identified', () => {
    const input = 'Block: $$a^2+b^2=c^2$$ and inline $x=1$ too.';
    expect(parseMathText(input)).toEqual([
      { type: 'text', value: 'Block: ' },
      { type: 'math', value: 'a^2+b^2=c^2', display: true },
      { type: 'text', value: ' and inline ' },
      { type: 'math', value: 'x=1' },
      { type: 'text', value: ' too.' },
    ]);
  });

  it('a $$...$$ block spanning what looks like multiple inline pairs is not misparsed -- the whole thing is one display segment', () => {
    // Without $$-first matching, a naive $...$ regex would treat this as
    // two inline segments ("frac{a" and "b}") with stray $ characters left over.
    const input = '$$\\frac{a}{b}$$';
    expect(parseMathText(input)).toEqual([{ type: 'math', value: '\\frac{a}{b}', display: true }]);
  });
});
