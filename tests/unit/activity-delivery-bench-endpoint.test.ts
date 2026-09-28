/**
 * /api/internal/delivery-bench -- DEV-only, fail-closed, synthetic learner only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ query: vi.fn(), deliver: vi.fn(), marker: vi.fn(), schedule: vi.fn(), release: vi.fn() }));

vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => h.query(...a) } }));
vi.mock('@/lib/auth', () => ({ verifyStudentAccess: vi.fn(async () => true) }));
vi.mock('@/lib/entitlements', () => ({ canUseCapability: vi.fn(async () => false) }));
vi.mock('@/lib/identity/canonical-user.service', () => ({ getCanonicalUserByClerkId: vi.fn(async () => null) }));
vi.mock('@/lib/pedagogical-decision', () => ({
  isCanonicalEngineV1Enabled: () => true,
  verifyV1PracticeLaunchMarker: (...a: any[]) => h.marker(...a),
  getCanonicalPedagogicalDecision: vi.fn(),
}));
vi.mock('@/services/activity-delivery.service', () => ({
  buildDeliveryInput: vi.fn(async (p: any) => ({ ...p, contract: { itemCount: p.itemCount } })),
  deliverCanonicalActivity: (...a: any[]) => h.deliver(...a),
}));
vi.mock('@/services/activity-delivery-worker.service', () => ({ scheduleDeliveryReplenishment: (...a: any[]) => h.schedule(...a) }));

import { POST } from '@/app/api/internal/delivery-bench/route';

const SECRET = 'y'.repeat(64);
const C = '11111111-1111-4111-8111-111111111111';
const call = (body: unknown, auth = `Bearer ${SECRET}`) =>
  POST(new Request('https://dev.example/api/internal/delivery-bench', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any);

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('VERCEL_TARGET_ENV', 'dev');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('STUDYUS_ENV', '');
  h.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM students WHERE clerk_id')) return { rows: [{ id: 'bench-student' }] };
    if (sql.includes('FROM concepts c JOIN subjects s')) return { rows: [] };
    return { rows: [] };
  });
});

describe('delivery-bench endpoint gates', () => {
  it('404 in Production and in Preview/Stage, whatever the secret', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'production');
    expect((await call({ action: 'status' })).status).toBe(404);
    vi.stubEnv('VERCEL_TARGET_ENV', 'preview'); vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await call({ action: 'status' })).status).toBe(404);
    vi.stubEnv('VERCEL_TARGET_ENV', 'dev'); vi.stubEnv('STUDYUS_ENV', 'production');
    expect((await call({ action: 'status' })).status).toBe(404);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('401 in DEV without or with a wrong secret; fails closed without CRON_SECRET', async () => {
    expect((await call({ action: 'status' }, '')).status).toBe(401);
    expect((await call({ action: 'status' }, 'Bearer nope')).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await call({ action: 'status' })).status).toBe(401);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('only the synthetic learner: resolved by its clerk id, and a foreign concept is refused', async () => {
    const res = await call({ action: 'launch', conceptId: C, activityType: 'PROVE', language: 'es' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'NOT_A_BENCH_CONCEPT' });
    expect(h.query.mock.calls[0]).toEqual([`SELECT id FROM students WHERE clerk_id = $1`, ['bench:activity-delivery']]);
    expect(h.query.mock.calls[1][1]).toEqual([C, 'bench-student']);
    expect(h.deliver).not.toHaveBeenCalled();
    expect((await call({ action: 'replenish', conceptId: C, language: 'es' })).status).toBe(404);
    expect(h.schedule).not.toHaveBeenCalled();
  });

  it('abandon is scoped to the synthetic learner', async () => {
    await call({ action: 'abandon', quizId: 'quiz-1' });
    const upd = h.query.mock.calls.find((c) => String(c[0]).startsWith('UPDATE quiz_sessions'))!;
    expect(upd[0]).toMatch(/WHERE id = \$1 AND student_id = \$2 AND status = 'active'/);
    expect(upd[1]).toEqual(['quiz-1', 'bench-student']);
  });

  it('launch measures the route path server-side and releases an emergency lock', async () => {
    h.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM students WHERE clerk_id')) return { rows: [{ id: 'bench-student' }] };
      if (sql.includes('FROM concepts c JOIN subjects s')) return { rows: [{ subject_id: 'sub' }] };
      return { rows: [] };
    });
    h.marker.mockResolvedValue({ canonicalActivityType: 'PROVE', canonicalRevision: 'r', pedagogicalPolicyVersion: 'v1', itemCount: { authorized: 10 }, difficulty: { min: 3, max: 4, target: 3 }, independence: true });
    h.deliver.mockResolvedValue({ status: 'EMERGENCY_REQUIRED', lock: { release: h.release }, timings: { lockMs: 1 }, bank: { available: 2, needed: 10 } });
    const body = await (await call({ action: 'launch', conceptId: C, activityType: 'PROVE', language: 'es' })).json();
    expect(body).toMatchObject({ status: 'EMERGENCY_REQUIRED', source: 'EMERGENCY_REQUIRED', aiCalls: 0, quizId: null });
    expect(typeof body.totalMs).toBe('number');
    expect(h.release).toHaveBeenCalledTimes(1);
  });
});
