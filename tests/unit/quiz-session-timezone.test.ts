import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

import {
  storeQuiz,
  getQuiz,
  findResumableCanonicalProveSession,
  getStudentActiveQuizzes,
  cleanupExpiredQuizzes,
  QUIZ_SESSION_TTL_MINUTES,
} from '@/services/quiz-persistence.service';

const SERVICE_SRC = readFileSync(join(process.cwd(), 'src/services/quiz-persistence.service.ts'), 'utf-8');
const MIGRATION_SRC = readFileSync(join(process.cwd(), 'database/migrations/20261017_1000_quiz_sessions_timestamptz.sql'), 'utf-8');

const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  queryMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

async function storeQuizCallIn(tz: string): Promise<{ sql: string; params: any[] }> {
  process.env.TZ = tz;
  queryMock.mockResolvedValueOnce({ rows: [] });
  await storeQuiz('s1', 'c1', 'subj1', [{ conceptId: 'c1' } as any], 'es', 'canonical_prove');
  const [sql, params] = queryMock.mock.calls[queryMock.mock.calls.length - 1];
  return { sql, params };
}

describe('QUIZ_SESSION_TIMEZONE -- quiz_sessions timestamps never depend on the process timezone', () => {
  it('storeQuiz computes created_at/expires_at with the database now(), passing only the TTL in minutes', async () => {
    const { sql, params } = await storeQuizCallIn('America/Mexico_City');
    expect(sql).toMatch(/\$7, now\(\), now\(\) \+ make_interval\(mins => \$8\), \$9/);
    expect(params[7]).toBe(QUIZ_SESSION_TTL_MINUTES);
    expect(QUIZ_SESSION_TTL_MINUTES).toBe(45);
    expect(params.some((p) => p instanceof Date)).toBe(false);
    // 18 placeholders, 18 params -- the two timestamp params were removed, not left dangling.
    expect(params).toHaveLength(18);
    expect(Math.max(...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))).toBe(18);
  });

  it('storeQuiz sends identical SQL and params from a UTC-6 process and a UTC process', async () => {
    const local = await storeQuizCallIn('America/Mexico_City');
    const utc = await storeQuizCallIn('UTC');
    expect(local.sql).toBe(utc.sql);
    // params[0] is the quiz id (random suffix); everything else must match.
    expect(local.params.slice(1)).toEqual(utc.params.slice(1));
  });

  it('getQuiz decides expiry with the database clock, not by parsing expires_at in the process zone', async () => {
    process.env.TZ = 'America/Mexico_City';
    // expires_at as a UTC-6 process would mis-parse a naive timestamp: 6 h in the past.
    queryMock.mockResolvedValueOnce({ rows: [{ questions: [{ q: 1 }], status: 'active', is_expired: false, expires_at: new Date(Date.now() - 6 * 3600_000) }] });
    expect(await getQuiz('quiz-1')).toEqual([{ q: 1 }]);
    expect(queryMock.mock.calls[0][0]).toMatch(/\(now\(\) > expires_at\) AS is_expired/);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('getQuiz marks the session expired when the database says so', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ questions: [], status: 'active', is_expired: true }] });
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    expect(await getQuiz('quiz-1')).toBeNull();
    expect(queryMock.mock.calls[1][1]).toEqual(['expired', 'quiz-1']);
  });

  it('resume, active listing and cleanup compare against NOW() in SQL and bind no JS Date', async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    await findResumableCanonicalProveSession({
      studentId: 's1', conceptId: 'c1', language: 'es', policyVersion: 'v1',
      contract: { canonicalActivityType: 'PROVE', itemCount: { authorized: 10 }, difficulty: { min: 3, max: 5, target: 4 }, independence: true },
    });
    await getStudentActiveQuizzes('s1');
    await cleanupExpiredQuizzes();

    const [resumeSql, resumeParams] = queryMock.mock.calls[0];
    expect(resumeSql).toMatch(/qs\.expires_at > NOW\(\)/);
    expect(resumeSql).toMatch(/le\.timestamp >= qs\.created_at/);
    expect(queryMock.mock.calls[1][0]).toMatch(/expires_at > NOW\(\)/);
    expect(queryMock.mock.calls[2][0]).toMatch(/expires_at < NOW\(\)/);
    for (const [, params] of queryMock.mock.calls) {
      expect((params ?? []).some((p: unknown) => p instanceof Date)).toBe(false);
    }
    expect(resumeParams).toHaveLength(10);
  });

  it('quiz-persistence never derives a session timestamp from the process clock', () => {
    expect(SERVICE_SRC).not.toMatch(/new Date\(\)/);
    expect(SERVICE_SRC).not.toMatch(/Date\.now\(\)\s*[+-]/);
    expect(SERVICE_SRC).not.toMatch(/getTime\(\)\s*[+-]/);
  });
});

describe('QUIZ_SESSION_TIMEZONE -- migration 20261017_1000', () => {
  const alters = MIGRATION_SRC.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it.each(['created_at', 'completed_at', 'expires_at'])('converts %s to timestamptz, reading the old value explicitly as UTC', (column) => {
    expect(alters).toMatch(new RegExp(`ALTER COLUMN ${column} TYPE timestamp with time zone USING ${column} AT TIME ZONE 'UTC'`));
  });

  it('touches only quiz_sessions, in one statement, and never relies on the session TimeZone', () => {
    expect(alters.match(/ALTER TABLE/g)).toHaveLength(1);
    expect(alters).toMatch(/ALTER TABLE public\.quiz_sessions\b/);
    expect(alters).not.toMatch(/SET\s+(TIME\s+ZONE|timezone)/i);
    expect(alters).not.toMatch(/::timestamptz|::timestamp with time zone/i);
    expect(alters).not.toMatch(/\b(BEGIN|COMMIT)\b/);
  });
});
