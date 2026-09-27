/**
 * Pedagogical grading model -- grade like a teacher.
 *
 * Three independent axes, then ONE deterministic decision:
 *   1. mathematical correctness  (is the mathematics right?)
 *   2. task completion           (did the learner do everything asked?)
 *   3. reasoning quality         (is the reasoning shown sound?)
 *
 *   CORRECT   = mathematics right + every requested component present
 *   ALMOST    = mathematics right (or a minor slip in sound reasoning) but
 *               a requested component / precision is missing
 *   INCORRECT = a real mathematical or conceptual error
 *
 * Notation never decides correctness: when the final value / setup can be
 * checked mathematically (math-equivalence.ts) that check is authoritative
 * over the AI's reading. What each outcome means for the learner model is
 * explicit (`learnerSignal`): an omission is TASK_INCOMPLETE, never a
 * misconception; only a real conceptual error is a MISCONCEPTION.
 *
 * Pure. No I/O.
 */
import {
  decimalConventionFor,
  equationsEquivalent,
  extractEquations,
  finalValuesEquivalent,
  type EquivalenceStatus,
} from './math-equivalence';
import { deriveTaskRequirements, type TaskRequirement, type TaskRequirementId } from './task-requirements';

export type MathematicalCorrectness = 'CORRECT' | 'MINOR_SLIP' | 'INCORRECT' | 'NOT_APPLICABLE';
export type TaskCompletion = 'COMPLETE' | 'PARTIAL' | 'MISSING';
export type ReasoningQuality = 'STRONG' | 'ADEQUATE' | 'WEAK' | 'INVALID' | 'ABSENT';
export type FinalJudgment = 'CORRECT' | 'ALMOST' | 'INCORRECT';
/** What this answer tells the learner model -- never conflated. */
export type LearnerSignal = 'NONE' | 'TASK_INCOMPLETE' | 'MINOR_SLIP' | 'MATH_ERROR' | 'MISCONCEPTION';
export type LegacyErrorType = 'CONCEPTUAL' | 'PROCEDURAL' | 'CARELESS' | 'INCOMPLETE' | 'MISREADING' | 'ARITHMETIC' | 'UNIT';

export interface PedagogicalGrade {
  model: 'PEDAGOGICAL_V1';
  mathematicalCorrectness: MathematicalCorrectness;
  taskCompletion: TaskCompletion;
  reasoningQuality: ReasoningQuality;
  finalJudgment: FinalJudgment;
  requirements: Array<{ id: TaskRequirementId; met: boolean; source: 'MATH_CHECK' | 'GRADER' }>;
  missingRequirements: TaskRequirementId[];
  /** Only for a real conceptual error; never for notation or an omission. */
  misconception: string | null;
  learnerSignal: LearnerSignal;
  /** Legacy classification kept for existing consumers (errors table, review copy). */
  errorType: LegacyErrorType | null;
  /** 0..1 partial credit: requested components met; a real error never earns a majority. */
  score: number;
  /** Deterministic math evidence behind the verdict (auditable). */
  mathCheck: { result: EquivalenceStatus; setup: EquivalenceStatus };
  feedback: { didWell: string | null; missing: string[]; toFix: string | null };
}

/** What the AI grader reported (all optional: the model degrades to deterministic checks + legacy fields). */
export interface GraderAssessment {
  mathematicalCorrectness?: MathematicalCorrectness;
  requirements?: Array<{ id: string; met: boolean }>;
  reasoningQuality?: ReasoningQuality;
  conceptualError?: boolean;
  misconception?: string | null;
  errorType?: string | null;
  didWell?: string | null;
  toFix?: string | null;
  /** Legacy fields (pre-V1 grader output), used only when the structured ones are absent. */
  legacyCorrect?: boolean;
  legacyScore?: number;
  legacyReasoningValid?: boolean;
}

export interface GradingQuestion {
  type: string;
  question: string;
  correctAnswer: string;
}

export interface DeterministicEvidence {
  requirements: TaskRequirement[];
  result: EquivalenceStatus;
  setup: EquivalenceStatus;
}

const RESULT_IDS: TaskRequirementId[] = ['final_result', 'corrected_result'];

/** No prose: only numbers, operators, a variable, `=` and at most a unit or a counted noun. */
export function isPurelyMathematical(answer: string): boolean {
  const words = (answer.replace(/\\[a-zA-Z]+/g, ' ').match(/[a-záéíóúñü]{2,}/gi) ?? []).filter((w) => !/^(sqrt|frac|times|cdot|div|text)$/i.test(w));
  return words.length <= 1;
}

/** Everything that can be decided mathematically, before any AI. */
export function deterministicEvidence(question: GradingQuestion, studentAnswer: string, language: string): DeterministicEvidence {
  const requirements = deriveTaskRequirements(question as never);
  const convention = decimalConventionFor(language);
  const hasResult = requirements.some((r) => RESULT_IDS.includes(r.id));
  let result: EquivalenceStatus = hasResult ? finalValuesEquivalent(studentAnswer, question.correctAnswer, convention).status : 'UNDECIDABLE';
  // Asymmetric authority: EQUIVALENT is conclusive (notation never costs a
  // point). DIFFERENT is conclusive only for a purely mathematical answer --
  // picking "the final value" out of prose is heuristic ("64 € y no 25 €"),
  // so there the pedagogical grader decides, never a false negative.
  if (result === 'DIFFERENT' && !isPurelyMathematical(studentAnswer)) result = 'UNDECIDABLE';

  let setup: EquivalenceStatus = 'UNDECIDABLE';
  if (requirements.some((r) => r.id === 'correct_setup' || r.id === 'show_setup')) {
    const isTrivial = (eq: string) => /^\s*[a-zA-Z]\s*=\s*[0-9.]+\s*$/.test(eq);
    const expectedEqs = extractEquations(question.correctAnswer, convention).filter((e) => !isTrivial(e));
    const studentEqs = extractEquations(studentAnswer, convention).filter((e) => !isTrivial(e));
    if (expectedEqs.length && studentEqs.length) {
      setup = studentEqs.some((s) => expectedEqs.some((e) => equationsEquivalent(s, e, 'point') === 'EQUIVALENT')) ? 'EQUIVALENT' : 'DIFFERENT';
    }
  }
  return { requirements, result, setup };
}

const LEGACY_ERROR_TYPES = new Set<LegacyErrorType>(['CONCEPTUAL', 'PROCEDURAL', 'CARELESS', 'INCOMPLETE', 'MISREADING', 'ARITHMETIC', 'UNIT']);
const SLIP_TYPES = new Set<LegacyErrorType>(['CARELESS', 'ARITHMETIC', 'UNIT']);

export function composePedagogicalGrade(det: DeterministicEvidence, ai: GraderAssessment): PedagogicalGrade {
  const aiReq = new Map((ai.requirements ?? []).map((r) => [r.id, !!r.met]));
  const legacyOnly = ai.mathematicalCorrectness === undefined && ai.requirements === undefined;

  // 1. mathematical correctness -- the math check is authoritative when it can decide
  // (the final value first; else a requested setup/proportion; else the grader)
  let math: MathematicalCorrectness;
  const hasResult = det.requirements.some((r) => RESULT_IDS.includes(r.id));
  const hasSetup = det.requirements.some((r) => r.kind === 'SETUP');
  const slipOr = (fallback: MathematicalCorrectness): MathematicalCorrectness => (ai.mathematicalCorrectness === 'MINOR_SLIP' ? 'MINOR_SLIP' : fallback);
  if (det.result === 'EQUIVALENT') math = 'CORRECT';
  else if (det.result === 'DIFFERENT') math = slipOr('INCORRECT');
  else if (!hasResult && det.setup === 'EQUIVALENT') math = 'CORRECT';
  else if (!hasResult && det.setup === 'DIFFERENT') math = slipOr('INCORRECT');
  else if (ai.mathematicalCorrectness) math = ai.mathematicalCorrectness;
  else if (legacyOnly) math = ai.legacyCorrect ? 'CORRECT' : 'INCORRECT';
  else math = hasResult || hasSetup ? 'INCORRECT' : 'NOT_APPLICABLE';

  // 2. requirements, one by one
  const requirements = det.requirements.map((r) => {
    if (RESULT_IDS.includes(r.id) && det.result !== 'UNDECIDABLE') return { id: r.id, met: det.result === 'EQUIVALENT', source: 'MATH_CHECK' as const };
    if (r.kind === 'SETUP' && det.setup !== 'UNDECIDABLE') return { id: r.id, met: det.setup === 'EQUIVALENT', source: 'MATH_CHECK' as const };
    if (RESULT_IDS.includes(r.id) && aiReq.get(r.id) === undefined) return { id: r.id, met: math === 'CORRECT', source: 'GRADER' as const };
    const met = aiReq.has(r.id) ? aiReq.get(r.id)! : legacyOnly ? !!ai.legacyCorrect : false;
    return { id: r.id, met, source: 'GRADER' as const };
  });
  const missing = requirements.filter((r) => !r.met).map((r) => r.id);
  const metCount = requirements.length - missing.length;
  const taskCompletion: TaskCompletion = missing.length === 0 ? 'COMPLETE' : metCount === 0 ? 'MISSING' : 'PARTIAL';

  // 3. reasoning
  const reasoning: ReasoningQuality = ai.reasoningQuality ?? (legacyOnly ? (ai.legacyReasoningValid === false ? 'INVALID' : 'ADEQUATE') : 'ADEQUATE');
  const conceptual = ai.conceptualError === true || reasoning === 'INVALID';
  const choiceWrong = requirements.some((r) => r.id === 'choose_claim' && !r.met);

  // 4. the decision
  let finalJudgment: FinalJudgment;
  if (math === 'INCORRECT' || conceptual || choiceWrong) finalJudgment = 'INCORRECT';
  else if (math === 'MINOR_SLIP') finalJudgment = 'ALMOST';
  else if (missing.length === 0) finalJudgment = 'CORRECT';
  else finalJudgment = metCount > 0 ? 'ALMOST' : 'INCORRECT';

  // 5. what it means for the learner model
  const aiType = ai.errorType && LEGACY_ERROR_TYPES.has(ai.errorType as LegacyErrorType) ? (ai.errorType as LegacyErrorType) : null;
  let learnerSignal: LearnerSignal;
  let errorType: LegacyErrorType | null;
  if (finalJudgment === 'CORRECT') {
    learnerSignal = 'NONE';
    errorType = null;
  } else if (finalJudgment === 'ALMOST') {
    if (math === 'MINOR_SLIP') {
      learnerSignal = 'MINOR_SLIP';
      errorType = aiType && SLIP_TYPES.has(aiType) ? aiType : 'ARITHMETIC';
    } else {
      learnerSignal = 'TASK_INCOMPLETE';
      errorType = 'INCOMPLETE';
    }
  } else if (conceptual || choiceWrong || aiType === 'CONCEPTUAL') {
    learnerSignal = 'MISCONCEPTION';
    errorType = 'CONCEPTUAL';
  } else {
    learnerSignal = 'MATH_ERROR';
    errorType = aiType && aiType !== 'INCOMPLETE' ? aiType : 'PROCEDURAL';
  }

  // 6. partial credit
  const credit = (r: { id: TaskRequirementId; met: boolean }) => (r.met ? 1 : RESULT_IDS.includes(r.id) && math === 'MINOR_SLIP' ? 0.5 : 0);
  const ratio = requirements.length ? requirements.reduce((n, r) => n + credit(r), 0) / requirements.length : finalJudgment === 'CORRECT' ? 1 : 0;
  const score = finalJudgment === 'CORRECT' ? 1 : finalJudgment === 'INCORRECT' ? Math.min(0.5, ratio) : Math.min(0.9, Math.max(0.25, ratio));

  return {
    model: 'PEDAGOGICAL_V1',
    mathematicalCorrectness: math,
    taskCompletion,
    reasoningQuality: reasoning,
    finalJudgment,
    requirements,
    missingRequirements: finalJudgment === 'CORRECT' ? [] : missing,
    misconception: learnerSignal === 'MISCONCEPTION' ? ai.misconception ?? null : null,
    learnerSignal,
    errorType,
    score: Math.round(score * 1000) / 1000,
    mathCheck: { result: det.result, setup: det.setup },
    feedback: { didWell: ai.didWell?.trim() || null, missing: [], toFix: finalJudgment === 'CORRECT' ? null : ai.toFix?.trim() || null },
  };
}

/** A structured-format item (choice / matching ...) has one component: the right choice. */
export function pedagogicalGradeForStructured(correct: boolean): PedagogicalGrade {
  return {
    model: 'PEDAGOGICAL_V1',
    mathematicalCorrectness: 'NOT_APPLICABLE',
    taskCompletion: correct ? 'COMPLETE' : 'MISSING',
    reasoningQuality: 'ABSENT',
    finalJudgment: correct ? 'CORRECT' : 'INCORRECT',
    requirements: [{ id: 'final_result', met: correct, source: 'MATH_CHECK' }],
    missingRequirements: correct ? [] : ['final_result'],
    misconception: null,
    learnerSignal: correct ? 'NONE' : 'MATH_ERROR',
    errorType: null,
    score: correct ? 1 : 0,
    mathCheck: { result: 'UNDECIDABLE', setup: 'UNDECIDABLE' },
    feedback: { didWell: null, missing: [], toFix: null },
  };
}

/** Whether an outcome belongs in the `errors` log (real errors only -- an omission is not an error). */
export function isRecordableError(grade: Pick<PedagogicalGrade, 'learnerSignal'>): boolean {
  return grade.learnerSignal === 'MATH_ERROR' || grade.learnerSignal === 'MISCONCEPTION' || grade.learnerSignal === 'MINOR_SLIP';
}
