/**
 * F8 -- the one read path into learning_evidence for diagnosis (task
 * §5/§25). One deterministic, stably-ordered query per (student,
 * concept); the pure classification algorithms filter this same
 * fetched set for skill/technique/speed scoping rather than issuing
 * four separate round-trips. Never writes; never joins the F4/F6
 * concept->skill graph (that would let a Skill Gap be fabricated from
 * mapping existence alone -- INV-F8-08).
 */
import { db, type DbExecutor } from '@/lib/db';
import type { EvidenceRow } from './types';
import { inExamScopeSql } from '@/lib/exam-core/evidence-scope';

export async function fetchEvidenceForDiagnosis(studentId: string, conceptId: string, client: DbExecutor = db, scope?: { examTargetId: string }): Promise<EvidenceRow[]> {
  // G6: an exam-target diagnosis never reads another target's (or unscoped legacy) exam-attempt evidence.
  const result = await client.query(
    `
    SELECT le.id, le.result, le.ai_assistance_type, le.hints_used, le.difficulty, le.score_percent, le."timestamp", le.activity_type, le.metadata
    FROM learning_evidence le
    WHERE le.student_id = $1 AND le.concept_id = $2${scope ? ` AND ${inExamScopeSql('le', '$3')}` : ''}
    ORDER BY le."timestamp" ASC, le.id ASC
    `,
    scope ? [studentId, conceptId, scope.examTargetId] : [studentId, conceptId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    result: row.result,
    aiAssistanceType: row.ai_assistance_type,
    hintsUsed: row.hints_used ?? 0,
    difficulty: Number(row.difficulty),
    scorePercent: row.score_percent === null ? null : Number(row.score_percent),
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
    activityType: row.activity_type,
    metadata: row.metadata ?? null,
  }));
}

/** Re-fetches an EXPLICIT set of (already immutable) evidence ids -- used only for replay certification (task §38), never for a live diagnosis. */
export async function fetchEvidenceByIds(evidenceIds: string[], client: DbExecutor = db): Promise<EvidenceRow[]> {
  if (evidenceIds.length === 0) return [];
  const result = await client.query(
    `
    SELECT id, result, ai_assistance_type, hints_used, difficulty, score_percent, "timestamp", activity_type, metadata
    FROM learning_evidence
    WHERE id = ANY($1::uuid[])
    ORDER BY "timestamp" ASC, id ASC
    `,
    [evidenceIds]
  );
  return result.rows.map((row) => ({
    id: row.id,
    result: row.result,
    aiAssistanceType: row.ai_assistance_type,
    hintsUsed: row.hints_used ?? 0,
    difficulty: Number(row.difficulty),
    scorePercent: row.score_percent === null ? null : Number(row.score_percent),
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
    activityType: row.activity_type,
    metadata: row.metadata ?? null,
  }));
}
