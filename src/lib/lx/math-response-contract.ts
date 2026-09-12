/**
 * LX-8R2 R9/R10 -- CANONICAL MATH RESPONSE CONTRACT.
 *
 * One canonical serialization of a structured math answer, so grading
 * is deterministic and identical regardless of whether the learner
 * typed it, built it via toolbar structures, or spoke it (R9): the
 * grader always receives the SAME plain string
 * (`toGraderString(response)`) no matter which input modality produced
 * it. Never scrapes rendered DOM/HTML; never lets a toolbar
 * implementation detail become the evidence format.
 *
 * R10: `gradeAnswer`/`gradeStructuredAnswer`
 * (src/services/quiz-generation.service.ts) already take a plain
 * `studentAnswer: string` and (for free-text types) route it through
 * an AI grader whose system prompt evaluates "on their merits, not
 * exact wording" -- i.e. grading is already input-method-agnostic as
 * long as it receives one deterministic string. `toGraderString`
 * supplies exactly that string; this module adds no new grading path
 * and does not touch `gradeAnswer`/`gradeStructuredAnswer` themselves.
 */

/**
 * `latex` is the ONE authoritative representation -- what the
 * structured editor's model actually holds, what voice-to-math
 * populates, what gets graded. `plainText`/`accessibilityText` are
 * optional, purely additive presentational variants (e.g. a
 * screen-reader-friendly reading), never a second source of truth the
 * grader could disagree with.
 */
export interface MathResponse {
  /** Canonical LaTeX serialization -- the only field the grader ever reads. */
  latex: string;
  /** Optional plain-text approximation (e.g. "x^2" for accessibility copy/paste); never derived by the grader. */
  plainText?: string;
  /** Optional screen-reader-oriented spoken form (e.g. "x squared"); presentation only. */
  accessibilityText?: string;
}

export function createMathResponse(latex: string, extra?: Partial<Pick<MathResponse, 'plainText' | 'accessibilityText'>>): MathResponse {
  return { latex, ...extra };
}

/**
 * The exact deterministic string every grader-facing call site must
 * use, regardless of how the answer was produced. Grading already
 * accepts a plain string (R10); this is that string.
 */
export function toGraderString(response: MathResponse): string {
  return response.latex;
}

export function isEmptyMathResponse(response: MathResponse | null | undefined): boolean {
  return !response || response.latex.trim().length === 0;
}
