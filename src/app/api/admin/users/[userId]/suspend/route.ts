import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { suspendUser, getClerkIdForCanonicalUser, LastAdminProtectionError } from '@/services/user-admin.service';

const Schema = z.object({ reason: z.string().min(1).max(500) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.users.suspend');
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
    await suspendUser(guard.admin.actor.id, userId, targetClerkId, validated.reason);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof LastAdminProtectionError) {
      return NextResponse.json({ error: 'LAST_ADMIN_PROTECTED' }, { status: 409 });
    }
    throw error;
  }
}
