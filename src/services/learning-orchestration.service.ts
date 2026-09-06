/**
 * Phase 8 -- Step 8D1: the deterministic 14-day planner + the EXPLICIT
 * plan-rebuild service.
 *
 * `rebuildLearningPlan` is the first place a Phase 8 plan can be
 * deliberately created / updated -- via an explicit write call (8D1.13
 * `POST /api/learning/plan/rebuild`). It is NEVER invoked from a GET /
 * read / RSC render (8A0 invariant). Flow:
 *   1. collect ONE 8C snapshot (getLearningOrchestrationInputs)
 *   2. batched concept -> subject resolution (one extra read)
 *   3. pure candidate construction (buildOrchestrationCandidates)
 *   4. pure capacity allocation over the horizon (allocateCandidatesToHorizon)
 *   5. project through the 8B SOLE writer (projectLearningPlan)
 *   6. return a read model + diff summary + unsatisfied-constraint report
 *
 * It ranks nothing (Phase 4 `priorityScore` is carried), re-derives no
 * canonical state, calls no AI, and does not run inside any cognitive
 * transaction.
 */
import { db, type DbExecutor } from '@/lib/db';
import { getLearningOrchestrationInputs, type OrchestrationInputsContext } from '@/services/learning-orchestration-inputs.service';
import { buildOrchestrationCandidates } from '@/lib/orchestration-candidate-builder';
import {
  allocateCandidatesToHorizon,
  addDaysToIsoDate,
  daysBetweenIsoDates,
  ORCHESTRATION_POLICY_VERSION,
  ORCHESTRATION_MAX_ITEMS_PER_DAY,
  type DailyCapacityInput,
  type DeferReason,
} from '@/lib/learning-orchestration-policy';
import { projectLearningPlan, type ProposedLearningPlanItem, type ProjectLearningPlanResult } from '@/services/learning-plan-projector.service';
import { getLearningPlanHorizon } from '@/services/learning-plan-read.service';

export interface RebuildLearningPlanOptions extends OrchestrationInputsContext {
  now?: Date;
}

export interface DeferredSummary {
  conceptId: string | null;
  subjectId: string;
  reasonCode: string;
  deferReason: DeferReason;
}

export interface RebuildLearningPlanResult {
  planResult: ProjectLearningPlanResult;
  placedCount: number;
  deferred: DeferredSummary[];
  unsatisfiedDeadlines: DeferredSummary[];
  capacityPressure: boolean;
  horizonStart: string;
  horizonEnd: string;
  timezone: string;
  timezoneAssumed: boolean;
  capacityAssumed: boolean;
}

/** conceptId -> subjectId for every concept in the student's active subjects (one batched read). */
async function loadConceptSubjectMap(studentId: string, client: DbExecutor): Promise<Map<string, string>> {
  const res = await client.query(
    `SELECT c.id, c.subject_id
     FROM concepts c
     JOIN subjects s ON s.id = c.subject_id AND s.student_id = $1 AND s.status = 'active'`,
    [studentId],
  );
  const map = new Map<string, string>();
  for (const r of res.rows) map.set(r.id, r.subject_id);
  return map;
}

export async function rebuildLearningPlan(
  studentId: string,
  options: RebuildLearningPlanOptions = {},
  client: DbExecutor = db,
): Promise<RebuildLearningPlanResult> {
  const now = options.now ?? new Date();

  // 1. ONE 8C snapshot (same clock anchor threaded through).
  const inputs = await getLearningOrchestrationInputs(studentId, { ...options, now }, client);

  // 2. concept -> subject resolution for engine-owned candidates.
  const conceptSubjectById = await loadConceptSubjectMap(studentId, client);

  // 3. pure candidate construction.
  const retentionByConcept = new Map<string, { nextReviewAt: string | null; retentionDue: boolean }>();
  for (const [cid, sig] of inputs.memorySignals) retentionByConcept.set(cid, { nextReviewAt: sig.nextReviewAt, retentionDue: sig.retentionDue });
  const transferByConcept = new Map<string, { transferDepth: string; transferFragile: boolean; lastSuccessfulTransferAt: string | null }>();
  for (const [cid, sig] of inputs.transferSignals) transferByConcept.set(cid, { transferDepth: sig.transferDepth, transferFragile: sig.transferFragile, lastSuccessfulTransferAt: sig.lastSuccessfulTransferAt });

  const candidates = buildOrchestrationCandidates({
    studentId,
    horizonStart: inputs.horizonStart,
    horizonEnd: inputs.horizonEnd,
    decisions: inputs.decisions,
    retentionByConcept,
    transferByConcept,
    assessments: inputs.assessments,
    activeRemediations: inputs.activeRemediations,
    curriculumEligible: inputs.curriculumEligible,
    conceptSubjectById,
  });

  // 4. per-day capacity over the horizon. Unavailable days -> 0 capacity.
  //    NO hidden weekend rule -- a day is available unless explicitly
  //    marked unavailable (8F1 populates unavailableDates; empty here).
  const unavailable = new Set(inputs.unavailableDates);
  const spanDays = daysBetweenIsoDates(inputs.horizonStart, inputs.horizonEnd);
  const dailyCapacity: DailyCapacityInput[] = [];
  for (let i = 0; i <= spanDays; i++) {
    const date = addDaysToIsoDate(inputs.horizonStart, i);
    const available = !unavailable.has(date);
    dailyCapacity.push({
      date,
      availableMinutes: available ? inputs.capacity.maxDailyMinutes : 0,
      maxItems: available ? ORCHESTRATION_MAX_ITEMS_PER_DAY : 0,
      available,
    });
  }

  // 5. pure allocation.
  const { placed, deferred } = allocateCandidatesToHorizon({
    candidates,
    dailyCapacity,
    horizonStart: inputs.horizonStart,
    horizonEnd: inputs.horizonEnd,
    now,
    timezone: inputs.timezone,
  });

  // 6. project through the SOLE writer.
  const proposedItems: ProposedLearningPlanItem[] = placed.map((p) => ({
    subjectId: p.candidate.subjectId,
    conceptId: p.candidate.conceptId ?? null,
    scheduledDate: p.scheduledDate,
    timeWindow: null,
    intendedActivityType: p.candidate.intendedActivityType,
    reasonCode: p.candidate.reasonCode,
    source: p.candidate.source,
    priorityAtPlanTime: p.candidate.phase4PriorityScore ?? 0,
    estimatedMinutes: p.estimatedMinutes,
    operationKey: p.operationKey,
    provenance: p.candidate.provenance ?? {},
  }));

  // 6b. Carry forward LIVE learner-authored items -- an explicit
  //     reschedule (source MANUAL_RESCHEDULE) or a self-requested extra
  //     practice (reasonCode LEARNER_REQUESTED). The engine never
  //     re-derives these, so without this they would be SUPERSEDED on
  //     the very next rebuild (which fires on every accepted evidence),
  //     silently undoing the learner's choice. They are kept only while
  //     still inside the rolling horizon; a learner item that falls off
  //     the back of the horizon expires naturally like any other.
  //     They never displace an engine obligation (same-key items keep
  //     the engine's copy) and are not run through the allocator.
  if (inputs.activePlan) {
    const horizon = await getLearningPlanHorizon(studentId, client);
    const proposedKeys = new Set(proposedItems.map((p) => p.operationKey));
    for (const it of horizon?.items ?? []) {
      const learnerAuthored = it.source === 'MANUAL_RESCHEDULE' || it.reasonCode === 'LEARNER_REQUESTED';
      if (!learnerAuthored) continue;
      if (it.scheduledDate < inputs.horizonStart || it.scheduledDate > inputs.horizonEnd) continue;
      if (proposedKeys.has(it.operationKey)) continue;
      proposedItems.push({
        subjectId: it.subjectId,
        conceptId: it.conceptId,
        scheduledDate: it.scheduledDate,
        timeWindow: it.timeWindow,
        intendedActivityType: it.intendedActivityType,
        reasonCode: it.reasonCode,
        source: it.source,
        priorityAtPlanTime: it.priorityAtPlanTime,
        estimatedMinutes: it.estimatedMinutes,
        operationKey: it.operationKey,
        provenance: it.provenance,
      });
      proposedKeys.add(it.operationKey);
    }
  }

  const planResult = await projectLearningPlan({
    studentId,
    orchestrationPolicyVersion: ORCHESTRATION_POLICY_VERSION,
    horizonStart: inputs.horizonStart,
    horizonEnd: inputs.horizonEnd,
    planningAnchorAt: now.toISOString(),
    timezone: inputs.timezone,
    timezoneAssumed: inputs.timezoneAssumed,
    goalContext: {
      assessmentIds: inputs.assessments.map((a) => a.id),
      capacityAssumed: inputs.capacity.capacityAssumed,
      timezoneSource: inputs.timezoneSource,
    },
    proposedItems,
    client: client === db ? undefined : client,
  });

  const deferredSummaries: DeferredSummary[] = deferred.map((d) => ({
    conceptId: d.candidate.conceptId ?? null,
    subjectId: d.candidate.subjectId,
    reasonCode: d.candidate.reasonCode,
    deferReason: d.reason,
  }));

  return {
    planResult,
    placedCount: placed.length,
    deferred: deferredSummaries,
    unsatisfiedDeadlines: deferredSummaries.filter((d) => d.deferReason === 'HARD_DEADLINE_UNSATISFIABLE' || d.deferReason === 'FIXED_SLOT_CONFLICT'),
    capacityPressure: deferredSummaries.some((d) => d.deferReason === 'INSUFFICIENT_CAPACITY'),
    horizonStart: inputs.horizonStart,
    horizonEnd: inputs.horizonEnd,
    timezone: inputs.timezone,
    timezoneAssumed: inputs.timezoneAssumed,
    capacityAssumed: inputs.capacity.capacityAssumed,
  };
}
