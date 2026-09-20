/**
 * F9 -- POST /api/simulation/attempts
 *
 * Starts a simulation attempt (builds the frozen plan, calls F7's real
 * startExamAttempt). LEARNER_INTERVENTION_CREATE (owner-only) + F3
 * LEARNING_FULL_ACCESS entitlement, mirroring F8's own precedent for
 * AI-content-generation-adjacent, resource-consuming actions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAuth, checkRateLimit } from '@/lib/auth';
import { logPilotEvent } from '@/lib/observability/pilot-events';
import { getOrCreateCanonicalUser } from '@/lib/identity';
import { canAccessLearner } from '@/lib/authorization';
import { canUseCapability } from '@/lib/entitlements';
import { getSimulationEligibility } from '@/lib/simulation/eligibility.service';
import { startSimulationAttempt } from '@/lib/simulation/attempt.service';
import { TimingConfigurationError } from '@/lib/simulation/plan.service';

const StartSchema = z.object({
  studentId: z.string().uuid(),
  examProfileId: z.string().uuid(),
  examVersionId: z.string().uuid(),
  simulationType: z.enum(['TOPIC_EXAM', 'DOMAIN_EXAM', 'MINI_MOCK', 'FULL_MOCK']),
  timingMode: z.enum(['UNTIMED', 'TRAINING_TIMED', 'OFFICIAL_SIMULATION_TIMED']),
  learningObjectiveId: z.string().uuid().optional(),
  academicSubjectId: z.string().uuid().optional(),
  readinessSnapshotId: z.string().uuid().optional(),
  institutionExamPolicyId: z.string().uuid().optional(),
  language: z.string().min(2).max(10),
  timezone: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const authContext = await verifyAuth();
  if (!authContext) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  // F15 -- a resource-consuming, DB-write + downstream-AI-generation
  // action; bounds a scripted loop while leaving generous headroom for
  // real exam-prep usage.
  if (!checkRateLimit(authContext.userId, '/api/simulation/attempts:start', 20, 60)) {
    logPilotEvent('rate_limited', { route: '/api/simulation/attempts', actorUserId: authContext.userId });
    return NextResponse.json({ error: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const actor = await getOrCreateCanonicalUser(authContext.userId, authContext.email || null);

  let validated;
  try {
    validated = StartSchema.parse(await request.json());
  } catch (error: any) {
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.errors?.[0]?.message }, { status: 400 });
  }

  const allowed = await canAccessLearner(actor.id, validated.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const entitled = await canUseCapability(actor.id, validated.studentId, 'LEARNING_FULL_ACCESS');
  if (!entitled) return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED' }, { status: 403 });

  const eligibility = await getSimulationEligibility(validated);
  if (!eligibility.eligible) {
    return NextResponse.json({ error: 'SIMULATION_NOT_ELIGIBLE', data: { eligibility } }, { status: 409 });
  }

  try {
    const { examAttempt, simulationAttempt, planId } = await startSimulationAttempt(validated);
    logPilotEvent('exam_started', { studentId: validated.studentId, route: '/api/simulation/attempts', simulationType: validated.simulationType });
    return NextResponse.json({ success: true, data: { examAttempt, simulationAttempt, planId } });
  } catch (err) {
    if (err instanceof TimingConfigurationError) {
      return NextResponse.json({ error: 'TIMING_NOT_CONFIGURED', message: err.message }, { status: 409 });
    }
    throw err;
  }
}
