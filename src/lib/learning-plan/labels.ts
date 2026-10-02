/**
 * Track A -- display labels of canonical concepts in the reader's locale.
 * Identity is ALWAYS the canonical id; the label is presentation only
 * (canonical_concept_localizations, falling back to the catalog name).
 */
import { db } from '@/lib/db';

export async function canonicalConceptLabels(ids: string[], locale: string): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const r = await db.query(
    `SELECT cc.id, COALESCE(l.label, cc.name) AS label
     FROM canonical_concepts cc
     LEFT JOIN canonical_concept_localizations l ON l.canonical_concept_id = cc.id AND l.language = $2
     WHERE cc.id = ANY($1::uuid[])`,
    [unique, locale]
  );
  for (const row of r.rows) out.set(row.id, row.label);
  return out;
}
