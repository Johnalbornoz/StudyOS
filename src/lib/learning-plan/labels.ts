/**
 * Track A -- display labels of canonical concepts in the reader's locale.
 * Identity is ALWAYS the canonical id; the label is presentation only
 * (canonical_concept_localizations; then the governed label list; then the catalog name).
 */
import { db } from '@/lib/db';
import { governedConceptLabel } from './canonical-concept-labels';

/**
 * Display label priority (pure): the catalogue's stored localization; else the governed label of the
 * concept (canonical-concept-labels.ts -- the same reviewed list the seed writes, for a concept that has
 * no row yet); else the stored catalogue name. Never a runtime translation.
 */
export function resolveConceptLabel(row: { localized?: string | null; name: string }, locale: string): string {
  return row.localized || governedConceptLabel(row.name, locale) || row.name;
}

/**
 * The display label of one of the STUDENT'S OWN concepts (pure) -- the same priority on Home, Learn and
 * Exam Prep:
 *
 *   linked to the catalogue (concept_catalog_mapping MATCHED):
 *     1. the catalogue's stored localized label        (canonical_concept_localizations)
 *     2. the governed StudyUs concept-label list        (canonical-concept-labels.ts)
 *     3. the concept's own stored name                  (the reader's language first, else any)
 *
 *   NOT linked (a concept the Student typed): its own stored label, exactly as written -- the catalogue
 *   and the governed list are never consulted, whatever the text is.
 *
 * Display only: nothing is renamed, written or translated at runtime.
 */
export function resolveLearnerConceptLabel(
  row: { canonicalName?: string | null; catalogLocalized?: string | null; ownLocalized?: string | null; storedLabel?: string | null },
  locale: string
): string | null {
  const own = row.ownLocalized || row.storedLabel || null;
  if (!row.canonicalName) return own;
  return row.catalogLocalized || governedConceptLabel(row.canonicalName, locale) || own;
}

/** True when the catalogue (stored localization or governed list) supplies the label of a linked concept. */
export function catalogSuppliesLabel(row: { canonicalName?: string | null; catalogLocalized?: string | null }, locale: string): boolean {
  return !!row.canonicalName && !!(row.catalogLocalized || governedConceptLabel(row.canonicalName, locale));
}

/**
 * The display label of ONE of the Student's concepts, given the label already read for it (read-only).
 * Looks up whether the concept is linked to the catalogue and applies the shared priority
 * (`resolveLearnerConceptLabel`). Not linked -- a concept the Student typed -- or any read failure:
 * the stored label is returned exactly as given.
 */
export async function learnerConceptDisplayLabel(conceptId: string, storedLabel: string, locale: string): Promise<string> {
  const r = await db
    .query(
      `SELECT cc.name AS canonical_name, l.label AS catalog_localized
         FROM concept_catalog_mapping m
         JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id
         LEFT JOIN canonical_concept_localizations l ON l.canonical_concept_id = m.canonical_concept_id AND l.language = $2
        WHERE m.learner_concept_id = $1 AND m.status = 'MATCHED'
        LIMIT 1`,
      [conceptId, locale]
    )
    .catch(() => null);
  const row = r?.rows?.[0];
  if (!row?.canonical_name) return storedLabel;
  return resolveLearnerConceptLabel({ canonicalName: row.canonical_name, catalogLocalized: row.catalog_localized ?? null, storedLabel }, locale) ?? storedLabel;
}

export async function canonicalConceptLabels(ids: string[], locale: string): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const r = await db.query(
    `SELECT cc.id, l.label AS localized, cc.name
     FROM canonical_concepts cc
     LEFT JOIN canonical_concept_localizations l ON l.canonical_concept_id = cc.id AND l.language = $2
     WHERE cc.id = ANY($1::uuid[])`,
    [unique, locale]
  );
  for (const row of r.rows) out.set(row.id, resolveConceptLabel(row, locale));
  return out;
}
