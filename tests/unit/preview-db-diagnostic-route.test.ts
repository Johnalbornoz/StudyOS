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

const ALLOWED_KEYS = ['environment', 'deploymentSha', 'dbFingerprint', 'databaseName', 'usersTableExists', 'migrationLedgerExists', 'appliedMigrationCount'].sort();

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
    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] }) // users
      .mockResolvedValueOnce({ rows: [{ exists: true }] }) // schema_migrations
      .mockResolvedValueOnce({ rows: [{ c: 17 }] }); // COUNT(*)

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(ALLOWED_KEYS);
  });

  it('C. never exposes DATABASE_URL, hostname, username, password, port, or the raw connection string in any form', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://someuser:supersecretpw@real-preview-host.example.com:5432/verceldb';
    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ c: 17 }] });

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
    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ c: 17 }] });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.databaseName).toBe('verceldb');
    expect(body.usersTableExists).toBe(false);
    expect(body.appliedMigrationCount).toBe(17);
  });

  it('E. dbFingerprint is a deterministic, non-reversible 16-hex-char digest of hostname|databaseName', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@real-preview-host.example.com:5432/verceldb';
    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ c: 17 }] });

    const { createHash } = await import('crypto');
    const expected = createHash('sha256').update('real-preview-host.example.com|verceldb').digest('hex').slice(0, 16);

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    const res = await GET();
    const body = await res.json();

    expect(body.dbFingerprint).toBe(expected);
    expect(body.dbFingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('F. never issues a database write -- every query is a read (to_regclass / COUNT / SELECT)', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATABASE_URL = 'postgres://u:p@host.example.com:5432/db';
    queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ c: 17 }] });

    const { GET } = await import('@/app/api/diagnostics/preview-db/route');
    await GET();

    for (const call of queryMock.mock.calls) {
      const sql = String(call[0]).trim().toUpperCase();
      expect(sql.startsWith('SELECT')).toBe(true);
      expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE/);
    }
  });
});
