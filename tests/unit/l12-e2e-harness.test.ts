/**
 * L12 / UX-1 -- guards of the browser harness (tests/e2e/support/target.ts):
 * it never targets Production, never uses a Production session, never signs
 * in by itself, and applies the accessibility release policy per surface.
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { roleSession, storageStateHosts } from '../e2e/support/session';
import {
  LOCAL_BASE_URL,
  ROLES,
  ROLE_DEFAULTS,
  VIEWPORTS,
  axeFailImpacts,
  isVercelProtectionHost,
  primaryLanguage,
  protectionBypass,
  resolveBaseUrl,
  rolePaths,
} from '../e2e/support/target';
import { readFileSync } from 'fs';

describe('L12 harness target', () => {
  it('serves this checkout locally when no target is named', () => {
    expect(resolveBaseUrl({})).toEqual({ baseUrl: LOCAL_BASE_URL, managedServer: true });
  });

  it('uses a named target as-is, reduced to its origin', () => {
    expect(resolveBaseUrl({ E2E_BASE_URL: 'https://studyos-dev.example.test/dashboard?x=1' })).toEqual({ baseUrl: 'https://studyos-dev.example.test', managedServer: false });
  });

  it('refuses Production', () => {
    expect(() => resolveBaseUrl({ E2E_BASE_URL: 'https://www.studyus.pro' })).toThrow(/Production/);
    expect(() => resolveBaseUrl({ E2E_BASE_URL: 'https://STUDYUS.pro/es' })).toThrow(/Production/);
  });

  it('refuses Production subdomains too', () => {
    expect(() => resolveBaseUrl({ E2E_BASE_URL: 'https://app.studyus.pro' })).toThrow(/Production/);
    expect(resolveBaseUrl({ E2E_BASE_URL: 'https://notstudyus.pro' }).managedServer).toBe(false);
  });

  it('covers the four profiles at phone, tablet and desktop widths', () => {
    expect([...ROLES]).toEqual(['student', 'parent', 'teacher', 'institution']);
    expect(VIEWPORTS.mobile.width).toBe(375);
    expect(VIEWPORTS.tablet.width).toBe(768);
    expect(VIEWPORTS.desktop.width).toBeGreaterThanOrEqual(1024);
  });

  it('audits the role home first and accepts only same-origin extra paths', () => {
    expect(rolePaths('parent', {})).toEqual([ROLE_DEFAULTS.parent.home]);
    expect(rolePaths('student', { E2E_STUDENT_PATHS: ' /dashboard/plan, https://evil.test/x, //evil.test, /dashboard/today ' })).toEqual(['/dashboard/today', '/dashboard/plan']);
  });

  it('authenticated pages fail on critical and serious; public pages on critical', () => {
    expect(axeFailImpacts('authenticated', {})).toEqual(['critical', 'serious']);
    expect(axeFailImpacts('public', {})).toEqual(['critical']);
  });

  it('the override can tighten the policy and can never loosen it', () => {
    expect(axeFailImpacts('public', { E2E_AXE_FAIL_ON: 'serious, bogus' })).toEqual(['critical', 'serious']);
    expect(axeFailImpacts('authenticated', { E2E_AXE_FAIL_ON: 'minor' })).toEqual(['critical', 'serious', 'minor']);
    expect(axeFailImpacts('authenticated', { E2E_AXE_FAIL_ON: 'critical' })).toEqual(['critical', 'serious']);
  });

  it('compares languages by primary subtag', () => {
    expect(primaryLanguage('es-CO')).toBe('es');
    expect(primaryLanguage('EN')).toBe('en');
    expect(primaryLanguage(null)).toBe('');
  });
});

describe('L12 harness role sessions', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'l12-sessions-'));
  const write = (role: string, state: unknown) => writeFileSync(path.join(dir, `${role}.json`), JSON.stringify(state));

  it('with no session directory the role suites are NOT_RUN, not passed', () => {
    expect(roleSession('student', {})).toEqual({ skip: expect.stringMatching(/^NOT_RUN/) });
  });

  it('once a directory is named, a missing session is an error', () => {
    expect(() => roleSession('parent', { E2E_STORAGE_STATE_DIR: dir })).toThrow(/no parent session/);
  });

  it('uses an operator-captured Stage session', () => {
    write('teacher', { cookies: [{ domain: '.stage.example.test' }, { domain: 'clerk.stage.example.test' }], origins: [{ origin: 'https://stage.example.test' }] });
    expect(roleSession('teacher', { E2E_STORAGE_STATE_DIR: dir })).toEqual({ path: path.join(dir, 'teacher.json') });
  });

  it('refuses a Production session, by cookie domain or by origin', () => {
    write('student', { cookies: [{ domain: '.studyus.pro' }], origins: [] });
    expect(() => roleSession('student', { E2E_STORAGE_STATE_DIR: dir })).toThrow(/Production session/);
    write('institution', { cookies: [], origins: [{ origin: 'https://www.studyus.pro' }] });
    expect(() => roleSession('institution', { E2E_STORAGE_STATE_DIR: dir })).toThrow(/Production session/);
  });

  it('reads hosts from cookies and origins', () => {
    expect(storageStateHosts({ cookies: [{ domain: '.A.test' }, {}], origins: [{ origin: 'https://b.test:8443' }, { origin: 'nonsense' }] })).toEqual(['a.test', 'b.test']);
  });
});

describe('L12 harness Deployment Protection bypass', () => {
  const STAGE = 'https://study-os-stage-study-so.vercel.app';
  const SECRET = 'not-a-real-secret-0123456789';

  it('without the variable there is no bypass, on any target', () => {
    expect(protectionBypass({}, STAGE)).toBeNull();
    expect(protectionBypass({ E2E_VERCEL_BYPASS_SECRET: '   ' }, STAGE)).toBeNull();
  });

  it('with it, the header is bound to the target origin and nothing else', () => {
    expect(protectionBypass({ E2E_VERCEL_BYPASS_SECRET: ` ${SECRET} ` }, `${STAGE}/es?x=1`)).toEqual({ origin: STAGE, headers: { 'x-vercel-protection-bypass': SECRET } });
  });

  it('refuses Production, and never sends the secret to a host that is not an https vercel.app deployment', () => {
    expect(() => protectionBypass({ E2E_VERCEL_BYPASS_SECRET: SECRET }, 'https://studyus.pro')).toThrow(/Production/);
    expect(() => protectionBypass({ E2E_VERCEL_BYPASS_SECRET: SECRET }, 'https://www.studyus.pro')).toThrow(/Production/);
    expect(() => protectionBypass({ E2E_VERCEL_BYPASS_SECRET: SECRET }, 'https://example.org')).toThrow(/not an https \*\.vercel\.app/);
    expect(() => protectionBypass({ E2E_VERCEL_BYPASS_SECRET: SECRET }, 'http://study-os-stage-study-so.vercel.app')).toThrow(/not an https/);
    expect(() => protectionBypass({ E2E_VERCEL_BYPASS_SECRET: SECRET }, 'https://vercel.app.evil.test')).toThrow(/not an https/);
  });

  it('the local build is not behind protection: the secret is not sent to it', () => {
    expect(protectionBypass({ E2E_VERCEL_BYPASS_SECRET: SECRET }, LOCAL_BASE_URL)).toBeNull();
    expect(protectionBypass({ E2E_VERCEL_BYPASS_SECRET: SECRET }, 'http://localhost:3100')).toBeNull();
  });

  it('an error never contains the secret', () => {
    for (const target of ['https://studyus.pro', 'https://example.org']) {
      try { protectionBypass({ E2E_VERCEL_BYPASS_SECRET: SECRET }, target); } catch (e) { expect(String((e as Error).message)).not.toContain(SECRET); }
    }
  });

  it('recognises where Vercel sends a visitor it does not let through', () => {
    expect(isVercelProtectionHost('vercel.com')).toBe(true);
    expect(isVercelProtectionHost('sso.vercel.com')).toBe(true);
    expect(isVercelProtectionHost('study-os-stage-study-so.vercel.app')).toBe(false);
    expect(isVercelProtectionHost('notvercel.com')).toBe(false);
  });

  it('the fixtures attach the header to the target origin only, follow no redirect with it, never print it, and fail a test sent to Vercel', () => {
    const fx = readFileSync(path.join(process.cwd(), 'tests/e2e/support/fixtures.ts'), 'utf-8');
    expect(fx).toMatch(/context\.route\(`\$\{bypass\.origin\}\/\*\*`/);
    expect(fx).toMatch(/maxRedirects: 0/);
    expect(fx).not.toMatch(/console\.|extraHTTPHeaders: bypass\.headers \}\s*\)\s*;?\s*$/m);
    expect(fx).toMatch(/isVercelProtectionHost\(host\)/);
    expect(fx).toMatch(/auto: true/);
    // every spec goes through those fixtures
    for (const spec of ['public.spec.ts', 'roles.spec.ts', 'harness.selftest.spec.ts']) {
      const code = readFileSync(path.join(process.cwd(), 'tests/e2e', spec), 'utf-8');
      expect(code, spec).toMatch(/from '\.\/support\/fixtures'/);
      expect(code, spec).not.toMatch(/import \{[^}]*\btest\b[^}]*\} from '@playwright\/test'/);
    }
    // a trace records request headers: off while the bypass is active
    expect(readFileSync(path.join(process.cwd(), 'playwright.config.ts'), 'utf-8')).toMatch(/trace: bypassActive \? 'off' : 'retain-on-failure'/);
  });

  it('the public spec is as strict as before: exact language in the initial HTML, and now also served by the target itself', () => {
    const spec = readFileSync(path.join(process.cwd(), 'tests/e2e/public.spec.ts'), 'utf-8');
    for (const p of ["{ path: '/es', lang: 'es' }", "{ path: '/es/how-it-works', lang: 'es' }", "{ path: '/en', lang: 'en' }", "{ path: '/en/how-it-works', lang: 'en' }", "{ path: '/de', lang: 'de' }"]) expect(spec).toContain(p);
    expect(spec).toMatch(/\)\?\.\[1\]\)\.toBe\(lang\);/);
    expect(spec).toMatch(/served by another origin/);
    expect(spec).toMatch(/toHaveURL\(\/\\\/sign-in\\\?redirect_url=\/\)/);
  });
});
