/**
 * B1 -- the Curriculum Authority's bootstrap boundary.
 *
 * The Curriculum domain is the one owner of organizations, programmes, qualifications, academic subjects,
 * structure versions, structure nodes, learning objectives, the canonical catalogue and the objective
 * mappings. A setup procedure that is NOT the Curriculum Authority -- an exam vertical configuration, a DEV
 * catalogue seed -- may REQUEST that missing curriculum rows exist, and it does so through this module only:
 *
 *   Vertical config -> this boundary -> Curriculum tables
 *
 * Every function is "ensure": look the row up by its natural key and create it only when it is absent, with
 * exactly the statements the callers issued before B1 (same keys, same columns, same order), so an existing
 * configuration materialises exactly as it did. Each takes the caller's executor, so the caller's transaction
 * (and its dry-run ROLLBACK) still governs the write.
 *
 * What this boundary does NOT do: decide exam structure, blueprint targets, mastery or item counts. A row
 * created here on behalf of an exam configuration is bootstrap-origin (`source` / `source_locator` say so);
 * it is not a statement about the real hierarchy of a curriculum.
 */

export type CurriculumExecutor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

async function one(client: CurriculumExecutor, sql: string, params: unknown[]): Promise<any | null> {
  const r = await client.query(sql, params);
  return r.rows[0] ?? null;
}

async function ensure(client: CurriculumExecutor, lookupSql: string, lookupParams: unknown[], insertSql: string, insertParams: unknown[]): Promise<string> {
  const existing = await one(client, lookupSql, lookupParams);
  if (existing) return existing.id;
  return (await one(client, insertSql, insertParams)).id;
}

/* ------------------------------------------------------------------ */
/* Organization -> programme -> qualification -> subject                */
/* ------------------------------------------------------------------ */

export function ensureOrganization(client: CurriculumExecutor, name: string): Promise<string> {
  return ensure(client, `SELECT id FROM academic_organizations WHERE name = $1 ORDER BY created_at LIMIT 1`, [name], `INSERT INTO academic_organizations (name) VALUES ($1) RETURNING id`, [name]);
}

export function ensureProgramme(client: CurriculumExecutor, p: { organizationId: string; name: string; type: string; stage?: string | null }): Promise<string> {
  return ensure(
    client,
    `SELECT id FROM academic_programmes WHERE organization_id = $1 AND name = $2 ORDER BY created_at LIMIT 1`,
    [p.organizationId, p.name],
    `INSERT INTO academic_programmes (organization_id, name, programme_type, stage) VALUES ($1, $2, $3, $4) RETURNING id`,
    [p.organizationId, p.name, p.type, p.stage ?? null]
  );
}

export function ensureQualification(client: CurriculumExecutor, p: { programmeId: string; name: string }): Promise<string> {
  return ensure(
    client,
    `SELECT id FROM academic_qualifications WHERE programme_id = $1 AND name = $2 ORDER BY created_at LIMIT 1`,
    [p.programmeId, p.name],
    `INSERT INTO academic_qualifications (programme_id, name) VALUES ($1, $2) RETURNING id`,
    [p.programmeId, p.name]
  );
}

export function ensureAcademicSubject(client: CurriculumExecutor, p: { programmeId: string; qualificationId: string | null; name: string; level?: string | null }): Promise<string> {
  return ensure(
    client,
    `SELECT id FROM academic_subjects WHERE programme_id = $1 AND qualification_id IS NOT DISTINCT FROM $2 AND name = $3 AND level IS NOT DISTINCT FROM $4 ORDER BY created_at LIMIT 1`,
    [p.programmeId, p.qualificationId, p.name, p.level ?? null],
    `INSERT INTO academic_subjects (programme_id, qualification_id, name, level) VALUES ($1, $2, $3, $4) RETURNING id`,
    [p.programmeId, p.qualificationId, p.name, p.level ?? null]
  );
}

/* ------------------------------------------------------------------ */
/* Structure version -> node -> learning objective                      */
/* ------------------------------------------------------------------ */

/**
 * The structure version with this label for the subject. A new one is PUBLISHED only when the subject has no
 * PUBLISHED version yet (one PUBLISHED per subject); otherwise it is created as DRAFT -- never superseding a
 * version the Curriculum Authority published.
 */
export async function ensureStructureVersion(client: CurriculumExecutor, p: { academicSubjectId: string; versionLabel: string; sourceLocator: string }): Promise<string> {
  const existing = (await one(client, `SELECT id FROM structure_versions WHERE academic_subject_id = $1 AND version_label = $2 LIMIT 1`, [p.academicSubjectId, p.versionLabel]))?.id as string | undefined;
  if (existing) return existing;
  const hasPublished = await one(client, `SELECT 1 FROM structure_versions WHERE academic_subject_id = $1 AND status = 'PUBLISHED'`, [p.academicSubjectId]);
  return (
    await one(client, `INSERT INTO structure_versions (academic_subject_id, version_label, status, source_locator) VALUES ($1, $2, $3, $4) RETURNING id`, [
      p.academicSubjectId,
      p.versionLabel,
      hasPublished ? 'DRAFT' : 'PUBLISHED',
      p.sourceLocator,
    ])
  ).id as string;
}

/** Node type of a grouping an exam configuration asked for: an assessment section, not a curriculum topic. */
export const BOOTSTRAP_ASSESSMENT_NODE_TYPE = 'EXAM_SECTION' as const;

/** A bootstrap-origin assessment grouping node (`EXAM_SECTION`) inside a structure version, keyed by its code. */
export function ensureAssessmentSectionNode(client: CurriculumExecutor, p: { structureVersionId: string; code: string; label: string; orderIndex: number; source: string }): Promise<string> {
  return ensure(
    client,
    `SELECT id FROM structure_nodes WHERE structure_version_id = $1 AND code = $2`,
    [p.structureVersionId, p.code],
    `INSERT INTO structure_nodes (structure_version_id, node_type, source_label, code, order_index, source) VALUES ($1, 'EXAM_SECTION', $2, $3, $4, $5) RETURNING id`,
    [p.structureVersionId, p.label, p.code, p.orderIndex, p.source]
  );
}

export function ensureLearningObjective(client: CurriculumExecutor, p: { structureNodeId: string; code: string; description: string }): Promise<string> {
  return ensure(
    client,
    `SELECT id FROM learning_objectives WHERE structure_node_id = $1 AND code = $2`,
    [p.structureNodeId, p.code],
    `INSERT INTO learning_objectives (structure_node_id, code, description) VALUES ($1, $2, $3) RETURNING id`,
    [p.structureNodeId, p.code, p.description]
  );
}

/* ------------------------------------------------------------------ */
/* Canonical catalogue (curated seeds)                                  */
/* ------------------------------------------------------------------ */

export async function ensureCanonicalSubject(client: CurriculumExecutor, name: string): Promise<{ id: string; created: boolean }> {
  const id = (await client.query(`SELECT id FROM canonical_subjects WHERE lower(name) = lower($1) ORDER BY created_at LIMIT 1`, [name])).rows[0]?.id as string | undefined;
  if (id) return { id, created: false };
  return { id: (await client.query(`INSERT INTO canonical_subjects (name) VALUES ($1) RETURNING id`, [name])).rows[0].id as string, created: true };
}

/** True when the concept was created; false when the subject already has a concept with this name. */
export async function ensureCanonicalConcept(client: CurriculumExecutor, p: { canonicalSubjectId: string; name: string; description: string }): Promise<boolean> {
  const exists = await client.query(`SELECT 1 FROM canonical_concepts WHERE canonical_subject_id = $1 AND lower(name) = lower($2)`, [p.canonicalSubjectId, p.name]);
  if (exists.rows.length) return false;
  await client.query(`INSERT INTO canonical_concepts (canonical_subject_id, name, description, status) VALUES ($1, $2, $3, 'ACTIVE')`, [p.canonicalSubjectId, p.name, p.description]);
  return true;
}

export async function ensureSkill(client: CurriculumExecutor, p: { name: string; type: string; description: string }): Promise<boolean> {
  const exists = await client.query(`SELECT 1 FROM skills WHERE lower(name) = lower($1)`, [p.name]);
  if (exists.rows.length) return false;
  await client.query(`INSERT INTO skills (name, skill_type, description) VALUES ($1, $2, $3)`, [p.name, p.type, p.description]);
  return true;
}

export async function ensureCompetency(client: CurriculumExecutor, p: { code: string; name: string; description: string }): Promise<boolean> {
  const r = await client.query(`INSERT INTO competencies (code, name, description) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING RETURNING id`, [p.code, p.name, p.description]);
  return r.rows.length > 0;
}

/* ------------------------------------------------------------------ */
/* Objective mappings (reviewed links, published)                       */
/* ------------------------------------------------------------------ */

export interface ReviewedMappingActors {
  createdBy: string;
  reviewedBy: string;
}

/** Publishes a reviewed objective -> canonical concept link unless a PUBLISHED one exists. True when created. */
export async function ensurePublishedObjectiveConceptMapping(client: CurriculumExecutor, p: { learningObjectiveId: string; canonicalConceptId: string; rationale: string } & ReviewedMappingActors): Promise<boolean> {
  const r = await client.query(
    `INSERT INTO objective_concept_mappings (learning_objective_id, canonical_concept_id, relation_type, provenance, status, created_by, reviewed_by, reviewed_at, published_at, rationale)
             SELECT $1, $2, 'PARTIAL', 'MANUAL', 'PUBLISHED', $3, $4, now(), now(), $5
              WHERE NOT EXISTS (SELECT 1 FROM objective_concept_mappings WHERE learning_objective_id = $1 AND canonical_concept_id = $2 AND status = 'PUBLISHED')
             RETURNING id`,
    [p.learningObjectiveId, p.canonicalConceptId, p.createdBy, p.reviewedBy, p.rationale]
  );
  return r.rows.length > 0;
}

export async function ensurePublishedObjectiveSkillMapping(client: CurriculumExecutor, p: { learningObjectiveId: string; skillId: string } & ReviewedMappingActors): Promise<boolean> {
  const r = await client.query(
    `INSERT INTO objective_skill_mappings (learning_objective_id, skill_id, relation_type, provenance, status, created_by, reviewed_by, reviewed_at, published_at)
             SELECT $1, $2, 'PARTIAL', 'MANUAL', 'PUBLISHED', $3, $4, now(), now()
              WHERE NOT EXISTS (SELECT 1 FROM objective_skill_mappings WHERE learning_objective_id = $1 AND skill_id = $2 AND status = 'PUBLISHED') RETURNING id`,
    [p.learningObjectiveId, p.skillId, p.createdBy, p.reviewedBy]
  );
  return r.rows.length > 0;
}

export async function ensurePublishedObjectiveCompetencyMapping(client: CurriculumExecutor, p: { learningObjectiveId: string; competencyId: string } & ReviewedMappingActors): Promise<boolean> {
  const r = await client.query(
    `INSERT INTO objective_competency_mappings (learning_objective_id, competency_id, relation_type, provenance, status, created_by, reviewed_by, reviewed_at, published_at)
             SELECT $1, $2, 'PARTIAL', 'MANUAL', 'PUBLISHED', $3, $4, now(), now()
              WHERE NOT EXISTS (SELECT 1 FROM objective_competency_mappings WHERE learning_objective_id = $1 AND competency_id = $2 AND status = 'PUBLISHED') RETURNING id`,
    [p.learningObjectiveId, p.competencyId, p.createdBy, p.reviewedBy]
  );
  return r.rows.length > 0;
}
