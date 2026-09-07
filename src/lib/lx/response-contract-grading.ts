/**
 * LX-4F -- RESPONSE / EVIDENCE CONTRACT: runtime grader guard.
 *
 * Makes the LX-1 `FUNDAMENTAL INVARIANT` runtime behaviour, not just a
 * dormant unit-tested contract:
 *
 *   The grader may only reduce a score for an evidence axis the
 *   `ResponseEvidenceContract` declares in `partialCreditDimensions`.
 *
 * Concretely, for `kind === 'ANSWER_ONLY'` (the LX-0 "Expectation
 * Contract Failure": a plain numeric question that only asks for the
 * answer), a CORRECT final answer must never be marked down because the
 * learner did not show work or the AI grader disliked the phrasing.
 *
 * Pure. No I/O. Wrapped around `gradeAnswer`'s result in the
 * `generate-and-take` route. It NEVER raises a score for a
 * SHOW_WORK / EXPLAIN / JUSTIFY question (there the grader legitimately
 * scores METHOD / REASONING) and NEVER invents correctness -- it only
 * repairs an ANSWER_ONLY grade when the final answer is demonstrably
 * right.
 */

import type { ResponseEvidenceContract } from './response-evidence-contract';
import { contractPermitsGradingOn } from './response-evidence-contract';

/** The subset of the existing `GradeAnswerResult` this guard reads/returns. */
export interface GuardableGrade {
  correct: boolean;
  score: number; // 0..1
  feedback: string;
  errorType: string | null;
  reasoningValid: boolean;
}

/** Whitespace/case/punctuation-insensitive, with a numeric fast path and `x = 4` / `= 4` stripping. */
export function finalAnswersMatch(studentRaw: string, correctRaw: string): boolean | null {
  const norm = (s: string) =>
    s
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/^[a-z]\s*=\s*/i, '') // "x = 4" -> "4"
      .replace(/^=\s*/, '') // "= 4" -> "4"
      .replace(/[.\s]+$/, ''); // trailing period / space

  const s = norm(studentRaw);
  const c = norm(correctRaw);
  if (!s || !c) return null;
  if (s === c) return true;

  // numeric equivalence: "4" == "4.0" == "4,0" (decimal comma) == "+4"
  const toNum = (v: string) => {
    const cleaned = v.replace(/,/g, '.').replace(/[^0-9.+\-eE]/g, '');
    if (cleaned === '' || cleaned === '+' || cleaned === '-' || cleaned === '.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };
  const sn = toNum(s);
  const cn = toNum(c);
  if (sn !== null && cn !== null) {
    return Math.abs(sn - cn) < 1e-9;
  }
  return null; // can't decide deterministically
}

/**
 * Apply the contract's grader whitelist to one graded answer.
 *
 * - `ANSWER_ONLY`: only `FINAL_ANSWER` may be scored. If the final
 *   answer is demonstrably correct, the grade is repaired to a clean
 *   pass (score 1, no errorType). Otherwise the grade is returned
 *   unchanged. `METHOD` / `REASONING` deductions are never allowed to
 *   stand.
 * - `SHOW_WORK` / `EXPLAIN` / `JUSTIFY`: returned unchanged -- the
 *   contract permits `METHOD` / `REASONING` scoring, which the grader
 *   already does.
 */
export function applyResponseContractGuard(
  contract: ResponseEvidenceContract,
  grade: GuardableGrade,
  answers: { studentAnswer: string; correctAnswer: string },
): GuardableGrade {
  // The grader may legitimately score method/reasoning for these kinds.
  if (contractPermitsGradingOn(contract, 'METHOD') || contractPermitsGradingOn(contract, 'REASONING')) {
    return grade;
  }

  // ANSWER_ONLY: only the final answer counts.
  const match = finalAnswersMatch(answers.studentAnswer, answers.correctAnswer);
  const finalAnswerCorrect = match === null ? grade.correct : match;

  if (finalAnswerCorrect) {
    return {
      correct: true,
      score: 1,
      feedback: grade.feedback,
      errorType: null,
      reasoningValid: true,
    };
  }
  // Wrong final answer -- the grader's own verdict stands (it only had
  // the final answer to judge anyway).
  return grade;
}
