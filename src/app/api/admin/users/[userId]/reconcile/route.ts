import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { reconcileSyncError } from '@/services/user-admin.service';

/** Records that a SYNC_ERROR finding was manually reviewed -- never fabricates a role, profile, or Clerk account to "fix" it. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.reconcile');
  if ('error' in guard) return guard.error;

  const { userId } = await params;
  await reconcileSyncError(guard.admin.actor.id, userId);
  return NextResponse.json({ success: true });
}
