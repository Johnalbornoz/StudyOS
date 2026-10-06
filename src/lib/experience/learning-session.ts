/**
 * UX-3 -- the learning-session presentation vocabulary, in one place.
 *
 * Every export here is a pure lookup from an AUTHORITATIVE value (the
 * launched quiz mode, the canonical teaching stages, the server's own
 * result fields) to learner-facing copy or a presentation decision. None
 * of it reads a score, counts attempts, or compares against a threshold,
 * and none of it chooses what the learner does next -- the engine
 * already decided that; this only names it.
 *
 *   activity kind -> `xs.kind.*`  (Entrénalo / Demuéstralo / Aplícalo …)
 *   teaching step -> `xs.teach.*` (Entiéndelo / Míralo paso a paso / Ahora tú)
 *   outcome       -> `xs.outcome.*` from requirement status the SERVER
 *                    reported after the attempt was written
 */
import type { MessageKey } from '@/lib/i18n/messages';

/** The user-facing experiences. Presentation only -- NOT a learning state machine. */
export const ACTIVITY_KINDS = ['check', 'train', 'reinforce', 'prove', 'retain', 'transfer', 'diagnose', 'assess'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * Which experience a launched quiz mode is. The mode itself was chosen
 * by the canonical engine (or by the learner in the legacy manual setup);
 * this never changes it. A Repair Path step is presented as "reinforce".
 */
export function activityKindForMode(mode: string, opts: { remediation?: boolean } = {}): ActivityKind {
  if (opts.remediation) return 'reinforce';
  switch (mode) {
    case 'canonical_learn_check':
      return 'check';
    case 'canonical_prove':
    case 'quick_check':
      return 'prove';
    case 'canonical_retain':
    case 'retention_check':
      return 'retain';
    case 'canonical_transfer':
      return 'transfer';
    case 'diagnostic_check':
      return 'diagnose';
    case 'cumulative_assessment':
    case 'exam_simulation':
      return 'assess';
    default:
      return 'train'; // topic_practice, review
  }
}

/** Independent experiences carry no in-activity help. Mirrors the fixed mode taxonomy the page already renders help from -- never an enforcement point (the server is). */
export function isIndependentKind(kind: ActivityKind): boolean {
  return kind === 'prove' || kind === 'retain' || kind === 'transfer' || kind === 'diagnose' || kind === 'assess';
}

type KindKey = `xs.kind.${ActivityKind}` | `xs.purpose.${ActivityKind}` | `xs.done.${ActivityKind}`;
const _everyKindHasCopy: KindKey extends MessageKey ? true : never = true;
void _everyKindHasCopy;

export const kindLabelKey = (kind: ActivityKind) => `xs.kind.${kind}` as const;
export const kindPurposeKey = (kind: ActivityKind) => `xs.purpose.${kind}` as const;
export const kindDoneKey = (kind: ActivityKind) => `xs.done.${kind}` as const;

/** The canonical teaching stages the intro renders, plus the practice that follows them. */
export const TEACHING_STEPS = ['EXPLAIN', 'MODEL', 'GUIDE', 'PRACTICE'] as const;
export type TeachingStep = (typeof TEACHING_STEPS)[number];
type TeachKey = `xs.teach.${TeachingStep}`;
const _everyTeachingStepHasCopy: TeachKey extends MessageKey ? true : never = true;
void _everyTeachingStepHasCopy;
export const teachingStepKey = (step: TeachingStep) => `xs.teach.${step}` as const;

/**
 * UX-3 (guided-step bypass fix) -- where the "go straight to practice"
 * shortcut on EXPLAIN / MODEL may take the learner.
 *
 * The canonical teaching plan is the authority. EXPLAIN and MODEL have
 * always been skippable reading stages; a GUIDE stage in the plan is a
 * required step ("there is no skip GUIDE" -- LX-4P-PERF-R1E-R1). So the
 * shortcut jumps to the first GUIDE still ahead in the plan, and only
 * ends the teaching phase when no GUIDE remains. It never adds a stage
 * the plan did not contain and never reorders it.
 */
export function teachingSkipTarget(plan: readonly string[], idx: number): { kind: 'STAGE'; index: number } | { kind: 'DONE' } {
  for (let i = idx + 1; i < plan.length; i++) {
    if (plan[i] === 'GUIDE') return { kind: 'STAGE', index: i };
  }
  return { kind: 'DONE' };
}

/** The canonical requirement stage an activity kind produces evidence for. */
const REQUIREMENT_STAGE: Partial<Record<ActivityKind, string>> = {
  check: 'LEARN',
  train: 'PRACTICE',
  prove: 'PROVE',
  retain: 'RETAIN',
  transfer: 'TRANSFER',
};

export type ActivityOutcome = 'MASTERED' | 'SATISFIED' | 'NOT_YET' | 'RECORDED';

export interface ActivityOutcomeInput {
  kind: ActivityKind;
  /** `results.canonicalResultsStatus` -- only 'OK' carries a fresh post-attempt decision. */
  canonicalResultsStatus?: string | null;
  canonicalResults?: { stage?: unknown; requirements?: unknown } | null;
  /** Legacy (non-v1) independent-evidence re-read: `results.proveSufficiency`. */
  proveSufficiency?: { sufficient?: boolean } | null;
  /** `resolveResultMilestone(...)` -- already server-status based (UX-2). */
  milestone?: string | null;
}

function requirementStatus(requirements: unknown, stage: string): string | null {
  if (!Array.isArray(requirements)) return null;
  const r = requirements.find((x) => !!x && typeof x === 'object' && (x as { stage?: unknown }).stage === stage);
  const status = r ? (r as { status?: unknown }).status : null;
  return typeof status === 'string' ? status : null;
}

/**
 * The result headline. Read ONLY from what the server reported after the
 * evidence write:
 *   MASTERED  <- the fresh canonical decision's stage is CONSOLIDATED
 *   SATISFIED <- this activity's own requirement is SATISFIED there, or the
 *                legacy independent-evidence re-read / milestone says so
 *   NOT_YET   <- this activity's own requirement is still UNSATISFIED, or
 *                the legacy re-read explicitly reports it insufficient
 *   RECORDED  <- anything else (no authoritative status, WAITING, an
 *                unavailable re-fetch): a neutral "done", never a verdict
 * A correct-answer count is never an input: correct != mastered.
 */
export function resolveActivityOutcome(input: ActivityOutcomeInput): ActivityOutcome {
  const fresh = input.canonicalResultsStatus === 'OK' ? input.canonicalResults : null;
  if (fresh && fresh.stage === 'CONSOLIDATED') return 'MASTERED';
  const stage = REQUIREMENT_STAGE[input.kind];
  if (fresh && stage) {
    const status = requirementStatus(fresh.requirements, stage);
    if (status === 'SATISFIED') return 'SATISFIED';
    if (status === 'UNSATISFIED') return 'NOT_YET';
    return 'RECORDED';
  }
  if (input.milestone) return 'SATISFIED';
  if (input.proveSufficiency?.sufficient === true) return 'SATISFIED';
  if (input.proveSufficiency?.sufficient === false) return 'NOT_YET';
  return 'RECORDED';
}

type OutcomeKey = `xs.outcome.${ActivityOutcome}`;
const _everyOutcomeHasCopy: OutcomeKey extends MessageKey ? true : never = true;
void _everyOutcomeHasCopy;
export const outcomeKey = (o: ActivityOutcome) => `xs.outcome.${o}` as const;

/**
 * UX-3 (silent submit failure fix) -- a failed submission is never an
 * incorrect answer. Classified only from the transport outcome:
 *   EXPIRED -- the server no longer has this session (QUIZ_NOT_FOUND)
 *   NETWORK -- the request never produced a server response
 *   SERVER  -- any other non-OK response
 */
export type SubmitFailure = 'NETWORK' | 'SERVER' | 'EXPIRED';
export function classifySubmitFailure(input: { status?: number | null; errorCode?: string | null; thrown?: boolean }): SubmitFailure {
  if (input.errorCode === 'QUIZ_NOT_FOUND') return 'EXPIRED';
  // Human Agency P0-2/P0-3: an expired Independent attempt / an expired or unknown
  // Explain & Defend task can never be submitted -- never offer a retry loop.
  if (input.errorCode === 'SESSION_EXPIRED' || input.errorCode === 'TASK_EXPIRED' || input.errorCode === 'TASK_NOT_FOUND') return 'EXPIRED';
  if (input.thrown || !input.status) return 'NETWORK';
  return 'SERVER';
}
type FailureKey = `xs.submitFailed.${SubmitFailure}`;
const _everyFailureHasCopy: FailureKey extends MessageKey ? true : never = true;
void _everyFailureHasCopy;
export const submitFailureKey = (f: SubmitFailure) => `xs.submitFailed.${f}` as const;
