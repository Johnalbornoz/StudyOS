/**
 * F5 -- GET /api/admin/learner-state/skill?studentId=&skillId=
 *
 * Minimal inspection surface (task 38): current Skill State plus its
 * explanation (which evidence was included/excluded and why). Gated by
 * the same isAdminEmail allowlist as every other /api/admin/* route.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminEmail } from '@/services/admin.service';
import { getSkillState, explainSkillState } from '@/lib/learner-state/skill-state.service';

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const studentId = searchParams.get('studentId');
  const skillId = searchParams.get('skillId');
  if (!studentId || !skillId) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const [state, explanation] = await Promise.all([getSkillState(studentId, skillId), explainSkillState(studentId, skillId)]);
  return NextResponse.json({ success: true, data: { state, explanation } });
}
