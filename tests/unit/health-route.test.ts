/**
 * IVG-F15-13 -- GET /api/health
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const testDBMock = vi.fn();
vi.mock('@/lib/db', () => ({ testDB: (...args: any[]) => testDBMock(...args) }));

describe('GET /api/health', () => {
  beforeEach(() => {
    testDBMock.mockReset();
    vi.resetModules();
  });

  it('returns 200 status ok when the database check succeeds', async () => {
    testDBMock.mockResolvedValueOnce({ ok: true, time: '2026-09-20T00:00:00.000Z' });

    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: 'ok', checks: { database: 'ok' } });
  });

  it('returns 503 status degraded when the database check fails', async () => {
    testDBMock.mockResolvedValueOnce({ ok: false, error: 'connection refused' });

    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ status: 'degraded', checks: { database: 'fail' } });
  });

  it('never exposes the underlying DB error detail in the response body', async () => {
    testDBMock.mockResolvedValueOnce({ ok: false, error: 'password authentication failed for user "realuser"' });

    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const serialized = JSON.stringify(await res.json());

    expect(serialized).not.toContain('realuser');
    expect(serialized).not.toContain('password');
  });
});
