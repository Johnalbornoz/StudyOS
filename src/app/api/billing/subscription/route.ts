/**
 * F3 -- GET /api/billing/subscription?studentId=...
 *
 * Billing is a PURELY commercial capability (F3) -- it deliberately
 * never calls F2's canAccessLearner. Per §10 of the task: "A Parent
 * may pay for learner A but still have no academic relationship to
 * learner A. That must be possible in the model" -- requiring F2
 * authorization here would wrongly block a legitimate payer who has
 * zero academic relationship to the learner. The only gate is
 * `canUseCapability(actor, learner, 'BILLING_MANAGE')`: the learner
 * themself, or the registered payer, and no one else.
 *
 * (The "authorized AND entitled" composition the task describes in
 * §14 is real and enforced elsewhere -- e.g. a Student's own paid
 * learning execution needs both ownership and LEARNING_FULL_ACCESS --
 * but billing is not that case; it is entitlement-only by design.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability, getSubscription } from '@/lib/entitlements';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const entitled = await canUseCapability(actor.id, studentId, 'BILLING_MANAGE');
  if (!entitled) {
    // Never confirms whether the learner id even exists to a non-payer.
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const subscription = await getSubscription(studentId);
  const [fullAccess, historyView, reactivate] = await Promise.all([
    canUseCapability(actor.id, studentId, 'LEARNING_FULL_ACCESS'),
    canUseCapability(actor.id, studentId, 'LEARNING_HISTORY_VIEW'),
    canUseCapability(actor.id, studentId, 'SUBSCRIPTION_REACTIVATE'),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      subscription: { status: subscription.status, plan: subscription.plan, currentPeriodEnd: subscription.currentPeriodEnd },
      entitlements: { LEARNING_FULL_ACCESS: fullAccess, LEARNING_HISTORY_VIEW: historyView, SUBSCRIPTION_REACTIVATE: reactivate },
    },
  });
}
