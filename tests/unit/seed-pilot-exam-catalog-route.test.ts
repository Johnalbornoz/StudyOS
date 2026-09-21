/**
 * F15-C1 -- POST /api/diagnostics/seed-pilot-exam-catalog (temporary,
 * Preview-only, strongly-authenticated trigger).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const runPilotExamCatalogSeedMock = vi.fn();
vi.mock('@/lib/assessment/pilot-catalog-seed.service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/assessment/pilot-catalog-seed.service')>('@/lib/assessment/pilot-catalog-seed.service');
  return { ...actual, runPilotExamCatalogSeed: (...args: any[]) => runPilotExamCatalogSeedMock(...args) };
});

const ORIGINAL_ENV = { ...process.env };
const TOKEN = 'test-only-fixture-token-not-a-real-secret-0123456789abcdef';

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://studyus.test/api/diagnostics/seed-pilot-exam-catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as any;
}

describe('POST /api/diagnostics/seed-pilot-exam-catalog', () => {
  beforeEach(() => {
    runPilotExamCatalogSeedMock.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('A. returns 404 outside Preview even with a correct token', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.SEED_TRIGGER_TOKEN = TOKEN;
    const { POST } = await import('@/app/api/diagnostics/seed-pilot-exam-catalog/route');
    const res = await POST(request({ write: false }, { 'x-seed-trigger-token': TOKEN }));
    expect(res.status).toBe(404);
    expect(runPilotExamCatalogSeedMock).not.toHaveBeenCalled();
  });

  it('B. fails closed with 500 if the server has no trigger token configured at all', async () => {
    process.env.VERCEL_ENV = 'preview';
    delete process.env.SEED_TRIGGER_TOKEN;
    const { POST } = await import('@/app/api/diagnostics/seed-pilot-exam-catalog/route');
    const res = await POST(request({ write: false }, { 'x-seed-trigger-token': TOKEN }));
    expect(res.status).toBe(500);
    expect(runPilotExamCatalogSeedMock).not.toHaveBeenCalled();
  });

  it('C. returns 401 with no token header', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.SEED_TRIGGER_TOKEN = TOKEN;
    const { POST } = await import('@/app/api/diagnostics/seed-pilot-exam-catalog/route');
    const res = await POST(request({ write: false }));
    expect(res.status).toBe(401);
    expect(runPilotExamCatalogSeedMock).not.toHaveBeenCalled();
  });

  it('D. returns 401 with an incorrect token', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.SEED_TRIGGER_TOKEN = TOKEN;
    const { POST } = await import('@/app/api/diagnostics/seed-pilot-exam-catalog/route');
    const res = await POST(request({ write: false }, { 'x-seed-trigger-token': 'wrong-token' }));
    expect(res.status).toBe(401);
    expect(runPilotExamCatalogSeedMock).not.toHaveBeenCalled();
  });

  it('E. accepts a correct token and defaults to dry-run when write is omitted', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.SEED_TRIGGER_TOKEN = TOKEN;
    runPilotExamCatalogSeedMock.mockResolvedValue({ write: false, plan: [] });
    const { POST } = await import('@/app/api/diagnostics/seed-pilot-exam-catalog/route');
    const res = await POST(request({}, { 'x-seed-trigger-token': TOKEN }));
    expect(res.status).toBe(200);
    expect(runPilotExamCatalogSeedMock).toHaveBeenCalledWith(false);
  });

  it('F. accepts a correct token and passes write=true only when explicitly requested', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.SEED_TRIGGER_TOKEN = TOKEN;
    runPilotExamCatalogSeedMock.mockResolvedValue({ write: true, plan: [] });
    const { POST } = await import('@/app/api/diagnostics/seed-pilot-exam-catalog/route');
    const res = await POST(request({ write: true }, { 'x-seed-trigger-token': TOKEN }));
    expect(res.status).toBe(200);
    expect(runPilotExamCatalogSeedMock).toHaveBeenCalledWith(true);
  });

  it('G. never echoes the trigger token or any client-supplied arbitrary id in the response', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.SEED_TRIGGER_TOKEN = TOKEN;
    runPilotExamCatalogSeedMock.mockResolvedValue({ write: false, plan: [] });
    const { POST } = await import('@/app/api/diagnostics/seed-pilot-exam-catalog/route');
    const res = await POST(request({ write: false, arbitraryClientId: 'should-be-ignored' }, { 'x-seed-trigger-token': TOKEN }));
    const serialized = JSON.stringify(await res.json());
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('arbitraryClientId');
    // The route only ever forwards `write` from the body -- confirm no
    // other field reached the service call.
    expect(runPilotExamCatalogSeedMock).toHaveBeenCalledWith(false);
    expect(runPilotExamCatalogSeedMock.mock.calls[0]).toHaveLength(1);
  });

  it('H. returns 409 with the abort message when the seed aborts, never a 200', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.SEED_TRIGGER_TOKEN = TOKEN;
    const { AbortSeed } = await import('@/lib/assessment/pilot-catalog-seed.service');
    runPilotExamCatalogSeedMock.mockRejectedValue(new AbortSeed('missing academic data'));
    const { POST } = await import('@/app/api/diagnostics/seed-pilot-exam-catalog/route');
    const res = await POST(request({ write: true }, { 'x-seed-trigger-token': TOKEN }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ aborted: true, message: 'missing academic data' });
  });
});
