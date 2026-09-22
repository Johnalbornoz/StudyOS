import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { detectSyncErrors } from '@/services/user-admin.service';

/** Read-only, best-effort, bounded sample -- never repairs anything itself. */
export async function GET(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.users.sync-check');
  if ('error' in guard) return guard.error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50));

  const result = await detectSyncErrors(limit);
  return NextResponse.json({ success: true, data: result });
}
