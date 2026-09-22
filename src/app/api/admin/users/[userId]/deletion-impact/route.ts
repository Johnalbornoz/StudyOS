import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { computeDeletionImpact } from '@/services/user-admin.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.deletion-impact');
  if ('error' in guard) return guard.error;

  const { userId } = await params;
  const impact = await computeDeletionImpact(userId);
  return NextResponse.json({ success: true, data: impact });
}
