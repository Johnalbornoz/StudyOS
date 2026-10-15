/**
 * Exam Readiness evidence (IO) -- the EXAM_ASSESSMENT stream, separated from the Learning Knowledge State.
 *
 *   LEARNING + INTERNAL_ASSESSMENT -> Knowledge State (updateMastery)       -- unchanged
 *   EXAM_ASSESSMENT                -> Exam Readiness (exam_readiness_evidence) -- this module
 *
 * The writer records every response of a completed exam attempt against the item's PRIMARY canonical concept and
 * its exam context. It needs no learner concept, plan entry or route, so an off-plan concept gets exam evidence too,
 * and it never creates one. Idempotent on (response, concept): a replayed completion writes nothing new.
 *
 * Separation mode (`EXAM_EVIDENCE_KNOWLEDGE_STATE`):
 *   SEPARATED (default)  exam responses do NOT reach updateMastery (canonical loop and legacy simulation path)
 *   LEGACY               the previous behaviour (exam responses also update the Knowledge State) -- operator rollback
 * Exam evidence is written to Exam Readiness in BOTH modes (dual-write), so turning separation off loses nothing.
 * Staged design: docs/audits/exam-bank/EXAM_READINESS_SEPARATION_AUDIT.md section 5 (S1 table, S2 writer, S3 reader,
 * S4 cut). Historical Knowledge State rows are never deleted.
 */
import { db } from '@/lib/db';

export type ExamEvidenceKnowledgeStateMode = 'SEPARATED' | 'LEGACY';
export const examEvidenceKnowledgeStateMode = (): ExamEvidenceKnowledgeStateMode => (process.env.EXAM_EVIDENCE_KNOWLEDGE_STATE === 'LEGACY' ? 'LEGACY' : 'SEPARATED');

export type RecordOutcome = { ok: true; written: number; responses: number } | { ok: false; reason: 'TABLE_ABSENT' | 'ATTEMPT_NOT_FOUND' };

/** Records the Exam Readiness evidence of one completed attempt (simulation attempt id), from its stored responses. */
export async function recordExamReadinessEvidence(simulationAttemptId: string, studentId: string): Promise<RecordOutcome> {
  const attempt = await db.query(
    // attribution (F7): the SYSTEM of the evidence is the exam the Student sat (its definition's family); the exam target
    // is the instance's preparation, else the attempt's own
    `SELECT sa.exam_attempt_id, ea.exam_version_id, COALESCE(ei.exam_profile_id, sa.exam_profile_id) AS exam_target_id, d.exam_family AS exam_system_id
       FROM simulation_attempts sa
       JOIN exam_attempts ea ON ea.id = sa.exam_attempt_id
       LEFT JOIN exam_instances ei ON ei.simulation_attempt_id = sa.id
       LEFT JOIN exam_versions v ON v.id = ea.exam_version_id
       LEFT JOIN exam_definitions d ON d.id = v.exam_definition_id
      WHERE sa.id = $1 AND sa.student_id = $2`,
    [simulationAttemptId, studentId],
  );
  const a = attempt.rows[0];
  if (!a?.exam_attempt_id) return { ok: false, reason: 'ATTEMPT_NOT_FOUND' };
  try {
    const r = await db.query(
      `INSERT INTO exam_readiness_evidence (student_id, exam_attempt_id, response_id, approved_item_id, exam_version_id, exam_target_id, system_id, learning_objective_id,
                                            blueprint_bucket_id, canonical_concept_id, canonical_concept_stable_id, status, score, max_score, fraction, independent, occurred_at)
       SELECT $1, r.exam_attempt_id, r.id, r.approved_item_id, $3, $4, COALESCE($5, i.system_id, pic.system_id), ai.learning_objective_id,
              COALESCE(i.blueprint_bucket_id, pic.blueprint_bucket), qc.canonical_concept_id, i.primary_concept_stable_id, s.status,
              CASE WHEN s.status = 'SCORED' THEN r.score END, CASE WHEN s.status = 'SCORED' THEN r.max_score END,
              CASE WHEN s.status = 'SCORED' THEN LEAST(1, GREATEST(0, r.score / r.max_score)) END,
              s.status = 'SCORED', r.created_at
         FROM exam_attempt_item_responses r
         JOIN approved_items ai ON ai.id = r.approved_item_id
         LEFT JOIN question_bank_items qi ON qi.id = ai.bank_item_id
         LEFT JOIN assessment_item_instances i ON i.id = qi.item_instance_id
         LEFT JOIN exam_bank_pilot_item_certifications pic ON pic.approved_item_id = ai.id
         LEFT JOIN question_bank_item_concepts qc ON qc.approved_item_id = ai.id AND qc.role = 'PRIMARY'
         CROSS JOIN LATERAL (SELECT CASE
                WHEN r.review_status = 'REVIEW_REQUIRED' THEN 'PENDING_REVIEW'
                WHEN (r.grading_detail->'coach'->>'assisted') = 'true' THEN 'ASSISTED'
                WHEN r.score IS NULL OR r.max_score IS NULL OR r.max_score <= 0 THEN 'UNANSWERED'
                ELSE 'SCORED' END AS status) s
        WHERE r.exam_attempt_id = $2 AND (qc.canonical_concept_id IS NOT NULL OR i.primary_concept_stable_id IS NOT NULL)
       ON CONFLICT DO NOTHING`,
      [studentId, a.exam_attempt_id, a.exam_version_id ?? null, a.exam_target_id ?? null, a.exam_system_id ?? null],
    );
    const total = await db.query(`SELECT count(*)::int AS n FROM exam_attempt_item_responses WHERE exam_attempt_id = $1`, [a.exam_attempt_id]);
    return { ok: true, written: r.rowCount ?? 0, responses: Number(total.rows[0]?.n ?? 0) };
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return { ok: false, reason: 'TABLE_ABSENT' };
    throw e;
  }
}

export interface ExamReadinessCell {
  canonicalConceptStableId: string | null;
  canonicalConceptId: string | null;
  systemId: string | null;
  blueprintBucketId: string | null;
  attempts: number;
  independentAttempts: number;
  independentCorrect: number;
  meanFraction: number | null;
  lastAt: string | null;
}
/** S3 reader: a Student's Exam Readiness, per concept and bucket (optionally for one exam version). Owner-scoped by the caller. */
export async function examReadinessOf(studentId: string, examVersionId?: string): Promise<ExamReadinessCell[]> {
  const r = await db.query(
    `SELECT canonical_concept_stable_id, canonical_concept_id, system_id, blueprint_bucket_id,
            count(*)::int AS attempts, count(*) FILTER (WHERE independent)::int AS independent_attempts,
            count(*) FILTER (WHERE independent AND fraction >= 1)::int AS independent_correct,
            avg(fraction) FILTER (WHERE status = 'SCORED') AS mean_fraction, max(occurred_at) AS last_at
       FROM exam_readiness_evidence
      WHERE student_id = $1 AND ($2::uuid IS NULL OR exam_version_id = $2::uuid)
      GROUP BY 1, 2, 3, 4 ORDER BY 1, 4`,
    [studentId, examVersionId ?? null],
  ).catch((e: { code?: string }) => { if (e?.code === '42P01') return { rows: [] as any[] }; throw e; });
  return r.rows.map((x: any) => ({ canonicalConceptStableId: x.canonical_concept_stable_id, canonicalConceptId: x.canonical_concept_id, systemId: x.system_id, blueprintBucketId: x.blueprint_bucket_id, attempts: x.attempts, independentAttempts: x.independent_attempts, independentCorrect: x.independent_correct, meanFraction: x.mean_fraction === null ? null : Number(x.mean_fraction), lastAt: x.last_at ? new Date(x.last_at).toISOString() : null }));
}
