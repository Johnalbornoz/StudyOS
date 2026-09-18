/**
 * F4 -- read/write access to the canonical catalog itself (subjects,
 * concepts, skills, competencies, contexts, and their many-to-many
 * junctions). This is shared, cross-student data -- never learner-owned,
 * never gated by F2 authorization or F3 entitlement. Minimal admin/editor
 * surface only (task 19); full editorial workflow is explicitly F6 scope.
 */
import { db } from '@/lib/db';
import type { CanonicalConcept, CanonicalSubject, Competency, Context, Skill, SkillType } from './types';

export async function listCanonicalSubjects(): Promise<CanonicalSubject[]> {
  const result = await db.query(`SELECT id, name, status FROM canonical_subjects ORDER BY name`);
  return result.rows.map((r: any) => ({ id: r.id, name: r.name, status: r.status }));
}

export async function createCanonicalSubject(name: string): Promise<CanonicalSubject> {
  const result = await db.query(
    `INSERT INTO canonical_subjects (name) VALUES ($1) RETURNING id, name, status`,
    [name]
  );
  return result.rows[0];
}

export async function listCanonicalConcepts(canonicalSubjectId: string): Promise<CanonicalConcept[]> {
  const result = await db.query(
    `SELECT id, canonical_subject_id, name, description, level, status
     FROM canonical_concepts WHERE canonical_subject_id = $1 ORDER BY name`,
    [canonicalSubjectId]
  );
  return result.rows.map((r: any) => ({
    id: r.id,
    canonicalSubjectId: r.canonical_subject_id,
    name: r.name,
    description: r.description,
    level: r.level,
    status: r.status,
  }));
}

/**
 * Search candidates by exact case-insensitive name match within a
 * canonical subject -- the same lookup the migration backfill uses.
 * Never a fuzzy/semantic match (INV-F4-04): callers deciding what to do
 * with multiple results must never auto-pick one.
 */
export async function findCanonicalConceptsByExactName(
  canonicalSubjectId: string,
  name: string
): Promise<CanonicalConcept[]> {
  const result = await db.query(
    `SELECT id, canonical_subject_id, name, description, level, status
     FROM canonical_concepts
     WHERE canonical_subject_id = $1 AND lower(trim(name)) = lower(trim($2))`,
    [canonicalSubjectId, name]
  );
  return result.rows.map((r: any) => ({
    id: r.id,
    canonicalSubjectId: r.canonical_subject_id,
    name: r.name,
    description: r.description,
    level: r.level,
    status: r.status,
  }));
}

export async function createCanonicalConcept(params: {
  canonicalSubjectId: string;
  name: string;
  description?: string;
  level?: string;
}): Promise<CanonicalConcept> {
  const result = await db.query(
    `INSERT INTO canonical_concepts (canonical_subject_id, name, description, level)
     VALUES ($1, $2, $3, $4)
     RETURNING id, canonical_subject_id, name, description, level, status`,
    [params.canonicalSubjectId, params.name, params.description ?? null, params.level ?? null]
  );
  const r = result.rows[0];
  return { id: r.id, canonicalSubjectId: r.canonical_subject_id, name: r.name, description: r.description, level: r.level, status: r.status };
}

export async function listSkills(skillType?: SkillType): Promise<Skill[]> {
  const result = skillType
    ? await db.query(`SELECT id, name, skill_type, description, status FROM skills WHERE skill_type = $1 ORDER BY name`, [skillType])
    : await db.query(`SELECT id, name, skill_type, description, status FROM skills ORDER BY name`);
  return result.rows.map((r: any) => ({ id: r.id, name: r.name, skillType: r.skill_type, description: r.description, status: r.status }));
}

export async function listCompetencies(): Promise<Competency[]> {
  const result = await db.query(`SELECT id, code, name, description, sequence, status FROM competencies ORDER BY sequence NULLS LAST`);
  return result.rows.map((r: any) => ({ id: r.id, code: r.code, name: r.name, description: r.description, sequence: r.sequence, status: r.status }));
}

export async function listContexts(): Promise<Context[]> {
  const result = await db.query(`SELECT id, code, name, description, sequence FROM contexts ORDER BY sequence NULLS LAST`);
  return result.rows.map((r: any) => ({ id: r.id, code: r.code, name: r.name, description: r.description, sequence: r.sequence }));
}

export async function attachSkillToConcept(canonicalConceptId: string, skillId: string): Promise<void> {
  await db.query(
    `INSERT INTO canonical_concept_skills (canonical_concept_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [canonicalConceptId, skillId]
  );
}

export async function attachCompetencyToSkill(skillId: string, competencyId: string): Promise<void> {
  await db.query(
    `INSERT INTO skill_competencies (skill_id, competency_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [skillId, competencyId]
  );
}

export async function attachCompetencyToConcept(canonicalConceptId: string, competencyId: string): Promise<void> {
  await db.query(
    `INSERT INTO canonical_concept_competencies (canonical_concept_id, competency_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [canonicalConceptId, competencyId]
  );
}

export async function getSkillsForConcept(canonicalConceptId: string): Promise<Skill[]> {
  const result = await db.query(
    `SELECT s.id, s.name, s.skill_type, s.description, s.status
     FROM skills s JOIN canonical_concept_skills ccs ON ccs.skill_id = s.id
     WHERE ccs.canonical_concept_id = $1 ORDER BY s.name`,
    [canonicalConceptId]
  );
  return result.rows.map((r: any) => ({ id: r.id, name: r.name, skillType: r.skill_type, description: r.description, status: r.status }));
}

export async function getCompetenciesForSkill(skillId: string): Promise<Competency[]> {
  const result = await db.query(
    `SELECT c.id, c.code, c.name, c.description, c.sequence, c.status
     FROM competencies c JOIN skill_competencies sc ON sc.competency_id = c.id
     WHERE sc.skill_id = $1 ORDER BY c.sequence NULLS LAST`,
    [skillId]
  );
  return result.rows.map((r: any) => ({ id: r.id, code: r.code, name: r.name, description: r.description, sequence: r.sequence, status: r.status }));
}

export async function getConceptsForSkill(skillId: string): Promise<CanonicalConcept[]> {
  const result = await db.query(
    `SELECT cc.id, cc.canonical_subject_id, cc.name, cc.description, cc.level, cc.status
     FROM canonical_concepts cc JOIN canonical_concept_skills ccs ON ccs.canonical_concept_id = cc.id
     WHERE ccs.skill_id = $1 ORDER BY cc.name`,
    [skillId]
  );
  return result.rows.map((r: any) => ({
    id: r.id,
    canonicalSubjectId: r.canonical_subject_id,
    name: r.name,
    description: r.description,
    level: r.level,
    status: r.status,
  }));
}
