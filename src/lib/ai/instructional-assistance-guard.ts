/**
 * Human Agency P0-1 -- the ONE server-side gate every Student-facing
 * instructional-AI route goes through ("AI helps while you learn; when we
 * want to know whether you really know, the help disappears").
 *
 * It is not a new policy. It reuses the canonical cross-surface authority
 * the Tutor already uses -- `getActiveRestrictedEvidenceForStudent`
 * (active INDEPENDENT / ASSESSMENT quiz sessions, unresolved verification,
 * open exam simulations) -- and applies it STUDENT-WIDE, never scoped by
 * the concept or session a route happens to be called with: a second tab,
 * a parallel PRACTICE session or an omitted `mode` cannot reopen help while
 * restricted evidence is being collected anywhere (Phase 5-R4 S5 rationale,
 * unchanged).
 *
 * Fails CLOSED: if the guard's own lookup fails, the route answers 423
 * exactly like the Tutor (`tutor.service.ts`) -- an integrity control
 * degrades to "unavailable", never "unchecked".
 *
 * Routes that MUST call this (enforced by
 * tests/unit/human-agency-p0-1-assistance-guard.test.ts):
 * see INSTRUCTIONAL_AI_ROUTES below.
 */
import { NextResponse } from 'next/server';
import { getActiveRestrictedEvidenceForStudent } from '@/services/active-evidence-guard.service';

export const ASSISTANCE_LOCKED = 'ASSISTANCE_LOCKED' as const;

/** Every Student-facing route that returns instructional AI help (explanation, worked example, hint, guided step, teaching content, error guidance). */
export const INSTRUCTIONAL_AI_ROUTES = [
  'src/app/api/concepts/[id]/explanation/route.ts',
  'src/app/api/concepts/[id]/interactive-formula/route.ts',
  'src/app/api/learning/guided-practice/route.ts',
  'src/app/api/learning/contextual-help/route.ts',
  'src/app/api/quizzes/hint/route.ts',
  'src/app/api/cognitive/explain/generate/route.ts',
  'src/app/api/teaching/interventions/route.ts',
  'src/app/api/learning-debt/error-guidance/route.ts',
  // Per-question PRACTICE feedback (AI hints on a wrong answer) -- a parallel
  // PRACTICE session must not become a lateral source of help.
  'src/app/api/quizzes/session/[quizId]/check/route.ts',
] as const;

export type InstructionalAssistanceState =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Student-wide, fail-closed. */
export async function getInstructionalAssistanceState(studentId: string): Promise<InstructionalAssistanceState> {
  try {
    const state = await getActiveRestrictedEvidenceForStudent(studentId);
    return state.allowed ? { allowed: true } : { allowed: false, reason: state.reason };
  } catch {
    return { allowed: false, reason: 'GUARD_LOOKUP_FAILED' };
  }
}

/**
 * Returns a 423 response when instructional AI help is locked for this
 * Student, or null when the route may continue. Call it AFTER the access
 * check and BEFORE any AI call or cached-explanation read.
 */
export async function instructionalAssistanceLockedResponse(studentId: string): Promise<NextResponse | null> {
  const state = await getInstructionalAssistanceState(studentId);
  if (state.allowed) return null;
  return NextResponse.json(
    { error: ASSISTANCE_LOCKED, reason: state.reason, message: 'Help is unavailable while an independent check, assessment or exam is in progress.' },
    { status: 423 }
  );
}
