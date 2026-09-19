/**
 * F9 -- post-exam diagnosis (task §31, INV-F9-12). Invokes F8's real
 * runDiagnosis for every distinct (student concept, scope) touched by
 * the attempt -- NEVER a second post-exam classifier.
 */
import { db } from '@/lib/db';
import { resolveActivityMetadataForObjective } from '@/lib/curriculum/activity-metadata-bridge.service';
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import { runDiagnosis, type StoredGapDiagnosis } from '@/lib/diagnostics/diagnosis.service';

export interface PostExamDiagnosisResult {
  diagnoses: StoredGapDiagnosis[];
  knowledgeGaps: string[];
  skillGaps: string[];
  examTechniqueGaps: string[];
  speedFluencyGaps: string[];
  insufficientEvidenceAreas: string[];
}

export async function runPostExamDiagnosis(examAttemptId: string, studentId: string, examVersionId: string): Promise<PostExamDiagnosisResult> {
  const responses = await db.query(
    `SELECT DISTINCT learning_objective_id, assessment_component_id FROM exam_attempt_item_responses WHERE exam_attempt_id = $1 AND learning_objective_id IS NOT NULL`,
    [examAttemptId]
  );

  const diagnoses: StoredGapDiagnosis[] = [];

  for (const row of responses.rows) {
    const bridge = await resolveActivityMetadataForObjective(row.learning_objective_id);
    if (!bridge || bridge.canonicalConceptIds.length === 0) continue;

    let studentConceptId: string | null = null;
    for (const canonicalConceptId of bridge.canonicalConceptIds) {
      studentConceptId = await resolveStudentConceptForCanonicalConcept(studentId, canonicalConceptId);
      if (studentConceptId) break;
    }
    if (!studentConceptId) continue;

    const targetRow = await db.query(
      `SELECT skill_id, command_term_id FROM blueprint_objective_targets WHERE learning_objective_id = $1 AND assessment_component_id = $2 LIMIT 1`,
      [row.learning_objective_id, row.assessment_component_id]
    );
    const skillId = targetRow.rows[0]?.skill_id ?? undefined;
    const commandTermId = targetRow.rows[0]?.command_term_id ?? undefined;

    const diagnosis = await runDiagnosis({
      studentId,
      conceptId: studentConceptId,
      scope: { skillId, learningObjectiveId: row.learning_objective_id, examVersionId, assessmentComponentId: row.assessment_component_id, commandTermId },
    });
    diagnoses.push(diagnosis);
  }

  const knowledgeGaps = diagnoses.filter((d) => d.primaryGapType === 'KNOWLEDGE_GAP' || (d.primaryGapType === 'MIXED' && d.secondarySignals.includes('KNOWLEDGE_GAP'))).map((d) => d.conceptId);
  const skillGaps = diagnoses.filter((d) => d.primaryGapType === 'SKILL_GAP' || (d.primaryGapType === 'MIXED' && d.secondarySignals.includes('SKILL_GAP'))).map((d) => d.conceptId);
  const examTechniqueGaps = diagnoses
    .filter((d) => d.primaryGapType === 'EXAM_TECHNIQUE_GAP' || (d.primaryGapType === 'MIXED' && d.secondarySignals.includes('EXAM_TECHNIQUE_GAP')))
    .map((d) => d.conceptId);
  const speedFluencyGaps = diagnoses
    .filter((d) => d.primaryGapType === 'SPEED_FLUENCY_GAP' || (d.primaryGapType === 'MIXED' && d.secondarySignals.includes('SPEED_FLUENCY_GAP')))
    .map((d) => d.conceptId);
  const insufficientEvidenceAreas = diagnoses.filter((d) => d.primaryGapType === 'INSUFFICIENT_EVIDENCE').map((d) => d.conceptId);

  return { diagnoses, knowledgeGaps, skillGaps, examTechniqueGaps, speedFluencyGaps, insufficientEvidenceAreas };
}
