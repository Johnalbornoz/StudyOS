/**
 * LX-4P-PERF-R1B B13 -- offline question-quality benchmark harness.
 *
 * Compares, over a fixed corpus, three arms:
 *   BASELINE           -- historical Sonnet-generated questions (reuse
 *                         stored production artifacts; no fresh spend).
 *   LUNA_FIRST_PASS    -- Luna generation, first pass only (no gate).
 *   LUNA_TERRA_PIPELINE -- Luna -> quality gate -> Terra fallback (the
 *                         accepted-output arm).
 *
 * The runner is PURE orchestration: `generate` and `score` are injected,
 * so it runs deterministically in tests with stubs and against a real
 * provider when credentials exist. It never invents scores or latency.
 */
import type { GeneratedQuestion } from '@/services/quiz-generation.service';

export type BenchmarkArm = 'BASELINE' | 'LUNA_FIRST_PASS' | 'LUNA_TERRA_PIPELINE';

export interface BenchmarkCorpusItem {
  id: string;
  conceptId: string;
  /** Everything the generator/scorer needs -- prompt inputs, expected shape, etc. */
  spec: Record<string, unknown>;
  /** For the BASELINE arm: the stored historical question. */
  baselineQuestion?: GeneratedQuestion;
}

export interface GeneratedOutcome {
  question: GeneratedQuestion | null;
  model: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  latencyMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUSD: number | null;
}

/** A per-item score. Subjective dimensions MUST name their judge. */
export interface ItemScore {
  correctness: number | null;
  conceptAlignment: number | null;
  ambiguity: number | null;
  schemaValid: boolean;
  reasoningTypeValid: boolean;
  cognitiveLevelValid: boolean;
  distractorQuality: number | null;
  visualValid: boolean | null;
  /** who produced the subjective scores. */
  judge: string;
}

export interface ArmResult {
  arm: BenchmarkArm;
  n: number;
  accepted: number;
  fallbackRate: number | null;
  latency: { p50: number | null; p95: number | null; max: number | null };
  inputTokens: { p50: number | null; p95: number | null; total: number | null };
  outputTokens: { p50: number | null; p95: number | null; total: number | null };
  costUSD: { total: number | null; complete: boolean };
  quality: {
    correctness: number | null;
    conceptAlignment: number | null;
    ambiguity: number | null;
    schemaValidRate: number;
    reasoningTypeValidRate: number;
    cognitiveLevelValidRate: number;
    distractorQuality: number | null;
    visualValidRate: number | null;
  };
  perItem: { id: string; outcome: GeneratedOutcome; score: ItemScore | null }[];
}

export interface BenchmarkRunConfig {
  corpus: BenchmarkCorpusItem[];
  arms: BenchmarkArm[];
  generate: (arm: BenchmarkArm, item: BenchmarkCorpusItem) => Promise<GeneratedOutcome>;
  score: (arm: BenchmarkArm, item: BenchmarkCorpusItem, outcome: GeneratedOutcome) => Promise<ItemScore | null>;
}

function percentile(xs: number[], p: number): number | null {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const idx = Math.min(v.length - 1, Math.floor((p / 100) * v.length));
  return v[idx];
}
function mean(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function rate(bools: (boolean | null)[]): number {
  const v = bools.filter((b): b is boolean => typeof b === 'boolean');
  return v.length ? v.filter(Boolean).length / v.length : 0;
}

export async function runQualityBenchmark(cfg: BenchmarkRunConfig): Promise<ArmResult[]> {
  const results: ArmResult[] = [];
  for (const arm of cfg.arms) {
    const perItem: ArmResult['perItem'] = [];
    for (const item of cfg.corpus) {
      const outcome = await cfg.generate(arm, item);
      const score = await cfg.score(arm, item, outcome);
      perItem.push({ id: item.id, outcome, score });
    }
    const latencies = perItem.map((r) => r.outcome.latencyMs).filter((x): x is number => x !== null);
    const inTok = perItem.map((r) => r.outcome.inputTokens).filter((x): x is number => x !== null);
    const outTok = perItem.map((r) => r.outcome.outputTokens).filter((x): x is number => x !== null);
    const costs = perItem.map((r) => r.outcome.estimatedCostUSD).filter((x): x is number => x !== null);
    const accepted = perItem.filter((r) => r.outcome.question !== null).length;
    const fallbacks = perItem.filter((r) => r.outcome.fallbackUsed).length;

    results.push({
      arm,
      n: perItem.length,
      accepted,
      fallbackRate: perItem.length ? fallbacks / perItem.length : null,
      latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: latencies.length ? Math.max(...latencies) : null },
      inputTokens: { p50: percentile(inTok, 50), p95: percentile(inTok, 95), total: inTok.length ? inTok.reduce((a, b) => a + b, 0) : null },
      outputTokens: { p50: percentile(outTok, 50), p95: percentile(outTok, 95), total: outTok.length ? outTok.reduce((a, b) => a + b, 0) : null },
      costUSD: { total: costs.length ? costs.reduce((a, b) => a + b, 0) : null, complete: costs.length === perItem.length && perItem.length > 0 },
      quality: {
        correctness: mean(perItem.map((r) => r.score?.correctness ?? null)),
        conceptAlignment: mean(perItem.map((r) => r.score?.conceptAlignment ?? null)),
        ambiguity: mean(perItem.map((r) => r.score?.ambiguity ?? null)),
        schemaValidRate: rate(perItem.map((r) => r.score?.schemaValid ?? null)),
        reasoningTypeValidRate: rate(perItem.map((r) => r.score?.reasoningTypeValid ?? null)),
        cognitiveLevelValidRate: rate(perItem.map((r) => r.score?.cognitiveLevelValid ?? null)),
        distractorQuality: mean(perItem.map((r) => r.score?.distractorQuality ?? null)),
        visualValidRate: perItem.some((r) => typeof r.score?.visualValid === 'boolean')
          ? rate(perItem.map((r) => r.score?.visualValid ?? null))
          : null,
      },
      perItem,
    });
  }
  return results;
}

/**
 * B13 -- the BASELINE arm should reuse ANONYMIZED stored production
 * questions rather than spending tokens regenerating with Sonnet. Audit
 * note: `quiz_sessions.questions` (JSONB) holds historical Sonnet output;
 * a bounded read of completed sessions, stripped of learner identifiers,
 * seeds the corpus. This is a schema-shape note, not a live read here.
 */
export const BASELINE_SOURCE_NOTE =
  'BASELINE corpus should be seeded from anonymized quiz_sessions.questions (historical Sonnet output), not regenerated.';
