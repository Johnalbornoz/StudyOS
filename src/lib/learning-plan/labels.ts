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
