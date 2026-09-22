import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { getUserDetail } from '@/services/user-admin.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.detail');
  if ('error' in guard) return guard.error;

  const { userId } = await params;
  const detail = await getUserDetail(userId);
  if (!detail) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  return NextResponse.json({ success: true, data: detail });
}
