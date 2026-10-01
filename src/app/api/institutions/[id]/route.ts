/**
 * Track A -- /api/institutions/[id] (a coordinator of THIS institution)
 * GET: the institution profile.
 * PATCH: edit the descriptive fields (display name, country, region,
 *   curriculum, primary contact, timezone, locale). Name and status are
 *   Platform Admin decisions and are ignored here. Another institution's
 *   coordinator, a Teacher, a Parent or a Student gets 403.
 */
import { NextRequest, NextResponse } from 'next/server';
import { allUuids, readJson, requireInstitutionAdminActor } from '@/lib/institution/route-guard';
import { getInstitutionProfile, updateInstitutionProfile } from '@/services/institution-admin.service';
import { InstitutionDescriptiveSchema } from '@/lib/institution/profile-schema';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  return NextResponse.json({ success: true, data: { institution: await getInstitutionProfile(id) } });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allUuids(id)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  const guard = await requireInstitutionAdminActor(id, 'TEACHER_ASSIGNMENT_MANAGE');
  if ('response' in guard) return guard.response;
  const parsed = InstitutionDescriptiveSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });
  const institution = await updateInstitutionProfile(
    guard.actor.id,
    id,
    { ...parsed.data, primaryContactEmail: parsed.data.primaryContactEmail === '' ? null : parsed.data.primaryContactEmail },
    'COORDINATOR'
  );
  return NextResponse.json({ success: true, data: { institution } });
}
