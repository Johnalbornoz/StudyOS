/**
 * Track B / B1 -- grading one exam item against the SERVER-HELD item.
 *
 * Reuses the existing graders: `gradeStructuredAnswer` (deterministic,
 * structured formats) and `gradeAnswer` (AI, free text). Adds only what the
 * exam core needs and those graders cannot do:
 *   - answer-shape validation (an answer that the rendered controls could
 *     never have produced is INVALID, never graded as a guess);
 *   - deterministic accepted-answer / numeric-tolerance grading for text
 *     items that carry a key (bank items), so they never need AI;
 *   - multi-part mark-scheme items: each part graded deterministically and
 *     its marks attributed to a rubric criterion.
 */
import { gradeAnswer, gradeStructuredAnswer } from '@/services/quiz-generation.service';
import type { EvaluationResult } from '@/lib/assessment/types';
import { examItemMarks, type ExamItem, type ExamItemPart } from './items';
import type { ScoringCriterionAward } from './scoring/scoring-engine';

export interface ExamItemGrade {
  status: 'ANSWERED' | 'INVALID';
  /** 0..1 */
  fraction: number;
  maxMarks: number;
  criteria: ScoringCriterionAward[] | null;
  evaluation: EvaluationResult;
  invalidReason?: string;
}

const MAX_ANSWER_LENGTH = 20000;

export function normalizeTextAnswer(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:!?]+$/g, '')
    .trim();
}

function parseNumber(value: string): number | null {
  const cleaned = value.trim().replace(/\s/g, '').replace(/,(?=\d{1,}$)/, '.');
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Deterministic text check: numeric within tolerance, else normalized equality with any accepted answer. */
export function matchesAcceptable(answer: string, acceptable: string[], numericTolerance: number | null): boolean {
  if (numericTolerance !== null) {
    const got = parseNumber(answer);
    if (got !== null) {
      for (const a of acceptable) {
        const want = parseNumber(a);
        if (want !== null && Math.abs(got - want) <= numericTolerance + 1e-12) return true;
      }
    }
  }
  const norm = normalizeTextAnswer(answer);
  return acceptable.some((a) => normalizeTextAnswer(a) === norm);
}

/** Answer-shape validation for a structured format. Returns a reason when the answer is not producible by the controls. */
export function structuredAnswerProblem(item: Pick<ExamItem, 'answerFormat' | 'options' | 'matchingPairs' | 'orderingItems' | 'classificationItems' | 'classificationCategories'>, answer: string): string | null {
  const ids = new Set((item.options ?? []).map((o) => o.id));
  switch (item.answerFormat) {
    case 'single_choice':
      return ids.has(answer) ? null : 'UNKNOWN_OPTION';
    case 'multi_choice': {
      const picked = answer.split(',').map((s) => s.trim()).filter(Boolean);
      if (picked.length === 0) return 'EMPTY_SELECTION';
      if (picked.some((p) => !ids.has(p))) return 'UNKNOWN_OPTION';
      if (new Set(picked).size !== picked.length) return 'DUPLICATE_OPTION';
      return null;
    }
    case 'matching':
    case 'classification': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(answer);
      } catch {
        return 'NOT_JSON';
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'NOT_AN_OBJECT';
      const allowedKeys = new Set(item.answerFormat === 'matching' ? (item.matchingPairs ?? []).map((p) => p.left) : (item.classificationItems ?? []).map((c) => c.item));
      const allowedValues = new Set(item.answerFormat === 'matching' ? (item.matchingPairs ?? []).map((p) => p.right) : item.classificationCategories ?? []);
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!allowedKeys.has(k)) return 'UNKNOWN_KEY';
        if (typeof v !== 'string' || !allowedValues.has(v)) return 'UNKNOWN_VALUE';
      }
      return null;
    }
    case 'ordering': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(answer);
      } catch {
        return 'NOT_JSON';
      }
      if (!Array.isArray(parsed)) return 'NOT_AN_ARRAY';
      const expected = [...(item.orderingItems ?? [])].sort();
      const got = [...(parsed as unknown[])].map(String).sort();
      return JSON.stringify(expected) === JSON.stringify(got) ? null : 'NOT_A_PERMUTATION';
    }
    default:
      return null;
  }
}

function invalid(item: ExamItem, answer: string, reason: string): ExamItemGrade {
  return {
    status: 'INVALID',
    fraction: 0,
    maxMarks: examItemMarks(item),
    criteria: item.exam.parts ? item.exam.parts.map((p) => ({ criterionId: p.criterion, awarded: 0, max: p.marks })) : null,
    invalidReason: reason,
    evaluation: {
      rawResponse: answer.slice(0, MAX_ANSWER_LENGTH),
      score: 0,
      maxScore: examItemMarks(item),
      criteriaBreakdown: { invalidResponse: reason },
      feedback: null,
      evaluationModelVersion: null,
      provenance: { grader: 'exam-core:validation' },
    },
  };
}

function gradePart(part: ExamItemPart, answer: unknown): { fraction: number; problem: string | null } {
  if (answer === undefined || answer === null || answer === '') return { fraction: 0, problem: null }; // blank part = 0 marks, not invalid
  if (typeof answer !== 'string') return { fraction: 0, problem: 'PART_ANSWER_NOT_A_STRING' };
  if (part.answerFormat === 'text') {
    return { fraction: matchesAcceptable(answer, part.acceptableAnswers ?? [part.correctAnswer], part.numericTolerance ?? null) ? 1 : 0, problem: null };
  }
  const shapeProblem = structuredAnswerProblem({ answerFormat: part.answerFormat, options: part.options }, answer);
  if (shapeProblem) return { fraction: 0, problem: shapeProblem };
  const graded = gradeStructuredAnswer({ answerFormat: part.answerFormat, correctAnswer: part.correctAnswer, options: part.options } as never, answer);
  return { fraction: graded.score, problem: null };
}

/**
 * Grades `answer` against the server-held `item`. Deterministic for every
 * structured format, every keyed text item and every multi-part item; the AI
 * grader is used only for an unkeyed free-text item (AI-generated content).
 */
export async function gradeExamItem(item: ExamItem, answer: string, language: string): Promise<ExamItemGrade> {
  if (typeof answer !== 'string' || answer.length === 0) return invalid(item, String(answer ?? ''), 'EMPTY_ANSWER');
  if (answer.length > MAX_ANSWER_LENGTH) return invalid(item, answer, 'ANSWER_TOO_LONG');

  if (item.exam.parts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(answer);
    } catch {
      return invalid(item, answer, 'PARTS_ANSWER_NOT_JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalid(item, answer, 'PARTS_ANSWER_NOT_AN_OBJECT');
    const partIds = new Set(item.exam.parts.map((p) => p.id));
    if (Object.keys(parsed as Record<string, unknown>).some((k) => !partIds.has(k))) return invalid(item, answer, 'UNKNOWN_PART');

    const criteria: ScoringCriterionAward[] = [];
    const breakdown: Record<string, { awarded: number; max: number; criterion: string }> = {};
    let earned = 0;
    let total = 0;
    for (const part of item.exam.parts) {
      const { fraction, problem } = gradePart(part, (parsed as Record<string, unknown>)[part.id]);
      if (problem) return invalid(item, answer, `PART_${part.id}_${problem}`);
      const awarded = fraction * part.marks;
      earned += awarded;
      total += part.marks;
      breakdown[part.id] = { awarded, max: part.marks, criterion: part.criterion };
      const existing = criteria.find((c) => c.criterionId === part.criterion);
      if (existing) {
        existing.awarded += awarded;
        existing.max += part.marks;
      } else {
        criteria.push({ criterionId: part.criterion, awarded, max: part.marks });
      }
    }
    const fraction = total > 0 ? earned / total : 0;
    return {
      status: 'ANSWERED',
      fraction,
      maxMarks: total,
      criteria,
      evaluation: { rawResponse: answer, score: earned, maxScore: total, criteriaBreakdown: { parts: breakdown }, feedback: null, evaluationModelVersion: null, provenance: { grader: 'exam-core:mark-scheme' } },
    };
  }

  const marks = examItemMarks(item);

  if (item.answerFormat !== 'text') {
    const problem = structuredAnswerProblem(item, answer);
    if (problem) return invalid(item, answer, problem);
    const graded = gradeStructuredAnswer(item, answer);
    return {
      status: 'ANSWERED',
      fraction: graded.score,
      maxMarks: marks,
      criteria: null,
      evaluation: { rawResponse: answer, score: graded.score * marks, maxScore: marks, criteriaBreakdown: null, feedback: graded.feedback || null, evaluationModelVersion: null, provenance: { grader: 'gradeStructuredAnswer' } },
    };
  }

  if (item.exam.acceptableAnswers && item.exam.acceptableAnswers.length > 0) {
    const ok = matchesAcceptable(answer, item.exam.acceptableAnswers, item.exam.numericTolerance);
    return {
      status: 'ANSWERED',
      fraction: ok ? 1 : 0,
      maxMarks: marks,
      criteria: null,
      evaluation: { rawResponse: answer, score: ok ? marks : 0, maxScore: marks, criteriaBreakdown: null, feedback: null, evaluationModelVersion: null, provenance: { grader: 'exam-core:accepted-answers' } },
    };
  }

  const result = await gradeAnswer(item, answer, language);
  return {
    status: 'ANSWERED',
    fraction: Math.min(1, Math.max(0, result.score)),
    maxMarks: marks,
    criteria: null,
    evaluation: {
      rawResponse: answer,
      score: Math.min(1, Math.max(0, result.score)) * marks,
      maxScore: marks,
      criteriaBreakdown: { errorType: result.errorType, reasoningValid: result.reasoningValid, confidence: result.confidence },
      feedback: result.feedback,
      evaluationModelVersion: result.aiExecution?.aiModel ?? null,
      provenance: result.aiExecution ? { grader: 'gradeAnswer', ...result.aiExecution } : { grader: 'gradeAnswer' },
    },
  };
}
