/**
 * F2 -- POST /api/admin/institutions
 *
 * The only path to create an Institution.
 * Track A: gated by `guardAdminUsersRoute` (canonical STUDYUS_ADMIN role AND
 * the allowlist, plus rate limit) -- the allowlist alone is no longer
 * enough -- and audited (INSTITUTION_CREATED).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { createInstitution } from '@/services/institution.service';

const Schema = z.object({ name: z.string().trim().min(1).max(200) });

export async function POST(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.institutions.create');
  if ('error' in guard) return guard.error;

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const institution = await createInstitution(validated.name);
  await recordAdminAction({
    actorUserId: guard.admin.actor.id,
    action: 'INSTITUTION_CREATED',
    targetType: 'INSTITUTION',
    targetId: institution.id,
    newState: { name: institution.name, status: institution.status },
  }).catch(() => {});
  return NextResponse.json({ success: true, data: { institution } }, { status: 201 });
}
