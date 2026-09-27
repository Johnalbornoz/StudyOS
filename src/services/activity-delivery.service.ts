/**
 * LEARNING_ACTIVITY_DELIVERY -- the learner's launch hot path.
 *
 *   lock (learner + concept + mode) -> resume an equivalent open session
 *     -> consume a compatible READY prepared activity (atomic)
 *     -> or assemble from the VALIDATED bank
 *     -> create the session -> record deliveries -> return
 *
 * 0 AI calls. When neither inventory nor bank can supply a complete,
 * contract-valid activity, it returns EMERGENCY_REQUIRED -- explicitly, with
 * the launch lock still held -- and the caller runs the certified
 * generators (instrumented as EMERGENCY_GENERATION, never silent), then
 * `completeEmergencyDelivery` banks the result and releases the lock.
 *
 * The lock (a Postgres session advisory lock) serializes concurrent
 * launches of the same activity: a double click or a refresh waits for the
 * first launch and then RESUMES its session -- never a second one.
 * Launching writes no learning evidence.
 */
import { after } from 'next/server';
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { currentAiCallCount } from '@/lib/ai/request-metrics';
import { shuffleArray } from '@/lib/quiz/client-question';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import {
  activityContractFingerprint,
  learnerStateFingerprint,
  STAGE_FOR_ACTIVITY,
  type AcademicContext,
  type ActivityContract,
  type DeliveryActivityType,
} from '@/lib/activity-delivery/contract';
import { storeQuiz, findResumableCanonicalSession, type QuizMode, type QuizSessionV1Marker } from '@/services/quiz-persistence.service';
import { loadLearnerStateSnapshot } from '@/services/activity-delivery-context.service';
import { consumeCompatibleInventory, linkConsumedActivity, reservedCandidateIds } from '@/services/activity-inventory.service';
import { assembleActivityForLearner } from '@/services/activity-assembly.service';
import { addValidatedCandidates, recordBankDeliveries } from '@/services/question-bank.service';
import { computeAskConfidenceFlags } from '@/services/ask-confidence.service';
import { scheduleDeliveryReplenishment } from '@/services/activity-delivery-worker.service';

export const LAUNCH_LOCK_TIMEOUT = '90s';

export type DeliverySource = 'RESUMED' | 'INVENTORY' | 'BANK' | 'EMERGENCY_AI';

export interface LaunchTimings {
  lockMs: number;
  resumeMs: number;
  inventoryMs: number;
  bankMs: number;
  sessionMs: number;
}

export interface LaunchLock {
  release(): Promise<void>;
}

export interface DeliveryInput {
  studentId: string;
  subjectId: string;
  conceptId: string;
  quizMode: QuizMode;
  activityType: DeliveryActivityType;
  contract: ActivityContract;
  academic: AcademicContext;
  v1Marker: QuizSessionV1Marker;
  canonicalRevision: string;
}

export type DeliveryResult =
  | { status: 'DELIVERED'; source: Exclude<DeliverySource, 'EMERGENCY_AI'>; quizId: string; questions: GeneratedQuestion[]; timings: LaunchTimings }
  | { status: 'EMERGENCY_REQUIRED'; lock: LaunchLock; timings: LaunchTimings; bank: { available: number; needed: number } };

/**
 * Transaction-scoped advisory lock on a dedicated connection. A
 * transaction is pinned to ONE server connection even behind a
 * transaction-pooling proxy (Neon's PgBouncer), and the lock is released
 * by COMMIT/ROLLBACK -- a session-level pg_advisory_lock/unlock pair is
 * NOT safe there (the unlock can land on another server connection and
 * orphan the lock: found by the delivery benchmark).
 */
async function acquireLaunchLock(key: string): Promise<LaunchLock> {
  const client = await db.connect();
  let released = false;
  try {
    // one round trip; the key is a 64-bit integer computed here, so the multi-statement text carries no user input
    await client.query(`BEGIN; SET LOCAL lock_timeout = '${LAUNCH_LOCK_TIMEOUT}'; SELECT pg_advisory_xact_lock(${launchLockId(key)});`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    throw error;
  }
  return {
    async release() {
      if (released) return;
      released = true;
      try {
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK').catch(() => {});
      } finally {
        client.release();
      }
    },
  };
}

/** Stable signed 64-bit lock id for a launch key (first 8 bytes of its sha256). */
export function launchLockId(key: string): string {
  return createHash('sha256').update(key).digest().readBigInt64BE(0).toString();
}

function launchLockKey(input: Pick<DeliveryInput, 'studentId' | 'conceptId' | 'quizMode'>): string {
  return `activity-launch:${input.studentId}:${input.conceptId}:${input.quizMode}`;
}

/** Creates the session for a delivered set (same persistence as every session) and records its provenance. */
async function openSession(
  input: DeliveryInput,
  questions: GeneratedQuestion[],
  source: 'INVENTORY' | 'BANK',
  candidateIds: string[],
  askConfidence: boolean,
  consumedPreparedId: string | null,
): Promise<{ quizId: string; questions: GeneratedQuestion[] }> {
  const ordered = shuffleArray(questions.map((q) => ({ ...q, conceptId: q.conceptId ?? input.conceptId })));
  if (ordered.length > 0 && askConfidence) ordered[0] = { ...ordered[0], askConfidence: true };
  const marker: QuizSessionV1Marker =
    input.activityType === 'PROVE'
      ? { ...input.v1Marker, novelty: { priorPracticeFingerprintCount: 0, rejectedExactDuplicateCount: 0, acceptedNovelQuestionCount: ordered.length, noveltyPolicy: 'EXACT_DUPLICATE_EXCLUSION_V1' } }
      : input.v1Marker;
  const quizId = await storeQuiz(input.studentId, input.conceptId, input.subjectId, ordered, input.contract.language, input.quizMode, [input.conceptId], marker);
  await Promise.all([
    db.query(`UPDATE quiz_sessions SET delivery_source = $2 WHERE id = $1`, [quizId, source]),
    recordBankDeliveries(candidateIds, quizId, input.studentId),
    consumedPreparedId ? linkConsumedActivity(consumedPreparedId, quizId) : Promise.resolve(),
  ]);
  return { quizId, questions: ordered };
}

function scheduleReplenishment(input: Pick<DeliveryInput, 'studentId' | 'subjectId' | 'conceptId' | 'contract'>) {
  const target = { studentId: input.studentId, subjectId: input.subjectId, conceptId: input.conceptId };
  const language = input.contract.language;
  try {
    // after the response: the learner never waits for replenishment
    after(() => scheduleDeliveryReplenishment(target, { language }).catch(() => {}));
  } catch {
    // outside a request scope (scripts / benchmark): queue only, no inline worker
    void scheduleDeliveryReplenishment(target, { language, kickWorker: false }).catch(() => {});
  }
}

export async function deliverCanonicalActivity(input: DeliveryInput): Promise<DeliveryResult> {
  const timings: LaunchTimings = { lockMs: 0, resumeMs: 0, inventoryMs: 0, bankMs: 0, sessionMs: 0 };
  let t = Date.now();
  const lock = await acquireLaunchLock(launchLockKey(input));
  timings.lockMs = Date.now() - t;
  let keepLock = false;
  try {
    // 1. an equivalent open session is THE session (double click, refresh, back to the concept).
    //    Independent reads run in the same round trip.
    t = Date.now();
    const [resumed, snapshot, askFlags, reserved] = await Promise.all([
      findResumableCanonicalSession({
        studentId: input.studentId,
        conceptId: input.conceptId,
        quizMode: input.quizMode,
        language: input.contract.language,
        policyVersion: input.v1Marker.pedagogicalPolicyVersion,
        expectedItemCount: input.contract.itemCount,
        contract: {
          canonicalActivityType: input.v1Marker.canonicalActivityType,
          itemCount: input.v1Marker.itemCount ? { authorized: input.v1Marker.itemCount.authorized } : null,
          difficulty: input.v1Marker.difficulty,
          independence: input.v1Marker.independence,
        },
      }),
      loadLearnerStateSnapshot(input.studentId, input.conceptId),
      computeAskConfidenceFlags(input.studentId, [input.conceptId], input.quizMode),
      reservedCandidateIds(input.studentId, input.conceptId),
    ]);
    timings.resumeMs = Date.now() - t;
    if (resumed) return { status: 'DELIVERED', source: 'RESUMED', quizId: resumed.quizId, questions: resumed.questions, timings };

    const contractFingerprint = activityContractFingerprint(input.contract);
    const learnerFp = learnerStateFingerprint(snapshot);
    const stage = STAGE_FOR_ACTIVITY[input.activityType];
    const askConfidence = askFlags.get(input.conceptId) === true;

    // 2. a compatible READY prepared activity, consumed atomically (one statement)
    t = Date.now();
    const consumed = await consumeCompatibleInventory(
      { studentId: input.studentId, conceptId: input.conceptId, stage, policyVersion: input.v1Marker.pedagogicalPolicyVersion },
      { contractFingerprint, learnerStateFingerprint: learnerFp },
    );
    timings.inventoryMs = Date.now() - t;
    if (consumed && consumed.questions.length === input.contract.itemCount) {
      t = Date.now();
      const session = await openSession(input, consumed.questions, 'INVENTORY', consumed.candidateIds, askConfidence, consumed.id);
      timings.sessionMs = Date.now() - t;
      scheduleReplenishment(input);
      return { status: 'DELIVERED', source: 'INVENTORY', ...session, timings };
    }

    // 3. cold miss: assemble from the VALIDATED bank
    t = Date.now();
    const assembly = await assembleActivityForLearner({ studentId: input.studentId, contract: input.contract, academic: input.academic, reservedCandidateIds: reserved });
    timings.bankMs = Date.now() - t;
    if (assembly.status === 'ASSEMBLED') {
      t = Date.now();
      const session = await openSession(input, assembly.questions, 'BANK', assembly.candidateIds, askConfidence, null);
      timings.sessionMs = Date.now() - t;
      scheduleReplenishment(input);
      return { status: 'DELIVERED', source: 'BANK', ...session, timings };
    }

    // 4. neither: explicit emergency -- the lock stays held until the caller completes it
    keepLock = true;
    scheduleReplenishment(input);
    return { status: 'EMERGENCY_REQUIRED', lock, timings, bank: { available: assembly.available, needed: assembly.needed } };
  } finally {
    if (!keepLock) await lock.release();
  }
}

/** After an emergency generation: bank what the certified generators produced, mark provenance, record deliveries. */
export async function completeEmergencyDelivery(params: {
  input: Pick<DeliveryInput, 'studentId' | 'subjectId' | 'conceptId' | 'activityType' | 'contract' | 'academic'>;
  quizId: string;
  questions: GeneratedQuestion[];
  generator: { provider: string | null; model: string | null; promptId: string | null; promptVersion: string; operationId: string | null };
}): Promise<void> {
  const { input } = params;
  const banked = await addValidatedCandidates(params.questions, {
    studentId: input.studentId,
    conceptId: input.conceptId,
    activityType: input.activityType,
    language: input.contract.language,
    academic: input.academic,
    generator: params.generator,
  });
  await Promise.all([
    db.query(`UPDATE quiz_sessions SET delivery_source = 'EMERGENCY_AI' WHERE id = $1`, [params.quizId]),
    recordBankDeliveries(banked.ids.filter((x): x is string => !!x), params.quizId, input.studentId),
  ]);
}

/** One structured line per launch: per-stage timings, source, AI calls (must be 0 on the hot path). */
export function logActivityLaunch(fields: {
  activityType: DeliveryActivityType;
  source: DeliverySource | 'FAILED';
  authorizationMs: number;
  decisionMs: number;
  timings: Partial<LaunchTimings>;
  totalMs: number;
  conceptId: string;
}): { aiCalls: number; hotPathAiViolation: boolean } {
  const ai = currentAiCallCount();
  const aiCalls = ai.executions + ai.providerCalls;
  const hotPathAiViolation = fields.source !== 'EMERGENCY_AI' && aiCalls > 0;
  try {
    console.log('[activity-launch]', JSON.stringify({ ...fields, aiCalls, hotPathAiViolation, emergencyGeneration: fields.source === 'EMERGENCY_AI' }));
    if (hotPathAiViolation) console.error('[activity-launch] HOT_PATH_AI_VIOLATION', JSON.stringify({ activityType: fields.activityType, aiCalls }));
    if (fields.source === 'EMERGENCY_AI') console.warn('[activity-launch] EMERGENCY_GENERATION', JSON.stringify({ activityType: fields.activityType, conceptId: fields.conceptId, totalMs: fields.totalMs }));
  } catch {
    /* observability never breaks the launch */
  }
  return { aiCalls, hotPathAiViolation };
}
