/**
 * Track A -- /api/admin/institutions/[id]/coordinators (Platform Admin only)
 * GET: coordinators of the institution (members + invitations).
 * POST { email, name? }: add a coordinator. An existing account (StudyUs or
 *   Clerk) is assigned directly (no second account); otherwise a one-time
 *   invitation is created and Clerk emails a sign-up link back to the
 *   acceptance page. The institution must be ACTIVE (409).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { allUuids, readJson } from '@/lib/institution/route-guard';
import { inviteCoordinator, listCoordinators, CoordinatorError, getInstitutionProfile } from '@/services/institution-admin.service';
import { CoordinatorInviteSchema, requestOrigin } from '@/lib/institution/profile-schema';
import { coordinatorErrorResponse, coordinatorInviteResponse } from '@/lib/institution/coordinator-responses';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardAdminUsersRoute('admin.institutions.coordinators');
  if ('error' in guard) return guard.error;
  if (!allUuids(id) || !(await getInstitutionProfile(id))) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: { coordinators: await listCoordinators(id) } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardAdminUsersRoute('admin.institutions.coordinators.invite');
  if ('error' in guard) return guard.error;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const parsed = CoordinatorInviteSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  try {
    const result = await inviteCoordinator({ institutionId: id, email: parsed.data.email, name: parsed.data.name, actorUserId: guard.admin.actor.id, acceptBaseUrl: requestOrigin(request) });
    return coordinatorInviteResponse(result);
  } catch (error) {
    if (error instanceof CoordinatorError) return coordinatorErrorResponse(error);
    throw error;
  }
}
