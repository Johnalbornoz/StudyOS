/**
 * Phase 8 -- Step 8E1: explicit daily maintenance -- reconcile
 * completion, expire passed items, roll the horizon, minimal-diff
 * rebuild. Invoked ONLY by an explicit POST (`/api/learning/plan/maintain`)
 * or by the post-commit orchestration trigger -- NEVER from a GET / read
 * (8A0 invariant). Idempotent: running it twice for the same clock +
 * state is a semantic no-op.
 */
import { db, type DbExecutor } from '@/lib/db';
import { getLearningPlanHorizon } from '@/services/learning-plan-read.service';
import { applyPlanItemStatusChanges, type PlanItemStatusChange } from '@/services/learning-plan-projector.service';
import { rebuildLearningPlan, type RebuildLearningPlanResult } from '@/services/learning-orchestration.service';
import { derivePlanItemStatus, type CanonicalEvidenceRow } from '@/lib/learning-plan-completion';
import { computeOrchestrationHorizon } from '@/lib/learning-orchestration-policy';

export interface MaintainLearningPlanResult {
  maintained: boolean;
  reason?: 'NO_ACTIVE_PLAN';
  completed: number;
  expired: number;
  rebuild?: RebuildLearningPlanResult;
}

/** Recent concept-scoped evidence for the student (last N days). */
async function loadRecentEvidence(client: DbExecutor, studentId: string, sinceIsoDate: string): Promise<CanonicalEvidenceRow[]> {
  const res = await client.query(
    `SELECT concept_id, timestamp::date AS d FROM learning_evidence
     WHERE student_id = $1 AND timestamp::date >= $2`,
    [studentId, sinceIsoDate],
  );
  return res.rows.map((r) => ({ conceptId: r.concept_id, date: String(r.d).slice(0, 10) }));
}

export async function maintainLearningPlan(
  studentId: string,
  now: Date = new Date(),
  client: DbExecutor = db,
): Promise<MaintainLearningPlanResult> {
  const horizon = await getLearningPlanHorizon(studentId, client);
  if (!horizon) return { maintained: false, reason: 'NO_ACTIVE_PLAN', completed: 0, expired: 0 };

  const hz = computeOrchestrationHorizon(now, horizon.plan.timezone);
  const todayIso = hz.ok ? hz.horizonStart! : now.toISOString().slice(0, 10);
  // Look back far enough to catch evidence for the oldest live item.
  const oldest = horizon.items.reduce((m, i) => (i.scheduledDate < m ? i.scheduledDate : m), todayIso);
  const evidence = await loadRecentEvidence(client, studentId, oldest);

  const changes: PlanItemStatusChange[] = [];
  for (const item of horizon.items) {
    const derived = derivePlanItemStatus(
      { conceptId: item.conceptId, scheduledDate: item.scheduledDate, status: item.status },
      evidence,
      todayIso,
    );
    if (derived === 'COMPLETED') changes.push({ itemId: item.id, status: 'COMPLETED' });
    else if (derived === 'EXPIRED') changes.push({ itemId: item.id, status: 'EXPIRED' });
  }

  const completed = changes.filter((c) => c.status === 'COMPLETED').length;
  const expired = changes.filter((c) => c.status === 'EXPIRED').length;
  await applyPlanItemStatusChanges(studentId, changes, client === db ? undefined : client);

  // Roll the horizon + minimal-diff rebuild (same ACTIVE plan id at the
  // same policy version). A missed item is now EXPIRED and the rebuild
  // may reschedule / merge / drop it -- never a cognitive penalty.
  const rebuild = await rebuildLearningPlan(studentId, { now }, client);

  return { maintained: true, completed, expired, rebuild };
}
