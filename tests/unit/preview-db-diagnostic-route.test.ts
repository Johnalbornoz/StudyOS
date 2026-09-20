/**
 * F15-C1 -- GET /api/diagnostics/preview-db (temporary, Preview-only).
 *
 * Proves the three hard safety requirements this route exists under:
 * (1) unavailable outside Preview, (2) no credential/hostname/
 * connection-string ever appears in the response, (3) only the closed
 * set of safe fields is ever returned.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...args: any[]) => queryMock(...args) } }));

const ALLOWED_KEYS = [
  'environment',
  'deploymentSha',
  'dbFingerprint',
  'databaseName',
  'usersTableExists',
  'migrationLedgerExists',
  'appliedMigrationCount',
  'currentSchema',
  'searchPath',
  'publicTableCount',
  'publicTableNames',
  'migrationIds',
  'userRolesTableExists',
  'studentsTableExists',
  'institutionsTableExists',
  'schemaMigrationsTableExists',
].sort();

// Order matches the route's own Promise.all + follow-up queries:
// users, schema_migrations(ledger), user_roles, students, institutions,
// current_schema(), search_path, information_schema.tables,
// then (if ledger exists) COUNT(*) and the ordered migrationIds SELECT.
function mockHappyPathQueries(overrides: Partial<{ ledgerExists: boolean; tableNames: string[]; migrationRows: Array<{ version: string; name: string; applied_at: string }> }> = {}) {
  const ledgerExists = overrides.ledgerExists ?? true;
  const tableNames = overrides.tableNames ?? ['users', 'schema_migrations', 'students', 'institutions'];
  const migrationRows =
    overrides.migrationRows ??
    ([{ version: '20260918_1000_f0s_ai_global_limits', name: 'f0s_ai_global_limits', applied_at: '2026-09-18T10:00:00.000Z' }] as Array<{
      version: string;
      name: string;
      applied_at: string;
    }>);

  queryMock
    .mockResolvedValueOnce({ rows: [{ exists: true }] }) // users
    .mockResolvedValueOnce({ rows: [{ exists: ledgerExists }] }) // schema_migrations
    .mockResolvedValueOnce({ rows: [{ exists: true }] }) // user_roles
    .mockResolvedValueOnce({ rows: [{ exists: true }] }) // students
    .mockResolvedValueOnce({ rows: [{ exists: true }] }) // institutions
    .mockResolvedValueOnce({ rows: [{ schema: 'public' }] }) // current_schema()
    .mockResolvedValueOnce({ rows: [{ search_path: '"$user", public' }] }) // search_path
    .mockResolvedValueOnce({ rows: tableNames.map((table_name) => ({ table_name })) }); // information_schema.tables

  if (ledgerExists) {
    queryMock
      .mockResolvedValueOnce({ rows: [{ c: migrationRows.length }] }) // COUNT(*)
      .mockResolvedValueOnce({ rows: migrationRows }); // ordered migrationIds
  }
}

const ORIGINAL_ENV = { ...process.env };

describe('GET /api/diagnostics/preview-db', () => {
  beforeEach(() => {
    queryMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('A. returns 404 outside Preview (production)', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DATABASE_URL = 'postgres://user:supersecretpw@real-preview-host.example.com:5432/verceldb';
    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('A2. returns 404 outside Preview (development / unset)', async () => {
    delete process.env.VERCEL_ENV;
    process.env.DATABASE_URL = 'postgres://user:supersecretpw@real-preview-host.example.com:5432/verceldb';
    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('B. on Preview, returns ONLY the closed set of safe fields -- nothing else', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://user:supersecretpw@real-preview-host.example.com:5432/verceldb';
    process.env.VERCEL_GIT_COMMIT_SHA = '860028aa187c479c89eac04e80fcd1defa6f06ea';
    mockHappyPathQueries();

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(ALLOWED_KEYS);
  });

  it('C. never exposes DATABASE_URL, hostname, username, password, port, or the raw connection string in any form', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://someuser:supersecretpw@real-preview-host.example.com:5432/verceldb';
    mockHappyPathQueries();

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const serialized = JSON.stringify(await res.json());

    expect(serialized).not.toContain('supersecretpw');
    expect(serialized).not.toContain('someuser');
    expect(serialized).not.toContain('real-preview-host.example.com');
    expect(serialized).not.toContain('5432');
    expect(serialized).not.toContain(process.env.DATABASE_URL);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('D. databaseName is the bare database name only (not the full connection string)', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://someuser:supersecretpw@real-preview-host.example.com:5432/verceldb';
    mockHappyPathQueries({
      migrationRows: Array.from({ length: 17 }, (_, i) => ({
        version: `20260901_1000_migration_${String(i).padStart(2, '0')}`,
        name: `migration_${i}`,
        applied_at: new Date(Date.UTC(2026, 8, 1 + i, 10, 0, 0)).toISOString(),
      })),
    });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.databaseName).toBe('verceldb');
    expect(body.appliedMigrationCount).toBe(17);
  });

  it('D2. usersTableExists reflects a missing users table independently of the ledger', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://someuser:supersecretpw@real-preview-host.example.com:5432/verceldb';
    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // users -- MISSING
      .mockResolvedValueOnce({ rows: [{ exists: true }] }) // schema_migrations -- present
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // user_roles
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // students
      .mockResolvedValueOnce({ rows: [{ exists: false }] }) // institutions
      .mockResolvedValueOnce({ rows: [{ schema: 'public' }] })
      .mockResolvedValueOnce({ rows: [{ search_path: '"$user", public' }] })
      .mockResolvedValueOnce({ rows: [{ table_name: 'schema_migrations' }] })
      .mockResolvedValueOnce({ rows: [{ c: 15 }] })
      .mockResolvedValueOnce({
        rows: [
          { version: '20260831_1400_ai_execution_and_decision_audit', name: 'ai_execution_and_decision_audit', applied_at: '2026-08-31T14:00:00.000Z' },
        ],
      });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.usersTableExists).toBe(false);
    expect(body.schemaMigrationsTableExists).toBe(true);
    expect(body.appliedMigrationCount).toBe(15);
    expect(body.migrationIds).toHaveLength(1);
    expect(body.migrationIds[0]).toEqual({
      version: '20260831_1400_ai_execution_and_decision_audit',
      name: 'ai_execution_and_decision_audit',
      appliedAt: '2026-08-31T14:00:00.000Z',
    });
  });

  it('E. dbFingerprint is a deterministic, non-reversible 16-hex-char digest of hostname|databaseName', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@real-preview-host.example.com:5432/verceldb';
    mockHappyPathQueries();

    const { createHash } = await import('crypto');
    const expected = createHash('sha256').update('real-preview-host.example.com|verceldb').digest('hex').slice(0, 16);

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.dbFingerprint).toBe(expected);
    expect(body.dbFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('F. never issues a database write -- every query is a read (to_regclass / COUNT / SELECT / SHOW-equivalent)', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@host.example.com:5432/db';
    mockHappyPathQueries();

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    await GET();

    for (const call of queryMock.mock.calls) {
      const sql = String(call[0]).trim().toUpperCase();
      expect(sql.startsWith('SELECT')).toBe(true);
      expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE/);
    }
  });

  it('G. publicTableNames/currentSchema/searchPath never contain credential-shaped values', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://someuser:supersecretpw@real-preview-host.example.com:5432/verceldb';
    mockHappyPathQueries({ tableNames: ['users', 'schema_migrations', 'user_roles', 'students', 'institutions'] });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(Array.isArray(body.publicTableNames)).toBe(true);
    expect(body.publicTableCount).toBe(body.publicTableNames.length);
    expect(typeof body.currentSchema).toBe('string');
    expect(typeof body.searchPath).toBe('string');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('supersecretpw');
    expect(serialized).not.toContain('real-preview-host.example.com');
  });

  it('H. migrationIds is ordered by applied_at and only exposes version/name/appliedAt', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@host.example.com:5432/db';
    mockHappyPathQueries({
      migrationRows: [
        { version: '20260918_1000_f0s_ai_global_limits', name: 'f0s_ai_global_limits', applied_at: '2026-09-18T10:00:00.000Z' },
        { version: '20260919_1000_f1_unified_identity', name: 'f1_unified_identity', applied_at: '2026-09-19T10:00:00.000Z' },
      ],
    });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.migrationIds).toEqual([
      { version: '20260918_1000_f0s_ai_global_limits', name: 'f0s_ai_global_limits', appliedAt: '2026-09-18T10:00:00.000Z' },
      { version: '20260919_1000_f1_unified_identity', name: 'f1_unified_identity', appliedAt: '2026-09-19T10:00:00.000Z' },
    ]);
    for (const entry of body.migrationIds) {
      expect(Object.keys(entry).sort()).toEqual(['appliedAt', 'name', 'version']);
    }
  });
});
