/** Track A -- POST: the Platform Admin removes a coordinator of this institution (membership → REVOKED; audited). */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { allUuids } from '@/lib/institution/route-guard';
import { removeCoordinator, CoordinatorError } from '@/services/institution-admin.service';
import { coordinatorErrorResponse } from '@/lib/institution/coordinator-responses';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; membershipId: string }> }) {
  const { id, membershipId } = await params;
  const guard = await guardAdminUsersRoute('admin.institutions.coordinators.remove');
  if ('error' in guard) return guard.error;
  if (!allUuids(id, membershipId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  try {
    await removeCoordinator(id, membershipId, guard.admin.actor.id, 'PLATFORM');
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof CoordinatorError) return coordinatorErrorResponse(error);
    throw error;
  }
}
