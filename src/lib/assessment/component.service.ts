/**
 * F7 -- Assessment Component (task 7). timing_status/tool_rule_status
 * are explicit -- an unconfigured status must never carry rule/duration
 * data (enforced by DB CHECK constraints too, this is the service-level
 * mirror). Never invented when unknown (INV-F7-08/09).
 */
import { db } from '@/lib/db';
import type { AssessmentComponent, ComponentType } from './types';

function toComponent(r: any): AssessmentComponent {
  return {
    id: r.id,
    examVersionId: r.exam_version_id,
    name: r.name,
    componentType: r.component_type,
    modality: r.modality,
    academicSubjectId: r.academic_subject_id,
    timingStatus: r.timing_status,
    durationMinutes: r.duration_minutes,
    toolRuleStatus: r.tool_rule_status,
    toolRules: r.tool_rules,
    procedureRequired: r.procedure_required,
    simulationCapable: r.simulation_capable,
    supportStatus: r.support_status,
  };
}

export async function createComponent(params: {
  examVersionId: string;
  name: string;
  componentType: ComponentType;
  modality?: string;
  academicSubjectId?: string;
  procedureRequired?: boolean;
}): Promise<AssessmentComponent> {
  const result = await db.query(
    `INSERT INTO assessment_components (exam_version_id, name, component_type, modality, academic_subject_id, procedure_required)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [params.examVersionId, params.name, params.componentType, params.modality ?? null, params.academicSubjectId ?? null, params.procedureRequired ?? false]
  );
  return toComponent(result.rows[0]);
}

export async function configureTiming(componentId: string, durationMinutes: number): Promise<AssessmentComponent> {
  const result = await db.query(
    `UPDATE assessment_components SET timing_status = 'CONFIGURED', duration_minutes = $2 WHERE id = $1 RETURNING *`,
    [componentId, durationMinutes]
  );
  if (result.rows.length === 0) throw new Error(`component ${componentId} not found`);
  return toComponent(result.rows[0]);
}

export async function configureToolRules(componentId: string, toolRules: Record<string, unknown>): Promise<AssessmentComponent> {
  const result = await db.query(
    `UPDATE assessment_components SET tool_rule_status = 'CONFIGURED', tool_rules = $2 WHERE id = $1 RETURNING *`,
    [componentId, JSON.stringify(toolRules)]
  );
  if (result.rows.length === 0) throw new Error(`component ${componentId} not found`);
  return toComponent(result.rows[0]);
}

export async function markSupported(componentId: string, simulationCapable = true): Promise<AssessmentComponent> {
  const result = await db.query(
    `UPDATE assessment_components SET support_status = 'SUPPORTED', simulation_capable = $2 WHERE id = $1 RETURNING *`,
    [componentId, simulationCapable]
  );
  if (result.rows.length === 0) throw new Error(`component ${componentId} not found`);
  return toComponent(result.rows[0]);
}

export async function getComponent(componentId: string): Promise<AssessmentComponent | null> {
  const result = await db.query(`SELECT * FROM assessment_components WHERE id = $1`, [componentId]);
  return result.rows.length === 0 ? null : toComponent(result.rows[0]);
}

export async function listComponentsForVersion(examVersionId: string): Promise<AssessmentComponent[]> {
  const result = await db.query(`SELECT * FROM assessment_components WHERE exam_version_id = $1`, [examVersionId]);
  return result.rows.map(toComponent);
}
