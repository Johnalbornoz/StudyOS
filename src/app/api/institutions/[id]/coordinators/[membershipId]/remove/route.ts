/** Track A -- POST: a coordinator removes ANOTHER coordinator of the same institution (never themself, never the last one). */
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { removeCoordinator, CoordinatorError } from '@/services/institution-admin.service';
import { coordinatorErrorResponse } from '@/lib/institution/coordinator-responses';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; membershipId: string }> }) {
  const { id, membershipId } = await params;
  if (!allUuids(id, membershipId)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  try {
    await removeCoordinator(id, membershipId, guard.actor.id, 'COORDINATOR');
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof CoordinatorError) return coordinatorErrorResponse(error);
    throw error;
  }
}
