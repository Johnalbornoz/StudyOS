/**
 * F9 -- GET /api/simulation/eligibility
 *
 * Structural eligibility only (task §16's "CAN the platform offer
 * this"). LEARNER_PROGRESS_VIEW -- read-only, no side effects.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canReadLearnerRoute } from '@/lib/authorization/teacher-subject-scope';
import { getSimulationEligibility } from '@/lib/simulation/eligibility.service';

const QuerySchema = z.object({
  studentId: z.string().uuid(),
  examVersionId: z.string().uuid(),
  simulationType: z.enum(['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK']),
  learningObjectiveId: z.string().uuid().optional(),
  academicSubjectId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let validated;
  try {
    validated = QuerySchema.parse({
      studentId: searchParams.get('studentId'),
      examVersionId: searchParams.get('examVersionId'),
      simulationType: searchParams.get('simulationType'),
      learningObjectiveId: searchParams.get('learningObjectiveId') || undefined,
      academicSubjectId: searchParams.get('academicSubjectId') || undefined,
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  // L10-R2: exam-wide eligibility -- it cannot be sliced by subject, so a reader who is only this learner's Teacher is refused.
  const allowed = await canReadLearnerRoute(actor.id, validated.studentId, 'LEARNER_PROGRESS_VIEW', 'DENY');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const eligibility = await getSimulationEligibility(validated);
  return NextResponse.json({ success: true, data: { eligibility } });
}
