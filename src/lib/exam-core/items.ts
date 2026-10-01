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

export type ExamItemSource = 'APPROVED_BANK' | 'AI_GENERATED';

const OptionSchema = z.object({ id: z.string().min(1).max(40), text: z.string().min(1).max(2000) });

export const ExamItemPartSchema = z.object({
  id: z.string().min(1).max(40),
  prompt: z.string().min(1).max(4000),
  answerFormat: z.enum(['single_choice', 'multi_choice', 'text']),
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
      if (part.answerFormat === 'text') {
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
        break;
    }
  }
  if (!(item.exam.marks > 0)) reasons.push('NON_POSITIVE_MARKS');
  return { valid: reasons.length === 0, reasons };
}

/** Marks an item is worth: the sum of its parts when it has parts, else its own marks. */
export function examItemMarks(item: ExamItem): number {
  if (item.exam.parts) return item.exam.parts.reduce((sum, p) => sum + p.marks, 0);
  return item.exam.marks;
}

export interface ExamClientPart {
  id: string;
  prompt: string;
  answerFormat: ExamItemPart['answerFormat'];
  options?: { id: string; text: string }[];
  marks: number;
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
    marks: p.marks,
  }));
  return {
    ...base,
    conceptId: undefined,
    marks: examItemMarks(item),
    stimulus: item.exam.stimulus ? { key: item.exam.stimulus.key, title: item.exam.stimulus.title, text: item.exam.stimulus.text } : undefined,
    parts,
    commandTerm: item.exam.commandTerm ?? undefined,
  };
}

export type ExamClientItem = ReturnType<typeof toExamClientItem>;

/** Keys that must never appear anywhere in a client payload (deep). Used by tests and a runtime guard. */
// (`classificationItems` is deliberately absent: the client shape carries only the item labels, never their categories.)
export const ANSWER_BEARING_KEYS = ['correctAnswer', 'acceptableAnswers', 'numericTolerance', 'explanation', 'matchingPairs', 'orderingItems', 'criterion', 'approvedItemId'] as const;

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
