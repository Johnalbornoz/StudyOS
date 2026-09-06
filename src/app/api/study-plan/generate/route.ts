/**
 * `/api/study-plan/generate` -- Phase 8 Step 8G1 COMPATIBILITY SHIM.
 *
 * The canonical plan authority is `learning_plan` / `learning_plan_item`
 * (written only by the 8B projector). This endpoint no longer generates
 * or stores a legacy `study_plans` row -- it is kept only so any
 * lingering external caller keeps working:
 *
 *   POST -> runs the canonical `rebuildLearningPlan`, then returns the
 *           resulting ACTIVE plan in the old response shape.
 *   GET  -> returns the ACTIVE canonical plan in the old response shape
 *           (no rebuild -- a read never mutates a plan).
 *
 * `daysAhead` / `dailyMinutes` / `startDate` in the POST body are
 * accepted for backward compatibility and ignored: the canonical plan
 * is a rolling 14-day horizon in the learner's timezone, and capacity
 * is set via `/api/learning/capacity`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getInterfaceLanguage } from '@/lib/i18n/language';
import { rebuildLearningPlan } from '@/services/learning-orchestration.service';
import { getLegacyShapedCanonicalPlan } from '@/services/legacy-study-plan-compat';
import { logOperationalWarning } from '@/lib/observability/operational-log';
import { z } from 'zod';

const GenerateStudyPlanSchema = z.object({
  studentId: z.string().uuid('Invalid studentId'),
  daysAhead: z.number().int().min(1).max(90).optional(),
  dailyMinutes: z.number().int().min(30).max(240).optional(),
  startDate: z.string().datetime().optional(),
});

export async function GET(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const studentId = new URL(request.url).searchParams.get('studentId');
  if (!studentId) return NextResponse.json({ error: 'INVALID_INPUT', message: 'Missing studentId' }, { status: 400 });

  const canAccess = await verifyStudentAccess(authContext.userId, studentId, authContext.role);
  if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const preferredLanguage = await getInterfaceLanguage(studentId);
  const shaped = await getLegacyShapedCanonicalPlan(studentId, preferredLanguage);
  return NextResponse.json({ success: true, data: shaped });
}

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 });

    let validated: z.infer<typeof GenerateStudyPlanSchema>;
    try {
      validated = GenerateStudyPlanSchema.parse(await request.json());
    } catch (error: any) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message || 'Invalid request body' }, { status: 400 });
    }

    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) {
      return NextResponse.json({ error: 'FORBIDDEN', message: 'You do not have permission to generate a plan for this student' }, { status: 403 });
    }

    const preferredLanguage = await getInterfaceLanguage(validated.studentId);
    await rebuildLearningPlan(validated.studentId, { preferredLanguage });
    const shaped = await getLegacyShapedCanonicalPlan(validated.studentId, preferredLanguage);

    return NextResponse.json({ success: true, data: shaped });
  } catch (error) {
    logOperationalWarning({
      subsystem: 'phase8-orchestrator',
      operation: 'studyPlanGenerateCompat',
      error,
      context: { route: 'POST /api/study-plan/generate' },
    });
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to generate study plan' }, { status: 500 });
  }
}
