import { db } from '@/lib/db';
import { assertValidTransition, isValidTransition } from './subscription-state-machine';
import type { SubscriptionRecord, SubscriptionStatus, Plan } from './types';

function toRecord(row: any): SubscriptionRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    status: row.status,
    plan: row.plan,
    payerUserId: row.payer_user_id,
    currentPeriodEnd: row.current_period_end,
    manuallySetByAdmin: row.manually_set_by_admin,
    grantExpiresAt: row.grant_expires_at ?? null,
  };
}

/**
 * The learner's subscription, or a synthetic 'unpaid' default when
 * none exists yet -- matches the pre-F3 behavior of
 * payment.service.ts::getSubscriptionStatus exactly, so nothing that
 * already reads "no subscription row = unpaid" breaks.
 */
export async function getSubscription(studentId: string): Promise<SubscriptionRecord> {
  const result = await db.query(
    `SELECT id, student_id, status, plan, payer_user_id, current_period_end, manually_set_by_admin, grant_expires_at FROM subscriptions WHERE student_id = $1`,
    [studentId]
  );
  if (result.rows.length === 0) {
    return { id: '', studentId, status: 'unpaid', plan: null, payerUserId: null, currentPeriodEnd: null, manuallySetByAdmin: false, grantExpiresAt: null };
  }
  return toRecord(result.rows[0]);
}

const STILL_CONSUMING_PREMIUM: readonly SubscriptionStatus[] = ['active', 'past_due', 'reactivated'];

/**
 * §15 "Expiración efectiva" -- THE authority every premium check must
 * call instead of `getSubscription` directly. An admin-granted license
 * (`manuallySetByAdmin`) whose own `grantExpiresAt` has passed loses
 * access on the very first request that asks, even if the row still
 * says `active`/`past_due`/`reactivated` because no cron has touched
 * it yet -- this function lazily reconciles the row to `expired` right
 * here, idempotently (a second call finds `status === 'expired'`
 * already and does nothing further), and records the reconciliation so
 * it is never a silent, untraceable status flip.
 *
 * A non-admin-granted subscription (a real paid plan) is returned
 * unchanged -- its own expiry is `currentPeriodEnd`, already handled
 * by the caller (see `canUseLearningFullAccess`'s
 * `cancelled_at_period_end` branch), not by this function.
 */
export async function getEffectiveSubscription(studentId: string): Promise<SubscriptionRecord> {
  const record = await getSubscription(studentId);
  if (!record.manuallySetByAdmin || !record.grantExpiresAt) return record;
  if (!STILL_CONSUMING_PREMIUM.includes(record.status)) return record;
  if (new Date(record.grantExpiresAt).getTime() > Date.now()) return record;

  if (!isValidTransition(record.status, 'expired')) return record; // fail closed: never leaves the row in a worse-defined state than it started in

  await transitionSubscriptionStatus(studentId, 'expired');
  await db.query(
    `INSERT INTO subscription_events (subscription_id, actor_user_id, event_type, previous_status, new_status, reason, source)
     VALUES ($1, NULL, 'EXPIRED', $2, 'expired', 'Lazy reconciliation: admin grant past its own expiration date', NULL)`,
    [record.id, record.status]
  );

  return { ...record, status: 'expired' };
}

/**
 * F3 / AC-F3-16 -- the ONE place `subscriptions.status` is ever
 * written after creation. Validates the transition against the state
 * machine BEFORE touching the row; an invalid transition throws
 * InvalidSubscriptionTransitionError and writes nothing (fail closed,
 * not a silent no-op and not a silent success).
 */
export async function transitionSubscriptionStatus(studentId: string, to: SubscriptionStatus): Promise<void> {
  const current = await getSubscription(studentId);
  assertValidTransition(current.status, to);

  await db.query(
    `
    INSERT INTO subscriptions (student_id, status)
    VALUES ($1, $2)
    ON CONFLICT (student_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
    `,
    [studentId, to]
  );
}

/**
 * Sets a subscription's initial plan/payer without going through the
 * status state machine (used by checkout creation, not by webhook/
 * status transitions). `payerUserId` may legitimately differ from the
 * learner's own user id (INV-F3-03) -- never inferred, always the
 * value the caller explicitly resolved.
 */
export async function ensureSubscription(studentId: string, plan: Plan, payerUserId: string): Promise<SubscriptionRecord> {
  const result = await db.query(
    `
    INSERT INTO subscriptions (student_id, status, plan, payer_user_id)
    VALUES ($1, 'unpaid', $2, $3)
    ON CONFLICT (student_id) DO UPDATE SET plan = EXCLUDED.plan, payer_user_id = EXCLUDED.payer_user_id, updated_at = NOW()
    RETURNING id, student_id, status, plan, payer_user_id, current_period_end, manually_set_by_admin, grant_expires_at
    `,
    [studentId, plan, payerUserId]
  );
  return toRecord(result.rows[0]);
}
