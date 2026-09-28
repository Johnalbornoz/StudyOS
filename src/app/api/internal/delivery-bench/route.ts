/**
 * POST /api/internal/delivery-bench -- DEVELOPMENT ONLY. Runs the canonical
 * launch path of POST /api/quizzes/generate-and-take server-side, for the
 * SYNTHETIC benchmark learner, so LEARNING_ACTIVITY_DELIVERY latency is
 * measured inside the hosted runtime (authorize -> decision -> inventory /
 * bank -> assembly -> session), not from a laptop.
 *
 * Fail-closed on three independent gates:
 *   - 404 outside Development (never Production, never Preview/Stage);
 *   - 401 without `Authorization: Bearer <CRON_SECRET>`;
 *   - it only ever touches the learner whose clerk_id is BENCH_CLERK_ID
 *     (every concept / session id is checked against that learner).
 * Clerk session verification is not part of the delivery backend and is not
 * reproduced; authorization runs the route's same DB reads (read-only: the
 * canonical user is looked up, never created).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { verifyStudentAccess } from '@/lib/auth';
import { canUseCapability } from '@/lib/entitlements';
import { getCanonicalUserByClerkId } from '@/lib/identity/canonical-user.service';
import { isCanonicalEngineV1Enabled, verifyV1PracticeLaunchMarker, getCanonicalPedagogicalDecision } from '@/lib/pedagogical-decision';
import { currentAiCallCount, runWithAiMetrics, withAiRequestMetrics } from '@/lib/ai/request-metrics';
import { aiVolumeLimits } from '@/lib/ai/operational-limits';
import { buildDeploymentVersion, isDevelopmentDeployment } from '@/lib/deployment-version';
import { hasInternalBearer } from '@/lib/internal/internal-auth';
import { DELIVERY_QUIZ_MODES, QUIZ_MODE_FOR_ACTIVITY, type DeliveryActivityType } from '@/lib/activity-delivery/contract';
import { QUIZ_MODE_CONFIG } from '@/lib/quiz/quiz-mode-config';
import { buildDeliveryInput, deliverCanonicalActivity } from '@/services/activity-delivery.service';
import { scheduleDeliveryReplenishment } from '@/services/activity-delivery-worker.service';
import type { QuizMode, QuizSessionV1Marker } from '@/services/quiz-persistence.service';

const BENCH_CLERK_ID = 'bench:activity-delivery';

const ACTIVITY = z.enum(['LEARN_CHECK', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER']);
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }),
  z.object({
    action: z.literal('launch'),
    conceptId: z.string().uuid(),
    activityType: ACTIVITY,
    language: z.string().min(2).max(10),
    /** HOT scenario only: TRANSFER is not reachable from real evidence yet, so its contract is synthetic. */
    syntheticTransferContract: z.boolean().optional(),
  }),
  z.object({ action: z.literal('abandon'), quizId: z.string().min(1).max(100) }),
  z.object({ action: z.literal('replenish'), conceptId: z.string().uuid(), language: z.string().min(2).max(10) }),
]);

const CANONICAL_TYPE: Record<DeliveryActivityType, string> = {
  LEARN_CHECK: 'LEARN_CHECK', PRACTICE: 'PRACTICE', PROVE: 'PROVE', RETAIN: 'RETENTION_CHECK', TRANSFER: 'TRANSFER',
};

const syntheticTransferMarker = (policyVersion: string, canonicalRevision: string): QuizSessionV1Marker => ({
  pedagogicalPolicyVersion: policyVersion as never, canonicalRevision, canonicalStage: 'TRANSFER' as never, canonicalActivityType: 'TRANSFER' as never,
  itemCount: { min: 3, max: 3, authorized: 3 }, difficulty: { min: 4, max: 5, target: 4 }, assistanceAllowed: false, independence: true,
  supportLevel: 'NONE', minimumScorePercent: 80,
});

async function benchConcept(studentId: string, conceptId: string): Promise<{ subjectId: string } | null> {
  const r = await db.query(`SELECT c.subject_id FROM concepts c JOIN subjects s ON s.id = c.subject_id WHERE c.id = $1 AND s.student_id = $2`, [conceptId, studentId]);
  return r.rows[0] ? { subjectId: r.rows[0].subject_id } : null;
}

async function handlePOST(request: NextRequest) {
  if (!isDevelopmentDeployment(process.env)) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!hasInternalBearer(request.headers.get('authorization'))) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const body = parsed.data;

  const learner = await db.query(`SELECT id FROM students WHERE clerk_id = $1`, [BENCH_CLERK_ID]);
  const studentId: string | undefined = learner.rows[0]?.id;
  if (!studentId) return NextResponse.json({ error: 'BENCH_LEARNER_MISSING' }, { status: 404 });

  switch (body.action) {
    case 'status': {
      const [usage, jobs] = await Promise.all([
        db.query(`SELECT day_start, day_calls::int, minute_start, minute_calls::int, now() AS now FROM ai_global_limits`),
        db.query(`SELECT kind, status, count(*)::int AS n FROM generation_jobs WHERE status IN ('PENDING', 'RUNNING') GROUP BY 1, 2`),
      ]);
      const v = buildDeploymentVersion(process.env);
      return NextResponse.json({
        commitSha: v.commitSha, deploymentTarget: v.deploymentTarget, region: process.env.VERCEL_REGION ?? null,
        aiLimits: aiVolumeLimits(), aiUsage: usage.rows[0] ?? null, openJobs: jobs.rows,
      });
    }

    case 'abandon': {
      const r = await db.query(`UPDATE quiz_sessions SET status = 'expired' WHERE id = $1 AND student_id = $2 AND status = 'active' RETURNING id`, [body.quizId, studentId]);
      return NextResponse.json({ abandoned: r.rows.length });
    }

    case 'replenish': {
      const concept = await benchConcept(studentId, body.conceptId);
      if (!concept) return NextResponse.json({ error: 'NOT_A_BENCH_CONCEPT' }, { status: 404 });
      await scheduleDeliveryReplenishment({ studentId, subjectId: concept.subjectId, conceptId: body.conceptId }, { language: body.language });
      return NextResponse.json({ queued: true });
    }

    case 'launch': {
      const concept = await benchConcept(studentId, body.conceptId);
      if (!concept) return NextResponse.json({ error: 'NOT_A_BENCH_CONCEPT' }, { status: 404 });
      const quizMode = QUIZ_MODE_FOR_ACTIVITY[body.activityType] as QuizMode;
      const result = await runWithAiMetrics(`BENCH delivery launch ${body.activityType}`, async () => {
        const t0 = Date.now();
        // authorize: the route's same reads (Clerk session excluded, canonical user read-only)
        const canAccess = await verifyStudentAccess(BENCH_CLERK_ID, studentId, 'student');
        const actor = await getCanonicalUserByClerkId(BENCH_CLERK_ID);
        const entitled = await canUseCapability(actor?.id ?? studentId, studentId, 'LEARNING_FULL_ACCESS');
        const authorizeMs = Date.now() - t0;

        const t1 = Date.now();
        let marker: QuizSessionV1Marker | null = null;
        if (body.activityType === 'TRANSFER' && body.syntheticTransferContract) {
          const { decision } = await getCanonicalPedagogicalDecision({ studentId, conceptId: body.conceptId });
          marker = syntheticTransferMarker(decision.policyVersion, decision.canonicalRevision);
        } else if (isCanonicalEngineV1Enabled()) {
          const m = await verifyV1PracticeLaunchMarker({ studentId, conceptId: body.conceptId });
          marker = m && m.canonicalActivityType === CANONICAL_TYPE[body.activityType] ? m : null;
        }
        const decisionMs = Date.now() - t1;
        if (!marker) return { status: 'NOT_AUTHORIZED_FOR_STAGE' as const, authorizeMs, decisionMs, totalMs: Date.now() - t0 };

        const input = await buildDeliveryInput({
          studentId, subjectId: concept.subjectId, conceptId: body.conceptId, quizMode, activityType: body.activityType, v1Marker: marker,
          language: body.language, itemCount: marker.itemCount?.authorized ?? QUIZ_MODE_CONFIG[quizMode].defaultMax,
        });
        const delivery = await deliverCanonicalActivity(input);
        if (delivery.status !== 'DELIVERED') await delivery.lock.release();
        const ai = currentAiCallCount();
        return {
          status: delivery.status,
          source: delivery.status === 'DELIVERED' ? delivery.source : 'EMERGENCY_REQUIRED',
          quizId: delivery.status === 'DELIVERED' ? delivery.quizId : null,
          items: delivery.status === 'DELIVERED' ? delivery.questions.length : 0,
          bank: delivery.status === 'DELIVERED' ? null : delivery.bank,
          authorization: { canAccess, entitled },
          authorizeMs, decisionMs, timings: delivery.timings, totalMs: Date.now() - t0,
          aiCalls: ai.executions + ai.providerCalls,
        };
      });
      return NextResponse.json({ ...result, quizMode, deliveryMode: DELIVERY_QUIZ_MODES[quizMode], region: process.env.VERCEL_REGION ?? null });
    }
  }
}

// AI request metrics: one [ai-request-summary] per request (src/lib/ai/request-metrics.ts).
export const POST = withAiRequestMetrics('POST /api/internal/delivery-bench', handlePOST);
