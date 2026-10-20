/**
 * Curriculum convergence -- loads the Q1-C.1 certified PAA concept catalogue (paa-certified-concepts.ts) into a
 * database that holds the PAA exam configuration. It is the PAA-only form of the three operator steps that
 * applied the same catalogue to DEV (docs/exams/question-bank/PAA_F_DATA_FOUNDATION.md), through the same
 * writers and with the same values:
 *
 *   1. the certified concepts that are missing        ensureCanonicalConcept        (never a second row for a name)
 *   2. their governed es / en labels                  CANONICAL_CONCEPT_LABELS      (the seed's own upsert)
 *   3. the reviewed PAA objective -> concept links    ensurePublishedObjectiveConceptMapping  (`paa.*` codes only)
 *   4. the five links the certified catalogue replaced  PUBLISHED -> RETIRED          (closed list; nothing deleted)
 *
 * Idempotent. Only PAA is in scope: no other framework's objective, mapping or concept is read for writing.
 * A canonical subject is never created here; a missing one is a problem that stops the run.
 */
import type { DbExecutor } from '@/lib/db';
import { ensureCanonicalConcept, ensurePublishedObjectiveConceptMapping } from '../bootstrap.service';
import { DEV_CATALOG_LABEL } from '@/lib/exam-core/catalog/dev-learning-catalog';
import { allLearningLinks } from '@/lib/exam-core/catalog/objective-learning-links';
import { CANONICAL_CONCEPT_LABELS } from '@/lib/learning-plan/canonical-concept-labels';
import { PAA_CERTIFIED_CONCEPTS, RETIRED_PAA_OBJECTIVE_LINKS } from './paa-certified-concepts';

export interface PaaCertifiedCatalogLedger {
  certified: number;
  presentBefore: number;
  conceptsCreated: string[];
  labelsWritten: number;
  mappingsPublished: number;
  mappingsRetired: number;
  mappingsAlreadyRetired: number;
  presentAfter: number;
  problems: string[];
}

const conceptRow = async (client: DbExecutor, subject: string, name: string) =>
  (await client.query(
    `SELECT cc.id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id WHERE lower(cs.name) = lower($1) AND lower(cc.name) = lower($2) AND cc.status = 'ACTIVE'`,
    [subject, name]
  )).rows as Array<{ id: string }>;

/** How many of the 61 certified concepts the catalogue holds (exactly one ACTIVE row each). */
export async function readPaaCertifiedCatalog(client: DbExecutor): Promise<{ certified: number; present: number; missing: string[]; duplicated: string[] }> {
  const missing: string[] = [];
  const duplicated: string[] = [];
  for (const c of PAA_CERTIFIED_CONCEPTS) {
    const rows = await conceptRow(client, c.canonicalSubject, c.canonicalName);
    if (rows.length === 0) missing.push(c.stableId);
    else if (rows.length > 1) duplicated.push(c.stableId);
  }
  return { certified: PAA_CERTIFIED_CONCEPTS.length, present: PAA_CERTIFIED_CONCEPTS.length - missing.length - duplicated.length, missing, duplicated };
}

export async function applyPaaCertifiedCatalog(client: DbExecutor): Promise<PaaCertifiedCatalogLedger> {
  const before = await readPaaCertifiedCatalog(client);
  const ledger: PaaCertifiedCatalogLedger = { certified: before.certified, presentBefore: before.present, conceptsCreated: [], labelsWritten: 0, mappingsPublished: 0, mappingsRetired: 0, mappingsAlreadyRetired: 0, presentAfter: before.present, problems: before.duplicated.map((d) => `DUPLICATE_CANONICAL_CONCEPT ${d}`) };
  const actors = (await client.query(`SELECT id FROM users WHERE is_system = true ORDER BY created_at ASC, id ASC LIMIT 2`)).rows.map((r: any) => r.id as string);
  if (actors.length < 2) {
    ledger.problems.push('NO_SYSTEM_IDENTITIES');
    return ledger;
  }

  // 1 + 2: concepts and labels
  const ids = new Map<string, string>();
  for (const c of PAA_CERTIFIED_CONCEPTS) {
    const subject = (await client.query(`SELECT id FROM canonical_subjects WHERE lower(name) = lower($1) AND status = 'ACTIVE' ORDER BY created_at LIMIT 1`, [c.canonicalSubject])).rows[0];
    if (!subject) {
      ledger.problems.push(`CANONICAL_SUBJECT_NOT_FOUND ${c.canonicalSubject} (${c.stableId})`);
      continue;
    }
    if (await ensureCanonicalConcept(client, { canonicalSubjectId: subject.id, name: c.canonicalName, description: DEV_CATALOG_LABEL })) ledger.conceptsCreated.push(c.stableId);
    const rows = await conceptRow(client, c.canonicalSubject, c.canonicalName);
    if (rows.length !== 1) {
      ledger.problems.push(`CERTIFIED_CONCEPT_NOT_SINGLE ${c.stableId}: ${rows.length} rows`);
      continue;
    }
    ids.set(`${c.canonicalSubject}/${c.canonicalName}`.toLowerCase(), rows[0].id);
    const labels = CANONICAL_CONCEPT_LABELS[c.canonicalName];
    if (!labels) {
      ledger.problems.push(`NO_GOVERNED_LABEL ${c.stableId}`);
      continue;
    }
    for (const [language, label] of [['es', labels[0]], ['en', labels[1]]] as const) {
      const r = await client.query(
        `INSERT INTO canonical_concept_localizations (canonical_concept_id, language, label) VALUES ($1, $2, $3)
         ON CONFLICT (canonical_concept_id, language) DO UPDATE SET label = EXCLUDED.label, updated_at = now()
         WHERE canonical_concept_localizations.label IS DISTINCT FROM EXCLUDED.label`,
        [rows[0].id, language, label]
      );
      ledger.labelsWritten += r.rowCount ?? 0;
    }
  }

  // 3: the reviewed PAA links (objectives of PUBLISHED exam versions, legacy blueprint -- as the catalogue writer reads them)
  for (const [code, link] of Object.entries(allLearningLinks())) {
    if (!code.startsWith('paa.')) continue;
    const objectives = (await client.query(
      `SELECT DISTINCT lo.id FROM learning_objectives lo
         JOIN blueprint_objective_targets t ON t.learning_objective_id = lo.id
         JOIN assessment_blueprints b ON b.id = t.blueprint_id AND b.purpose IS NULL
         JOIN exam_versions v ON v.id = b.exam_version_id AND v.status = 'PUBLISHED'
        WHERE lo.code = $1`,
      [code]
    )).rows.map((r: any) => r.id as string);
    for (const cpt of link.concepts ?? []) {
      // A reviewed PAA link may name a concept outside the certified 61 (`paa.red.cohesion` -> Cohesión y conectores: a
      // historical objective with no official Domain). Such a target is used only if the catalogue already holds it; it is never created here.
      let conceptId = ids.get(`${cpt.subject}/${cpt.name}`.toLowerCase());
      if (!conceptId) {
        const existing = await conceptRow(client, cpt.subject, cpt.name);
        if (existing.length === 1) conceptId = existing[0].id;
      }
      if (!conceptId) {
        ledger.problems.push(`LINK_TARGET_NOT_IN_CATALOGUE ${code} -> ${cpt.subject}/${cpt.name}`);
        continue;
      }
      for (const lo of objectives) {
        if (await ensurePublishedObjectiveConceptMapping(client, { learningObjectiveId: lo, canonicalConceptId: conceptId, createdBy: actors[0], reviewedBy: actors[1], rationale: 'Exam V2 reviewed objective link' })) ledger.mappingsPublished += 1;
      }
    }
  }

  // 4: retire exactly the replaced links, and only where the certified replacement is published on the same objective
  const PAIR = `SELECT m.id, m.learning_objective_id FROM objective_concept_mappings m
      JOIN learning_objectives lo ON lo.id = m.learning_objective_id JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id
     WHERE lo.code = $1 AND cs.name = $2 AND cc.name = $3 AND m.status = $4`;
  for (const link of RETIRED_PAA_OBJECTIVE_LINKS) {
    const published = (await client.query(PAIR, [link.code, link.subject, link.concept, 'PUBLISHED'])).rows as Array<{ id: string; learning_objective_id: string }>;
    if (published.length === 0) {
      if ((await client.query(PAIR, [link.code, link.subject, link.concept, 'RETIRED'])).rows.length > 0) ledger.mappingsAlreadyRetired += 1;
      continue; // a database that never held the replaced link has nothing to retire
    }
    for (const row of published) {
      const replacement = await client.query(
        `SELECT 1 FROM objective_concept_mappings m JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id
          WHERE m.learning_objective_id = $1 AND cs.name = $2 AND cc.name = $3 AND m.status = 'PUBLISHED'`,
        [row.learning_objective_id, link.subject, link.replacedBy]
      );
      if (replacement.rows.length !== 1) {
        ledger.problems.push(`REPLACEMENT_NOT_PUBLISHED ${link.code} -> ${link.replacedBy}`);
        continue;
      }
      const updated = await client.query(`UPDATE objective_concept_mappings SET status = 'RETIRED' WHERE id = $1 AND status = 'PUBLISHED'`, [row.id]);
      ledger.mappingsRetired += updated.rowCount ?? 0;
    }
  }
  ledger.presentAfter = (await readPaaCertifiedCatalog(client)).present;
  if (ledger.presentAfter !== ledger.certified) ledger.problems.push(`certified concepts present ${ledger.presentAfter}, expected ${ledger.certified}`);
  return ledger;
}
