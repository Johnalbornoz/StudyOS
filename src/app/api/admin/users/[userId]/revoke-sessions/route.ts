import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { getClerkIdForCanonicalUser, revokeSessionsOnly } from '@/services/user-admin.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.revoke-sessions');
  if ('error' in guard) return guard.error;

  const { userId } = await params;
  const targetClerkId = await getClerkIdForCanonicalUser(userId);
  if (!targetClerkId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const count = await revokeSessionsOnly(guard.admin.actor.id, userId, targetClerkId);
  return NextResponse.json({ success: true, data: { sessionsRevoked: count } });
}
