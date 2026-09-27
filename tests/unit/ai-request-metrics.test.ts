/**
 * AI request metrics -- every AI call is accounted per request/operation
 * (src/lib/ai/request-metrics.ts): the gateway records executions, the
 * provider adapters record every HTTP round-trip, and one
 * `[ai-request-summary]` per operation gives the stage breakdown
 * (pre-AI, AI wall vs summed provider time, post-AI, counts, failures,
 * fallbacks, duplicates, peak concurrency).
 *
 * Structural guard: EVERY API route that can reach the AI gateway (import
 * graph, transitively) must be wrapped with `withAiRequestMetrics`, so a
 * new AI route can never ship uninstrumented.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, dirname, normalize } from 'path';

vi.mock('@/lib/db', () => ({ db: { query: vi.fn().mockResolvedValue({ rows: [] }) }, query: vi.fn().mockResolvedValue({ rows: [] }) }));

import { runWithAiMetrics, summarizeAiScope, withAiRequestMetrics, recordAiStage } from '@/lib/ai/request-metrics';
import { executeAI } from '@/lib/ai/gateway';
import { callOpenAIChat } from '@/lib/ai/adapters/openai';

let logSpy: { mock: { calls: unknown[][] }; mockRestore: () => void };
const summaries = () =>
  logSpy.mock.calls.filter((c) => c[0] === '[ai-request-summary]').map((c) => JSON.parse(String(c[1])));

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}) as unknown as typeof logSpy;
});
afterEach(() => {
  logSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe('summary (pure)', () => {
  const call = (startedAtMs: number, durationMs: number, inputHash = `h${startedAtMs}`) => ({ provider: 'openai', model: 'm', startedAtMs, durationMs, ok: true, inputHash });

  it('sequential calls: parallelism 1, pre/post AI time, peak 1', () => {
    const s = summarizeAiScope({ operation: 'op', startedAtMs: 0, executions: [], providerCalls: [call(100, 1000), call(1100, 1000)], stages: {} }, 2300);
    expect(s).toMatchObject({ totalMs: 2300, preAiMs: 100, aiWallMs: 2000, aiProviderSumMs: 2000, parallelism: 1, peakConcurrency: 1, postAiMs: 200, providerCallCount: 2 });
  });

  it('concurrent chunks (Prove [4,3,3]): wall < sum, parallelism > 1, peak 3', () => {
    const s = summarizeAiScope({ operation: 'op', startedAtMs: 0, executions: [], providerCalls: [call(0, 15_000), call(0, 12_000), call(0, 12_000), call(15_000, 11_000)], stages: {} }, 26_000);
    expect(s.aiWallMs).toBe(26_000);
    expect(s.aiProviderSumMs).toBe(50_000);
    expect(s.parallelism).toBeCloseTo(1.92, 2);
    expect(s.peakConcurrency).toBe(3);
  });

  it('duplicate provider inputs and failures/fallbacks/validation failures are counted', () => {
    const exec = (over: object) => ({ capability: 'QUESTION_GENERATION', model: 'm', promptId: 'p', startedAtMs: 0, durationMs: 10, success: true, validationStatus: 'PASSED', fallbackUsed: false, ...over });
    const s = summarizeAiScope(
      {
        operation: 'op', startedAtMs: 0, stages: { persistence: 15 },
        executions: [exec({}), exec({ success: false, validationStatus: 'FAILED' }), exec({ fallbackUsed: true })],
        providerCalls: [call(0, 10, 'same'), call(20, 10, 'same'), call(40, 10, 'other')],
      },
      60,
    );
    expect(s).toMatchObject({ executionCount: 3, failedExecutions: 1, validationFailures: 1, fallbackExecutions: 1, duplicateProviderCalls: 1, stages: { persistence: 15 } });
    expect(s.byCapability.QUESTION_GENERATION.count).toBe(3);
  });
});

describe('recording every AI call', () => {
  const ok = { capability: 'OTHER' as const, risk: 'LOW_RISK' as const, provider: 'openai' as const, model: 'gpt-x', promptId: 'p', promptVersion: 'v1', validate: (r: string) => ({ valid: true as const, value: r }) };

  it('gateway executions inside a scope produce ONE summary with the right counts', async () => {
    await runWithAiMetrics('POST /api/test', async () => {
      await executeAI({ ...ok, call: async () => 'a' });
      await executeAI({ ...ok, call: async () => 'b' });
      recordAiStage('persistence', 5);
    });
    const [s] = summaries();
    expect(summaries()).toHaveLength(1);
    expect(s).toMatchObject({ operation: 'POST /api/test', executionCount: 2, outcome: 'OK', stages: { persistence: 5 } });
  });

  it('the per-call [ai] line carries the operation for correlation', async () => {
    await runWithAiMetrics('POST /api/corr', async () => {
      await executeAI({ ...ok, call: async () => 'a' });
    });
    const aiLine = logSpy.mock.calls.find((c) => c[0] === '[ai]');
    expect(JSON.parse(String(aiLine![1])).operation).toBe('POST /api/corr');
  });

  it('provider HTTP round-trips are measured at the adapter boundary (all AI traffic passes there)', async () => {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key-not-real';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200 })));
    await runWithAiMetrics('POST /api/provider', async () => {
      const msg = [{ role: 'user' as const, content: 'same input' }];
      await callOpenAIChat({ model: 'gpt-x', messages: msg }, new AbortController().signal);
      await callOpenAIChat({ model: 'gpt-x', messages: msg }, new AbortController().signal);
    });
    const [s] = summaries();
    expect(s).toMatchObject({ providerCallCount: 2, duplicateProviderCalls: 1 });
    expect(s.byModel['gpt-x'].count).toBe(2);
  });

  it('no AI -> no summary line; errors are reported with outcome ERROR and rethrown', async () => {
    await runWithAiMetrics('GET /api/none', async () => 1);
    expect(summaries()).toHaveLength(0);
    await expect(
      runWithAiMetrics('POST /api/err', async () => {
        await executeAI({ ...ok, call: async () => 'a' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(summaries()[0]).toMatchObject({ operation: 'POST /api/err', outcome: 'ERROR' });
  });

  it('nested/background scopes are independent; work after a scope closed is not attributed to it', async () => {
    let late: Promise<unknown> | null = null;
    await runWithAiMetrics('POST /api/outer', async () => {
      await executeAI({ ...ok, call: async () => 'a' });
      late = new Promise((r) => setTimeout(r, 5)).then(() => executeAI({ ...ok, call: async () => 'late' }));
      await runWithAiMetrics('BACKGROUND inner', async () => {
        await executeAI({ ...ok, call: async () => 'b' });
      });
    });
    await late;
    const ops = summaries().map((s) => [s.operation, s.executionCount]);
    expect(ops).toEqual([['BACKGROUND inner', 1], ['POST /api/outer', 1]]);
  });

  it('the wrapper preserves the handler result and arguments', async () => {
    const h = withAiRequestMetrics('GET /api/x', async (a: number, b: string) => `${a}${b}`);
    expect(await h(1, 'z')).toBe('1z');
  });
});

/* ------------------------------------------------------------------ */
/* Structural guard: every AI-reaching API route is instrumented        */
/* ------------------------------------------------------------------ */
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p.replace(process.cwd() + '/', ''));
  }
  return out;
}
const ALL = new Set(walk(join(process.cwd(), 'src')));
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join('src', spec.slice(2));
  else if (spec.startsWith('.')) base = normalize(join(dirname(from), spec));
  else return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) if (ALL.has(c)) return c;
  return null;
}
const graph = new Map<string, string[]>();
for (const f of ALL) {
  const src = readFileSync(f, 'utf-8');
  const deps: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const r = resolveSpec(f, m[1] ?? m[2]);
    if (r) deps.push(r);
  }
  graph.set(f, deps);
}
const SINKS = new Set(['src/lib/ai/gateway.ts', 'src/lib/ai/adapters/call-model.ts', 'src/lib/ai/adapters/openai.ts', 'src/lib/ai/adapters/anthropic.ts']);
const memo = new Map<string, boolean>();
function reachesAI(f: string, stack = new Set<string>()): boolean {
  if (memo.has(f)) return memo.get(f)!;
  if (SINKS.has(f)) return true;
  if (stack.has(f)) return false;
  stack.add(f);
  const r = (graph.get(f) ?? []).some((d) => reachesAI(d, stack));
  stack.delete(f);
  memo.set(f, r);
  return r;
}

describe('structural guard', () => {
  const routes = [...ALL].filter((f) => f.startsWith('src/app/api/') && f.endsWith('/route.ts'));
  const aiRoutes = routes.filter((r) => reachesAI(r));

  it('the import graph finds the AI routes (sanity)', () => {
    expect(aiRoutes).toContain('src/app/api/quizzes/generate-and-take/route.ts');
    expect(aiRoutes).toContain('src/app/api/tutor/message/route.ts');
    expect(aiRoutes.length).toBeGreaterThan(50);
  });

  it('every AI-reaching route exports ONLY wrapped handlers, named "<METHOD> <path>"', () => {
    const offenders: string[] = [];
    for (const r of aiRoutes) {
      const src = readFileSync(r, 'utf-8');
      if (/^export async function (GET|POST|PUT|PATCH|DELETE)\(/m.test(src)) offenders.push(`${r}: unwrapped handler`);
      const url = '/' + r.slice('src/app/'.length, -'/route.ts'.length);
      const wrapped = [...src.matchAll(/^export const (GET|POST|PUT|PATCH|DELETE) = withAiRequestMetrics\('(\w+) ([^']+)', handle(\w+)\);$/gm)];
      if (wrapped.length === 0) offenders.push(`${r}: no wrapped handler`);
      for (const w of wrapped) if (w[1] !== w[2] || w[1] !== w[4] || w[3] !== url) offenders.push(`${r}: bad operation name ${w[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every provider HTTP call goes through a measured adapter', () => {
    for (const f of ['src/lib/ai/adapters/openai.ts', 'src/lib/ai/adapters/anthropic.ts']) {
      const src = readFileSync(f, 'utf-8');
      const exported = [...src.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);
      for (const fn of exported) {
        const body = src.slice(src.indexOf(`export async function ${fn}(`));
        expect(body.slice(0, 400), `${f}:${fn}`).toMatch(/return measureProviderCall\(/);
      }
    }
    // no other module talks to a provider endpoint directly
    const direct = [...ALL].filter((f) => !f.startsWith('src/lib/ai/adapters/') && /api\.openai\.com|api\.anthropic\.com/.test(readFileSync(f, 'utf-8')));
    expect(direct).toEqual([]);
  });

  it('the gateway records every execution into the active scope', () => {
    expect(readFileSync('src/lib/ai/gateway.ts', 'utf-8')).toMatch(/logAIExecution\(execution\);\s*recordAiExecution\(\{/);
    expect(existsSync('src/lib/ai/request-metrics.ts')).toBe(true);
  });
});
