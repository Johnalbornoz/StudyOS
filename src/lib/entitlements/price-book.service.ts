import { db } from '@/lib/db';
import type { Plan } from './types';

export interface Price {
  country: string;
  currency: string;
  plan: Plan;
  amountCents: number;
}

/**
 * F3 / §7 -- resolves a price by country+currency+plan from the
 * explicit Price Book -- never a real-time FX conversion, never a
 * hardcoded amount in application code. Returns null (never a
 * fabricated fallback price) when no ACTIVE row exists for the
 * requested combination -- an unsupported market stays unsupported,
 * visibly, rather than silently defaulting to some other country's
 * price.
 */
export async function resolvePrice(country: string, currency: string, plan: Plan): Promise<Price | null> {
  const result = await db.query(
    `SELECT country, currency, plan, amount_cents FROM price_book WHERE country = $1 AND currency = $2 AND plan = $3 AND status = 'ACTIVE'`,
    [country, currency, plan]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  // `amount_cents` is a Postgres bigint -- the `pg` driver returns it as
  // a string to avoid silent precision loss on values beyond
  // Number.MAX_SAFE_INTEGER. A price in cents is always far below that
  // threshold, so a plain Number() conversion here is safe and never
  // loses precision in practice.
  return { country: row.country, currency: row.currency, plan: row.plan, amountCents: Number(row.amount_cents) };
}
