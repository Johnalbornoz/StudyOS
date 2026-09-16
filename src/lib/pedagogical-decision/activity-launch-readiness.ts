/**
 * CANON-R5/R6/CANON-V2-ARCH-CLEANUP -- WHICH v1 activity contracts the
 * EXISTING generation infrastructure can actually honor.
 *
 * CANON-V2-ARCH-CLEANUP (Section 1/2/7 of this phase's own spec):
 * "NOT_READY must NOT be part of the normal canonical learner journey."
 * Every Policy V2 canonical stage (LEARN_CHECK, PRACTICE, PROVE,
 * RETENTION_CHECK, TRANSFER) now has a real, executable implementation
 * -- see `canonical-implementation-registry.ts`, the single source of
 * truth this function now delegates to entirely. `V1ActivityNotReadyReason`
 * / the `ready: false` branch are PRESERVED ONLY as an impossible-
 * configuration defensive check (`CANONICAL_IMPLEMENTATION_MISSING`):
 * a certification/build failure, never a normal learner runtime state.
 * No legitimately-reachable Policy V2 activity type can ever produce
 * `ready: false` today -- see the required certification test in
 * `tests/unit/canon-v2-architecture-cleanup.test.ts` proving exactly
 * that, for every value of `PedagogicalActivityType | 'REINFORCE'`.
 *
 * Historical grounding (why each implementation exists) now lives on
 * `canonical-implementation-registry.ts`'s own entries and the
 * dedicated generation services themselves
 * (`canonical-prove-generation.service.ts`,
 * `canonical-retain-generation.service.ts`,
 * `canonical-transfer-generation.service.ts`,
 * `canonical-learn-check-generation.service.ts`) -- this module is now
 * a thin, pure adapter, not a second source of truth.
 */
import type { PedagogicalActivityType } from '@/lib/pedagogical-engine';
import { resolveCanonicalImplementation } from './canonical-implementation-registry';

/**
 * Preserved as a closed, single-member vocabulary for the impossible-
 * configuration case only -- never a real learner-facing reason today.
 * The 3 legacy NOT_READY reasons this phase closed
 * (`V1_LEARN_CHECK_GENERATION_NOT_READY`, `V1_RETENTION_GENERATION_NOT_READY`,
 * `V1_TRANSFER_GENERATION_NOT_READY`) have been removed -- their
 * implementations now exist.
 */
export type V1ActivityNotReadyReason = 'CANONICAL_IMPLEMENTATION_MISSING';

export type V1ActivityLaunchReadiness =
  | { ready: true }
  | { ready: false; reason: V1ActivityNotReadyReason; detail: string };

export function resolveV1ActivityLaunchReadiness(activityType: PedagogicalActivityType | 'REINFORCE'): V1ActivityLaunchReadiness {
  const implementation = resolveCanonicalImplementation(activityType);
  if (implementation) return { ready: true };
  // Unreachable for any genuine PedagogicalActivityType | 'REINFORCE'
  // value (the registry is total over that exact union) -- this branch
  // exists purely as a fail-closed defensive backstop against a future
  // engine extension that adds a stage before its implementation is
  // registered. Never a normal learner state.
  return {
    ready: false,
    reason: 'CANONICAL_IMPLEMENTATION_MISSING',
    detail: `No canonical implementation is registered for activity type "${activityType}" -- this is an engineering configuration error, not a learner runtime state. Add an entry to canonical-implementation-registry.ts before this stage can ever be reachable.`,
  };
}
