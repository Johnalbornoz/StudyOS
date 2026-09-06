/**
 * LX-2C -- first authenticated destination. Pure routing over account
 * setup state only; never mastery/evidence; no redirect loops.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveFirstDestination,
  onboardingRouteRedirect,
  ONBOARDING_PATH,
  START_PATH,
} from '@/lib/lx/first-destination';

describe('LX-2C resolveFirstDestination', () => {
  it('new learner with no subject -> onboarding', () => {
    const r = resolveFirstDestination({ hasSubject: false });
    expect(r.path).toBe(ONBOARDING_PATH);
    expect(r.reason).toBe('ONBOARDING_NO_SUBJECT');
  });

  it('learner with at least one subject -> Today, never the Progress page', () => {
    const r = resolveFirstDestination({ hasSubject: true });
    expect(r.path).toBe(START_PATH);
    expect(r.path).toBe('/dashboard/today');
    expect(r.reason).toBe('RESUME_TODAY');
  });

  it('is deterministic', () => {
    expect(resolveFirstDestination({ hasSubject: true })).toEqual(resolveFirstDestination({ hasSubject: true }));
    expect(resolveFirstDestination({ hasSubject: false })).toEqual(resolveFirstDestination({ hasSubject: false }));
  });

  it('the onboarding route bounces a learner who already has a subject (no trap)', () => {
    expect(onboardingRouteRedirect({ hasSubject: true })).toBe(START_PATH);
    expect(onboardingRouteRedirect({ hasSubject: false })).toBeNull();
  });

  it('no redirect loop: the destinations are distinct and none targets itself', () => {
    const dests = new Set([
      resolveFirstDestination({ hasSubject: true }).path,
      resolveFirstDestination({ hasSubject: false }).path,
    ]);
    expect(dests.size).toBe(2);
    // onboarding never resolves to onboarding; start never bounces back to onboarding
    expect(onboardingRouteRedirect({ hasSubject: false })).not.toBe(ONBOARDING_PATH);
    expect(onboardingRouteRedirect({ hasSubject: true })).not.toBe(ONBOARDING_PATH);
  });
});
