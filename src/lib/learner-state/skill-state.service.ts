/**
 * F5 -- Skill State: derived from Evidence explicitly tagged
 * (metadata.skillIds) as measuring a given canonical skill. Never
 * inferred from the F4 canonical_concept_skills graph (AC-F5-05). Follows
 * the same pure-algorithm + transactional-projector pattern as Retention/
 * Transfer -- see docs/implementation/f5/F5_TARGET_LEARNER_STATE_ARCHITECTURE.md.
 */
import { db, type DbExecutor } from '@/lib/db';
import { recordDecisionEvent } from '@/lib/audit';
import { getActivePolicy } from './policy.service';
import { computeDimensionState } from './algorithms/state-classification';
import type { QualifyingEvidenceItem, SkillState, StateExplanation } from './types';

async function fetchQualifyingEvidence(client: DbExecutor, studentId: string, skillId: string) {
  const result = await client.query(
    `SELECT id, result, ai_assistance_type, difficulty, "timestamp" FROM learning_evidence
     WHERE student_id = $1 AND metadata -> 'skillIds' @> to_jsonb($2::text)
     ORDER BY "timestamp" DESC`,
    [studentId, skillId]
  );
  return result.rows as Array<{ id: string; result: string; ai_assistance_type: string; difficulty: number | null; timestamp: string }>;
}

function toQualifyingItems(rows: Array<{ id: string; result: string; ai_assistance_type: string; timestamp: string }>): QualifyingEvidenceItem[] {
  return rows.map((r) => ({ id: r.id, result: r.result, independent: r.ai_assistance_type === 'NONE', occurredAt: r.timestamp }));
}

/**
 * Recomputes and upserts Skill State for one (student, skill) pair from
 * ALL of that student's qualifying evidence -- a full replay, same
 * pattern as the Retention/Transfer projectors. Safe to call from inside
 * an existing transaction (pass its client) or standalone (omit it).
 */
export async function projectSkillState(studentId: string, skillId: string, client: DbExecutor = db): Promise<SkillState> {
  const policy = await getActivePolicy('SKILL', client);
  const rules = policy.rules as { minimumEvidenceCount: number };
  const rows = await fetchQualifyingEvidence(client, studentId, skillId);
  const computed = computeDimensionState(toQualifyingItems(rows), rules);

  const previous = await client.query(`SELECT state FROM learner_skill_state WHERE student_id = $1 AND skill_id = $2`, [studentId, skillId]);
  const previousState = previous.rows[0]?.state ?? null;

  const upserted = await client.query(
    `INSERT INTO learner_skill_state (student_id, skill_id, state, evidence_count, independent_evidence_count, last_evidence_at, policy_version_id, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (student_id, skill_id) DO UPDATE SET
       state = $3, evidence_count = $4, independent_evidence_count = $5, last_evidence_at = $6, policy_version_id = $7, computed_at = now()
     RETURNING student_id, skill_id, state, evidence_count, independent_evidence_count, last_evidence_at, policy_version_id`,
    [studentId, skillId, computed.state, computed.evidenceCount, computed.independentEvidenceCount, computed.lastEvidenceAt, policy.id]
  );
  const row = upserted.rows[0];

  if (previousState !== computed.state) {
    await recordDecisionEvent({
      decisionType: 'SKILL_STATE_PROJECTED',
      engine: 'learner-state-engine',
      engineVersion: String(policy.version),
      studentId,
      sourceEventType: 'learner_skill_state',
      sourceEventId: skillId,
      previousState: { state: previousState },
      newState: { state: computed.state, evidenceCount: computed.evidenceCount },
      reasonCode: 'EVIDENCE_REPLAY',
    });
  }

  return {
    studentId: row.student_id,
    skillId: row.skill_id,
    state: row.state,
    evidenceCount: row.evidence_count,
    independentEvidenceCount: row.independent_evidence_count,
    lastEvidenceAt: row.last_evidence_at,
    policyVersionId: row.policy_version_id,
  };
}

/** Best-effort: called from updateMastery's transaction for every skillId tagged on the new evidence, never allowed to abort it. */
export async function projectSkillStateForNewEvidence(client: DbExecutor, studentId: string, metadata: Record<string, unknown> | null | undefined): Promise<void> {
  const skillIds = Array.isArray(metadata?.skillIds) ? (metadata!.skillIds as unknown[]).filter((s): s is string => typeof s === 'string') : [];
  for (const skillId of skillIds) {
    try {
      await projectSkillState(studentId, skillId, client);
    } catch (err) {
      console.error('[F5] Skill State projection failed (non-fatal):', { studentId, skillId, err });
    }
  }
}

export async function getSkillState(studentId: string, skillId: string): Promise<SkillState | null> {
  const result = await db.query(
    `SELECT student_id, skill_id, state, evidence_count, independent_evidence_count, last_evidence_at, policy_version_id
     FROM learner_skill_state WHERE student_id = $1 AND skill_id = $2`,
    [studentId, skillId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    studentId: row.student_id,
    skillId: row.skill_id,
    state: row.state,
    evidenceCount: row.evidence_count,
    independentEvidenceCount: row.independent_evidence_count,
    lastEvidenceAt: row.last_evidence_at,
    policyVersionId: row.policy_version_id,
  };
}

/** Explainability (task 16): re-derives, never reads a separately-maintained explanation store. */
export async function explainSkillState(studentId: string, skillId: string): Promise<StateExplanation> {
  const [policy, rows, current] = await Promise.all([
    getActivePolicy('SKILL'),
    fetchQualifyingEvidence(db, studentId, skillId),
    getSkillState(studentId, skillId),
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
    return { id: r.id, occurredAt: r.timestamp, included: true, reason, difficulty: r.difficulty !== null && r.difficulty !== undefined ? Number(r.difficulty) : null };
  });

  return {
    state: current?.state ?? 'NO_EVIDENCE',
    policyVersion: policy.version,
    evidence,
    insufficientBecause: rows.length < rules.minimumEvidenceCount ? `only ${rows.length} qualifying evidence row(s), minimum is ${rules.minimumEvidenceCount}` : null,
  };
}
