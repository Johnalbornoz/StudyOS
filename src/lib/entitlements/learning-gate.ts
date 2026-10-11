/**
 * L11 / EN-2 -- THE shared enforcement point for the learning licence.
 *
 * A route on the PAID list of `unlicensed-policy.ts` calls one of these
 * after its ownership check and before any generation, grading or write.
 * The decision itself is still the single canonical one
 * (`canUseCapability(..., 'LEARNING_FULL_ACCESS')` -> learning-access.ts),
 * computed from the database on every request and fail-closed; this module
 * only fixes how a route asks and how it refuses (403 ENTITLEMENT_REQUIRED),
 * so the two can no longer drift route by route.
 *
 * Continuation (ruling D-8(c)): an attempt that was started while the
 * licence was valid may be reopened, answered, completed and graded after the
 * licence ends. A route that serves both a new start and the continuation of
 * an existing attempt uses the `...UnlessOpenAttempt` forms and passes the
 * proof it already holds (a server-side record of THAT attempt, owned by the
 * Student, still open under its own validity rules). It never opens a new
 * attempt, a completed one, or any other paid activity.
 */
import { NextResponse } from 'next/server';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability } from './index';

export const ENTITLEMENT_REQUIRED = 'ENTITLEMENT_REQUIRED';

export function entitlementRequiredResponse(): NextResponse {
  return NextResponse.json({ error: ENTITLEMENT_REQUIRED }, { status: 403 });
}

/** For a route that already holds the F1 canonical `users.id`. Null means licensed. */
export async function learningLicenceRequiredResponseForActor(actorUserId: string, studentId: string): Promise<NextResponse | null> {
  return (await canUseCapability(actorUserId, studentId, 'LEARNING_FULL_ACCESS')) ? null : entitlementRequiredResponse();
}

/** D-8(c): no licence needed to continue `openAttempt`; otherwise as `learningLicenceRequiredResponseForActor`. */
export async function learningLicenceRequiredUnlessOpenAttemptForActor(actorUserId: string, studentId: string, openAttempt: boolean): Promise<NextResponse | null> {
  return openAttempt ? null : learningLicenceRequiredResponseForActor(actorUserId, studentId);
}

/** D-8(c): no licence needed to continue `openAttempt`; otherwise as `learningLicenceRequiredResponse`. */
export async function learningLicenceRequiredUnlessOpenAttempt(
  authContext: { userId: string; email?: string | null },
  studentId: string,
  openAttempt: boolean
): Promise<NextResponse | null> {
  return openAttempt ? null : learningLicenceRequiredResponse(authContext, studentId);
}

/** For a route that holds the Clerk auth context (`verifyAuth`). Null means licensed. */
export async function learningLicenceRequiredResponse(
  authContext: { userId: string; email?: string | null },
  studentId: string
): Promise<NextResponse | null> {
  try {
    const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
    return await learningLicenceRequiredResponseForActor(actor.id, studentId);
  } catch (error) {
    console.error('[entitlements] learning licence check failed', error instanceof Error ? error.message : error);
    return entitlementRequiredResponse();
  }
}
