/**
 * F0-S Finding C -- GET /api/test was a public, unauthenticated
 * database connectivity diagnostic (`SELECT NOW()`, raw error string
 * on failure) reachable in every environment including Production.
 * This suite proves it is unreachable in any Vercel-deployed
 * environment (Preview or Production both set VERCEL_ENV), while
 * remaining available for local development (VERCEL_ENV unset).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const testDBMock = vi.fn();
vi.mock('@/lib/db', () => ({ testDB: () => testDBMock() }));

import { GET } from '@/app/api/test/route';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  testDBMock.mockReset().mockResolvedValue({ ok: true, time: '2026-01-01T00:00:00Z' });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('F0-S Finding C -- /api/test is not a public production-like diagnostic', () => {
  it('production-like execution (VERCEL_ENV=production): denied without ever touching the database', async () => {
    process.env.VERCEL_ENV = 'production';
    const res: any = await GET();
    expect(res.status).toBe(404);
    expect(testDBMock).not.toHaveBeenCalled();
  });

  it('Preview execution (VERCEL_ENV=preview): denied without ever touching the database', async () => {
    process.env.VERCEL_ENV = 'preview';
    const res: any = await GET();
    expect(res.status).toBe(404);
    expect(testDBMock).not.toHaveBeenCalled();
  });

  it('a denied request never leaks database connectivity/error details', async () => {
    process.env.VERCEL_ENV = 'production';
    const res: any = await GET();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/ok|time|error.*ECONNREFUSED|postgres/i);
  });

  it('local development (VERCEL_ENV unset): remains usable for the purpose it was written for', async () => {
    delete process.env.VERCEL_ENV;
    const res: any = await GET();
    expect(res.status ?? 200).toBe(200);
    expect(testDBMock).toHaveBeenCalled();
  });
});
