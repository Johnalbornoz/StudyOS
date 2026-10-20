import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { isAllowlistedAdminUser } from '@/lib/admin/admin-identity';
import { setSubscriptionStatusManually, type SubscriptionStatus } from '@/services/payment.service';

const VALID_STATUSES: SubscriptionStatus[] = ['unpaid', 'active', 'past_due', 'canceled'];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!isAllowlistedAdminUser(user)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const { id } = await params;
  const { status } = await request.json();
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 });
  }

  await setSubscriptionStatusManually(id, status);
  return NextResponse.json({ success: true });
}
