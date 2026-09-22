import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { inviteUser, PrivilegedRoleForbiddenError } from '@/services/user-admin.service';

/** Only the three self-service roles, or none -- INSTITUTION_ADMIN/STUDYUS_ADMIN are not valid enum members here, so a request for either fails Zod validation before reaching any service logic (structural, not just runtime, enforcement). */
const Schema = z.object({
  email: z.string().email(),
  intendedRole: z.enum(['STUDENT', 'PARENT', 'TEACHER']).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.users.invite');
  if ('error' in guard) return guard.error;

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    const result = await inviteUser(guard.admin.actor.id, validated.email, validated.intendedRole ?? null);
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof PrivilegedRoleForbiddenError) {
      return NextResponse.json({ error: 'PRIVILEGED_ROLE_FORBIDDEN' }, { status: 403 });
    }
    // Clerk's own duplicate-invitation/existing-account error -- returned
    // as a generic conflict, never distinguishing "already invited" from
    // "already has an account" (enumeration safety).
    return NextResponse.json({ error: 'INVITE_CONFLICT' }, { status: 409 });
  }
}
