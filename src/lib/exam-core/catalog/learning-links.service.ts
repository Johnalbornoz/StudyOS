/**
 * Exam V2 -- persistence of the Exam -> Learning links, and "Reforzar ahora".
 *
 *   applyDevLearningCatalog  DEV-only operator step: inserts the curated,
 *                            reviewed catalogue rows (dev-learning-catalog.ts)
 *                            that do not exist yet. Never AI-generated.
 *   applyObjectiveLearningLinks  publishes objective -> concept / skill /
 *                            competency mappings, ONLY to rows that exist.
 *   addConceptToStudentLearning  "Reforzar ahora" for a mapped canonical concept
 *                            the Student does not study yet: creates the
 *                            Student's own subject/concept through the normal
 *                            catalogue-mapping path (concept_catalog_mapping),
 *                            so the concept page opens the regular Learning
 *                            Engine (Explain -> Practice -> Prove -> Retain -> Transfer).
 */
import type { PoolClient } from 'pg';
import { db } from '@/lib/db';
import { ensureCatalogMapping } from '@/lib/catalog/mapping.service';
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import { assertResetAllowed } from '../dev-fixture-reset';
import { DEV_CANONICAL_CONCEPTS, DEV_COMPETENCIES, DEV_SKILLS, DEV_CATALOG_LABEL } from './dev-learning-catalog';
import { allLearningLinks } from './objective-learning-links';

export async function applyDevLearningCatalog(options: { write: boolean; confirm: string }): Promise<{ subjects: number; concepts: number; skills: number; competencies: number }> {
  // Same guard as the DEV fixture reset: DEV database only, never production.
  assertResetAllowed(options.confirm === 'APPLY-DEV-LEARNING-CATALOG' ? 'RESET-DEV-FIXTURES' : 'no');
  const client = await db.connect();
  const created = { subjects: 0, concepts: 0, skills: 0, competencies: 0 };
  try {
    await client.query('BEGIN');
    const subjectIds = new Map<string, string>();
    for (const name of [...new Set(DEV_CANONICAL_CONCEPTS.map((x) => x.subject))]) {
      let id = (await client.query(`SELECT id FROM canonical_subjects WHERE lower(name) = lower($1) ORDER BY created_at LIMIT 1`, [name])).rows[0]?.id;
      if (!id) {
        id = (await client.query(`INSERT INTO canonical_subjects (name) VALUES ($1) RETURNING id`, [name])).rows[0].id;
        created.subjects++;
      }
      subjectIds.set(name, id);
    }
    for (const cpt of DEV_CANONICAL_CONCEPTS) {
      const sid = subjectIds.get(cpt.subject)!;
      const exists = await client.query(`SELECT 1 FROM canonical_concepts WHERE canonical_subject_id = $1 AND lower(name) = lower($2)`, [sid, cpt.name]);
      if (exists.rows.length) continue;
      await client.query(`INSERT INTO canonical_concepts (canonical_subject_id, name, description, status) VALUES ($1, $2, $3, 'ACTIVE')`, [sid, cpt.name, DEV_CATALOG_LABEL]);
      created.concepts++;
    }
    for (const sk of DEV_SKILLS) {
      const exists = await client.query(`SELECT 1 FROM skills WHERE lower(name) = lower($1)`, [sk.name]);
      if (exists.rows.length) continue;
      await client.query(`INSERT INTO skills (name, skill_type, description) VALUES ($1, $2, $3)`, [sk.name, sk.type, DEV_CATALOG_LABEL]);
      created.skills++;
    }
    for (const cp of DEV_COMPETENCIES) {
      const r = await client.query(`INSERT INTO competencies (code, name, description) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING RETURNING id`, [cp.code, cp.name, DEV_CATALOG_LABEL]);
      created.competencies += r.rows.length;
    }
    await client.query(options.write ? 'COMMIT' : 'ROLLBACK');
    return created;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function systemActors(client: Pick<PoolClient, 'query'>): Promise<[string, string]> {
  const r = await client.query(`SELECT id FROM users WHERE is_system = true ORDER BY created_at ASC, id ASC LIMIT 2`);
  if (r.rows.length < 2) throw new Error('NO_SYSTEM_IDENTITIES');
  return [r.rows[0].id, r.rows[1].id];
}

/** Publishes the reviewed links for every objective code found in PUBLISHED V2 versions. Idempotent. */
export async function applyObjectiveLearningLinks(options: { write: boolean }): Promise<{ concepts: number; skills: number; competencies: number; missingTargets: string[] }> {
  const client = await db.connect();
  const out = { concepts: 0, skills: 0, competencies: 0, missingTargets: [] as string[] };
  try {
    await client.query('BEGIN');
    const [creator, reviewer] = await systemActors(client);
    for (const [code, link] of Object.entries(allLearningLinks())) {
      const objectives = (
        await client.query(
          `SELECT DISTINCT lo.id FROM learning_objectives lo
             JOIN blueprint_objective_targets t ON t.learning_objective_id = lo.id
             JOIN assessment_blueprints b ON b.id = t.blueprint_id
             JOIN exam_versions v ON v.id = b.exam_version_id AND v.status = 'PUBLISHED'
            WHERE lo.code = $1`,
          [code]
        )
      ).rows.map((r: any) => r.id as string);
      if (objectives.length === 0) continue;
      for (const cpt of link.concepts ?? []) {
        const cc = (
          await client.query(
            `SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id
              WHERE lower(cs.name) = lower($1) AND lower(cc.name) = lower($2) AND cc.status = 'ACTIVE' LIMIT 1`,
            [cpt.subject, cpt.name]
          )
        ).rows[0];
        if (!cc) {
          out.missingTargets.push(`concept:${cpt.subject}/${cpt.name}`);
          continue;
        }
        for (const lo of objectives) {
          const r = await client.query(
            `INSERT INTO objective_concept_mappings (learning_objective_id, canonical_concept_id, relation_type, provenance, status, created_by, reviewed_by, reviewed_at, published_at, rationale)
             SELECT $1, $2, 'PARTIAL', 'MANUAL', 'PUBLISHED', $3, $4, now(), now(), 'Exam V2 reviewed objective link'
              WHERE NOT EXISTS (SELECT 1 FROM objective_concept_mappings WHERE learning_objective_id = $1 AND canonical_concept_id = $2 AND status = 'PUBLISHED')
             RETURNING id`,
            [lo, cc.id, creator, reviewer]
          );
          out.concepts += r.rows.length;
        }
      }
      for (const name of link.skills ?? []) {
        const sk = (await client.query(`SELECT id FROM skills WHERE lower(name) = lower($1) AND status = 'ACTIVE' LIMIT 1`, [name])).rows[0];
        if (!sk) {
          out.missingTargets.push(`skill:${name}`);
          continue;
        }
        for (const lo of objectives) {
          const r = await client.query(
            `INSERT INTO objective_skill_mappings (learning_objective_id, skill_id, relation_type, provenance, status, created_by, reviewed_by, reviewed_at, published_at)
             SELECT $1, $2, 'PARTIAL', 'MANUAL', 'PUBLISHED', $3, $4, now(), now()
              WHERE NOT EXISTS (SELECT 1 FROM objective_skill_mappings WHERE learning_objective_id = $1 AND skill_id = $2 AND status = 'PUBLISHED') RETURNING id`,
            [lo, sk.id, creator, reviewer]
          );
          out.skills += r.rows.length;
        }
      }
      for (const codeC of link.competencies ?? []) {
        const cp = (await client.query(`SELECT id FROM competencies WHERE code = $1 AND status = 'ACTIVE'`, [codeC])).rows[0];
        if (!cp) {
          out.missingTargets.push(`competency:${codeC}`);
          continue;
        }
        for (const lo of objectives) {
          const r = await client.query(
            `INSERT INTO objective_competency_mappings (learning_objective_id, competency_id, relation_type, provenance, status, created_by, reviewed_by, reviewed_at, published_at)
             SELECT $1, $2, 'PARTIAL', 'MANUAL', 'PUBLISHED', $3, $4, now(), now()
              WHERE NOT EXISTS (SELECT 1 FROM objective_competency_mappings WHERE learning_objective_id = $1 AND competency_id = $2 AND status = 'PUBLISHED') RETURNING id`,
            [lo, cp.id, creator, reviewer]
          );
          out.competencies += r.rows.length;
        }
      }
    }
    out.missingTargets = [...new Set(out.missingTargets)];
    await client.query(options.write ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * "Reforzar ahora" for a canonical concept the Student does not study yet.
 * Returns the Student's concept (existing or newly added) and its subject.
 */
export async function addConceptToStudentLearning(studentId: string, canonicalConceptId: string, language: string): Promise<{ studentConceptId: string; subjectId: string }> {
  const existing = await resolveStudentConceptForCanonicalConcept(studentId, canonicalConceptId);
  if (existing) {
    const s = (await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [existing])).rows[0];
    return { studentConceptId: existing, subjectId: s.subject_id };
  }
  const cc = (await db.query(`SELECT cc.name, cs.name AS subject_name FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE cc.id = $1 AND cc.status = 'ACTIVE'`, [canonicalConceptId])).rows[0];
  if (!cc) throw new Error('CANONICAL_CONCEPT_NOT_FOUND');
  let subjectId = (await db.query(`SELECT id FROM subjects WHERE student_id = $1 AND lower(name) = lower($2) ORDER BY created_at LIMIT 1`, [studentId, cc.subject_name])).rows[0]?.id as string | undefined;
  if (!subjectId) subjectId = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, $2) RETURNING id`, [studentId, String(cc.subject_name).slice(0, 100)])).rows[0].id as string;
  const conceptId = (await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subjectId, `catalog:${canonicalConceptId}`])).rows[0].id as string;
  await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, $2, $3)`, [conceptId, language.slice(0, 10), cc.name]);
  const mapping = await ensureCatalogMapping(conceptId);
  if (mapping.canonicalConceptId !== canonicalConceptId) {
    // The label match must land on the same canonical concept; otherwise nothing is linked silently.
    throw new Error('CATALOG_MAPPING_MISMATCH');
  }
  return { studentConceptId: conceptId, subjectId };
}
