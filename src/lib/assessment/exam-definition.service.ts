/**
 * F7 -- Exam Definition / Exam Version / Scoring Model (task 5/6/16).
 * No exam-family branching anywhere in this file -- PAA/IB/Cambridge are
 * rows, distinguished only by `examFamily`/`name`/config data.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { ExamDefinition, ExamVersion, ScoringModel, ScoringType } from './types';

function toDefinition(r: any): ExamDefinition {
  return { id: r.id, academicProgrammeId: r.academic_programme_id, name: r.name, examFamily: r.exam_family, purpose: r.purpose, domains: r.domains, status: r.status };
}
function toVersion(r: any): ExamVersion {
  return {
    id: r.id,
    examDefinitionId: r.exam_definition_id,
    versionLabel: r.version_label,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    navigationRules: r.navigation_rules,
    scoringModelId: r.scoring_model_id,
    supportedModalities: r.supported_modalities,
    status: r.status,
  };
}
function toScoringModel(r: any): ScoringModel {
  return { id: r.id, name: r.name, scoringType: r.scoring_type, config: r.config, status: r.status };
}

export async function createExamDefinition(params: { academicProgrammeId?: string; name: string; examFamily: string; purpose?: string; domains?: string[] }): Promise<ExamDefinition> {
  const result = await db.query(
    `INSERT INTO exam_definitions (academic_programme_id, name, exam_family, purpose, domains, status)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE') RETURNING *`,
    [params.academicProgrammeId ?? null, params.name, params.examFamily, params.purpose ?? null, params.domains ?? null]
  );
  return toDefinition(result.rows[0]);
}

export async function createScoringModel(params: { name: string; scoringType: ScoringType; config?: Record<string, unknown> }): Promise<ScoringModel> {
  const result = await db.query(
    `INSERT INTO scoring_models (name, scoring_type, config, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING *`,
    [params.name, params.scoringType, params.config ? JSON.stringify(params.config) : null]
  );
  return toScoringModel(result.rows[0]);
}

export async function createExamVersion(params: {
  examDefinitionId: string;
  versionLabel: string;
  effectiveFrom?: string;
  scoringModelId?: string;
  supportedModalities?: string[];
}): Promise<ExamVersion> {
  const result = await db.query(
    `INSERT INTO exam_versions (exam_definition_id, version_label, effective_from, scoring_model_id, supported_modalities)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [params.examDefinitionId, params.versionLabel, params.effectiveFrom ?? null, params.scoringModelId ?? null, params.supportedModalities ?? null]
  );
  return toVersion(result.rows[0]);
}

/** Publishing atomically supersedes whatever was previously PUBLISHED for the same exam definition -- never deletes it (INV-F7-04, task adversarial case J/L). */
export async function publishExamVersion(examVersionId: string): Promise<ExamVersion> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(`SELECT exam_definition_id, status FROM exam_versions WHERE id = $1`, [examVersionId]);
    if (current.rows.length === 0) throw new Error(`exam version ${examVersionId} not found`);
    if (current.rows[0].status !== 'DRAFT') throw new Error(`only a DRAFT exam version may be published (current: ${current.rows[0].status})`);
    await client.query(`UPDATE exam_versions SET status = 'SUPERSEDED', updated_at = now() WHERE exam_definition_id = $1 AND status = 'PUBLISHED'`, [current.rows[0].exam_definition_id]);
    const updated = await client.query(`UPDATE exam_versions SET status = 'PUBLISHED', updated_at = now() WHERE id = $1 RETURNING *`, [examVersionId]);
    await client.query('COMMIT');
    return toVersion(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getExamVersion(examVersionId: string, client: DbExecutor = db): Promise<ExamVersion | null> {
  const result = await client.query(`SELECT * FROM exam_versions WHERE id = $1`, [examVersionId]);
  return result.rows.length === 0 ? null : toVersion(result.rows[0]);
}

export async function getPublishedExamVersion(examDefinitionId: string): Promise<ExamVersion | null> {
  const result = await db.query(`SELECT * FROM exam_versions WHERE exam_definition_id = $1 AND status = 'PUBLISHED'`, [examDefinitionId]);
  return result.rows.length === 0 ? null : toVersion(result.rows[0]);
}

/**
 * F14 -- the Student Exam Prep UX needs the definition's own display
 * name (task section 4); no reader for a single definition existed
 * yet, only the create/write path.
 */
export async function getExamDefinition(examDefinitionId: string, client: DbExecutor = db): Promise<ExamDefinition | null> {
  const result = await client.query(`SELECT * FROM exam_definitions WHERE id = $1`, [examDefinitionId]);
  return result.rows.length === 0 ? null : toDefinition(result.rows[0]);
}

export interface AvailableExamOption {
  examDefinitionId: string;
  examDefinitionName: string;
  examFamily: string;
  purpose: string | null;
  examVersionId: string;
  versionLabel: string;
}

/**
 * Student-safe catalog for creating an Exam Profile. Only ACTIVE
 * definitions with their currently PUBLISHED version are selectable;
 * internal/draft ids never reach the form.
 */
export async function listAvailableExamOptions(client: DbExecutor = db): Promise<AvailableExamOption[]> {
  const result = await client.query(
    `SELECT d.id AS exam_definition_id,
            d.name AS exam_definition_name,
            d.exam_family,
            d.purpose,
            v.id AS exam_version_id,
            v.version_label
       FROM exam_definitions d
       JOIN exam_versions v
         ON v.exam_definition_id = d.id
        AND v.status = 'PUBLISHED'
      WHERE d.status = 'ACTIVE'
      ORDER BY d.name ASC, v.version_label ASC`
  );
  return result.rows.map((r: any) => ({
    examDefinitionId: r.exam_definition_id,
    examDefinitionName: r.exam_definition_name,
    examFamily: r.exam_family,
    purpose: r.purpose,
    examVersionId: r.exam_version_id,
    versionLabel: r.version_label,
  }));
}
