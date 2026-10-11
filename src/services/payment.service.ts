/**
 * Mercado Pago subscription (recurring "preapproval") integration.
 *
 * MERCADOPAGO_ACCESS_TOKEN isn't set yet -- there's no Mercado Pago
 * account behind this deployment. Every function here degrades
 * gracefully (returns a clear PAYMENT_NOT_CONFIGURED error) until it
 * is. Once a real account exists:
 *   1. Add MERCADOPAGO_ACCESS_TOKEN (and MERCADOPAGO_PLAN_AMOUNT /
 *      MERCADOPAGO_PLAN_CURRENCY if the defaults below aren't right)
 *      to the environment.
 *   2. Point a webhook at POST /api/webhooks/mercadopago in the
 *      Mercado Pago developer dashboard, subscribed to "subscription"
 *      (preapproval) events.
 *   3. Add MERCADOPAGO_WEBHOOK_SECRET (the webhook signing secret shown
 *      in that dashboard). Without it every notification is rejected.
 * No other code changes should be needed.
 */

import { db } from '@/lib/db';
import { isOwner, isActiveParentOf } from '@/lib/authorization';
import { getSubscription, transitionSubscriptionStatus } from '@/lib/entitlements/subscription.service';
import { InvalidSubscriptionTransitionError } from '@/lib/entitlements/subscription-state-machine';
import { recordPayment } from '@/lib/entitlements/payment.service';
import {
  decideProviderEvent,
  encodeExternalReference,
  isPurchasable,
  parseExternalReference,
  type ProviderSubscriptionView,
} from '@/lib/entitlements/provider-events';
import type { SubscriptionStatus } from '@/lib/entitlements/types';

const MP_API_BASE = 'https://api.mercadopago.com';

export type { SubscriptionStatus } from '@/lib/entitlements/types';

export interface Subscription {
  studentId: string;
  status: SubscriptionStatus;
  provider: string;
  providerSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  manuallySetByAdmin: boolean;
  updatedAt: string;
}

function isConfigured(): boolean {
  return !!process.env.MERCADOPAGO_ACCESS_TOKEN;
}

export async function getSubscriptionStatus(studentId: string): Promise<Subscription> {
  const result = await db.query(`SELECT * FROM subscriptions WHERE student_id = $1`, [studentId]);
  const row = result.rows[0];
  if (!row) {
    return {
      studentId,
      status: 'unpaid',
      provider: 'mercadopago',
      providerSubscriptionId: null,
      currentPeriodEnd: null,
      manuallySetByAdmin: false,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    studentId: row.student_id,
    status: row.status,
    provider: row.provider,
    providerSubscriptionId: row.provider_subscription_id,
    currentPeriodEnd: row.current_period_end,
    manuallySetByAdmin: row.manually_set_by_admin,
    updatedAt: row.updated_at,
  };
}

export async function getAllSubscriptionStatuses(): Promise<Record<string, SubscriptionStatus>> {
  const result = await db.query(`SELECT student_id, status FROM subscriptions`);
  const map: Record<string, SubscriptionStatus> = {};
  for (const row of result.rows) map[row.student_id] = row.status;
  return map;
}

/**
 * Admin-only manual override -- works whether or not Mercado Pago is
 * connected yet, since "who paid" can always be tracked by hand.
 */
export async function setSubscriptionStatusManually(studentId: string, status: SubscriptionStatus): Promise<void> {
  await db.query(
    `
    INSERT INTO subscriptions (student_id, status, manually_set_by_admin)
    VALUES ($1, $2, true)
    ON CONFLICT (student_id) DO UPDATE SET status = EXCLUDED.status, manually_set_by_admin = true, updated_at = NOW()
    `,
    [studentId, status]
  );
}

/**
 * L11 / EN-3 -- billing rights of a non-owner are tied to a LIVE relationship.
 * The learner always manages their own billing. A registered payer keeps
 * BILLING_MANAGE / SUBSCRIPTION_REACTIVATE only while the accepted
 * parent-student relationship that let them pay still exists: once the
 * student unlinks, the stored `payer_user_id` no longer opens anything.
 * Composed with the F3 capability at the call site (never inside
 * src/lib/entitlements, which does not import F2 authorization).
 */
export async function isLiveBillingActor(actorUserId: string, studentId: string): Promise<boolean> {
  if (await isOwner(actorUserId, studentId)) return true;
  return isActiveParentOf(actorUserId, studentId);
}

/**
 * Binds the user who paid to the subscription -- only on a provider-confirmed
 * payment, only on a paid (not administrator-set) row, and only while that
 * user is the learner or still holds an accepted relationship to them.
 */
async function bindPayerIfLive(studentId: string, payerUserId: string): Promise<boolean> {
  const owner = await isOwner(payerUserId, studentId);
  if (!owner && !(await isActiveParentOf(payerUserId, studentId))) {
    console.warn('[mercadopago-webhook] payer not bound: no live relationship to the learner', { studentId });
    return false;
  }
  const result = await db.query(
    `UPDATE subscriptions SET payer_user_id = $2, source = $3, updated_at = NOW()
      WHERE student_id = $1 AND manually_set_by_admin = false
      RETURNING id`,
    [studentId, payerUserId, owner ? 'INDIVIDUAL_PAYMENT' : 'PARENT_PAYMENT']
  );
  return result.rows.length > 0;
}

async function loadProviderView(studentId: string): Promise<ProviderSubscriptionView & { payerUserId: string | null }> {
  const result = await db.query(
    `SELECT id, status, manually_set_by_admin, provider_subscription_id, current_period_end, payer_user_id FROM subscriptions WHERE student_id = $1`,
    [studentId]
  );
  const row = result.rows[0];
  if (!row) return { id: '', status: 'unpaid', manuallySetByAdmin: false, providerSubscriptionId: null, currentPeriodEnd: null, payerUserId: null };
  return {
    id: row.id,
    status: row.status,
    manuallySetByAdmin: !!row.manually_set_by_admin,
    providerSubscriptionId: row.provider_subscription_id ?? null,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : null,
    payerUserId: row.payer_user_id ?? null,
  };
}

async function rowExists(table: 'students' | 'users', id: string): Promise<boolean> {
  const result = await db.query(`SELECT 1 FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
  return result.rows.length > 0;
}

/**
 * Creates a Mercado Pago recurring subscription ("preapproval") for a
 * student and returns the checkout URL to redirect them to. Throws
 * PAYMENT_NOT_CONFIGURED if no Mercado Pago account is connected yet,
 * and SUBSCRIPTION_NOT_PURCHASABLE when a confirmed payment could not
 * activate this subscription (an administrator's suspension, a running
 * administrative grant, a status with no path to `active`) -- the payer
 * is never charged for something the webhook is not allowed to move.
 *
 * `payerUserId` (F1 canonical `users.id`) is the caller's own resolved
 * identity, passed explicitly by the route that authorized this checkout.
 * It travels in the provider's `external_reference` and is bound to the
 * subscription only when the provider confirms the payment (L11 / EN-3):
 * starting a checkout never rewrites the payer, the provider ids or any
 * other field of an existing subscription.
 */
export async function createMercadoPagoCheckout(
  studentId: string,
  studentEmail: string,
  backUrl: string,
  payerUserId: string
): Promise<{ checkoutUrl: string }> {
  if (!isConfigured()) {
    throw new Error('PAYMENT_NOT_CONFIGURED');
  }

  if (!isPurchasable(await getSubscription(studentId))) {
    throw new Error('SUBSCRIPTION_NOT_PURCHASABLE');
  }

  const amount = Number(process.env.MERCADOPAGO_PLAN_AMOUNT || '0');
  const currency = process.env.MERCADOPAGO_PLAN_CURRENCY || 'COP';

  const response = await fetch(`${MP_API_BASE}/preapproval`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      reason: 'StudyUs - Suscripción mensual',
      payer_email: studentEmail,
      back_url: backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: amount,
        currency_id: currency,
      },
      external_reference: encodeExternalReference(studentId, payerUserId),
      status: 'pending',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Mercado Pago API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();

  // Only ever creates the learner's empty row; an existing subscription is left exactly as it is.
  await db.query(
    `INSERT INTO subscriptions (student_id, status, provider) VALUES ($1, 'unpaid', 'mercadopago') ON CONFLICT (student_id) DO NOTHING`,
    [studentId]
  );

  return { checkoutUrl: data.init_point };
}

const PROVIDER_EVENT_TYPE: Partial<Record<SubscriptionStatus, string>> = {
  active: 'PAYMENT_CONFIRMED',
  cancelled_at_period_end: 'CANCELLED',
  expired: 'EXPIRED',
};

/**
 * Handles a Mercado Pago webhook notification. The route has already
 * verified the provider's signature; `notification.data.id` is the SIGNED
 * id. Per Mercado Pago's own recommendation the notification is still
 * never trusted directly -- the id is used to re-fetch the real resource
 * from their API before anything is updated.
 *
 * F3 / §18/19 + L11 / EN-3: two event types are handled:
 *  - 'subscription_preapproval': what may change is decided by
 *    `decideProviderEvent` (src/lib/entitlements/provider-events.ts) and
 *    applied only through the validated state machine. An administrator's
 *    decision and an administrator-set grant are never touched; a
 *    cancellation ends access at the end of the paid period; the payer is
 *    bound only when the provider reports `authorized`. A skipped event is
 *    logged and changes nothing.
 *  - 'payment': records ONE normalized payment row, idempotently keyed on
 *    (provider, provider_reference) -- a duplicate delivery can never
 *    create a second row (§19).
 * Any other event type is a controlled no-op. An unexpected failure
 * throws, so the route answers non-2xx and the provider retries (every
 * step here is idempotent).
 */
export async function handleMercadoPagoWebhook(notification: { type?: string; data?: { id?: string } }): Promise<void> {
  if (!isConfigured()) return;
  if (!notification.data?.id) return;
  const resourceId = encodeURIComponent(notification.data.id);

  if (notification.type === 'subscription_preapproval') {
    const response = await fetch(`${MP_API_BASE}/preapproval/${resourceId}`, {
      headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
    });
    if (!response.ok) return;

    const preapproval = await response.json();
    const reference = parseExternalReference(preapproval.external_reference);
    if (!reference || !preapproval.id) return;
    const { studentId, payerUserId } = reference;
    if (!(await rowExists('students', studentId))) return;

    const sub = await loadProviderView(studentId);
    const decision = decideProviderEvent(sub, {
      id: String(preapproval.id),
      status: String(preapproval.status ?? ''),
      nextPaymentDate: preapproval.next_payment_date ?? null,
    });

    if (decision.action === 'NONE' && decision.reason !== 'NO_STATUS_CHANGE' && decision.reason !== 'ALREADY_APPLIED') {
      console.warn('[mercadopago-webhook] provider event not applied, no state changed', {
        studentId,
        status: sub.status,
        providerStatus: preapproval.status,
        reason: decision.reason,
      });
    }

    if (decision.action === 'TRANSITION') {
      try {
        await transitionSubscriptionStatus(studentId, decision.to);
      } catch (error) {
        if (error instanceof InvalidSubscriptionTransitionError) {
          console.warn('[mercadopago-webhook] rejected invalid transition, no state changed', { studentId, from: sub.status, to: decision.to });
          return;
        }
        throw error;
      }
      if (decision.periodEnd) {
        await db.query(`UPDATE subscriptions SET current_period_end = $2, updated_at = NOW() WHERE student_id = $1`, [studentId, decision.periodEnd]);
      }
      const eventType = PROVIDER_EVENT_TYPE[decision.to];
      if (eventType) {
        await db.query(
          `INSERT INTO subscription_events (subscription_id, actor_user_id, event_type, previous_status, new_status, reason, source, metadata)
           SELECT id, NULL, $2, $3, $4, 'Mercado Pago notification', NULL, $5 FROM subscriptions WHERE student_id = $1`,
          [studentId, eventType, sub.status, decision.to, JSON.stringify({ provider: 'mercadopago', preapprovalId: String(preapproval.id), providerStatus: preapproval.status })]
        );
      }
    }

    if (decision.adoptProviderId) {
      await db.query(
        `UPDATE subscriptions SET provider = 'mercadopago', provider_subscription_id = $2, provider_payer_email = $3, updated_at = NOW()
          WHERE student_id = $1 AND manually_set_by_admin = false`,
        [studentId, String(preapproval.id), preapproval.payer_email ?? null]
      );
    }

    if (decision.action === 'TRANSITION' && decision.to === 'active' && payerUserId) {
      await bindPayerIfLive(studentId, payerUserId);
    }
    return;
  }

  if (notification.type === 'payment') {
    const response = await fetch(`${MP_API_BASE}/v1/payments/${resourceId}`, {
      headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
    });
    if (!response.ok) return;

    const payment = await response.json();
    const reference = parseExternalReference(payment.external_reference);
    if (!reference) return;
    const { studentId } = reference;

    const sub = await getSubscription(studentId);
    if (!sub.id) return; // no local subscription row to attach this payment to

    // The user who started the checkout this payment belongs to, when the reference names a real one.
    const payerUserId = reference.payerUserId && (await rowExists('users', reference.payerUserId)) ? reference.payerUserId : null;

    const status = payment.status === 'approved' ? 'SUCCEEDED' : payment.status === 'rejected' ? 'FAILED' : 'PENDING';
    const { inserted } = await recordPayment({
      subscriptionId: sub.id,
      payerUserId: payerUserId ?? sub.payerUserId,
      amountCents: Math.round((payment.transaction_amount ?? 0) * 100),
      currency: payment.currency_id ?? 'COP',
      provider: 'mercadopago',
      providerReference: String(payment.id),
      status,
    });
    if (inserted && status === 'SUCCEEDED' && payerUserId) {
      await bindPayerIfLive(studentId, payerUserId);
    }
    return;
  }

  // Any other event type: controlled no-op.
}
