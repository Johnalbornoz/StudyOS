/**
 * QB-R2C -- a small arithmetic evaluator for the answer check of a mathematics candidate (pure, no IO).
 *
 * The independent validators use it to RECOMPUTE a keyed number from the arithmetic the candidate declares
 * (`answerCheck.expression`). It is deliberately tiny and closed: numbers, + - * / (also × ÷ · and the unicode
 * minus), ^ for powers, parentheses, unary minus, and sqrt( ). No identifiers, no variables, no function but
 * sqrt, and no `eval`: the text is tokenised and parsed by hand, and anything else is a named error.
 *
 * Numbers use a POINT as the decimal separator: an expression is written by the generator, not typed by a
 * learner, so there is no separator to interpret. A comma is refused.
 *
 * It proves one thing only: that the key equals what the declared arithmetic gives. Whether that arithmetic is
 * the right model of the question is a judgement for a reviewer.
 */
export type ExpressionErrorCode = 'EMPTY_EXPRESSION' | 'UNEXPECTED_CHARACTER' | 'UNEXPECTED_TOKEN' | 'UNBALANCED_PARENTHESES' | 'DIVISION_BY_ZERO' | 'SQRT_OF_NEGATIVE' | 'NOT_FINITE' | 'EXPRESSION_TOO_LONG';
export class ExpressionError extends Error {
  constructor(public readonly code: ExpressionErrorCode, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ExpressionError';
  }
}

type Token = { t: 'num'; v: number } | { t: 'op'; v: '+' | '-' | '*' | '/' | '^' } | { t: '(' } | { t: ')' } | { t: 'sqrt' };
const MAX_LENGTH = 500;

function tokenize(src: string): Token[] {
  const s = src.replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/');
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (/\d|\./.test(ch)) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(s.slice(i));
      if (!m) throw new ExpressionError('UNEXPECTED_CHARACTER', ch);
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if ('+-*/^'.includes(ch)) {
      out.push({ t: 'op', v: ch as '+' });
      i += 1;
    } else if (ch === '(' || ch === ')') {
      out.push({ t: ch });
      i += 1;
    } else if (s.startsWith('sqrt', i) || ch === '√') {
      out.push({ t: 'sqrt' });
      i += ch === '√' ? 1 : 4;
    } else {
      throw new ExpressionError('UNEXPECTED_CHARACTER', ch);
    }
  }
  return out;
}

/**
 * expr   := term (('+' | '-') term)*
 * term   := unary (('*' | '/') unary)*
 * unary  := '-' unary | power
 * power  := atom ('^' unary)?            right-associative; -2^2 is -(2^2)
 * atom   := number | '(' expr ')' | sqrt '(' expr ')'
 */
export function evaluateExpression(src: string): number {
  if (src.trim().length === 0) throw new ExpressionError('EMPTY_EXPRESSION');
  if (src.length > MAX_LENGTH) throw new ExpressionError('EXPRESSION_TOO_LONG');
  const tokens = tokenize(src);
  let at = 0;
  const peek = (): Token | undefined => tokens[at];
  const isOp = (v: string): boolean => { const k = peek(); return !!k && k.t === 'op' && k.v === v; };
  const group = (): number => {
    if (peek()?.t !== '(') throw new ExpressionError('UNEXPECTED_TOKEN', 'expected (');
    at += 1;
    const v = expr();
    if (peek()?.t !== ')') throw new ExpressionError('UNBALANCED_PARENTHESES');
    at += 1;
    return v;
  };
  const atom = (): number => {
    const k = peek();
    if (!k) throw new ExpressionError('UNEXPECTED_TOKEN', 'end of expression');
    if (k.t === 'num') {
      at += 1;
      return k.v;
    }
    if (k.t === '(') return group();
    if (k.t === 'sqrt') {
      at += 1;
      const v = group();
      if (v < 0) throw new ExpressionError('SQRT_OF_NEGATIVE');
      return Math.sqrt(v);
    }
    throw new ExpressionError(k.t === ')' ? 'UNBALANCED_PARENTHESES' : 'UNEXPECTED_TOKEN', k.t === 'op' ? k.v : k.t);
  };
  const power = (): number => {
    const base = atom();
    if (!isOp('^')) return base;
    at += 1;
    return Math.pow(base, unary());
  };
  const unary = (): number => {
    if (isOp('-')) {
      at += 1;
      return -unary();
    }
    return power();
  };
  const term = (): number => {
    let v = unary();
    while (isOp('*') || isOp('/')) {
      const op = (tokens[at] as { v: string }).v;
      at += 1;
      const r = unary();
      if (op === '/' && r === 0) throw new ExpressionError('DIVISION_BY_ZERO');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  function expr(): number {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[at] as { v: string }).v;
      at += 1;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const value = expr();
  if (at < tokens.length) throw new ExpressionError(tokens[at].t === ')' ? 'UNBALANCED_PARENTHESES' : 'UNEXPECTED_TOKEN');
  if (!Number.isFinite(value)) throw new ExpressionError('NOT_FINITE');
  return value;
}

/** Two computed numbers are the same up to floating-point noise. */
export const nearlyEqual = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
