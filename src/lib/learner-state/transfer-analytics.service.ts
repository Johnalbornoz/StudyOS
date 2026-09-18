/**
 * F5 -- Transfer analytics: context-diversity counters only (F4's
 * FAMILIAR/ALTERED/REAL_WORLD/UNFAMILIAR/CROSS_DOMAIN taxonomy, wired to
 * real evidence for the first time). Explicitly NOT a 6th transfer-depth
 * vocabulary -- never touches concept_transfer_state, never feeds
 * Canonical V2's own Transfer progression. See
 * docs/implementation/f5/F5_CANONICAL_V2_BOUNDARY.md.
 */
import { db, type DbExecutor } from '@/lib/db';
import { recordDecisionEvent } from '@/lib/audit';
import { getActivePolicy } from './policy.service';
import type { TransferAnalytics } from './types';

const CONTEXT_CODES = ['FAMILIAR', 'ALTERED', 'REAL_WORLD', 'UNFAMILIAR', 'CROSS_DOMAIN'] as const;

function toRow(row: any): TransferAnalytics {
  return {
    studentId: row.student_id,
    conceptId: row.concept_id,
    canonicalConceptId: row.canonical_concept_id,
    contextFamiliarCount: row.context_familiar_count,
    contextAlteredCount: row.context_altered_count,
    contextRealWorldCount: row.context_real_world_count,
    contextUnfamiliarCount: row.context_unfamiliar_count,
    contextCrossDomainCount: row.context_cross_domain_count,
    distinctContextCount: row.distinct_context_count,
    policyVersionId: row.policy_version_id,
  };
}

/**
 * Recomputes context-diversity counters for one (student, concept) pair
 * from ALL tagged evidence -- a full replay. The canonical_concept_id is
 * looked up fresh every time and used ONLY when the F4 mapping is
 * MATCHED at this moment (task 23) -- never persisted onto evidence,
 * never guessed for AMBIGUOUS/UNRESOLVED (AC-F5-17/18).
 */
export async function projectTransferAnalytics(studentId: string, conceptId: string, client: DbExecutor = db): Promise<TransferAnalytics> {
  const policy = await getActivePolicy('TRANSFER_ANALYTICS', client);

  const rows = await client.query(
    `SELECT metadata ->> 'contextCode' AS context_code FROM learning_evidence
     WHERE student_id = $1 AND concept_id = $2 AND metadata ->> 'contextCode' IS NOT NULL`,
    [studentId, conceptId]
  );

  const counts: Record<(typeof CONTEXT_CODES)[number], number> = {
    FAMILIAR: 0, ALTERED: 0, REAL_WORLD: 0, UNFAMILIAR: 0, CROSS_DOMAIN: 0,
  };
  for (const r of rows.rows as Array<{ context_code: string }>) {
    if ((CONTEXT_CODES as readonly string[]).includes(r.context_code)) {
      counts[r.context_code as (typeof CONTEXT_CODES)[number]] += 1;
    }
  }
  const distinctContextCount = Object.values(counts).filter((c) => c > 0).length;

  const mapping = await client.query(
    `SELECT canonical_concept_id, status FROM concept_catalog_mapping WHERE learner_concept_id = $1`,
    [conceptId]
  );
  const canonicalConceptId = mapping.rows[0]?.status === 'MATCHED' ? mapping.rows[0].canonical_concept_id : null;

  const upserted = await client.query(
    `INSERT INTO learner_transfer_analytics (
       student_id, concept_id, canonical_concept_id,
       context_familiar_count, context_altered_count, context_real_world_count, context_unfamiliar_count, context_cross_domain_count,
       distinct_context_count, policy_version_id, computed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (student_id, concept_id) DO UPDATE SET
       canonical_concept_id = $3,
       context_familiar_count = $4, context_altered_count = $5, context_real_world_count = $6,
       context_unfamiliar_count = $7, context_cross_domain_count = $8,
       distinct_context_count = $9, policy_version_id = $10, computed_at = now()
     RETURNING student_id, concept_id, canonical_concept_id, context_familiar_count, context_altered_count,
       context_real_world_count, context_unfamiliar_count, context_cross_domain_count, distinct_context_count, policy_version_id`,
    [studentId, conceptId, canonicalConceptId, counts.FAMILIAR, counts.ALTERED, counts.REAL_WORLD, counts.UNFAMILIAR, counts.CROSS_DOMAIN, distinctContextCount, policy.id]
  );

  await recordDecisionEvent({
    decisionType: 'TRANSFER_ANALYTICS_PROJECTED',
    engine: 'learner-state-engine',
    engineVersion: String(policy.version),
    studentId,
    conceptId,
    sourceEventType: 'learner_transfer_analytics',
    newState: { distinctContextCount },
    reasonCode: 'EVIDENCE_REPLAY',
  });

  return toRow(upserted.rows[0]);
}

/** Best-effort: called from updateMastery's transaction only when the new evidence itself carries a contextCode tag, never allowed to abort it. */
export async function projectTransferAnalyticsForNewEvidence(client: DbExecutor, studentId: string, conceptId: string, metadata: Record<string, unknown> | null | undefined): Promise<void> {
  if (typeof metadata?.contextCode !== 'string') return;
  try {
    await projectTransferAnalytics(studentId, conceptId, client);
  } catch (err) {
    console.error('[F5] Transfer analytics projection failed (non-fatal):', { studentId, conceptId, err });
  }
}

export async function getTransferAnalytics(studentId: string, conceptId: string): Promise<TransferAnalytics | null> {
  const result = await db.query(
    `SELECT student_id, concept_id, canonical_concept_id, context_familiar_count, context_altered_count,
       context_real_world_count, context_unfamiliar_count, context_cross_domain_count, distinct_context_count, policy_version_id
     FROM learner_transfer_analytics WHERE student_id = $1 AND concept_id = $2`,
    [studentId, conceptId]
  );
  return result.rows.length === 0 ? null : toRow(result.rows[0]);
}
