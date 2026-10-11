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
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import { assertResetAllowed } from '../dev-fixture-reset';
import { DEV_CANONICAL_CONCEPTS, DEV_COMPETENCIES, DEV_SKILLS, DEV_CATALOG_LABEL } from './dev-learning-catalog';
import { allLearningLinks } from './objective-learning-links';
// B1: catalogue and mapping rows are created through the Curriculum Authority's bootstrap boundary.
import { ensureCanonicalConcept, ensureCanonicalSubject, ensureCompetency, ensurePublishedObjectiveCompetencyMapping, ensurePublishedObjectiveConceptMapping, ensurePublishedObjectiveSkillMapping, ensureSkill } from '@/lib/curriculum/bootstrap.service';
import { linkLearnerConceptCreatedFromCanonical } from '@/lib/catalog/concept-identity.service';

export async function applyDevLearningCatalog(options: { write: boolean; confirm: string }): Promise<{ subjects: number; concepts: number; skills: number; competencies: number }> {
  // Same guard as the DEV fixture reset: DEV database only, never production.
  assertResetAllowed(options.confirm === 'APPLY-DEV-LEARNING-CATALOG' ? 'RESET-DEV-FIXTURES' : 'no');
  const client = await db.connect();
  const created = { subjects: 0, concepts: 0, skills: 0, competencies: 0 };
  try {
    await client.query('BEGIN');
    const subjectIds = new Map<string, string>();
    for (const name of [...new Set(DEV_CANONICAL_CONCEPTS.map((x) => x.subject))]) {
      const subject = await ensureCanonicalSubject(client, name);
      if (subject.created) created.subjects++;
      subjectIds.set(name, subject.id);
    }
    for (const cpt of DEV_CANONICAL_CONCEPTS) {
      if (await ensureCanonicalConcept(client, { canonicalSubjectId: subjectIds.get(cpt.subject)!, name: cpt.name, description: DEV_CATALOG_LABEL })) created.concepts++;
    }
    for (const sk of DEV_SKILLS) {
      if (await ensureSkill(client, { name: sk.name, type: sk.type, description: DEV_CATALOG_LABEL })) created.skills++;
    }
    for (const cp of DEV_COMPETENCIES) {
      if (await ensureCompetency(client, { code: cp.code, name: cp.name, description: DEV_CATALOG_LABEL })) created.competencies++;
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
      // B2-B2: the LEGACY blueprint only (purpose NULL) -- a variant's targets never reach this reader. Written as to_jsonb(b) ->> 'purpose' rather than b.purpose
      // because this catalogue writer is also run by the B2-B1 certification against the pre-20261110 schema, where the column does not exist yet.
      const objectives = (
        await client.query(
          `SELECT DISTINCT lo.id FROM learning_objectives lo
             JOIN blueprint_objective_targets t ON t.learning_objective_id = lo.id
             JOIN assessment_blueprints b ON b.id = t.blueprint_id AND to_jsonb(b) ->> 'purpose' IS NULL
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
          if (await ensurePublishedObjectiveConceptMapping(client, { learningObjectiveId: lo, canonicalConceptId: cc.id, createdBy: creator, reviewedBy: reviewer, rationale: 'Exam V2 reviewed objective link' })) out.concepts += 1;
        }
      }
      for (const name of link.skills ?? []) {
        const sk = (await client.query(`SELECT id FROM skills WHERE lower(name) = lower($1) AND status = 'ACTIVE' LIMIT 1`, [name])).rows[0];
        if (!sk) {
          out.missingTargets.push(`skill:${name}`);
          continue;
        }
        for (const lo of objectives) {
          if (await ensurePublishedObjectiveSkillMapping(client, { learningObjectiveId: lo, skillId: sk.id, createdBy: creator, reviewedBy: reviewer })) out.skills += 1;
        }
      }
      for (const codeC of link.competencies ?? []) {
        const cp = (await client.query(`SELECT id FROM competencies WHERE code = $1 AND status = 'ACTIVE'`, [codeC])).rows[0];
        if (!cp) {
          out.missingTargets.push(`competency:${codeC}`);
          continue;
        }
        for (const lo of objectives) {
          if (await ensurePublishedObjectiveCompetencyMapping(client, { learningObjectiveId: lo, competencyId: cp.id, createdBy: creator, reviewedBy: reviewer })) out.competencies += 1;
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
export async function addConceptToStudentLearning(studentId: string, canonicalConceptId: string, language: string): Promise<{ studentConceptId: string; subjectId: string; existed: boolean }> {
  const existing = await resolveStudentConceptForCanonicalConcept(studentId, canonicalConceptId);
  if (existing) {
    const s = (await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [existing])).rows[0];
    // Already studied: its learner state is reused as it is -- nothing is reset or duplicated.
    return { studentConceptId: existing, subjectId: s.subject_id, existed: true };
  }
  const cc = (await db.query(`SELECT cc.name, cs.name AS subject_name FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE cc.id = $1 AND cc.status = 'ACTIVE'`, [canonicalConceptId])).rows[0];
  if (!cc) throw new Error('CANONICAL_CONCEPT_NOT_FOUND');
  let subjectId = (await db.query(`SELECT id FROM subjects WHERE student_id = $1 AND lower(name) = lower($2) ORDER BY created_at LIMIT 1`, [studentId, cc.subject_name])).rows[0]?.id as string | undefined;
  if (!subjectId) subjectId = (await db.query(`INSERT INTO subjects (student_id, name) VALUES ($1, $2) RETURNING id`, [studentId, String(cc.subject_name).slice(0, 100)])).rows[0].id as string;
  const conceptId = (await db.query(`INSERT INTO concepts (subject_id, canonical_id) VALUES ($1, $2) RETURNING id`, [subjectId, `catalog:${canonicalConceptId}`])).rows[0].id as string;
  await db.query(`INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, $2, $3)`, [conceptId, language.slice(0, 10), cc.name]);
  // B1: the concept was created FROM this canonical concept, so the link is that fact, written explicitly --
  // never re-derived by matching the label we just copied (label matching is not a canonical relationship).
  await linkLearnerConceptCreatedFromCanonical(conceptId, canonicalConceptId);
  return { studentConceptId: conceptId, subjectId, existed: false };
}
