/**
 * F7 -- Validation layer (task 26). Additive checks alongside the
 * EXISTING Quality Gate/semantic verifier (question-quality-contract.ts,
 * question-quality-verifier.service.ts) -- answerability and schema
 * validity remain THEIR job; this checks only exam-context compatibility
 * they have no way to know about. FAIL CONTROLLED: never an exception,
 * always a structured {valid, reasons} result -- an invalid item is
 * never silently presented (task 26/AC-F7-13).
 */
import type { GenerationContext, ValidationResult } from './types';

export interface CandidateItem {
  type: string;
  difficulty: number;
}

export function validateItemForExamContext(item: CandidateItem, context: GenerationContext): ValidationResult {
  const reasons: string[] = [];

  if (context.questionType && item.type !== context.questionType) {
    reasons.push(`QUESTION_TYPE_MISMATCH: expected ${context.questionType}, got ${item.type}`);
  }

  if (context.difficultyRange && (item.difficulty < context.difficultyRange.min || item.difficulty > context.difficultyRange.max)) {
    reasons.push(`DIFFICULTY_OUT_OF_RANGE: expected ${context.difficultyRange.min}-${context.difficultyRange.max}, got ${item.difficulty}`);
  }

  if (context.canonicalConceptIds.length === 0 && context.skillIds.length === 0) {
    reasons.push('NO_PUBLISHED_MAPPING: the target objective has no PUBLISHED concept or skill mapping to generate against');
  }

  if (context.toolContext.status === 'NOT_CONFIGURED') {
    reasons.push('TOOL_RULES_NOT_CONFIGURED: cannot validate tool-rule compliance for an unconfigured component');
  }

  return { valid: reasons.length === 0, reasons };
}

/** A component with UNSUPPORTED status must fail generation explicitly, never silently degrade (task adversarial case G, INV-F7-08). */
export function validateComponentSupported(supportStatus: 'SUPPORTED' | 'UNSUPPORTED'): ValidationResult {
  if (supportStatus === 'UNSUPPORTED') {
    return { valid: false, reasons: ['UNSUPPORTED_COMPONENT'] };
  }
  return { valid: true, reasons: [] };
}
