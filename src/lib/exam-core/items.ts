/**
 * Track B / B1 -- the exam ITEM model.
 *
 * An exam item is the existing `GeneratedQuestion` shape (so every existing
 * grader and answer control keeps working) plus exam-only metadata: marks,
 * an optional shared stimulus (PISA-style units / PAA reading passages),
 * optional mark-scheme parts carrying rubric criteria (IB / Cambridge),
 * deterministic accepted answers for text responses, and the item source.
 *
 * Items come from two places, both server-side only:
 *   - APPROVED_BANK: a PUBLISHED `approved_items` row (content validated by
 *     `ApprovedItemContentSchema` + `validateExamItemStructure`);
 *   - AI_GENERATED: the existing generator, then the same structural
 *     validation plus the F7 exam-context validation (type / difficulty /
 *     published mapping). An invalid generation is never delivered.
 *
 * `toExamClientItem` is the ONLY transform to the browser: it starts from
 * the existing `toClientQuestion` sanitizer and adds stimulus / parts / marks
 * with every answer-bearing field stripped.
 */
import { z } from 'zod';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { toClientQuestion } from '@/lib/quiz/client-question';
import { gradeMath } from './math/math-engine';

export type ExamItemSource = 'APPROVED_BANK' | 'AI_GENERATED';

const OptionSchema = z.object({ id: z.string().min(1).max(40), text: z.string().min(1).max(2000) });

/** V2 -- scoring strategies (section 35). Each item / part / component selects one. */
export const SCORING_STRATEGIES = [
  'EXACT',
  'MATHEMATICAL_EQUIVALENCE',
  'NUMERIC_TOLERANCE',
  'UNIT_AWARE',
  'PARTIAL_CREDIT',
  'METHOD_MARK',
  'ANALYTIC_RUBRIC',
  'BEST_FIT_RUBRIC',
  'MARKSCHEME',
  'MULTI_PART',
  'PORTFOLIO_RUBRIC',
  'PERFORMANCE_RUBRIC',
] as const;
export type ScoringStrategyKind = (typeof SCORING_STRATEGIES)[number];

export const CONTENT_ORIGINS = ['OFFICIAL', 'LICENSED', 'GENERATED', 'FIXTURE'] as const;
export type ContentOrigin = (typeof CONTENT_ORIGINS)[number];

/** V2 -- mathematical answer key (math-engine.ts). */
export const MathKeySchema = z.object({
  kind: z.enum(['EXPRESSION', 'NUMBER', 'EQUATION', 'INEQUALITY', 'INTERVAL']),
  answers: z.array(z.string().min(1).max(500)).min(1).max(10),
  requiredForm: z.enum(['ANY', 'EXACT', 'DECIMAL', 'SIMPLIFIED_FRACTION', 'FACTORED', 'EXPANDED', 'SCIENTIFIC', 'INTEGER']).optional(),
  decimalPlaces: z.number().int().min(0).max(10).optional(),
  significantFigures: z.number().int().min(1).max(10).optional(),
  tolerance: z.object({ absolute: z.number().min(0).optional(), relative: z.number().min(0).optional() }).optional(),
  units: z.object({ expected: z.string().min(1).max(40), required: z.boolean().optional(), allowConversion: z.boolean().optional() }).optional(),
  /** Fraction of the marks kept when the value is right but a requirement is not met. */
  partialCredit: z
    .object({ formNotMet: z.number().min(0).max(1).default(0.5), unitMissing: z.number().min(0).max(1).default(0.5), unitWrong: z.number().min(0).max(1).default(0), significantFigures: z.number().min(0).max(1).default(0.5) })
    .default({ formNotMet: 0.5, unitMissing: 0.5, unitWrong: 0, significantFigures: 0.5 }),
});
export type MathKeyContent = z.infer<typeof MathKeySchema>;

/** V2 -- method marks: awarded when the Student's working contains an equivalent intermediate result (deterministic first). */
export const MethodKeySchema = z.object({
  marks: z.number().positive().max(20),
  criterion: z.string().min(1).max(60).default('M'),
  /** Intermediate expressions / equations any one of which evidences the method. */
  intermediates: z.array(z.string().min(1).max(300)).min(1).max(10),
  /** Also award the method marks when the final answer is fully correct (follow-through). */
  impliedByCorrectAnswer: z.boolean().default(true),
});
export type MethodKey = z.infer<typeof MethodKeySchema>;

/** V2 -- analytic / best-fit rubric for interpretive responses (double assessor). */
export const RubricSchema = z.object({
  kind: z.enum(['ANALYTIC', 'BEST_FIT']),
  criteria: z
    .array(
      z.object({
        id: z.string().min(1).max(20),
        name: z.string().min(1).max(200),
        maxMarks: z.number().positive().max(40),
        descriptors: z.array(z.object({ marks: z.string().min(1).max(20), descriptor: z.string().min(1).max(1500) })).min(1).max(12),
      })
    )
    .min(1)
    .max(10),
  modelAnswer: z.string().max(6000).optional(),
  guidance: z.string().max(3000).optional(),
  /** Absolute mark difference between assessors that triggers adjudication. */
  disagreementThreshold: z.number().min(0).max(40).default(2),
  /** Below this confidence the response is REVIEW_REQUIRED. */
  minConfidence: z.number().min(0).max(1).default(0.6),
});
export type RubricContent = z.infer<typeof RubricSchema>;

/** V2 -- portfolio / performance task (IB Arts): what the submission must contain. */
export const PortfolioTaskSchema = z.object({
  componentKind: z.enum(['COMPARATIVE_STUDY', 'PROCESS_PORTFOLIO', 'EXHIBITION', 'PERFORMANCE', 'PROJECT', 'OTHER']),
  requiredArtifacts: z
    .array(z.object({ kind: z.enum(['IMAGE', 'PDF', 'TEXT', 'AUDIO', 'VIDEO', 'PRESENTATION', 'PORTFOLIO_PAGE', 'STATEMENT', 'PROCESS_EVIDENCE', 'BIBLIOGRAPHY']), min: z.number().int().min(0).max(30), max: z.number().int().min(1).max(30), label: z.string().min(1).max(200) }))
    .min(1)
    .max(10),
  statementRequired: z.boolean().default(true),
  statementMaxWords: z.number().int().positive().max(3000).optional(),
  rubric: RubricSchema,
});
export type PortfolioTask = z.infer<typeof PortfolioTaskSchema>;

/** V2 -- blueprint tags carried by every item (section 17). Labels only; the blueprint decides coverage. */
export const ItemBlueprintTagsSchema = z.object({
  assessmentObjective: z.string().max(60).optional(),
  process: z.string().max(60).optional(),
  context: z.string().max(60).optional(),
  contentCategory: z.string().max(60).optional(),
  competency: z.string().max(80).optional(),
  assertion: z.string().max(400).optional(),
  evidence: z.string().max(400).optional(),
  skill: z.string().max(80).optional(),
  cognitiveDemand: z.enum(['RECALL', 'COMPREHENSION', 'APPLICATION', 'ANALYSIS', 'SYNTHESIS', 'EVALUATION']).optional(),
  responseFormat: z.string().max(60).optional(),
});
export type ItemBlueprintTags = z.infer<typeof ItemBlueprintTagsSchema>;

export const ExamItemPartSchema = z.object({
  id: z.string().min(1).max(40),
  prompt: z.string().min(1).max(4000),
  answerFormat: z.enum(['single_choice', 'multi_choice', 'text', 'math']),
  /** V2: math part key (answerFormat 'math'). */
  math: MathKeySchema.optional(),
  /** V2: method marks for this part (on top of `marks`). */
  method: MethodKeySchema.optional(),
  options: z.array(OptionSchema).optional(),
  correctAnswer: z.string().min(1).max(2000),
  /** Deterministic accepted answers for a text part (normalized comparison). */
  acceptableAnswers: z.array(z.string().min(1).max(500)).optional(),
  /** Absolute tolerance for a numeric text part. */
  numericTolerance: z.number().min(0).optional(),
  marks: z.number().positive().max(100),
  /** Rubric criterion this part's marks count toward (e.g. "A", "knowledge"). */
  criterion: z.string().min(1).max(60),
});
export type ExamItemPart = z.infer<typeof ExamItemPartSchema>;

export const StimulusSchema = z.object({
  key: z.string().min(1).max(80),
  title: z.string().max(200).optional(),
  text: z.string().min(1).max(12000),
});
export type ExamStimulus = z.infer<typeof StimulusSchema>;

/** The stored shape of `approved_items.content` for exam-core items. */
export const ApprovedItemContentSchema = z.object({
  key: z.string().min(1).max(120),
  /** Required label on every non-official item; certification fixtures use DEV_CERT_FIXTURE. */
  contentStatus: z.enum(['DEV_CERT_FIXTURE', 'OFFICIAL_LICENSED', 'ORIGINAL']),
  language: z.string().min(2).max(10),
  type: z.string().min(1).max(40),
  answerFormat: z.enum(['single_choice', 'multi_choice', 'text', 'matching', 'ordering', 'classification']),
  question: z.string().min(1).max(8000),
  options: z.array(OptionSchema).optional(),
  matchingPairs: z.array(z.object({ left: z.string().min(1), right: z.string().min(1) })).optional(),
  orderingItems: z.array(z.string().min(1)).optional(),
  classificationCategories: z.array(z.string().min(1)).optional(),
  classificationItems: z.array(z.object({ item: z.string().min(1), category: z.string().min(1) })).optional(),
  correctAnswer: z.string().min(1).max(4000),
  acceptableAnswers: z.array(z.string().min(1).max(500)).optional(),
  numericTolerance: z.number().min(0).optional(),
  explanation: z.string().min(1).max(4000),
  difficulty: z.number().int().min(1).max(5),
  marks: z.number().positive().max(100).default(1),
  commandTerm: z.string().max(60).optional(),
  calculatorAllowed: z.boolean().optional(),
  stimulus: StimulusSchema.optional(),
  parts: z.array(ExamItemPartSchema).min(1).max(12).optional(),
  // ---- V2 (all optional: V1 items stay valid) ----
  contentOrigin: z.enum(CONTENT_ORIGINS).optional(),
  scoringStrategy: z.enum(SCORING_STRATEGIES).optional(),
  /** Answer is entered with the math editor and graded by the equivalence engine. */
  math: MathKeySchema.optional(),
  method: MethodKeySchema.optional(),
  rubric: RubricSchema.optional(),
  portfolio: PortfolioTaskSchema.optional(),
  /** 1.0 = calibrated target difficulty of the exam; >1 harder. */
  difficultyIndex: z.number().min(0.3).max(2).optional(),
  tags: ItemBlueprintTagsSchema.optional(),
  /** Why each wrong option is attractive (selection items). */
  distractorRationale: z.record(z.string(), z.string().max(400)).optional(),
  /** Question Bank Factory: the misconception each distractor is designed to reveal (server-side only). */
  distractorMisconceptions: z.record(z.string(), z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/)).optional(),
  calculator: z.enum(['NONE', 'ALLOWED', 'SCIENTIFIC_REQUIRED', 'GDC_REQUIRED']).optional(),
});
export type ApprovedItemContent = z.infer<typeof ApprovedItemContentSchema>;

export interface ExamItemMeta {
  source: ExamItemSource;
  approvedItemId: string | null;
  key: string | null;
  contentStatus: ApprovedItemContent['contentStatus'] | 'AI_GENERATED';
  marks: number;
  stimulus: ExamStimulus | null;
  parts: ExamItemPart[] | null;
  acceptableAnswers: string[] | null;
  numericTolerance: number | null;
  commandTerm: string | null;
  // ---- V2 ----
  contentOrigin?: ContentOrigin;
  scoringStrategy?: ScoringStrategyKind;
  math?: MathKeyContent | null;
  method?: MethodKey | null;
  rubric?: RubricContent | null;
  portfolio?: PortfolioTask | null;
  difficultyIndex?: number | null;
  tags?: ItemBlueprintTags | null;
  distractorRationale?: Record<string, string> | null;
  calculator?: ApprovedItemContent['calculator'] | null;
}

export function contentOriginOf(c: Pick<ApprovedItemContent, 'contentOrigin' | 'contentStatus'>): ContentOrigin {
  if (c.contentOrigin) return c.contentOrigin;
  return c.contentStatus === 'OFFICIAL_LICENSED' ? 'LICENSED' : c.contentStatus === 'DEV_CERT_FIXTURE' ? 'FIXTURE' : 'GENERATED';
}

/** The strategy an item is scored with: explicit when configured, otherwise derived from its shape. */
export function scoringStrategyOf(item: ExamItem): ScoringStrategyKind {
  const e = item.exam;
  if (e.scoringStrategy) return e.scoringStrategy;
  if (e.portfolio) return 'PORTFOLIO_RUBRIC';
  if (e.rubric) return e.rubric.kind === 'BEST_FIT' ? 'BEST_FIT_RUBRIC' : 'ANALYTIC_RUBRIC';
  if (e.parts) return 'MULTI_PART';
  if (e.math) return e.math.units ? 'UNIT_AWARE' : 'MATHEMATICAL_EQUIVALENCE';
  if (item.answerFormat === 'text') return e.numericTolerance !== null && e.numericTolerance !== undefined ? 'NUMERIC_TOLERANCE' : 'EXACT';
  if (item.answerFormat === 'single_choice') return 'EXACT';
  return 'PARTIAL_CREDIT';
}

/** Server-held item: the full question (with answer key) + exam metadata. Never sent to the client as-is. */
export type ExamItem = GeneratedQuestion & { exam: ExamItemMeta };

export function examItemFromApproved(row: { id: string; learning_objective_id: string; content: unknown }): ExamItem | null {
  const parsed = ApprovedItemContentSchema.safeParse(row.content);
  if (!parsed.success) return null;
  const c = parsed.data;
  const item: ExamItem = {
    id: row.id,
    conceptId: '',
    type: c.type as GeneratedQuestion['type'],
    answerFormat: c.answerFormat,
    question: c.question,
    options: c.options,
    matchingPairs: c.matchingPairs,
    orderingItems: c.orderingItems,
    classificationCategories: c.classificationCategories,
    classificationItems: c.classificationItems,
    correctAnswer: c.correctAnswer,
    explanation: c.explanation,
    difficulty: c.difficulty,
    calculatorAllowed: c.calculatorAllowed,
    learningObjectiveId: row.learning_objective_id,
    exam: {
      source: 'APPROVED_BANK',
      approvedItemId: row.id,
      key: c.key,
      contentStatus: c.contentStatus,
      marks: c.marks,
      stimulus: c.stimulus ?? null,
      parts: c.parts ?? null,
      acceptableAnswers: c.acceptableAnswers ?? null,
      numericTolerance: c.numericTolerance ?? null,
      commandTerm: c.commandTerm ?? null,
      contentOrigin: contentOriginOf(c),
      scoringStrategy: c.scoringStrategy,
      math: c.math ?? null,
      method: c.method ?? null,
      rubric: c.rubric ?? null,
      portfolio: c.portfolio ?? null,
      difficultyIndex: c.difficultyIndex ?? null,
      tags: c.tags ?? null,
      distractorRationale: c.distractorRationale ?? null,
      calculator: c.calculator ?? null,
    },
  };
  return validateExamItemStructure(item).valid ? item : null;
}

export function examItemFromGenerated(q: GeneratedQuestion, learningObjectiveId: string | null): ExamItem {
  return {
    ...q,
    learningObjectiveId: learningObjectiveId ?? q.learningObjectiveId,
    exam: {
      source: 'AI_GENERATED',
      approvedItemId: null,
      key: null,
      contentStatus: 'AI_GENERATED',
      marks: 1,
      stimulus: null,
      parts: null,
      acceptableAnswers: null,
      numericTolerance: null,
      commandTerm: null,
      contentOrigin: 'GENERATED',
    },
  };
}

/**
 * Answer-validity check for an item before it may ever be delivered: the
 * answer key must actually be answerable with the controls the client will
 * render. Pure, deterministic, never throws.
 */
export function validateExamItemStructure(item: ExamItem): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!item.question || !item.question.trim()) reasons.push('EMPTY_QUESTION');
  if (!Number.isInteger(item.difficulty) || item.difficulty < 1 || item.difficulty > 5) reasons.push('DIFFICULTY_OUT_OF_SCALE');

  const checkChoice = (format: string, options: { id: string }[] | undefined, correct: string, label: string) => {
    const ids = (options ?? []).map((o) => o.id);
    if (ids.length < 2) reasons.push(`${label}TOO_FEW_OPTIONS`);
    if (new Set(ids).size !== ids.length) reasons.push(`${label}DUPLICATE_OPTION_IDS`);
    const keys = format === 'multi_choice' ? correct.split(',').map((s) => s.trim()).filter(Boolean) : [correct];
    if (keys.length === 0 || keys.some((k) => !ids.includes(k))) reasons.push(`${label}ANSWER_KEY_NOT_AN_OPTION`);
  };

  if (item.exam.parts) {
    const partIds = item.exam.parts.map((p) => p.id);
    if (new Set(partIds).size !== partIds.length) reasons.push('DUPLICATE_PART_IDS');
    for (const part of item.exam.parts) {
      if (part.answerFormat === 'math') {
        if (!part.math) reasons.push(`PART_${part.id}_NO_MATH_KEY`);
        else reasons.push(...mathKeyProblems(part.math, `PART_${part.id}_`));
        if (part.method) reasons.push(...methodKeyProblems(part.method, `PART_${part.id}_`));
      } else if (part.answerFormat === 'text') {
        if (!part.acceptableAnswers || part.acceptableAnswers.length === 0) reasons.push(`PART_${part.id}_NO_DETERMINISTIC_KEY`);
      } else {
        checkChoice(part.answerFormat, part.options, part.correctAnswer, `PART_${part.id}_`);
      }
    }
  } else {
    switch (item.answerFormat) {
      case 'single_choice':
      case 'multi_choice':
        checkChoice(item.answerFormat, item.options, item.correctAnswer ?? '', '');
        break;
      case 'matching':
        if (!item.matchingPairs || item.matchingPairs.length < 2) reasons.push('TOO_FEW_PAIRS');
        break;
      case 'ordering':
        if (!item.orderingItems || item.orderingItems.length < 2) reasons.push('TOO_FEW_ORDERING_ITEMS');
        break;
      case 'classification': {
        const cats = new Set(item.classificationCategories ?? []);
        if (cats.size < 2 || !item.classificationItems || item.classificationItems.length === 0) reasons.push('INCOMPLETE_CLASSIFICATION');
        else if (item.classificationItems.some((ci) => !cats.has(ci.category))) reasons.push('CLASSIFICATION_KEY_NOT_A_CATEGORY');
        break;
      }
      case 'text':
        if (!item.correctAnswer || !item.correctAnswer.trim()) reasons.push('EMPTY_ANSWER_KEY');
        if (item.exam.math) reasons.push(...mathKeyProblems(item.exam.math, ''));
        if (item.exam.method) reasons.push(...methodKeyProblems(item.exam.method, ''));
        break;
    }
  }
  if (item.exam.math && item.answerFormat !== 'text') reasons.push('MATH_KEY_ON_NON_TEXT_ITEM');
  if (item.exam.rubric) reasons.push(...rubricProblems(item.exam.rubric, ''));
  if (item.exam.portfolio) {
    reasons.push(...rubricProblems(item.exam.portfolio.rubric, 'PORTFOLIO_'));
    for (const a of item.exam.portfolio.requiredArtifacts) if (a.min > a.max) reasons.push(`PORTFOLIO_ARTIFACT_${a.kind}_MIN_GT_MAX`);
    if (Math.abs(rubricMax(item.exam.portfolio.rubric) - item.exam.marks) > 1e-9) reasons.push('PORTFOLIO_RUBRIC_MARKS_MISMATCH');
  } else if (item.exam.rubric && !item.exam.parts && Math.abs(rubricMax(item.exam.rubric) - item.exam.marks) > 1e-9) {
    reasons.push('RUBRIC_MARKS_MISMATCH');
  }
  if (!(item.exam.marks > 0)) reasons.push('NON_POSITIVE_MARKS');
  return { valid: reasons.length === 0, reasons };
}

/**
 * Every accepted answer of a math key must parse and be equivalent to itself
 * under the key (catches unparseable keys), and every accepted answer must
 * be equivalent to the first one. A key may hold the EXACT value (e.g. 12π)
 * while requiring significant figures from the Student, so the rounding
 * requirement is not applied to the key itself.
 */
function mathKeyProblems(key: MathKeyContent, label: string): string[] {
  const out: string[] = [];
  const lenient = { ...key, significantFigures: undefined, decimalPlaces: undefined, requiredForm: undefined };
  for (const a of key.answers) {
    const self = gradeMath(a, { ...lenient, answers: [a] });
    if (self.mathematicalCorrectness !== 'EQUIVALENT') out.push(`${label}MATH_KEY_NOT_SELF_CONSISTENT`);
    const first = gradeMath(a, { ...lenient, answers: [key.answers[0]] });
    if (first.mathematicalCorrectness !== 'EQUIVALENT') out.push(`${label}MATH_KEY_ANSWERS_DISAGREE`);
  }
  return [...new Set(out)];
}

function methodKeyProblems(key: MethodKey, label: string): string[] {
  // An intermediate must at least parse as an expression or relation; otherwise no working could ever evidence it.
  return key.intermediates.some((m) => gradeMath(m, { kind: /[=<>≤≥]/.test(m) ? (/[<>≤≥]/.test(m) ? 'INEQUALITY' : 'EQUATION') : 'EXPRESSION', answers: [m] }).judgment !== 'CORRECT')
    ? [`${label}METHOD_INTERMEDIATE_UNPARSEABLE`]
    : [];
}

export function rubricMax(r: RubricContent): number {
  return r.criteria.reduce((sum, c) => sum + c.maxMarks, 0);
}

function rubricProblems(r: RubricContent, label: string): string[] {
  const ids = r.criteria.map((c) => c.id);
  return new Set(ids).size !== ids.length ? [`${label}DUPLICATE_RUBRIC_CRITERIA`] : [];
}

/** Marks an item is worth: the sum of its parts when it has parts, else its own marks. */
export function examItemMarks(item: ExamItem): number {
  if (item.exam.parts) return item.exam.parts.reduce((sum, p) => sum + p.marks + (p.method?.marks ?? 0), 0);
  return item.exam.marks + (item.exam.method?.marks ?? 0);
}

export interface ExamClientPart {
  id: string;
  prompt: string;
  answerFormat: ExamItemPart['answerFormat'];
  options?: { id: string; text: string }[];
  marks: number;
  /** V2: the Student is expected to state a unit (never which one). */
  unitRequired?: boolean;
  /** V2: working is read for method marks. */
  showWorking?: boolean;
}

/** Content-origin label shown on every non-official item (section 47). */
export function contentOriginLabelKey(origin: ContentOrigin | undefined): 'exv2.origin.official' | 'exv2.origin.licensed' | 'exv2.origin.generated' | 'exv2.origin.fixture' {
  switch (origin) {
    case 'OFFICIAL':
      return 'exv2.origin.official';
    case 'LICENSED':
      return 'exv2.origin.licensed';
    case 'FIXTURE':
      return 'exv2.origin.fixture';
    default:
      return 'exv2.origin.generated';
  }
}

/**
 * The only browser-bound shape of an exam item. Built from the existing
 * `toClientQuestion` (which strips correctAnswer / order / pairing), then adds
 * the exam metadata with every key-bearing field removed: parts lose
 * correctAnswer / acceptableAnswers / numericTolerance / criterion, and no
 * explanation, approved-item id or content status is ever included.
 */
export function toExamClientItem(item: ExamItem, index: number) {
  const base = toClientQuestion(item, index);
  const parts: ExamClientPart[] | undefined = item.exam.parts?.map((p) => ({
    id: p.id,
    prompt: p.prompt,
    answerFormat: p.answerFormat,
    options: p.options?.map((o) => ({ id: o.id, text: o.text })),
    marks: p.marks + (p.method?.marks ?? 0),
    unitRequired: p.math?.units?.required ? true : undefined,
    showWorking: p.method ? true : undefined,
  }));
  const e = item.exam;
  return {
    ...base,
    conceptId: undefined,
    marks: examItemMarks(item),
    stimulus: e.stimulus ? { key: e.stimulus.key, title: e.stimulus.title, text: e.stimulus.text } : undefined,
    parts,
    commandTerm: e.commandTerm ?? undefined,
    // ---- V2 (labels and input hints only; no key, model answer or descriptor) ----
    inputMode: e.portfolio ? ('portfolio' as const) : e.math ? ('math' as const) : undefined,
    unitRequired: e.math?.units?.required ? true : undefined,
    showWorking: e.method ? true : undefined,
    calculator: e.calculator ?? undefined,
    originLabel: contentOriginLabelKey(e.contentOrigin),
    rubricCriteria: (e.portfolio?.rubric ?? e.rubric)?.criteria.map((c) => ({ id: c.id, name: c.name, maxMarks: c.maxMarks })),
    portfolioRequirements: e.portfolio
      ? {
          componentKind: e.portfolio.componentKind,
          artifacts: e.portfolio.requiredArtifacts.map((a) => ({ kind: a.kind, min: a.min, max: a.max, label: a.label })),
          statementRequired: e.portfolio.statementRequired,
          statementMaxWords: e.portfolio.statementMaxWords,
        }
      : undefined,
  };
}

export type ExamClientItem = ReturnType<typeof toExamClientItem>;

/** Keys that must never appear anywhere in a client payload (deep). Used by tests and a runtime guard. */
// (`classificationItems` is deliberately absent: the client shape carries only the item labels, never their categories.)
export const ANSWER_BEARING_KEYS = [
  'correctAnswer', 'acceptableAnswers', 'numericTolerance', 'explanation', 'matchingPairs', 'orderingItems', 'criterion', 'approvedItemId',
  // V2 keys: math / method / rubric internals never leave the server.
  'answers', 'intermediates', 'modelAnswer', 'descriptors', 'guidance', 'distractorRationale', 'distractorMisconceptions', 'partialCredit', 'math', 'method', 'rubric', 'expected',
] as const;

export function findAnswerKeyLeak(payload: unknown, path = '$'): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      const leak = findAnswerKeyLeak(payload[i], `${path}[${i}]`);
      if (leak) return leak;
    }
    return null;
  }
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value !== undefined && (ANSWER_BEARING_KEYS as readonly string[]).includes(key)) return `${path}.${key}`;
    const leak = findAnswerKeyLeak(value, `${path}.${key}`);
    if (leak) return leak;
  }
  return null;
}
