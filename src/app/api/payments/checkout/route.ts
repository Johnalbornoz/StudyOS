/**
 * POST /api/payments/checkout
 *
 * Two authorized callers, never inferred from anything but a server-
 * side check:
 *   1. The Student themself (their own ACTIVE STUDENT role, resolved
 *      via `requireStudentId` -- never silently provisioned).
 *   2. A Parent paying for an authorized child: requires an
 *      'accepted' `parent_student_relationships` row for the exact
 *      `studentId` in the request body (`isActiveParentOf`). Buying a
 *      license never creates or substitutes for that relationship --
 *      it must already exist.
 *
 * Either way, `payerUserId` recorded on the resulting subscription is
 * always the CALLER's own F1 canonical user id, never the student's --
 * the license belongs to the student, the payer is tracked separately
 * (F3 `payer_user_id`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { z } from 'zod';
import { requireStudentId } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { isActiveParentOf } from '@/lib/authorization';
import { createMercadoPagoCheckout } from '@/services/payment.service';
import { SITE_URL } from '@/lib/seo';

const Schema = z.object({ studentId: z.string().uuid().optional() });

export async function POST(request: NextRequest) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;
  if (!email) {
    return NextResponse.json({ error: 'NO_EMAIL' }, { status: 400 });
  }

  let validated;
  try {
    validated = Schema.parse(await request.json().catch(() => ({})));
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const payer = await getOrCreateCanonicalUser(clerkUserId, email);

  let studentId: string;
  if (validated.studentId) {
    // A Parent paying for an authorized child.
    const allowed = await isActiveParentOf(payer.id, validated.studentId);
    if (!allowed) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    studentId = validated.studentId;
  } else {
    // Self-checkout -- the caller must already hold an ACTIVE STUDENT role.
    const ownId = await requireStudentId(clerkUserId);
    if (!ownId) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    studentId = ownId;
  }

  try {
    const { checkoutUrl } = await createMercadoPagoCheckout(studentId, email, `${SITE_URL}/dashboard`, payer.id);
    return NextResponse.json({ data: { checkoutUrl } });
  } catch (error: any) {
    if (error.message === 'PAYMENT_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'PAYMENT_NOT_CONFIGURED' }, { status: 503 });
    }
    console.error('Error creating Mercado Pago checkout:', error);
    return NextResponse.json({ error: 'CHECKOUT_FAILED' }, { status: 500 });
  }
}
