import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { revokeRole, LastAdminProtectionError } from '@/services/user-admin.service';
import type { Role } from '@/lib/identity';

const VALID_ROLES: Role[] = ['STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION_ADMIN', 'STUDYUS_ADMIN'];

/**
 * Revoking STUDYUS_ADMIN or INSTITUTION_ADMIN through this route is
 * intentionally NOT forbidden the way granting them is -- an admin
 * must be able to revoke a privileged role for incident response, only
 * granting is a one-way door this surface refuses to open. The
 * last-admin check inside `revokeRole` is what actually protects
 * STUDYUS_ADMIN specifically.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ userId: string; role: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.roles.revoke');
  if ('error' in guard) return guard.error;

  const { userId, role } = await params;
  if (!(VALID_ROLES as string[]).includes(role)) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }

  try {
    await revokeRole(guard.admin.actor.id, userId, role as Role);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof LastAdminProtectionError) {
      return NextResponse.json({ error: 'LAST_ADMIN_PROTECTED' }, { status: 409 });
    }
    throw error;
  }
}
