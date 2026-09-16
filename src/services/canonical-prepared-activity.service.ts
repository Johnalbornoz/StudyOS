/**
 * CANON-R6-PERF-R2 -- SELECTIVE CANONICAL PROVE PRE-GENERATION.
 *
 * Persists and serves `canonical_prepared_activity` rows: PREPARED
 * CONTENT for a canonical activity, generated in the background before
 * the learner ever clicks, so a click can become a fast local read
 * instead of a live, multi-second AI generation. A prepared row is
 * NEVER a learner attempt -- creating one never writes learning_evidence,
 * never touches quiz_sessions, and never influences the canonical
 * engine's own decision. The canonical engine remains the SOLE
 * authority: every consumption path re-verifies a FRESH canonical
 * decision before ever looking at a prepared row (route.ts's own
 * `v1Marker`, computed independently, exactly as CANON-R5R1 established
 * -- this service never re-implements that check).
 *
 * Named generically (`canonical_prepared_activity`, `stage` widened to
 * PROVE/RETAIN/TRANSFER) so a future phase could extend preparation to
 * other canonical stages onto this SAME mechanism -- but this phase
 * activates ONLY PROVE (Part 31/32).
 */
import { randomUUID, createHash } from 'crypto';
import { db } from '@/lib/db';
import { generateCanonicalProveQuestions, type CanonicalProveGenerationResult } from '@/services/canonical-prove-generation.service';
import { loadPriorPracticeQuestionFingerprints } from '@/services/quiz-persistence.service';
import { filterExactDuplicates } from '@/lib/lx/exact-duplicate-novelty';
import { ALL_QUESTION_TYPES, type GeneratedQuestion, type IBContext } from '@/services/quiz-generation.service';

/**
 * CANON-R6-PERF-R2 Part 13 -- conservative TTL: a prepared Prove batch
 * is only useful for the SAME study session that just passed Practice.
 * 2 hours comfortably covers "finish Practice, do something else for a
 * while, come back and click Prove" without keeping generated content
 * (and its own novelty basis, which goes stale as soon as the learner
 * does ANY more Practice) around indefinitely. Never indefinite.
 */
export const PREPARED_ACTIVITY_TTL_MS = 2 * 60 * 60 * 1000;

export type PreparedActivityStatus = 'PREPARING' | 'READY' | 'CONSUMED' | 'INVALIDATED' | 'FAILED';

export interface PreparedActivityContractSnapshot {
  canonicalActivityType: string;
  itemCount: { min: number; max: number; authorized: number };
  difficulty: { min: number; max: number; target: number };
  independence: boolean;
  supportLevel: 'ASSISTED' | 'NONE';
  minimumScorePercent: number;
}

export interface CanonicalPreparedActivityRow {
  id: string;
  studentId: string;
  conceptId: string;
  stage: 'PROVE' | 'RETAIN' | 'TRANSFER';
  pedagogicalPolicyVersion: string;
  canonicalRevision: string;
  activityContract: PreparedActivityContractSnapshot;
  status: PreparedActivityStatus;
  questions: GeneratedQuestion[] | null;
  noveltyPolicy: string | null;
  priorPracticeFingerprintBasis: { count: number; hash: string } | null;
  createdAt: Date;
  readyAt: Date | null;
  expiresAt: Date | null;
  consumedAt: Date | null;
  consumedByQuizId: string | null;
}

function rowToPreparedActivity(row: any): CanonicalPreparedActivityRow {
  return {
    id: row.id,
    studentId: row.student_id,
    conceptId: row.concept_id,
    stage: row.stage,
    pedagogicalPolicyVersion: row.pedagogical_policy_version,
    canonicalRevision: row.canonical_revision,
    activityContract: typeof row.activity_contract === 'string' ? JSON.parse(row.activity_contract) : row.activity_contract,
    status: row.status,
    questions: row.questions == null ? null : typeof row.questions === 'string' ? JSON.parse(row.questions) : row.questions,
    noveltyPolicy: row.novelty_policy,
    priorPracticeFingerprintBasis:
      row.prior_practice_fingerprint_basis == null
        ? null
        : typeof row.prior_practice_fingerprint_basis === 'string'
          ? JSON.parse(row.prior_practice_fingerprint_basis)
          : row.prior_practice_fingerprint_basis,
    createdAt: new Date(row.created_at),
    readyAt: row.ready_at ? new Date(row.ready_at) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
    consumedByQuizId: row.consumed_by_quiz_id,
  };
}

/** A non-reversible, order-independent digest of a fingerprint set -- never the fingerprints/question text themselves, purely a "has this changed?" check. */
function hashFingerprintSet(fingerprints: ReadonlySet<string>): string {
  const sorted = Array.from(fingerprints).sort();
  return createHash('sha256').update(sorted.join('\n')).digest('hex');
}

function safeLog(label: string, meta: Record<string, unknown> = {}): void {
  try {
    // eslint-disable-next-line no-console
    console.log(label, JSON.stringify(meta));
  } catch { /* logging must never break the caller */ }
}

/**
 * CANON-R6-PERF-R2 Part 2/3/14 -- the background preparation pipeline.
 * MUST be called via `after()` (or an equivalent detached-but-awaited
 * mechanism) by the caller -- this function itself has no notion of
 * "background"; it is a plain async function that:
 *   1. Deduplicates (Part 1/5): an INSERT ... ON CONFLICT DO NOTHING
 *      against the partial unique index is the ONLY dedup authority --
 *      if another active preparation already exists for this exact
 *      canonical identity, this call is a structural no-op.
 *   2. Runs the SAME certified generateCanonicalProveQuestions pipeline
 *      CANON-R6-PERF-R1 built and this phase's own live cold-cache path
 *      calls too (Part 6 -- never a cheaper path).
 *   3. Marks the row READY (with the generated questions + novelty
 *      basis) or FAILED (Part 14 -- a failure here NEVER throws back to
 *      the caller; the learner's own Practice response already
 *      returned long before this runs).
 */
export async function prepareCanonicalProveActivity(params: {
  studentId: string;
  conceptId: string;
  subjectId: string;
  pedagogicalPolicyVersion: string;
  canonicalRevision: string;
  contract: PreparedActivityContractSnapshot;
  language: string;
  guidance: string;
  visualAidRate: number;
  ibContext: IBContext | null;
}): Promise<void> {
  const { studentId, conceptId, subjectId, pedagogicalPolicyVersion, canonicalRevision, contract } = params;
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + PREPARED_ACTIVITY_TTL_MS);

  // Part 1/5/10 -- the ONE atomicity guarantee: the partial unique
  // index `idx_canonical_prepared_activity_one_active` (student,
  // concept, stage, policyVersion; WHERE status IN ('PREPARING',
  // 'READY')) rejects a second concurrent insert for the SAME
  // canonical identity at the database level. `ON CONFLICT DO NOTHING`
  // (no explicit target needed -- this table has exactly one relevant
  // unique constraint) makes a losing insert a silent no-op rather than
  // an error, and `RETURNING id` tells the caller whether IT was the
  // winner. Two concurrent preparation attempts can never both proceed.
  let insertedId: string | null = null;
  try {
    const insertResult = await db.query(
      `
      INSERT INTO canonical_prepared_activity (
        id, student_id, concept_id, stage, pedagogical_policy_version, canonical_revision,
        activity_contract, status, created_at, expires_at
      )
      VALUES ($1, $2, $3, 'PROVE', $4, $5, $6, 'PREPARING', NOW(), $7)
      ON CONFLICT DO NOTHING
      RETURNING id
      `,
      [id, studentId, conceptId, pedagogicalPolicyVersion, canonicalRevision, JSON.stringify(contract), expiresAt]
    );
    insertedId = insertResult.rows[0]?.id ?? null;
  } catch (error) {
    console.error('[canonical-prepared-activity] insert failed:', error);
    return;
  }

  if (!insertedId) {
    // Part 1/4 -- a compatible active preparation already exists (or a
    // concurrent request won the race) -- never a second speculative batch.
    safeLog('prove_pregeneration_skipped_duplicate', { studentId, conceptId });
    return;
  }

  safeLog('prove_pregeneration_started', { id: insertedId, studentId, conceptId, pedagogicalPolicyVersion });

  try {
    const result: CanonicalProveGenerationResult = await generateCanonicalProveQuestions({
      conceptId,
      studentId,
      subjectId,
      targetCount: contract.itemCount.authorized,
      difficulty: contract.difficulty.target,
      guidance: params.guidance,
      language: params.language,
      visualAidRate: params.visualAidRate,
      ibContext: params.ibContext,
      activityType: 'SOLO_CHECK',
      quizMode: 'canonical_prove',
      parentOperationId: insertedId,
    });

    if (result.finalQuestionCount < contract.itemCount.authorized) {
      await db.query(
        `UPDATE canonical_prepared_activity SET status = 'FAILED', failure_reason = $2 WHERE id = $1`,
        [insertedId, 'GENERATION_INCOMPLETE']
      );
      safeLog('prove_pregeneration_failed', { id: insertedId, reason: 'GENERATION_INCOMPLETE', acceptedCount: result.finalQuestionCount });
      return;
    }

    const fingerprintBasis = {
      count: result.priorPracticeFingerprintCount,
      // Recomputed at prep-completion time (not merely the pre-generation
      // count) so revalidation at consumption time can cheaply detect
      // "nothing changed" without re-fetching fingerprints just to hash
      // them -- see revalidatePreparedActivityNovelty, which always
      // re-fetches fresh fingerprints anyway (Part 8's own instruction:
      // "re-check exact novelty against CURRENT prior Practice
      // fingerprints", never trusting a cached hash alone to decide
      // validity -- this hash is diagnostic/observability only).
      hash: hashFingerprintSet(new Set(result.questions.map((q) => q.question))),
    };

    await db.query(
      `
      UPDATE canonical_prepared_activity
      SET status = 'READY', questions = $2, novelty_policy = $3,
          prior_practice_fingerprint_basis = $4, ready_at = NOW(), generation_operation_id = $5
      WHERE id = $1
      `,
      [insertedId, JSON.stringify(result.questions), 'EXACT_DUPLICATE_EXCLUSION_V1', JSON.stringify(fingerprintBasis), insertedId]
    );
    safeLog('prove_pregeneration_ready', {
      id: insertedId,
      studentId,
      conceptId,
      acceptedCount: result.finalQuestionCount,
      aggregateRecoveryUsed: result.aggregateRecoveryUsed,
      generationConcurrentMs: result.generationConcurrentMs,
    });
  } catch (error) {
    console.error('[canonical-prepared-activity] preparation failed:', error);
    try {
      await db.query(`UPDATE canonical_prepared_activity SET status = 'FAILED', failure_reason = $2 WHERE id = $1`, [insertedId, 'UNEXPECTED_ERROR']);
    } catch { /* best-effort -- the row simply expires via TTL if this also fails */ }
    safeLog('prove_pregeneration_failed', { id: insertedId, reason: 'UNEXPECTED_ERROR' });
  }
}

/**
 * CANON-R6-PERF-R2 Part 8/24 -- cheap status read, no side effects.
 * Used both by the consumption path (to decide HIT/MISS/PREPARING) and
 * by the optional lightweight status endpoint.
 */
export async function findActivePreparedActivity(
  studentId: string,
  conceptId: string,
  stage: 'PROVE' = 'PROVE'
): Promise<CanonicalPreparedActivityRow | null> {
  const result = await db.query(
    `
    SELECT * FROM canonical_prepared_activity
    WHERE student_id = $1 AND concept_id = $2 AND stage = $3
      AND status IN ('PREPARING', 'READY')
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [studentId, conceptId, stage]
  );
  if (result.rows.length === 0) return null;
  return rowToPreparedActivity(result.rows[0]);
}

/**
 * CANON-R6-PERF-R2 Part 9 -- compatibility, defined narrowly and
 * explicitly (never raw canonicalRevision equality, which can change
 * for reasons unrelated to the Prove contract itself -- e.g. a
 * misconception count changing elsewhere never invalidates an
 * otherwise-identical Prove contract). A prepared activity is
 * compatible with a FRESH authorization when every field that actually
 * governs what gets administered matches exactly: policy version,
 * exact item count, the full difficulty range + target, independence,
 * support level, and the minimum passing score. Anything else about
 * the fresh decision (journeyProgressPercent, reasonCodes, etc.) is
 * irrelevant to Prove compatibility and is never compared.
 */
export function isPreparedActivityContractCompatible(
  prepared: PreparedActivityContractSnapshot,
  current: PreparedActivityContractSnapshot
): boolean {
  return (
    prepared.canonicalActivityType === current.canonicalActivityType &&
    prepared.itemCount.authorized === current.itemCount.authorized &&
    prepared.itemCount.min === current.itemCount.min &&
    prepared.itemCount.max === current.itemCount.max &&
    prepared.difficulty.target === current.difficulty.target &&
    prepared.difficulty.min === current.difficulty.min &&
    prepared.difficulty.max === current.difficulty.max &&
    prepared.independence === current.independence &&
    prepared.supportLevel === current.supportLevel &&
    prepared.minimumScorePercent === current.minimumScorePercent
  );
}

export interface PreparedActivityRevalidation {
  valid: boolean;
  reason?: 'EXPIRED' | 'INCOMPATIBLE_CONTRACT' | 'NOT_READY' | 'NOVELTY_STALE';
}

/**
 * CANON-R6-PERF-R2 Part 8 -- the FULL consumption-time validation
 * sequence, everything EXCEPT the fresh canonical re-authorization
 * itself (the caller -- route.ts -- already independently computed
 * that as `v1Marker`, before ever calling this). Order matches Part 8
 * exactly: status/expiry/contract first (cheap, local), THEN the real
 * novelty re-check (Part 8's own "re-check exact novelty against
 * CURRENT prior Practice fingerprints" -- a DB read, done last since
 * it's the only genuinely expensive check here).
 */
export async function revalidatePreparedActivity(
  prepared: CanonicalPreparedActivityRow,
  currentContract: PreparedActivityContractSnapshot
): Promise<PreparedActivityRevalidation> {
  if (prepared.status !== 'READY' || !prepared.questions) {
    return { valid: false, reason: 'NOT_READY' };
  }
  if (prepared.expiresAt && prepared.expiresAt.getTime() < Date.now()) {
    return { valid: false, reason: 'EXPIRED' };
  }
  if (!isPreparedActivityContractCompatible(prepared.activityContract, currentContract)) {
    return { valid: false, reason: 'INCOMPATIBLE_CONTRACT' };
  }

  const freshFingerprints = await loadPriorPracticeQuestionFingerprints(prepared.studentId, prepared.conceptId);
  const revalidationFilter = filterExactDuplicates(prepared.questions, freshFingerprints);
  if (revalidationFilter.rejectedCount > 0) {
    // Part 8: never partially patch a prepared batch at consumption
    // time -- ANY new collision against fresh Practice fingerprints
    // invalidates the WHOLE prepared batch; the cold-cache path
    // generates a genuinely novel replacement instead.
    return { valid: false, reason: 'NOVELTY_STALE' };
  }

  return { valid: true };
}

/**
 * CANON-R6-PERF-R2 Part 10 -- ATOMIC single consumption. The
 * `UPDATE ... WHERE status = 'READY' ... RETURNING` is the ONLY
 * correctness mechanism: two concurrent requests (two tabs, a retried
 * request) racing to consume the SAME row can only ever have ONE of
 * them see a returned row -- the loser's UPDATE affects zero rows
 * (the row is no longer 'READY' by the time it runs), and that caller
 * must fall back to cold-cache generation, never reuse the same
 * prepared content twice.
 */
export async function consumePreparedActivity(id: string, quizId: string): Promise<GeneratedQuestion[] | null> {
  const result = await db.query(
    `
    UPDATE canonical_prepared_activity
    SET status = 'CONSUMED', consumed_at = NOW(), consumed_by_quiz_id = $2
    WHERE id = $1 AND status = 'READY'
    RETURNING questions
    `,
    [id, quizId]
  );
  if (result.rows.length === 0) return null; // lost the race, or already consumed/invalidated
  const row = result.rows[0];
  safeLog('prove_pregeneration_consumed', { id, quizId });
  return typeof row.questions === 'string' ? JSON.parse(row.questions) : row.questions;
}

/** CANON-R6-PERF-R2 Part 8/9 -- never reused once invalidated; the caller falls back to cold generation. */
export async function invalidatePreparedActivity(id: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE canonical_prepared_activity SET status = 'INVALIDATED', failure_reason = $2 WHERE id = $1 AND status = 'READY'`,
    [id, reason]
  );
  safeLog('prove_pregeneration_invalidated', { id, reason });
}
