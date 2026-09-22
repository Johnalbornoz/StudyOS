import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { reactivateUser, getClerkIdForCanonicalUser } from '@/services/user-admin.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.reactivate');
  if ('error' in guard) return guard.error;

  const { userId } = await params;
  const targetClerkId = await getClerkIdForCanonicalUser(userId);
  if (!targetClerkId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  await reactivateUser(guard.admin.actor.id, userId, targetClerkId);
  return NextResponse.json({ success: true });
}
