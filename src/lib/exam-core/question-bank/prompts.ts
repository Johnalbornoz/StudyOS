/**
 * Question Bank Factory -- generation / validation / repair PROMPTS and the
 * candidate -> item-version transform (pure).
 *
 * PRIVACY: a prompt is built ONLY from a `GenerationContext` -- exam structure,
 * the cell requirement, bank exemplars (StudyUS content, no Student data) and
 * optional AGGREGATE response statistics ("27% chose B"). Nothing in this
 * module can receive a Student, a name, an email, an institution or a Tutor
 * transcript, and `assertPromptPrivacy` rejects any payload that looks like it
 * carries one before a provider is ever called.
 *
 * Terminology: the factory uses aggregate analytics to choose what to generate
 * and to improve prompts; it never trains or fine-tunes a model.
 */
import { createHash } from 'crypto';
import type { ApprovedItemContent } from '../items';
import type { CandidateVerification, CellSpec, ValidatorVerdict } from './validation';
import { OPTION_LETTERS } from './validation';

export interface AggregateSignal {
  /** e.g. "27% de las respuestas eligen el distractor B (n=140)". Aggregates only. */
  summary: string;
  sampleSize: number;
  misconceptionCode?: string;
}

export interface GenerationContext {
  examLabel: string;
  versionLabel: string;
  componentName: string;
  /** componentDefinitionForAI(...) -- the structure contract (official formats, timing, marks). */
  componentContract: string | null;
  objectiveCode: string;
  objectiveDescription: string;
  spec: CellSpec;
  count: number;
  reason: string;
  /** Up to 3 bank items of the cell (question + options only): style reference, never to copy. */
  exemplars: Array<{ stimulusTitle: string | null; question: string; options: string[] }>;
  /** Normalized stems already in the bank: the candidate must differ. */
  avoidStems: string[];
  aggregate?: AggregateSignal | null;
  /** V2 demand-driven batch: the target difficulty (1..5) of each item, in order. */
  difficultyPlan?: number[] | null;
}

/* ------------------------------------------------------------------ */
/* Privacy guard                                                        */
/* ------------------------------------------------------------------ */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const FORBIDDEN_KEYS = /"(student(Id|Name|_id)?|name|email|parent\w*|institution\w*|transcript|tutor\w*|clerk\w*|userId)"\s*:/i;

export class PromptPrivacyError extends Error {
  constructor(public readonly finding: string) {
    super(`PROMPT_PRIVACY_VIOLATION: ${finding}`);
    this.name = 'PromptPrivacyError';
  }
}

/** Throws when a prompt payload carries anything Student-identifying. Called on every factory prompt before any provider call. */
export function assertPromptPrivacy(payload: string): void {
  if (EMAIL.test(payload)) throw new PromptPrivacyError('EMAIL');
  if (UUID.test(payload)) throw new PromptPrivacyError('IDENTIFIER');
  if (FORBIDDEN_KEYS.test(payload)) throw new PromptPrivacyError('PERSONAL_FIELD');
}

/* ------------------------------------------------------------------ */
/* Generation                                                           */
/* ------------------------------------------------------------------ */

export const GENERATION_SCHEMA = {
  name: 'question_bank_candidates',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['stimulusTitle', 'stimulusText', 'question', 'options', 'correctIndex', 'explanation', 'difficulty', 'cognitiveDemand', 'skill', 'distractorRationales', 'distractorMisconceptions', 'evidenceQuote', 'verificationExpression'],
          properties: {
            stimulusTitle: { type: ['string', 'null'] },
            stimulusText: { type: ['string', 'null'] },
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            correctIndex: { type: 'integer' },
            explanation: { type: 'string' },
            difficulty: { type: 'integer' },
            cognitiveDemand: { type: 'string', enum: ['RECALL', 'COMPREHENSION', 'APPLICATION', 'ANALYSIS', 'SYNTHESIS', 'EVALUATION'] },
            skill: { type: 'string' },
            distractorRationales: { type: 'array', items: { type: 'string' } },
            distractorMisconceptions: { type: 'array', items: { type: ['string', 'null'] } },
            evidenceQuote: { type: ['string', 'null'] },
            verificationExpression: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
};

export interface GeneratedCandidate {
  stimulusTitle: string | null;
  stimulusText: string | null;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: number;
  cognitiveDemand: string;
  skill: string;
  distractorRationales: string[];
  distractorMisconceptions: Array<string | null>;
  evidenceQuote: string | null;
  verificationExpression: string | null;
}

export function generationSystemPrompt(language: string): string {
  return [
    'You write ORIGINAL practice items for StudyUS, an exam-preparation platform. They are StudyUS-generated practice content:',
    'never present them as official questions, never copy or paraphrase released official items, never name the exam owner as the author.',
    'Write each item EXACTLY to the requirement you are given (section, skill, cognitive demand, difficulty, format). Do not invent structure.',
    'Selected response: exactly the requested number of options, ONE best answer, distractors that are plausible for a defensible reason',
    '(a typical error or misconception), no "all/none of the above", no option much longer than the others, no clue in wording.',
    'For every option give a rationale (empty string for the correct one) and, when it reflects a known misconception, a short UPPER_SNAKE code.',
    'MATHEMATICS: verificationExpression must be a plain arithmetic/algebraic expression (no words, no units) whose value IS the correct option',
    '(e.g. "(120-90)/90*100"); StudyUS recomputes it. Otherwise null.',
    'READING with a passage: evidenceQuote must be copied VERBATIM from the passage and must support the key; the answer must follow from the passage alone.',
    'Items that need a passage get a NEW original passage (stimulusTitle + stimulusText, 120-260 words). Otherwise both are null.',
    `Write everything in the item language: ${language}. Return JSON only.`,
  ].join('\n');
}

export function generationUserPrompt(ctx: GenerationContext): string {
  const s = ctx.spec;
  const lines = [
    `EXAM: ${ctx.examLabel} -- ${ctx.versionLabel}`,
    `SECTION: ${ctx.componentName}`,
    ctx.componentContract ? `SECTION CONTRACT:\n${ctx.componentContract}` : '',
    `REQUIREMENT (${ctx.objectiveCode}): ${ctx.objectiveDescription}`,
    `ITEMS TO WRITE: ${ctx.count} (reason: ${ctx.reason})`,
    `FORMAT: single best answer, ${s.optionCount} options${s.questionType ? `, question type ${s.questionType}` : ''}`,
    ctx.difficultyPlan?.length
      ? `DIFFICULTY (1-5) of each item, in this order: ${ctx.difficultyPlan.join(', ')} (1-2 low, 3 medium, 4-5 high)`
      : `DIFFICULTY (1-5): ${s.difficultyRange ? `${s.difficultyRange.min}-${s.difficultyRange.max}` : s.targetDifficulty}`,
    s.cognitiveDemand ? `COGNITIVE DEMAND: ${s.cognitiveDemand}` : '',
    `PASSAGE: ${s.stimulusRequired ? 'required -- one new passage shared by all items of this batch' : 'not needed'}`,
    `DOMAIN: ${s.domain === 'MATH' ? 'mathematics (verificationExpression REQUIRED)' : 'verbal / reading (evidenceQuote required when there is a passage)'}`,
    ctx.aggregate ? `AGGREGATE SIGNAL (anonymous): ${ctx.aggregate.summary}. Write items that distinguish this misconception${ctx.aggregate.misconceptionCode ? ` (${ctx.aggregate.misconceptionCode})` : ''}.` : '',
    ctx.exemplars.length
      ? `STYLE REFERENCE (do NOT copy; write different situations, numbers and wording):\n${ctx.exemplars.map((e, i) => `${i + 1}. ${e.stimulusTitle ? `[${e.stimulusTitle}] ` : ''}${e.question} | ${e.options.join(' / ')}`).join('\n')}`
      : '',
    ctx.avoidStems.length ? `ALREADY IN THE BANK (must differ):\n${ctx.avoidStems.slice(0, 20).map((q) => `- ${q.slice(0, 160)}`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n\n');
}

/** Structural check of the generator output (types only; the validation pipeline judges content). */
export function parseGenerationOutput(parsed: any, expected: { count: number; optionCount: number }): { value: GeneratedCandidate[]; errors: string[] } {
  const errors: string[] = [];
  const items = Array.isArray(parsed?.items) ? parsed.items : null;
  if (!items) return { value: [], errors: ['items missing'] };
  const out: GeneratedCandidate[] = [];
  for (const it of items.slice(0, expected.count)) {
    if (typeof it?.question !== 'string' || !Array.isArray(it.options) || !Number.isInteger(it.correctIndex)) {
      errors.push('item shape');
      continue;
    }
    out.push({
      stimulusTitle: typeof it.stimulusTitle === 'string' ? it.stimulusTitle : null,
      stimulusText: typeof it.stimulusText === 'string' && it.stimulusText.trim() ? it.stimulusText : null,
      question: it.question,
      options: it.options.map((o: unknown) => String(o)),
      correctIndex: it.correctIndex,
      explanation: typeof it.explanation === 'string' ? it.explanation : '',
      difficulty: Number.isInteger(it.difficulty) ? it.difficulty : 3,
      cognitiveDemand: typeof it.cognitiveDemand === 'string' ? it.cognitiveDemand : '',
      skill: typeof it.skill === 'string' ? it.skill : '',
      distractorRationales: Array.isArray(it.distractorRationales) ? it.distractorRationales.map((r: unknown) => String(r ?? '')) : [],
      distractorMisconceptions: Array.isArray(it.distractorMisconceptions) ? it.distractorMisconceptions.map((m: unknown) => (typeof m === 'string' && m ? m : null)) : [],
      evidenceQuote: typeof it.evidenceQuote === 'string' && it.evidenceQuote.trim() ? it.evidenceQuote : null,
      verificationExpression: typeof it.verificationExpression === 'string' && it.verificationExpression.trim() ? it.verificationExpression : null,
    });
  }
  if (out.length === 0) errors.push('no usable items');
  return { value: out, errors: out.length ? [] : errors };
}

const shortHash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** Deterministic option order (seeded by the item key): the key position never leaks a pattern across the bank. */
function seededPermutation(n: number, seed: string): number[] {
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => shortHash(`${seed}:${a}`).localeCompare(shortHash(`${seed}:${b}`)));
}

/**
 * Candidate -> immutable item-version content. Always `contentOrigin: GENERATED`
 * + `contentStatus: ORIGINAL` (provenance STUDYUS_GENERATED), whatever the
 * model wrote. Returns the verification material separately.
 */
export function candidateToContent(c: GeneratedCandidate, ctx: { itemKey: string; spec: CellSpec; stimulusKey: string | null; difficultyIndex: number }): { content: Record<string, unknown>; verification: CandidateVerification } {
  const order = seededPermutation(c.options.length, ctx.itemKey);
  const options = order.map((orig, i) => ({ id: OPTION_LETTERS[i], text: c.options[orig] }));
  const idOf = (orig: number) => OPTION_LETTERS[order.indexOf(orig)];
  const rationale: Record<string, string> = {};
  const misconceptions: Record<string, string> = {};
  c.options.forEach((_, orig) => {
    if (orig === c.correctIndex) return;
    const r = (c.distractorRationales[orig] ?? '').trim();
    if (r) rationale[idOf(orig)] = r.slice(0, 400);
    const m = c.distractorMisconceptions[orig];
    if (m && /^[A-Z][A-Z0-9_]{2,79}$/.test(m)) misconceptions[idOf(orig)] = m;
  });
  const content: Record<string, unknown> = {
    key: ctx.itemKey,
    contentStatus: 'ORIGINAL',
    contentOrigin: 'GENERATED',
    language: ctx.spec.language,
    type: ctx.spec.questionType ?? 'multiple_choice',
    answerFormat: 'single_choice',
    question: c.question.trim(),
    options,
    correctAnswer: c.correctIndex >= 0 && c.correctIndex < c.options.length ? idOf(c.correctIndex) : 'Z',
    explanation: c.explanation.trim() || '—',
    difficulty: Math.min(5, Math.max(1, Math.round(c.difficulty))),
    difficultyIndex: ctx.difficultyIndex,
    marks: 1,
    scoringStrategy: 'EXACT',
    tags: { skill: c.skill.slice(0, 80) || undefined, cognitiveDemand: c.cognitiveDemand || undefined, responseFormat: 'SELECTED_RESPONSE' },
    distractorRationale: Object.keys(rationale).length ? rationale : undefined,
    distractorMisconceptions: Object.keys(misconceptions).length ? misconceptions : undefined,
    ...(c.stimulusText && ctx.stimulusKey ? { stimulus: { key: ctx.stimulusKey, title: c.stimulusTitle ?? undefined, text: c.stimulusText.trim() } } : {}),
  };
  return { content, verification: { verificationExpression: c.verificationExpression, evidenceQuote: c.evidenceQuote } };
}

/* ------------------------------------------------------------------ */
/* Independent validator (solves the item without the key)              */
/* ------------------------------------------------------------------ */

export const VALIDATOR_SCHEMA = {
  name: 'question_bank_item_validation',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['selectedOptionId', 'confidence', 'alternativeDefensibleOptionIds', 'requiresOutsideInformation', 'implausibleDistractorIds', 'assessesRequirement', 'estimatedDifficulty', 'note'],
    properties: {
      selectedOptionId: { type: 'string' },
      confidence: { type: 'number' },
      alternativeDefensibleOptionIds: { type: 'array', items: { type: 'string' } },
      requiresOutsideInformation: { type: 'boolean' },
      implausibleDistractorIds: { type: 'array', items: { type: 'string' } },
      assessesRequirement: { type: 'boolean' },
      estimatedDifficulty: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      note: { type: 'string' },
    },
  },
};

export function validatorSystemPrompt(): string {
  return [
    'You independently check a practice exam item. You are NOT told the intended answer.',
    'Solve it carefully and pick the single best option. Then report honestly:',
    '- any OTHER option a careful, well-prepared reader could defend as correct;',
    '- whether answering needs information that the passage does not give (when there is a passage);',
    '- distractors that are not plausible at all (trivially wrong for any reader);',
    '- whether the item really assesses the stated REQUIREMENT (when one is given);',
    '- how hard it is for the target Student: LOW, MEDIUM or HIGH.',
    'confidence is your probability (0-1) that your chosen option is the unique best answer. Return JSON only.',
  ].join('\n');
}

export function validatorUserPrompt(content: Pick<ApprovedItemContent, 'question' | 'options' | 'stimulus' | 'language'>, requirement?: string | null): string {
  return [
    requirement ? `REQUIREMENT the item should assess: ${requirement}` : '',
    content.stimulus ? `PASSAGE${content.stimulus.title ? ` (${content.stimulus.title})` : ''}:\n${content.stimulus.text}` : '',
    `QUESTION (${content.language}): ${content.question}`,
    `OPTIONS:\n${(content.options ?? []).map((o) => `${o.id}) ${o.text}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function parseValidatorOutput(parsed: any, optionIds: string[]): { value: ValidatorVerdict; errors: string[] } {
  const ok = (id: unknown) => typeof id === 'string' && optionIds.includes(id);
  const errors: string[] = [];
  if (!ok(parsed?.selectedOptionId)) errors.push('selectedOptionId');
  const confidence = Number(parsed?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) errors.push('confidence');
  return {
    value: {
      selectedOptionId: parsed?.selectedOptionId,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      alternativeDefensibleOptionIds: Array.isArray(parsed?.alternativeDefensibleOptionIds) ? parsed.alternativeDefensibleOptionIds.filter(ok) : [],
      requiresOutsideInformation: parsed?.requiresOutsideInformation === true,
      implausibleDistractorIds: Array.isArray(parsed?.implausibleDistractorIds) ? parsed.implausibleDistractorIds.filter(ok) : [],
      assessesRequirement: typeof parsed?.assessesRequirement === 'boolean' ? parsed.assessesRequirement : undefined,
      estimatedDifficulty: ['LOW', 'MEDIUM', 'HIGH'].includes(parsed?.estimatedDifficulty) ? parsed.estimatedDifficulty : undefined,
    },
    errors,
  };
}

/* ------------------------------------------------------------------ */
/* Repair (one bounded attempt, a NEW version)                          */
/* ------------------------------------------------------------------ */

export function repairUserPrompt(ctx: GenerationContext, previous: GeneratedCandidate, issues: Array<{ code: string; detail?: string }>): string {
  return [
    generationUserPrompt({ ...ctx, count: 1 }),
    `PREVIOUS DRAFT (rejected by automated checks):\n${JSON.stringify({ ...previous, distractorMisconceptions: undefined })}`,
    `FIX EXACTLY THESE PROBLEMS: ${issues.map((i) => `${i.code}${i.detail ? ` (${i.detail.slice(0, 120)})` : ''}`).join('; ')}`,
    'Return ONE corrected item in the same JSON shape.',
  ].join('\n\n');
}
