/**
 * CANON-R5 Parts 15-19/33/34 -- WHICH v1 activity contracts the EXISTING
 * generation infrastructure (`/api/quizzes/generate-and-take`,
 * `quiz-generation.service.ts`) can actually honor TODAY, without any
 * change to AI routing, providers, prompt construction, or performance
 * work (this phase's own firewall, Part 30). This is a closed,
 * documented, auditable boundary -- never a guess -- grounded in direct
 * inspection of the real generation route:
 *
 *   PRACTICE (2-3 items, difficulty 2-4, assisted): READY. `topic_practice`
 *     / `review` (`QUIZ_MODE_CONFIG`, generate-and-take/route.ts) already
 *     accept a caller-supplied `maxQuestions` (1-20) and `difficulty`
 *     (1-5) that OVERRIDE the mode's own `defaultMax` -- the frozen v1
 *     Practice contract fits inside that existing, unmodified surface
 *     exactly, with no new generation code.
 *
 *   REINFORCE (same 2-3 items shape as Practice, per
 *     `activity-contract.ts`'s own `buildActivityContract`): READY, for
 *     the identical reason as PRACTICE above.
 *
 *   PROVE (exactly 10 items, independent, no hints/tutor/worked
 *     examples): NOT READY. The real independent-evidence analog,
 *     `quick_check`, has a fixed `defaultMax: 6`
 *     (generate-and-take/route.ts's `QUIZ_MODE_CONFIG`) with no
 *     documented, reviewed path to force exactly 10 without either
 *     changing that shared config (which would also change quick_check's
 *     behavior for every OTHER, non-v1 caller) or adding a new
 *     quiz_mode -- out of scope for this phase's own AI/generation
 *     firewall (Part 30).
 *
 *   RETENTION_CHECK (exactly 10 NEW items, independent, 3-day wait):
 *     NOT READY. `RETENTION_REQUIRED_COUNT` (quiz-generation.service.ts)
 *     is hardcoded to 6, and is itself the exact trigger condition
 *     generate-and-take/route.ts uses to invoke the specialized,
 *     novelty-aware `generateRetentionCheckQuestions` function
 *     (`quizMode === 'retention_check' && maxQuestions === RETENTION_REQUIRED_COUNT`)
 *     -- simply passing `maxQuestions: 10` would silently SKIP that
 *     novelty-aware generator instead of producing 10 novel items,
 *     which would be worse than refusing to launch.
 *
 *   TRANSFER (3 structured challenges: NEAR/CONTEXTUAL/HIGHER, with
 *     per-challenge scores): NOT READY. Real Transfer evidence is
 *     recorded per individual task (`transfer_task_instances`), never as
 *     3 challenges administered together (confirmed by CANON-R3's own
 *     evidence-adapter audit, `TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE`)
 *     -- exactly the case Part 33 anticipates: "If current generation
 *     system cannot yet produce this structure: return
 *     V1_TRANSFER_GENERATION_NOT_READY and STOP."
 *
 *   LEARN_CHECK (a dedicated LEARN comprehension checkpoint, >80%): NOT
 *     READY for a genuinely POST-CUTOVER concept -- StudyUS has no
 *     quiz_mode or ActivityType representing this today (confirmed by
 *     CANON-R3's own adapter audit: `LEARN_CHECK_SOURCE_UNAVAILABLE`).
 *     Per Part 34, this never blocks a MIGRATED preexisting concept
 *     (those already carry a LEARN recognition and start at PRACTICE or
 *     later -- see the live-verified Preview cases), only a future
 *     concept that would need to demonstrate LEARN from scratch.
 *
 * Pure: no IO, no DB, no AI call. A closed, total function over the
 * engine's own `PedagogicalActivityType` -- extending it to a sixth
 * value is a compile error here until this module is updated.
 */
import type { PedagogicalActivityType } from '@/lib/pedagogical-engine';

export type V1ActivityNotReadyReason =
  | 'V1_LEARN_CHECK_GENERATION_NOT_READY'
  | 'V1_PROVE_GENERATION_NOT_READY'
  | 'V1_RETENTION_GENERATION_NOT_READY'
  | 'V1_TRANSFER_GENERATION_NOT_READY';

export type V1ActivityLaunchReadiness =
  | { ready: true }
  | { ready: false; reason: V1ActivityNotReadyReason; detail: string };

export function resolveV1ActivityLaunchReadiness(activityType: PedagogicalActivityType | 'REINFORCE'): V1ActivityLaunchReadiness {
  switch (activityType) {
    case 'PRACTICE':
    case 'REINFORCE':
      return { ready: true };
    case 'LEARN_CHECK':
      return {
        ready: false,
        reason: 'V1_LEARN_CHECK_GENERATION_NOT_READY',
        detail: 'StudyUS has no quiz_mode or ActivityType producing a dedicated LEARN comprehension checkpoint today (CANON-R3 adapter audit: LEARN_CHECK_SOURCE_UNAVAILABLE).',
      };
    case 'PROVE':
      return {
        ready: false,
        reason: 'V1_PROVE_GENERATION_NOT_READY',
        detail: "quick_check's real generation contract is fixed at 6 items (QUIZ_MODE_CONFIG.quick_check.defaultMax, generate-and-take/route.ts) -- the frozen v1 Prove contract requires exactly 10.",
      };
    case 'RETENTION_CHECK':
      return {
        ready: false,
        reason: 'V1_RETENTION_GENERATION_NOT_READY',
        detail: 'RETENTION_REQUIRED_COUNT (quiz-generation.service.ts) is hardcoded to 6 and gates the specialized novelty-aware retention generator -- the frozen v1 Retention contract requires exactly 10 novel items.',
      };
    case 'TRANSFER':
      return {
        ready: false,
        reason: 'V1_TRANSFER_GENERATION_NOT_READY',
        detail: 'Real Transfer evidence is recorded per individual task (transfer_task_instances), never as 3 structured NEAR/CONTEXTUAL/HIGHER challenges administered together (CANON-R3 adapter audit: TRANSFER_CHALLENGE_BREAKDOWN_UNAVAILABLE).',
      };
    default: {
      const _exhaustive: never = activityType;
      return _exhaustive;
    }
  }
}
