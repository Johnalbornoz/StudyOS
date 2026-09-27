/**
 * LEARNING_ACTIVITY_DELIVERY -- the inputs of an activity contract that
 * live in the database: the learner's academic context for the subject and
 * the learner-state snapshot a per-learner preparation depends on.
 * Two small indexed reads; no AI.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { AcademicContext, LearnerStateSnapshot } from '@/lib/activity-delivery/contract';
import { NO_ACADEMIC_CONTEXT } from '@/lib/activity-delivery/contract';

export async function loadAcademicContext(studentId: string, subjectId: string, client: DbExecutor = db): Promise<AcademicContext> {
  const r = await client.query(
    `SELECT s.ib_programme, s.ib_subject_group, s.ib_level, p.curriculum_type, p.ib_year
       FROM subjects s
       LEFT JOIN student_academic_profile p ON p.student_id = s.student_id
      WHERE s.id = $1 AND s.student_id = $2`,
    [subjectId, studentId],
  );
  const row = r.rows[0];
  if (!row) return NO_ACADEMIC_CONTEXT;
  return {
    curriculum: row.curriculum_type ?? null,
    programme: row.ib_programme ?? 'none',
    year: row.ib_year ?? null,
    subjectGroup: row.ib_subject_group ?? null,
    level: row.ib_level ?? null,
  };
}

export async function loadLearnerStateSnapshot(studentId: string, conceptId: string, client: DbExecutor = db): Promise<LearnerStateSnapshot> {
  const r = await client.query(
    `SELECT
       (SELECT count(*)::int FROM learning_evidence WHERE student_id = $1 AND concept_id = $2) AS evidence_count,
       (SELECT id::text FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 ORDER BY timestamp DESC, id DESC LIMIT 1) AS last_evidence_id,
       (SELECT COALESCE(sum(hints_used), 0)::int FROM learning_evidence WHERE student_id = $1 AND concept_id = $2) AS hints_used,
       (SELECT count(*)::int FROM student_misconceptions sm JOIN misconception_signatures ms ON ms.id = sm.misconception_signature_id
         WHERE sm.student_id = $1 AND ms.concept_id = $2 AND ms.is_critical = true AND sm.status = 'ACTIVE') AS critical_misconceptions`,
    [studentId, conceptId],
  );
  const row = r.rows[0] ?? {};
  return {
    evidenceCount: Number(row.evidence_count ?? 0),
    lastEvidenceId: row.last_evidence_id ?? null,
    criticalMisconceptions: Number(row.critical_misconceptions ?? 0),
    hintsUsed: Number(row.hints_used ?? 0),
  };
}
