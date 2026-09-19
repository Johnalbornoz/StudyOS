/**
 * F9 -- Blueprint Evidence Coverage (task §10). Genuinely different
 * from F6's coverage_policy_versions/computeMappingCoverage (curriculum
 * mapping completeness, never student-scoped) -- see
 * F9_BLUEPRINT_EVIDENCE_COVERAGE.md. Never treats an
 * UNSUPPORTED_BY_PLATFORM or UNMAPPED target as learner weakness
 * (INV-F9-05) -- both are excluded from the denominator of any exposed
 * percentage entirely.
 */
import { db } from '@/lib/db';
import { getComponent } from '@/lib/assessment/component.service';
import { resolveActivityMetadataForObjective } from '@/lib/curriculum/activity-metadata-bridge.service';
import { runDiagnosis } from '@/lib/diagnostics/diagnosis.service';
import { resolveStudentConceptForCanonicalConcept } from './student-concept-resolution.service';
import type { BlueprintTargetCoverage, BlueprintCoverageSummary } from './types';
import type { BlueprintObjectiveTarget } from '@/lib/assessment/types';

export async function classifyBlueprintTargetCoverage(
  target: BlueprintObjectiveTarget,
  studentId: string,
  examVersionId: string
): Promise<BlueprintTargetCoverage> {
  const component = await getComponent(target.assessmentComponentId);
  if (!component || component.supportStatus !== 'SUPPORTED') {
    return { targetId: target.id, status: 'UNSUPPORTED_BY_PLATFORM', reasonCodes: ['COMPONENT_UNSUPPORTED'], studentConceptId: null, diagnosisId: null };
  }

  const bridge = await resolveActivityMetadataForObjective(target.learningObjectiveId);
  if (!bridge || (bridge.canonicalConceptIds.length === 0 && bridge.skillIds.length === 0)) {
    return { targetId: target.id, status: 'UNMAPPED', reasonCodes: ['NO_PUBLISHED_MAPPING'], studentConceptId: null, diagnosisId: null };
  }

  let studentConceptId: string | null = null;
  for (const canonicalConceptId of bridge.canonicalConceptIds) {
    studentConceptId = await resolveStudentConceptForCanonicalConcept(studentId, canonicalConceptId);
    if (studentConceptId) break;
  }
  if (!studentConceptId) {
    return { targetId: target.id, status: 'SUPPORTED_BUT_UNEVIDENCED', reasonCodes: ['NO_MATCHED_STUDENT_CONCEPT'], studentConceptId: null, diagnosisId: null };
  }

  const evidenceCheck = await db.query(`SELECT 1 FROM learning_evidence WHERE student_id = $1 AND concept_id = $2 LIMIT 1`, [studentId, studentConceptId]);
  if (evidenceCheck.rows.length === 0) {
    return { targetId: target.id, status: 'SUPPORTED_BUT_UNEVIDENCED', reasonCodes: ['NO_EVIDENCE_YET'], studentConceptId, diagnosisId: null };
  }

  const diagnosis = await runDiagnosis({
    studentId,
    conceptId: studentConceptId,
    scope: {
      skillId: target.skillId ?? undefined,
      learningObjectiveId: target.learningObjectiveId,
      examVersionId,
      assessmentComponentId: target.assessmentComponentId,
      commandTermId: target.commandTermId ?? undefined,
    },
  });

  return { targetId: target.id, status: 'SUPPORTED_AND_EVIDENCED', reasonCodes: [], studentConceptId, diagnosisId: diagnosis.id };
}

export function summarizeBlueprintCoverage(targets: BlueprintTargetCoverage[]): BlueprintCoverageSummary {
  const supportedAndEvidenced = targets.filter((t) => t.status === 'SUPPORTED_AND_EVIDENCED').length;
  const supportedButUnevidenced = targets.filter((t) => t.status === 'SUPPORTED_BUT_UNEVIDENCED').length;
  const unsupportedByPlatform = targets.filter((t) => t.status === 'UNSUPPORTED_BY_PLATFORM').length;
  const unmapped = targets.filter((t) => t.status === 'UNMAPPED').length;
  const notRequired = targets.filter((t) => t.status === 'NOT_REQUIRED').length;

  const denominator = targets.length - unsupportedByPlatform - notRequired;
  const evidencedFraction = denominator > 0 ? supportedAndEvidenced / denominator : null;

  return { totalTargets: targets.length, supportedAndEvidenced, supportedButUnevidenced, unsupportedByPlatform, unmapped, notRequired, evidencedFraction, targets };
}
