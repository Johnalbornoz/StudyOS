/** Track A -- POST: the Platform Admin withdraws a pending coordinator invitation (single use; audited). */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { allUuids } from '@/lib/institution/route-guard';
import { revokeCoordinatorInvitation } from '@/services/institution-admin.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; invitationId: string }> }) {
  const { id, invitationId } = await params;
  const guard = await guardAdminUsersRoute('admin.institutions.coordinators.revoke');
  if ('error' in guard) return guard.error;
  if (!allUuids(id, invitationId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const ok = await revokeCoordinatorInvitation(id, invitationId, guard.admin.actor.id);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
}
