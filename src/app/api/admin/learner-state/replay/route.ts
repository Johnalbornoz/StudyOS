/**
 * F5 -- POST /api/admin/learner-state/replay
 *
 * Deterministic recomputation (task 25, AC-F5-13): recomputes a Skill/
 * Competency/Transfer-analytics state from scratch and returns both the
 * previous and freshly-recomputed value, so a caller can verify
 * replay produces the same result. Never touches Canonical V2 or any
 * evidence row -- read of evidence, write only to the F5 state tables.
 */
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAdminEmail } from '@/services/admin.service';
import { getSkillState, projectSkillState } from '@/lib/learner-state/skill-state.service';
import { getCompetencyState, projectCompetencyState } from '@/lib/learner-state/competency-state.service';
import { getTransferAnalytics, projectTransferAnalytics } from '@/lib/learner-state/transfer-analytics.service';

const Schema = z.object({
  dimension: z.enum(['SKILL', 'COMPETENCY', 'TRANSFER_ANALYTICS']),
  studentId: z.string().uuid(),
  targetId: z.string().uuid(), // skillId | competencyId | conceptId, depending on dimension
});

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? null;
  if (!isAdminEmail(email)) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let validated;
  try {
    validated = Schema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const { dimension, studentId, targetId } = validated;

  if (dimension === 'SKILL') {
    const before = await getSkillState(studentId, targetId);
    const after = await projectSkillState(studentId, targetId);
    return NextResponse.json({ success: true, data: { before, after } });
  }
  if (dimension === 'COMPETENCY') {
    const before = await getCompetencyState(studentId, targetId);
    const after = await projectCompetencyState(studentId, targetId);
    return NextResponse.json({ success: true, data: { before, after } });
  }
  const before = await getTransferAnalytics(studentId, targetId);
  const after = await projectTransferAnalytics(studentId, targetId);
  return NextResponse.json({ success: true, data: { before, after } });
}
