/**
 * L12 / UX-1 -- defects already observed on Stage, pinned as explicit
 * assertions.
 *
 * E2E_KNOWN_FINDINGS=expected (default): a test that hits a finding marked
 *   `expectedToFail` is reported as an expected failure, so the suite stays
 *   usable as a regression gate. The day the defect is fixed the test turns
 *   red ("expected to fail, but passed"): clear `expectedToFail` then.
 * E2E_KNOWN_FINDINGS=strict: nothing is excused. Use this to certify.
 *
 * `expectedToFail` is set only for a defect confirmed in the code under
 * test. A finding without it is asserted strictly in both modes.
 */
import { test } from '@playwright/test';

export interface KnownFinding {
  title: string;
  evidence: string;
  expectedToFail: boolean;
}

export const KNOWN_FINDINGS = {
  'KF-L12-01': {
    title: 'A localized public page renders with <html lang="en">',
    evidence: 'Stage finding, confirmed at 4fb45b0. Fixed by CR-L12-01: the root layout derives <html lang> from the route locale.',
    expectedToFail: false,
  },
  'KF-L12-02': {
    title: 'Collapsed navigation icon links have no accessible name',
    evidence: 'Stage finding, OPEN. Public navigation is not evidence either way; settled only by the authenticated role suites (L12-R1).',
    expectedToFail: false,
  },
  'KF-L12-03': {
    title: 'An authenticated workspace in a non-English interface language renders with <html lang="en">',
    evidence: 'Read from source, not yet observed: /dashboard carries no route locale, so <html lang> stays at the fallback while LearnerShell sets the user language on an inner element.',
    expectedToFail: true,
  },
} satisfies Record<string, KnownFinding>;

export type KnownFindingId = keyof typeof KNOWN_FINDINGS;

export const strictKnownFindings = () => process.env.E2E_KNOWN_FINDINGS === 'strict';

/**
 * Tag the running test with a known finding. Call before the assertion.
 * `applies` narrows it to the cases where the defect is actually reachable
 * (e.g. only when the page language is not English).
 */
export function coversKnownFinding(id: KnownFindingId, applies = true): void {
  const finding: KnownFinding = KNOWN_FINDINGS[id];
  test.info().annotations.push({ type: 'known-finding', description: `${id}: ${finding.title}` });
  if (applies && finding.expectedToFail && !strictKnownFindings()) {
    test.fail(true, `${id}: ${finding.title}`);
  }
}
