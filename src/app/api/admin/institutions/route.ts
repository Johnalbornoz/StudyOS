/**
 * F2 / Track A -- /api/admin/institutions (Platform Admin only)
 *
 * GET: every institution (any status) with coordinator counts.
 * POST: create an institution with its profile (name, display name,
 *   country, region, curriculum, status, primary contact, timezone,
 *   locale). The only path to create an Institution. Duplicate name /
 *   slug → 409. Audited (INSTITUTION_CREATED).
 *
 * Gated by `guardAdminUsersRoute` (canonical STUDYUS_ADMIN role AND the
 * allowlist, plus rate limit): Institution Admins, Teachers, Parents and
 * Students get 403 -- hiding the button is not the control.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { createInstitutionProfile, listInstitutionsForPlatformAdmin, DuplicateInstitutionError } from '@/services/institution-admin.service';
import { InstitutionCreateSchema } from '@/lib/institution/profile-schema';
import { readJson } from '@/lib/institution/route-guard';

export async function GET() {
  const guard = await guardAdminUsersRoute('admin.institutions.list');
  if ('error' in guard) return guard.error;
  return NextResponse.json({ success: true, data: { institutions: await listInstitutionsForPlatformAdmin() } });
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.institutions.create');
  if ('error' in guard) return guard.error;

  const parsed = InstitutionCreateSchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message }, { status: 400 });

  try {
    const institution = await createInstitutionProfile(guard.admin.actor.id, {
      ...parsed.data,
      primaryContactEmail: parsed.data.primaryContactEmail || null,
    });
    return NextResponse.json({ success: true, data: { institution } }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateInstitutionError) return NextResponse.json({ error: 'DUPLICATE_INSTITUTION' }, { status: 409 });
    throw error;
  }
}
