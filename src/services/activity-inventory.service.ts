/**
 * LEARNING_ACTIVITY_DELIVERY -- per-learner PREPARED ACTIVITY INVENTORY
 * (table canonical_prepared_activity, generalized to every canonical stage).
 *
 *   PREPARING -> READY -> CONSUMED
 *                     \-> INVALIDATED (contract or learner state changed,
 *                                      stage changed, legacy row)
 *                     \-> EXPIRED     (past expires_at)
 *
 * A READY activity is delivered only while its activity-contract AND
 * learner-state fingerprints still match (contract.ts) -- TTL is a backstop,
 * never the only rule. Consumption is atomic (row lock + SKIP LOCKED), so a
 * READY activity is delivered at most once.
 */
import { db } from '@/lib/db';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import {
  inventoryTarget,
  preparedActivityCompatibility,
  type ActivityContract,
  type DeliveryStage,
} from '@/lib/activity-delivery/contract';

export const PREPARED_BANK_ACTIVITY_TTL_MS = 24 * 60 * 60 * 1000;

function log(event: string, fields: Record<string, unknown>) {
  try {
    console.log('[activity-inventory]', JSON.stringify({ event, ...fields }));
  } catch {
    /* observability never breaks the caller */
  }
}

export interface InventoryIdentity {
  studentId: string;
  conceptId: string;
  stage: DeliveryStage;
  policyVersion: string;
}

export interface ConsumedActivity {
  id: string;
  questions: GeneratedQuestion[];
  candidateIds: string[];
}

/**
 * Consumes the first compatible READY activity for this identity, retiring
 * every incompatible or expired one it passes. Null when none is usable.
 */
export async function consumeCompatibleInventory(
  identity: InventoryIdentity,
  current: { contractFingerprint: string; learnerStateFingerprint: string },
): Promise<ConsumedActivity | null> {
  // ONE statement, atomic: lock this identity's READY rows (SKIP LOCKED), retire
  // the incompatible / expired ones (same rules as preparedActivityCompatibility),
  // and consume the first compatible one.
  const r = await db.query(
    `WITH ready AS (
       SELECT id, slot, created_at,
              CASE
                WHEN contract_fingerprint IS NULL OR learner_state_fingerprint IS NULL THEN 'LEGACY_PREPARATION'
                WHEN expires_at IS NOT NULL AND expires_at <= now() THEN 'EXPIRED'
                WHEN contract_fingerprint <> $4 THEN 'CONTRACT_CHANGED'
                WHEN learner_state_fingerprint <> $5 THEN 'LEARNER_STATE_CHANGED'
                ELSE NULL
              END AS verdict
         FROM canonical_prepared_activity
        WHERE student_id = $1 AND concept_id = $2 AND stage = $3 AND status = 'READY'
        FOR UPDATE SKIP LOCKED
     ),
     retired AS (
       UPDATE canonical_prepared_activity p
          SET status = CASE WHEN r.verdict = 'EXPIRED' THEN 'EXPIRED' ELSE 'INVALIDATED' END, failure_reason = r.verdict
         FROM ready r
        WHERE p.id = r.id AND r.verdict IS NOT NULL
        RETURNING r.verdict
     ),
     chosen AS (SELECT id FROM ready WHERE verdict IS NULL ORDER BY slot, created_at LIMIT 1),
     consumed AS (
       UPDATE canonical_prepared_activity p SET status = 'CONSUMED', consumed_at = now()
         FROM chosen c WHERE p.id = c.id
        RETURNING p.id, p.questions, p.candidate_ids
     )
     SELECT (SELECT json_agg(verdict) FROM retired) AS retired, c.id, c.questions, c.candidate_ids
       FROM (SELECT 1) one LEFT JOIN consumed c ON true`,
    [identity.studentId, identity.conceptId, identity.stage, current.contractFingerprint, current.learnerStateFingerprint],
  );
  const row = r.rows[0];
  for (const reason of (row?.retired as string[] | null) ?? []) log('retired', { stage: identity.stage, reason });
  if (!row?.id) return null;
  return { id: row.id, questions: row.questions ?? [], candidateIds: row.candidate_ids ?? [] };
}

export async function linkConsumedActivity(preparedId: string, quizId: string): Promise<void> {
  await db.query(`UPDATE canonical_prepared_activity SET consumed_by_quiz_id = $2 WHERE id = $1`, [preparedId, quizId]);
}

/** No launchable activity (waiting / consolidated / blocked): nothing prepared may stay deliverable. */
export async function retireAllInventory(studentId: string, conceptId: string, reason: string): Promise<number> {
  const r = await db.query(
    `UPDATE canonical_prepared_activity SET status = 'INVALIDATED', failure_reason = $3
      WHERE student_id = $1 AND concept_id = $2 AND status IN ('PREPARING', 'READY') RETURNING id`,
    [studentId, conceptId, reason],
  );
  if (r.rows.length) log('retired', { reason, count: r.rows.length });
  return r.rows.length;
}

/** Candidate ids held by open (PREPARING/READY) activities of this learner for this concept. */
export async function reservedCandidateIds(studentId: string, conceptId: string): Promise<Set<string>> {
  const r = await db.query(
    `SELECT unnest(candidate_ids) AS id FROM canonical_prepared_activity
      WHERE student_id = $1 AND concept_id = $2 AND status IN ('PREPARING', 'READY')`,
    [studentId, conceptId],
  );
  return new Set(r.rows.map((x) => x.id as string));
}

/**
 * Retires open activities that no longer match the canonical next action
 * (another stage) or its current contract / learner state. Returns the
 * compatible READY count left for the current stage.
 */
export async function reconcileInventory(
  identity: InventoryIdentity,
  current: { contractFingerprint: string; learnerStateFingerprint: string },
): Promise<{ readyCompatible: number; usedSlots: number[] }> {
  const rows = await db.query(
    `SELECT id, stage, slot, contract_fingerprint, learner_state_fingerprint, expires_at
       FROM canonical_prepared_activity
      WHERE student_id = $1 AND concept_id = $2 AND status IN ('PREPARING', 'READY')`,
    [identity.studentId, identity.conceptId],
  );
  const usedSlots: number[] = [];
  let readyCompatible = 0;
  for (const row of rows.rows) {
    if (row.stage !== identity.stage) {
      await db.query(`UPDATE canonical_prepared_activity SET status = 'INVALIDATED', failure_reason = 'STAGE_CHANGED' WHERE id = $1 AND status IN ('PREPARING', 'READY')`, [row.id]);
      log('retired', { stage: row.stage, reason: 'STAGE_CHANGED' });
      continue;
    }
    const verdict = preparedActivityCompatibility(
      { contractFingerprint: row.contract_fingerprint, learnerStateFingerprint: row.learner_state_fingerprint, expiresAt: row.expires_at ? new Date(row.expires_at) : null },
      { ...current, now: new Date() },
    );
    if (!verdict.compatible) {
      await db.query(`UPDATE canonical_prepared_activity SET status = $2, failure_reason = $3 WHERE id = $1 AND status IN ('PREPARING', 'READY')`, [
        row.id,
        verdict.reason === 'EXPIRED' ? 'EXPIRED' : 'INVALIDATED',
        verdict.reason,
      ]);
      log('retired', { stage: row.stage, reason: verdict.reason });
      continue;
    }
    readyCompatible++;
    usedSlots.push(Number(row.slot));
  }
  return { readyCompatible, usedSlots };
}

/** Persists one READY activity assembled from the bank into a free slot (no-op if the slot got taken). */
export async function storeReadyActivity(params: {
  identity: InventoryIdentity;
  canonicalRevision: string;
  contract: ActivityContract;
  contractFingerprint: string;
  learnerStateFingerprint: string;
  slot: number;
  questions: GeneratedQuestion[];
  candidateIds: string[];
}): Promise<boolean> {
  const { identity } = params;
  const r = await db.query(
    `INSERT INTO canonical_prepared_activity
       (student_id, concept_id, stage, pedagogical_policy_version, canonical_revision, activity_contract, status, questions,
        novelty_policy, ready_at, expires_at, contract_fingerprint, learner_state_fingerprint, source, slot, candidate_ids)
     VALUES ($1, $2, $3, $4, $5, $6, 'READY', $7, 'BANK_UNDELIVERED_V1', now(), now() + ($8 || ' milliseconds')::interval, $9, $10, 'BANK', $11, $12)
     ON CONFLICT (student_id, concept_id, stage, pedagogical_policy_version, slot) WHERE status IN ('PREPARING', 'READY') DO NOTHING
     RETURNING id`,
    [
      identity.studentId, identity.conceptId, identity.stage, identity.policyVersion, params.canonicalRevision, JSON.stringify(params.contract),
      JSON.stringify(params.questions), String(PREPARED_BANK_ACTIVITY_TTL_MS), params.contractFingerprint, params.learnerStateFingerprint,
      params.slot, params.candidateIds,
    ],
  );
  const stored = r.rows.length > 0;
  if (stored) log('ready', { stage: identity.stage, slot: params.slot, items: params.questions.length, source: 'BANK' });
  return stored;
}

export { inventoryTarget };
