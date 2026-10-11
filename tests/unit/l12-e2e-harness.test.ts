/**
 * L12 / UX-1 -- guards of the browser harness (tests/e2e/support/target.ts):
 * it never targets Production, never signs in with live Clerk keys, and
 * never treats an unnamed target as a passing role run.
 */
import { describe, it, expect } from 'vitest';
import {
  LOCAL_BASE_URL,
  ROLES,
  ROLE_DEFAULTS,
  VIEWPORTS,
  axeFailImpacts,
  clerkTicketBlocker,
  primaryLanguage,
  resolveBaseUrl,
  resolveRoleAuthMode,
  roleEmail,
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

  it('role suites are off unless an auth mode is named, and an unknown mode is an error', () => {
    expect(resolveRoleAuthMode({})).toBe('none');
    expect(resolveRoleAuthMode({ E2E_ROLE_AUTH: 'clerk-ticket' })).toBe('clerk-ticket');
    expect(resolveRoleAuthMode({ E2E_ROLE_AUTH: 'storage-state' })).toBe('storage-state');
    expect(() => resolveRoleAuthMode({ E2E_ROLE_AUTH: 'password' })).toThrow();
  });

  it('ticket sign-in needs test-instance keys and refuses live ones', () => {
    expect(clerkTicketBlocker({})).toMatch(/required/);
    expect(clerkTicketBlocker({ CLERK_SECRET_KEY: 'sk_live_x', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_x' })).toMatch(/test-instance/);
    expect(clerkTicketBlocker({ CLERK_SECRET_KEY: 'sk_test_x', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_x' })).toMatch(/test-instance/);
    expect(clerkTicketBlocker({ CLERK_SECRET_KEY: 'sk_test_x', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_x' })).toBeNull();
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

  it('defaults to the Track A fixture identity and lets the run override it', () => {
    expect(roleEmail('teacher', {})).toBe(ROLE_DEFAULTS.teacher.fixtureEmail);
    expect(roleEmail('teacher', { E2E_TEACHER_EMAIL: 'other+clerk_test@example.com' })).toBe('other+clerk_test@example.com');
  });

  it('fails on critical axe violations by default; unknown impacts are ignored', () => {
    expect(axeFailImpacts({})).toEqual(['critical']);
    expect(axeFailImpacts({ E2E_AXE_FAIL_ON: 'critical, serious, bogus' })).toEqual(['critical', 'serious']);
    expect(axeFailImpacts({ E2E_AXE_FAIL_ON: 'bogus' })).toEqual(['critical']);
  });

  it('compares languages by primary subtag', () => {
    expect(primaryLanguage('es-CO')).toBe('es');
    expect(primaryLanguage('EN')).toBe('en');
    expect(primaryLanguage(null)).toBe('');
  });
});
