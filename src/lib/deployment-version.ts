/**
 * Deployment provenance -- pure payload builder for GET /api/version.
 *
 * OPERATIONAL OBSERVABILITY ONLY. Nothing in the application may branch
 * on any value this returns (no feature gating, no policy, no learning
 * behavior) -- it exists so a release can be verified to have actually
 * reached production, and for nothing else.
 *
 * Pure: takes an explicit env bag (any `{ [k]: string | undefined }`,
 * which `process.env` satisfies), returns a plain object. No DB, no
 * AI, no network, no `process.env` read of its own (the route passes
 * `process.env`), no clock. Every field is sourced from a documented,
 * non-sensitive Vercel-provided deployment variable and defaults safely
 * when absent (local dev, or a non-Vercel host).
 *
 * The returned object is a CLOSED shape built key-by-key -- it can
 * never accidentally spread or leak an unrelated environment variable
 * (tokens, DATABASE_URL, Clerk keys, etc.).
 */

export type DeploymentEnvironment = 'production' | 'preview' | 'development';

export interface DeploymentVersion {
  /** The exact git commit SHA this deployment was built from, or null when not running on a deployment that provides it. */
  commitSha: string | null;
  /** Which Vercel environment this is, falling back to 'development' off-platform. */
  environment: DeploymentEnvironment;
  /** Best-effort build/commit timestamp (ISO), or null when unavailable. Never fabricated. */
  buildTime: string | null;
}

function normalizeEnvironment(value: string | undefined): DeploymentEnvironment {
  if (value === 'production' || value === 'preview' || value === 'development') return value;
  return 'development';
}

function nonEmpty(value: string | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Build the version payload from an env bag. Reads ONLY these keys:
 *   - VERCEL_GIT_COMMIT_SHA  (documented, non-sensitive)
 *   - VERCEL_ENV             (documented, non-sensitive: production|preview|development)
 *   - VERCEL_GIT_COMMIT_AUTHOR_DATE (documented, non-sensitive) -- optional buildTime source
 * No other key is ever read, so no other value can ever be exposed.
 */
export function buildDeploymentVersion(env: Record<string, string | undefined>): DeploymentVersion {
  return {
    commitSha: nonEmpty(env.VERCEL_GIT_COMMIT_SHA),
    environment: normalizeEnvironment(env.VERCEL_ENV),
    buildTime: nonEmpty(env.VERCEL_GIT_COMMIT_AUTHOR_DATE),
  };
}
