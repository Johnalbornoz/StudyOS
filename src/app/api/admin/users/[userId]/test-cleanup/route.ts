import { NextRequest, NextResponse } from 'next/server';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { getClerkIdForCanonicalUser, cleanupTestIdentity, NotTestEnvironmentError, TestIdentityHasRealDependenciesError } from '@/services/user-admin.service';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.test-identity.cleanup');
  if ('error' in guard) return guard.error;

  const { userId } = await params;
  const targetClerkId = await getClerkIdForCanonicalUser(userId);
  if (!targetClerkId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  try {
    await cleanupTestIdentity(guard.admin.actor.id, userId, targetClerkId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof NotTestEnvironmentError) {
      return NextResponse.json({ error: 'NOT_PREVIEW_ENVIRONMENT' }, { status: 403 });
    }
    if (error instanceof TestIdentityHasRealDependenciesError) {
      return NextResponse.json({ error: 'HAS_DEPENDENCIES', dependencies: error.dependencies }, { status: 409 });
    }
    throw error;
  }
}
