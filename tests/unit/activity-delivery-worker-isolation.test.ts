/**
 * DEV_WORKER_ISOLATION -- a learner-facing request (or its after()) only
 * enqueues and dispatches; the AI generation pipeline runs only in the
 * protected worker endpoint's own invocation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const h = vi.hoisted(() => ({ afterFns: [] as Array<() => unknown>, runDeliveryWorker: vi.fn(), enqueue: vi.fn(), fetch: vi.fn() }));

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { h.afterFns.push(fn); },
}));
vi.mock('@/services/activity-delivery-worker.service', () => ({ runDeliveryWorker: (...a: any[]) => h.runDeliveryWorker(...a) }));

import { hasInternalBearer } from '@/lib/internal/internal-auth';
import { workerDispatchTarget, dispatchDeliveryWorker, WORKER_PATH } from '@/services/worker-dispatch.service';
import { POST as workerPOST } from '@/app/api/internal/generation-worker/route';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');
const SECRET = 'x'.repeat(64);

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

beforeEach(() => {
  h.afterFns.length = 0;
  h.runDeliveryWorker.mockReset().mockResolvedValue({ processed: 0, succeeded: 0, retried: 0, failed: 0 });
  vi.stubEnv('CRON_SECRET', SECRET);
});

describe('internal bearer', () => {
  it('fails closed without a configured secret, rejects a wrong one, accepts the right one', () => {
    expect(hasInternalBearer(`Bearer ${SECRET}`, {})).toBe(false);
    expect(hasInternalBearer(null, { CRON_SECRET: SECRET })).toBe(false);
    expect(hasInternalBearer('Bearer wrong', { CRON_SECRET: SECRET })).toBe(false);
    expect(hasInternalBearer(SECRET, { CRON_SECRET: SECRET })).toBe(false);
    expect(hasInternalBearer(`Bearer ${SECRET}`, { CRON_SECRET: SECRET })).toBe(true);
  });
});

describe('worker endpoint = the executor, in its own invocation', () => {
  const req = (auth?: string) => new Request('https://dev.example' + WORKER_PATH, { method: 'POST', headers: auth ? { authorization: auth, 'x-vercel-id': 'iad1::abc' } : {} }) as any;

  it('no secret / wrong secret -> 401 and nothing runs', async () => {
    expect((await workerPOST(req())).status).toBe(401);
    expect((await workerPOST(req('Bearer wrong'))).status).toBe(401);
    expect(h.afterFns).toHaveLength(0);
    expect(h.runDeliveryWorker).not.toHaveBeenCalled();
  });

  it('right secret -> 202 immediately; the drain runs after the response, in this invocation', async () => {
    const res = await workerPOST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(202);
    expect(h.runDeliveryWorker).not.toHaveBeenCalled();
    expect(h.afterFns).toHaveLength(1);
    await h.afterFns[0]();
    expect(h.runDeliveryWorker).toHaveBeenCalledTimes(1);
  });
});

describe('dispatch', () => {
  it('targets this deployment with the internal bearer and the protection bypass; nothing without secret/host', () => {
    expect(workerDispatchTarget({ VERCEL_URL: 'd.vercel.app' })).toBeNull();
    expect(workerDispatchTarget({ CRON_SECRET: SECRET })).toBeNull();
    expect(workerDispatchTarget({ CRON_SECRET: SECRET, VERCEL_URL: 'd.vercel.app', VERCEL_AUTOMATION_BYPASS_SECRET: 'b' })).toEqual({
      url: 'https://d.vercel.app/api/internal/generation-worker',
      headers: { authorization: `Bearer ${SECRET}`, 'x-vercel-protection-bypass': 'b' },
    });
  });

  it('reports DISPATCHED only on 202, and never throws', async () => {
    vi.stubEnv('VERCEL_URL', 'd.vercel.app');
    const f = vi.spyOn(globalThis, 'fetch');
    f.mockResolvedValueOnce(new Response(null, { status: 202 }));
    expect(await dispatchDeliveryWorker('t')).toBe('DISPATCHED');
    f.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await dispatchDeliveryWorker('t')).toBe('FAILED');
    f.mockRejectedValueOnce(new Error('net'));
    expect(await dispatchDeliveryWorker('t')).toBe('FAILED');
    vi.stubEnv('VERCEL_URL', '');
    expect(await dispatchDeliveryWorker('t')).toBe('UNAVAILABLE');
    f.mockRestore();
  });
});

describe('static guarantees', () => {
  it('the replenishment trigger enqueues + dispatches and never runs the worker in-process', () => {
    const W = read('src/services/activity-delivery-worker.service.ts');
    const trigger = W.slice(W.indexOf('export async function scheduleDeliveryReplenishment'));
    const body = trigger.slice(0, trigger.indexOf('\n}\n'));
    expect(body).toMatch(/enqueueGenerationJob\('PREPARE_INVENTORY'/);
    expect(body).toMatch(/await dispatchDeliveryWorker\('replenishment'\)/);
    expect(body).not.toMatch(/runDeliveryWorker|runGenerationWorker|generateActivityCandidates/);
  });

  it('in the app, only the worker endpoint executes the queue', () => {
    const offenders = walk(join(process.cwd(), 'src'))
      .map((p) => p.slice(process.cwd().length + 1))
      .filter((p) => /runDeliveryWorker\(|runGenerationWorker\(/.test(readFileSync(p, 'utf-8')))
      .filter((p) => !['src/services/generation-queue.service.ts', 'src/services/activity-delivery-worker.service.ts', 'src/app/api/internal/generation-worker/route.ts'].includes(p));
    expect(offenders).toEqual([]);
    expect(read('src/services/activity-delivery-worker.service.ts').match(/runGenerationWorker\(/g)).toHaveLength(1); // only inside runDeliveryWorker
  });
});
