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
 *
 * LX-8R2-R1 -- moved here from quiz/page.tsx: `isMathAnswerContext`
 * (the ONE shared "should this final-answer surface be the structured
 * math composer?" classifier) and the storage-string wrap/unwrap
 * helpers, so every learner-facing surface (main quiz, Retention
 * resume, inline Assessment verification, and any future one) imports
 * the SAME functions instead of each re-deriving its own copy. This
 * module still owns NO pedagogical authority: `isMathAnswerContext`
 * decides which INPUT WIDGET renders, nothing about correctness,
 * mastery, EvidenceMode, or SupportLevel (those stay entirely with
 * ResponseEvidenceContract / activity-taxonomy / adaptive-teaching-
 * policy, untouched by this file).
 */
import { inferMathToolbarSubject } from '@/lib/math-toolbar-config';
import type { EvidenceRequirementKind } from './response-evidence-contract';

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

/**
 * LX-8R2-R1 R9 -- THE ONE shared classifier for "should this
 * final-answer box be the structured Math Response Composer instead of
 * a plain prose editor?" Gated on the SAME pre-existing, non-adaptive
 * subject heuristic `inferMathToolbarSubject` already used (since
 * before LX-8R2) to prioritize toolbar buttons -- never a new
 * classifier, never a second copy of this decision anywhere else in
 * the codebase. Every learner-facing surface that offers a
 * mathematical final answer (main quiz, Retention resume,
 * verification) must import and call THIS function, never re-derive
 * its own version.
 *
 * This is PRESENTATION CLASSIFICATION ONLY -- it decides which INPUT
 * WIDGET renders. It has no bearing on, and must never be extended to
 * decide, correctness, mastery, EvidenceMode, SupportLevel, or which
 * activity comes next. Those stay entirely owned by
 * ResponseEvidenceContract / activity-taxonomy / adaptive-teaching-
 * policy.
 *
 * Excludes EXPLAIN/JUSTIFY-kind questions (case_study, scenario,
 * comparison, justification, error_detection, prediction, open_ended)
 * even in a math subject, since those ask for verbal reasoning/defense
 * of a claim, not a computed expression -- a math-only structured
 * field cannot hold flowing prose. Matches the LX-8R2 spec's own R8/R6
 * examples: ANSWER_ONLY/SHOW_WORK/JUSTIFY get the math composer;
 * EXPLAIN keeps prose (which may still use the plain-text editor's own
 * inline math-symbol toolbar for an occasional inline expression).
 */
export function isMathAnswerContext(subjectName: string | undefined, kind: EvidenceRequirementKind): boolean {
  const subject = inferMathToolbarSubject(subjectName);
  return (subject === 'mathematics' || subject === 'physics') && kind !== 'EXPLAIN' && kind !== 'JUSTIFY';
}

/**
 * LX-8R2-R1 R8 -- the ONE storage-string convention every math-context
 * final-answer field uses: canonical LaTeX wrapped in the SAME
 * `$...$` inline-math delimiter `MathText`/AI-generated content
 * already use (math-text.ts), so any surface that later displays the
 * stored string (Review, a verification-results list) renders it as
 * real typeset math via the EXISTING `<MathText>` component with zero
 * changes there, and the AI grader (already reading AI-authored
 * $-delimited LaTeX in the question/model-answer) sees the same
 * convention back. LX-8R3: also reused by `response-document.ts`'s
 * `toGraderText` for a math BLOCK within a unified response document
 * (`UnifiedResponseComposer`) -- the same convention, one authority.
 */
export function wrapMathForStorage(latex: string): string {
  return latex ? `$${latex}$` : '';
}
export function unwrapMathFromStorage(stored: string): string {
  const m = /^\$([\s\S]*)\$$/.exec(stored.trim());
  return m ? m[1] : stored;
}
