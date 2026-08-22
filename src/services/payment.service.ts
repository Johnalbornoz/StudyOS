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
 * No other code changes should be needed.
 */

import { db } from '@/lib/db';

const MP_API_BASE = 'https://api.mercadopago.com';

export type SubscriptionStatus = 'unpaid' | 'active' | 'past_due' | 'canceled';

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
 * Creates a Mercado Pago recurring subscription ("preapproval") for a
 * student and returns the checkout URL to redirect them to. Throws
 * PAYMENT_NOT_CONFIGURED if no Mercado Pago account is connected yet.
 */
export async function createMercadoPagoCheckout(
  studentId: string,
  studentEmail: string,
  backUrl: string
): Promise<{ checkoutUrl: string }> {
  if (!isConfigured()) {
    throw new Error('PAYMENT_NOT_CONFIGURED');
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
      reason: 'StudyUS - Suscripción mensual',
      payer_email: studentEmail,
      back_url: backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: amount,
        currency_id: currency,
      },
      external_reference: studentId,
      status: 'pending',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Mercado Pago API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();

  await db.query(
    `
    INSERT INTO subscriptions (student_id, status, provider, provider_subscription_id, provider_payer_email)
    VALUES ($1, 'unpaid', 'mercadopago', $2, $3)
    ON CONFLICT (student_id) DO UPDATE SET
      provider_subscription_id = EXCLUDED.provider_subscription_id,
      provider_payer_email = EXCLUDED.provider_payer_email,
      updated_at = NOW()
    `,
    [studentId, data.id, studentEmail]
  );

  return { checkoutUrl: data.init_point };
}

function mapMercadoPagoStatus(mpStatus: string): SubscriptionStatus {
  switch (mpStatus) {
    case 'authorized':
      return 'active';
    case 'paused':
      return 'past_due';
    case 'cancelled':
      return 'canceled';
    default:
      return 'unpaid';
  }
}

/**
 * Handles a Mercado Pago webhook notification. Per Mercado Pago's own
 * recommendation, the notification body is never trusted directly --
 * it only carries an id, which is used to re-fetch the real resource
 * from their API before updating anything.
 */
export async function handleMercadoPagoWebhook(notification: { type?: string; data?: { id?: string } }): Promise<void> {
  if (!isConfigured()) return;
  if (notification.type !== 'subscription_preapproval' || !notification.data?.id) return;

  const response = await fetch(`${MP_API_BASE}/preapproval/${notification.data.id}`, {
    headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
  });
  if (!response.ok) return;

  const preapproval = await response.json();
  const studentId = preapproval.external_reference;
  if (!studentId) return;

  await db.query(
    `
    INSERT INTO subscriptions (student_id, status, provider, provider_subscription_id, provider_payer_email)
    VALUES ($1, $2, 'mercadopago', $3, $4)
    ON CONFLICT (student_id) DO UPDATE SET
      status = EXCLUDED.status,
      provider_subscription_id = EXCLUDED.provider_subscription_id,
      provider_payer_email = EXCLUDED.provider_payer_email,
      manually_set_by_admin = false,
      updated_at = NOW()
    `,
    [studentId, mapMercadoPagoStatus(preapproval.status), preapproval.id, preapproval.payer_email]
  );
}
