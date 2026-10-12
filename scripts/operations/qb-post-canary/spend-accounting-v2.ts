/**
 * POST-CANARY -- SPEND ACCOUNTING, VERSION 2 (pure). FOR FUTURE RUNS, and the reconciliation of the Canary.
 *
 * THE DEFECT. The Canary's frozen report summed the GENERATION and REVIEW phases and left out the reviewer
 * pre-flight call: `metrics.json` and the header of `spend-ledger.json` say 29.913190 where the run log -- and the
 * budget guard, which read the run log -- say 29.973085.
 *
 * THE RULE. There is ONE authoritative total: earlier runs + every call line of the run log, of EVERY phase (a
 * finished call at its recorded cost, a call started and never finished at its worst case). Every other figure is
 * derived from it and must reconcile with it exactly; `assertReconciled` is a hard gate for a future run's report.
 */
export interface SpendLogLine { type: string; phase?: string; slotId?: string; costUsdAssumed?: number; worstCaseCostUsdAssumed?: number }
export interface AuthoritativeSpend { earlierRunsUsd: number; byPhase: Record<string, { calls: number; usd: number }>; runUsd: number; cumulativeUsd: number }
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;
/** The authoritative spend of a run, from its log: every phase, nothing left out. */
export function authoritativeSpend(lines: readonly SpendLogLine[], earlierRunsUsd: number): AuthoritativeSpend {
  const started = new Map<string, SpendLogLine>(), finished = new Map<string, SpendLogLine>();
  for (const l of lines) { const key = `${l.phase}|${l.slotId}`; if (l.type === 'CALL_STARTED') started.set(key, l); else if (l.type === 'CALL_FINISHED') finished.set(key, l); }
  const byPhase: Record<string, { calls: number; usd: number }> = {};
  for (const [key, s] of started) { const f = finished.get(key); const phase = String(s.phase); byPhase[phase] = byPhase[phase] ?? { calls: 0, usd: 0 }; byPhase[phase].calls += 1; byPhase[phase].usd += f ? Number(f.costUsdAssumed) : Number(s.worstCaseCostUsdAssumed); }
  for (const p of Object.values(byPhase)) p.usd = round6(p.usd);
  const runUsd = round6(Object.values(byPhase).reduce((n, p) => n + p.usd, 0));
  return { earlierRunsUsd: round6(earlierRunsUsd), byPhase, runUsd, cumulativeUsd: round6(earlierRunsUsd + runUsd) };
}
export interface ReconciliationSource { source: string; cumulativeUsd: number; differenceFromAuthoritativeUsd: number; reconciles: boolean; explanation: string | null }
export interface Reconciliation { authoritative: AuthoritativeSpend; sources: ReconciliationSource[]; reconciled: boolean }
/** Each reported figure against the authoritative one. A difference of more than a millionth of a dollar does not reconcile. */
export function reconcile(authoritative: AuthoritativeSpend, reported: ReadonlyArray<{ source: string; cumulativeUsd: number }>, explain: (source: string, difference: number) => string | null = () => null): Reconciliation {
  const sources = reported.map((r) => { const d = round6(r.cumulativeUsd - authoritative.cumulativeUsd); return { source: r.source, cumulativeUsd: round6(r.cumulativeUsd), differenceFromAuthoritativeUsd: d, reconciles: Math.abs(d) < 1e-6, explanation: Math.abs(d) < 1e-6 ? null : explain(r.source, d) }; });
  return { authoritative, sources, reconciled: sources.every((s) => s.reconciles) };
}
export class SpendNotReconciledError extends Error { constructor(public readonly reconciliation: Reconciliation) { super(`SPEND_NOT_RECONCILED: ${reconciliation.sources.filter((s) => !s.reconciles).map((s) => `${s.source} ${s.differenceFromAuthoritativeUsd}`).join('; ')}`); this.name = 'SpendNotReconciledError'; } }
/** THE HARD GATE of a future report: every reported total equals the authoritative one, or nothing is written. */
export function assertReconciled(r: Reconciliation): Reconciliation { if (!r.reconciled) throw new SpendNotReconciledError(r); return r; }
/** The figures a report of version 2 states: all of them the one authoritative total. */
export const spendFiguresV2 = (a: AuthoritativeSpend) => ({ ASSUMED_CUMULATIVE_SPEND_USD: a.cumulativeUsd, ledgerHeaderCumulativeUsd: a.cumulativeUsd, earlierRunsUsd: a.earlierRunsUsd, byPhase: a.byPhase, basis: 'ASSUMED prices; not an invoice' });
