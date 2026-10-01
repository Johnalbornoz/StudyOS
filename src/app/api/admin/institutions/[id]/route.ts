/**
 * Track A -- /api/admin/institutions/[id] (Platform Admin only)
 * GET: the institution profile and its coordinators (members + invitations).
 * PATCH: edit the profile, including name and status (ACTIVE / DRAFT /
 *   SUSPENDED / ARCHIVED). Suspending closes the institution workspace to
 *   its coordinators and teachers. Audited (INSTITUTION_UPDATED).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { allUuids, readJson } from '@/lib/institution/route-guard';
import { getInstitutionProfile, listCoordinators, updateInstitutionProfile, DuplicateInstitutionError } from '@/services/institution-admin.service';
import { InstitutionPlatformPatchSchema } from '@/lib/institution/profile-schema';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardAdminUsersRoute('admin.institutions.read');
  if ('error' in guard) return guard.error;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const institution = await getInstitutionProfile(id);
  if (!institution) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ success: true, data: { institution, coordinators: await listCoordinators(id) } });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await guardAdminUsersRoute('admin.institutions.update');
  if ('error' in guard) return guard.error;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const parsed = InstitutionPlatformPatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  try {
    const institution = await updateInstitutionProfile(guard.admin.actor.id, id, { ...parsed.data, primaryContactEmail: parsed.data.primaryContactEmail === '' ? null : parsed.data.primaryContactEmail }, 'PLATFORM');
    if (!institution) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, data: { institution } });
  } catch (error) {
    if (error instanceof DuplicateInstitutionError) return NextResponse.json({ error: 'DUPLICATE_INSTITUTION' }, { status: 409 });
    throw error;
  }
}
