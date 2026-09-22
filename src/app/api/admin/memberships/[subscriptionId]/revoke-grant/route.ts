import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { revokeLicenseGrant, getStudentIdForSubscription, InvalidMembershipTransitionError } from '@/services/membership-admin.service';

const Schema = z.object({ reason: z.string().min(1).max(500) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ subscriptionId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.memberships.revoke-grant');
  if ('error' in guard) return guard.error;

  const { subscriptionId } = await params;
  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const studentId = await getStudentIdForSubscription(subscriptionId);
  if (!studentId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  try {
    await revokeLicenseGrant(guard.admin.actor.id, studentId, validated.reason);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof InvalidMembershipTransitionError) return NextResponse.json({ error: 'INVALID_TRANSITION', from: error.from, to: error.to }, { status: 409 });
    throw error;
  }
}
