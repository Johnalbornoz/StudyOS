/**
 * Student runtime question supply -- REVISED OE-014.
 *
 * The first OE-014 said "Student runtime may not generate questions". That was too broad: it made ordinary
 * Learning depend on content nobody was producing. The rule is now the supply boundary
 * (lib/assessment-supply/supply-boundary):
 *
 *   LEARNING              a provider may generate, on an explicit command
 *   INTERNAL_ASSESSMENT   a provider may generate before the attempt begins
 *   STANDARDIZED_EXAM     a provider never generates: insufficient certified content is NOT_READY
 *
 * This module answers the one question the legacy quiz route asks -- "may THIS launch generate?" -- from the
 * launch's own quiz mode. It reads no environment, no header and no cookie: a request cannot switch it.
 */
import { providerGenerationAllowed, supplyFamilyOf, supplyIntentOfQuizMode } from '@/lib/assessment-supply/supply-boundary';

/** May a launch of this quiz mode ask a provider for its questions? An unknown mode may not (fail closed). */
export function studentRuntimeMayGenerateQuestions(quizMode: string | null | undefined): boolean {
  return providerGenerationAllowed(supplyFamilyOf(supplyIntentOfQuizMode(quizMode)), 'EXPLICIT_COMMAND');
}

/** A standardized-exam launch that has no certified content to deliver. */
export const INSUFFICIENT_CERTIFIED_CONTENT = { success: false, error: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT' } as const;
export const INSUFFICIENT_CERTIFIED_CONTENT_STATUS = 409;

/** A Learning / Internal Assessment launch whose generation did not produce usable questions: retryable, never "not enough questions in the bank". */
export const LEARNING_GENERATION_FAILED = { success: false, error: 'LEARNING_GENERATION_FAILED', reason: 'LEARNING_GENERATION_FAILED', retryable: true } as const;
export const LEARNING_GENERATION_FAILED_STATUS = 503;
