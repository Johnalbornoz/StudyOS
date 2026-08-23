import type { getMessages } from '@/lib/i18n/messages';

export type EvidenceResult = 'correct' | 'partial' | 'incorrect';

/** Shared label/color mapping for a concept's evidence history -- used by Concept Detail. */
export function sourceLabel(sourceType: string, t: ReturnType<typeof getMessages>): string {
  switch (sourceType) {
    case 'PRACTICE_QUESTION':
      return t['quiz.modeQuickCheck'];
    case 'PRACTICE_QUIZ':
      return t['quiz.modeTopicPractice'];
    case 'CUMULATIVE_ASSESSMENT':
      return t['quiz.modeCumulative'];
    case 'EXAM_SIMULATION':
      return t['quiz.modeExamSim'];
    case 'GUIDED_EXERCISE':
      return t['subjectDetail.sourceGuidedExercise'];
    case 'TOPIC_ASSESSMENT':
      return t['subjectDetail.sourceTopicAssessment'];
    case 'REAL_SCHOOL_EXAM':
      return t['subjectDetail.sourceRealExam'];
    default:
      return sourceType;
  }
}

export function resultLabel(result: EvidenceResult, t: ReturnType<typeof getMessages>): string {
  return result === 'correct' ? t['subjectDetail.resultCorrect'] : result === 'partial' ? t['subjectDetail.resultPartial'] : t['subjectDetail.resultIncorrect'];
}

export function resultColor(result: EvidenceResult): string {
  return result === 'correct' ? 'var(--brand)' : result === 'partial' ? 'var(--warning)' : 'var(--error)';
}
