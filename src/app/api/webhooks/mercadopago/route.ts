import { NextRequest, NextResponse } from 'next/server';
import { handleMercadoPagoWebhook } from '@/services/payment.service';

// Public endpoint -- Mercado Pago calls this directly, no Clerk session.
// The handler re-fetches the resource from Mercado Pago's API by id
// rather than trusting this payload, so an unauthenticated POST here
// can't forge a paid status on its own.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    await handleMercadoPagoWebhook(body);
  } catch (error) {
    console.error('Error handling Mercado Pago webhook:', error);
  }
  // Always 200 -- Mercado Pago retries aggressively on non-2xx.
  return NextResponse.json({ received: true });
}
