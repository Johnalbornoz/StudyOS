/**
 * Exam V2 -- builders for the reference verticals' bank items.
 *
 * Every item is ORIGINAL StudyUS practice content, labelled
 * `contentStatus: 'DEV_CERT_FIXTURE'` + `contentOrigin: 'FIXTURE'`: written to
 * the published structure of each framework (formats, marks, command terms,
 * processes) so the engine can be exercised end to end -- never an official
 * question, never an official mark scheme or criterion.
 */
import type { z } from 'zod';
import type { ApprovedItemContentSchema, ExamItemPartSchema, MathKeySchema, MethodKeySchema, RubricSchema, PortfolioTaskSchema, ItemBlueprintTagsSchema } from '../../items';

type ItemInput = z.input<typeof ApprovedItemContentSchema>;
type PartInput = z.input<typeof ExamItemPartSchema>;
type MathKey = z.input<typeof MathKeySchema>;
type MethodKey = z.input<typeof MethodKeySchema>;
type Rubric = z.input<typeof RubricSchema>;
type Portfolio = z.input<typeof PortfolioTaskSchema>;
type Tags = z.input<typeof ItemBlueprintTagsSchema>;
type Stimulus = { key: string; title?: string; text: string };
type Calculator = 'NONE' | 'ALLOWED' | 'SCIENTIFIC_REQUIRED' | 'GDC_REQUIRED';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface Common {
  key: string;
  language: string;
  question: string;
  explanation: string;
  difficulty?: number;
  difficultyIndex?: number;
  tags?: Tags;
  commandTerm?: string;
  calculator?: Calculator;
  stimulus?: Stimulus;
}

const base = (c: Common) => ({
  key: c.key,
  contentStatus: 'DEV_CERT_FIXTURE' as const,
  contentOrigin: 'FIXTURE' as const,
  language: c.language,
  question: c.question,
  explanation: c.explanation,
  difficulty: c.difficulty ?? 3,
  difficultyIndex: c.difficultyIndex ?? 1.0,
  tags: c.tags,
  commandTerm: c.commandTerm,
  calculator: c.calculator,
  calculatorAllowed: c.calculator ? c.calculator !== 'NONE' : undefined,
  stimulus: c.stimulus,
});

/** Selected response (one key). `rationale` explains each distractor (server-side only). */
export function mc(c: Common & { options: string[]; correct: number; marks?: number; rationale?: string[] }): ItemInput {
  return {
    ...base(c),
    type: 'multiple_choice',
    answerFormat: 'single_choice',
    options: c.options.map((text, i) => ({ id: LETTERS[i], text })),
    correctAnswer: LETTERS[c.correct],
    marks: c.marks ?? 1,
    scoringStrategy: 'EXACT',
    distractorRationale: c.rationale ? Object.fromEntries(c.rationale.map((r, i) => [LETTERS[i], r]).filter(([, r]) => r)) : undefined,
  };
}

/** Multi-select (partial credit). */
export function ms(c: Common & { options: string[]; correct: number[]; marks?: number }): ItemInput {
  return {
    ...base(c),
    type: 'multi_select',
    answerFormat: 'multi_choice',
    options: c.options.map((text, i) => ({ id: LETTERS[i], text })),
    correctAnswer: c.correct.map((i) => LETTERS[i]).join(','),
    marks: c.marks ?? 1,
    scoringStrategy: 'PARTIAL_CREDIT',
  };
}

/** A math-editor answer graded by the equivalence engine, optionally with method marks. */
export function mathItem(c: Common & { math: MathKey; marks: number; method?: MethodKey; display?: string }): ItemInput {
  return {
    ...base(c),
    type: 'numeric_problem',
    answerFormat: 'text',
    correctAnswer: c.display ?? c.math.answers[0],
    math: c.math,
    method: c.method,
    marks: c.marks,
    scoringStrategy: c.method ? 'METHOD_MARK' : c.math.units ? 'UNIT_AWARE' : 'MATHEMATICAL_EQUIVALENCE',
  };
}

export function mathPart(id: string, prompt: string, math: MathKey, marks: number, criterion: string, method?: MethodKey): PartInput {
  return { id, prompt, answerFormat: 'math', math, method, correctAnswer: math.answers[0], marks, criterion };
}

export function choicePart(id: string, prompt: string, options: string[], correct: number, marks: number, criterion: string): PartInput {
  return { id, prompt, answerFormat: 'single_choice', options: options.map((text, i) => ({ id: LETTERS[i], text })), correctAnswer: LETTERS[correct], marks, criterion };
}

/** Multi-part mark-scheme item (IB / Cambridge structured question). */
export function multiPart(c: Common & { parts: PartInput[] }): ItemInput {
  return {
    ...base(c),
    type: 'step_by_step',
    answerFormat: 'text',
    correctAnswer: c.parts.map((p) => `${p.id}: ${p.correctAnswer}`).join('; '),
    parts: c.parts,
    marks: c.parts.reduce((n, p) => n + p.marks + (p.method?.marks ?? 0), 0),
    scoringStrategy: 'MULTI_PART',
  };
}

/** Interpretive written response scored against a rubric by the double assessor. */
export function rubricItem(c: Common & { rubric: Rubric; modelAnswerSummary: string }): ItemInput {
  const marks = c.rubric.criteria.reduce((n, k) => n + k.maxMarks, 0);
  return {
    ...base(c),
    type: 'short_answer',
    answerFormat: 'text',
    correctAnswer: c.modelAnswerSummary,
    rubric: c.rubric,
    marks,
    scoringStrategy: c.rubric.kind === 'BEST_FIT' ? 'BEST_FIT_RUBRIC' : 'ANALYTIC_RUBRIC',
  };
}

/** Portfolio / performance task (multimodal submission, double assessor with vision). */
export function portfolioItem(c: Common & { portfolio: Portfolio }): ItemInput {
  const marks = c.portfolio.rubric.criteria.reduce((n, k) => n + k.maxMarks, 0);
  return {
    ...base(c),
    type: 'short_answer',
    answerFormat: 'text',
    correctAnswer: 'Assessed against the rubric.',
    portfolio: c.portfolio,
    marks,
    scoringStrategy: 'PORTFOLIO_RUBRIC',
  };
}

/** Four-level analytic descriptor set for a practice rubric criterion (0..max). */
export function levels(max: number, d: [string, string, string, string]): Array<{ marks: string; descriptor: string }> {
  const q = (n: number) => Math.round((max * n) / 4);
  return [
    { marks: '0', descriptor: 'The work does not reach the standard described below.' },
    { marks: `1-${q(1)}`, descriptor: d[0] },
    { marks: `${q(1) + 1}-${q(2)}`, descriptor: d[1] },
    { marks: `${q(2) + 1}-${q(3)}`, descriptor: d[2] },
    { marks: `${q(3) + 1}-${max}`, descriptor: d[3] },
  ];
}
