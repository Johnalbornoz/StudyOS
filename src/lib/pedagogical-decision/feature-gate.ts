/**
 * CANON-R5 Part 4 -- THE ONE canonical-engine-v1 feature gate.
 *
 * `isCanonicalEngineV1Enabled` is the single place any learner-facing
 * code may ask "does Pedagogical Engine v1 have next-action authority
 * right now?" Two independent conditions, both required:
 *
 *   1. `CANONICAL_ENGINE_V1_ENABLED === 'true'` -- an explicit,
 *      human-set configuration value. Absence, `'false'`, or any other
 *      string all resolve to disabled -- there is no implicit "on by
 *      default" state.
 *   2. `VERCEL_ENV !== 'production'` -- a HARD safety interlock that
 *      cannot be overridden by the config value above. Even if
 *      `CANONICAL_ENGINE_V1_ENABLED=true` were ever set on a Production
 *      deployment (misconfiguration, a copied .env, a bad rollout), this
 *      function still returns `false` there. Part 4's own instruction --
 *      "Do not infer environment from hostname only" -- is honored by
 *      using Vercel's own documented, non-guessable `VERCEL_ENV`
 *      enum (`'production' | 'preview' | 'development'`), never a
 *      hostname substring match.
 *
 * This is a DIFFERENT read of `VERCEL_ENV` than `deployment-version.ts`'s
 * `buildDeploymentVersion` -- that module is explicitly "OPERATIONAL
 * OBSERVABILITY ONLY... nothing in the application may branch on any
 * value this returns." This module is the dedicated, intentional
 * exception the platform needs for exactly one purpose (Part 4's own
 * "introduce an explicit configuration gate") and never calls into
 * `deployment-version.ts` or reuses its output for gating.
 *
 * Pure with respect to its input: takes an explicit env bag (any
 * `{ [k]: string | undefined }`, which `process.env` satisfies) so it is
 * trivially testable without mutating `process.env` globally.
 */
export function isCanonicalEngineV1Enabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV === 'production') return false;
  return env.CANONICAL_ENGINE_V1_ENABLED === 'true';
}
