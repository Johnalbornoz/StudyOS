/**
 * F7 -- Generation Contract (task 25). Resolves inputs a future
 * generation call site would use -- never calls any AI, never touches
 * the existing quiz-generation.service.ts pipeline. Configuration +
 * validators are authority, never the prompt.
 */
import { db } from '@/lib/db';
import { resolveActivityMetadataForObjective } from '@/lib/curriculum/activity-metadata-bridge.service';
import { getObjectiveTarget } from './blueprint.service';
import { getComponent } from './component.service';
import type { GenerationContext } from './types';

export async function resolveGenerationContext(blueprintObjectiveTargetId: string, studentId: string): Promise<GenerationContext> {
  const target = await getObjectiveTarget(blueprintObjectiveTargetId);
  if (!target) throw new Error(`blueprint objective target ${blueprintObjectiveTargetId} not found`);

  const component = await getComponent(target.assessmentComponentId);
  if (!component) throw new Error(`assessment component ${target.assessmentComponentId} not found`);

  // F6's own PUBLISHED-only resolution, reused verbatim -- never
  // re-implemented (INV-F7-06/16). Returns null when nothing PUBLISHED
  // exists; the context then carries empty arrays, never a guess.
  const bridge = await resolveActivityMetadataForObjective(target.learningObjectiveId);

  let commandTerm: GenerationContext['commandTerm'] = null;
  if (target.commandTermId) {
    const row = await db.query(`SELECT id, term FROM command_terms WHERE id = $1`, [target.commandTermId]);
    if (row.rows.length > 0) commandTerm = { id: row.rows[0].id, term: row.rows[0].term };
  }

  return {
    studentId,
    examVersionId: component.examVersionId,
    assessmentComponentId: component.id,
    blueprintObjectiveTargetId,
    learningObjectiveId: target.learningObjectiveId,
    canonicalConceptIds: bridge?.canonicalConceptIds ?? [],
    skillIds: bridge?.skillIds ?? [],
    competencyIds: bridge?.competencyIds ?? [],
    questionType: target.questionType,
    difficultyRange: target.difficultyMin !== null && target.difficultyMax !== null ? { min: target.difficultyMin, max: target.difficultyMax } : null,
    reasoningRequirement: target.reasoningRequirement,
    commandTerm,
    toolContext: { status: component.toolRuleStatus, rules: component.toolRules },
    timingContext: { status: component.timingStatus, durationMinutes: component.durationMinutes },
  };
}
