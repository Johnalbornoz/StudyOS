/**
 * F8 -- feedback contract (task §19). Pure mapping function; never
 * reimplements grading -- wraps whichever of the FOUR EXISTING graders
 * (gradeStructuredAnswer/gradeAnswer) the caller already ran.
 * `GradingErrorType` (F0-era) is never modified -- this is an additive
 * superset mapping living in its own new type.
 */
import type { GradeAnswerResult, GradingErrorType } from '@/services/quiz-generation.service';
import type { GapType } from '@/lib/diagnostics/types';

export type FeedbackCategory =
  | 'CORRECT'
  | 'KNOWLEDGE_ERROR'
  | 'SKILL_EXECUTION_ERROR'
  | 'COMMAND_TERM_MISMATCH'
  | 'STRUCTURE_INCOMPLETE'
  | 'RUBRIC_CRITERIA_MISSED'
  | 'CALCULATION_ERROR'
  | 'INCOMPLETE_ANSWER'
  | 'UNSUPPORTED_CONCLUSION'
  | 'CARELESS_ERROR'
  | 'MISREAD_QUESTION'
  | 'TIMING_ISSUE';

export interface AttemptFeedback {
  category: FeedbackCategory;
  observedBehavior: string;
  sourceGraderErrorType: GradingErrorType | null;
  technique: { commandTermId: string; expectedStructure: string | null; ruleViolated: string } | null;
}

type SimpleGraderResult = { correct: boolean; score: number; feedback: string };

function isGradeAnswerResult(result: SimpleGraderResult | GradeAnswerResult): result is GradeAnswerResult {
  return 'errorType' in result;
}

const ERROR_TYPE_TO_CATEGORY: Record<GradingErrorType, FeedbackCategory> = {
  CONCEPTUAL: 'KNOWLEDGE_ERROR',
  PROCEDURAL: 'UNSUPPORTED_CONCLUSION',
  CARELESS: 'CARELESS_ERROR',
  INCOMPLETE: 'INCOMPLETE_ANSWER',
  MISREADING: 'MISREAD_QUESTION',
  ARITHMETIC: 'CALCULATION_ERROR',
  UNIT: 'CALCULATION_ERROR',
};

export function classifyFeedback(params: {
  graderResult: SimpleGraderResult | GradeAnswerResult;
  gapTypeConsidered: GapType | 'MIXED' | 'INSUFFICIENT_EVIDENCE' | null;
  isTechniqueTargetedIntervention: boolean;
  commandTerm?: { id: string; term: string; expectedStructure: string | null } | null;
}): AttemptFeedback {
  const { graderResult } = params;

  if (graderResult.correct) {
    return { category: 'CORRECT', observedBehavior: 'The response matched the expected answer.', sourceGraderErrorType: null, technique: null };
  }

  if (
    params.isTechniqueTargetedIntervention &&
    params.commandTerm &&
    (params.gapTypeConsidered === 'EXAM_TECHNIQUE_GAP' || params.gapTypeConsidered === 'MIXED')
  ) {
    return {
      category: 'COMMAND_TERM_MISMATCH',
      observedBehavior: `The response did not follow the expected structure for the command term "${params.commandTerm.term}".`,
      sourceGraderErrorType: isGradeAnswerResult(graderResult) ? graderResult.errorType : null,
      technique: {
        commandTermId: params.commandTerm.id,
        expectedStructure: params.commandTerm.expectedStructure,
        ruleViolated: 'REQUIRED_STRUCTURE',
      },
    };
  }

  if (!isGradeAnswerResult(graderResult)) {
    return {
      category: 'KNOWLEDGE_ERROR',
      observedBehavior: 'The selected/submitted answer differs from the correct answer.',
      sourceGraderErrorType: null,
      technique: null,
    };
  }

  let category = graderResult.errorType ? ERROR_TYPE_TO_CATEGORY[graderResult.errorType] : 'KNOWLEDGE_ERROR';
  if (graderResult.errorType === 'PROCEDURAL' && graderResult.reasoningValid === false && params.gapTypeConsidered === 'SKILL_GAP') {
    category = 'SKILL_EXECUTION_ERROR';
  }

  return {
    category,
    observedBehavior: graderResult.feedback,
    sourceGraderErrorType: graderResult.errorType,
    technique: null,
  };
}
