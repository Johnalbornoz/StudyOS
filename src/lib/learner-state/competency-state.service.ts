/**
 * F5 -- Competency State: derived ONLY from Evidence explicitly tagged
 * (metadata.competencyIds) as measuring a given canonical competency.
 * Never synthesized from skill_competencies/canonical_concept_competencies
 * or from underlying Skill State (INV-F5-10, AC-F5-04) -- a competency
 * must be measured by its own directly-tagged evidence.
 */
import { db, type DbExecutor } from '@/lib/db';
import { recordDecisionEvent } from '@/lib/audit';
import { getActivePolicy } from './policy.service';
import { computeDimensionState } from './algorithms/state-classification';
import type { CompetencyState, QualifyingEvidenceItem, StateExplanation } from './types';

async function fetchQualifyingEvidence(client: DbExecutor, studentId: string, competencyId: string) {
  const result = await client.query(
    `SELECT id, result, ai_assistance_type, "timestamp" FROM learning_evidence
     WHERE student_id = $1 AND metadata -> 'competencyIds' @> to_jsonb($2::text)
     ORDER BY "timestamp" DESC`,
    [studentId, competencyId]
  );
  return result.rows as Array<{ id: string; result: string; ai_assistance_type: string; timestamp: string }>;
}

function toQualifyingItems(rows: Array<{ id: string; result: string; ai_assistance_type: string; timestamp: string }>): QualifyingEvidenceItem[] {
  return rows.map((r) => ({ id: r.id, result: r.result, independent: r.ai_assistance_type === 'NONE', occurredAt: r.timestamp }));
}

export async function projectCompetencyState(studentId: string, competencyId: string, client: DbExecutor = db): Promise<CompetencyState> {
  const policy = await getActivePolicy('COMPETENCY', client);
  const rules = policy.rules as { minimumEvidenceCount: number };
  const rows = await fetchQualifyingEvidence(client, studentId, competencyId);
  const computed = computeDimensionState(toQualifyingItems(rows), rules);

  const previous = await client.query(`SELECT state FROM learner_competency_state WHERE student_id = $1 AND competency_id = $2`, [studentId, competencyId]);
  const previousState = previous.rows[0]?.state ?? null;

  const upserted = await client.query(
    `INSERT INTO learner_competency_state (student_id, competency_id, state, evidence_count, independent_evidence_count, last_evidence_at, policy_version_id, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (student_id, competency_id) DO UPDATE SET
       state = $3, evidence_count = $4, independent_evidence_count = $5, last_evidence_at = $6, policy_version_id = $7, computed_at = now()
     RETURNING student_id, competency_id, state, evidence_count, independent_evidence_count, last_evidence_at, policy_version_id`,
    [studentId, competencyId, computed.state, computed.evidenceCount, computed.independentEvidenceCount, computed.lastEvidenceAt, policy.id]
  );
  const row = upserted.rows[0];

  if (previousState !== computed.state) {
    await recordDecisionEvent({
      decisionType: 'COMPETENCY_STATE_PROJECTED',
      engine: 'learner-state-engine',
      engineVersion: String(policy.version),
      studentId,
      sourceEventType: 'learner_competency_state',
      sourceEventId: competencyId,
      previousState: { state: previousState },
      newState: { state: computed.state, evidenceCount: computed.evidenceCount },
      reasonCode: 'EVIDENCE_REPLAY',
    });
  }

  return {
    studentId: row.student_id,
    competencyId: row.competency_id,
    state: row.state,
    evidenceCount: row.evidence_count,
    independentEvidenceCount: row.independent_evidence_count,
    lastEvidenceAt: row.last_evidence_at,
    policyVersionId: row.policy_version_id,
  };
}

/** Best-effort: called from updateMastery's transaction for every competencyId tagged on the new evidence, never allowed to abort it. */
export async function projectCompetencyStateForNewEvidence(client: DbExecutor, studentId: string, metadata: Record<string, unknown> | null | undefined): Promise<void> {
  const competencyIds = Array.isArray(metadata?.competencyIds) ? (metadata!.competencyIds as unknown[]).filter((s): s is string => typeof s === 'string') : [];
  for (const competencyId of competencyIds) {
    try {
      await projectCompetencyState(studentId, competencyId, client);
    } catch (err) {
      console.error('[F5] Competency State projection failed (non-fatal):', { studentId, competencyId, err });
    }
  }
}

export async function getCompetencyState(studentId: string, competencyId: string): Promise<CompetencyState | null> {
  const result = await db.query(
    `SELECT student_id, competency_id, state, evidence_count, independent_evidence_count, last_evidence_at, policy_version_id
     FROM learner_competency_state WHERE student_id = $1 AND competency_id = $2`,
    [studentId, competencyId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    studentId: row.student_id,
    competencyId: row.competency_id,
    state: row.state,
    evidenceCount: row.evidence_count,
    independentEvidenceCount: row.independent_evidence_count,
    lastEvidenceAt: row.last_evidence_at,
    policyVersionId: row.policy_version_id,
  };
}

export async function explainCompetencyState(studentId: string, competencyId: string): Promise<StateExplanation> {
  const [policy, rows, current] = await Promise.all([
    getActivePolicy('COMPETENCY'),
    fetchQualifyingEvidence(db, studentId, competencyId),
    getCompetencyState(studentId, competencyId),
  ]);
  const rules = policy.rules as { minimumEvidenceCount: number };
  const sorted = [...rows].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const withinRecentWindow = sorted.slice(0, rules.minimumEvidenceCount).map((r) => r.id);

  const evidence = sorted.map((r) => {
    const independent = r.ai_assistance_type === 'NONE';
    const inWindow = withinRecentWindow.includes(r.id);
    let reason: string;
    if (!inWindow && sorted.length >= rules.minimumEvidenceCount) reason = 'included in evidence count, outside the most-recent consistency window';
    else if (!independent) reason = 'assisted (ai_assistance_type != NONE) -- counted, but excluded from CONSISTENT_INDEPENDENT';
    else if (r.result !== 'correct') reason = 'independent but not correct -- excluded from CONSISTENT_INDEPENDENT';
    else reason = 'independent, correct, within the consistency window';
    return { id: r.id, occurredAt: r.timestamp, included: true, reason };
  });

  return {
    state: current?.state ?? 'NO_EVIDENCE',
    policyVersion: policy.version,
    evidence,
    insufficientBecause: rows.length < rules.minimumEvidenceCount ? `only ${rows.length} qualifying evidence row(s), minimum is ${rules.minimumEvidenceCount}` : null,
  };
}
