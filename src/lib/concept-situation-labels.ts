import type { getMessages } from '@/lib/i18n/messages';
import type { MasteryState, ValidationReadiness } from '@/services/knowledge-state.service';
import type { MemoryStatus } from '@/lib/memory-policy';

/**
 * Step 6L-A: one plain-language "where am I / what's next" situation
 * label per concept, derived ONLY from canonical, already-computed
 * backend state (Phase 2's masteryState/validationReadiness, Phase 6's
 * memoryStatus) -- exactly like masteryStateLabel/activityLabel above
 * it, this is a presentation mapping, never a new academic-truth model
 * or a second decision engine. It cannot independently classify a
 * concept: it only routes an already-canonical (masteryState,
 * validationReadiness, memoryStatus) triple to one of seven fixed
 * labels.
 *
 * `memoryStatus` is `null` when no concept_memory_state row exists yet
 * (never fabricated as NOT_ESTABLISHED -- the caller passes null
 * exactly when Phase 6 has nothing to say yet, e.g. ConceptView.memory
 * being absent entirely upstream never happens in practice since the
 * Twin always returns a MemorySignal, but this stays defensive).
 */
export type ConceptSituation =
  | 'LEARNING'
  | 'NEEDS_REINFORCEMENT'
  | 'READY_TO_VERIFY'
  | 'RETENTION_PENDING'
  | 'SOLID'
  | 'SHOULD_REVIEW'
  | 'READY_TO_APPLY';

export function conceptSituation(
  masteryState: MasteryState,
  validationReadiness: ValidationReadiness,
  memoryStatus: MemoryStatus | null
): ConceptSituation {
  // A real, evidenced difficulty (decayed or unresolved) always wins --
  // this is the one case that should never be masked by a "ready to
  // verify"/"solid" reading of some other dimension.
  if (masteryState === 'AT_RISK' || masteryState === 'INTERVENTION_REQUIRED') return 'NEEDS_REINFORCEMENT';

  if (masteryState === 'LEARNING') return 'LEARNING';

  // Phase 2's own gate already says a genuine retention proof is the
  // one thing missing -- never re-derived from memoryStatus here.
  if (validationReadiness === 'WAITING_FOR_RETENTION') return 'RETENTION_PENDING';
  if (validationReadiness === 'TRANSFER_REQUIRED') return 'READY_TO_APPLY';

  if (masteryState === 'VALIDATED_MASTERY') {
    return memoryStatus === 'AT_RISK' ? 'SHOULD_REVIEW' : 'SOLID';
  }

  // DEVELOPING / PROVISIONAL_MASTERY (and UNKNOWN, though the caller
  // never has canonical state to pass in that case at all): performing
  // but not yet independently/validated-proven.
  return 'READY_TO_VERIFY';
}

export function conceptSituationLabel(situation: ConceptSituation, t: ReturnType<typeof getMessages>): string {
  return t[`conceptSituation.${situation}` as keyof typeof t];
}
