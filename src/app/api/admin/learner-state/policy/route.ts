/**
 * F5 -- GET /api/admin/learner-state/policy?dimension=SKILL|COMPETENCY|TRANSFER_ANALYTICS
 *
 * Minimal inspection surface (task 38): the currently ACTIVE aggregation
 * policy version for a dimension.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { getActivePolicy } from '@/lib/learner-state/policy.service';

const VALID_DIMENSIONS = ['SKILL', 'COMPETENCY', 'TRANSFER_ANALYTICS'] as const;

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const dimension = new URL(request.url).searchParams.get('dimension');
  if (!dimension || !(VALID_DIMENSIONS as readonly string[]).includes(dimension)) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: 'dimension must be one of SKILL, COMPETENCY, TRANSFER_ANALYTICS' }, { status: 400 });
  }

  const policy = await getActivePolicy(dimension as (typeof VALID_DIMENSIONS)[number]);
  return NextResponse.json({ success: true, data: { policy } });
}
