/**
 * Human Agency P0-4 -- route-level handling of a deterministic safety signal.
 * One shape for every Student-facing route:
 *   422 { error: 'SAFETY_RESPONSE', message: <fixed text>, safety: SafetyResponse }
 * `message` is the same fixed, reviewed copy as `safety.text`, so clients
 * that already render `body.message` show it unchanged.
 */
import { NextResponse } from 'next/server';
import { detectSafetySignal } from './safety-signal-detector';
import { isSafetySignalError } from './safety-gate';
import { handleSafetySignal, type SafetySurface, type SafetyResponse, type ActiveSignal } from '@/services/safety-signal.service';

export const SAFETY_RESPONSE = 'SAFETY_RESPONSE' as const;

export function safetyHttpResponse(safety: SafetyResponse): NextResponse {
  return NextResponse.json({ error: SAFETY_RESPONSE, message: safety.text, safety }, { status: 422 });
}

/** Detect -> (event + routed notification + fixed response) or null. Never calls a model. */
export async function studentTextSafetyResponse(
  texts: string | ReadonlyArray<string | null | undefined>,
  ctx: { studentId: string; surface: SafetySurface; locale: string },
): Promise<NextResponse | null> {
  const status = detectSafetySignal(texts);
  if (status === 'NO_SIGNAL') return null;
  const safety = await handleSafetySignal({ studentId: ctx.studentId, status, surface: ctx.surface, locale: ctx.locale });
  return safetyHttpResponse(safety);
}

/** For a catch block: a SafetySignalError thrown by a service-level assert becomes the same fixed response. */
export async function safetyResponseForError(
  error: unknown,
  ctx: { studentId: string; surface: SafetySurface; locale: string },
): Promise<NextResponse | null> {
  if (!isSafetySignalError(error)) return null;
  const safety = await handleSafetySignal({ studentId: ctx.studentId, status: error.status as ActiveSignal, surface: ctx.surface, locale: ctx.locale });
  return safetyHttpResponse(safety);
}
