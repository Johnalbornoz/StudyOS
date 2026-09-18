/**
 * F5 -- GET /api/admin/learner-state/competency?studentId=&competencyId=
 *
 * Minimal inspection surface (task 38), same contract as the skill route.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { getCompetencyState, explainCompetencyState } from '@/lib/learner-state/competency-state.service';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const competencyId = searchParams.get('competencyId');
  if (!studentId || !competencyId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const [state, explanation] = await Promise.all([getCompetencyState(studentId, competencyId), explainCompetencyState(studentId, competencyId)]);
  return NextResponse.json({ success: true, data: { state, explanation } });
}
