/**
 * Question Bank Factory -- the AUTOMATED VALIDATION pipeline (pure stages).
 *
 * A generated candidate never becomes usable because the generator says so.
 * Deterministic stages run first and take precedence; an independent AI
 * validator (a different call and prompt that SOLVES the item without seeing
 * the key) runs only where determinism cannot decide (reading, verbal
 * reasoning), and is judged here deterministically too.
 *
 *   1. schema      -- ApprovedItemContentSchema + validateExamItemStructure (the delivery contract)
 *   2. blueprint   -- format, option count, question type, difficulty band, demand, language, stimulus
 *   3. answer      -- mathematics: the key is RECOMPUTED with the exam math engine (gradeMath) and no
 *                     distractor may be equivalent to it; reading: the evidence quote must be IN the stimulus
 *   4. distractors -- distinct, non-empty, no "all of the above", no length clue, a rationale each
 *   5. novelty     -- exact / normalized / template (same item, other numbers) / near duplicates / same numbers
 *   6. provenance  -- never claims to be official
 *
 * Each issue says what follows: REJECT (unusable), REPAIR (one bounded repair
 * attempt), REVIEW (a human decides). The worst issue wins.
 */
import { ApprovedItemContentSchema, examItemFromApproved, type ApprovedItemContent } from '../items';
import { itemFingerprints, normalizeForFingerprint } from '../fingerprints';
import { gradeMath } from '../math/math-engine';
import { DEFAULT_NOVELTY_POLICY, type NoveltyPolicy } from './policy';

/** WARN: shown to the human reviewer, never blocks (V2). */
export type IssueSeverity = 'REJECT' | 'REPAIR' | 'REVIEW' | 'WARN';
export interface ValidationIssue {
  stage: 'SCHEMA' | 'BLUEPRINT' | 'ANSWER' | 'DISTRACTORS' | 'NOVELTY' | 'PROVENANCE' | 'AI_VALIDATOR' | 'CONTENT';
  code: string;
  severity: IssueSeverity;
  detail?: string;
}

export type ValidationOutcome = 'PASS' | 'NEEDS_AI_VALIDATION' | 'REPAIR_REQUIRED' | 'REVIEW_REQUIRED' | 'REJECTED';

/** What the cell asks for -- derived from the blueprint, the component definition and the cell's existing items. */
export interface CellSpec {
  cellKey: string;
  learningObjectiveId: string;
  questionType: string | null;
  difficultyRange: { min: number; max: number } | null;
  targetDifficulty: number;
  cognitiveDemand: string | null;
  language: string;
  answerFormats: string[];
  optionCount: number;
  /** MATH: the key must be recomputable deterministically. TEXT: needs the independent validator. */
  domain: 'MATH' | 'TEXT';
  stimulusRequired: boolean;
  /** Reading-type cells: the answer must be supported by the stimulus alone. */
  stimulusOnlyEvidence: boolean;
}

/** Verification material the generator must supply (kept in the validation report, never in Student content). */
export interface CandidateVerification {
  /** MATH: an expression whose value is the correct answer (recomputed, never trusted). */
  verificationExpression: string | null;
  /** TEXT with stimulus: a verbatim quote from the stimulus that supports the key. */
  evidenceQuote: string | null;
}

export interface ExistingItemText {
  versionId: string;
  question: string;
  stimulusText: string | null;
}

const OPTION_BAN = /\b(todas las anteriores|ninguna de las anteriores|todas las opciones|all of the above|none of the above|both a and b|a y b)\b/i;
const OFFICIAL_CLAIM = /\b(pregunta oficial|examen oficial|prueba oficial|simulacro oficial|puntaje oficial|official (question|exam|test|score|mock))\b/i;

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function tokens(s: string): Set<string> {
  // Content words and every token carrying a number ("3x", "20"): short math stems stay comparable.
  return new Set(normalizeForFingerprint(s).split(' ').filter((t) => t.length > 2 || /\d/.test(t)));
}
export function jaccard(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}
const numbersOf = (s: string) => (normalizeForFingerprint(s).match(/\d+(?:[.,]\d+)?/g) ?? []).sort().join('|');

/** Very small language check: a Spanish item has Spanish function words, an English one English ones. */
export function languageLooksLike(text: string, language: string): boolean {
  const words = normalizeForFingerprint(text).split(' ');
  const es = new Set(['de', 'la', 'que', 'el', 'en', 'los', 'del', 'se', 'las', 'por', 'un', 'para', 'con', 'una', 'es', 'cual', 'segun']);
  const en = new Set(['the', 'of', 'and', 'to', 'in', 'is', 'that', 'which', 'what', 'for', 'with', 'are', 'a', 'an']);
  const hit = (set: Set<string>) => words.filter((w) => set.has(w)).length;
  const lang = language.slice(0, 2);
  if (lang === 'es') return hit(es) >= Math.max(1, hit(en));
  if (lang === 'en') return hit(en) >= Math.max(1, hit(es));
  return true;
}

/** Option text compared for duplicates: case / accents / spacing ignored, but signs and math symbols kept ("2" and "-2" differ). */
export function normalizeOption(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[−–—]/g, '-').replace(/\s+/g, ' ').replace(/[.;:,]+$/, '').trim();
}

function correctOptionId(c: ApprovedItemContent): string {
  return c.correctAnswer;
}

export function validateSchema(raw: unknown): { content: ApprovedItemContent | null; issues: ValidationIssue[] } {
  const parsed = ApprovedItemContentSchema.safeParse(raw);
  if (!parsed.success) return { content: null, issues: [{ stage: 'SCHEMA', code: 'SCHEMA_INVALID', severity: 'REJECT', detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }] };
  const item = examItemFromApproved({ id: '00000000-0000-0000-0000-000000000000', learning_objective_id: '00000000-0000-0000-0000-000000000000', content: parsed.data });
  if (!item) return { content: parsed.data, issues: [{ stage: 'SCHEMA', code: 'STRUCTURE_INVALID', severity: 'REPAIR' }] };
  return { content: parsed.data, issues: [] };
}

export function validateBlueprint(c: ApprovedItemContent, spec: CellSpec): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const add = (code: string, severity: IssueSeverity, detail?: string) => out.push({ stage: 'BLUEPRINT', code, severity, detail });
  if (!spec.answerFormats.includes(c.answerFormat)) add('RESPONSE_FORMAT_NOT_SUPPORTED', 'REJECT', c.answerFormat);
  if (spec.questionType && c.type !== spec.questionType) add('QUESTION_TYPE_MISMATCH', 'REPAIR', c.type);
  if ((c.options?.length ?? 0) !== spec.optionCount) add('OPTION_COUNT_MISMATCH', 'REPAIR', String(c.options?.length ?? 0));
  if (spec.difficultyRange && (c.difficulty < spec.difficultyRange.min || c.difficulty > spec.difficultyRange.max)) add('DIFFICULTY_OUT_OF_BAND', 'REPAIR', String(c.difficulty));
  if (!spec.difficultyRange && Math.abs(c.difficulty - spec.targetDifficulty) > 1) add('DIFFICULTY_FAR_FROM_TARGET', 'REPAIR', `${c.difficulty} vs ${spec.targetDifficulty}`);
  if (spec.cognitiveDemand && c.tags?.cognitiveDemand && c.tags.cognitiveDemand !== spec.cognitiveDemand) add('COGNITIVE_DEMAND_MISMATCH', 'REPAIR', c.tags.cognitiveDemand);
  if (!c.tags?.skill) add('SKILL_TAG_MISSING', 'REPAIR');
  if (c.language !== spec.language) add('LANGUAGE_MISMATCH', 'REJECT', c.language);
  else if (!languageLooksLike(`${c.stimulus?.text ?? ''} ${c.question} ${(c.options ?? []).map((o) => o.text).join(' ')}`, spec.language)) add('LANGUAGE_CONTENT_MISMATCH', 'REPAIR');
  if (spec.stimulusRequired && !c.stimulus) add('STIMULUS_REQUIRED', 'REPAIR');
  if (c.contentOrigin !== 'GENERATED' || c.contentStatus !== 'ORIGINAL') add('PROVENANCE_NOT_GENERATED', 'REJECT');
  return out;
}

export function validateDistractors(c: ApprovedItemContent): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const add = (code: string, severity: IssueSeverity, detail?: string) => out.push({ stage: 'DISTRACTORS', code, severity, detail });
  const options = c.options ?? [];
  const norm = options.map((o) => normalizeOption(o.text));
  if (norm.some((t) => !t)) add('EMPTY_OPTION', 'REPAIR');
  if (new Set(norm).size !== norm.length) add('DUPLICATE_OPTIONS', 'REPAIR');
  if (options.some((o) => OPTION_BAN.test(o.text))) add('ALL_NONE_OF_THE_ABOVE', 'REPAIR');
  const key = options.find((o) => o.id === correctOptionId(c));
  const distractors = options.filter((o) => o.id !== correctOptionId(c));
  if (key && distractors.length) {
    const longest = Math.max(...distractors.map((d) => d.text.length));
    if (key.text.length > 25 && key.text.length > 1.75 * longest) add('LENGTH_CLUE', 'REPAIR', `${key.text.length} vs ${longest}`);
    // The key repeats the stem's distinctive wording while no distractor does (a formatting / echo clue).
    const stem = tokens(c.question);
    const overlap = (t: string) => [...tokens(t)].filter((w) => stem.has(w) && w.length > 5).length;
    if (overlap(key.text) >= 3 && distractors.every((d) => overlap(d.text) === 0)) add('STEM_ECHO_CLUE', 'REPAIR');
  }
  const rationale = c.distractorRationale ?? {};
  if (distractors.some((d) => !rationale[d.id] || !rationale[d.id].trim())) add('DISTRACTOR_RATIONALE_MISSING', 'REPAIR');
  return out;
}

function mathGrade(literal: string, expr: string, language: string) {
  const kinds: Array<'EXPRESSION' | 'EQUATION' | 'NUMBER'> = /=/.test(literal) || /=/.test(expr) ? ['EQUATION'] : ['NUMBER', 'EXPRESSION'];
  let best: 'EQUIVALENT' | 'NOT_EQUIVALENT' | 'UNDECIDABLE' = 'UNDECIDABLE';
  for (const kind of kinds) {
    const g = gradeMath(literal.replace(/\$/g, ''), { kind, answers: [expr], tolerance: { relative: 1e-9 } }, language);
    if (g.mathematicalCorrectness === 'EQUIVALENT') return 'EQUIVALENT';
    if (g.mathematicalCorrectness === 'NOT_EQUIVALENT') best = 'NOT_EQUIVALENT';
  }
  return best;
}

/**
 * MATH: recompute the key. TEXT: check the evidence quote against the stimulus.
 * Returns whether the independent AI validator is still needed.
 */
export function validateAnswer(c: ApprovedItemContent, spec: CellSpec, v: CandidateVerification): { issues: ValidationIssue[]; needsAiValidation: boolean; deterministicallyVerified: boolean } {
  const out: ValidationIssue[] = [];
  const add = (code: string, severity: IssueSeverity, detail?: string) => out.push({ stage: 'ANSWER', code, severity, detail });
  const options = c.options ?? [];
  const key = options.find((o) => o.id === correctOptionId(c));
  if (!key) return { issues: [{ stage: 'ANSWER', code: 'KEY_NOT_AN_OPTION', severity: 'REJECT' }], needsAiValidation: false, deterministicallyVerified: false };

  if (spec.domain === 'MATH') {
    if (!v.verificationExpression) {
      add('VERIFICATION_EXPRESSION_MISSING', 'REPAIR');
      return { issues: out, needsAiValidation: false, deterministicallyVerified: false };
    }
    const keyVerdict = mathGrade(key.text, v.verificationExpression, c.language);
    if (keyVerdict === 'UNDECIDABLE') {
      // A verbal key ("La mediana aumenta") cannot be recomputed: the independent validator decides.
      return { issues: out, needsAiValidation: true, deterministicallyVerified: false };
    }
    if (keyVerdict === 'NOT_EQUIVALENT') add('KEY_NOT_VERIFIED', 'REPAIR', `${key.text} ≠ ${v.verificationExpression}`);
    for (const d of options.filter((o) => o.id !== key.id)) {
      if (mathGrade(d.text, v.verificationExpression, c.language) === 'EQUIVALENT') add('DISTRACTOR_EQUIVALENT_TO_KEY', 'REPAIR', d.id);
    }
    return { issues: out, needsAiValidation: false, deterministicallyVerified: out.length === 0 };
  }

  if (c.stimulus && spec.stimulusOnlyEvidence) {
    if (!v.evidenceQuote || !v.evidenceQuote.trim()) add('EVIDENCE_QUOTE_MISSING', 'REPAIR');
    else if (!normalizeForFingerprint(c.stimulus.text).includes(normalizeForFingerprint(v.evidenceQuote))) add('EVIDENCE_NOT_IN_STIMULUS', 'REPAIR');
  }
  return { issues: out, needsAiValidation: true, deterministicallyVerified: false };
}

export function validateNovelty(c: ApprovedItemContent, existing: ExistingItemText[], policy: NoveltyPolicy = DEFAULT_NOVELTY_POLICY): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const mine = itemFingerprints(c);
  const myText = c.question;
  const myNumbers = numbersOf(myText);
  for (const e of existing) {
    const theirs = itemFingerprints({ question: e.question, answerFormat: c.answerFormat, parts: undefined, stimulus: e.stimulusText ? { key: 'x', text: e.stimulusText } : undefined, tags: undefined, commandTerm: undefined });
    if (theirs.semantic === mine.semantic) {
      out.push({ stage: 'NOVELTY', code: 'DUPLICATE_NORMALIZED', severity: 'REJECT', detail: e.versionId });
      continue;
    }
    if (theirs.template === mine.template) {
      out.push({ stage: 'NOVELTY', code: 'DUPLICATE_TEMPLATE_OTHER_NUMBERS', severity: 'REJECT', detail: e.versionId });
      continue;
    }
    const sim = jaccard(myText, e.question);
    if (sim >= policy.nearDuplicateRejectAt) out.push({ stage: 'NOVELTY', code: 'NEAR_DUPLICATE', severity: 'REJECT', detail: `${e.versionId}:${sim.toFixed(2)}` });
    else if (sim >= policy.nearDuplicateRepairAt) out.push({ stage: 'NOVELTY', code: 'TOO_SIMILAR', severity: 'REPAIR', detail: `${e.versionId}:${sim.toFixed(2)}` });
    else if (myNumbers && myNumbers === numbersOf(e.question) && sim >= 0.5) out.push({ stage: 'NOVELTY', code: 'SAME_NUMBERS_COSMETIC_REWORD', severity: 'REPAIR', detail: e.versionId });
    if (c.stimulus && e.stimulusText && mine.stimulus === theirs.stimulus && jaccard(myText, e.question) >= 0.6) {
      out.push({ stage: 'NOVELTY', code: 'SAME_STIMULUS_SAME_QUESTION', severity: 'REJECT', detail: e.versionId });
    }
  }
  return dedupe(out);
}

// Generation artifacts only (case-sensitive: Spanish "todo", "null" in prose etc. are legitimate words).
const MALFORMED = /\bundefined\b|\[object Object\]|\bNaN\b|\{\{|\}\}|<\/?(div|span|p|br|b|i|strong|em|ul|li)\b[^>]*>|[Ll]orem ipsum/;

/** Malformed content: placeholders, template / markup leftovers, unbalanced inline math. */
export function validateWellFormed(c: ApprovedItemContent): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const texts = [c.question, c.explanation, c.stimulus?.text ?? '', ...(c.options ?? []).map((o) => o.text)];
  if (texts.some((t) => MALFORMED.test(t))) out.push({ stage: 'CONTENT', code: 'MALFORMED_CONTENT', severity: 'REPAIR' });
  if (texts.some((t) => ((t.match(/(?<!\\)\$/g) ?? []).length % 2) === 1)) out.push({ stage: 'CONTENT', code: 'UNBALANCED_MATH_DELIMITERS', severity: 'REPAIR' });
  if (!c.explanation || c.explanation.trim().length < 15) out.push({ stage: 'CONTENT', code: 'EXPLANATION_MISSING', severity: 'REPAIR' });
  return out;
}

const numericForm = (s: string) => s.replace(/[−–—]/g, '-').replace(/\s+/g, '').replace(/,/g, '.').replace(/[$]/g, '').toLowerCase();

/** Answer / explanation consistency (deterministic, conservative): the explanation should arrive at the key. */
export function validateExplanationConsistency(c: ApprovedItemContent, spec: Pick<CellSpec, 'domain'>): ValidationIssue[] {
  const key = (c.options ?? []).find((o) => o.id === c.correctAnswer);
  if (!key || !c.explanation) return [];
  const exp = numericForm(c.explanation);
  if (spec.domain === 'MATH' && /^-?\d+([./]\d+)?$/.test(numericForm(key.text))) {
    return exp.includes(numericForm(key.text)) ? [] : [{ stage: 'CONTENT', code: 'EXPLANATION_DOES_NOT_STATE_KEY', severity: 'WARN', detail: key.text }];
  }
  // Verbal key: the explanation should share some content with the key option.
  const kt = tokens(key.text);
  const et = tokens(c.explanation);
  const shared = [...kt].filter((t) => et.has(t)).length;
  return kt.size >= 3 && shared === 0 ? [{ stage: 'CONTENT', code: 'EXPLANATION_UNRELATED_TO_KEY', severity: 'WARN' }] : [];
}

export function validateProvenanceClaims(c: ApprovedItemContent): ValidationIssue[] {
  const text = [c.question, c.explanation, ...(c.options ?? []).map((o) => o.text), c.stimulus?.title ?? ''].join(' ');
  return OFFICIAL_CLAIM.test(text) ? [{ stage: 'PROVENANCE', code: 'CLAIMS_OFFICIAL', severity: 'REJECT' }] : [];
}

function dedupe(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.stage}:${i.code}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface DeterministicReport {
  outcome: ValidationOutcome;
  issues: ValidationIssue[];
  deterministicallyVerified: boolean;
  content: ApprovedItemContent | null;
}

/** All deterministic stages. PASS only when nothing is left for the AI validator. */
export function runDeterministicValidation(raw: unknown, spec: CellSpec, verification: CandidateVerification, existing: ExistingItemText[], novelty?: NoveltyPolicy): DeterministicReport {
  const schema = validateSchema(raw);
  if (!schema.content) return { outcome: 'REJECTED', issues: schema.issues, deterministicallyVerified: false, content: null };
  const c = schema.content;
  const answer = validateAnswer(c, spec, verification);
  const issues = [...schema.issues, ...validateBlueprint(c, spec), ...answer.issues, ...validateDistractors(c), ...validateNovelty(c, existing, novelty), ...validateProvenanceClaims(c), ...validateWellFormed(c), ...validateExplanationConsistency(c, spec)];
  const outcome: ValidationOutcome = worst(issues) ?? (answer.needsAiValidation ? 'NEEDS_AI_VALIDATION' : 'PASS');
  return { outcome, issues, deterministicallyVerified: answer.deterministicallyVerified && issues.filter((i) => i.severity !== 'WARN').length === 0, content: c };
}

export function worst(issues: ValidationIssue[]): 'REJECTED' | 'REPAIR_REQUIRED' | 'REVIEW_REQUIRED' | null {
  if (issues.some((i) => i.severity === 'REJECT')) return 'REJECTED';
  if (issues.some((i) => i.severity === 'REPAIR')) return 'REPAIR_REQUIRED';
  if (issues.some((i) => i.severity === 'REVIEW')) return 'REVIEW_REQUIRED';
  return null;
}

/* ------------------------------------------------------------------ */
/* Independent AI validator verdict -> deterministic judgement          */
/* ------------------------------------------------------------------ */

export interface ValidatorVerdict {
  /** Option the validator chose when SOLVING the item (it never saw the key). */
  selectedOptionId: string;
  confidence: number;
  /** Other options a careful reader could defend as correct. */
  alternativeDefensibleOptionIds: string[];
  /** The item needs information the stimulus does not give. */
  requiresOutsideInformation: boolean;
  /** Distractors that are not plausible (trivially wrong). */
  implausibleDistractorIds: string[];
  /** V2: the item actually assesses the stated requirement (concept / objective alignment). */
  assessesRequirement?: boolean;
  /** V2: the validator's own difficulty estimate (plausibility of the declared difficulty). */
  estimatedDifficulty?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export type ValidatorJudgement = { outcome: 'PASS' | 'REPAIR_REQUIRED' | 'REVIEW_REQUIRED' | 'ESCALATE'; issues: ValidationIssue[] };

export const VALIDATOR_MIN_CONFIDENCE = 0.75;

export function judgeValidatorVerdict(v: ValidatorVerdict, keyOptionId: string, spec: Pick<CellSpec, 'stimulusOnlyEvidence'>, escalated: boolean, extra: { declaredDifficulty?: number; deterministicKey?: boolean } = {}): ValidatorJudgement {
  const issues: ValidationIssue[] = [];
  const add = (code: string, severity: IssueSeverity, detail?: string) => issues.push({ stage: 'AI_VALIDATOR', code, severity, detail });
  if (v.assessesRequirement === false) add('DOES_NOT_ASSESS_REQUIREMENT', 'REPAIR');
  if (v.estimatedDifficulty && extra.declaredDifficulty !== undefined) {
    const order = ['LOW', 'MEDIUM', 'HIGH'];
    const declared = extra.declaredDifficulty <= 2 ? 'LOW' : extra.declaredDifficulty === 3 ? 'MEDIUM' : 'HIGH';
    if (Math.abs(order.indexOf(v.estimatedDifficulty) - order.indexOf(declared)) >= 2) add('DIFFICULTY_IMPLAUSIBLE', 'WARN', `${declared} vs ${v.estimatedDifficulty}`);
  }
  // The exam math engine already verified the key: a disagreeing validator is shown to the reviewer, it does not override.
  if (extra.deterministicKey) {
    if (v.selectedOptionId !== keyOptionId) add('VALIDATOR_DISAGREES_WITH_VERIFIED_KEY', 'WARN', `${v.selectedOptionId} vs ${keyOptionId}`);
    if (v.alternativeDefensibleOptionIds.filter((id) => id !== v.selectedOptionId).length) add('AMBIGUOUS_MULTIPLE_DEFENSIBLE', 'REPAIR');
    const w0 = worst(issues);
    return { outcome: (w0 === 'REJECTED' ? 'REPAIR_REQUIRED' : w0 ?? 'PASS') as ValidatorJudgement['outcome'], issues };
  }
  const alternatives = v.alternativeDefensibleOptionIds.filter((id) => id !== v.selectedOptionId);
  if (alternatives.length) add('AMBIGUOUS_MULTIPLE_DEFENSIBLE', 'REPAIR', alternatives.join(','));
  if (v.requiresOutsideInformation && spec.stimulusOnlyEvidence) add('REQUIRES_INFORMATION_NOT_IN_STIMULUS', 'REPAIR');
  if (v.implausibleDistractorIds.length >= 2) add('IMPLAUSIBLE_DISTRACTORS', 'REPAIR', v.implausibleDistractorIds.join(','));
  if (v.confidence < VALIDATOR_MIN_CONFIDENCE) {
    if (!escalated && issues.every((i) => i.severity === 'WARN')) return { outcome: 'ESCALATE', issues: [...issues, { stage: 'AI_VALIDATOR', code: 'LOW_CONFIDENCE', severity: 'REVIEW', detail: v.confidence.toFixed(2) }] };
    add('LOW_CONFIDENCE', 'REVIEW', v.confidence.toFixed(2));
  }
  if (v.selectedOptionId !== keyOptionId) add('VALIDATOR_DISAGREES_WITH_KEY', v.confidence >= VALIDATOR_MIN_CONFIDENCE ? 'REPAIR' : 'REVIEW', `${v.selectedOptionId} vs ${keyOptionId}`);
  const w = worst(issues);
  return { outcome: w === 'REJECTED' ? 'REPAIR_REQUIRED' : (w ?? 'PASS') as ValidatorJudgement['outcome'], issues };
}

export { LETTERS as OPTION_LETTERS };
