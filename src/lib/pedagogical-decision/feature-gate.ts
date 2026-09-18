/**
 * CANON-R5 Part 4, PROD-PROMOTION Section 7 -- THE ONE
 * canonical-engine-v1 feature gate.
 *
 * `isCanonicalEngineV1Enabled` is the single place any learner-facing
 * code may ask "does Pedagogical Engine v1 have next-action authority
 * right now?" ONE explicit, human-set configuration value decides it,
 * uniformly across every environment:
 *
 *   `CANONICAL_ENGINE_V1_ENABLED === 'true'` (the exact string) ->
 *   enabled. Absence, `'false'`, or any other string (`'1'`, `'yes'`,
 *   mixed case, ...) all resolve to disabled -- there is no implicit
 *   "on by default" state, in Production or anywhere else.
 *
 * PROD-PROMOTION Section 7: during Preview certification, this
 * function additionally hard-disabled the gate whenever
 * `VERCEL_ENV === 'production'`, regardless of the flag -- an
 * intentional, temporary interlock while Canonical V2 had never been
 * exercised outside Preview. Production promotion is the explicitly
 * planned next phase that interlock existed for: it is removed here so
 * `CANONICAL_ENGINE_V1_ENABLED` becomes the SAME explicit opt-in in
 * every environment, AND the one emergency rollback switch --
 * un-setting it (or setting it to anything other than `'true'`) in
 * Production instantly reverts every learner-facing surface to the
 * legacy pipeline, with no deploy required. This is a deliberate
 * config-only activation model, not an implicit environment-based one:
 * Production does not enable Canonical V2 by merely being Production,
 * nor does Preview/dev disable it by merely being non-Production --
 * the exact string check is the only thing that matters, everywhere.
 *
 * `env` no longer needs to be read here at all (kept only for the
 * existing testable-injection signature -- `VERCEL_ENV` may still be
 * passed by a caller, it is simply not consulted by this function
 * anymore).
 */
export function isCanonicalEngineV1Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CANONICAL_ENGINE_V1_ENABLED === 'true';
}
