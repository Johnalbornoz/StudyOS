import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { guardAdminUsersRoute } from '@/lib/admin/route-guard';
import { grantAdminLicense, MissingExpirationError, InvalidMembershipTransitionError } from '@/services/membership-admin.service';

const Schema = z.object({
  studentId: z.string().uuid(),
  reason: z.string().min(1).max(500),
  expiresAt: z.string().datetime(),
  source: z.enum(['INSTITUTIONAL_LICENSE', 'ADMIN_PROMOTION', 'TRIAL']).optional(),
});

/** `expiresAt` is required by the Zod schema itself -- there is no way to omit it and reach the service. */
export async function POST(request: NextRequest) {
  const guard = await guardAdminUsersRoute('admin.memberships.grant');
  if ('error' in guard) return guard.error;

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  try {
    const result = await grantAdminLicense(guard.admin.actor.id, validated);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof MissingExpirationError) return NextResponse.json({ error: 'MISSING_EXPIRATION' }, { status: 400 });
    if (error instanceof InvalidMembershipTransitionError) return NextResponse.json({ error: 'INVALID_TRANSITION', from: error.from, to: error.to }, { status: 409 });
    throw error;
  }
}
