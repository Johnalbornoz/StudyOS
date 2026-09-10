/**
 * LX-4P-PERF-R1C -- OPENAI RUNTIME REWIRE.
 *
 * The R1C delta over R1B (which built the infra) is: the actual feature
 * services now call `resolveModels` + `callModel` + `budgetFor` instead
 * of hard-coded Claude ids / `callAnthropicMessages`, the canonical
 * ~3-question Practice path runs the Luna-first Quality Gate, and the
 * Continue -> teaching-launch handoff (C12) removes the duplicate
 * canonical decision computation.
 *
 * These are INTERNAL-CONTRACT tests: model routing at the service
 * boundary, token budgets reaching `callModel`, strict JSON Schemas,
 * the fail-closed gate, the handoff validator, and "no Sonnet in the
 * canonical runtime". Live Luna/Terra quality + latency + token/cost
 * numbers remain BLOCKED on provider credentials -- see the report.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

// --- module-scope mocks for the C9/C10 service-boundary tests ---
const executeAIMock = vi.fn();
const callModelMock = vi.fn();
const queryMock = vi.fn();
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>();
  return { ...actual, executeAI: (...a: any[]) => executeAIMock(...a) };
});
vi.mock('@/services/rag.service', () => ({ retrieveContext: vi.fn().mockResolvedValue({ chunks: [] }) }));
vi.mock('@/lib/ai/adapters/call-model', () => ({ callModel: (...a: any[]) => callModelMock(...a) }));
vi.mock('@/lib/db', () => ({
  db: { query: (...a: any[]) => queryMock(...a) },
  query: (...a: any[]) => queryMock(...a),
}));

/* ============================================================== *
 * C1 / C16 -- no Claude id or Anthropic adapter in the canonical  *
 * learner runtime services (source contract).                     *
 * ============================================================== */
describe('LX-4P-PERF-R1C C16 -- SONNET IN CANONICAL RUNTIME = NONE', () => {
  const CANONICAL_SERVICES = [
    'src/services/quiz-generation.service.ts',
    'src/services/concept-explanation.service.ts',
    'src/services/teaching-content.service.ts',
    'src/services/question-localization.service.ts',
    'src/services/transfer.service.ts',
    'src/services/explain-defend.service.ts',
    'src/services/error-intelligence.service.ts',
    'src/services/misconception.service.ts',
    'src/services/gated-question-generation.service.ts',
    'src/services/question-quality-verifier.service.ts',
  ];

  for (const svc of CANONICAL_SERVICES) {
    it(`${svc.split('/').pop()} carries no hard-coded claude-* id and no Anthropic adapter import`, () => {
      const src = read(svc);
      expect(src).not.toMatch(/['"`]claude[-.][\w.-]+['"`]/); // no 'claude-sonnet-5' / "claude-haiku-4-5-..." literal
      expect(src).not.toMatch(/adapters\/anthropic/);
      expect(src).not.toMatch(/callAnthropicMessages/);
    });
  }

  it('each canonical service routes through resolveModels(...) rather than a literal provider/model', () => {
    for (const svc of CANONICAL_SERVICES) {
      expect(read(svc)).toMatch(/resolveModels\(/);
    }
  });
});

/* ============================================================== *
 * C1 / C9 / C10 -- model routing at the SERVICE boundary.         *
 * ============================================================== */
describe('LX-4P-PERF-R1C C9/C10 -- capability routing reaches the right model', () => {
  beforeEach(() => {
    executeAIMock.mockReset().mockResolvedValue({ result: [], execution: {} as any, provenance: {} as any });
    callModelMock.mockReset().mockResolvedValue({ text: '[]', raw: {}, provider: 'openai', model: 'gpt-5.6-luna' });
    queryMock.mockReset().mockResolvedValue({ rows: [{ label: 'Concept', subject_name: 'Subject' }], rowCount: 1 });
  });

  it('C10: free-text grading routes to Terra (evaluation is never sent to Luna for savings)', async () => {
    const { gradeAnswer } = await import('@/services/quiz-generation.service');
    executeAIMock.mockResolvedValueOnce({
      result: { correct: true, score: 1, feedback: 'ok', confidence: 0.9, errorType: null, reasoningValid: true },
      provenance: {} as any,
      execution: {} as any,
    });
    await gradeAnswer(
      { id: 'q1', conceptId: 'c1', type: 'short_answer', answerFormat: 'text', question: 'Q', correctAnswer: 'A', explanation: 'e', difficulty: 3 } as any,
      'A',
    );
    const opts = executeAIMock.mock.calls[0][0];
    expect(opts.capability).toBe('GRADING');
    expect(opts.model).toBe('gpt-5.6-terra');
    expect(opts.provider).toBe('openai');
    expect(opts.risk).toBe('HIGH_RISK');
  });

  it('C9: the contextual-help hint routes to Luna with the contextual_help token budget', async () => {
    const { generateQuestionHint } = await import('@/services/quiz-generation.service');
    const { budgetFor } = await import('@/lib/ai/token-budgets');
    executeAIMock.mockResolvedValueOnce({ result: ['h1', 'h2'], provenance: {} as any, execution: {} as any });
    await generateQuestionHint(
      { id: 'q1', conceptId: 'c1', type: 'multiple_choice', question: 'Q', options: [{ id: 'A', text: 'a' }], correctAnswer: 'A', explanation: 'e', difficulty: 3 } as any,
      'en',
    );
    const opts = executeAIMock.mock.calls[0][0];
    expect(opts.model).toBe('gpt-5.6-luna');
    expect(opts.provider).toBe('openai');
    // the call closure hands callModel the configured budget, not an ad-hoc number
    await opts.call(new AbortController().signal);
    const cm = callModelMock.mock.calls.at(-1)![0];
    expect(cm.maxTokens).toBe(budgetFor('contextual_help').maxOutputTokens);
    expect(cm.reasoningEffort).toBe(budgetFor('contextual_help').reasoningEffort);
    expect(typeof cm.user).toBe('string'); // provider-neutral single user message, not messages[]
  });
});

/* ============================================================== *
 * C4 -- the real strict JSON Schemas.                            *
 * ============================================================== */
describe('LX-4P-PERF-R1C C4 -- strict Structured-Output schemas', () => {
  it('the generated-question batch + guided-practice schemas are object-rooted and strict', async () => {
    const s = await import('@/lib/ai/schemas');
    for (const schema of [s.GENERATED_QUESTION_BATCH_SCHEMA, s.GUIDED_PRACTICE_SCHEMA, s.LOCALIZATION_PAYLOAD_SCHEMA, s.SEMANTIC_VERDICT_SCHEMA, s.QUESTION_QUALITY_VERDICT_SCHEMA]) {
      expect(schema.name).toBeTruthy();
      expect((schema.schema as any).type).toBe('object');
      expect((schema.schema as any).additionalProperties).toBe(false);
      expect(Array.isArray((schema.schema as any).required)).toBe(true);
    }
  });

  it('every nested object in the batch schema also pins additionalProperties:false (OpenAI strict-mode requirement)', async () => {
    const { GENERATED_QUESTION_BATCH_SCHEMA } = await import('@/lib/ai/schemas');
    const seen: boolean[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object') seen.push(node.additionalProperties === false);
      for (const v of Object.values(node)) walk(v);
    };
    walk(GENERATED_QUESTION_BATCH_SCHEMA.schema);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every(Boolean)).toBe(true);
  });
});

/* C5 / C6 / C7 -- the Luna-first Quality Gate for canonical Practice
 * (generateGatedPracticeBatch: PASS short-circuits, FAIL escalates once
 * to Terra, Terra FAIL fails closed, never a third attempt, never
 * Claude) is covered in tests/unit/lx4p-perf-r1c-gated-practice.test.ts
 * -- it must whole-module-mock @/services/quiz-generation.service, which
 * this file imports for real. */

/* ============================================================== *
 * C12 -- the Continue -> teaching-launch decision handoff.        *
 * Transport only; forge-resistant; falls back canonically.       *
 * ============================================================== */
describe('LX-4P-PERF-R1C C12 -- launch-teaching handoff validation', () => {
  const mkStore = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      _map: m,
    } as unknown as Storage & { _map: Map<string, string> };
  };

  const VIEW = {
    mode: 'MODEL',
    stages: ['EXPLAIN', 'MODEL', 'GUIDE'],
    showWorkedExample: true,
    scaffolding: 'GUIDED',
    helpAvailable: true,
    retryAllowed: true,
    explanationProminence: 'PRIMARY',
    reinforceCorrect: true,
    isProve: false,
    contractVersion: 1,
  };

  it('a fresh, same-concept, same-mode, intact view is transported (and consumed once)', async () => {
    const { writeLaunchTeachingHandoff, consumeLaunchTeachingHandoff } = await import('@/lib/lx/launch-teaching-handoff');
    const store = mkStore();
    writeLaunchTeachingHandoff({ conceptId: 'c1', mode: 'topic_practice', teachingExperience: VIEW as any, ts: 1_000 }, store);
    expect(consumeLaunchTeachingHandoff('c1', 'topic_practice', 1_500, store)).toMatchObject({ mode: 'MODEL' });
    // consumed -- a second read is empty
    expect(consumeLaunchTeachingHandoff('c1', 'topic_practice', 1_600, store)).toBeNull();
    expect(store._map.size).toBe(0);
  });

  it('wrong concept -> null (and still cleared)', async () => {
    const { writeLaunchTeachingHandoff, consumeLaunchTeachingHandoff } = await import('@/lib/lx/launch-teaching-handoff');
    const store = mkStore();
    writeLaunchTeachingHandoff({ conceptId: 'c1', mode: 'topic_practice', teachingExperience: VIEW as any, ts: 1_000 }, store);
    expect(consumeLaunchTeachingHandoff('c2', 'topic_practice', 1_500, store)).toBeNull();
    expect(store._map.size).toBe(0);
  });

  it('wrong mode / activity -> null', async () => {
    const { writeLaunchTeachingHandoff, consumeLaunchTeachingHandoff } = await import('@/lib/lx/launch-teaching-handoff');
    const store = mkStore();
    writeLaunchTeachingHandoff({ conceptId: 'c1', mode: 'retention_check', teachingExperience: VIEW as any, ts: 1_000 }, store);
    expect(consumeLaunchTeachingHandoff('c1', 'topic_practice', 1_500, store)).toBeNull();
  });

  it('stale (older than the max age) -> null -> caller does the canonical fetch', async () => {
    const { writeLaunchTeachingHandoff, consumeLaunchTeachingHandoff, LAUNCH_TEACHING_MAX_AGE_MS } = await import('@/lib/lx/launch-teaching-handoff');
    const store = mkStore();
    writeLaunchTeachingHandoff({ conceptId: 'c1', mode: 'topic_practice', teachingExperience: VIEW as any, ts: 1_000 }, store);
    expect(consumeLaunchTeachingHandoff('c1', 'topic_practice', 1_000 + LAUNCH_TEACHING_MAX_AGE_MS + 1, store)).toBeNull();
  });

  it('a forged / malformed view (wrong contract version, missing fields, non-object) is rejected -- cannot be forced into client pedagogy', async () => {
    const { consumeLaunchTeachingHandoff } = await import('@/lib/lx/launch-teaching-handoff');
    const cases = [
      JSON.stringify({ conceptId: 'c1', mode: 'topic_practice', ts: 1_000, teachingExperience: { ...VIEW, contractVersion: 999 } }),
      JSON.stringify({ conceptId: 'c1', mode: 'topic_practice', ts: 1_000, teachingExperience: { mode: 'MODEL' } }),
      JSON.stringify({ conceptId: 'c1', mode: 'topic_practice', ts: 1_000, teachingExperience: 'PRIMARY' }),
      JSON.stringify({ conceptId: 'c1', mode: 'topic_practice', ts: 1_000, teachingExperience: null }),
      'not json at all',
    ];
    for (const raw of cases) {
      const store = mkStore();
      store.setItem('lx.launchTeaching', raw);
      expect(consumeLaunchTeachingHandoff('c1', 'topic_practice', 1_200, store)).toBeNull();
      expect(store._map.size).toBe(0); // always consumed, never left to rot
    }
  });

  it('no handoff present -> null (the default path, unchanged)', async () => {
    const { consumeLaunchTeachingHandoff } = await import('@/lib/lx/launch-teaching-handoff');
    expect(consumeLaunchTeachingHandoff('c1', 'topic_practice', 1_000, mkStore())).toBeNull();
  });
});

/* ============================================================== *
 * C12 -- server side: /api/learning/continue derives the view    *
 * ONCE from the same canonical decision (source contract).       *
 * ============================================================== */
describe('LX-4P-PERF-R1C C12 -- server derives the launch Teaching Experience from the decision it already holds', () => {
  const SVC = read('src/services/learning-continuation.service.ts');
  it('resolveContinuation reuses its Phase-4 / first-touch decision + getTeachingIntent + deriveTeachingExperience (no second getBestLearningDecisionForConcept)', () => {
    expect(SVC).toMatch(/deriveLaunchTeachingExperience\(studentId, phase4Decision, session\)/);
    expect(SVC).toMatch(/deriveLaunchTeachingExperience\(studentId, bootstrap, session\)/);
    expect(SVC).toMatch(/getTeachingIntent\(studentId, decision\)/);
    expect(SVC).toMatch(/deriveTeachingExperience\(\{/);
    // it consumes the canonical EvidenceMode the session engine already fixed
    expect(SVC).toMatch(/evidenceMode: session\.evidenceMode/);
  });
  it('both LAUNCH results now carry teachingExperience', () => {
    const launches = SVC.match(/status: 'LAUNCH',[\s\S]*?\}/g) || [];
    expect(launches.length).toBeGreaterThanOrEqual(2);
    for (const l of launches) expect(l).toMatch(/teachingExperience/);
  });
  it('the client (ContinuationPanel) only TRANSPORTS it -- it never calls deriveTeachingExperience', () => {
    const panel = read('src/app/dashboard/quiz/ContinuationPanel.tsx');
    expect(panel).toMatch(/writeLaunchTeachingHandoff\(\{/);
    expect(panel).not.toMatch(/deriveTeachingExperience/);
  });
});

/* ============================================================== *
 * C13 -- bounded RAG reuse in the rewired generators.            *
 * ============================================================== */
describe('LX-4P-PERF-R1C C13 -- retrieved context is truncated to the capability budget before the prompt', () => {
  it('fitContextChunks is applied at every canonical generation + teaching context site', () => {
    const qg = read('src/services/quiz-generation.service.ts');
    expect((qg.match(/fitContextChunks\(context\.chunks,/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(read('src/services/concept-explanation.service.ts')).toMatch(/fitContextChunks\(context\.chunks,/);
    expect(read('src/services/teaching-content.service.ts')).toMatch(/fitContextChunks\(context\.chunks,/);
  });

  it('fitContextChunks never drops below one chunk and respects the char budget', async () => {
    const { fitContextChunks } = await import('@/lib/ai/token-budgets');
    const big = { text: 'x'.repeat(10_000) };
    expect(fitContextChunks([big, big, big], 6_000)).toHaveLength(1); // one oversized chunk still survives
    const small = Array.from({ length: 10 }, () => ({ text: 'y'.repeat(1_000) }));
    const kept = fitContextChunks(small, 6_000);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.reduce((n, c) => n + c.text.length, 0)).toBeLessThanOrEqual(6_000);
  });
});

/* ============================================================== *
 * C14 -- token budgets are LIVE in the services.                 *
 * ============================================================== */
describe('LX-4P-PERF-R1C C14 -- each rewired capability applies its configured budget', () => {
  const qg = read('src/services/quiz-generation.service.ts');
  it('question generation call sites pass a budgetFor(...) reasoningEffort into callModel', () => {
    expect(qg).toMatch(/budgetFor\('question_generation_chunk'\)\.reasoningEffort/);
    expect(qg).toMatch(/budgetFor\('question_generation_slot'\)/);
  });
  it('explanation + guided practice pass their maxOutputTokens budget', () => {
    expect(read('src/services/concept-explanation.service.ts')).toMatch(/budgetFor\('concept_explanation'\)/);
    expect(read('src/services/teaching-content.service.ts')).toMatch(/budgetFor\('guided_practice'\)/);
  });
});
