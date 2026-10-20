/**
 * L4-R1 -- may the learner (or the registered payer) reactivate this
 * subscription THEMSELVES, through POST /api/billing/reactivate?
 *
 * Before this module the route moved `suspended -> reactivated` (a status
 * that grants full access) for any owner/payer, with no payment and no
 * record. Every `suspended` row is produced by an administrator
 * (suspendMembership / revokeLicenseGrant), so that was a self-service undo
 * of an admin decision.
 *
 * Rules (pure, in `decideSelfReactivation`):
 *  - only `suspended` and `past_due` are reactivatable at all;
 *  - a row an administrator set by hand (`manually_set_by_admin`: an admin
 *    grant, a revoked grant, a manual override) is never self-reactivated --
 *    only an administrator restores it;
 *  - a suspension recorded with an administrator as actor
 *    (`subscription_events`, new_status = 'suspended', actor_user_id set) is
 *    never self-reversed;
 *  - any other suspension (system / non-payment, or one that predates the
 *    event log) needs a real entitlement basis: a paid period that is still
 *    running, or a SUCCEEDED payment recorded after the suspension;
 *  - `past_due -> active` on a paid (not admin-set) row is unchanged:
 *    `past_due` already grants access, so it creates none.
 *
 * Everything fails closed: a lookup error denies.
 */
import { db } from '@/lib/db';
import type { SubscriptionRecord, SubscriptionStatus } from './types';

export type SelfReactivationDenial = 'NOT_REACTIVATABLE' | 'ADMIN_CONTROLLED' | 'ADMIN_SUSPENDED' | 'NO_ENTITLEMENT_BASIS';

export interface SelfReactivationFacts {
  /** The most recent transition INTO `suspended` recorded for this subscription, if any. */
  lastSuspension: { actorUserId: string | null; occurredAt: string } | null;
  /** When the most recent SUCCEEDED payment of this subscription happened, if any. */
  lastSucceededPaymentAt: string | null;
}

export type SelfReactivationDecision =
  | { allowed: true; nextStatus: Extract<SubscriptionStatus, 'reactivated' | 'active'> }
  | { allowed: false; reason: SelfReactivationDenial };

const ms = (value: string | null | undefined): number => (value ? new Date(value).getTime() : NaN);

export function decideSelfReactivation(sub: SubscriptionRecord, facts: SelfReactivationFacts, now: Date = new Date()): SelfReactivationDecision {
  if (!sub.id || (sub.status !== 'suspended' && sub.status !== 'past_due')) return { allowed: false, reason: 'NOT_REACTIVATABLE' };
  if (sub.manuallySetByAdmin) return { allowed: false, reason: 'ADMIN_CONTROLLED' };
  if (sub.status === 'past_due') return { allowed: true, nextStatus: 'active' };

  if (facts.lastSuspension?.actorUserId) return { allowed: false, reason: 'ADMIN_SUSPENDED' };

  const periodRunning = ms(sub.currentPeriodEnd) > now.getTime();
  const paidSinceSuspension =
    !!facts.lastSuspension && ms(facts.lastSucceededPaymentAt) > ms(facts.lastSuspension.occurredAt);
  if (!periodRunning && !paidSinceSuspension) return { allowed: false, reason: 'NO_ENTITLEMENT_BASIS' };
  return { allowed: true, nextStatus: 'reactivated' };
}

export async function loadSelfReactivationFacts(subscriptionId: string): Promise<SelfReactivationFacts> {
  const [suspension, payment] = await Promise.all([
    db.query(
      `SELECT actor_user_id, occurred_at FROM subscription_events
        WHERE subscription_id = $1 AND new_status = 'suspended'
        ORDER BY occurred_at DESC LIMIT 1`,
      [subscriptionId]
    ),
    db.query(`SELECT max(occurred_at) AS at FROM payments WHERE subscription_id = $1 AND status = 'SUCCEEDED'`, [subscriptionId]),
  ]);
  const s = suspension.rows[0];
  const paidAt = payment.rows[0]?.at ?? null;
  return {
    lastSuspension: s ? { actorUserId: s.actor_user_id ?? null, occurredAt: new Date(s.occurred_at).toISOString() } : null,
    lastSucceededPaymentAt: paidAt ? new Date(paidAt).toISOString() : null,
  };
}

/** The decision for one subscription record, read from the database. Any error denies. */
export async function resolveSelfReactivation(sub: SubscriptionRecord): Promise<SelfReactivationDecision> {
  // Outcomes that do not depend on the event / payment history need no lookup.
  if (!sub.id || sub.status !== 'suspended' || sub.manuallySetByAdmin) {
    return decideSelfReactivation(sub, { lastSuspension: null, lastSucceededPaymentAt: null });
  }
  try {
    return decideSelfReactivation(sub, await loadSelfReactivationFacts(sub.id));
  } catch (error) {
    console.error('[billing] self-reactivation lookup failed', error instanceof Error ? error.message : error);
    return { allowed: false, reason: 'NO_ENTITLEMENT_BASIS' };
  }
}

/** The record of a self-service reactivation (the admin path already records its own). Never a gate. */
export async function recordSelfReactivation(sub: SubscriptionRecord, actorUserId: string, newStatus: SubscriptionStatus): Promise<void> {
  try {
    await db.query(
      `INSERT INTO subscription_events (subscription_id, actor_user_id, event_type, previous_status, new_status, reason, source)
       VALUES ($1, $2, 'REACTIVATED', $3, $4, 'Self-service reactivation', NULL)`,
      [sub.id, actorUserId, sub.status, newStatus]
    );
  } catch (error) {
    console.error('[billing] self-reactivation event write failed', error instanceof Error ? error.message : error);
  }
}
