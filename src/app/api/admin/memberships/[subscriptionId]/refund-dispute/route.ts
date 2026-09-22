import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { recordRefundOrDispute, getStudentIdForSubscription, InvalidMembershipTransitionError } from '@/services/membership-admin.service';

const Schema = z.object({ type: z.enum(['REFUND', 'DISPUTE']), notes: z.string().min(1).max(1000) });

/** Records/reconciles only -- never calls a real payment provider (none is configured in this environment). The caller's own UI must show "Acción requerida en el proveedor de pagos" alongside this. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ subscriptionId: string }> }) {
  const guard = await guardAdminUsersRoute('admin.memberships.refund-dispute');
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
    await recordRefundOrDispute(guard.admin.actor.id, studentId, validated.type, validated.notes);
    return NextResponse.json({ success: true, data: { providerActionRequired: true } });
  } catch (error) {
    if (error instanceof InvalidMembershipTransitionError) return NextResponse.json({ error: 'INVALID_TRANSITION', from: error.from, to: error.to }, { status: 409 });
    throw error;
  }
}
