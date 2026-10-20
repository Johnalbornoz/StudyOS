/**
 * Human Agency P0-4 (Layer B) -- the deterministic gate in front of every
 * generative model call that receives Student-typed text.
 *
 * Two placements, one detector:
 *  - ROUTE level (`studentTextSafetyResponse`): evaluated before any service
 *    work; on a signal the route answers with the fixed safety response
 *    (and the event + notification are recorded) instead of calling AI.
 *  - SERVICE level (`assertNoSafetySignal`): the last statement before the
 *    model call in every service that interpolates Student text. Defence in
 *    depth -- even a caller that forgot the route gate can never send a
 *    signalled text to a model (it throws SafetySignalError instead).
 */
import { detectSafetySignal, type SafetySignalStatus } from './safety-signal-detector';

export type ActiveSafetySignal = Exclude<SafetySignalStatus, 'NO_SIGNAL'>;

export class SafetySignalError extends Error {
  readonly code = 'SAFETY_SIGNAL' as const;
  constructor(readonly status: ActiveSafetySignal) {
    super('SAFETY_SIGNAL');
    this.name = 'SafetySignalError';
  }
}

export function isSafetySignalError(e: unknown): e is SafetySignalError {
  return e instanceof SafetySignalError || (!!e && typeof e === 'object' && (e as { code?: unknown }).code === 'SAFETY_SIGNAL' && 'status' in (e as object));
}

/** Throws SafetySignalError when any text carries a signal. Pure, synchronous, no I/O. */
export function assertNoSafetySignal(texts: string | ReadonlyArray<string | null | undefined>): void {
  const status = detectSafetySignal(texts);
  if (status !== 'NO_SIGNAL') throw new SafetySignalError(status);
}
