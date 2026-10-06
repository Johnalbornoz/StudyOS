import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, verifyStudentAccess } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canUseCapability } from '@/lib/entitlements';
import { generateExplainPrompt, type ExplainActivityType } from '@/services/explain-defend.service';
import { getTeachingIntentForConcept } from '@/services/adaptive-teaching.service';
import { toTeachingGenerationContext } from '@/lib/adaptive-teaching-generation';
import { track } from '@/lib/analytics';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { query } from '@/lib/db';
import { getPrompt } from '@/lib/ai';
import { createExplainTask } from '@/services/explain-defend-task.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { instructionalAssistanceLockedResponse } from '@/lib/ai/instructional-assistance-guard';

const Schema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  conceptId: z.string().uuid(),
  // Presentation hint only -- never used for grading (the server resolves the label).
  conceptLabel: z.string().optional(),
  activityType: z.enum(['EXPLAIN', 'JUSTIFY', 'ERROR_ANALYSIS', 'PREDICT', 'COMPARE', 'TEACH_BACK']).default('EXPLAIN'),
  language: z.string().optional(),
});

async function handlePOST(request: NextRequest) {
  try {
    const authContext = await verifyAuth();
    if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    const validated = Schema.parse(await request.json());
    const canAccess = await verifyStudentAccess(authContext.userId, validated.studentId, authContext.role);
    if (!canAccess) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

    // Human Agency P0-1: student-wide, server-authoritative, fail-closed.
    const assistanceLocked = await instructionalAssistanceLockedResponse(validated.studentId);
    if (assistanceLocked) return assistanceLocked;

    const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);
    const entitled = await canUseCapability(actor.id, validated.studentId, 'LEARNING_FULL_ACCESS');
    if (!entitled) return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED' }, { status: 403 });

    // Phase 5-R S2/S7: `conceptId` here is whatever the caller (a
    // remediation EXPLAIN step, or a freestanding Explain & Defend
    // activity) passed -- when it IS a remediation step, that concept
    // id already comes from `remediationStepHref`/`remediationLaunch`
    // (Phase 3D), which is itself always `path.rootCauseConceptId`, the
    // Phase-4-selected prerequisite/root cause. This lookup never
    // substitutes a different concept -- it only asks Phase 4 whether
    // it has an active decision for exactly this one.
    // Human Agency P0-3: the concept must be this Student's, in this subject;
    // its label (which the grader sees) comes from the server, not the client.
    const language = validated.language || 'en';
    const owned = await query(
      `SELECT COALESCE(cl.label, (SELECT anyl.label FROM concept_localizations anyl WHERE anyl.concept_id = c.id ORDER BY anyl.language LIMIT 1), c.canonical_id) AS label
         FROM concepts c JOIN subjects s ON s.id = c.subject_id
         LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $4
        WHERE c.id = $1 AND c.subject_id = $2 AND s.student_id = $3`,
      [validated.conceptId, validated.subjectId, validated.studentId, language],
    );
    if (owned.rowCount === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    const conceptLabel: string = owned.rows[0].label || validated.conceptLabel || 'this concept';

    const intent = await getTeachingIntentForConcept(validated.studentId, validated.conceptId).catch(() => null);
    const generationContext = intent ? toTeachingGenerationContext(intent) : undefined;

    const result = await generateExplainPrompt(
      validated.studentId,
      validated.subjectId,
      validated.conceptId,
      conceptLabel,
      validated.activityType as ExplainActivityType,
      language,
      generationContext
    );
    track(validated.studentId, 'explain_defend_started', { conceptId: validated.conceptId, activityType: validated.activityType });
    // Phase 2B: minted exactly once per generated activity, never at
    // submit time (which would make every transport retry of the same
    // submission look like a new logical action). The client rounds
    // this back on /explain/submit unchanged -- the stable identity
    // that call's evidence idempotency key is built from.
    // Human Agency P0-3: the rubric (expectedElements) is persisted server-side
    // under this activityId and NEVER sent to the browser. Submit grades only
    // against the persisted row.
    const activityId = randomUUID();
    const generator = getPrompt('explain.prompt_generation');
    await createExplainTask({
      id: activityId,
      studentId: validated.studentId,
      subjectId: validated.subjectId,
      conceptId: validated.conceptId,
      conceptLabel,
      activityType: result.activityType,
      language,
      prompt: result.prompt,
      expectedElements: result.expectedElements,
      generatorPromptId: generator.id,
      generatorPromptVersion: generator.version,
    });
    return NextResponse.json({ success: true, data: { activityType: result.activityType, prompt: result.prompt, activityId } });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues[0]?.message }, { status: 400 });
    }
    console.error('Explain generate error:', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/cognitive/explain/generate', handlePOST);
