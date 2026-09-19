/**
 * F10 -- MULTI-ROLE AUTHORIZATION CERTIFICATION CHECK regression test.
 * Proves, at the source and behavior level, that the Parent Read
 * Model resolves access through PARENT relationship semantics only
 * (`isActiveParentOf`) and never through the generic `canAccessLearner`
 * composition, which treats Parent OR Teacher as equivalent for
 * LEARNER_PROGRESS_VIEW -- correct for F5-F9's routes, but a real
 * authorization-widening bug for a Parent-labeled route. Found and
 * fixed via a real ephemeral-Postgres run
 * (scripts/operations/f10-multi-role-authorization-check-runner.ts):
 * a user with an ACCEPTED Parent relationship to Child A and a
 * completely separate ACTIVE Teacher assignment covering Student B
 * could, before this fix, view Student B through the Parent routes
 * purely via the Teacher relationship.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const isActiveParentOfMock = vi.fn();
const canAccessLearnerMock = vi.fn();
vi.mock('@/lib/authorization', () => ({
  isActiveParentOf: (...a: any[]) => isActiveParentOfMock(...a),
  canAccessLearner: (...a: any[]) => canAccessLearnerMock(...a),
}));

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

vi.mock('@/services/mastery.service', () => ({ getStudentMastery: vi.fn().mockResolvedValue([]) }));
vi.mock('@/services/learning-debt.service', () => ({ getActiveDebts: vi.fn().mockResolvedValue([]) }));
vi.mock('@/services/concept-extraction.service', () => ({ getSubjectConcepts: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/readiness/readiness.service', () => ({ getLatestReadinessSnapshot: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/simulation/full-mock-eligibility.service', () => ({ getFullMockEligibility: vi.fn() }));
vi.mock('@/lib/simulation/eligibility.service', () => ({ getSimulationEligibility: vi.fn() }));

import { getParentLearnerOverview, getParentSubjectProgress, getParentAttentionAreas, ParentAccessDeniedError } from '@/lib/parent/read-model.service';

const ACTOR_ID = 'user-x';
const STUDENT_ID = 'student-b';

beforeEach(() => {
  isActiveParentOfMock.mockReset();
  canAccessLearnerMock.mockReset();
  dbQueryMock.mockReset().mockResolvedValue({ rows: [] });
});

describe('Parent Read Model authorization: PARENT relationship only, never the generic canAccessLearner composition', () => {
  it('source: read-model.service.ts never imports canAccessLearner', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/parent/read-model.service.ts'), 'utf-8');
    // A doc comment may still reference canAccessLearner by name to
    // explain why it's NOT used (as this file's own requireAccess
    // comment does) -- what must never appear is an actual import of it.
    expect(src).not.toMatch(/import\s*\{[^}]*\bcanAccessLearner\b[^}]*\}\s*from\s*['"]@\/lib\/authorization['"]/);
    expect(src).toMatch(/import\s*\{[^}]*\bisActiveParentOf\b[^}]*\}\s*from\s*['"]@\/lib\/authorization['"]/);
  });

  it('DENIES a user whose only relationship to the learner is via Teacher scope, even though the generic canAccessLearner would ALLOW it', async () => {
    isActiveParentOfMock.mockResolvedValue(false); // no Parent relationship
    canAccessLearnerMock.mockResolvedValue(true); // Teacher relationship WOULD satisfy the generic check

    await expect(getParentLearnerOverview(ACTOR_ID, STUDENT_ID)).rejects.toThrow(ParentAccessDeniedError);
    await expect(getParentSubjectProgress(ACTOR_ID, STUDENT_ID)).rejects.toThrow(ParentAccessDeniedError);
    await expect(getParentAttentionAreas(ACTOR_ID, STUDENT_ID)).rejects.toThrow(ParentAccessDeniedError);

    // the generic composed check must never even be consulted by this module
    expect(canAccessLearnerMock).not.toHaveBeenCalled();
    expect(isActiveParentOfMock).toHaveBeenCalledWith(ACTOR_ID, STUDENT_ID);
  });

  it('ALLOWS a user with a real, accepted Parent relationship to the learner', async () => {
    isActiveParentOfMock.mockResolvedValue(true);
    dbQueryMock.mockResolvedValue({ rows: [{ name: 'Child A', email: 'a@test.com', last_at: null }] });

    const overview = await getParentLearnerOverview(ACTOR_ID, STUDENT_ID);
    expect(overview.studentId).toBe(STUDENT_ID);
    expect(canAccessLearnerMock).not.toHaveBeenCalled();
  });
});
