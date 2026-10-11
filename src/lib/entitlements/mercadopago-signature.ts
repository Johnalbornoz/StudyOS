/**
 * L11 / EN-3 -- Mercado Pago webhook signature (`x-signature`).
 *
 * Mercado Pago signs every notification with the webhook secret of the
 * application: header `x-signature: ts=<ts>,v1=<hex hmac-sha256>`, computed
 * over the manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` where
 * `data.id` is the QUERY parameter of the notification URL (lower-cased) and
 * a part whose value is absent is left out of the manifest.
 *
 * Pure and fail-closed: no secret configured, no header, no `data.id`, a
 * malformed header or a mismatch all reject. The caller must use the
 * returned `dataId` (the signed one), never an id read from the body.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export type WebhookSignatureRejection =
  | 'SECRET_NOT_CONFIGURED'
  | 'MISSING_SIGNATURE'
  | 'MALFORMED_SIGNATURE'
  | 'MISSING_DATA_ID'
  | 'SIGNATURE_MISMATCH';

export type WebhookSignatureResult = { ok: true; dataId: string } | { ok: false; reason: WebhookSignatureRejection };

/** A provider resource id is only ever digits / letters; anything else never reaches a provider URL. */
const DATA_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function mercadoPagoManifest(dataId: string, requestId: string | null, ts: string): string {
  let manifest = `id:${dataId.toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  return manifest;
}

export function signMercadoPagoManifest(manifest: string, secret: string): string {
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

export function verifyMercadoPagoSignature(input: {
  signatureHeader: string | null | undefined;
  requestId: string | null | undefined;
  dataId: string | null | undefined;
  secret: string | null | undefined;
}): WebhookSignatureResult {
  if (!input.secret) return { ok: false, reason: 'SECRET_NOT_CONFIGURED' };
  if (!input.signatureHeader) return { ok: false, reason: 'MISSING_SIGNATURE' };
  if (!input.dataId || !DATA_ID_PATTERN.test(input.dataId)) return { ok: false, reason: 'MISSING_DATA_ID' };

  let ts: string | null = null;
  let v1: string | null = null;
  for (const part of input.signatureHeader.split(',')) {
    const [key, value] = part.split('=').map((s) => s?.trim());
    if (key === 'ts') ts = value ?? null;
    if (key === 'v1') v1 = value ?? null;
  }
  if (!ts || !v1 || !/^\d{1,20}$/.test(ts) || !/^[0-9a-f]{64}$/i.test(v1)) return { ok: false, reason: 'MALFORMED_SIGNATURE' };

  const expected = Buffer.from(signMercadoPagoManifest(mercadoPagoManifest(input.dataId, input.requestId ?? null, ts), input.secret), 'hex');
  const received = Buffer.from(v1.toLowerCase(), 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, reason: 'SIGNATURE_MISMATCH' };
  return { ok: true, dataId: input.dataId };
}
