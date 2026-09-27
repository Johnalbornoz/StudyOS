/**
 * LEARNING_ACTIVITY_DELIVERY -- assemble one activity for one learner from
 * the VALIDATED bank (no AI): load the contract's pool, apply the learner's
 * novelty exclusions (prior-Practice items for a Prove; everything already
 * seen for a Retain), skip reserved candidates, then the pure, diversity-
 * aware selection (assembly.ts).
 */
import type { DbExecutor } from '@/lib/db';
import { db } from '@/lib/db';
import { assembleFromBank, isIndependentActivity, type AssemblyResult } from '@/lib/activity-delivery/assembly';
import type { AcademicContext, ActivityContract } from '@/lib/activity-delivery/contract';
import { loadBankPool } from '@/services/question-bank.service';
import { loadPriorCanonicalQuestionFingerprintsForRetain, loadPriorPracticeQuestionFingerprints } from '@/services/quiz-persistence.service';

export async function assembleActivityForLearner(
  params: { studentId: string; contract: ActivityContract; academic: AcademicContext; reservedCandidateIds: ReadonlySet<string> },
  client: DbExecutor = db,
): Promise<AssemblyResult & { poolSize: number }> {
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
  const result = assembleFromBank(pool, {
    activityType: contract.activityType,
    itemCount: contract.itemCount,
    difficulty: contract.difficulty,
    language: contract.language,
    excludeFingerprints: exclude,
    reservedCandidateIds: params.reservedCandidateIds,
  });
  return { ...result, poolSize: pool.length };
}
