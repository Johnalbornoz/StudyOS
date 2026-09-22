import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { addRole, getClerkIdForCanonicalUser, PrivilegedRoleForbiddenError } from '@/services/user-admin.service';

/** `role` is structurally limited to the three self-service roles -- INSTITUTION_ADMIN and STUDYUS_ADMIN cannot even parse, mirroring assignSelfServiceRole's own compile-time exclusion (src/lib/identity/types.ts). */
const Schema = z.object({ role: z.enum(['STUDENT', 'PARENT', 'TEACHER']) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.roles.add');
  if ('error' in guard) return guard.error;

  const { userId } = await params;
  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const targetClerkId = await getClerkIdForCanonicalUser(userId);
  if (!targetClerkId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  try {
    await addRole(guard.admin.actor.id, userId, validated.role, targetClerkId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PrivilegedRoleForbiddenError) {
      return NextResponse.json({ error: 'PRIVILEGED_ROLE_FORBIDDEN' }, { status: 403 });
    }
    throw error;
  }
}
