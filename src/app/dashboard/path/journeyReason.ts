import type { ConceptJourney } from '@/lib/lx/concept-journey';
import type { getMessages } from '@/lib/i18n/messages';

/**
 * LX-7 R6/R10-R13/R21 -- a short, calm, qualitative "why this stage"
 * sentence for a concept that does NOT currently have its own active
 * `LearningDecision` (the vast majority of concepts in a subject). For
 * the ONE concept that does have an active decision (My Path's current
 * position, same as Today's), callers reuse `activityNarrative`/
 * `WhyThisV3` directly instead of this module -- those already carry
 * the richer, decision-specific explanation LX-6/LX-6R1 established.
 *
 * Pure `ConceptJourney -> string` lookup keyed only on discrete stage/
 * overlay/consolidated flags -- never a raw score, percentage, or
 * threshold (LX-6R1 invariant extended to My Path).
 */
export function journeyReason(journey: ConceptJourney, t: ReturnType<typeof getMessages>): string {
  if (journey.intervention) return t['myPathReason.intervention'];
  if (journey.consolidated) return t['myPathReason.consolidated'];
  switch (journey.currentStage) {
    case 'LEARN':
      return t['myPathReason.learn'];
    case 'PRACTICE':
      return t['myPathReason.practice'];
    case 'PROVE':
      return t['myPathReason.prove'];
    case 'RETAIN':
      return t['myPathReason.retainCurrent'];
    case 'TRANSFER':
      return t['myPathReason.transferCurrent'];
    default:
      return t['myPathReason.consolidated'];
  }
}
