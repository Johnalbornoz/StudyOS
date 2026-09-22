import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { getAdminOverview } from '@/services/admin-overview.service';
import { listPendingInvitations } from '@/services/user-admin.service';

export async function GET(_request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.overview');
  if ('error' in guard) return guard.error;

  const [overview, invitations] = await Promise.all([getAdminOverview(), listPendingInvitations().catch(() => [])]);
  return NextResponse.json({ success: true, data: { ...overview, pendingInvitations: invitations.length } });
}
