/**
 * LX-9R9 -- the ONE shared model/reasoning-effort compatibility
 * authority. Every capability, budget, and provider adapter reads
 * reasoning-effort SUPPORT from here; no caller invents its own
 * per-model assumption.
 *
 * LIVE ROOT CAUSE: a `quick_check` request to gpt-5.6-luna failed with
 * HTTP 400 `unsupported_value` on `reasoning_effort: 'minimal'` --
 * `question_generation_slot`'s configured budget. The provider's own
 * error named the model's actual supported set: 'none', 'low',
 * 'medium', 'high', 'xhigh'. `'minimal'` was never a value any routed
 * model accepts -- StudyUS invented it locally and never validated it
 * against what the provider actually supports.
 *
 * `ReasoningEffort` is now the CANONICAL type used everywhere
 * (TokenBudget / CallModelParams / OpenAIChatParams) -- 'minimal' is no
 * longer a member, so a NEW budget cannot reintroduce this defect and
 * still typecheck. `resolveReasoningEffort` is the RUNTIME defense in
 * depth on top of that: it validates whatever value actually reaches
 * the provider boundary against the SPECIFIC model being called (never
 * a global assumption), normalizes a known-safe legacy alias if one
 * exists, and fails BEFORE any provider call when no safe mapping
 * exists -- so an incompatibility is never discovered by spending a
 * request.
 */
import { LUNA, TERRA } from './model-routing';

/** The canonical reasoning-effort vocabulary every StudyUS budget/call site may declare. Matches the gpt-5.6 family's own documented supported values. */
export const REASONING_EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number];

/**
 * Known-safe normalization for a value StudyUS code might still carry
 * that is not itself a canonical `ReasoningEffort` (e.g. a stray
 * `'minimal'` from before this phase, or copied from another provider's
 * vocabulary). Used ONLY as a defense-in-depth fallback when the
 * requested value isn't already supported by the target model -- the
 * canonical fix is always to configure a valid `ReasoningEffort` at the
 * source (token-budgets.ts), never to rely on this alias table.
 *
 * `'minimal'` -> `'none'`: `question_generation_slot` (quick_check's
 * single-slot budget), `contextual_help`, and `question_localization`
 * were all configured with `'minimal'`, chosen for low latency/cost on
 * a purpose that does not need deep chain reasoning (quick_check's
 * quality is independently protected by the Question Quality Gate,
 * never by generation-time reasoning depth). `'none'` is the LOWEST
 * effort gpt-5.6 actually supports, so it is the closest available
 * value to the original "spend as little reasoning as possible" intent
 * -- never `'low'`, which would silently spend MORE than intended.
 */
const LEGACY_REASONING_EFFORT_ALIASES: Readonly<Record<string, ReasoningEffort>> = {
  minimal: 'none',
};

/**
 * Every reachable model's actual supported reasoning-effort set.
 * Luna and Terra are both gpt-5.6-family models and share the SAME
 * supported set -- verified structurally here (not assumed) so a
 * capability whose canonical fallback differs from its primary (e.g.
 * QUESTION_GENERATION: Luna -> Terra) can never end up with an effort
 * the primary accepts but the fallback rejects, or vice versa (PART F).
 * An unregistered model has NO entry -- `resolveReasoningEffort` fails
 * closed rather than assuming compatibility for a model no one has
 * verified.
 */
const SUPPORTED_REASONING_EFFORTS_BY_MODEL: Readonly<Record<string, ReadonlySet<ReasoningEffort>>> = {
  [LUNA]: new Set(REASONING_EFFORT_LEVELS),
  [TERRA]: new Set(REASONING_EFFORT_LEVELS),
};

export type ReasoningEffortResolution =
  | { status: 'UNCHANGED'; value: ReasoningEffort | undefined }
  | { status: 'NORMALIZED'; value: ReasoningEffort; requestedValue: string; reason: string }
  | { status: 'UNRESOLVABLE'; requestedValue: string; reason: string };

/**
 * Pure, deterministic. `undefined` (no effort requested) always resolves
 * UNCHANGED -- omitting the parameter is always safe. A value already in
 * the target model's supported set resolves UNCHANGED verbatim (the
 * common, intended case after PART D's budget fix). A value with a
 * known-safe alias for that model resolves NORMALIZED. Anything else --
 * including a value for a model this module has no registered
 * compatibility entry for -- resolves UNRESOLVABLE: the caller must fail
 * before making a provider request, never guess.
 */
export function resolveReasoningEffort(params: {
  model: string;
  requestedEffort: string | undefined;
}): ReasoningEffortResolution {
  const { model, requestedEffort } = params;
  if (requestedEffort === undefined) return { status: 'UNCHANGED', value: undefined };

  const supported = SUPPORTED_REASONING_EFFORTS_BY_MODEL[model];
  if (!supported) {
    return {
      status: 'UNRESOLVABLE',
      requestedValue: requestedEffort,
      reason: `model "${model}" has no registered reasoning-effort compatibility entry -- register its supported set in model-compatibility.ts before using reasoningEffort with it`,
    };
  }

  if (supported.has(requestedEffort as ReasoningEffort)) {
    return { status: 'UNCHANGED', value: requestedEffort as ReasoningEffort };
  }

  const alias = LEGACY_REASONING_EFFORT_ALIASES[requestedEffort];
  if (alias && supported.has(alias)) {
    return {
      status: 'NORMALIZED',
      value: alias,
      requestedValue: requestedEffort,
      reason: `"${requestedEffort}" is not supported by ${model}; normalized to the nearest safe canonical equivalent "${alias}"`,
    };
  }

  return {
    status: 'UNRESOLVABLE',
    requestedValue: requestedEffort,
    reason: `"${requestedEffort}" is not supported by ${model} and has no known safe equivalent (model supports: ${[...supported].join(', ')})`,
  };
}

/** Safe, structured line for a NORMALIZED resolution -- never throws, logging must never break generation. */
export function logReasoningEffortCompat(model: string, resolution: Extract<ReasoningEffortResolution, { status: 'NORMALIZED' }>): void {
  try {
    // eslint-disable-next-line no-console
    console.log('[ai-model-compat]', JSON.stringify({
      model,
      parameter: 'reasoning_effort',
      requestedValue: resolution.requestedValue,
      effectiveValue: resolution.value,
      reason: resolution.reason,
    }));
  } catch { /* logging must never break generation */ }
}
