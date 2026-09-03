import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { generateExplainPrompt, type ExplainActivityType } from '@/services/explain-defend.service';
import { getTeachingIntentForConcept } from '@/services/adaptive-teaching.service';
import { toTeachingGenerationContext } from '@/lib/adaptive-teaching-generation';
import { track } from '@/lib/analytics';
import { z } from 'zod';

const Schema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  conceptId: z.string().uuid(),
  conceptLabel: z.string().min(1),
  activityType: z.enum(['EXPLAIN', 'JUSTIFY', 'ERROR_ANALYSIS', 'PREDICT', 'COMPARE', 'TEACH_BACK']).default('EXPLAIN'),
  language: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const validated = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    // Phase 5-R S2/S7: `conceptId` here is whatever the caller (a
    // remediation EXPLAIN step, or a freestanding Explain & Defend
    // activity) passed -- when it IS a remediation step, that concept
    // id already comes from `remediationStepHref`/`remediationLaunch`
    // (Phase 3D), which is itself always `path.rootCauseConceptId`, the
    // Phase-4-selected prerequisite/root cause. This lookup never
    // substitutes a different concept -- it only asks Phase 4 whether
    // it has an active decision for exactly this one.
    const intent = await getTeachingIntentForConcept(validated.studentId, validated.conceptId).catch(() => null);
    const generationContext = intent ? toTeachingGenerationContext(intent) : undefined;

    const result = await generateExplainPrompt(
      validated.studentId,
      validated.subjectId,
      validated.conceptId,
      validated.conceptLabel,
      validated.activityType as ExplainActivityType,
      validated.language || 'en',
      generationContext
    );
    track(validated.studentId, 'explain_defend_started', { conceptId: validated.conceptId, activityType: validated.activityType });
    // Phase 2B: minted exactly once per generated activity, never at
    // submit time (which would make every transport retry of the same
    // submission look like a new logical action). The client rounds
    // this back on /explain/submit unchanged -- the stable identity
    // that call's evidence idempotency key is built from.
    return NextResponse.json({ success: true, data: { ...result, activityId: crypto.randomUUID() } });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    console.error('Explain generate error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
