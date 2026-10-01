import type { getMessages } from '@/lib/i18n/messages';
import type { AttentionReason, TeacherSuggestion } from '@/lib/teacher/learner-view.service';

type Messages = ReturnType<typeof getMessages>;

/** Localized copy for the Teacher's "who needs help / why / what to do" (one source for class and learner pages). */
export function attentionLabels(t: Messages): { reason: Record<AttentionReason, string>; suggestion: Record<TeacherSuggestion, string> } {
  return {
    reason: {
      OVERDUE_ASSIGNMENT: t['tl.reason.OVERDUE_ASSIGNMENT'],
      MISCONCEPTION: t['tl.reason.MISCONCEPTION'],
      REINFORCE: t['tl.reason.REINFORCE'],
      PREREQUISITE_GAP: t['tl.reason.PREREQUISITE_GAP'],
      RETENTION_DUE: t['tl.reason.RETENTION_DUE'],
      NOT_STARTED: t['tl.reason.NOT_STARTED'],
    },
    suggestion: {
      FOLLOW_UP_ASSIGNMENT: t['tl.suggest.FOLLOW_UP_ASSIGNMENT'],
      REVIEW_MISCONCEPTION: t['tl.suggest.REVIEW_MISCONCEPTION'],
      ASSIGN_REINFORCEMENT: t['tl.suggest.ASSIGN_REINFORCEMENT'],
      ASSIGN_PREREQUISITE: t['tl.suggest.ASSIGN_PREREQUISITE'],
      ASSIGN_RETENTION: t['tl.suggest.ASSIGN_RETENTION'],
      ASSIGN_FIRST_PRACTICE: t['tl.suggest.ASSIGN_FIRST_PRACTICE'],
    },
  };
}
