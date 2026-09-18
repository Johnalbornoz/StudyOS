/**
 * F5 -- GET /api/admin/learner-state/transfer?studentId=&conceptId=
 *
 * Minimal inspection surface (task 38) for Transfer analytics
 * (context-diversity counters only -- never Canonical V2's own Transfer
 * progression, see F5_CANONICAL_V2_BOUNDARY.md).
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { getTransferAnalytics } from '@/lib/learner-state/transfer-analytics.service';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const conceptId = searchParams.get('conceptId');
  if (!studentId || !conceptId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const analytics = await getTransferAnalytics(studentId, conceptId);
  return NextResponse.json({ success: true, data: { analytics } });
}
