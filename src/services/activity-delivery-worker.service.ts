/**
 * LEARNING_ACTIVITY_DELIVERY -- background replenishment (never on a
 * learner's hot path).
 *
 * PREPARE_INVENTORY (learner, concept)
 *   fresh canonical decision -> the next launchable activity -> retire
 *   inventory that no longer matches (stage / contract / learner state)
 *   -> assemble READY activities from the bank up to the policy target
 *   (PRACTICE 2, everything else 1; a Prove READY is a complete 10) ->
 *   keep SPARE_ASSEMBLABLE_SETS complete sets assemblable from the bank
 *   beyond them (queue BANK_REPLENISH chunks for what is missing); if the
 *   bank is short, also a follow-up preparation.
 *
 * BANK_REPLENISH (learner, concept, activity type, language, academic)
 *   the certified generators produce candidates -> VALIDATED bank rows.
 *   Only the missing candidates are requested; partial progress is kept and
 *   the remainder is re-queued (bounded rounds); a round that produced
 *   nothing is retried with backoff (bounded attempts).
 *
 * Triggers: activity submitted, Concept Mission / Today opened, a READY
 * consumed, a cold-miss launch. Each one only ENQUEUES and dispatches; the
 * protected worker endpoint is the one executor (its own invocation).
 */
import { randomUUID } from 'crypto';
import { getCanonicalPedagogicalDecision, resolveCanonicalLaunch, resolveAuthorizedItemCount } from '@/lib/pedagogical-decision';
import {
  academicContextFingerprint,
  activityContractFingerprint,
  bankChunks,
  SPARE_ASSEMBLABLE_SETS,
  DELIVERY_QUIZ_MODES,
  inventoryTarget,
  learnerStateFingerprint,
  STAGE_FOR_ACTIVITY,
  type AcademicContext,
  type ActivityContract,
  type DeliveryActivityType,
} from '@/lib/activity-delivery/contract';
import { QUIZ_MODE_CONFIG } from '@/lib/quiz/quiz-mode-config';
import type { QuizMode } from '@/services/quiz-persistence.service';
import { enqueueGenerationJob, openBankSupply, runGenerationWorker, type GenerationJob, type JobHandler } from '@/services/generation-queue.service';
import { loadAcademicContext, loadLearnerStateSnapshot } from '@/services/activity-delivery-context.service';
import { reconcileInventory, reservedCandidateIds, retireAllInventory, storeReadyActivity } from '@/services/activity-inventory.service';
import { assembleActivityForLearner, countSpareSets } from '@/services/activity-assembly.service';
import { isIndependentActivity } from '@/lib/activity-delivery/assembly';
import { withLaunchLock } from '@/services/activity-launch-lock.service';
import { dispatchDeliveryWorker } from '@/services/worker-dispatch.service';
import { addValidatedCandidates } from '@/services/question-bank.service';
import { generateActivityCandidates } from '@/services/activity-candidate-generation.service';
import { resolveLanguageForSubject, getSubjectIBContext } from '@/services/subject-generation-context.service';

/** Most candidates requested from a generator in one job round. */
const BATCH_CAP: Record<DeliveryActivityType, number> = { LEARN_CHECK: 10, PRACTICE: 9, PROVE: 10, RETAIN: 10, TRANSFER: 3 };
const MAX_BANK_ROUNDS = 5;
const FOLLOW_UP_DELAY_MS = 45_000;

export interface ReplenishTarget {
  studentId: string;
  subjectId: string;
  conceptId: string;
}

/** The activity contract of the learner's canonical next action, built from the fresh decision. */
export async function resolveNextActivityContract(target: ReplenishTarget, languageOverride?: string): Promise<
  | { launchable: false }
  | { launchable: true; activityType: DeliveryActivityType; quizMode: QuizMode; contract: ActivityContract; academic: AcademicContext; canonicalRevision: string }
> {
  const { decision } = await getCanonicalPedagogicalDecision({ studentId: target.studentId, conceptId: target.conceptId });
  const launch = resolveCanonicalLaunch({ subjectId: target.subjectId, conceptId: target.conceptId, decision });
  const mode = launch.launchParams?.mode as QuizMode | undefined;
  const activityType = mode ? DELIVERY_QUIZ_MODES[mode] : undefined;
  const c = decision.activityContract;
  if (launch.launchStatus !== 'READY' || !mode || !activityType || !c) return { launchable: false };
  const [language, academic] = await Promise.all([
    languageOverride ?? resolveLanguageForSubject(target.subjectId, target.studentId),
    loadAcademicContext(target.studentId, target.subjectId),
  ]);
  const contract: ActivityContract = {
    conceptId: target.conceptId,
    activityType,
    language,
    academic,
    difficulty: { min: c.difficulty.min, max: c.difficulty.max, target: c.difficulty.target },
    itemCount: resolveAuthorizedItemCount(c.itemCount) ?? QUIZ_MODE_CONFIG[mode].defaultMax,
    independence: c.independence,
    policyVersion: decision.policyVersion,
  };
  return { launchable: true, activityType, quizMode: mode, contract, academic, canonicalRevision: decision.canonicalRevision };
}

const bankKey = (contract: ActivityContract) =>
  `bank:${contract.conceptId}:${contract.activityType}:${contract.language}:${academicContextFingerprint(contract.academic)}`;

export const prepareInventoryHandler: JobHandler = async (job: GenerationJob) => {
  const p = job.payload as unknown as ReplenishTarget & { language?: string };
  const next = await resolveNextActivityContract(p, p.language);
  if (!next.launchable) {
    const retired = await retireAllInventory(p.studentId, p.conceptId, 'NO_LAUNCHABLE_ACTIVITY');
    return { ok: true, result: { prepared: 0, retired, reason: 'NO_LAUNCHABLE_ACTIVITY' } };
  }
  const { contract, activityType, academic } = next;
  const stage = STAGE_FOR_ACTIVITY[activityType];
  const identity = { studentId: p.studentId, conceptId: p.conceptId, stage, policyVersion: contract.policyVersion };
  const contractFingerprint = activityContractFingerprint(contract);
  const learnerFp = learnerStateFingerprint(await loadLearnerStateSnapshot(p.studentId, p.conceptId));
  const independent = isIndependentActivity(activityType);
  const { readyCompatible, usedSlots } = await reconcileInventory(identity, { contractFingerprint, learnerStateFingerprint: learnerFp, independent });

  // Assemble + store under the SAME lock a launch holds: the bank is never
  // read while a launch is delivering from it, so a READY activity can never
  // hold a candidate that a concurrent launch just delivered.
  const target = inventoryTarget(activityType);
  const { prepared, bankShort } = await withLaunchLock({ studentId: p.studentId, conceptId: p.conceptId, quizMode: next.quizMode }, async () => {
    let stored = 0;
    for (let slot = 0; slot < target && readyCompatible + stored < target; slot++) {
      if (usedSlots.includes(slot)) continue;
      const assembly = await assembleActivityForLearner({ studentId: p.studentId, contract, academic, reservedCandidateIds: await reservedCandidateIds(p.studentId, p.conceptId) });
      if (assembly.status !== 'ASSEMBLED') return { prepared: stored, bankShort: true };
      if (
        await storeReadyActivity({
          identity, canonicalRevision: next.canonicalRevision, contract, contractFingerprint, learnerStateFingerprint: learnerFp,
          slot, questions: assembly.questions, candidateIds: assembly.candidateIds,
        })
      ) stored++;
    }
    return { prepared: stored, bankShort: false };
  });

  // keep the bank deep enough for the next launches, never waiting for a miss.
  // Depth = complete sets the bank can still assemble beyond the READY
  // inventory (real assembly: novelty + diversity); what is missing, after
  // the generation already in flight, is requested as parallel chunks of at
  // most one generator batch each.
  const key = bankKey(contract);
  const [spareSets, inFlight] = await Promise.all([
    countSpareSets({ studentId: p.studentId, contract, academic, reservedCandidateIds: await reservedCandidateIds(p.studentId, p.conceptId), maxSets: SPARE_ASSEMBLABLE_SETS }),
    openBankSupply(key),
  ]);
  const missing = (SPARE_ASSEMBLABLE_SETS - spareSets) * contract.itemCount - inFlight;
  const needed = bankShort ? Math.max(missing, contract.itemCount - inFlight) : missing;
  const chunks = bankChunks(needed, BATCH_CAP[activityType]);
  for (let i = 0; i < chunks.length; i++) {
    await enqueueGenerationJob('BANK_REPLENISH', `${key}:c${i}`, {
      ...p, activityType, language: contract.language, academic, difficulty: contract.difficulty.target, needed: chunks[i], round: 1,
    });
  }
  if (bankShort) {
    await enqueueGenerationJob('PREPARE_INVENTORY', `prepare:${p.studentId}:${p.conceptId}:followup`, { ...p }, { delayMs: FOLLOW_UP_DELAY_MS });
  }
  return { ok: true, result: { activityType, prepared, readyCompatible, bankShort, spareSets, inFlight, bankJobs: chunks.length } };
};

export const bankReplenishHandler: JobHandler = async (job: GenerationJob) => {
  const p = job.payload as unknown as ReplenishTarget & {
    activityType: DeliveryActivityType; language: string; academic: AcademicContext; difficulty: number; needed: number; round: number;
  };
  const count = Math.min(p.needed, BATCH_CAP[p.activityType]);
  const generated = await generateActivityCandidates({
    activityType: p.activityType, conceptId: p.conceptId, studentId: p.studentId, subjectId: p.subjectId, count,
    difficulty: p.difficulty, language: p.language, ibContext: await getSubjectIBContext(p.subjectId), parentOperationId: randomUUID(),
  });
  const banked = await addValidatedCandidates(generated.questions, {
    studentId: p.studentId, conceptId: p.conceptId, activityType: p.activityType, language: p.language, academic: p.academic, generator: generated.generator,
  });
  if (banked.inserted === 0) return { ok: false, error: `no new validated candidates (${generated.questions.length} generated)` };
  const remaining = p.needed - banked.inserted;
  if (remaining > 0 && p.round < MAX_BANK_ROUNDS) {
    // partial progress is kept; only the missing candidates are requested next
    await enqueueGenerationJob('BANK_REPLENISH', `${job.dedupKey}:r${p.round + 1}`, { ...p, needed: remaining, round: p.round + 1 });
  }
  await enqueueGenerationJob('PREPARE_INVENTORY', `prepare:${p.studentId}:${p.conceptId}`, { studentId: p.studentId, subjectId: p.subjectId, conceptId: p.conceptId });
  return { ok: true, result: { inserted: banked.inserted, generated: generated.questions.length, remaining: Math.max(0, remaining) } };
};

export const DELIVERY_JOB_HANDLERS = { PREPARE_INVENTORY: prepareInventoryHandler, BANK_REPLENISH: bankReplenishHandler };

export function runDeliveryWorker(opts?: { maxJobs?: number; concurrency?: number; deadlineMs?: number; onlyStudentId?: string }) {
  return runGenerationWorker(DELIVERY_JOB_HANDLERS, opts);
}

/**
 * THE replenishment trigger: queue a (deduplicated) inventory preparation
 * for this learner + concept and dispatch the worker, which drains the queue
 * in its OWN invocation (worker-dispatch.service.ts). This never runs the AI
 * pipeline itself -- callers invoke it from `after()`, never on the hot path.
 * `dispatch: false` only queues (scripts, and callers outside a request).
 */
export async function scheduleDeliveryReplenishment(target: ReplenishTarget, opts: { dispatch?: boolean; language?: string } = {}): Promise<void> {
  await enqueueGenerationJob('PREPARE_INVENTORY', `prepare:${target.studentId}:${target.conceptId}`, { ...target, ...(opts.language ? { language: opts.language } : {}) });
  if (opts.dispatch !== false) await dispatchDeliveryWorker('replenishment');
}
