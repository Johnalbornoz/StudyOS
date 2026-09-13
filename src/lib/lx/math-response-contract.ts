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
 * LX-8R2-R1 -- moved here from quiz/page.tsx: `isMathCapableContext`
 * (LX-8R4: renamed from `isMathAnswerContext` -- see that function's
 * own doc comment for why) (the ONE shared "is math notation an
 * appropriate input capability here?" classifier) and the
 * storage-string wrap/unwrap helpers, so every learner-facing surface
 * (main quiz, Retention resume, inline Assessment verification, and
 * any future one) imports the SAME functions instead of each
 * re-deriving its own copy. This module still owns NO pedagogical
 * authority: `isMathCapableContext` decides which INPUT AFFORDANCE is
 * offered, nothing about correctness, mastery, EvidenceMode, or
 * SupportLevel (those stay entirely with ResponseEvidenceContract /
 * activity-taxonomy / adaptive-teaching-policy, untouched by this
 * file) -- and, as of LX-8R4, nothing about what evidence KIND the
 * question demands either (math capability and evidence requirement
 * are separate axes; see `isMathCapableContext`'s own comment).
 */
import { inferMathToolbarSubject } from '@/lib/math-toolbar-config';

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
 * LX-8R4 A1-A4 -- THE ONE shared MATH-CAPABILITY authority: "is
 * structured mathematical notation an appropriate INPUT CAPABILITY for
 * this question/context?" Gated on the SAME pre-existing, non-adaptive
 * subject heuristic `inferMathToolbarSubject` already used (since
 * before LX-8R2) to prioritize toolbar buttons -- never a new
 * classifier, never a second copy of this decision anywhere else in
 * the codebase. Every learner-facing surface that offers `mathEnabled`
 * to `UnifiedResponseComposer` (main quiz, Retention resume,
 * verification) must import and call THIS function, never re-derive
 * its own version.
 *
 * This is PRESENTATION CAPABILITY CLASSIFICATION ONLY -- it decides
 * whether the math block/keyboard affordance is OFFERED. It has no
 * bearing on, and must never be extended to decide, correctness,
 * mastery, EvidenceMode, SupportLevel, or which activity comes next.
 * Those stay entirely owned by ResponseEvidenceContract /
 * activity-taxonomy / adaptive-teaching-policy.
 *
 * LX-8R4 A1/A2 ROOT-CAUSE REPAIR (do not reintroduce): this function
 * used to also take the question's `ResponseEvidenceContract.kind` and
 * deny math capability for EXPLAIN/JUSTIFY, on the theory that those
 * "ask for prose, not a computed expression." Live QA proved this
 * wrong: a JUSTIFY-kind question in a math subject ("identify the
 * error in this exponent expression and explain the correct
 * simplification") is EXACTLY the kind of question where a learner
 * needs to write both an expression and prose -- denying math there
 * silently forced the mathematical part of the answer into plain text.
 * MATHEMATICAL-ENTRY CAPABILITY and EVIDENCE REQUIREMENT are separate
 * axes (A2): `kind` may change what instruction text
 * `UnifiedResponseComposer` shows (`responseInstructionKey`) and what
 * the grader ultimately requires, but it must NEVER gate whether math
 * notation is available to express that answer. This function
 * therefore reads ONLY the subject/domain signal -- no `kind`
 * parameter exists, so there is no way to reintroduce this coupling by
 * accident at a call site.
 *
 * No stronger question-level math-domain signal exists on
 * `GeneratedQuestion` today (audited: no `subjectDomain`/math flag) --
 * `inferMathToolbarSubject`'s subject-name heuristic remains the best
 * available signal (A4) and is reused here rather than replaced.
 */
export function isMathCapableContext(subjectName: string | undefined): boolean {
  const subject = inferMathToolbarSubject(subjectName);
  return subject === 'mathematics' || subject === 'physics';
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
