import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { approveManualPayment, DuplicateReferenceError, InvalidMembershipTransitionError } from '@/services/membership-admin.service';

const Schema = z.object({
  studentId: z.string().uuid(),
  plan: z.enum(['MONTHLY', 'ANNUAL']),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
  occurredAt: z.string().datetime(),
  reference: z.string().min(1).max(200),
  method: z.string().min(1).max(80),
  evidenceReference: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
  validUntil: z.string().datetime(),
  payerUserId: z.string().uuid().nullable().optional(),
});

/** Manual approval only -- never for provider-processed payments (the provider's own webhook is always the source of truth for those). */
export async function POST(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.memberships.approve-payment');
  if ('error' in guard) return guard.error;

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    const result = await approveManualPayment(guard.admin.actor.id, validated);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof DuplicateReferenceError) return NextResponse.json({ error: 'DUPLICATE_REFERENCE' }, { status: 409 });
    if (error instanceof InvalidMembershipTransitionError) return NextResponse.json({ error: 'INVALID_TRANSITION', from: error.from, to: error.to }, { status: 409 });
    throw error;
  }
}
