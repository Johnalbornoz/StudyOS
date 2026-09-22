import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { reconcileMembership } from '@/services/membership-admin.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ subscriptionId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.memberships.reconcile');
  if ('error' in guard) return guard.error;

  const { subscriptionId } = await params;
  await reconcileMembership(guard.admin.actor.id, subscriptionId);
  return NextResponse.json({ success: true });
}
