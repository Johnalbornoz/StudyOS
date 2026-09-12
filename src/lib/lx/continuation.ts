/**
 * LX-5 -- LEARNING CONTINUATION (pure).
 *
 * LX-5 owns CONTINUATION, not pedagogical next-action policy. This
 * module carries:
 *   - the small navigation context that says where the learner is in
 *     the experience (`LearningActivityKind`, origin), and
 *   - the pure presentation mapping from a canonically-resolved
 *     continuation into checkpoint copy.
 *
 * It NEVER decides an ActivityType, remediation, retention, transfer,
 * or reads a mastery threshold. The next action always comes from the
 * canonical authority (`learning-continuation.service` -> Phase 4
 * `LearningDecision`, or Phase 8's canonical NOT_STARTED first-touch
 * `bootstrapNotStartedLearningDecision`, launched via
 * `startLearningSession`). "Reading an explanation" is EXPERIENCE
 * PROGRESS, never mastery evidence -- nothing here writes anything.
 */

import type { TeachingExperienceView } from '@/lib/lx/teaching-experience';

export const CONTINUATION_CONTRACT_VERSION = 1 as const;

/**
 * What the learner just finished. Presentation label + which checkpoint
 * copy to show -- never a pedagogical state.
 */
export type LearningActivityKind =
  | 'LEARN'
  | 'PRACTICE'
  | 'PROVE'
  | 'TRANSFER'
  | 'RETAIN'
  | 'REINFORCE';

/**
 * The minimal origin context. The subject/concept ids are enough to
 * return to the Concept Mission; `entry` is only used by Focus Mode
 * Exit to pick a sensible destination. Not persisted, not pedagogical.
 */
export interface LearningOrigin {
  subjectId: string;
  conceptId: string;
  /** Where the learner entered the activity from. Focus Mode Exit reads this. */
  entry: 'CONCEPT_MISSION' | 'TODAY' | 'UNKNOWN';
}

/**
 * The canonically-resolved continuation (from
 * `learning-continuation.service.resolveContinuation`). The UI presents
 * exactly one of these; it never computes the choice.
 */
export type ContinuationResolution =
  | {
      status: 'LAUNCH';
      /** From `startLearningSession(...).launchTarget` -- a real route. */
      launchTarget: string;
      /** The canonical ActivityType being launched (Phase 4 decision, or Phase 8 first-touch PRACTICE). Display only. */
      activityType: string;
      /** Which canonical authority produced it. Auditable. */
      source: 'PHASE_4_DECISION' | 'CURRICULUM_FIRST_TOUCH';
      /**
       * LX-4P-PERF-R1C C12 -- decision de-duplication for the
       * Continue -> teaching-launch handoff. The canonical derived
       * Teaching Experience for the concept being launched, computed ONCE
       * here from the SAME canonical `TeachingIntent` +
       * `deriveTeachingExperience` that `/api/learning/teaching-intent`
       * would otherwise recompute on the quiz page. The client only
       * TRANSPORTS this value to the launch (it never derives it) and
       * always re-validates it (same concept + mode, fresh, structurally
       * intact) before use, falling back to the canonical
       * `/api/learning/teaching-intent` fetch when it is absent, stale,
       * or mismatched. `null` when there is no single concept to teach or
       * the intent was unavailable -- the client then resolves it
       * canonically, exactly as before this optimisation.
       */
      teachingExperience?: TeachingExperienceView | null;
    }
  | {
      /** No canonical next action -- return to the Concept Mission with an honest "nothing to do right now" state. */
      status: 'RETURN_TO_MISSION';
      reason:
        | 'NO_CANONICAL_ACTION'
        | 'DECISION_UNAVAILABLE'
        | 'RESOLVE_FAILED';
    };

export interface ContinuationCheckpoint {
  /** i18n key for the "what just happened" headline. */
  headlineKey: string;
  /** i18n key for the one-line body. */
  bodyKey: string;
  /** i18n key for the primary continue button. */
  continueKey: string;
}

/** Pure. Checkpoint copy keys per finished-activity kind. Copy itself is i18n. */
export function checkpointFor(kind: LearningActivityKind): ContinuationCheckpoint {
  switch (kind) {
    case 'LEARN':
      return {
        headlineKey: 'continuation.learn.headline',
        bodyKey: 'continuation.learn.body',
        continueKey: 'continuation.learn.continue',
      };
    case 'PRACTICE':
      return {
        headlineKey: 'continuation.practice.headline',
        bodyKey: 'continuation.practice.body',
        continueKey: 'continuation.continue',
      };
    case 'PROVE':
      return {
        headlineKey: 'continuation.prove.headline',
        bodyKey: 'continuation.prove.body',
        continueKey: 'continuation.continue',
      };
    case 'TRANSFER':
      return {
        headlineKey: 'continuation.transfer.headline',
        bodyKey: 'continuation.transfer.body',
        continueKey: 'continuation.continue',
      };
    case 'RETAIN':
      return {
        headlineKey: 'continuation.retain.headline',
        bodyKey: 'continuation.retain.body',
        continueKey: 'continuation.continue',
      };
    case 'REINFORCE':
      return {
        headlineKey: 'continuation.reinforce.headline',
        bodyKey: 'continuation.reinforce.body',
        continueKey: 'continuation.reinforce.continue',
      };
  }
}

/** The concept-mission route -- the canonical "return" destination. */
export function conceptMissionPath(origin: Pick<LearningOrigin, 'subjectId' | 'conceptId'>): string {
  return `/dashboard/subjects/${origin.subjectId}/concepts/${origin.conceptId}`;
}

/**
 * LX-5R1 -- a canonical `LAUNCH` may legitimately point at the SAME route
 * the learner is already on (e.g. PRACTICE -> PRACTICE for the same
 * concept/mode). Pushing an identical URL is a no-op in the Next.js App
 * Router -- no navigation fires, so the destination page never gets a
 * chance to start a fresh activity instance. This query param carries a
 * one-shot nonce that makes such a relaunch a genuine navigation without
 * changing what is being launched -- the destination page's OWN
 * searchParams (subjectId/conceptId/mode/...) are untouched; it only
 * uses this value to key a full remount. Never a routing/pedagogical
 * signal on its own.
 */
export const RELAUNCH_NONCE_PARAM = 'relaunch';

/** Pure, collision-cheap nonce -- not a security token, just "different every call". */
export function newRelaunchNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * True when `a` and `b` resolve to the same pathname and the same set of
 * query parameters, IGNORING `RELAUNCH_NONCE_PARAM` on either side (so a
 * learner who already relaunched once, carrying an old nonce in the
 * current URL, is still correctly compared against a fresh server
 * `launchTarget` that never has one).
 */
export function isSameRoute(currentUrl: string, targetUrl: string, base = 'http://lx.invalid'): boolean {
  let a: URL, b: URL;
  try {
    a = new URL(currentUrl, base);
    b = new URL(targetUrl, base);
  } catch {
    return false; // unparsable -- never claim same-route, let normal navigation proceed
  }
  if (a.pathname !== b.pathname) return false;
  const strip = (u: URL) => {
    const p = new URLSearchParams(u.searchParams);
    p.delete(RELAUNCH_NONCE_PARAM);
    return [...p.entries()].sort(([k1], [k2]) => k1.localeCompare(k2));
  };
  const aEntries = strip(a);
  const bEntries = strip(b);
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([k, v], i) => k === bEntries[i][0] && v === bEntries[i][1]);
}

/**
 * The navigation target `ContinuationPanel` should actually push: the
 * server's `launchTarget` unchanged for a normal (different-route)
 * navigation, or `launchTarget` with a fresh relaunch nonce appended when
 * it is route-equivalent to `currentUrl` -- the smallest change that
 * turns a would-be no-op push into a real one. Never alters the
 * destination's own concept/mode/query semantics; on any parse failure,
 * degrades to the raw `launchTarget` (still navigable, just not
 * guaranteed to force a remount) rather than throwing.
 */
export function buildRelaunchTarget(currentUrl: string, launchTarget: string, nonce: string = newRelaunchNonce()): string {
  try {
    if (!isSameRoute(currentUrl, launchTarget)) return launchTarget;
    const u = new URL(launchTarget, 'http://lx.invalid');
    u.searchParams.set(RELAUNCH_NONCE_PARAM, nonce);
    return `${u.pathname}?${u.searchParams.toString()}`;
  } catch {
    return launchTarget;
  }
}
