import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
const connectMock = vi.fn();
vi.mock('@/lib/db', () => ({
  db: {
    query: (...args: any[]) => queryMock(...args),
    connect: (...args: any[]) => connectMock(...args),
  },
}));

const currentUserMock = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
  currentUser: (...args: any[]) => currentUserMock(...args),
}));

import { verifySubjectAccess, getOrCreateStudentId } from '@/lib/auth';

const STUDENT_ID = 'student-uuid-1';
const OTHER_STUDENT_ID = 'student-uuid-2';
const SUBJECT_ID = 'subject-uuid-1';
const CLERK_ID = 'clerk-user-1';

beforeEach(() => {
  queryMock.mockReset();
  connectMock.mockReset();
  currentUserMock.mockReset();
});

describe('verifySubjectAccess -- Phase 0C fix: uses the real subjects.student_id ownership model, not the nonexistent student_subjects table', () => {
  it('1. student owns the subject -> access allowed', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const result = await verifySubjectAccess(STUDENT_ID, SUBJECT_ID);
    expect(result).toBe(true);
  });

  it('2. student does not own the subject (belongs to someone else) -> access denied', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const result = await verifySubjectAccess(OTHER_STUDENT_ID, SUBJECT_ID);
    expect(result).toBe(false);
  });

  it('3. subject does not exist at all -> access denied', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const result = await verifySubjectAccess(STUDENT_ID, 'nonexistent-subject-id');
    expect(result).toBe(false);
  });

  it('4. a DB error -> fails closed (access denied), never throws to the caller', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection reset'));
    const result = await verifySubjectAccess(STUDENT_ID, SUBJECT_ID);
    expect(result).toBe(false);
  });

  it('5. the authorization query reads subjects.id / subjects.student_id, matching the live ownership model', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await verifySubjectAccess(STUDENT_ID, SUBJECT_ID);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/FROM\s+subjects/i);
    expect(sql).toMatch(/student_id/i);
    expect(params).toEqual([SUBJECT_ID, STUDENT_ID]);
  });

  it('6. no query anywhere in this function references the nonexistent student_subjects table', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await verifySubjectAccess(STUDENT_ID, SUBJECT_ID);
    for (const call of queryMock.mock.calls) {
      expect(String(call[0])).not.toMatch(/student_subjects/i);
    }
  });
});

describe('getOrCreateStudentId -- canonical dual-identity provisioning (students.id === profiles.id)', () => {
  function mockTransactionClient() {
    const clientQueryMock = vi.fn();
    const client = { query: clientQueryMock, release: vi.fn() };
    connectMock.mockResolvedValue(client);
    return clientQueryMock;
  }

  it('7. a brand-new student creates BOTH a students row and a profiles (+ student_profiles) row', async () => {
    // No existing students row for this clerk_id.
    queryMock.mockResolvedValueOnce({ rows: [] });
    currentUserMock.mockResolvedValue({
      primaryEmailAddress: { emailAddress: 'new@student.test' },
      emailAddresses: [],
      firstName: 'New',
      lastName: 'Student',
    });

    const clientQueryMock = mockTransactionClient();
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (/^BEGIN/i.test(sql) || /^COMMIT/i.test(sql)) return { rows: [] };
      if (/INSERT INTO students/i.test(sql)) return { rows: [{ id: STUDENT_ID }] };
      return { rows: [] };
    });

    const result = await getOrCreateStudentId(CLERK_ID);

    expect(result).toBe(STUDENT_ID);
    const calls = clientQueryMock.mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((sql) => /INSERT INTO students/i.test(sql))).toBe(true);
    expect(calls.some((sql) => /INSERT INTO profiles/i.test(sql))).toBe(true);
    expect(calls.some((sql) => /INSERT INTO student_profiles/i.test(sql))).toBe(true);
  });

  it('8. the profiles/student_profiles rows are written with the exact same UUID students.id returned', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    currentUserMock.mockResolvedValue({
      primaryEmailAddress: { emailAddress: 'new@student.test' },
      emailAddresses: [],
      firstName: 'New',
      lastName: 'Student',
    });

    const clientQueryMock = mockTransactionClient();
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (/INSERT INTO students/i.test(sql)) return { rows: [{ id: STUDENT_ID }] };
      return { rows: [] };
    });

    await getOrCreateStudentId(CLERK_ID);

    const profilesCall = clientQueryMock.mock.calls.find((c: any[]) => /INSERT INTO profiles/i.test(String(c[0])));
    const studentProfilesCall = clientQueryMock.mock.calls.find((c: any[]) => /INSERT INTO student_profiles/i.test(String(c[0])));
    expect(profilesCall?.[1]?.[0]).toBe(STUDENT_ID);
    expect(studentProfilesCall?.[1]?.[0]).toBe(STUDENT_ID);
  });

  it('9. an existing student with an already-matching profile is idempotent -- no duplicate students row is created, no Clerk lookup is needed', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: STUDENT_ID }] }); // SELECT id FROM students WHERE clerk_id
    queryMock.mockResolvedValueOnce({ rows: [] }); // ensureProfileRows: INSERT INTO profiles ... ON CONFLICT DO NOTHING (no-op)
    queryMock.mockResolvedValueOnce({ rows: [] }); // ensureProfileRows: INSERT INTO student_profiles ... ON CONFLICT DO NOTHING (no-op)

    const result = await getOrCreateStudentId(CLERK_ID);

    expect(result).toBe(STUDENT_ID);
    expect(currentUserMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled(); // no transaction -- the new-student path never runs
    const sqlCalls = queryMock.mock.calls.map((c: any[]) => String(c[0]));
    expect(sqlCalls.some((sql) => /INSERT INTO students/i.test(sql))).toBe(false);
  });

  it('10. an existing student whose profiles/student_profiles rows are missing is self-repaired by the same canonical path', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: STUDENT_ID }] }); // students row already exists
    queryMock.mockResolvedValueOnce({ rows: [{ id: STUDENT_ID }] }); // profiles INSERT ... ON CONFLICT DO NOTHING -- repairs the missing row
    queryMock.mockResolvedValueOnce({ rows: [{ id: STUDENT_ID }] }); // student_profiles INSERT ... ON CONFLICT DO NOTHING -- repairs the missing row

    const result = await getOrCreateStudentId(CLERK_ID);

    expect(result).toBe(STUDENT_ID);
    const sqlCalls = queryMock.mock.calls.map((c: any[]) => String(c[0]));
    expect(sqlCalls.some((sql) => /INSERT INTO profiles/i.test(sql))).toBe(true);
    expect(sqlCalls.some((sql) => /INSERT INTO student_profiles/i.test(sql))).toBe(true);
    // Every write uses ON CONFLICT DO NOTHING -- repair, never a duplicate/error on an existing row.
    const profilesSql = sqlCalls.find((sql) => /INSERT INTO profiles/i.test(sql))!;
    const studentProfilesSql = sqlCalls.find((sql) => /INSERT INTO student_profiles/i.test(sql))!;
    expect(profilesSql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
    expect(studentProfilesSql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
  });
});
