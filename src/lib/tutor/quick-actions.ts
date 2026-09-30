/**
 * UX-5 -- Tutor quick actions.
 *
 * A quick action is a REQUEST FOR A DIFFERENT REPRESENTATION of help --
 * never an engine decision. "Vamos paso a paso" changes how the Tutor
 * explains; it does not create a Guided state, launch an activity or touch
 * progression. The server maps each action to one fixed instruction (the
 * client never sends instruction text).
 */
import type { TutorSupportPolicy } from './context-pack';

export const TUTOR_ACTIONS = ['EXPLAIN_DIFFERENTLY', 'EXAMPLE', 'STEP_BY_STEP', 'SHOW_ME', 'WHY', 'FIND_VIDEO'] as const;
export type TutorAction = (typeof TUTOR_ACTIONS)[number];
/** Actions answered by the chat model (FIND_VIDEO goes through the video gates instead). */
export type ChatAction = Exclude<TutorAction, 'FIND_VIDEO'>;

export function isTutorAction(v: unknown): v is TutorAction {
  return typeof v === 'string' && (TUTOR_ACTIONS as readonly string[]).includes(v);
}

/** Fixed, server-side instructions. The Student's visible message is the localized action label. */
export const ACTION_INSTRUCTION: Record<ChatAction, string> = {
  EXPLAIN_DIFFERENTLY: 'Explain the most recent idea again with a different approach (a simpler wording or an analogy). Keep it short.',
  EXAMPLE: 'Give ONE short, concrete example of the idea. Do not solve a problem from an activity the student is currently being evaluated on.',
  STEP_BY_STEP: 'Walk through it step by step. Show one step at a time and invite the student to try the next step themselves instead of finishing everything for them.',
  SHOW_ME: 'The student explicitly asked to SEE it: include exactly ONE visual block -- a function-plot for how two quantities relate (e.g. a direct proportion y = kx), or a studyus-visual (fraction-bars / number-line) -- plus one or two sentences reading the visual. Only if none of these can represent the idea, say in one sentence that a picture would not help here and explain in words.',
  WHY: 'Explain briefly WHY it works -- the underlying reason, not a procedure.',
};

export interface ActionAvailability {
  policy: TutorSupportPolicy;
  /** A concept context exists (actions can refer to it before any message). */
  hasConcept: boolean;
  /** At least one Tutor reply exists in this conversation (actions can refer to "the last idea"). */
  hasReply: boolean;
  /** The trusted-video integration is configured (API key + at least one approved source). */
  videoEnabled: boolean;
}

/** Which quick actions to show. Never any while help is restricted. */
export function availableActions(a: ActionAvailability): TutorAction[] {
  if (a.policy !== 'OPEN') return [];
  const video: TutorAction[] = a.videoEnabled && (a.hasConcept || a.hasReply) ? ['FIND_VIDEO'] : [];
  if (a.hasReply) return ['EXPLAIN_DIFFERENTLY', 'EXAMPLE', 'STEP_BY_STEP', 'SHOW_ME', 'WHY', ...video];
  if (a.hasConcept) return ['EXAMPLE', 'STEP_BY_STEP', 'SHOW_ME', ...video];
  return [];
}
