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
import { startSimulationAttempt, findOpenSimulationAttemptForProfile, DeliveryPolicyConfigurationError, SimulationModeNotAllowedError } from '@/lib/simulation/attempt.service';
import { TimingConfigurationError } from '@/lib/simulation/plan.service';
import { isExamProfileOwnedByStudent, isExamVersionStartableForProfile } from '@/lib/assessment/student-exam-profile.service';
import { withAiRequestMetrics } from '@/lib/ai/request-metrics';

const StartSchema = z.strictObject({
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

async function handlePOST(request: NextRequest) {
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
    return NextResponse.json({ error: 'INVALID_INPUT', message: error.issues?.[0]?.message ?? error.errors?.[0]?.message }, { status: 400 });
  }

  const allowed = await canAccessLearner(actor.id, validated.studentId, 'LEARNER_INTERVENTION_CREATE');
  if (!allowed) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const entitled = await canUseCapability(actor.id, validated.studentId, 'LEARNING_FULL_ACCESS');
  if (!entitled) return NextResponse.json({ error: 'ENTITLEMENT_REQUIRED' }, { status: 403 });

  // UX-2 security fix (same as /api/readiness): the exam profile must
  // belong to the authorized learner -- otherwise completing the attempt
  // would write a readiness snapshot against another learner's profile.
  // 404 so a guessed id never confirms another learner's profile exists.
  if (!(await isExamProfileOwnedByStudent(validated.examProfileId, validated.studentId))) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  if (!(await isExamVersionStartableForProfile(validated.examProfileId, validated.examVersionId))) {
    return NextResponse.json({ error: 'EXAM_VERSION_NOT_STARTABLE' }, { status: 409 });
  }

  // Track B: never silently create a second attempt (double click, refresh, retry):
  // an open attempt for this exam profile is returned for the Student to resume.
  const open = await findOpenSimulationAttemptForProfile(validated.examProfileId);
  if (open) return NextResponse.json({ error: 'ATTEMPT_IN_PROGRESS', data: { simulationAttemptId: open.id } }, { status: 409 });

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
    if (err instanceof SimulationModeNotAllowedError) {
      return NextResponse.json({ error: 'SIMULATION_MODE_NOT_ALLOWED', reason: err.reason }, { status: 409 });
    }
    if (err instanceof DeliveryPolicyConfigurationError) {
      return NextResponse.json({ error: 'DELIVERY_POLICY_INVALID' }, { status: 409 });
    }
    throw err;
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/simulation/attempts', handlePOST);
