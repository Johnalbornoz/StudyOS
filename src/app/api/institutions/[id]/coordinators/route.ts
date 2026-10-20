/**
 * Track A -- /api/institutions/[id]/coordinators (a coordinator of THIS institution)
 * GET: the institution's coordinators. POST { email, name? }: add another
 * coordinator to THIS institution only (same rules as the Platform Admin:
 * existing account assigned, otherwise a one-time invitation).
 */
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { inviteCoordinator, listCoordinators, CoordinatorError } from '@/services/institution-admin.service';
import { CoordinatorInviteSchema, requestOrigin } from '@/lib/institution/profile-schema';
import { coordinatorErrorResponse, coordinatorInviteResponse } from '@/lib/institution/coordinator-responses';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  return NextResponse.json({ success: true, data: { coordinators: await listCoordinators(id) } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = CoordinatorInviteSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    return coordinatorInviteResponse(
      await inviteCoordinator({ institutionId: id, email: parsed.data.email, name: parsed.data.name, actorUserId: guard.actor.id, acceptBaseUrl: requestOrigin(request) })
    );
  } catch (error) {
    if (error instanceof CoordinatorError) return coordinatorErrorResponse(error);
    throw error;
  }
}
