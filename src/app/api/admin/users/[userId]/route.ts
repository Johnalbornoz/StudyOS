import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { getUserDetail, getClerkIdForCanonicalUser, deleteUserPermanently, SelfDeletionForbiddenError, LastAdminProtectionError, ConfirmationMismatchError, DeletionBlockedError } from '@/services/user-admin.service';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.detail');
  if ('error' in guard) return guard.error;

  const { userId } = await params;
  const detail = await getUserDetail(userId);
  if (!detail) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  return NextResponse.json({ success: true, data: detail });
}

const DeleteSchema = z.object({ confirmationEmail: z.string().email(), reason: z.string().min(1).max(500) });

/** Permanent deletion. Only reachable when the server recomputes canHardDelete=true -- a client-side "impact looked clean" claim is never trusted. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.delete');
  if ('error' in guard) return guard.error;

  const { userId } = await params;
  let validated;
  try {
    validated = DeleteSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const targetClerkId = await getClerkIdForCanonicalUser(userId);
  if (!targetClerkId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  try {
    await deleteUserPermanently(guard.admin.actor.id, userId, targetClerkId, validated.confirmationEmail, validated.reason);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SelfDeletionForbiddenError) return NextResponse.json({ error: 'SELF_DELETION_FORBIDDEN' }, { status: 403 });
    if (error instanceof LastAdminProtectionError) return NextResponse.json({ error: 'LAST_ADMIN_PROTECTED' }, { status: 409 });
    if (error instanceof ConfirmationMismatchError) return NextResponse.json({ error: 'CONFIRMATION_MISMATCH' }, { status: 400 });
    if (error instanceof DeletionBlockedError) return NextResponse.json({ error: 'DELETION_BLOCKED', dependencies: error.blockingDependencies }, { status: 409 });
    throw error;
  }
}
