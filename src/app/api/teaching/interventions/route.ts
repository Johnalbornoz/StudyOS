/**
 * F8 -- POST /api/teaching/interventions
 *
 * Selects (or accepts a caller-chosen) intervention for an existing
 * diagnosis, resolves + freezes framework context, creates the
 * intervention_sessions row, and attempts AI teaching-content
 * generation. A generation failure never blocks session creation --
 * the learner can retry generation -- but is never silently served as
 * content (task §23/24): `data.content` is present only when
 * generation succeeded, otherwise `data.generationBlocked` names why.
 *
 * LEARNER_INTERVENTION_CREATE (owner-only) + F3 LEARNING_FULL_ACCESS
 * entitlement (AI content generation is the one resource-consuming
 * action in this flow, mirroring session-eligibility's own pattern --
 * task §35, authorization and entitlement kept separate).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth } from '@/lib/auth';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { canUseCapability } from '@/lib/entitlements';
import { getDiagnosisById } from '@/lib/diagnostics/diagnosis.service';
import { getActiveInterventionPolicy } from '@/lib/teaching/intervention-policy.service';
import { selectIntervention } from '@/lib/teaching/intervention-selection.service';
import { resolveFrameworkForObjective, resolveFrameworkForStudentExamProfile } from '@/lib/teaching/framework-context.service';
import { startInterventionSession } from '@/lib/teaching/session.service';
import { resolveTeachingContentGenerationContext, generateTeachingContent } from '@/lib/teaching/ai-teaching-contract.service';
import { DEFAULT_ASSISTANCE_LEVEL_BY_INTERVENTION, type InterventionType } from '@/lib/teaching/types';

const CreateSchema = z.object({
  studentId: z.string().uuid(),
  diagnosisId: z.string().uuid(),
  interventionType: z.enum(['EXPLAIN', 'WORKED_EXAMPLE', 'GUIDED_PRACTICE', 'CONTEXTUAL_HELP', 'INDEPENDENT_PRACTICE', 'PROVE']).optional(),
});

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  let validated;
  try {
    validated = CreateSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const allowed = await canAccessLearner(actor.id, validated.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const diagnosis = await getDiagnosisById(validated.diagnosisId);
  if (!diagnosis || diagnosis.studentId !== validated.studentId) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  const policy = await getActiveInterventionPolicy();
  const recommendation = selectIntervention(diagnosis, policy.rules);

  const chosenType: InterventionType = validated.interventionType ?? recommendation.primary;
  const isExplicitProveRequest = chosenType === 'PROVE';
  if (!isExplicitProveRequest && !recommendation.chain.includes(chosenType)) {
    return NextResponse.json({ error: 'INVALID_INTERVENTION_TYPE', message: `${chosenType} is not in the recommended chain for this diagnosis` }, { status: 400 });
  }

  const framework = diagnosis.scope.learningObjectiveId
    ? await resolveFrameworkForObjective(diagnosis.scope.learningObjectiveId)
    : await resolveFrameworkForStudentExamProfile(validated.studentId);

  const session = await startInterventionSession({
    studentId: validated.studentId,
    diagnosisId: diagnosis.id,
    interventionPolicyVersionId: policy.id,
    interventionType: chosenType,
    gapType: diagnosis.primaryGapType,
    reasonCodes: recommendation.rationale,
    frameworkContext: framework,
  });

  if (isExplicitProveRequest) {
    return NextResponse.json({ success: true, data: { session, recommendation, content: null, generationBlocked: null } });
  }

  const entitled = await canUseCapability(actor.id, validated.studentId, 'LEARNING_FULL_ACCESS');
  if (!entitled) {
    return NextResponse.json({ success: true, data: { session, recommendation, content: null, generationBlocked: 'ENTITLEMENT_REQUIRED' } });
  }

  const context = await resolveTeachingContentGenerationContext({
    studentId: validated.studentId,
    conceptId: diagnosis.conceptId,
    diagnosisId: diagnosis.id,
    interventionType: chosenType,
    assistanceLevel: DEFAULT_ASSISTANCE_LEVEL_BY_INTERVENTION[chosenType],
  });
  const generation = await generateTeachingContent(context);

  return NextResponse.json({
    success: true,
    data: {
      session,
      recommendation,
      content: generation.blocked ? null : generation.payload,
      generationBlocked: generation.blocked ? (generation.reason ?? 'UNKNOWN') : null,
    },
  });
}
