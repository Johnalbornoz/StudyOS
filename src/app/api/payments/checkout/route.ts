import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { getOrCreateStudentId } from '@/lib/auth';
import { createMercadoPagoCheckout } from '@/services/payment.service';
import { SITE_URL } from '@/lib/seo';

export async function POST() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;
  if (!email) {
    return NextResponse.json({ error: 'NO_EMAIL' }, { status: 400 });
  }

  const studentId = await getOrCreateStudentId(clerkUserId);

  try {
    const { checkoutUrl } = await createMercadoPagoCheckout(studentId, email, `${SITE_URL}/dashboard`);
    return NextResponse.json({ data: { checkoutUrl } });
  } catch (error: any) {
    if (error.message === 'PAYMENT_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'PAYMENT_NOT_CONFIGURED' }, { status: 503 });
    }
    console.error('Error creating Mercado Pago checkout:', error);
    return NextResponse.json({ error: 'CHECKOUT_FAILED' }, { status: 500 });
  }
}
