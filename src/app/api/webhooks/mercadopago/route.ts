import { NextRequest, NextResponse } from 'next/server';
import { handleMercadoPagoWebhook } from '@/services/payment.service';
import { verifyMercadoPagoSignature } from '@/lib/entitlements/mercadopago-signature';

// Public endpoint -- Mercado Pago calls this directly, no Clerk session.
//
// L11 / EN-3: every notification must carry Mercado Pago's `x-signature`
// for MERCADOPAGO_WEBHOOK_SECRET. An unsigned or wrongly signed POST is
// rejected before anything is read or fetched, and so is every POST while
// no secret is configured. The id handed to the handler is the SIGNED one
// (the `data.id` query parameter), never an id taken from the body; the
// handler then re-fetches the resource from Mercado Pago's API rather than
// trusting the payload.
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const verification = verifyMercadoPagoSignature({
    signatureHeader: req.headers.get('x-signature'),
    requestId: req.headers.get('x-request-id'),
    dataId: url.searchParams.get('data.id'),
    secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
  });
  if (!verification.ok) {
    console.warn('[mercadopago-webhook] rejected notification', { reason: verification.reason });
    return NextResponse.json({ error: 'INVALID_SIGNATURE' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    const type = typeof body?.type === 'string' ? body.type : (url.searchParams.get('type') ?? undefined);
    await handleMercadoPagoWebhook({ type, data: { id: verification.dataId } });
  } catch (error) {
    // Non-2xx so Mercado Pago retries: the handler is idempotent, and a 200 here would lose the event.
    console.error('Error handling Mercado Pago webhook:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'WEBHOOK_FAILED' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
