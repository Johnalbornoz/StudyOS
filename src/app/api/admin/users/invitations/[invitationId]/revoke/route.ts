import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { revokeInvitation } from '@/services/user-admin.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ invitationId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.invite.revoke');
  if ('error' in guard) return guard.error;

  const { invitationId } = await params;
  try {
    await revokeInvitation(guard.admin.actor.id, invitationId);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'REVOKE_FAILED' }, { status: 409 });
  }
}
