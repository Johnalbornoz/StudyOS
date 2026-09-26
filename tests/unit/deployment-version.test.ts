import { describe, it, expect } from 'vitest';
import { buildDeploymentVersion, type DeploymentVersion } from '@/lib/deployment-version';

/**
 * Deployment provenance endpoint (Step 6L-C1-R1 hardening).
 *
 * These cover the pure payload builder behind GET /api/version. The
 * route handler itself is a one-liner (`NextResponse.json(
 * buildDeploymentVersion(process.env))`), so proving the builder is
 * correct and closed proves the endpoint is.
 */

const ALLOWED_KEYS = ['commitSha', 'environment', 'buildTime', 'commitRef', 'deploymentTarget', 'deploymentId'].sort();

describe('buildDeploymentVersion', () => {
  it('A. returns ONLY the allowed fields, nothing else', () => {
    const out = buildDeploymentVersion({
      VERCEL_GIT_COMMIT_SHA: 'abc123',
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_AUTHOR_DATE: '2026-09-05T19:08:48.000Z',
    });
    expect(Object.keys(out).sort()).toEqual(ALLOWED_KEYS);
  });

  it('B. uses the deployment env values when present', () => {
    const out = buildDeploymentVersion({
      VERCEL_GIT_COMMIT_SHA: 'ff904948c3a19ee355eeda62f2721af4639af099',
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_AUTHOR_DATE: '2026-09-05T19:08:48.000Z',
    });
    expect(out).toEqual<DeploymentVersion>({
      commitSha: 'ff904948c3a19ee355eeda62f2721af4639af099',
      environment: 'production',
      buildTime: '2026-09-05T19:08:48.000Z',
      commitRef: null,
      deploymentTarget: null,
      deploymentId: null,
    });
  });

  it('B2. normalizes preview / development, and falls back to development for anything unrecognized', () => {
    expect(buildDeploymentVersion({ VERCEL_ENV: 'preview' }).environment).toBe('preview');
    expect(buildDeploymentVersion({ VERCEL_ENV: 'development' }).environment).toBe('development');
    expect(buildDeploymentVersion({ VERCEL_ENV: 'staging' }).environment).toBe('development');
    expect(buildDeploymentVersion({}).environment).toBe('development');
  });

  it('C. never exposes an unrelated environment variable', () => {
    const out = buildDeploymentVersion({
      VERCEL_GIT_COMMIT_SHA: 'abc123',
      VERCEL_ENV: 'production',
      // realistic sensitive neighbors that must never surface
      DATABASE_URL: 'postgres://user:pw@host/db',
      CLERK_SECRET_KEY: 'sk_test_shhh',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      VERCEL_OIDC_TOKEN: 'eyJ.secret.token',
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('sk_test_shhh');
    expect(serialized).not.toContain('sk-ant-secret');
    expect(serialized).not.toContain('eyJ.secret.token');
    expect(Object.keys(out).sort()).toEqual(ALLOWED_KEYS);
  });

  it('D. handles an absent commit SHA (and absent buildTime) safely -- null, never undefined, never a throw', () => {
    const out = buildDeploymentVersion({ VERCEL_ENV: 'development' });
    expect(out).toEqual<DeploymentVersion>({
      commitSha: null, environment: 'development', buildTime: null, commitRef: null, deploymentTarget: null, deploymentId: null,
    });
    // empty string is treated as absent, not echoed back
    const out2 = buildDeploymentVersion({ VERCEL_GIT_COMMIT_SHA: '', VERCEL_GIT_COMMIT_AUTHOR_DATE: '' });
    expect(out2.commitSha).toBeNull();
    expect(out2.buildTime).toBeNull();
  });

  it('F. hosted DEV (custom `dev` target, which Vercel reports as VERCEL_ENV=preview) identifies as development', () => {
    const out = buildDeploymentVersion({
      VERCEL_ENV: 'preview',
      VERCEL_TARGET_ENV: 'dev',
      VERCEL_GIT_COMMIT_SHA: '934d531560e9608e2a3a8f294536945f3759fffd',
      VERCEL_GIT_COMMIT_REF: 'develop',
      VERCEL_DEPLOYMENT_ID: 'dpl_abc',
    });
    expect(out.environment).toBe('development');
    expect(out.deploymentTarget).toBe('dev');
    expect(out.commitRef).toBe('develop');
    expect(out.deploymentId).toBe('dpl_abc');
  });

  it('G. STUDYUS_ENV is the most explicit identity and wins over Vercel inference; invalid values are ignored', () => {
    expect(buildDeploymentVersion({ STUDYUS_ENV: 'development', VERCEL_ENV: 'preview' }).environment).toBe('development');
    expect(buildDeploymentVersion({ STUDYUS_ENV: 'bogus', VERCEL_ENV: 'preview' }).environment).toBe('preview');
    expect(buildDeploymentVersion({ VERCEL_TARGET_ENV: 'production', VERCEL_ENV: 'production' }).environment).toBe('production');
    expect(buildDeploymentVersion({ VERCEL_TARGET_ENV: 'preview', VERCEL_ENV: 'preview' }).environment).toBe('preview');
  });

  it('H. CLI deployments (no git env) report STUDYUS_COMMIT_SHA; the git SHA always wins when both exist', () => {
    expect(buildDeploymentVersion({ STUDYUS_COMMIT_SHA: 'cli-sha' }).commitSha).toBe('cli-sha');
    expect(buildDeploymentVersion({ STUDYUS_COMMIT_SHA: 'cli-sha', VERCEL_GIT_COMMIT_SHA: 'git-sha' }).commitSha).toBe('git-sha');
    expect(buildDeploymentVersion({ STUDYUS_COMMIT_SHA: '' }).commitSha).toBeNull();
  });

  it('E. is pure -- no DB/network/AI import in the module, no process.env read of its own', async () => {
    const raw = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../src/lib/deployment-version.ts', import.meta.url), 'utf-8')
    );
    // Strip comments before matching -- the module's own doc comment
    // legitimately mentions `process.env` in prose.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/from '@\/lib\/db'|from ['"]pg['"]|drizzle/);
    expect(code).not.toMatch(/executeAI|@\/lib\/ai/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    // the builder must receive env as an argument, never reach for the global itself
    expect(code).not.toMatch(/process\s*\.\s*env/);
  });
});
