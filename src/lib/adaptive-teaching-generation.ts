/**
 * Phase 5-R S4: the ONE canonical, pure adapter from `TeachingIntent`
 * (src/lib/adaptive-teaching-policy.ts) to AI instructional constraints.
 * Every live content-generation call site (tutor chat, quiz hints,
 * Explain & Defend) builds its adaptive prompt block through
 * `buildTeachingConstraintsBlock` -- one canonical text, never a
 * per-generator reinterpretation of the same `TeachingIntent`.
 *
 * Pure: no IO, no AI call, no learner-state model of its own. Reuses
 * `TeachingIntent`'s fields verbatim (`TeachingGenerationContext` is a
 * strict `Pick`, not a new shape) and reuses
 * `tutor-strategy.service.ts::strategyInstruction` verbatim rather than
 * re-describing each `TutorStrategy` value a second time.
 */

import type { TeachingIntent, SupportLevel } from './adaptive-teaching-policy';
import { strategyInstruction, type TutorStrategy } from '@/services/tutor-strategy.service';

/** Section 4: the exact fields a content generator needs -- a Pick of TeachingIntent, never a parallel learner-state model. */
export type TeachingGenerationContext = Pick<
  TeachingIntent,
  | 'instructionalGoal'
  | 'primaryBarrier'
  | 'strategy'
  | 'supportLevel'
  | 'explanationDepth'
  | 'reasoningDemand'
  | 'misconceptionCodes'
  | 'prerequisiteConceptIds'
  | 'avoidStrategies'
  | 'successCriteria'
>;

export function toTeachingGenerationContext(intent: TeachingIntent): TeachingGenerationContext {
  return {
    instructionalGoal: intent.instructionalGoal,
    primaryBarrier: intent.primaryBarrier,
    strategy: intent.strategy,
    supportLevel: intent.supportLevel,
    explanationDepth: intent.explanationDepth,
    reasoningDemand: intent.reasoningDemand,
    misconceptionCodes: intent.misconceptionCodes,
    prerequisiteConceptIds: intent.prerequisiteConceptIds,
    avoidStrategies: intent.avoidStrategies,
    successCriteria: intent.successCriteria,
  };
}

/**
 * Section 8: the minimum deterministic mapping from `SupportLevel` to
 * instructional behavior. Adapted to what StudyUs's generators actually
 * produce (explanation text + optional worked example + a closing
 * check), not five separate AI systems -- one instruction string per
 * level, consumed by every generator alike.
 */
const SUPPORT_LEVEL_INSTRUCTION: Record<SupportLevel, string> = {
  HIGH_SUPPORT: 'Give a full explanation AND one complete worked example, then guide the first step of their own attempt explicitly.',
  GUIDED: 'Give an explanation with clear cues, then guide their attempt without doing it for them.',
  PARTIAL_SUPPORT: 'Give a short explanation and one partial cue -- leave most of the reasoning to the student.',
  MINIMAL_SUPPORT: 'Give a short prompting question or a single light cue -- do not explain the concept outright.',
  INDEPENDENT: 'Do not provide instructional help of any kind -- this is an independent evidence attempt.',
};

export function supportLevelInstruction(level: SupportLevel): string {
  return SUPPORT_LEVEL_INSTRUCTION[level];
}

/**
 * Sections 6/7: barrier-specific structured constraints. ACTIVE_MISCONCEPTION
 * and PREREQUISITE_GAP get materially different instructions from the
 * generic default -- not just "make it easier."
 */
function barrierInstruction(context: TeachingGenerationContext): string {
  switch (context.primaryBarrier) {
    case 'ACTIVE_MISCONCEPTION':
      return [
        `The student has an ACTIVE, specific misconception${context.misconceptionCodes.length > 0 ? ` (code: ${context.misconceptionCodes.join(', ')})` : ''}.`,
        'Name or target that specific incorrect mental model explicitly -- do not give a generic explanation as if this were the first time the student saw this concept.',
        'Contrast the incorrect model against the correct one, and explain concretely why the incorrect model fails.',
        'Do not merely reveal the current correct answer as a substitute for this contrast.',
      ].join(' ');
    case 'PREREQUISITE_GAP':
      return `The real gap is a PREREQUISITE concept, not the concept the student was originally practicing. Teach the prerequisite itself, on its own terms -- do not drift back to explaining the downstream concept the prerequisite supports.`;
    case 'HELP_DEPENDENCY':
      return 'This student relies on assistance more than their actual evidence justifies. Prefer a short prompting question over a full explanation, and require them to attempt the next step themselves before any further help.';
    case 'OVERCONFIDENCE':
      return 'This student is more confident than their evidence supports. Ask them to explain or predict first, and require an active demonstration before confirming they are right.';
    case 'LOW_CONFIDENCE':
      return 'This student\'s evidence is already strong despite low self-reported confidence. Do not re-teach content they have already demonstrated -- ask them to articulate it in their own words instead.';
    case 'PERSISTENT_FAILURE':
      return 'Previous attempts at this concept have not succeeded. Restructure into smaller, more explicit steps than a first-pass explanation would use.';
    case 'INSUFFICIENT_INDEPENDENT_EVIDENCE':
      return 'This concept has not yet been demonstrated independently. Favor prompts that require the student to produce the answer themselves over giving it to them.';
    case 'RETENTION_RISK':
      return 'This was learned before but may now be fading. Ask the student to recall it first, before adding any new instruction.';
    case 'TRANSFER_GAP':
      return 'The student knows this in the context they learned it in, but has not shown they can apply it elsewhere. Frame this toward a new context or application, not a repeat of the original one.';
    case 'LOW_UNDERSTANDING':
    default:
      return 'Build initial understanding of this concept from the ground up.';
  }
}

/**
 * Section 12: `avoidStrategies` is load-bearing here, not merely
 * present on the data structure -- when the primary strategy has
 * already failed twice in a row, the constraint block instructs the AI
 * NOT to use it again, by name, as a primary method.
 */
function strategyInstructionBlock(strategy: TutorStrategy, avoid: TutorStrategy[]): string {
  const base = strategyInstruction(strategy);
  if (avoid.length === 0) return base;
  return `${base} This approach has already been tried repeatedly and has not worked -- do not lead with ${avoid.join(' or ')} as the primary method this time.`;
}

/**
 * Section 6.6 test / general product quality: a closing instruction
 * that keeps every adaptive generation ending in an active check, not
 * passive content consumption (reconciles Phase 5D.5's intent without
 * building a separate "check for understanding" subsystem).
 */
function successCriteriaInstruction(successCriteria: string): string {
  return `Success looks like: ${successCriteria}`;
}

/**
 * The one canonical prompt-insertable text block every live generator
 * uses. Callers ADD this to their existing system prompt -- it never
 * replaces the existing grounding/material block (section 13), and it
 * carries no language of its own (section 14 -- language stays fully
 * separate, handled exactly as each generator already handles it).
 */
export function buildTeachingConstraintsBlock(context: TeachingGenerationContext): string {
  return [
    `ADAPTIVE TEACHING GUIDANCE (why this content is being generated now): ${context.instructionalGoal}`,
    barrierInstruction(context),
    supportLevelInstruction(context.supportLevel),
    strategyInstructionBlock(context.strategy, context.avoidStrategies),
    successCriteriaInstruction(context.successCriteria),
  ].join('\n');
}
