/**
 * Phase 6 Closeout D5 -- CI guard for the canonical production release
 * smoke checklist.
 *
 * This does NOT execute an authenticated production smoke (CI has no
 * safe credentials for that). It statically asserts the PROCESS
 * ARTIFACT exists and still requires the things the Concept Detail P0
 * taught us it must require: an exact /api/version SHA match, and an
 * authenticated, read-only, no-activity-submission read of Today,
 * Concept Detail, and Learning Debt.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CHECKLIST_PATH = 'docs/releases/PHASE_6_RELEASE_SMOKE_CHECKLIST.md';
const abs = join(process.cwd(), CHECKLIST_PATH);

describe('Closeout D5 -- release smoke checklist artifact', () => {
  it('the canonical checklist file exists', () => {
    expect(existsSync(abs), `${CHECKLIST_PATH} must exist`).toBe(true);
  });

  const md = existsSync(abs) ? readFileSync(abs, 'utf-8') : '';

  it('names every mandatory smoke route', () => {
    expect(md).toContain('/api/version');
    expect(md).toContain('/dashboard/today');
    expect(md).toContain('/dashboard/subjects/[subjectId]/concepts/[conceptId]');
    expect(md).toContain('/dashboard/learning-debt');
  });

  it('requires an exact /api/version SHA + production environment match', () => {
    expect(md).toMatch(/commitSha/);
    expect(md).toMatch(/exact SHA/i);
    expect(md).toMatch(/environment.*production|production.*environment/i);
  });

  it('requires the authenticated reads to be read-only with no activity submission', () => {
    expect(md).toMatch(/authenticated/i);
    expect(md).toMatch(/read-only/i);
    expect(md).toMatch(/no activity|not submit|no answer is submitted|no learner evidence|creates? \*\*no\*\* learner evidence/i);
  });

  it('explicitly calls out the Concept Detail React #441 / 500 regression it guards', () => {
    expect(md).toMatch(/#441/);
    expect(md).toMatch(/Concept Detail/);
  });

  it('marks the authenticated reads as MANUAL AUTH REQUIRED (no invented CI credentials)', () => {
    expect(md).toMatch(/MANUAL AUTH REQUIRED/);
    expect(md).toMatch(/AUTOMATABLE WITHOUT AUTH/);
  });
});
