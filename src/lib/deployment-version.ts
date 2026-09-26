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
  /** Git branch the deployment was built from, or null when unknown. */
  commitRef: string | null;
  /** Raw Vercel deployment target (e.g. production, preview, or a custom environment slug such as `dev`). */
  deploymentTarget: string | null;
  /** Vercel deployment id -- the unique build identifier of this runtime. */
  deploymentId: string | null;
}

function normalizeEnvironment(value: string | undefined): DeploymentEnvironment {
  if (value === 'production' || value === 'preview' || value === 'development') return value;
  return 'development';
}

function nonEmpty(value: string | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Custom Vercel environment slugs that are StudyOS hosted Development. */
const DEVELOPMENT_TARGETS = new Set(['dev', 'development']);

/**
 * Environment identity, most explicit first:
 *   1. STUDYUS_ENV -- set per environment in hosting config, never inferred;
 *   2. VERCEL_TARGET_ENV -- distinguishes a custom `dev` environment, which
 *      Vercel otherwise reports as VERCEL_ENV=preview;
 *   3. VERCEL_ENV.
 */
function resolveEnvironment(env: Record<string, string | undefined>): DeploymentEnvironment {
  const explicit = env.STUDYUS_ENV;
  if (explicit === 'production' || explicit === 'preview' || explicit === 'development') return explicit;
  const target = env.VERCEL_TARGET_ENV;
  if (target === 'production' || target === 'preview') return target;
  if (target && DEVELOPMENT_TARGETS.has(target)) return 'development';
  return normalizeEnvironment(env.VERCEL_ENV);
}

/**
 * Build the version payload from an env bag. Reads ONLY these keys:
 *   - VERCEL_GIT_COMMIT_SHA  (documented, non-sensitive)
 *   - STUDYUS_COMMIT_SHA     (non-sensitive fallback for CLI deployments, which carry no git env)
 *   - VERCEL_GIT_COMMIT_REF  (documented, non-sensitive: branch name)
 *   - STUDYUS_ENV / VERCEL_TARGET_ENV / VERCEL_ENV (non-sensitive environment identity)
 *   - VERCEL_DEPLOYMENT_ID   (documented, non-sensitive)
 *   - VERCEL_GIT_COMMIT_AUTHOR_DATE (documented, non-sensitive) -- optional buildTime source
 * No other key is ever read, so no other value can ever be exposed.
 */
export function buildDeploymentVersion(env: Record<string, string | undefined>): DeploymentVersion {
  return {
    commitSha: nonEmpty(env.VERCEL_GIT_COMMIT_SHA) ?? nonEmpty(env.STUDYUS_COMMIT_SHA),
    environment: resolveEnvironment(env),
    buildTime: nonEmpty(env.VERCEL_GIT_COMMIT_AUTHOR_DATE),
    commitRef: nonEmpty(env.VERCEL_GIT_COMMIT_REF),
    deploymentTarget: nonEmpty(env.VERCEL_TARGET_ENV),
    deploymentId: nonEmpty(env.VERCEL_DEPLOYMENT_ID),
  };
}
