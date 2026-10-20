/** Track A -- POST: a coordinator withdraws a pending coordinator invitation of the same institution. */
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { revokeCoordinatorInvitation } from '@/services/institution-admin.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; invitationId: string }> }) {
  const { id, invitationId } = await params;
  if (!allUuids(id, invitationId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const ok = await revokeCoordinatorInvitation(id, invitationId, guard.actor.id);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
}
