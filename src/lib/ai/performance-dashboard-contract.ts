/**
 * LX-9 B33: AI PERFORMANCE DASHBOARD READ CONTRACT.
 *
 * Formalizes the data shape an admin/QA-only dashboard (never learner-
 * facing) would read to answer B29's questions for one learner action
 * ("what AI calls happened, in what order, which were parallel, which
 * model, how many tokens, how much cost, which fallback, which were
 * wasted, total latency") WITHOUT building the UI or a live DB query
 * layer yet -- B33 explicitly allows deferring the UI ("do not
 * necessarily build a full UI dashboard yet... formalize a data/read
 * contract"). Pure, additive aggregation over the SAME `AIRuntimeEvent`
 * shape every canonical capability already emits via
 * `recordRuntimeEvent` -- no new telemetry source, no new DB schema, no
 * new AI call. A future dashboard route feeds it a list of parsed
 * `[ai-runtime]` log lines (or, once B23's telemetry gaps are closed
 * across every capability, a DB-backed event store) and gets back
 * exactly these two views.
 */
import type { AIRuntimeEvent } from './runtime-event';
import type { AICapability } from './types';

/** B33 "by capability": calls / latency / tokens / cost / fallback / failure / first-pass success, aggregated across every event for one capability. */
export interface CapabilityPerformanceSummary {
  capability: AICapability;
  calls: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalCachedInputTokens: number;
  totalOutputTokens: number;
  /** Sum of every contributing event's own cost estimate -- null (never a partial guess) when ANY contributing event's own cost was incomplete. */
  totalEstimatedCostUSD: number | null;
  costComplete: boolean;
  fallbackCount: number;
  fallbackRate: number;
  /** Events whose quality gate rejected everything outright (qualityGateResult === 'REJECTED'). */
  failureCount: number;
  /** B11/B24 FIRST_PASS_ACCEPTANCE_RATE: accepted/attempted across non-fallback (Luna) attempts only -- a fallback attempt is, by definition, not a first pass. */
  firstPassAcceptanceCount: number;
  firstPassAttemptCount: number;
  firstPassAcceptanceRate: number | null;
}

/** B33 "by learner operation": total AI latency, blocking latency, AI cost, and the call graph for one logical operation (e.g. one quiz-generation attempt, correlated via `operationId`). */
export interface OperationCallGraphEntry {
  operationId: string;
  events: AIRuntimeEvent[];
  /** Sum of every event's latency -- the caller should take a max instead when it knows the events ran in parallel (B29 q3/q9); this contract does not itself know call topology, only what each event reported. */
  totalLatencyMs: number;
  totalEstimatedCostUSD: number | null;
  costComplete: boolean;
  fallbackUsed: boolean;
}

/** B30: a call whose result is suspected never to have been used by the learner-facing outcome. */
export interface WastedCallFinding {
  operationId: string;
  reason: string;
}

/**
 * B29/B33: one summary row per capability. A capability with zero
 * events is simply absent from the result -- never fabricated as a
 * zero-row. Cost/rate figures reflect only what the underlying events
 * themselves reported; nothing here re-derives token counts or prices
 * independently of `AIRuntimeEvent`.
 */
export function summarizeByCapability(events: AIRuntimeEvent[]): CapabilityPerformanceSummary[] {
  const byCapability = new Map<AICapability, AIRuntimeEvent[]>();
  for (const ev of events) {
    const list = byCapability.get(ev.capability) ?? [];
    list.push(ev);
    byCapability.set(ev.capability, list);
  }

  const summaries: CapabilityPerformanceSummary[] = [];
  for (const [capability, evs] of byCapability) {
    const calls = evs.length;
    const totalLatencyMs = evs.reduce((sum, e) => sum + e.latencyMs, 0);
    const totalInputTokens = evs.reduce((sum, e) => sum + (e.inputTokens ?? 0), 0);
    const totalCachedInputTokens = evs.reduce((sum, e) => sum + (e.cachedInputTokens ?? 0), 0);
    const totalOutputTokens = evs.reduce((sum, e) => sum + (e.outputTokens ?? 0), 0);
    const costComplete = evs.every((e) => e.costComplete);
    const totalEstimatedCostUSD = costComplete ? evs.reduce((sum, e) => sum + (e.estimatedCostUSD ?? 0), 0) : null;
    const fallbackCount = evs.filter((e) => e.fallbackUsed).length;
    const failureCount = evs.filter((e) => e.qualityGateResult === 'REJECTED').length;

    // Gated-generation events carry acceptedCount/rejectedCount; a
    // first-pass attempt is one that did NOT already use a fallback.
    const firstPassAttempts = evs.filter(
      (e) => !e.fallbackUsed && typeof e.acceptedCount === 'number' && typeof e.rejectedCount === 'number',
    );
    const firstPassAcceptanceCount = firstPassAttempts.reduce((sum, e) => sum + (e.acceptedCount ?? 0), 0);
    const firstPassAttemptCount = firstPassAttempts.reduce(
      (sum, e) => sum + (e.acceptedCount ?? 0) + (e.rejectedCount ?? 0),
      0,
    );

    summaries.push({
      capability,
      calls,
      totalLatencyMs,
      avgLatencyMs: calls > 0 ? totalLatencyMs / calls : 0,
      totalInputTokens,
      totalCachedInputTokens,
      totalOutputTokens,
      totalEstimatedCostUSD,
      costComplete,
      fallbackCount,
      fallbackRate: calls > 0 ? fallbackCount / calls : 0,
      failureCount,
      firstPassAcceptanceCount,
      firstPassAttemptCount,
      firstPassAcceptanceRate: firstPassAttemptCount > 0 ? firstPassAcceptanceCount / firstPassAttemptCount : null,
    });
  }
  return summaries;
}

/**
 * B29: groups events sharing an `operationId` into one call-graph entry
 * (e.g. a Luna generation attempt and its one bounded Terra fallback
 * for the same logical unit). Events with no `operationId` are not
 * meaningfully groupable and are omitted here -- a caller wanting
 * per-call detail for those should read the raw event list directly.
 */
export function groupByOperation(events: AIRuntimeEvent[]): OperationCallGraphEntry[] {
  const byOperation = new Map<string, AIRuntimeEvent[]>();
  for (const ev of events) {
    if (!ev.operationId) continue;
    const list = byOperation.get(ev.operationId) ?? [];
    list.push(ev);
    byOperation.set(ev.operationId, list);
  }

  const entries: OperationCallGraphEntry[] = [];
  for (const [operationId, evs] of byOperation) {
    const costComplete = evs.every((e) => e.costComplete);
    entries.push({
      operationId,
      events: evs,
      totalLatencyMs: evs.reduce((sum, e) => sum + e.latencyMs, 0),
      totalEstimatedCostUSD: costComplete ? evs.reduce((sum, e) => sum + (e.estimatedCostUSD ?? 0), 0) : null,
      costComplete,
      fallbackUsed: evs.some((e) => e.fallbackUsed),
    });
  }
  return entries;
}

/**
 * B30: flags an operation whose fallback attempt ran even though the
 * PRIMARY attempt already had an accepted, gate-passed result -- one of
 * B30's own named examples ("fallback launched after primary already
 * succeeded"). The canonical runtime's own control flow (gate-then-
 * fallback-only-if-insufficient) should make this impossible by
 * construction, so an empty result is the expected, healthy case; a
 * non-empty result is a genuine anomaly worth investigating, never a
 * routine finding to silence.
 */
export function detectWastedOperations(events: AIRuntimeEvent[]): WastedCallFinding[] {
  const findings: WastedCallFinding[] = [];
  for (const entry of groupByOperation(events)) {
    const primary = entry.events.find((e) => !e.fallbackUsed);
    const fallback = entry.events.find((e) => e.fallbackUsed);
    if (primary && fallback && primary.qualityGateResult === 'PASS' && (primary.acceptedCount ?? 0) > 0) {
      findings.push({
        operationId: entry.operationId,
        reason: 'fallback attempt ran after the primary attempt already had an accepted, gate-passed result',
      });
    }
  }
  return findings;
}
