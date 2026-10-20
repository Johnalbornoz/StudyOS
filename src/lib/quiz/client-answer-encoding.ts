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

/**
 * B5-D -- the inverse of `encodeClientAnswer`, for restoring a saved draft into the answer controls. A value
 * that does not parse for its format restores as "no answer" (never as a guess).
 */
export function decodeClientAnswer(question: ClientQuestionLike, encoded: string): unknown {
  if (!encoded) return undefined;
  const json = (): unknown => {
    try {
      return JSON.parse(encoded);
    } catch {
      return undefined;
    }
  };
  if (question.answerFormat === 'single_choice' || question.answerFormat === 'text') return encoded;
  if (question.answerFormat === 'multi_choice') return encoded.split(',').filter(Boolean);
  if (question.answerFormat === 'matching' || question.answerFormat === 'classification') {
    const v = json();
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  }
  if (question.answerFormat === 'ordering') {
    const v = json();
    if (!Array.isArray(v)) return undefined;
    return Object.fromEntries((v as unknown[]).filter((x): x is string => typeof x === 'string').map((item, i) => [item, i + 1]));
  }
  return undefined;
}
