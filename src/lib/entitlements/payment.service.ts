import { db } from '@/lib/db';

export type PaymentStatus = 'SUCCEEDED' | 'FAILED' | 'PENDING';

/**
 * F3 / §19 -- records ONE normalized payment transaction, idempotently.
 * `UNIQUE(provider, provider_reference)` at the schema level is the
 * real idempotency guarantee -- ON CONFLICT DO NOTHING means the exact
 * same provider event, delivered any number of times (Mercado Pago
 * retries aggressively on non-2xx, per the existing webhook's own
 * comment), produces exactly one row, ever. Returns whether a NEW row
 * was actually inserted, so callers can distinguish a genuinely new
 * payment from a harmless duplicate delivery.
 */
export async function recordPayment(params: {
  subscriptionId: string;
  payerUserId: string | null;
  amountCents: number;
  currency: string;
  provider: string;
  providerReference: string;
  status: PaymentStatus;
  metadata?: Record<string, unknown>;
}): Promise<{ inserted: boolean }> {
  const result = await db.query(
    `
    INSERT INTO payments (subscription_id, payer_user_id, amount_cents, currency, provider, provider_reference, status, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (provider, provider_reference) DO NOTHING
    RETURNING id
    `,
    [
      params.subscriptionId,
      params.payerUserId,
      params.amountCents,
      params.currency,
      params.provider,
      params.providerReference,
      params.status,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ]
  );
  return { inserted: result.rows.length > 0 };
}

export async function getPaymentsForSubscription(subscriptionId: string): Promise<Array<{ id: string; amountCents: number; currency: string; status: PaymentStatus; occurredAt: string }>> {
  const result = await db.query(
    `SELECT id, amount_cents, currency, status, occurred_at FROM payments WHERE subscription_id = $1 ORDER BY occurred_at DESC`,
    [subscriptionId]
  );
  // amount_cents is a Postgres bigint -- see price-book.service.ts's
  // identical Number() conversion note.
  return result.rows.map((r: any) => ({ id: r.id, amountCents: Number(r.amount_cents), currency: r.currency, status: r.status, occurredAt: r.occurred_at }));
}
