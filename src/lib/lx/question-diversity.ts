/**
 * PROVE_INTRA_SESSION_NOVELTY -- semantic diversity of one assessment set.
 *
 * Exact-text novelty (exact-duplicate-novelty.ts) cannot see that
 *   #1 "Si 5 cuadernos cuestan 40 €, ¿cuánto cuestan 8? ... x = 5·40/8 = 25"
 *   #9 "Si 5 cuadernos cuestan 40 €, ¿cuánto cuestan 8? ... x = 5·8/40 = 1,25"
 * are the same problem. This module compares what makes a question the
 * SAME question for an assessment:
 *   - the same numeric problem (same numbers, same answer value);
 *   - the same numbers up to scaling ("superficially changed" numbers);
 *   - the same magnitude roles (the quantities the numbers measure:
 *     cuadernos / €, personas / g, piezas / horas ...);
 *   - the same question type + skill (intent / reasoning) = the same
 *     semantic template, even with different numbers.
 * Questions may share the concept -- that is the point of a Prove -- but not
 * the problem, and at most TEMPLATE_CAP of them may share one template.
 *
 * Pure. No I/O.
 */
import { decimalConventionFor, extractFinalValue, normalizeMathText } from '@/lib/grading/math-equivalence';

export const TEMPLATE_CAP = 2;

export interface DiversityQuestion {
  type: string;
  question: string;
  correctAnswer: string;
  questionIntent?: string;
  expectedReasoningType?: string;
  cognitiveLevel?: string;
}

export interface QuestionSignature {
  type: string;
  numbers: string[];
  ratios: string[];
  answerValue: number | null;
  roles: string[];
  skill: string;
  reasoning: string;
}

const ROLE_ALIASES: Record<string, string> = {
  '€': 'eur', eur: 'eur', euro: 'eur', euros: 'eur', '$': 'usd', dolares: 'usd', dollars: 'usd',
  g: 'g', gramos: 'g', grams: 'g', kg: 'kg', ml: 'ml', mililitros: 'ml', l: 'l', litros: 'l',
  min: 'min', minuto: 'min', minutos: 'min', minutes: 'min', h: 'h', hora: 'h', horas: 'h', hours: 'h', s: 's', segundos: 's',
  km: 'km', m: 'm', metros: 'm', cm: 'cm',
};
const FILLER = new Set(['y', 'e', 'o', 'u', 'and', 'or', 'et', 'ou', 'und', 'oder', 'de', 'del', 'la', 'el', 'los', 'las', 'of', 'the', 'a', 'un', 'una', 'des', 'du', 'le', 'der', 'die', 'das', 'do', 'da', 'dos', 'das', 'en', 'in']);

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Singular-ish stem so "cuaderno"/"cuadernos", "persona"/"personas" match. */
function stem(w: string): string {
  const x = stripAccents(w.toLowerCase());
  if (ROLE_ALIASES[x]) return ROLE_ALIASES[x];
  return x.length > 4 ? x.replace(/(es|s)$/, '') : x;
}

export function questionSignature(q: DiversityQuestion, language = 'es'): QuestionSignature {
  const convention = decimalConventionFor(language);
  const text = normalizeMathText(q.question, convention);
  const nums: number[] = [];
  const roles = new Set<string>();
  const tokens = text.split(/(\d+(?:\.\d+)?)/);
  for (let i = 1; i < tokens.length; i += 2) {
    const value = Number(tokens[i]);
    if (!Number.isFinite(value)) continue;
    nums.push(value);
    // the quantity this number measures: the first meaningful word right after it
    // (only a word directly after the number: "5 cuadernos", "40 €", "300 g de arroz" -- never "= 21. Identifica")
    const raw = tokens[i + 1] ?? '';
    if (!/^(\s|€|\$|%)/.test(raw)) continue;
    const after = raw.replace(/^\s+/, '');
    const m = after.match(/^(€|\$|%|[a-záéíóúñü]+)(?:\s+(?:de|of|du|des)\s+([a-záéíóúñü]+))?/i);
    if (m) {
      const word = FILLER.has(m[1].toLowerCase()) && m[2] ? m[2] : m[1];
      if (word && !FILLER.has(word.toLowerCase()) && word.length > 0 && /[a-z€$%]/i.test(word)) {
        const role = stem(word);
        if (role.length >= 1 && role !== 'x') roles.add(role);
      }
    }
  }
  const uniqueNums = [...new Set(nums.map((n) => Number(n.toPrecision(10))))].sort((a, b) => a - b);
  const ratios = new Set<string>();
  for (let i = 0; i < uniqueNums.length; i++)
    for (let j = i + 1; j < uniqueNums.length; j++) if (uniqueNums[i] !== 0) ratios.add((uniqueNums[j] / uniqueNums[i]).toFixed(3));
  const answer = extractFinalValue(q.correctAnswer, convention);
  return {
    type: q.type,
    numbers: uniqueNums.map(String),
    ratios: [...ratios].sort(),
    answerValue: answer ? Number(answer.value.toPrecision(10)) : null,
    roles: [...roles].sort(),
    skill: q.questionIntent ?? '',
    reasoning: q.expectedReasoningType ?? '',
  };
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const sa = new Set(a);
  const inter = b.filter((x) => sa.has(x)).length;
  return inter / (sa.size + new Set(b).size - inter);
}

export type SimilarityVerdict = 'DISTINCT' | 'SAME_TEMPLATE' | 'NEAR_DUPLICATE';

export interface PairSimilarity {
  verdict: SimilarityVerdict;
  reasons: string[];
  numbersOverlap: number;
  rolesOverlap: number;
}

/** How alike two questions are, for assessment validity. */
export function compareQuestions(a: QuestionSignature, b: QuestionSignature): PairSimilarity {
  const numbersOverlap = jaccard(a.numbers, b.numbers);
  const rolesOverlap = jaccard(a.roles, b.roles);
  const ratiosOverlap = a.numbers.length >= 2 && b.numbers.length >= 2 ? jaccard(a.ratios, b.ratios) : 0;
  const sameAnswer = a.answerValue !== null && b.answerValue !== null && Math.abs(a.answerValue - b.answerValue) <= 1e-9 * Math.max(1, Math.abs(a.answerValue));
  const sameSkill = (!!a.skill && a.skill === b.skill) || (!!a.reasoning && a.reasoning === b.reasoning);
  const reasons: string[] = [];

  if (sameAnswer && numbersOverlap >= 0.5) reasons.push('SAME_NUMERIC_PROBLEM');
  if (numbersOverlap >= 0.75 && rolesOverlap >= 0.5) reasons.push('SAME_NUMBERS_SAME_QUANTITIES');
  if (ratiosOverlap >= 0.6 && rolesOverlap >= 0.5 && sameSkill && numbersOverlap < 0.75) reasons.push('SCALED_NUMBERS_SAME_QUANTITIES');
  if (reasons.length) return { verdict: 'NEAR_DUPLICATE', reasons, numbersOverlap, rolesOverlap };

  if (a.type === b.type && rolesOverlap >= 0.5 && sameSkill) {
    return { verdict: 'SAME_TEMPLATE', reasons: ['SAME_TYPE_SKILL_AND_QUANTITIES'], numbersOverlap, rolesOverlap };
  }
  return { verdict: 'DISTINCT', reasons: [], numbersOverlap, rolesOverlap };
}

export interface DiversitySelection<T> {
  kept: T[];
  rejected: Array<{ item: T; againstIndex: number; verdict: Exclude<SimilarityVerdict, 'DISTINCT'>; reasons: string[] }>;
}

/**
 * Greedy, order-preserving selection: a candidate is kept unless it is a
 * near duplicate of a kept question, or its template already has
 * TEMPLATE_CAP kept questions. Deterministic.
 */
export function selectDiverse<T extends DiversityQuestion>(candidates: T[], target: number, language = 'es', alreadyKept: T[] = []): DiversitySelection<T> {
  const kept: T[] = [...alreadyKept];
  const sigs = kept.map((q) => questionSignature(q, language));
  const rejected: DiversitySelection<T>['rejected'] = [];
  for (const c of candidates) {
    if (kept.length >= target) break;
    const sc = questionSignature(c, language);
    let block: DiversitySelection<T>['rejected'][number] | null = null;
    let templateCount = 0;
    let templateAgainst = -1;
    sigs.forEach((s, i) => {
      if (block) return;
      const cmp = compareQuestions(s, sc);
      if (cmp.verdict === 'NEAR_DUPLICATE') block = { item: c, againstIndex: i, verdict: 'NEAR_DUPLICATE', reasons: cmp.reasons };
      else if (cmp.verdict === 'SAME_TEMPLATE') {
        templateCount++;
        templateAgainst = i;
      }
    });
    if (!block && templateCount >= TEMPLATE_CAP) block = { item: c, againstIndex: templateAgainst, verdict: 'SAME_TEMPLATE', reasons: ['TEMPLATE_CAP_REACHED'] };
    if (block) rejected.push(block);
    else {
      kept.push(c);
      sigs.push(sc);
    }
  }
  return { kept: kept.slice(alreadyKept.length), rejected };
}

/** Least-similar-first order for a deterministic fallback fill (max-min distance to the kept set). */
export function leastSimilarFirst<T extends DiversityQuestion>(pool: T[], kept: T[], language = 'es'): T[] {
  const keptSigs = kept.map((q) => questionSignature(q, language));
  const score = (q: T) => {
    const s = questionSignature(q, language);
    return Math.max(0, ...keptSigs.map((k) => compareQuestions(k, s)).map((c) => (c.verdict === 'NEAR_DUPLICATE' ? 2 : c.verdict === 'SAME_TEMPLATE' ? 1 : 0) + c.numbersOverlap));
  };
  return pool.map((q, i) => ({ q, i, s: score(q) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.q);
}

/** Short, answer-free description of the kept set for a regeneration request (what NOT to repeat). */
export function avoidanceBrief(kept: DiversityQuestion[], language = 'es'): string {
  const lines = kept.map((q) => {
    const s = questionSignature(q, language);
    return `- ${s.type}${s.roles.length ? ` about ${s.roles.join('/')}` : ''}${s.numbers.length ? ` with numbers ${s.numbers.join(', ')}` : ''}`;
  });
  return [...new Set(lines)].join('\n');
}

export interface DiversityReport {
  size: number;
  distinctTypes: number;
  distinctQuantityContexts: number;
  distinctSkills: number;
  distinctReasoning: number;
  distinctCognitiveLevels: number;
  maxTemplateShare: number;
  nearDuplicatePairs: number;
}

/** Set-level diversity metrics (logged with every Prove generation). */
export function diversityReport(questions: DiversityQuestion[], language = 'es'): DiversityReport {
  const sigs = questions.map((q) => questionSignature(q, language));
  let nearDup = 0;
  const templateSizes: number[] = sigs.map(() => 1);
  for (let i = 0; i < sigs.length; i++)
    for (let j = i + 1; j < sigs.length; j++) {
      const c = compareQuestions(sigs[i], sigs[j]);
      if (c.verdict === 'NEAR_DUPLICATE') nearDup++;
      if (c.verdict !== 'DISTINCT') {
        templateSizes[i]++;
        templateSizes[j]++;
      }
    }
  const distinct = (xs: string[]) => new Set(xs.filter(Boolean)).size;
  return {
    size: questions.length,
    distinctTypes: distinct(sigs.map((s) => s.type)),
    distinctQuantityContexts: distinct(sigs.map((s) => s.roles.join('/'))),
    distinctSkills: distinct(sigs.map((s) => s.skill)),
    distinctReasoning: distinct(sigs.map((s) => s.reasoning)),
    distinctCognitiveLevels: distinct(questions.map((q) => q.cognitiveLevel ?? '')),
    maxTemplateShare: questions.length ? Math.max(...templateSizes) / questions.length : 0,
    nearDuplicatePairs: nearDup,
  };
}
