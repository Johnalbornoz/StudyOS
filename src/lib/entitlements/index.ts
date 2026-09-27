import { getSubscription } from './subscription.service';
import type { Capability, SubscriptionStatus } from './types';
import { resolveLearningAccess, isLearnerOwner } from './learning-access';

export type { Capability, SubscriptionStatus, Plan, SubscriptionRecord } from './types';
export { getSubscription, getEffectiveSubscription, ensureSubscription, transitionSubscriptionStatus } from './subscription.service';
export { isValidTransition, assertValidTransition, InvalidSubscriptionTransitionError } from './subscription-state-machine';
export { resolveLearningAccess, decideLearningAccess, type LearningAccess } from './learning-access';

/**
 * F3 -- THE canonical Entitlement authority (§12 of the task). Answers
 * "is this commercial capability available", never "may this actor
 * touch this learner" (that remains F2's `src/lib/authorization/`,
 * never imported here -- INV-F3-13). Every branch fails closed: an
 * unresolved actor, a missing subscription row, or a DB error all
 * resolve to `false`.
 *
 * `actorUserId` is always the F1 canonical `users.id`, resolved
 * server-side by the caller -- nothing here trusts a client-supplied
 * actor.
 */

const REACTIVATABLE_STATUSES: readonly SubscriptionStatus[] = ['suspended', 'past_due', 'cancelled_at_period_end'];

/** Ownership through the F1 canonical link -- one rule, shared with learning-access.ts. */
const isOwner = isLearnerOwner;

/**
 * LEARNING_FULL_ACCESS: only the learner themself, only in a status
 * that grants paid access. `cancelled_at_period_end` is a special
 * case -- access remains valid only through the already-paid period
 * (§17 of the task: cancellation and suspension are not the same
 * thing), never treated as an immediate cutoff.
 */
async function canUseLearningFullAccess(actorUserId: string, learnerId: string): Promise<boolean> {
  // The single canonical resolution (learning-access.ts) -- the same one the
  // Billing page displays, so "licensed" can never mean two things.
  return (await resolveLearningAccess(actorUserId, learnerId)).licensed;
}

/** Never revoked by subscription state -- the learner can always see their own history (INV-F3-06). */
async function canUseLearningHistoryView(actorUserId: string, learnerId: string): Promise<boolean> {
  return isOwner(actorUserId, learnerId);
}

/** The learner, or the registered payer -- never anyone else. */
async function canUseBillingManage(actorUserId: string, learnerId: string): Promise<boolean> {
  if (await isOwner(actorUserId, learnerId)) return true;
  try {
    const sub = await getSubscription(learnerId);
    return sub.payerUserId === actorUserId;
  } catch {
    return false;
  }
}

async function canUseSubscriptionReactivate(actorUserId: string, learnerId: string): Promise<boolean> {
  const canManage = await canUseBillingManage(actorUserId, learnerId);
  if (!canManage) return false;
  const sub = await getSubscription(learnerId);
  return REACTIVATABLE_STATUSES.includes(sub.status);
}

export async function canUseCapability(actorUserId: string, learnerId: string, capability: Capability): Promise<boolean> {
  try {
    switch (capability) {
      case 'LEARNING_FULL_ACCESS':
        return await canUseLearningFullAccess(actorUserId, learnerId);
      case 'LEARNING_HISTORY_VIEW':
        return await canUseLearningHistoryView(actorUserId, learnerId);
      case 'BILLING_MANAGE':
        return await canUseBillingManage(actorUserId, learnerId);
      case 'SUBSCRIPTION_REACTIVATE':
        return await canUseSubscriptionReactivate(actorUserId, learnerId);
      default:
        return false;
    }
  } catch {
    return false;
  }
}
