import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { detectMembershipInconsistencies } from '@/services/membership-admin.service';

export async function GET(_request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.memberships.inconsistencies');
  if ('error' in guard) return guard.error;

  const findings = await detectMembershipInconsistencies();
  return NextResponse.json({ success: true, data: { findings } });
}
