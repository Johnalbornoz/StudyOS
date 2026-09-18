import { db } from '@/lib/db';
import { assertValidTransition } from './subscription-state-machine';
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
    `SELECT id, student_id, status, plan, payer_user_id, current_period_end, manually_set_by_admin FROM subscriptions WHERE student_id = $1`,
    [studentId]
  );
  if (result.rows.length === 0) {
    return { id: '', studentId, status: 'unpaid', plan: null, payerUserId: null, currentPeriodEnd: null, manuallySetByAdmin: false };
  }
  return toRecord(result.rows[0]);
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
    RETURNING id, student_id, status, plan, payer_user_id, current_period_end, manually_set_by_admin
    `,
    [studentId, plan, payerUserId]
  );
  return toRecord(result.rows[0]);
}
