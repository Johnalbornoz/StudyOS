/**
 * The one transform from a stored `GeneratedQuestion` to the shape the
 * quiz client renders -- the correct answer / order / pairing is
 * stripped before it ever leaves the server.
 *
 * Extracted (LX-4P-R2) from `generate-and-take/route.ts` so the
 * same-item localization endpoint reshapes a localized question exactly
 * the way the original was reshaped -- no drift between the two paths.
 */
import type { GeneratedQuestion } from '@/services/quiz-generation.service';

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ToClientQuestionOptions {
  /**
   * LX-4P-R2: preserve an EXISTING on-screen option order instead of
   * reshuffling. Must be a permutation of the question's own option ids
   * (the caller validates that); any id not present in the question is
   * ignored and any missing one is appended in canonical order, so a
   * bad hint can never drop or invent a choice.
   */
  optionOrder?: string[];
}

/** Strip the correct answer/order/pairing before sending a question to the client. */
export function toClientQuestion(q: GeneratedQuestion, index: number, opts: ToClientQuestionOptions = {}) {
  let options: { id: string; text: string }[] | undefined;
  if (q.options) {
    if (opts.optionOrder && opts.optionOrder.length > 0) {
      const byId = new Map(q.options.map((o) => [o.id, o]));
      const ordered = opts.optionOrder.map((id) => byId.get(id)).filter((o): o is { id: string; text: string } => !!o);
      const seen = new Set(ordered.map((o) => o.id));
      for (const o of q.options) if (!seen.has(o.id)) ordered.push(o);
      options = ordered;
    } else {
      options = shuffleArray(q.options);
    }
  }
  return {
    index,
    conceptId: q.conceptId,
    type: q.type,
    answerFormat: q.answerFormat,
    question: q.question,
    difficulty: q.difficulty,
    calculatorAllowed: q.calculatorAllowed,
    options,
    matchingLeft: q.matchingPairs?.map((p) => p.left),
    matchingRightShuffled: q.matchingPairs ? shuffleArray(q.matchingPairs.map((p) => p.right)) : undefined,
    orderingItemsShuffled: q.orderingItems ? shuffleArray(q.orderingItems) : undefined,
    classificationItems: q.classificationItems?.map((it) => it.item),
    classificationCategories: q.classificationCategories,
    visualAid: q.visualAid,
    askConfidence: q.askConfidence || undefined,
    // LX-4R R5: the generator's canonical reasoning tag, so the client's
    // "what's being asked" line matches the server grader guard.
    expectedReasoningType: q.expectedReasoningType,
  };
}
