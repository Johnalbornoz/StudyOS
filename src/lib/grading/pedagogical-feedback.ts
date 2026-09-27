/**
 * Learner-facing text of a pedagogical grade, in the activity language:
 * what you did well / what was missing / what to correct. The "missing"
 * lines are deterministic (one localized line per missing requirement), so
 * a result-correct answer always hears that its result is correct.
 */
import { getMessages, type Locale, type MessageKey } from '@/lib/i18n/messages';
import type { PedagogicalGrade } from './pedagogical-grade';

export interface PedagogicalFeedbackText {
  didWell: string | null;
  missing: string[];
  toFix: string | null;
  /** The three parts joined -- the legacy single `feedback` string. */
  combined: string;
}

export function pedagogicalFeedbackText(grade: PedagogicalGrade, language: string): PedagogicalFeedbackText {
  const t = getMessages((language as Locale) ?? 'en') as Record<MessageKey, string>;
  const resultVerified = grade.requirements.some((r) => (r.id === 'final_result' || r.id === 'corrected_result') && r.met);
  const setupVerified = grade.requirements.some((r) => r.id === 'correct_setup' && r.met && r.source === 'MATH_CHECK');

  let didWell = grade.feedback.didWell;
  if (grade.finalJudgment !== 'INCORRECT') {
    if (grade.mathematicalCorrectness === 'MINOR_SLIP') didWell = t['grading.minorSlip'];
    else if (resultVerified) didWell = t['grading.didWell.result'];
    else if (setupVerified) didWell = t['grading.didWell.setup'];
  }
  const missing = grade.finalJudgment === 'CORRECT' ? [] : grade.missingRequirements.map((id) => t[`grading.missing.${id}` as MessageKey]).filter(Boolean);
  const toFix = grade.finalJudgment === 'CORRECT' ? null : grade.feedback.toFix;
  const combined = [didWell, ...missing, toFix].filter((x): x is string => !!x && !!x.trim()).join(' ');
  return { didWell, missing, toFix, combined };
}
