/**
 * F3 -- GET /api/billing/subscription?studentId=...
 *
 * Billing is a commercial capability (F3): the gate is
 * `canUseCapability(actor, learner, 'BILLING_MANAGE')` -- the learner
 * themself, or the registered payer, and no one else. It never grants,
 * and is never granted by, F2 access to the learner's academic data
 * (`canAccessLearner` is not consulted).
 *
 * L11 / EN-3: a registered payer became one through an accepted
 * parent-student relationship (checkout and manual approval both require
 * it), and keeps billing rights only while that relationship is still
 * accepted (`isLiveBillingActor`). After the student unlinks, the stored
 * `payer_user_id` no longer opens this route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability, getSubscription } from '@/lib/entitlements';
import { isLiveBillingActor } from '@/services/payment.service';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  const entitled = (await canUseCapability(actor.id, studentId, 'BILLING_MANAGE')) && (await isLiveBillingActor(actor.id, studentId));
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
