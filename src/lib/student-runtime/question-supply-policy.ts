/**
 * OE-014 -- where the questions of a Student's runtime come from.
 *
 * A Student action (a page view, a quiz start, a submission, a completed assessment) may READ the certified
 * global Question Bank and may create its own attempt, session and evidence records. It never generates a
 * question, never calls a provider to write one and never queues inventory replenishment. When the certified
 * content cannot supply what was asked for, the answer is NOT_READY / INSUFFICIENT_CERTIFIED_CONTENT -- never a
 * fallback to generation. Replenishing the bank belongs to the Factory / Admin / offline governed workflows.
 *
 * This is a constant of the architecture, not a setting: it reads no environment variable and has no override.
 *
 * Pure.
 */
export const STUDENT_RUNTIME_QUESTION_SUPPLIES = ['CERTIFIED_BANK_ONLY', 'LEGACY_GENERATION'] as const;
export type StudentRuntimeQuestionSupply = (typeof STUDENT_RUNTIME_QUESTION_SUPPLIES)[number];

export const STUDENT_RUNTIME_QUESTION_SUPPLY: StudentRuntimeQuestionSupply = 'CERTIFIED_BANK_ONLY';

/** May a Student-triggered request generate a question or ask for supply? Never, under CERTIFIED_BANK_ONLY. */
export const studentRuntimeMayGenerateQuestions = (supply: StudentRuntimeQuestionSupply = STUDENT_RUNTIME_QUESTION_SUPPLY): boolean => supply === 'LEGACY_GENERATION';

/** The one answer of a Student launch the certified content cannot supply. HTTP 409: the request is valid, the content is not there yet. */
export const INSUFFICIENT_CERTIFIED_CONTENT = { success: false, error: 'NOT_READY', reason: 'INSUFFICIENT_CERTIFIED_CONTENT' } as const;
export const INSUFFICIENT_CERTIFIED_CONTENT_STATUS = 409 as const;
