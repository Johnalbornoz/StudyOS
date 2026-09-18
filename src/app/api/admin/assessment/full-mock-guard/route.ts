/**
 * F7 -- GET /api/admin/assessment/full-mock-guard?examVersionId=
 *
 * CAN_FULL_MOCK_BE_OFFERED? Read-only readiness check (task 34).
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { canFullMockBeOffered } from '@/lib/assessment/full-mock-guard.service';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const examVersionId = new URL(request.url).searchParams.get('examVersionId');
  if (!examVersionId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const readiness = await canFullMockBeOffered(examVersionId);
  return NextResponse.json({ success: true, data: { readiness } });
}
