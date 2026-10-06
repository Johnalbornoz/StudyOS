/**
 * Exam V2 -- persistence of independent assessments (section 24).
 * One row per assessor role, linked to a response or a submission. Rows are
 * append-only audit records: a later human review adds a row, never edits one.
 */
import { db } from '@/lib/db';
import type { RubricAssessment } from './double-assessor.service';

export async function recordAssessments(target: { responseId?: string; submissionId?: string }, assessments: RubricAssessment[], rubricRef: string | null): Promise<number> {
  if (!target.responseId && !target.submissionId) throw new Error('ASSESSMENT_TARGET_REQUIRED');
  let n = 0;
  for (const a of assessments) {
    await db.query(
      `INSERT INTO exam_response_assessments
         (response_id, submission_id, role, provider, model, prompt_id, prompt_version, rubric_ref, criterion_scores, total, max_total, confidence, rationale, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        target.responseId ?? null,
        target.submissionId ?? null,
        a.role,
        a.model ? 'openai' : null,
        a.model,
        a.promptId,
        a.promptVersion,
        rubricRef,
        JSON.stringify(a.criterionScores),
        a.total,
        a.maxTotal,
        a.confidence,
        a.rationale || null,
        JSON.stringify(a.evidence),
      ]
    );
    n++;
  }
  return n;
}
