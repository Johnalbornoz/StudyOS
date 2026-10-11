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
  primaryLanguage,
  resolveBaseUrl,
  rolePaths,
} from '../e2e/support/target';

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
