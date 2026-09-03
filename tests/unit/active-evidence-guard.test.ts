/**
 * Phase 5-R2/5-R3: the canonical, subject-aware cross-surface
 * active-evidence guard. `getStudentActiveQuizzes` is mocked (already
 * certified elsewhere, reused verbatim here); the one genuinely new
 * SQL query this phase introduces (`hasPendingRestrictedVerification`)
 * is exercised through the mocked `db.query` boundary here and
 * separately validated against real, disposable PostgreSQL 18.6 (see
 * the Phase 5-R3 report S14).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getStudentActiveQuizzesMock = vi.fn();
vi.mock('@/services/quiz-persistence.service', () => ({ getStudentActiveQuizzes: (...a: any[]) => getStudentActiveQuizzesMock(...a) }));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => queryMock(...a) } }));

import {
  getActiveInstructionRestriction,
  canProvideInstructionalAssistance,
  getActiveRestrictedEvidenceForStudent,
} from '@/services/active-evidence-guard.service';

const STUDENT = 'student-1';
const CONCEPT = 'concept-1';
const SUBJECT = 'subject-1';
const OTHER_SUBJECT = 'subject-2';

function quiz(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'quiz-1', studentId: STUDENT, conceptId: CONCEPT, subjectId: SUBJECT, conceptIds: [CONCEPT],
    quizMode: 'topic_practice', activityType: 'PRACTICE', evidenceMode: 'PRACTICE',
    questions: [], language: 'en', createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    status: 'active', hintsUsedQuestions: [],
    ...overrides,
  };
}

beforeEach(() => {
  getStudentActiveQuizzesMock.mockReset().mockResolvedValue([]);
  queryMock.mockReset().mockResolvedValue({ rows: [] }); // default: no pending verification
});

describe('release tests 1-7: every restricted ActivityType blocks, conceptId OMITTED (Phase 5-R3 central case)', () => {
  const restricted: [string, string][] = [
    ['SOLO_CHECK', 'INDEPENDENT'],
    ['RETENTION_CHECK', 'INDEPENDENT'],
    ['TRANSFER', 'INDEPENDENT'],
    ['DIAGNOSTIC_CHECK', 'ASSESSMENT'],
    ['CUMULATIVE_ASSESSMENT', 'ASSESSMENT'],
    ['MOCK_EXAM', 'ASSESSMENT'],
  ];
  it.each(restricted)('active %s (%s), no conceptId, same subject -> blocked', async (activityType, evidenceMode) => {
    getStudentActiveQuizzesMock.mockResolvedValue([quiz({ activityType, evidenceMode })]);
    const state = await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT });
    expect(state.allowed).toBe(false);
    expect(state.reason).toBe('ACTIVE_QUIZ_SESSION');
    expect(state.activityType).toBe(activityType);
  });

  it('pending SOLO_VERIFY, no conceptId, same subject -> blocked (release test 7)', async () => {
    queryMock.mockResolvedValue({ rows: [{ concept_id: CONCEPT, quiz_session_id: 'qs-1' }] });
    const state = await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT });
    expect(state.allowed).toBe(false);
    expect(state.reason).toBe('ACTIVE_VERIFICATION');
    expect(state.activityType).toBe('SOLO_VERIFY');
    expect(state.sessionId).toBe('qs-1');
  });
});

describe('release test 8: a wrong client-supplied conceptId cannot bypass subject-level protection', () => {
  it('active SOLO_CHECK on concept A, client claims conceptId B (also in-subject) -> still blocked', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([quiz({ conceptId: 'concept-A', conceptIds: ['concept-A'], activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT' })]);
    const state = await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT, conceptId: 'concept-B' });
    expect(state.allowed).toBe(false);
  });

  it('active CUMULATIVE_ASSESSMENT covering concept A, client claims unrelated conceptId B -> still blocked (subject scope wins)', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([quiz({ conceptId: null, conceptIds: ['concept-A'], activityType: 'CUMULATIVE_ASSESSMENT', evidenceMode: 'ASSESSMENT' })]);
    const state = await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT, conceptId: 'concept-B' });
    expect(state.allowed).toBe(false);
  });
});

describe('Phase 5-R3 S4/S6: conversation with NO subject binding fails toward blocking, never toward silent allow', () => {
  it('a restricted attempt in ANY subject blocks a subject-less conversation', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([quiz({ subjectId: OTHER_SUBJECT, activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT' })]);
    const state = await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: null });
    expect(state.allowed).toBe(false);
  });

  it('a subject-less conversation with no active restricted attempt anywhere is allowed', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([]);
    const state = await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: null });
    expect(state.allowed).toBe(true);
  });

  it('a pending verification in ANY subject blocks a subject-less conversation', async () => {
    queryMock.mockResolvedValue({ rows: [{ concept_id: CONCEPT, quiz_session_id: 'qs-1' }] });
    const state = await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: null });
    expect(state.allowed).toBe(false);
    // unscoped query -- no subject join parameter.
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual([STUDENT]);
  });
});

describe('release test 11 / S4: restricted attempt in an UNRELATED subject never blocks this conversation', () => {
  it('active SOLO_CHECK in a different subject allows this (subject-bound) conversation', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([quiz({ subjectId: OTHER_SUBJECT, activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT' })]);
    const state = await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT });
    expect(state.allowed).toBe(true);
  });

  it('a pending verification in a different subject allows this conversation (subject-scoped SQL)', async () => {
    queryMock.mockResolvedValue({ rows: [] }); // the subject-scoped query itself excludes the other subject's row
    const state = await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT });
    expect(state.allowed).toBe(true);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/JOIN concepts/i);
    expect(params).toEqual([STUDENT, SUBJECT]);
  });
});

describe('release tests 12-16: unrestricted/inactive states allow', () => {
  it('PRACTICE same subject allows (release test 12)', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([quiz({ activityType: 'PRACTICE', evidenceMode: 'PRACTICE' })]);
    expect((await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT })).allowed).toBe(true);
  });
  it('REMEDIATION same subject allows (release test 13)', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([quiz({ activityType: 'REMEDIATION', evidenceMode: 'PRACTICE' })]);
    expect((await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT })).allowed).toBe(true);
  });
  it('completed assessment (never returned by getStudentActiveQuizzes) allows (release test 14)', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([]);
    expect((await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT })).allowed).toBe(true);
  });
  it('expired assessment (excluded by getStudentActiveQuizzes\' own expires_at filter) allows (release test 15)', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([]);
    expect((await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT })).allowed).toBe(true);
  });
  it('resolved verification (no pending row) allows (release test 16)', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    expect((await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT })).allowed).toBe(true);
  });
});

describe('canProvideInstructionalAssistance -- convenience boolean form', () => {
  it('mirrors getActiveInstructionRestriction.allowed', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([quiz({ activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT' })]);
    expect(await canProvideInstructionalAssistance({ studentId: STUDENT, subjectId: SUBJECT })).toBe(false);
  });
});

describe('release test 26: query cost bounded, independent of history size', () => {
  it('a restricted quiz session short-circuits before ever querying verification', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([quiz({ activityType: 'SOLO_CHECK', evidenceMode: 'INDEPENDENT' })]);
    await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT });
    expect(getStudentActiveQuizzesMock).toHaveBeenCalledTimes(1);
    expect(queryMock).not.toHaveBeenCalled();
  });
  it('with no active quiz session, exactly one bounded verification query follows -- never more', async () => {
    await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT });
    expect(getStudentActiveQuizzesMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
  it('the verification query is always LIMIT 1 -- existence only, never a full scan', async () => {
    await getActiveInstructionRestriction({ studentId: STUDENT, subjectId: SUBJECT });
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/LIMIT 1/i);
  });
});

describe('Phase 5-R4: getActiveRestrictedEvidenceForStudent -- global, subject/concept-INDEPENDENT lock', () => {
  it('takes exactly one argument (studentId) -- there is no subject/concept parameter to scope it with at all', () => {
    expect(getActiveRestrictedEvidenceForStudent.length).toBe(1);
  });

  const restricted: [string, string][] = [
    ['SOLO_CHECK', 'INDEPENDENT'],
    ['RETENTION_CHECK', 'INDEPENDENT'],
    ['TRANSFER', 'INDEPENDENT'],
    ['DIAGNOSTIC_CHECK', 'ASSESSMENT'],
    ['CUMULATIVE_ASSESSMENT', 'ASSESSMENT'],
    ['MOCK_EXAM', 'ASSESSMENT'],
  ];
  it.each(restricted)(
    'release tests 1-8: active %s (%s) in a subject UNRELATED to any nominal Tutor scope still blocks the student globally',
    async (activityType, evidenceMode) => {
      // No `subjectId`/`conceptId` is even passed to this function --
      // the quiz fixture is deliberately in a subject that no caller
      // ever names, proving the block does not depend on any subject
      // match at all.
      getStudentActiveQuizzesMock.mockResolvedValue([quiz({ subjectId: OTHER_SUBJECT, conceptId: 'unrelated-concept', conceptIds: ['unrelated-concept'], activityType, evidenceMode })]);
      const state = await getActiveRestrictedEvidenceForStudent(STUDENT);
      expect(state.allowed).toBe(false);
      expect(state.activityType).toBe(activityType);
    }
  );

  it('release test 9: pending SOLO_VERIFY in an unrelated subject/concept still blocks the student globally', async () => {
    queryMock.mockResolvedValue({ rows: [{ concept_id: 'unrelated-concept', quiz_session_id: 'qs-1' }] });
    const state = await getActiveRestrictedEvidenceForStudent(STUDENT);
    expect(state.allowed).toBe(false);
    expect(state.reason).toBe('ACTIVE_VERIFICATION');
    // The unscoped verification query never joins on subject at all.
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).not.toMatch(/JOIN concepts/i);
    expect(params).toEqual([STUDENT]);
  });

  it('release test 14: PRACTICE alone never triggers the global lock', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([quiz({ activityType: 'PRACTICE', evidenceMode: 'PRACTICE' })]);
    expect((await getActiveRestrictedEvidenceForStudent(STUDENT)).allowed).toBe(true);
  });
  it('release test 15: REMEDIATION alone never triggers the global lock', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([quiz({ activityType: 'REMEDIATION', evidenceMode: 'PRACTICE' })]);
    expect((await getActiveRestrictedEvidenceForStudent(STUDENT)).allowed).toBe(true);
  });
  it('release test 16: a completed assessment (never returned by getStudentActiveQuizzes) is allowed', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([]);
    expect((await getActiveRestrictedEvidenceForStudent(STUDENT)).allowed).toBe(true);
  });
  it('release test 17: an expired assessment (excluded by getStudentActiveQuizzes\' own expires_at filter) is allowed', async () => {
    getStudentActiveQuizzesMock.mockResolvedValue([]);
    expect((await getActiveRestrictedEvidenceForStudent(STUDENT)).allowed).toBe(true);
  });
  it('release test 18: a resolved verification (no pending row anywhere) is allowed', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    expect((await getActiveRestrictedEvidenceForStudent(STUDENT)).allowed).toBe(true);
  });

  it('release test 28: query cost bounded -- at most 2 reads, same as the underlying scoped function', async () => {
    await getActiveRestrictedEvidenceForStudent(STUDENT);
    expect(getStudentActiveQuizzesMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
