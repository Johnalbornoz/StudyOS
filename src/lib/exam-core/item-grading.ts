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
import { examItemMarks, scoringStrategyOf, type ExamItem, type ExamItemPart, type MathKeyContent, type MethodKey, type RubricContent, type ScoringStrategyKind } from './items';
import type { ScoringCriterionAward } from './scoring/scoring-engine';
import { gradeMath, type MathGrade, type MathKind } from './math/math-engine';
import { assessWithRubric, type AssessorRunner, type DoubleAssessmentOutcome, type RubricAssessment } from './assessment/double-assessor.service';

export interface ExamItemGrade {
  status: 'ANSWERED' | 'INVALID';
  /** 0..1 */
  fraction: number;
  maxMarks: number;
  criteria: ScoringCriterionAward[] | null;
  evaluation: EvaluationResult;
  invalidReason?: string;
  // ---- V2 ----
  /** 0..1 under STRICT_READINESS: only fully correct targets count; rubric work takes the lower assessor. Never an official score. */
  strictFraction: number;
  reviewStatus: 'NONE' | 'REVIEW_REQUIRED';
  scoringStrategy: ScoringStrategyKind;
  /** Persisted as normalized_response: literal / normalized / LaTeX / AST per math target. */
  normalizedResponse: Record<string, unknown> | null;
  /** Persisted as grading_detail: verdicts and reasons, auditable. */
  detail: Record<string, unknown> | null;
  /** Persisted to exam_response_assessments. */
  assessments: RubricAssessment[];
}

export interface GradeExamItemDeps {
  /** Injected in tests; defaults to the gateway-backed assessors. */
  assessorRunner?: AssessorRunner;
  /** Portfolio tasks are answered with a submission; the caller binds it to the attempt and owner. */
  portfolioGrader?: (item: ExamItem, answer: string) => Promise<ExamItemGrade>;
}

const V2_DEFAULTS = { strictFraction: 0, reviewStatus: 'NONE' as const, normalizedResponse: null, detail: null, assessments: [] as RubricAssessment[] };

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

export function invalidExamItemGrade(item: ExamItem, answer: string, reason: string): ExamItemGrade {
  return invalid(item, answer, reason);
}

function invalid(item: ExamItem, answer: string, reason: string): ExamItemGrade {
  return {
    ...V2_DEFAULTS,
    scoringStrategy: scoringStrategyOf(item),
    status: 'INVALID',
    fraction: 0,
    maxMarks: examItemMarks(item),
    criteria: item.exam.parts ? item.exam.parts.map((p) => ({ criterionId: p.criterion, awarded: 0, max: p.marks + (p.method?.marks ?? 0) })) : null,
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

/* ------------------------------------------------------------------ */
/* V2 -- math targets (deterministic first)                             */
/* ------------------------------------------------------------------ */

const MAX_WORKING_LINES = 60;

/**
 * Wire format of a math answer: a plain string (the editor's LaTeX) or a JSON
 * object `{ "latex": "...", "working": "..." }` when working is shown.
 */
export function parseMathAnswer(raw: unknown): { literal: string; working: string } | null {
  if (raw === undefined || raw === null) return { literal: '', working: '' };
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('{')) {
      try {
        return parseMathAnswer(JSON.parse(t));
      } catch {
        return { literal: raw, working: '' };
      }
    }
    return { literal: raw, working: '' };
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const literal = typeof o.latex === 'string' ? o.latex : typeof o.value === 'string' ? o.value : null;
    const working = typeof o.working === 'string' ? o.working : '';
    if (literal === null) return null;
    return { literal, working };
  }
  return null;
}

function kindOfIntermediate(m: string): MathKind {
  if (/[<>≤≥]|\\(le|ge|lt|gt)/.test(m)) return 'INEQUALITY';
  if (m.includes('=')) return 'EQUATION';
  return 'EXPRESSION';
}

/** Method marks: some line of the working is equivalent to one of the intermediates (or the right-hand side of a line is). */
export function methodEvidenced(working: string, method: MethodKey, language: string): boolean {
  if (!working.trim()) return false;
  const lines = working.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean).slice(0, MAX_WORKING_LINES);
  for (const inter of method.intermediates) {
    const kind = kindOfIntermediate(inter);
    for (const line of lines) {
      const candidates = kind === 'EXPRESSION' && line.includes('=') ? [line, ...line.split('=').slice(1)] : [line];
      for (const c of candidates) {
        if (gradeMath(c, { kind, answers: [inter] }, language).mathematicalCorrectness === 'EQUIVALENT') return true;
      }
    }
  }
  return false;
}

export interface MathTargetGrade {
  awarded: number;
  max: number;
  strictAwarded: number;
  review: boolean;
  normalized: Record<string, unknown>;
  detail: Record<string, unknown>;
}

function answerFractionFor(g: MathGrade, key: MathKeyContent): number {
  if (g.judgment === 'CORRECT') return 1;
  if (g.judgment !== 'PARTIALLY_CORRECT') return 0;
  const pc = key.partialCredit;
  const factors: number[] = [];
  if (g.formCompliance === 'NOT_MET') factors.push(pc.formNotMet);
  if (g.unitCorrectness === 'MISSING') factors.push(pc.unitMissing);
  if (g.unitCorrectness === 'WRONG') factors.push(pc.unitWrong);
  if (g.significantFigures === 'NOT_MET') factors.push(pc.significantFigures);
  return factors.length ? Math.min(...factors) : 0;
}

/** Grades one math answer (item or part). Pure and deterministic. */
export function gradeMathTarget(key: MathKeyContent, method: MethodKey | null | undefined, marks: number, raw: unknown, language: string): MathTargetGrade | { problem: string } {
  const parsed = parseMathAnswer(raw);
  if (!parsed) return { problem: 'MATH_ANSWER_MALFORMED' };
  if (parsed.literal.length > 2000 || parsed.working.length > 10000) return { problem: 'MATH_ANSWER_TOO_LONG' };
  const max = marks + (method?.marks ?? 0);
  if (!parsed.literal.trim() && !parsed.working.trim()) {
    return { awarded: 0, max, strictAwarded: 0, review: false, normalized: { literal: '' }, detail: { judgment: 'BLANK' } };
  }
  const g = gradeMath(parsed.literal, key, language);
  const answerFraction = parsed.literal.trim() ? answerFractionFor(g, key) : 0;
  let methodAward = 0;
  let methodSource: 'WORKING' | 'IMPLIED' | null = null;
  if (method) {
    if (methodEvidenced(parsed.working, method, language)) methodSource = 'WORKING';
    else if (method.impliedByCorrectAnswer && g.mathematicalCorrectness === 'EQUIVALENT') methodSource = 'IMPLIED';
    methodAward = methodSource ? method.marks : 0;
  }
  const awarded = marks * answerFraction + methodAward;
  const strictAwarded = g.judgment === 'CORRECT' && (!method || methodAward === method.marks) ? max : 0;
  return {
    awarded,
    max,
    strictAwarded,
    review: g.judgment === 'UNDECIDABLE' && !!parsed.literal.trim(),
    normalized: { literal: parsed.literal, normalized: g.normalized, latex: g.latex, ast: g.ast, working: parsed.working || undefined },
    detail: {
      judgment: g.judgment,
      mathematicalCorrectness: g.mathematicalCorrectness,
      formCompliance: g.formCompliance,
      unitCorrectness: g.unitCorrectness,
      significantFigures: g.significantFigures,
      reasons: g.reasons,
      answerFraction,
      methodMarks: method ? { awarded: methodAward, max: method.marks, source: methodSource } : undefined,
    },
  };
}

function gradePart(part: ExamItemPart, answer: unknown, language: string): { fraction: number; problem: string | null; math?: MathTargetGrade } {
  if (part.answerFormat === 'math' && part.math) {
    const r = gradeMathTarget(part.math, part.method, part.marks, answer, language);
    if ('problem' in r) return { fraction: 0, problem: r.problem };
    return { fraction: r.max > 0 ? r.awarded / r.max : 0, problem: null, math: r };
  }
  if (answer === undefined || answer === null || answer === '') return { fraction: 0, problem: null }; // blank part = 0 marks, not invalid
  if (typeof answer !== 'string') return { fraction: 0, problem: 'PART_ANSWER_NOT_A_STRING' };
  if (part.answerFormat === 'text') {
    return { fraction: matchesAcceptable(answer, part.acceptableAnswers ?? [part.correctAnswer], part.numericTolerance ?? null) ? 1 : 0, problem: null };
  }
  if (part.answerFormat === 'math') return { fraction: 0, problem: 'PART_HAS_NO_MATH_KEY' };
  const shapeProblem = structuredAnswerProblem({ answerFormat: part.answerFormat, options: part.options }, answer);
  if (shapeProblem) return { fraction: 0, problem: shapeProblem };
  const graded = gradeStructuredAnswer({ answerFormat: part.answerFormat, correctAnswer: part.correctAnswer, options: part.options } as never, answer);
  return { fraction: graded.score, problem: null };
}

/** ExamItemGrade from a double-assessment outcome (rubric item or portfolio submission). */
export function gradeFromRubricOutcome(item: ExamItem, answer: string, outcome: DoubleAssessmentOutcome, rubric: RubricContent, extra: Record<string, unknown> | null): ExamItemGrade {
  const max = outcome.maxTotal;
  return {
    status: 'ANSWERED',
    fraction: max > 0 ? outcome.total / max : 0,
    maxMarks: max,
    criteria: outcome.criterionScores.map((c) => ({ criterionId: c.id, awarded: c.marks, max: rubric.criteria.find((d) => d.id === c.id)!.maxMarks })),
    strictFraction: max > 0 ? outcome.strictTotal / max : 0,
    reviewStatus: outcome.reviewRequired ? 'REVIEW_REQUIRED' : 'NONE',
    scoringStrategy: scoringStrategyOf(item),
    normalizedResponse: null,
    detail: { adjudicated: outcome.adjudicated, reviewReasons: outcome.reviewReasons, ...(extra ?? {}) },
    assessments: outcome.assessments,
    evaluation: {
      rawResponse: answer,
      score: outcome.total,
      maxScore: max,
      criteriaBreakdown: { rubric: outcome.criterionScores, adjudicated: outcome.adjudicated, reviewReasons: outcome.reviewReasons },
      feedback: null,
      evaluationModelVersion: outcome.assessments.map((a) => a.model).filter(Boolean).join(',') || null,
      provenance: { grader: 'exam-core:double-assessor', assessments: outcome.assessments.map((a) => ({ role: a.role, executionId: a.executionId, promptId: a.promptId, promptVersion: a.promptVersion })) },
    },
  };
}

/**
 * Grades `answer` against the server-held `item`. DETERMINISTIC FIRST:
 * structured formats, keyed text, math (equivalence engine), method marks and
 * multi-part mark schemes never reach AI. Rubric items go to the double
 * assessor; only an unkeyed free-text item (AI-generated content) uses the
 * single AI grader. Every grade carries its strategy, strict score and
 * review status.
 */
export async function gradeExamItem(item: ExamItem, answer: string, language: string, deps: GradeExamItemDeps = {}): Promise<ExamItemGrade> {
  if (typeof answer !== 'string' || answer.length === 0) return invalid(item, String(answer ?? ''), 'EMPTY_ANSWER');
  if (answer.length > MAX_ANSWER_LENGTH) return invalid(item, answer, 'ANSWER_TOO_LONG');
  const scoringStrategy = scoringStrategyOf(item);

  if (item.exam.portfolio) return deps.portfolioGrader ? deps.portfolioGrader(item, answer) : invalid(item, answer, 'PORTFOLIO_ITEM_USES_SUBMISSIONS');

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
    const breakdown: Record<string, { awarded: number; max: number; criterion: string; strict: number }> = {};
    const normalized: Record<string, unknown> = {};
    const detail: Record<string, unknown> = {};
    let earned = 0;
    let total = 0;
    let strict = 0;
    let review = false;
    for (const part of item.exam.parts) {
      const { fraction, problem, math } = gradePart(part, (parsed as Record<string, unknown>)[part.id], language);
      if (problem) return invalid(item, answer, `PART_${part.id}_${problem}`);
      const max = part.marks + (part.method?.marks ?? 0);
      const awarded = math ? math.awarded : fraction * max;
      const strictAwarded = math ? math.strictAwarded : fraction >= 1 ? max : 0;
      if (math) {
        normalized[part.id] = math.normalized;
        detail[part.id] = math.detail;
        review = review || math.review;
      }
      earned += awarded;
      total += max;
      strict += strictAwarded;
      breakdown[part.id] = { awarded, max, criterion: part.criterion, strict: strictAwarded };
      const existing = criteria.find((c) => c.criterionId === part.criterion);
      if (existing) {
        existing.awarded += awarded;
        existing.max += max;
      } else {
        criteria.push({ criterionId: part.criterion, awarded, max });
      }
    }
    const fraction = total > 0 ? earned / total : 0;
    return {
      status: 'ANSWERED',
      fraction,
      maxMarks: total,
      criteria,
      strictFraction: total > 0 ? strict / total : 0,
      reviewStatus: review ? 'REVIEW_REQUIRED' : 'NONE',
      scoringStrategy,
      normalizedResponse: Object.keys(normalized).length ? normalized : null,
      detail: Object.keys(detail).length ? { parts: detail } : null,
      assessments: [],
      evaluation: { rawResponse: answer, score: earned, maxScore: total, criteriaBreakdown: { parts: breakdown }, feedback: null, evaluationModelVersion: null, provenance: { grader: 'exam-core:mark-scheme' } },
    };
  }

  const marks = examItemMarks(item);

  if (item.answerFormat !== 'text') {
    const problem = structuredAnswerProblem(item, answer);
    if (problem) return invalid(item, answer, problem);
    const graded = gradeStructuredAnswer(item, answer);
    return {
      ...V2_DEFAULTS,
      status: 'ANSWERED',
      fraction: graded.score,
      maxMarks: marks,
      criteria: null,
      strictFraction: graded.score >= 1 ? 1 : 0,
      scoringStrategy,
      evaluation: { rawResponse: answer, score: graded.score * marks, maxScore: marks, criteriaBreakdown: null, feedback: graded.feedback || null, evaluationModelVersion: null, provenance: { grader: 'gradeStructuredAnswer' } },
    };
  }

  if (item.exam.math) {
    const r = gradeMathTarget(item.exam.math, item.exam.method, item.exam.marks, answer, language);
    if ('problem' in r) return invalid(item, answer, r.problem);
    const fraction = r.max > 0 ? r.awarded / r.max : 0;
    return {
      status: 'ANSWERED',
      fraction,
      maxMarks: r.max,
      criteria: item.exam.method ? [{ criterionId: 'A', awarded: r.awarded - ((r.detail.methodMarks as { awarded: number } | undefined)?.awarded ?? 0), max: item.exam.marks }, { criterionId: item.exam.method.criterion, awarded: (r.detail.methodMarks as { awarded: number }).awarded, max: item.exam.method.marks }] : null,
      strictFraction: r.max > 0 ? r.strictAwarded / r.max : 0,
      reviewStatus: r.review ? 'REVIEW_REQUIRED' : 'NONE',
      scoringStrategy,
      normalizedResponse: r.normalized,
      detail: r.detail,
      assessments: [],
      evaluation: { rawResponse: answer, score: r.awarded, maxScore: r.max, criteriaBreakdown: { math: r.detail }, feedback: null, evaluationModelVersion: null, provenance: { grader: 'exam-core:math-equivalence' } },
    };
  }

  if (item.exam.acceptableAnswers && item.exam.acceptableAnswers.length > 0) {
    const ok = matchesAcceptable(answer, item.exam.acceptableAnswers, item.exam.numericTolerance);
    return {
      ...V2_DEFAULTS,
      status: 'ANSWERED',
      fraction: ok ? 1 : 0,
      maxMarks: marks,
      criteria: null,
      strictFraction: ok ? 1 : 0,
      scoringStrategy,
      evaluation: { rawResponse: answer, score: ok ? marks : 0, maxScore: marks, criteriaBreakdown: null, feedback: null, evaluationModelVersion: null, provenance: { grader: 'exam-core:accepted-answers' } },
    };
  }

  if (item.exam.rubric) {
    const outcome = await assessWithRubric({ rubric: item.exam.rubric, task: item.question, response: answer, language, context: { sourceComponent: 'item-grading.ts:gradeExamItem' } }, deps.assessorRunner);
    return gradeFromRubricOutcome(item, answer, outcome, item.exam.rubric, null);
  }

  const result = await gradeAnswer(item, answer, language);
  const fraction = Math.min(1, Math.max(0, result.score));
  return {
    ...V2_DEFAULTS,
    status: 'ANSWERED',
    fraction,
    maxMarks: marks,
    criteria: null,
    strictFraction: fraction >= 1 ? 1 : 0,
    reviewStatus: result.confidence < 0.5 ? 'REVIEW_REQUIRED' : 'NONE',
    scoringStrategy,
    evaluation: {
      rawResponse: answer,
      score: fraction * marks,
      maxScore: marks,
      criteriaBreakdown: { errorType: result.errorType, reasoningValid: result.reasoningValid, confidence: result.confidence },
      feedback: result.feedback,
      evaluationModelVersion: result.aiExecution?.aiModel ?? null,
      provenance: result.aiExecution ? { grader: 'gradeAnswer', ...result.aiExecution } : { grader: 'gradeAnswer' },
    },
  };
}
