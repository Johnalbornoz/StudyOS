/**
 * L11 / EN-3 -- the Mercado Pago checkout and webhook, run against an
 * in-memory `subscriptions` row with the real state machine and the real
 * provider-event rules. Asserts on what is actually written.
 *
 *  - provider events never touch an administrator's grant or decision;
 *  - starting a checkout binds nobody and rewrites nothing;
 *  - the payer is bound on a confirmed payment, only with a live relationship;
 *  - a provider cancellation ends access at the end of the paid period.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const STUDENT_USER = '22222222-2222-4222-8222-222222222222';
const PARENT_USER = '33333333-3333-4333-8333-333333333333';
const FUTURE = '2099-01-01T00:00:00.000Z';

type Row = Record<string, any>;
const state: { sub: Row | null; events: Row[]; payments: Row[]; liveParents: Set<string>; writes: string[] } = { sub: null, events: [], payments: [], liveParents: new Set(), writes: [] };

const newRow = (over: Row = {}): Row => ({
  id: 'sub-1',
  student_id: STUDENT,
  status: 'unpaid',
  plan: null,
  provider: null,
  provider_subscription_id: null,
  provider_payer_email: null,
  payer_user_id: null,
  current_period_end: null,
  manually_set_by_admin: false,
  grant_expires_at: null,
  grant_reason: null,
  granted_by_user_id: null,
  source: null,
  ...over,
});

vi.mock('@/lib/db', () => ({
  db: {
    query: async (sql: string, params: any[] = []) => {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (/^(INSERT|UPDATE|DELETE)/i.test(q)) state.writes.push(q);

      // `isOwner(actor, learner)` -- params [learnerId, actorUserId]. Matched by shape, not by text:
      // L10 SF-1/SF-2 rewrote the query (ACTIVE account, ACTIVE STUDENT role, canonical owner match).
      // The learner here is an active Student, which is what both versions answer for.
      if (/^SELECT 1 FROM students\b/.test(q) && params.length === 2) return { rows: params[0] === STUDENT && params[1] === STUDENT_USER ? [{}] : [] };
      if (/^SELECT 1 FROM students WHERE id = \$1 LIMIT 1/.test(q)) return { rows: params[0] === STUDENT ? [{}] : [] };
      if (/^SELECT 1 FROM users WHERE id = \$1/.test(q)) return { rows: [STUDENT_USER, PARENT_USER].includes(params[0]) ? [{}] : [] };
      if (/FROM parent_student_relationships/.test(q)) return { rows: state.liveParents.has(params[0]) && params[1] === STUDENT ? [{}] : [] };
      if (/^SELECT .* FROM subscriptions WHERE student_id = \$1/.test(q)) return { rows: state.sub ? [{ ...state.sub }] : [] };

      if (/^INSERT INTO subscriptions \(student_id, status\) VALUES/.test(q)) {
        // transitionSubscriptionStatus: the only writer of `status`.
        state.sub = state.sub ? { ...state.sub, status: params[1] } : newRow({ status: params[1] });
        return { rows: [] };
      }
      if (/^INSERT INTO subscriptions \(student_id, status, provider\) VALUES .* ON CONFLICT \(student_id\) DO NOTHING/.test(q)) {
        if (!state.sub) state.sub = newRow({ provider: 'mercadopago' });
        return { rows: [] };
      }
      if (/^UPDATE subscriptions SET current_period_end = \$2/.test(q)) {
        state.sub!.current_period_end = params[1];
        return { rows: [] };
      }
      if (/^UPDATE subscriptions SET provider = 'mercadopago', provider_subscription_id = \$2, provider_payer_email = \$3/.test(q)) {
        if (state.sub && (!state.sub.manually_set_by_admin || state.sub.status === 'expired')) Object.assign(state.sub, { provider: 'mercadopago', provider_subscription_id: params[1], provider_payer_email: params[2] });
        return { rows: [] };
      }
      if (/^UPDATE subscriptions SET manually_set_by_admin = false, source = 'INDIVIDUAL_PAYMENT'.* WHERE student_id = \$1 AND manually_set_by_admin = true AND status = 'expired'$/.test(q)) {
        if (state.sub && state.sub.manually_set_by_admin && state.sub.status === 'expired') Object.assign(state.sub, { manually_set_by_admin: false, source: 'INDIVIDUAL_PAYMENT' });
        return { rows: [] };
      }
      if (/^SELECT occurred_at FROM subscription_events .* new_status = 'expired'/.test(q)) {
        const last = [...state.events].reverse().find((e) => e.to === 'expired');
        return { rows: last ? [{ occurred_at: last.at }] : [] };
      }
      if (/^UPDATE subscriptions SET payer_user_id = \$2, source = \$3/.test(q)) {
        if (!state.sub || state.sub.manually_set_by_admin) return { rows: [] };
        Object.assign(state.sub, { payer_user_id: params[1], source: params[2] });
        return { rows: [{ id: state.sub.id }] };
      }
      if (/^INSERT INTO subscription_events/.test(q)) {
        const at = new Date().toISOString();
        if (/'PAYMENT_CONFIRMED', \$2, 'active'/.test(q)) state.events.push({ type: 'PAYMENT_CONFIRMED', from: params[1], to: 'active', source: params[2], metadata: JSON.parse(params[3]), at });
        else if (/'EXPIRED', \$2, 'expired'/.test(q)) state.events.push({ type: 'EXPIRED', from: params[1], to: 'expired', at });
        else if (/'EXPIRED', 'cancelled_at_period_end', 'expired'/.test(q)) state.events.push({ type: 'EXPIRED', from: 'cancelled_at_period_end', to: 'expired', at });
        else state.events.push({ type: params[1], from: params[2], to: params[3], at });
        return { rows: [] };
      }
      if (/^INSERT INTO payments/.test(q)) {
        if (state.payments.some((p) => p.reference === params[5])) return { rows: [] };
        state.payments.push({ payer: params[1], reference: params[5], status: params[6] });
        return { rows: [{ id: 'pay-1' }] };
      }
      throw new Error(`unexpected SQL in test: ${q}`);
    },
  },
}));

import { createMercadoPagoCheckout, handleMercadoPagoWebhook, isLiveBillingActor } from '@/services/payment.service';
import { decideLearningAccess } from '@/lib/entitlements/learning-access';
import { encodeExternalReference } from '@/lib/entitlements/provider-events';

const fetchMock = vi.fn();
const provider = (resource: Row) => fetchMock.mockResolvedValue({ ok: true, json: async () => resource, text: async () => '' });
const preapproval = (status: string, over: Row = {}) => ({ id: 'pre-1', status, payer_email: 'payer@test.com', external_reference: encodeExternalReference(STUDENT, PARENT_USER), next_payment_date: FUTURE, ...over });
const event = (type = 'subscription_preapproval', id = 'pre-1') => handleMercadoPagoWebhook({ type, data: { id } });
const access = () => {
  const r = state.sub!;
  return decideLearningAccess(
    { id: r.id, studentId: STUDENT, status: r.status, plan: r.plan, payerUserId: r.payer_user_id, currentPeriodEnd: r.current_period_end, manuallySetByAdmin: r.manually_set_by_admin, grantExpiresAt: r.grant_expires_at },
    true
  );
};

beforeEach(() => {
  Object.assign(state, { sub: null, events: [], payments: [], liveParents: new Set([PARENT_USER]), writes: [] });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', 'test-token');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('administrator grants and decisions are untouched by provider events', () => {
  const GRANT = { status: 'active', manually_set_by_admin: true, grant_expires_at: FUTURE, grant_reason: 'Stage pilot', granted_by_user_id: 'admin-1', source: 'INSTITUTIONAL_LICENSE' };

  it.each(['pending', 'authorized', 'paused', 'cancelled'])('a student on a time-limited grant: a %s preapproval leaves every field as the administrator set it', async (status) => {
    state.sub = newRow(GRANT);
    const before = { ...state.sub };
    provider(preapproval(status));
    await event();
    expect(state.sub).toEqual(before);
    expect(state.writes).toEqual([]);
  });

  it('...so the grant expiry still applies: starting a checkout or an authorized preapproval never extends a grant', async () => {
    state.sub = newRow({ ...GRANT, grant_expires_at: '2020-01-01T00:00:00.000Z' });
    provider(preapproval('authorized'));
    await event();
    expect(state.sub).toMatchObject({ status: 'expired', manually_set_by_admin: true, grant_expires_at: '2020-01-01T00:00:00.000Z' });
    expect(access().licensed).toBe(false);
  });

  it('an administrator suspension is not reversed by a later authorized preapproval or payment', async () => {
    state.sub = newRow({ status: 'suspended', provider_subscription_id: 'pre-1' });
    provider(preapproval('authorized'));
    await event();
    provider({ id: 9001, status: 'approved', transaction_amount: 50, currency_id: 'COP', external_reference: encodeExternalReference(STUDENT, STUDENT_USER) });
    await event('payment', '9001');
    expect(state.sub!.status).toBe('suspended');
    expect(access().licensed).toBe(false);
    expect(state.events).toEqual([]);
  });

  it('the payment service never writes a grant field, and clears manually_set_by_admin in exactly one statement, guarded to an EXPIRED grant', () => {
    const src = readFileSync(join(process.cwd(), 'src/services/payment.service.ts'), 'utf-8');
    expect(src).not.toMatch(/SET[^;`]*(grant_expires_at|grant_reason|granted_by_user_id)\s*=/);
    const clears = src.match(/SET manually_set_by_admin = false[^`]*`/g) ?? [];
    expect(clears).toHaveLength(1);
    expect(clears[0]).toMatch(/WHERE student_id = \$1 AND manually_set_by_admin = true AND status = 'expired'/);
  });
});

describe('checkout: starting one binds nobody', () => {
  it('sends learner and payer in the provider reference and creates only the empty row', async () => {
    provider({ id: 'pre-1', init_point: 'https://mp.example/checkout' });
    await expect(createMercadoPagoCheckout(STUDENT, 'payer@test.com', 'https://studyus.test/dashboard', PARENT_USER)).resolves.toEqual({ checkoutUrl: 'https://mp.example/checkout' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).external_reference).toBe(`${STUDENT}:${PARENT_USER}`);
    expect(state.sub).toMatchObject({ status: 'unpaid', payer_user_id: null, provider_subscription_id: null });
  });

  it('a parent starting a checkout does not rewrite the payer or provider ids of an existing subscription', async () => {
    state.sub = newRow({ status: 'past_due', payer_user_id: STUDENT_USER, provider_subscription_id: 'pre-OLD', provider_payer_email: 'student@test.com' });
    const before = { ...state.sub };
    provider({ id: 'pre-2', init_point: 'https://mp.example/checkout' });
    await createMercadoPagoCheckout(STUDENT, 'parent@test.com', 'https://studyus.test/dashboard', PARENT_USER);
    expect(state.sub).toEqual(before);
  });

  it.each([
    ['an administrator suspension', { status: 'suspended' }],
    ['a running administrative grant', { status: 'active', manually_set_by_admin: true, grant_expires_at: FUTURE }],
    ['an already active subscription', { status: 'active' }],
  ])('refuses %s before calling the provider: nobody is charged for a subscription a payment cannot activate', async (_label, row) => {
    state.sub = newRow(row);
    await expect(createMercadoPagoCheckout(STUDENT, 'p@test.com', 'https://studyus.test/dashboard', STUDENT_USER)).rejects.toThrow('SUBSCRIPTION_NOT_PURCHASABLE');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });
});

describe('payer binding: on payment, tied to a live relationship', () => {
  it('authorized: activates, records the event, and binds the linked parent as payer', async () => {
    state.sub = newRow();
    provider(preapproval('authorized'));
    await event();
    expect(state.sub).toMatchObject({ status: 'active', payer_user_id: PARENT_USER, source: 'PARENT_PAYMENT', provider_subscription_id: 'pre-1', current_period_end: FUTURE, manually_set_by_admin: false });
    expect(state.events).toMatchObject([{ type: 'PAYMENT_CONFIRMED', from: 'unpaid', to: 'active' }]);
    expect(state.events).toHaveLength(1);
  });

  it('the learner paying for themself is bound as an individual payment', async () => {
    state.sub = newRow();
    provider(preapproval('authorized', { external_reference: encodeExternalReference(STUDENT, STUDENT_USER) }));
    await event();
    expect(state.sub).toMatchObject({ status: 'active', payer_user_id: STUDENT_USER, source: 'INDIVIDUAL_PAYMENT' });
  });

  it('a parent whose relationship ended before the payment is NOT bound; the learner still gets the licence', async () => {
    state.liveParents.clear();
    state.sub = newRow();
    provider(preapproval('authorized'));
    await event();
    expect(state.sub).toMatchObject({ status: 'active', payer_user_id: null });
  });

  it('a pending preapproval binds nobody', async () => {
    state.sub = newRow();
    provider(preapproval('pending'));
    await event();
    expect(state.sub).toMatchObject({ status: 'unpaid', payer_user_id: null, provider_subscription_id: null });
  });

  it('billing rights end with the relationship: the stored payer is no longer a live billing actor after unlinking', async () => {
    expect(await isLiveBillingActor(PARENT_USER, STUDENT)).toBe(true);
    state.liveParents.clear();
    expect(await isLiveBillingActor(PARENT_USER, STUDENT)).toBe(false);
    expect(await isLiveBillingActor(STUDENT_USER, STUDENT)).toBe(true);
  });

  it('a payment event records one row with the paying user; a duplicate delivery adds nothing', async () => {
    state.sub = newRow({ status: 'active', provider_subscription_id: 'pre-1' });
    provider({ id: 9001, status: 'approved', transaction_amount: 50, currency_id: 'COP', external_reference: encodeExternalReference(STUDENT, PARENT_USER) });
    await event('payment', '9001');
    await event('payment', '9001');
    expect(state.payments).toEqual([{ payer: PARENT_USER, reference: '9001', status: 'SUCCEEDED' }]);
    expect(state.sub!.payer_user_id).toBe(PARENT_USER);
  });
});

describe('provider cancellation is honoured', () => {
  it('active: access continues to the end of the paid period, then ends', async () => {
    state.sub = newRow({ status: 'active', provider_subscription_id: 'pre-1' });
    provider(preapproval('cancelled'));
    await event();
    expect(state.sub).toMatchObject({ status: 'cancelled_at_period_end', current_period_end: FUTURE });
    expect(access().licensed).toBe(true);
    expect(state.events).toMatchObject([{ type: 'CANCELLED', from: 'active', to: 'cancelled_at_period_end' }]);
    expect(state.events).toHaveLength(1);

    state.sub!.current_period_end = '2020-01-01T00:00:00.000Z';
    expect(access()).toMatchObject({ licensed: false, reason: 'PERIOD_ENDED' });
  });

  it('active with no paid period known: access ends immediately', async () => {
    state.sub = newRow({ status: 'active', provider_subscription_id: 'pre-1' });
    provider(preapproval('cancelled', { next_payment_date: null }));
    await event();
    expect(state.sub!.status).toBe('cancelled_at_period_end');
    expect(decideLearningAccess({ id: 'sub-1', studentId: STUDENT, status: 'cancelled_at_period_end', plan: null, payerUserId: null, currentPeriodEnd: state.sub!.current_period_end, manuallySetByAdmin: false, grantExpiresAt: null }, true, new Date(Date.now() + 1000)).licensed).toBe(false);
  });

  it('an abandoned second checkout being cancelled does not cancel the running subscription', async () => {
    state.sub = newRow({ status: 'active', provider_subscription_id: 'pre-1' });
    provider(preapproval('cancelled', { id: 'pre-ABANDONED' }));
    await event('subscription_preapproval', 'pre-ABANDONED');
    expect(state.sub!.status).toBe('active');
    expect(state.writes).toEqual([]);
  });
});

describe('inert and malformed input', () => {
  it('does nothing while Mercado Pago is not configured', async () => {
    vi.stubEnv('MERCADOPAGO_ACCESS_TOKEN', '');
    await event();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a reference that is not ours, or names an unknown learner, changes nothing', async () => {
    provider(preapproval('authorized', { external_reference: 'DROP TABLE' }));
    await event();
    provider(preapproval('authorized', { external_reference: '99999999-9999-4999-8999-999999999999' }));
    await event();
    expect(state.sub).toBeNull();
    expect(state.writes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// L11-R1 -- renewal after expiry, grant -> paid, and what stays closed.
// ---------------------------------------------------------------------------

const PAST = '2020-01-01T00:00:00.000Z';
const approvedPayment = (over: Row = {}) => ({ id: 9100, status: 'approved', date_approved: new Date().toISOString(), transaction_amount: 50, currency_id: 'COP', external_reference: encodeExternalReference(STUDENT, STUDENT_USER), ...over });
const pay = async (resource: Row) => {
  provider(resource);
  await event('payment', String(resource.id));
};
const checkout = (payer = STUDENT_USER) => {
  provider({ id: 'pre-9', init_point: 'https://mp.example/checkout' });
  return createMercadoPagoCheckout(STUDENT, 'p@test.com', 'https://studyus.test/dashboard', payer);
};

describe('EXPIRED RENEWAL: only a new, explicitly authorized period', () => {
  const expiredPaid = () => newRow({ status: 'expired', source: 'INDIVIDUAL_PAYMENT', payer_user_id: STUDENT_USER, provider_subscription_id: 'pre-OLD', current_period_end: PAST });

  it('an expired paid subscription can start a checkout again', async () => {
    state.sub = expiredPaid();
    await expect(checkout()).resolves.toEqual({ checkoutUrl: 'https://mp.example/checkout' });
    expect(state.sub).toMatchObject({ status: 'expired' });
  });

  it('checkout creation alone renews nothing', async () => {
    state.sub = expiredPaid();
    await checkout();
    expect(state.sub!.status).toBe('expired');
    expect(access().licensed).toBe(false);
  });

  it('a provider "authorized" preapproval without a confirmed payment renews nothing', async () => {
    state.sub = expiredPaid();
    provider(preapproval('authorized', { id: 'pre-9', external_reference: encodeExternalReference(STUDENT, STUDENT_USER) }));
    await event('subscription_preapproval', 'pre-9');
    expect(state.sub).toMatchObject({ status: 'expired', provider_subscription_id: 'pre-9' });
    expect(access().licensed).toBe(false);
    expect(state.events).toEqual([]);
  });

  it('a pending or rejected payment renews nothing', async () => {
    state.sub = expiredPaid();
    await pay(approvedPayment({ id: 9101, status: 'in_process', date_approved: null }));
    await pay(approvedPayment({ id: 9102, status: 'rejected', date_approved: null }));
    expect(state.sub!.status).toBe('expired');
    expect(state.payments.map((p) => p.status)).toEqual(['PENDING', 'FAILED']);
  });

  it('a CONFIRMED payment establishes a new paid period, and is recorded', async () => {
    state.sub = expiredPaid();
    await pay(approvedPayment());
    expect(state.sub).toMatchObject({ status: 'active', manually_set_by_admin: false, payer_user_id: STUDENT_USER, source: 'INDIVIDUAL_PAYMENT' });
    expect(new Date(state.sub!.current_period_end).getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000);
    expect(access().licensed).toBe(true);
    expect(state.events).toMatchObject([{ type: 'PAYMENT_CONFIRMED', from: 'expired', to: 'active', metadata: { paymentReference: '9100' } }]);
    expect(state.events[0].metadata.previousSponsorship).toBeUndefined();
  });

  it('a payment approved BEFORE the entitlement expired (late or replayed notification) renews nothing', async () => {
    state.sub = expiredPaid();
    state.events.push({ type: 'EXPIRED', from: 'active', to: 'expired', at: '2026-10-01T00:00:00.000Z' });
    await pay(approvedPayment({ date_approved: '2026-09-15T00:00:00.000Z' }));
    expect(state.sub!.status).toBe('expired');
    expect(access().licensed).toBe(false);
  });

  it('a duplicate delivery of the renewing payment changes nothing more', async () => {
    state.sub = expiredPaid();
    const resource = approvedPayment();
    await pay(resource);
    await pay(resource);
    expect(state.payments).toHaveLength(1);
    expect(state.events.filter((e) => e.type === 'PAYMENT_CONFIRMED')).toHaveLength(1);
  });

  it('a cancelled subscription past its paid period is reconciled to expired, then renewable the same way', async () => {
    state.sub = newRow({ status: 'cancelled_at_period_end', current_period_end: PAST, provider_subscription_id: 'pre-OLD' });
    await checkout();
    expect(state.sub!.status).toBe('expired');
    // The payment is confirmed after the checkout that reconciled the expiry.
    await pay(approvedPayment({ date_approved: new Date(Date.now() + 60_000).toISOString() }));
    expect(state.sub!.status).toBe('active');
  });

  it('a cancelled subscription still inside its paid period is not purchasable (already has access)', async () => {
    state.sub = newRow({ status: 'cancelled_at_period_end', current_period_end: FUTURE });
    await expect(checkout()).rejects.toThrow('SUBSCRIPTION_NOT_PURCHASABLE');
  });
});

describe('GRANT -> PAID', () => {
  const SPONSORSHIP = { manually_set_by_admin: true, source: 'INSTITUTIONAL_LICENSE', grant_reason: 'Colegio pilot 2026', granted_by_user_id: 'admin-1' };
  const expiredGrant = () => newRow({ ...SPONSORSHIP, status: 'expired', grant_expires_at: PAST });

  it('ACTIVE grant: checkout refuses to charge, the provider is never called', async () => {
    state.sub = newRow({ ...SPONSORSHIP, status: 'active', grant_expires_at: FUTURE });
    await expect(checkout()).rejects.toThrow('SUBSCRIPTION_NOT_PURCHASABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a grant past its expiry but not yet reconciled is reconciled first, then purchasable', async () => {
    state.sub = newRow({ ...SPONSORSHIP, status: 'active', grant_expires_at: PAST });
    await expect(checkout()).resolves.toBeTruthy();
    expect(state.sub).toMatchObject({ status: 'expired', manually_set_by_admin: true });
  });

  it('EXPIRED grant: historical sponsorship does not block checkout, and checkout alone changes nothing', async () => {
    state.sub = expiredGrant();
    const before = { ...state.sub };
    await expect(checkout()).resolves.toBeTruthy();
    expect(state.sub).toEqual(before);
  });

  it('EXPIRED grant + authorized preapproval only: still an expired grant, no access', async () => {
    state.sub = expiredGrant();
    provider(preapproval('authorized', { id: 'pre-9' }));
    await event('subscription_preapproval', 'pre-9');
    expect(state.sub).toMatchObject({ ...SPONSORSHIP, status: 'expired', grant_expires_at: PAST });
    expect(access().licensed).toBe(false);
  });

  it('EXPIRED grant + CONFIRMED payment: a paid period, with the sponsorship kept as history, not rewritten as paid', async () => {
    state.sub = expiredGrant();
    await pay(approvedPayment({ external_reference: encodeExternalReference(STUDENT, PARENT_USER) }));

    // The Student now has a paid entitlement period...
    expect(state.sub).toMatchObject({ status: 'active', manually_set_by_admin: false, source: 'PARENT_PAYMENT', payer_user_id: PARENT_USER });
    expect(access()).toMatchObject({ licensed: true, source: 'PAID' });
    // ...the grant's own columns are untouched...
    expect(state.sub).toMatchObject({ grant_expires_at: PAST, grant_reason: 'Colegio pilot 2026', granted_by_user_id: 'admin-1' });
    // ...and the event that starts the paid period carries what it follows.
    expect(state.events).toMatchObject([
      {
        type: 'PAYMENT_CONFIRMED',
        from: 'expired',
        to: 'active',
        source: 'PARENT_PAYMENT',
        metadata: { previousSponsorship: { source: 'INSTITUTIONAL_LICENSE', grantExpiresAt: PAST, grantReason: 'Colegio pilot 2026', grantedByUserId: 'admin-1' } },
      },
    ]);
  });

  it('a payment approved before the grant expired does not turn the grant into a paid subscription', async () => {
    state.sub = newRow({ ...SPONSORSHIP, status: 'expired', grant_expires_at: '2026-10-01T00:00:00.000Z' });
    await pay(approvedPayment({ date_approved: '2026-09-01T00:00:00.000Z' }));
    expect(state.sub).toMatchObject({ status: 'expired', manually_set_by_admin: true });
  });
});

describe('ADMIN SUSPENSION / REVOCATION stays fail-closed against every provider path', () => {
  const cases: Array<[string, Row]> = [
    ['an admin-suspended paid subscription', { status: 'suspended', provider_subscription_id: 'pre-1' }],
    ['a revoked grant', { status: 'suspended', manually_set_by_admin: true, grant_expires_at: FUTURE, source: 'INSTITUTIONAL_LICENSE' }],
    ['a revoked grant whose expiry date has since passed', { status: 'suspended', manually_set_by_admin: true, grant_expires_at: PAST, source: 'INSTITUTIONAL_LICENSE' }],
  ];

  it.each(cases)('%s: checkout refused; authorized preapproval and confirmed payment change nothing', async (_label, row) => {
    state.sub = newRow(row);
    const before = { ...state.sub };
    await expect(checkout()).rejects.toThrow('SUBSCRIPTION_NOT_PURCHASABLE');
    provider(preapproval('authorized'));
    await event();
    await pay(approvedPayment());
    expect(state.sub).toEqual(before);
    expect(access().licensed).toBe(false);
    expect(state.events).toEqual([]);
    // The payment itself is still recorded for reconciliation.
    expect(state.payments).toHaveLength(1);
  });

  it('a standing grant is not converted by a confirmed payment either', async () => {
    state.sub = newRow({ status: 'active', manually_set_by_admin: true, grant_expires_at: FUTURE, source: 'TRIAL' });
    const before = { ...state.sub };
    await pay(approvedPayment());
    expect(state.sub).toEqual(before);
  });
});
