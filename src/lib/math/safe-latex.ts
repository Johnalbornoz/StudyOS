import katex from 'katex';

/**
 * Safe LaTeX rendering shared by every read-only math surface (MathText,
 * interactive formulas). A learner must NEVER see LaTeX source:
 *
 *  - KaTeX runs with `throwOnError: true` (+ `trust: false`), so a parse
 *    failure never produces KaTeX's red "error" span that echoes the source;
 *  - on failure the caller gets a readable plain-text rendering instead
 *    (`latexToReadableText`), never the markup;
 *  - the same readable text is the accessible description of the formula
 *    (output is HTML only, so no MathML/annotation carries the source).
 */
export type SafeLatexResult = { ok: true; html: string; text: string } | { ok: false; text: string };

export function renderLatexSafe(latex: string, displayMode = false): SafeLatexResult {
  const text = latexToReadableText(latex);
  try {
    const html = katex.renderToString(latex, { throwOnError: true, trust: false, strict: 'ignore', output: 'html', displayMode });
    if (html.includes('katex-error')) return { ok: false, text };
    return { ok: true, html, text };
  } catch {
    return { ok: false, text };
  }
}

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const SYMBOLS: Record<string, string> = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈',
  infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', circ: '°', degree: '°', sum: 'Σ', prod: 'Π',
  int: '∫', partial: '∂', percent: '%', ldots: '…', cdots: '⋯', dots: '…', propto: '∝', sim: '∼', equiv: '≡',
};
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '+': '⁺', n: 'ⁿ' };
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '-': '₋', '+': '₊' };

/** Reads one balanced `{...}` group starting at `i` (which must be `{`); tolerant of unbalanced input. */
function readGroup(s: string, i: number): { body: string; end: number } {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      if (depth === 0) return { body: s.slice(i + 1, j), end: j + 1 };
    }
  }
  return { body: s.slice(i + 1), end: s.length };
}

/** Reads a command argument: a `{group}` or a single token. */
function readArg(s: string, i: number): { body: string; end: number } {
  while (s[i] === ' ') i++;
  if (s[i] === '{') return readGroup(s, i);
  if (s[i] === '\\') {
    const m = /^\\[a-zA-Z]+/.exec(s.slice(i));
    if (m) return { body: m[0], end: i + m[0].length };
  }
  return { body: s[i] ?? '', end: Math.min(i + 1, s.length) };
}

const needsParens = (t: string) => /[+\-−×·/ ]/.test(t.trim()) && !/^\(.*\)$/.test(t.trim());
const wrap = (t: string) => (needsParens(t) ? `(${t.trim()})` : t.trim());

function script(t: string, map: Record<string, string>, fallbackPrefix: string): string {
  const chars = [...t];
  return chars.length > 0 && chars.every((c) => map[c]) ? chars.map((c) => map[c]).join('') : `${fallbackPrefix}${wrap(t)}`;
}

/**
 * Readable plain-text rendering of LaTeX -- the fallback and accessible form.
 * `X = 20 \times \frac{6}{4} \times \frac{3}{2} = 45\,\text{unidades}` ->
 * `X = 20 × (6/4) × (3/2) = 45 unidades`. Never returns a backslash command
 * or a brace.
 */
export function latexToReadableText(latex: string): string {
  let out = '';
  let i = 0;
  const s = latex;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
      const name = m ? m[1] : '';
      i += m ? m[0].length : 1;
      if (/^(d|t|c)?frac$/.test(name)) {
        const a = readArg(s, i);
        const b = readArg(s, a.end);
        i = b.end;
        out += ` (${wrap(latexToReadableText(a.body))}/${wrap(latexToReadableText(b.body))}) `;
      } else if (name === 'sqrt') {
        let index = '';
        if (s[i] === '[') {
          const close = s.indexOf(']', i);
          index = close > i ? latexToReadableText(s.slice(i + 1, close)) : '';
          i = close > i ? close + 1 : i + 1;
        }
        const a = readArg(s, i);
        i = a.end;
        out += `${index ? script(index, SUP, '') : ''}√(${latexToReadableText(a.body).trim()})`;
      } else if (/^(text|textrm|textit|textbf|mathrm|mathit|mathbf|operatorname|mbox|mathsf|mathtt|boldsymbol)$/.test(name)) {
        const a = readArg(s, i);
        i = a.end;
        out += /^(text|textrm|textit|textbf|mbox)$/.test(name) ? a.body.replace(/[{}\\]/g, '') : latexToReadableText(a.body);
      } else if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' || name === 'displaystyle') {
        // sizing only
      } else if (name === ',' || name === ';' || name === ':' || name === ' ' || name === 'quad' || name === 'qquad' || name === '!') {
        out += name === '!' ? '' : ' ';
      } else if (name === '%' || name === '$' || name === '&' || name === '#' || name === '_' || name === '{' || name === '}') {
        out += name === '{' || name === '}' ? '' : name;
      } else if (GREEK[name]) {
        out += GREEK[name];
      } else if (SYMBOLS[name]) {
        out += ` ${SYMBOLS[name]} `;
      } else if (/^(sin|cos|tan|log|ln|exp|lim|max|min)$/.test(name)) {
        out += name;
      }
      // any other command: dropped (never shown as markup)
    } else if (c === '^' || c === '_') {
      const a = readArg(s, i + 1);
      i = a.end;
      const body = latexToReadableText(a.body).trim();
      out += c === '^' ? script(body, SUP, '^') : script(body, SUB, '_');
    } else if (c === '{' || c === '}' || c === '&' || c === '$') {
      i++;
    } else if (c === '~') {
      out += ' ';
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}
