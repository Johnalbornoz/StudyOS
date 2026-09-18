/**
 * F3 / §19 -- payment recording and webhook idempotency. A duplicate
 * provider event must never duplicate a payment or corrupt
 * subscription state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQueryMock = vi.fn();
vi.mock('@/lib/db', () => ({ db: { query: (...a: any[]) => dbQueryMock(...a) } }));

import { recordPayment } from '@/lib/entitlements/payment.service';

beforeEach(() => {
  dbQueryMock.mockReset();
});

describe('recordPayment -- idempotent on (provider, provider_reference)', () => {
  const basePayment = {
    subscriptionId: 'sub-1',
    payerUserId: 'payer-1',
    amountCents: 3900000,
    currency: 'COP',
    provider: 'mercadopago',
    providerReference: 'mp-payment-123',
    status: 'SUCCEEDED' as const,
  };

  it('a new payment event inserts a row', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 'payment-1' }] });
    const result = await recordPayment(basePayment);
    expect(result.inserted).toBe(true);
    expect(dbQueryMock.mock.calls[0][0]).toMatch(/ON CONFLICT \(provider, provider_reference\) DO NOTHING/);
  });

  it('a duplicate delivery of the exact same event (same provider+reference) inserts nothing, reports inserted:false', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] }); // ON CONFLICT DO NOTHING -> no row returned
    const result = await recordPayment(basePayment);
    expect(result.inserted).toBe(false);
  });

  it('never issues more than one INSERT per call regardless of outcome', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    await recordPayment(basePayment);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });
});
