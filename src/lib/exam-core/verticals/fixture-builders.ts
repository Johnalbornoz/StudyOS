/**
 * Track B -- tiny builders for DEV certification fixture items. Every item
 * they produce is labelled `contentStatus: 'DEV_CERT_FIXTURE'`: original,
 * deterministic content written to exercise the engine -- never an official
 * question, never an official specification.
 */
import type { z } from 'zod';
import type { ApprovedItemContentSchema, ExamItemPartSchema } from '../items';

type ItemInput = z.input<typeof ApprovedItemContentSchema>;
type PartInput = z.input<typeof ExamItemPartSchema>;
type Stimulus = { key: string; title?: string; text: string };

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function choice(params: {
  key: string;
  language: string;
  question: string;
  options: string[];
  correct: number;
  explanation: string;
  difficulty?: number;
  marks?: number;
  stimulus?: Stimulus;
  commandTerm?: string;
}): ItemInput {
  return {
    key: params.key,
    contentStatus: 'DEV_CERT_FIXTURE',
    language: params.language,
    type: 'multiple_choice',
    answerFormat: 'single_choice',
    question: params.question,
    options: params.options.map((text, i) => ({ id: LETTERS[i], text })),
    correctAnswer: LETTERS[params.correct],
    explanation: params.explanation,
    difficulty: params.difficulty ?? 3,
    marks: params.marks ?? 1,
    stimulus: params.stimulus,
    commandTerm: params.commandTerm,
  };
}

export function multiSelect(params: { key: string; language: string; question: string; options: string[]; correct: number[]; explanation: string; difficulty?: number; marks?: number; stimulus?: Stimulus }): ItemInput {
  return {
    key: params.key,
    contentStatus: 'DEV_CERT_FIXTURE',
    language: params.language,
    type: 'multi_select',
    answerFormat: 'multi_choice',
    question: params.question,
    options: params.options.map((text, i) => ({ id: LETTERS[i], text })),
    correctAnswer: params.correct.map((i) => LETTERS[i]).join(','),
    explanation: params.explanation,
    difficulty: params.difficulty ?? 3,
    marks: params.marks ?? 1,
    stimulus: params.stimulus,
  };
}

export function numeric(params: { key: string; language: string; question: string; answers: string[]; tolerance?: number; explanation: string; difficulty?: number; marks?: number; stimulus?: Stimulus; commandTerm?: string }): ItemInput {
  return {
    key: params.key,
    contentStatus: 'DEV_CERT_FIXTURE',
    language: params.language,
    type: 'numeric_problem',
    answerFormat: 'text',
    question: params.question,
    correctAnswer: params.answers[0],
    acceptableAnswers: params.answers,
    numericTolerance: params.tolerance,
    explanation: params.explanation,
    difficulty: params.difficulty ?? 3,
    marks: params.marks ?? 1,
    stimulus: params.stimulus,
    commandTerm: params.commandTerm,
  };
}

export function shortText(params: { key: string; language: string; question: string; answers: string[]; explanation: string; difficulty?: number; marks?: number; commandTerm?: string }): ItemInput {
  return {
    key: params.key,
    contentStatus: 'DEV_CERT_FIXTURE',
    language: params.language,
    type: 'short_answer',
    answerFormat: 'text',
    question: params.question,
    correctAnswer: params.answers[0],
    acceptableAnswers: params.answers,
    explanation: params.explanation,
    difficulty: params.difficulty ?? 3,
    marks: params.marks ?? 1,
    commandTerm: params.commandTerm,
  };
}

export function partChoice(id: string, prompt: string, options: string[], correct: number, marks: number, criterion: string): PartInput {
  return { id, prompt, answerFormat: 'single_choice', options: options.map((text, i) => ({ id: LETTERS[i], text })), correctAnswer: LETTERS[correct], marks, criterion };
}

export function partText(id: string, prompt: string, answers: string[], marks: number, criterion: string, tolerance?: number): PartInput {
  return { id, prompt, answerFormat: 'text', correctAnswer: answers[0], acceptableAnswers: answers, numericTolerance: tolerance, marks, criterion };
}

/** A structured, multi-part mark-scheme item (IB / Cambridge style). Marks = sum of its parts. */
export function structured(params: { key: string; language: string; question: string; parts: PartInput[]; explanation: string; difficulty?: number; commandTerm?: string; calculatorAllowed?: boolean }): ItemInput {
  return {
    key: params.key,
    contentStatus: 'DEV_CERT_FIXTURE',
    language: params.language,
    type: 'step_by_step',
    answerFormat: 'text',
    question: params.question,
    correctAnswer: params.parts.map((p) => `${p.id}: ${p.correctAnswer}`).join('; '),
    explanation: params.explanation,
    difficulty: params.difficulty ?? 3,
    marks: params.parts.reduce((n, p) => n + p.marks, 0),
    commandTerm: params.commandTerm,
    calculatorAllowed: params.calculatorAllowed,
    parts: params.parts,
  };
}

export const FIXTURE_PROVENANCE = { official: false, source: 'DEV certification fixture -- not an official scoring rule' } as const;
