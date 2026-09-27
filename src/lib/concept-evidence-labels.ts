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

/**
 * The learner-facing name of one history attempt. The activity's own
 * declared type wins (LEARN_CHECK -> "Comprobar comprensión", SOLO_CHECK /
 * Prove -> "Comprobación individual", ...), so an attempt is never named
 * after its storage source type; legacy rows without a type fall back to
 * the source label.
 */
export function historyActivityLabel(item: { sourceType: string; activityType: string | null }, t: ReturnType<typeof getMessages>): string {
  if (item.activityType) {
    const label = (t as Record<string, string>)[`activityLabel.${item.activityType}`];
    if (label) return label;
  }
  return sourceLabel(item.sourceType, t);
}

export function resultLabel(result: EvidenceResult, t: ReturnType<typeof getMessages>): string {
  return result === 'correct' ? t['subjectDetail.resultCorrect'] : result === 'partial' ? t['subjectDetail.resultPartial'] : t['subjectDetail.resultIncorrect'];
}

export function resultColor(result: EvidenceResult): string {
  return result === 'correct' ? 'var(--brand)' : result === 'partial' ? 'var(--warning)' : 'var(--error)';
}

/**
 * Accessible text for a debt-resolution criterion's pass/fail state --
 * the visual ✓/○ glyph is aria-hidden (decorative, color-dependent), so
 * this is the only thing a screen reader announces for "is this
 * criterion met", and it must never silently disappear.
 */
export function criterionStatusLabel(met: boolean, t: ReturnType<typeof getMessages>): string {
  return met ? t['conceptDetail.criterionMet'] : t['conceptDetail.criterionNotMet'];
}
