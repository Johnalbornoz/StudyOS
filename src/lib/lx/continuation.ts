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
