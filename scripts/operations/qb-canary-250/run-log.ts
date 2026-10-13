/**
 * QUESTION FACTORY CANARY 250 -- the RUN LOG: one append-only record that is both the recording and the spend ledger
 * (no network, no clock; the only IO is the `append` function it is given). FROZEN.
 *
 * ONE CALL PER SLOT AND PHASE, BY CONSTRUCTION. A call is made in two steps, and both are lines of the log:
 *     CALL_STARTED   written BEFORE the request leaves, with the worst-case cost of the call
 *     CALL_FINISHED  written when the provider answered or the transport failed
 * `startCall` refuses a slot that already has ANY line for that phase. So a slot can never be called twice -- not by
 * a resumed run, not by a second process reading the same log, not after a crash.
 *
 * THE PRE-STATED RULE FOR A CRASH. A CALL_STARTED with no CALL_FINISHED means the process died while the request was
 * out. That slot is a PROVIDER_FAILURE (NO_RESPONSE_RECORDED), it is charged at its worst case, and it is not
 * called again.
 *
 * A slot the budget refused is closed with NOT_CALLED (BUDGET_STOP): terminal, never called later.
 */
import type { CallUsage } from '../qb-r2d/budget';

/** PREFLIGHT is the one call that checks the reviewer's request shape on a stand-in before any slot is reviewed. It is not a slot. */
export type Phase = 'GENERATION' | 'REVIEW' | 'PREFLIGHT';
export type CallStatus = 'WELL_FORMED' | 'MALFORMED' | 'TRANSPORT_ERROR' | 'REQUEST_REJECTED';
export interface FreezeStamp { freezeCommitSha: string; manifestHash: string }
export interface RunHeaderLine { type: 'RUN'; kind: 'QB_CANARY_250_RUN_LOG'; label: string; runId: string; startedAt: string; freeze: FreezeStamp; parameters: Record<string, unknown> }
export interface CallStartedLine { type: 'CALL_STARTED'; phase: Phase; slotId: string; requestHash: string; at: string; provider: string; requestedModel: string; maxOutputTokens: number; inputTokenUpperBound: number; worstCaseCostUsdAssumed: number }
export interface CallFinishedLine {
  type: 'CALL_FINISHED'; phase: Phase; slotId: string; requestHash: string; at: string; status: CallStatus; detail: string | null;
  servedModel: string | null; responseId: string | null; finishReason: string | null; usage: CallUsage | null; usageSource: 'PROVIDER_USAGE_RESPONSE' | 'NOT_REPORTED_CHARGED_AT_WORST_CASE'; costUsdAssumed: number; rawText: string;
}
export interface NotCalledLine { type: 'NOT_CALLED'; phase: Phase; slotId: string; at: string; reason: 'BUDGET_STOP'; detail: string }
export type RunLogLine = RunHeaderLine | CallStartedLine | CallFinishedLine | NotCalledLine;

export class SlotAlreadyCalledError extends Error {
  constructor(public readonly phase: Phase, public readonly slotId: string, public readonly found: string) { super(`SLOT_ALREADY_HAS_A_${phase}_RECORD: ${slotId} (${found})`); this.name = 'SlotAlreadyCalledError'; }
}
export class RunLogError extends Error { constructor(public readonly code: string, detail = '') { super(detail ? `${code}: ${detail}` : code); this.name = 'RunLogError'; } }

/** What a slot's phase came to. */
export type SlotOutcome =
  | { state: 'NOT_RUN' }
  | { state: 'NOT_CALLED_BUDGET_STOP'; line: NotCalledLine }
  | { state: 'NO_RESPONSE_RECORDED'; started: CallStartedLine }
  | { state: 'FINISHED'; started: CallStartedLine; finished: CallFinishedLine };

export class RunLog {
  readonly lines: RunLogLine[];
  private readonly byKey = new Map<string, RunLogLine[]>();
  constructor(lines: readonly RunLogLine[] = [], private readonly append: (line: RunLogLine) => void = () => undefined) {
    this.lines = [];
    for (const l of lines) this.index(l);
  }
  static parse(text: string): RunLogLine[] { return text.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as RunLogLine); }
  static serializeLine(line: RunLogLine): string { return `${JSON.stringify(line)}\n`; }
  private index(l: RunLogLine): void {
    if (l.type === 'RUN') { if (this.lines.some((x) => x.type === 'RUN')) throw new RunLogError('RUN_HEADER_REPEATED'); if (this.lines.length > 0) throw new RunLogError('RUN_HEADER_NOT_FIRST'); this.lines.push(l); return; }
    const key = `${l.phase}|${l.slotId}`;
    const have = this.byKey.get(key) ?? [];
    if (l.type === 'CALL_FINISHED') { if (have.length !== 1 || have[0].type !== 'CALL_STARTED') throw new RunLogError('CALL_FINISHED_WITHOUT_ONE_CALL_STARTED', key); if ((have[0] as CallStartedLine).requestHash !== l.requestHash) throw new RunLogError('CALL_FINISHED_FOR_ANOTHER_REQUEST', key); }
    else if (have.length > 0) throw new SlotAlreadyCalledError(l.phase, l.slotId, have.map((x) => x.type).join('+'));
    this.byKey.set(key, [...have, l]);
    this.lines.push(l);
  }
  private write(l: RunLogLine): void { this.index(l); this.append(l); }
  header(): RunHeaderLine | null { const h = this.lines[0]; return h && h.type === 'RUN' ? h : null; }
  begin(h: RunHeaderLine): void { this.write(h); }
  /** Refuses any slot that already has a line for this phase. Written before the request leaves. */
  startCall(l: Omit<CallStartedLine, 'type'>): CallStartedLine { const line: CallStartedLine = { type: 'CALL_STARTED', ...l }; this.write(line); return line; }
  finishCall(l: Omit<CallFinishedLine, 'type'>): CallFinishedLine { const line: CallFinishedLine = { type: 'CALL_FINISHED', ...l }; this.write(line); return line; }
  closeNotCalled(l: Omit<NotCalledLine, 'type'>): NotCalledLine { const line: NotCalledLine = { type: 'NOT_CALLED', ...l }; this.write(line); return line; }
  outcomeOf(phase: Phase, slotId: string): SlotOutcome {
    const have = this.byKey.get(`${phase}|${slotId}`) ?? [];
    if (have.length === 0) return { state: 'NOT_RUN' };
    if (have[0].type === 'NOT_CALLED') return { state: 'NOT_CALLED_BUDGET_STOP', line: have[0] };
    const started = have[0] as CallStartedLine;
    return have.length === 1 ? { state: 'NO_RESPONSE_RECORDED', started } : { state: 'FINISHED', started, finished: have[1] as CallFinishedLine };
  }
  /** Canary spend on the assumed basis: what finished calls cost, and the worst case of every call started and not finished. */
  spentUsd(): number {
    let n = 0;
    for (const have of this.byKey.values()) { if (have[0].type !== 'CALL_STARTED') continue; n += have.length === 2 ? (have[1] as CallFinishedLine).costUsdAssumed : have[0].worstCaseCostUsdAssumed; }
    return n;
  }
  spentUsdOf(phase: Phase): number {
    let n = 0;
    for (const have of this.byKey.values()) { if (have[0].type !== 'CALL_STARTED' || have[0].phase !== phase) continue; n += have.length === 2 ? (have[1] as CallFinishedLine).costUsdAssumed : have[0].worstCaseCostUsdAssumed; }
    return n;
  }
  callsOf(phase: Phase): number { return [...this.byKey.values()].filter((h) => h[0].type === 'CALL_STARTED' && h[0].phase === phase).length; }
}
