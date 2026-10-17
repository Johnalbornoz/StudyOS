/**
 * LEARNING_ACTIVITY_DELIVERY -- assemble one activity for one learner from
 * the VALIDATED bank (no AI): load the contract's pool, apply the learner's
 * novelty exclusions (exact prior-Practice and prior-Prove items for a Prove, D75; everything already
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
import { assembleFromBank, countAssemblableSets, countValidCandidates, isIndependentActivity, type AssemblyRequest, type AssemblyResult, type BankCandidate } from '@/lib/activity-delivery/assembly';
import type { AcademicContext, ActivityContract } from '@/lib/activity-delivery/contract';
import { loadBankPool } from '@/services/question-bank.service';
import { loadPriorCanonicalQuestionFingerprintsForRetain } from '@/services/quiz-persistence.service';
import { loadProveExactNoveltyExclusions } from '@/services/prove-exact-novelty.service';
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
      ? // D75: exact prior Practice AND exact prior Prove items
        loadProveExactNoveltyExclusions(studentId, contract.conceptId).then((x) => x.fingerprints)
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
      ...(contract.practiceMix ? { practiceMix: contract.practiceMix } : {}),
      ...(contract.proveMix ? { proveMix: contract.proveMix } : {}),
    },
  };
}

export async function assembleActivityForLearner(
  params: AssemblyParams,
  client: DbExecutor = db,
): Promise<AssemblyResult & { poolSize: number; learnFocus: AssemblyLearnFocus | null; validDepth: number }> {
  const practice = params.contract.activityType === 'PRACTICE';
  const [{ pool, request }, focus] = await Promise.all([
    loadAssemblyInputs(params, client),
    !practice ? Promise.resolve(null) : params.learnFocus !== undefined ? Promise.resolve(params.learnFocus) : getLearnWeaknessesForConcept(params.studentId, params.contract.conceptId, { client }),
  ]);
  // D76: distinct valid candidates in this pool (the depth BANK_DEPTH_TARGET is measured in)
  const validDepth = countValidCandidates(pool, request);
  if (!focus) return { ...assembleFromBank(pool, request), poolSize: pool.length, learnFocus: null, validDepth };
  const priority = new Set(matchLearnFocusItems(pool, focus));
  const result = assembleFromBank(pool, { ...request, priorityCandidateIds: priority, priorityCap: learnFocusPriorityCap(request.itemCount) });
  const matchedCandidateIds = result.status === 'ASSEMBLED' ? result.candidateIds.filter((id) => priority.has(id)) : [];
  return { ...result, poolSize: pool.length, learnFocus: { focus, matchedCandidateIds }, validDepth };
}

/** Complete sets the bank can still assemble for this learner beyond `reservedCandidateIds` (the READY inventory), up to `maxSets`. */
export async function countSpareSets(params: AssemblyParams & { maxSets: number }, client: DbExecutor = db): Promise<number> {
  const { pool, request } = await loadAssemblyInputs(params, client);
  return countAssemblableSets(pool, request, params.maxSets);
}

/** D76 -- distinct VALID candidates the bank holds for this learner + contract (the depth BANK_DEPTH_TARGET is measured in). */
export async function countValidBankDepth(params: Omit<AssemblyParams, 'reservedCandidateIds' | 'learnFocus'>, client: DbExecutor = db): Promise<number> {
  const { pool, request } = await loadAssemblyInputs({ ...params, reservedCandidateIds: new Set() }, client);
  return countValidCandidates(pool, request);
}

/** D78 -- distinct VALID candidates at exactly `level` (the base+1 exposure supply of a strong learner's Practice bank). */
export async function countValidBankDepthAtLevel(params: Omit<AssemblyParams, 'reservedCandidateIds' | 'learnFocus'>, level: number, client: DbExecutor = db): Promise<number> {
  const { pool, request } = await loadAssemblyInputs({ ...params, reservedCandidateIds: new Set() }, client);
  return countValidCandidates(
    pool.filter((c) => c.difficulty === level),
    { difficulty: request.difficulty, excludeFingerprints: request.excludeFingerprints },
  );
}
