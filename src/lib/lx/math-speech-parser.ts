/**
 * LX-8R2 R1/R2/R3/R14 -- DETERMINISTIC MATH SPEECH PARSER.
 *
 * Separates STT (transcription only, owned by VoiceInputButton/
 * SpeechRecognition -- unchanged) from math INTERPRETATION. This module
 * takes a plain transcript string SpeechRecognition already produced
 * and, with no AI/LLM call, attempts to parse it as spoken mathematics
 * into a canonical LaTeX expression via a small recursive-descent
 * grammar. STT is never asked to "solve" math; this module is never
 * asked to solve it either -- see R3 below.
 *
 * R2: covers numbers, variables, +/-/times/over, fractions,
 * parentheses, powers (squared/cubed/generic exponent), square/nth
 * roots, equals/inequalities, pi, and absolute value, for Spanish and
 * English. Vocabulary tables are separated per language (`GRAMMARS`)
 * so a future language (R14: German) is an additional table entry,
 * never a change to the parser algorithm or to any editor/UI caller.
 *
 * R3 -- NEVER SOLVES: this parser only ever restructures the WORDS the
 * learner spoke into LaTeX notation implied by those same words (e.g.
 * "two plus three times four" becomes "2+3\times4", respecting
 * standard operator precedence in how the *expression is grouped* --
 * exactly like a human transcriber would group it on paper -- but the
 * arithmetic is never evaluated: "two x plus two x" becomes "2x+2x",
 * never "4x"). No simplification, factoring, expansion, differentiation,
 * integration, or equation-solving step exists anywhere in this file.
 *
 * R2/R7 -- NEVER SILENTLY GUESSES: any unrecognized word, ambiguous
 * construction, or leftover/incomplete input makes parsing fail closed
 * (`{ ok: false }`) rather than approximate a result. There is no
 * partial-confidence tier to gloss over an uncertain parse -- callers
 * (see `MathVoiceInput`) show the raw transcript and let the learner
 * correct it by hand instead.
 *
 * LX-8R2-R1 R10 -- SUPPORTED GRAMMAR CONTRACT (deliberately NOT
 * broadened in this repair; documented here so its exact boundary is
 * visible in code, not just in test coverage):
 *   - Spoken cardinal numbers: 0-20 by word (`ES_CARDINALS`/
 *     `EN_CARDINALS` below), plus ANY literal digit string of any
 *     length (a bare token matching `/^\d+(\.\d+)?$/`, e.g. a transcript
 *     that already reads "42" or "3.5"). A COMPOUND spoken number
 *     outside 0-20 (e.g. "twenty-five", "cien") is NOT in the word
 *     table and is not a bare digit string, so it fails closed --
 *     either as `UNRECOGNIZED_WORD` (if the word itself isn't in any
 *     table) or `INCOMPLETE_EXPRESSION` (if two recognized-but-
 *     unjoinable tokens are produced, e.g. "twenty five" tokenizes as
 *     two adjacent NUM tokens with no operator between them, which the
 *     grammar cannot reduce to one expression and therefore rejects
 *     rather than silently dropping one of them). This is sufficient
 *     for normal secondary-school algebra (coefficients, exponents,
 *     equation constants), which rarely speaks compound number words
 *     inside an expression -- a written "25" is normally read digit-
 *     by-digit or typed directly, not spoken as one word, in this
 *     product's actual usage pattern.
 *   - Everything else in R2's checklist (variables, +/-/times/over,
 *     fractions, parentheses, powers, square/nth roots, equals/
 *     inequalities, pi, absolute value) is fully covered for
 *     secondary-school-level expressions -- see the exhaustive grammar-
 *     category test coverage in math-speech-parser.test.ts.
 *   - Expanding vocabulary (e.g. adding compound number words, or a
 *     new language) is ALWAYS a `GRAMMARS`-table change in this one
 *     file, never a change to `MathResponseComposer`,
 *     `MathExpressionEditor`, or `MathVoiceInput` -- none of those
 *     modules know this grammar's vocabulary, only that
 *     `parseMathSpeech` returns `{ ok, latex }` or `{ ok: false, reason
 *     }`.
 */
import type { Locale } from '@/lib/i18n/messages';

export type MathParseFailureReason = 'EMPTY_TRANSCRIPT' | 'UNRECOGNIZED_WORD' | 'INCOMPLETE_EXPRESSION' | 'UNSUPPORTED_LANGUAGE';

export type MathParseResult =
  | { ok: true; latex: string }
  | { ok: false; reason: MathParseFailureReason; detail?: string };

/* ================================================================ *
 * AST -- a faithful structural record of what was spoken. Every node *
 * type maps to exactly one LaTeX serialization rule below; nothing   *
 * here ever collapses two nodes into a computed value.               *
 * ================================================================ */
type Node =
  | { kind: 'num'; value: string }
  | { kind: 'var'; name: string }
  | { kind: 'pi' }
  | { kind: 'group'; inner: Node } // an explicitly spoken parenthesized sub-expression
  | { kind: 'coeff'; num: string; base: Node } // "two x" -- juxtaposition, never an operator word
  | { kind: 'pow'; base: Node; exp: string }
  | { kind: 'bin'; op: '+' | '-' | '×'; left: Node; right: Node }
  | { kind: 'frac'; num: Node; den: Node } // explicit "divided by"/"entre", or a spoken fraction word ("half of")
  | { kind: 'sqrt'; inner: Node }
  | { kind: 'nthroot'; n: string; inner: Node }
  | { kind: 'abs'; inner: Node }
  | { kind: 'rel'; op: '=' | '<' | '>' | '\\leq' | '\\geq'; left: Node; right: Node };

/* ================================================================ *
 * Tokens                                                            *
 * ================================================================ */
type Token =
  | { type: 'NUM'; value: string }
  | { type: 'VAR'; name: string }
  | { type: 'PI' }
  | { type: 'PLUS' | 'MINUS' | 'TIMES' | 'DIVIDE' }
  | { type: 'SQUARED' | 'CUBED' }
  | { type: 'TO_THE' }
  | { type: 'OPEN_PAREN' | 'CLOSE_PAREN' }
  | { type: 'SQRT' | 'CBRT' }
  | { type: 'NTH_ROOT'; n: string }
  | { type: 'ABS' }
  | { type: 'OF' }
  | { type: 'FRACTION_WORD'; n: string } // "half"/"medio" etc, always followed by OF
  | { type: 'EQUALS' | 'LT' | 'GT' | 'LEQ' | 'GEQ' };

interface LanguageGrammar {
  /** Multi-word phrases tried longest-first at each token position, e.g. ['al','cuadrado'] -> SQUARED. */
  phrases: Array<{ words: string[]; token: Token }>;
  /** Single-word mappings, tried after phrases fail to match at a position. */
  words: Record<string, Token>;
  /** Cardinal number words 0-20 (STT commonly spells these out for small numbers). */
  cardinals: Record<string, string>;
  /** Ordinal words used after "to the"/generic exponent phrasing (English) -- Spanish uses cardinals after "elevado a". */
  ordinals?: Record<string, string>;
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Tokenizes on already-lowercased, diacritic-stripped words -- table keys below are written in that same normalized form. */
function normalizeWords(transcript: string): string[] {
  return stripDiacritics(transcript.toLowerCase())
    .replace(/[.,;:!?¿¡]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const ES_CARDINALS: Record<string, string> = {
  cero: '0', uno: '1', una: '1', un: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6',
  siete: '7', ocho: '8', nueve: '9', diez: '10', once: '11', doce: '12', trece: '13', catorce: '14',
  quince: '15', dieciseis: '16', diecisiete: '17', dieciocho: '18', diecinueve: '19', veinte: '20',
};

const EN_CARDINALS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
  nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
  sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
};

const EN_ORDINALS: Record<string, string> = {
  first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7', eighth: '8',
  ninth: '9', tenth: '10',
};

const GRAMMARS: Partial<Record<Locale, LanguageGrammar>> = {
  es: {
    phrases: [
      { words: ['menor', 'o', 'igual', 'que'], token: { type: 'LEQ' } },
      { words: ['mayor', 'o', 'igual', 'que'], token: { type: 'GEQ' } },
      { words: ['dividido', 'entre'], token: { type: 'DIVIDE' } },
      { words: ['dividido', 'por'], token: { type: 'DIVIDE' } },
      { words: ['al', 'cuadrado'], token: { type: 'SQUARED' } },
      { words: ['al', 'cubo'], token: { type: 'CUBED' } },
      { words: ['elevado', 'a'], token: { type: 'TO_THE' } },
      { words: ['raiz', 'cuadrada'], token: { type: 'SQRT' } },
      { words: ['raiz', 'cubica'], token: { type: 'CBRT' } },
      { words: ['raiz', 'cuarta'], token: { type: 'NTH_ROOT', n: '4' } },
      { words: ['raiz', 'quinta'], token: { type: 'NTH_ROOT', n: '5' } },
      { words: ['raiz', 'sexta'], token: { type: 'NTH_ROOT', n: '6' } },
      { words: ['valor', 'absoluto'], token: { type: 'ABS' } },
      { words: ['abre', 'parentesis'], token: { type: 'OPEN_PAREN' } },
      { words: ['cierra', 'parentesis'], token: { type: 'CLOSE_PAREN' } },
      { words: ['menor', 'que'], token: { type: 'LT' } },
      { words: ['mayor', 'que'], token: { type: 'GT' } },
      { words: ['igual', 'a'], token: { type: 'EQUALS' } },
      { words: ['un', 'medio'], token: { type: 'FRACTION_WORD', n: '2' } },
      { words: ['una', 'mitad'], token: { type: 'FRACTION_WORD', n: '2' } },
      { words: ['un', 'tercio'], token: { type: 'FRACTION_WORD', n: '3' } },
      { words: ['un', 'cuarto'], token: { type: 'FRACTION_WORD', n: '4' } },
      { words: ['un', 'quinto'], token: { type: 'FRACTION_WORD', n: '5' } },
      { words: ['y', 'griega'], token: { type: 'VAR', name: 'y' } },
    ],
    words: {
      mas: { type: 'PLUS' }, menos: { type: 'MINUS' }, por: { type: 'TIMES' }, entre: { type: 'DIVIDE' },
      pi: { type: 'PI' },
      equis: { type: 'VAR', name: 'x' }, ye: { type: 'VAR', name: 'y' }, zeta: { type: 'VAR', name: 'z' },
      ene: { type: 'VAR', name: 'n' }, eme: { type: 'VAR', name: 'm' },
      de: { type: 'OF' },
    },
    cardinals: ES_CARDINALS,
  },
  en: {
    phrases: [
      { words: ['less', 'than', 'or', 'equal', 'to'], token: { type: 'LEQ' } },
      { words: ['greater', 'than', 'or', 'equal', 'to'], token: { type: 'GEQ' } },
      { words: ['is', 'equal', 'to'], token: { type: 'EQUALS' } },
      { words: ['divided', 'by'], token: { type: 'DIVIDE' } },
      { words: ['multiplied', 'by'], token: { type: 'TIMES' } },
      { words: ['square', 'root'], token: { type: 'SQRT' } },
      { words: ['cube', 'root'], token: { type: 'CBRT' } },
      { words: ['fourth', 'root'], token: { type: 'NTH_ROOT', n: '4' } },
      { words: ['fifth', 'root'], token: { type: 'NTH_ROOT', n: '5' } },
      { words: ['sixth', 'root'], token: { type: 'NTH_ROOT', n: '6' } },
      { words: ['absolute', 'value'], token: { type: 'ABS' } },
      { words: ['open', 'parenthesis'], token: { type: 'OPEN_PAREN' } },
      { words: ['close', 'parenthesis'], token: { type: 'CLOSE_PAREN' } },
      { words: ['less', 'than'], token: { type: 'LT' } },
      { words: ['greater', 'than'], token: { type: 'GT' } },
      { words: ['to', 'the'], token: { type: 'TO_THE' } },
      { words: ['one', 'half'], token: { type: 'FRACTION_WORD', n: '2' } },
      { words: ['a', 'half'], token: { type: 'FRACTION_WORD', n: '2' } },
      { words: ['one', 'third'], token: { type: 'FRACTION_WORD', n: '3' } },
      { words: ['one', 'quarter'], token: { type: 'FRACTION_WORD', n: '4' } },
      { words: ['one', 'fourth'], token: { type: 'FRACTION_WORD', n: '4' } },
      { words: ['one', 'fifth'], token: { type: 'FRACTION_WORD', n: '5' } },
    ],
    words: {
      plus: { type: 'PLUS' }, minus: { type: 'MINUS' }, times: { type: 'TIMES' },
      equals: { type: 'EQUALS' }, pi: { type: 'PI' }, of: { type: 'OF' },
      squared: { type: 'SQUARED' }, cubed: { type: 'CUBED' },
    },
    cardinals: EN_CARDINALS,
    ordinals: EN_ORDINALS,
  },
};

class ParseFailure extends Error {
  constructor(public reason: MathParseFailureReason, detail?: string) {
    super(detail ?? reason);
  }
}

function tokenize(words: string[], g: LanguageGrammar): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const sortedPhrases = [...g.phrases].sort((a, b) => b.words.length - a.words.length);
  outer: while (i < words.length) {
    for (const phrase of sortedPhrases) {
      const len = phrase.words.length;
      if (i + len <= words.length && phrase.words.every((w, j) => words[i + j] === w)) {
        tokens.push(phrase.token);
        i += len;
        continue outer;
      }
    }
    const w = words[i];
    if (g.words[w]) {
      tokens.push(g.words[w]);
      i += 1;
      continue;
    }
    if (/^\d+(\.\d+)?$/.test(w)) {
      tokens.push({ type: 'NUM', value: w });
      i += 1;
      continue;
    }
    if (g.cardinals[w] !== undefined) {
      tokens.push({ type: 'NUM', value: g.cardinals[w] });
      i += 1;
      continue;
    }
    if (g.ordinals?.[w] !== undefined) {
      // A bare ordinal only ever appears right after TO_THE in this grammar; represented as NUM so parseExponent can read it directly.
      tokens.push({ type: 'NUM', value: g.ordinals[w] });
      i += 1;
      continue;
    }
    if (/^[a-z]$/.test(w)) {
      tokens.push({ type: 'VAR', name: w });
      i += 1;
      continue;
    }
    throw new ParseFailure('UNRECOGNIZED_WORD', w);
  }
  return tokens;
}

/* ================================================================ *
 * Recursive-descent parser. Grammar (informal), highest to lowest    *
 * binding: coefficient-juxtaposition+power  >  * / (explicit) >  +/- *
 * >  relational (=, <, >, <=, >=). A power suffix ("squared"/        *
 * "to the Nth") binds to the immediately preceding base ONLY --      *
 * never to a coefficient spoken just before it -- so "two x squared" *
 * parses as 2*(x^2), matching how the phrase is actually meant, not  *
 * (2x)^2. This is the one place word ORDER determines structure;     *
 * it is still a literal transcription of what was said, not a        *
 * computed simplification.                                           *
 * ================================================================ */
class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new ParseFailure('INCOMPLETE_EXPRESSION');
    this.pos += 1;
    return t;
  }
  private expect<T extends Token['type']>(type: T): Extract<Token, { type: T }> {
    const t = this.next();
    if (t.type !== type) throw new ParseFailure('INCOMPLETE_EXPRESSION', `expected ${type}, got ${t.type}`);
    return t as Extract<Token, { type: T }>;
  }

  hasRemaining(): boolean {
    return this.pos < this.tokens.length;
  }

  parseTop(): Node {
    const left = this.parseAdditive();
    const t = this.peek();
    if (t && (t.type === 'EQUALS' || t.type === 'LT' || t.type === 'GT' || t.type === 'LEQ' || t.type === 'GEQ')) {
      this.next();
      const right = this.parseAdditive();
      const op = t.type === 'EQUALS' ? '=' : t.type === 'LT' ? '<' : t.type === 'GT' ? '>' : t.type === 'LEQ' ? '\\leq' : '\\geq';
      return { kind: 'rel', op, left, right };
    }
    return left;
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === 'PLUS' || this.peek()?.type === 'MINUS') {
      const op = this.next().type === 'PLUS' ? '+' : '-';
      const right = this.parseMultiplicative();
      left = { kind: 'bin', op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Node {
    let left = this.parseAtom();
    while (this.peek()?.type === 'TIMES' || this.peek()?.type === 'DIVIDE') {
      const t = this.next();
      const right = this.parseAtom();
      left = t.type === 'TIMES' ? { kind: 'bin', op: '×', left, right } : { kind: 'frac', num: left, den: right };
    }
    return left;
  }

  /** Parses one base term (variable/number/group/function) and applies any immediately-following power suffix to it alone, then (if the base term was a bare number) allows an implicit coefficient*base juxtaposition to its right. */
  private parseAtom(): Node {
    const t = this.peek();
    if (t?.type === 'NUM') {
      this.next();
      const nextTok = this.peek();
      if (nextTok && (nextTok.type === 'VAR' || nextTok.type === 'OPEN_PAREN' || nextTok.type === 'PI' || nextTok.type === 'SQRT' || nextTok.type === 'CBRT' || nextTok.type === 'NTH_ROOT' || nextTok.type === 'ABS')) {
        const base = this.parseBaseWithPower();
        return { kind: 'coeff', num: t.value, base };
      }
      return this.applyPowerSuffix({ kind: 'num', value: t.value });
    }
    if (t?.type === 'FRACTION_WORD') {
      this.next();
      this.expect('OF');
      const inner = this.parseAtom();
      return { kind: 'frac', num: inner, den: { kind: 'num', value: t.n } };
    }
    return this.parseBaseWithPower();
  }

  private parseBaseWithPower(): Node {
    const base = this.parseBase();
    return this.applyPowerSuffix(base);
  }

  private applyPowerSuffix(base: Node): Node {
    const t = this.peek();
    if (t?.type === 'SQUARED') {
      this.next();
      return { kind: 'pow', base, exp: '2' };
    }
    if (t?.type === 'CUBED') {
      this.next();
      return { kind: 'pow', base, exp: '3' };
    }
    if (t?.type === 'TO_THE') {
      this.next();
      const n = this.expect('NUM');
      return { kind: 'pow', base, exp: n.value };
    }
    return base;
  }

  private parseBase(): Node {
    const t = this.next();
    switch (t.type) {
      case 'VAR':
        return { kind: 'var', name: t.name };
      case 'PI':
        return { kind: 'pi' };
      case 'OPEN_PAREN': {
        const inner = this.parseAdditive();
        this.expect('CLOSE_PAREN');
        return { kind: 'group', inner };
      }
      case 'SQRT': {
        this.expect('OF');
        return { kind: 'sqrt', inner: this.parseAdditive() };
      }
      case 'CBRT': {
        this.expect('OF');
        return { kind: 'nthroot', n: '3', inner: this.parseAdditive() };
      }
      case 'NTH_ROOT': {
        const n = t.n;
        this.expect('OF');
        return { kind: 'nthroot', n, inner: this.parseAdditive() };
      }
      case 'ABS': {
        this.expect('OF');
        return { kind: 'abs', inner: this.parseAdditive() };
      }
      case 'NUM':
        return { kind: 'num', value: t.value };
      default:
        throw new ParseFailure('INCOMPLETE_EXPRESSION', `unexpected ${t.type}`);
    }
  }
}

function serialize(node: Node): string {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'var':
      return node.name;
    case 'pi':
      // Trailing space is harmless whitespace in LaTeX/KaTeX math mode and
      // is required for correctness whenever a letter (e.g. a variable)
      // immediately follows -- a bare named command's name otherwise
      // keeps extending over it (e.g. "\pix" would parse as the unknown
      // macro "\pix", not "\pi" followed by "x").
      return '\\pi ';
    case 'group':
      return `(${serialize(node.inner)})`;
    case 'coeff':
      return `${node.num}${serialize(node.base)}`;
    case 'pow':
      return `${serialize(node.base)}^{${node.exp}}`;
    case 'bin':
      return node.op === '×' ? `${serialize(node.left)}\\times ${serialize(node.right)}` : `${serialize(node.left)}${node.op}${serialize(node.right)}`;
    case 'frac':
      return `\\frac{${serialize(node.num)}}{${serialize(node.den)}}`;
    case 'sqrt':
      return `\\sqrt{${serialize(node.inner)}}`;
    case 'nthroot':
      return `\\sqrt[${node.n}]{${serialize(node.inner)}}`;
    case 'abs':
      return `\\left|${serialize(node.inner)}\\right|`;
    case 'rel':
      // Spaced consistently around every relational operator (both the
      // single-character and named-command forms) -- also required for
      // \leq/\geq for the same macro-termination reason as \times above.
      return `${serialize(node.left)} ${node.op} ${serialize(node.right)}`;
  }
}

/**
 * Attempts to parse a spoken-math transcript into canonical LaTeX. No
 * AI/LLM call; purely deterministic. `language` selects the grammar
 * table (R14) -- a language with no table entry yet fails closed with
 * `UNSUPPORTED_LANGUAGE` rather than guessing via another language's
 * vocabulary.
 */
export function parseMathSpeech(transcript: string, language: Locale): MathParseResult {
  const trimmed = transcript.trim();
  if (!trimmed) return { ok: false, reason: 'EMPTY_TRANSCRIPT' };

  const grammar = GRAMMARS[language];
  if (!grammar) return { ok: false, reason: 'UNSUPPORTED_LANGUAGE', detail: language };

  try {
    const words = normalizeWords(trimmed);
    if (words.length === 0) return { ok: false, reason: 'EMPTY_TRANSCRIPT' };
    const tokens = tokenize(words, grammar);
    if (tokens.length === 0) return { ok: false, reason: 'EMPTY_TRANSCRIPT' };
    const parser = new Parser(tokens);
    const ast = parser.parseTop();
    if (parser.hasRemaining()) {
      return { ok: false, reason: 'INCOMPLETE_EXPRESSION', detail: 'trailing unparsed words' };
    }
    return { ok: true, latex: serialize(ast) };
  } catch (err) {
    if (err instanceof ParseFailure) return { ok: false, reason: err.reason, detail: err.message };
    return { ok: false, reason: 'INCOMPLETE_EXPRESSION', detail: String(err) };
  }
}

/** Which locales this parser currently supports (R14: adding one is a GRAMMARS entry, never an editor/caller change). */
export function isMathSpeechSupported(language: Locale): boolean {
  return language in GRAMMARS;
}
