import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { getMembershipDetail } from '@/services/membership-admin.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ subscriptionId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.memberships.detail');
  if ('error' in guard) return guard.error;

  const { subscriptionId } = await params;
  const detail = await getMembershipDetail(subscriptionId, guard.admin.actor.id);
  if (!detail) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  return NextResponse.json({ success: true, data: detail });
}
