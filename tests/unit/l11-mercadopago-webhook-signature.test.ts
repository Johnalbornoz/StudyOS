/**
 * L11 / EN-3 -- POST /api/webhooks/mercadopago accepts only a notification
 * signed by Mercado Pago (`x-signature`, MERCADOPAGO_WEBHOOK_SECRET). The id
 * that reaches the handler is the signed one, never one taken from the body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mercadoPagoManifest, signMercadoPagoManifest, verifyMercadoPagoSignature } from '@/lib/entitlements/mercadopago-signature';

const handleMock = vi.fn();
vi.mock('@/services/payment.service', () => ({ handleMercadoPagoWebhook: (...a: any[]) => handleMock(...a) }));

import { POST } from '@/app/api/webhooks/mercadopago/route';

const SECRET = 'test-webhook-secret';
const TS = '1760000000';
const sign = (dataId: string, requestId: string | null, secret = SECRET) => `ts=${TS},v1=${signMercadoPagoManifest(mercadoPagoManifest(dataId, requestId, TS), secret)}`;

function req(opts: { dataId?: string; signature?: string | null; requestId?: string | null; body?: unknown }) {
  const headers = new Headers();
  if (opts.signature) headers.set('x-signature', opts.signature);
  if (opts.requestId) headers.set('x-request-id', opts.requestId);
  const qs = opts.dataId ? `?data.id=${encodeURIComponent(opts.dataId)}&type=payment` : '';
  return { url: `https://studyus.test/api/webhooks/mercadopago${qs}`, headers, json: async () => opts.body ?? {} } as any;
}

beforeEach(() => {
  handleMock.mockReset().mockResolvedValue(undefined);
  vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', SECRET);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('verifyMercadoPagoSignature (pure)', () => {
  it('accepts the documented manifest id;request-id;ts', () => {
    expect(verifyMercadoPagoSignature({ signatureHeader: sign('123456', 'req-1'), requestId: 'req-1', dataId: '123456', secret: SECRET })).toEqual({ ok: true, dataId: '123456' });
  });
  it('lower-cases an alphanumeric data.id in the manifest and leaves out an absent request id', () => {
    expect(mercadoPagoManifest('ABC123', null, TS)).toBe(`id:abc123;ts:${TS};`);
    expect(verifyMercadoPagoSignature({ signatureHeader: sign('ABC123', null), requestId: null, dataId: 'ABC123', secret: SECRET }).ok).toBe(true);
  });
  it.each([
    ['no secret configured', { secret: undefined }, 'SECRET_NOT_CONFIGURED'],
    ['no signature header', { signatureHeader: null }, 'MISSING_SIGNATURE'],
    ['no data.id', { dataId: null }, 'MISSING_DATA_ID'],
    ['a data.id that is not a provider id', { dataId: '1/../../v1/users/me' }, 'MISSING_DATA_ID'],
    ['a malformed header', { signatureHeader: 'ts=abc,v1=zz' }, 'MALFORMED_SIGNATURE'],
    ['a signature made with another secret', { signatureHeader: sign('123456', 'req-1', 'other-secret') }, 'SIGNATURE_MISMATCH'],
    ['a signature for another resource', { signatureHeader: sign('999999', 'req-1') }, 'SIGNATURE_MISMATCH'],
    ['a signature for another request id', { requestId: 'req-2' }, 'SIGNATURE_MISMATCH'],
  ])('rejects %s', (_label, over, reason) => {
    const base = { signatureHeader: sign('123456', 'req-1'), requestId: 'req-1', dataId: '123456', secret: SECRET as string | undefined };
    expect(verifyMercadoPagoSignature({ ...base, ...over })).toEqual({ ok: false, reason });
  });
});

describe('POST /api/webhooks/mercadopago', () => {
  it('an unsigned POST is rejected and the handler never runs', async () => {
    const res = await POST(req({ dataId: '123456', body: { type: 'payment', data: { id: '123456' } } }));
    expect(res.status).toBe(401);
    expect(handleMock).not.toHaveBeenCalled();
  });

  it('a forged signature is rejected', async () => {
    const res = await POST(req({ dataId: '123456', requestId: 'req-1', signature: sign('123456', 'req-1', 'attacker-guess') }));
    expect(res.status).toBe(401);
    expect(handleMock).not.toHaveBeenCalled();
  });

  it('with no secret configured every POST is rejected, even a correctly formed one', async () => {
    vi.stubEnv('MERCADOPAGO_WEBHOOK_SECRET', '');
    const res = await POST(req({ dataId: '123456', requestId: 'req-1', signature: sign('123456', 'req-1') }));
    expect(res.status).toBe(401);
    expect(handleMock).not.toHaveBeenCalled();
  });

  it('a signed notification reaches the handler with the SIGNED id, not the id in the body', async () => {
    const res = await POST(req({ dataId: '123456', requestId: 'req-1', signature: sign('123456', 'req-1'), body: { type: 'subscription_preapproval', data: { id: '777777' } } }));
    expect(res.status).toBe(200);
    expect(handleMock).toHaveBeenCalledWith({ type: 'subscription_preapproval', data: { id: '123456' } });
  });

  it('a handler failure answers non-2xx so the provider retries', async () => {
    handleMock.mockRejectedValue(new Error('db down'));
    const res = await POST(req({ dataId: '123456', requestId: 'req-1', signature: sign('123456', 'req-1'), body: { type: 'payment' } }));
    expect(res.status).toBe(500);
  });
});
