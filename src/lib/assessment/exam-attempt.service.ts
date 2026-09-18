/**
 * F7 -- Exam Attempt (task 30). Freezes exam_version/blueprint/policy/
 * scoring_model by explicit FK PLUS a full config snapshot -- once
 * started, later configuration changes (a new exam version published, a
 * mapping retired, a policy updated) never rewrite this attempt
 * (INV-F7-04/30, adversarial case J).
 */
import { db } from '@/lib/db';
import { getExamVersion } from './exam-definition.service';
import { listComponentsForVersion } from './component.service';
import { getBlueprintForVersion, listObjectiveTargets } from './blueprint.service';
import type { ExamAttempt } from './types';

function toAttempt(r: any): ExamAttempt {
  return {
    id: r.id,
    studentExamProfileId: r.student_exam_profile_id,
    examVersionId: r.exam_version_id,
    blueprintId: r.blueprint_id,
    institutionExamPolicyId: r.institution_exam_policy_id,
    scoringModelId: r.scoring_model_id,
    frozenConfiguration: r.frozen_configuration,
    status: r.status,
  };
}

export async function startExamAttempt(params: { studentExamProfileId: string; examVersionId: string; institutionExamPolicyId?: string }): Promise<ExamAttempt> {
  const examVersion = await getExamVersion(params.examVersionId);
  if (!examVersion) throw new Error(`exam version ${params.examVersionId} not found`);

  const [components, blueprint] = await Promise.all([listComponentsForVersion(params.examVersionId), getBlueprintForVersion(params.examVersionId)]);
  const objectiveTargets = blueprint ? await listObjectiveTargets(blueprint.id) : [];

  // The actual immutability guarantee: a full, self-contained snapshot of
  // everything this attempt depends on, captured at the exact moment of
  // starting -- independent of whatever these rows say later.
  const frozenConfiguration = {
    examVersion,
    components,
    blueprint,
    objectiveTargets,
    frozenAt: new Date().toISOString(),
  };

  const result = await db.query(
    `INSERT INTO exam_attempts (student_exam_profile_id, exam_version_id, blueprint_id, institution_exam_policy_id, scoring_model_id, frozen_configuration)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [params.studentExamProfileId, params.examVersionId, blueprint?.id ?? null, params.institutionExamPolicyId ?? null, examVersion.scoringModelId, JSON.stringify(frozenConfiguration)]
  );
  return toAttempt(result.rows[0]);
}

export async function completeExamAttempt(examAttemptId: string): Promise<ExamAttempt> {
  const result = await db.query(`UPDATE exam_attempts SET status = 'COMPLETED', completed_at = now() WHERE id = $1 AND status = 'IN_PROGRESS' RETURNING *`, [examAttemptId]);
  if (result.rows.length === 0) throw new Error(`exam attempt ${examAttemptId} could not be completed from its current status`);
  return toAttempt(result.rows[0]);
}

export async function getExamAttempt(examAttemptId: string): Promise<ExamAttempt | null> {
  const result = await db.query(`SELECT * FROM exam_attempts WHERE id = $1`, [examAttemptId]);
  return result.rows.length === 0 ? null : toAttempt(result.rows[0]);
}
