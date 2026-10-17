/**
 * LEARNING_ACTIVITY_DELIVERY -- assemble one activity for one learner from
 * the VALIDATED bank (no AI): load the contract's pool, apply the learner's
 * novelty exclusions (prior-Practice items for a Prove; everything already
 * seen for a Retain), skip reserved candidates, then the pure, diversity-
 * aware selection (assembly.ts).
 *
 * PRACTICE (requirement §22): the latest LEARN weaknesses of the concept
 * (learn-weakness.service, the ONE accessor) prioritise matching candidates.
 * This covers a launch-time bank assembly AND a background READY preparation
 * (activity-delivery-worker.service), which both assemble here.
 */
import type { DbExecutor } from '@/lib/db';
import { db } from '@/lib/db';
import { assembleFromBank, countAssemblableSets, isIndependentActivity, type AssemblyRequest, type AssemblyResult, type BankCandidate } from '@/lib/activity-delivery/assembly';
import type { AcademicContext, ActivityContract } from '@/lib/activity-delivery/contract';
import { loadBankPool } from '@/services/question-bank.service';
import { loadPriorCanonicalQuestionFingerprintsForRetain, loadPriorPracticeQuestionFingerprints } from '@/services/quiz-persistence.service';
import { getLearnWeaknessesForConcept } from '@/services/learn-weakness.service';
import { learnFocusPriorityCap, matchLearnFocusItems, type LearnWeaknessFocus } from '@/lib/learn-guided/weakness-focus';

type AssemblyParams = {
  studentId: string;
  contract: ActivityContract;
  academic: AcademicContext;
  reservedCandidateIds: ReadonlySet<string>;
  /** PRACTICE: the LEARN focus already read by the caller; `undefined` = read it here; `null` = none. */
  learnFocus?: LearnWeaknessFocus | null;
};

/** What the LEARN focus did to one PRACTICE assembly (null when it does not apply / there is none). */
export interface AssemblyLearnFocus {
  focus: LearnWeaknessFocus;
  /** Assembled candidates that address the focus. */
  matchedCandidateIds: string[];
}

/** The contract's pool plus the learner's novelty exclusions -- the ONE input to every assembly decision. */
async function loadAssemblyInputs(params: AssemblyParams, client: DbExecutor): Promise<{ pool: BankCandidate[]; request: AssemblyRequest }> {
  const { studentId, contract } = params;
  const [pool, exclude] = await Promise.all([
    loadBankPool(
      { studentId, conceptId: contract.conceptId, activityType: contract.activityType, language: contract.language, academic: params.academic, excludeDelivered: isIndependentActivity(contract.activityType) },
      client,
    ),
    contract.activityType === 'PROVE'
      ? loadPriorPracticeQuestionFingerprints(studentId, contract.conceptId)
      : contract.activityType === 'RETAIN'
        ? loadPriorCanonicalQuestionFingerprintsForRetain(studentId, contract.conceptId)
        : Promise.resolve(new Set<string>()),
  ]);
  return {
    pool,
    request: {
      activityType: contract.activityType,
      itemCount: contract.itemCount,
      difficulty: contract.difficulty,
      language: contract.language,
      excludeFingerprints: exclude,
      reservedCandidateIds: params.reservedCandidateIds,
    },
  };
}

export async function assembleActivityForLearner(
  params: AssemblyParams,
  client: DbExecutor = db,
): Promise<AssemblyResult & { poolSize: number; learnFocus: AssemblyLearnFocus | null }> {
  const practice = params.contract.activityType === 'PRACTICE';
  const [{ pool, request }, focus] = await Promise.all([
    loadAssemblyInputs(params, client),
    !practice ? Promise.resolve(null) : params.learnFocus !== undefined ? Promise.resolve(params.learnFocus) : getLearnWeaknessesForConcept(params.studentId, params.contract.conceptId, { client }),
  ]);
  if (!focus) return { ...assembleFromBank(pool, request), poolSize: pool.length, learnFocus: null };
  const priority = new Set(matchLearnFocusItems(pool, focus));
  const result = assembleFromBank(pool, { ...request, priorityCandidateIds: priority, priorityCap: learnFocusPriorityCap(request.itemCount) });
  const matchedCandidateIds = result.status === 'ASSEMBLED' ? result.candidateIds.filter((id) => priority.has(id)) : [];
  return { ...result, poolSize: pool.length, learnFocus: { focus, matchedCandidateIds } };
}

/** Complete sets the bank can still assemble for this learner beyond `reservedCandidateIds` (the READY inventory), up to `maxSets`. */
export async function countSpareSets(params: AssemblyParams & { maxSets: number }, client: DbExecutor = db): Promise<number> {
  const { pool, request } = await loadAssemblyInputs(params, client);
  return countAssemblableSets(pool, request, params.maxSets);
}
