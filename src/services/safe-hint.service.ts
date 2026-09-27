/**
 * Safe, never-empty question hints for assisted activities (LEARN_CHECK /
 * PRACTICE): the ONE pipeline behind "Dame una pista" (contextual help) and
 * the direction/scaffold of LEARN_CHECK immediate feedback.
 *
 *   1. generate (quiz.question_hint -- instructed never to reveal);
 *   2. every hint passes feedback-leak-guard: a revealing sentence is
 *      dropped (a multi-sentence hint degrades to its safe part);
 *   3. nothing safe left, empty reply, error or timeout -> regenerate once;
 *   4. still nothing -> a deterministic, localized, non-revealing fallback.
 *
 * Never returns an empty list, never the answer key, never throws.
 */
import { generateQuestionHint, type GeneratedQuestion } from '@/services/quiz-generation.service';
import { stripAnswerReveals } from '@/lib/quiz/feedback-leak-guard';
import { getMessages, type Locale } from '@/lib/i18n/messages';

export type SafeHintSource = 'ai' | 'ai_regenerated' | 'fallback';

export interface SafeHintResult {
  hints: string[];
  source: SafeHintSource;
  /** Why an attempt produced nothing usable (diagnostics only; never shown). */
  discarded: Array<'EMPTY' | 'ALL_REVEALING' | 'ERROR' | 'TIMEOUT'>;
}

const ATTEMPT_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 2;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('HINT_TIMEOUT')), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Localized, question-agnostic but format-aware hints that can never reveal anything. */
export function fallbackHints(question: Pick<GeneratedQuestion, 'options' | 'answerFormat'>, language: string): string[] {
  const t = getMessages((language as Locale) ?? 'en');
  const isChoice = !!question.options && question.options.length > 0;
  return [t['help.hintFallbackData'], isChoice ? t['help.hintFallbackChoice'] : t['help.hintFallbackOpen']];
}

export async function getSafeQuestionHints(
  question: GeneratedQuestion,
  language: string,
  aiContext: { studentId?: string; subjectId?: string; conceptId?: string; sourceId?: string },
  // passed through untouched: the adaptive teaching context stays owned by the caller (contextual-help route)
  generationContext?: Parameters<typeof generateQuestionHint>[2],
  timeoutMs: number = ATTEMPT_TIMEOUT_MS,
): Promise<SafeHintResult> {
  const guardQuestion = {
    answerFormat: question.answerFormat,
    correctAnswer: question.correctAnswer,
    options: question.options,
    explanation: question.explanation,
  };
  const discarded: SafeHintResult['discarded'] = [];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await withTimeout(generateQuestionHint(question, language, generationContext, aiContext), timeoutMs);
      const list = (raw ?? []).filter((h) => typeof h === 'string' && h.trim());
      if (list.length === 0) {
        discarded.push('EMPTY');
        continue;
      }
      const safe = list.map((h) => stripAnswerReveals(h, guardQuestion)).filter((h): h is string => !!h);
      if (safe.length === 0) {
        discarded.push('ALL_REVEALING');
        continue;
      }
      return { hints: safe, source: attempt === 0 ? 'ai' : 'ai_regenerated', discarded };
    } catch (e) {
      discarded.push(e instanceof Error && e.message === 'HINT_TIMEOUT' ? 'TIMEOUT' : 'ERROR');
    }
  }
  return { hints: fallbackHints(question, language), source: 'fallback', discarded };
}
