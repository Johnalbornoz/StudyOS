/**
 * F15 -- shared answer-staging/encoding for any UI that answers a
 * `toClientQuestion`-shaped item (extracted from F14's PracticeRunner
 * so the new Exam-Taking ItemRunner reuses the exact same, already-
 * verified encoding instead of a second copy). Encodes into the exact
 * string format `gradeStructuredAnswer` (quiz-generation.service.ts)
 * already expects -- this file performs no grading itself.
 */

export type AnswerFormat = 'single_choice' | 'multi_choice' | 'text' | 'matching' | 'ordering' | 'classification';

export interface ClientQuestionLike {
  index: number;
  answerFormat: AnswerFormat;
  orderingItemsShuffled?: string[];
}

export function encodeClientAnswer(question: ClientQuestionLike, staged: unknown): string {
  if (question.answerFormat === 'single_choice') return (staged as string) || '';
  if (question.answerFormat === 'multi_choice') return Array.isArray(staged) ? (staged as string[]).join(',') : '';
  if (question.answerFormat === 'text') return (staged as string) || '';
  if (question.answerFormat === 'matching') return JSON.stringify(staged || {});
  if (question.answerFormat === 'ordering') {
    const positions = (staged as Record<string, number>) || {};
    const ordered = [...(question.orderingItemsShuffled || [])].sort((a, b) => (positions[a] ?? 0) - (positions[b] ?? 0));
    return JSON.stringify(ordered);
  }
  if (question.answerFormat === 'classification') return JSON.stringify(staged || {});
  return '';
}
