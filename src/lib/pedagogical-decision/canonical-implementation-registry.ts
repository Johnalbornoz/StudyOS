/**
 * CANON-V2-ARCH-CLEANUP -- THE ONE CANONICAL ACTIVITY IMPLEMENTATION
 * REGISTRY.
 *
 * Replaces scattered readiness/launch branching (activity-launch-readiness.ts's
 * own pre-cleanup NOT_READY reasons, canonical-session-launch.ts's own
 * ad hoc `v1QuizModeForActivityType` switch) with ONE explicit, typed,
 * total mapping from a canonical `PedagogicalActivityType` to the
 * concrete server-only quiz mode that implements it.
 *
 * INVARIANT (Section 1/7 of this phase's own spec): every Policy V2
 * canonical stage has a real, server-authorized, executable
 * implementation. `CANONICAL_IMPLEMENTATION_REGISTRY` is therefore
 * TOTAL over `PedagogicalActivityType | 'REINFORCE'` -- there is no
 * legitimately-reachable canonical activity this registry does not
 * resolve. A lookup miss is not a learner runtime state; it is an
 * impossible configuration (see `resolveCanonicalImplementation`'s own
 * doc comment) -- exactly what Section 7 calls a
 * `CANONICAL_IMPLEMENTATION_MISSING` certification failure, never a
 * normal `NOT_READY` product state.
 *
 * REINFORCE is NOT a canonical stage implementation of its own -- it is
 * an overlay/context applied to the underlying PRACTICE activity
 * (Policy V2 Section 1/12), so it resolves to the exact same
 * `implementationId`/`quizMode` as PRACTICE itself.
 */
import type { PedagogicalActivityType } from '@/lib/pedagogical-engine';

/** The concrete, server-only quiz mode each canonical implementation actually launches through generate-and-take. */
export type CanonicalQuizMode =
  | 'topic_practice'
  | 'canonical_prove'
  | 'canonical_retain'
  | 'canonical_transfer'
  | 'canonical_learn_check';

export interface CanonicalImplementationEntry {
  activityType: PedagogicalActivityType | 'REINFORCE';
  /** A stable, documented identifier for THIS implementation -- never guessed or reconstructed from a mode string at a call site. */
  implementationId: string;
  /** Bumped whenever this implementation's own contract (item count, difficulty range, response contract) changes in a way a consumer should be able to distinguish. */
  contractVersion: string;
  quizMode: CanonicalQuizMode;
}

/**
 * THE registry. Every key is a real, implemented, executable canonical
 * activity -- adding a new `PedagogicalActivityType` value is a compile
 * error here until this map is updated (see the exhaustiveness check
 * below), so this can never silently drift out of sync with the pure
 * engine's own vocabulary.
 */
const REGISTRY: Record<PedagogicalActivityType | 'REINFORCE', CanonicalImplementationEntry> = {
  LEARN_CHECK: { activityType: 'LEARN_CHECK', implementationId: 'canonical_learn_check', contractVersion: 'v1', quizMode: 'canonical_learn_check' },
  PRACTICE: { activityType: 'PRACTICE', implementationId: 'canonical_practice', contractVersion: 'v1', quizMode: 'topic_practice' },
  // REINFORCE is an overlay on PRACTICE, never a separate implementation.
  REINFORCE: { activityType: 'REINFORCE', implementationId: 'canonical_practice', contractVersion: 'v1', quizMode: 'topic_practice' },
  PROVE: { activityType: 'PROVE', implementationId: 'canonical_prove', contractVersion: 'v1', quizMode: 'canonical_prove' },
  RETENTION_CHECK: { activityType: 'RETENTION_CHECK', implementationId: 'canonical_retain', contractVersion: 'v1', quizMode: 'canonical_retain' },
  TRANSFER: { activityType: 'TRANSFER', implementationId: 'canonical_transfer', contractVersion: 'v1', quizMode: 'canonical_transfer' },
};

/**
 * THE ONE place any caller resolves "which concrete implementation
 * executes this canonical activity type." Total by construction (see
 * `REGISTRY` above) -- for every real `PedagogicalActivityType |
 * 'REINFORCE'` value the pure engine can ever produce, this returns a
 * real entry. It can still return `null` only for a value OUTSIDE that
 * closed union (impossible at the type level for a caller passing a
 * genuine `PedagogicalActivityType`) -- callers must treat a `null`
 * result as `CANONICAL_IMPLEMENTATION_MISSING`: an engineering
 * configuration error, fail closed, impossible in a certified build,
 * never a learner-facing "not ready yet" state.
 */
export function resolveCanonicalImplementation(activityType: PedagogicalActivityType | 'REINFORCE'): CanonicalImplementationEntry | null {
  return REGISTRY[activityType] ?? null;
}

/** Every registry entry, for certification tests that must prove the registry is exhaustive over the engine's own vocabulary. */
export function listCanonicalImplementations(): CanonicalImplementationEntry[] {
  return Object.values(REGISTRY);
}
