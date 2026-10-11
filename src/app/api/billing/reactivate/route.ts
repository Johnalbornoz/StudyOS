/**
 * F3 -- POST /api/billing/reactivate
 *
 * Only the learner or the registered payer, and only when the current
 * status is actually reactivatable (SUBSCRIPTION_REACTIVATE's own
 * rule, §16 of the task). Applies exactly the two allowed transitions
 * that lead toward ACTIVE from a reactivatable state --
 * `suspended -> reactivated` or `past_due -> active` directly, or
 * (for `cancelled_at_period_end`, which has no path back to `active`
 * in the state machine by design -- reactivating a scheduled
 * cancellation is a distinct product decision this phase does not
 * define) responds NOT_REACTIVATABLE rather than inventing a
 * transition the state machine doesn't allow.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability, getSubscription, transitionSubscriptionStatus, InvalidSubscriptionTransitionError } from '@/lib/entitlements';
import { resolveSelfReactivation, recordSelfReactivation } from '@/lib/entitlements/self-reactivation';

const Schema = z.object({ studentId: z.string().uuid() });

export async function POST(request: NextRequest) {
  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
  const entitled = await canUseCapability(actor.id, validated.studentId, 'SUBSCRIPTION_REACTIVATE');
  if (!entitled) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const sub = await getSubscription(validated.studentId);
  // L4-R1: owning (or paying for) the subscription is not enough. An administrator's
  // suspension / revocation is never reversed from here, and a suspended subscription
  // needs a real entitlement basis -- see src/lib/entitlements/self-reactivation.ts.
  const decision = await resolveSelfReactivation(sub);
  if (!decision.allowed) {
    if (decision.reason === 'NOT_REACTIVATABLE') {
      return NextResponse.json({ error: 'NOT_REACTIVATABLE', currentStatus: sub.status }, { status: 409 });
    }
    return NextResponse.json({ error: 'REACTIVATION_NOT_PERMITTED', reason: decision.reason }, { status: 403 });
  }
  const nextStatus = decision.nextStatus;

  try {
    await transitionSubscriptionStatus(validated.studentId, nextStatus);
  } catch (error) {
    if (error instanceof InvalidSubscriptionTransitionError) {
      return NextResponse.json({ error: 'INVALID_TRANSITION' }, { status: 409 });
    }
    throw error;
  }

  await recordSelfReactivation(sub, actor.id, nextStatus);
  return NextResponse.json({ success: true, data: { status: nextStatus } });
}
