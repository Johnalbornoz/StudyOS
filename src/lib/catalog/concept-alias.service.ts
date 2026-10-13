/**
 * Curriculum convergence -- materialises the governed list of reviewed concept aliases
 * (reviewed-concept-aliases.ts) into `canonical_concept_aliases`. Idempotent: an alias already ACTIVE for the
 * same target and version is left as it is. An ACTIVE alias of the same label that points at another concept
 * is a conflict and is reported, never overwritten. A target that the catalogue does not hold is reported and
 * nothing is created for it (an alias never invents its concept).
 */
import type { DbExecutor } from '@/lib/db';
import { REVIEWED_CONCEPT_ALIASES, type ReviewedConceptAlias } from './reviewed-concept-aliases';

export interface AliasLedger {
  created: string[];
  existing: string[];
  problems: string[];
}

export async function applyReviewedConceptAliases(client: DbExecutor, aliases: readonly ReviewedConceptAlias[] = REVIEWED_CONCEPT_ALIASES): Promise<AliasLedger> {
  const ledger: AliasLedger = { created: [], existing: [], problems: [] };
  for (const a of aliases) {
    const tag = `${a.canonicalSubject} / "${a.label}" -> ${a.stableConceptId ?? a.canonicalName}`;
    const target = await client.query(
      `SELECT cc.id, cc.canonical_subject_id FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id AND cs.status = 'ACTIVE'
        WHERE cs.name = $1 AND cc.name = $2 AND cc.status = 'ACTIVE'`,
      [a.canonicalSubject, a.canonicalName]
    );
    if (target.rows.length !== 1) {
      ledger.problems.push(`ALIAS_TARGET_NOT_FOUND ${tag}: ${target.rows.length} canonical rows`);
      continue;
    }
    const { id: conceptId, canonical_subject_id: subjectId } = target.rows[0];
    const active = await client.query(`SELECT id, canonical_concept_id, version FROM canonical_concept_aliases WHERE canonical_subject_id = $1 AND normalized_label = lower(btrim($2)) AND status = 'ACTIVE'`, [subjectId, a.label]);
    if (active.rows.length === 1) {
      if (active.rows[0].canonical_concept_id === conceptId && Number(active.rows[0].version) === a.version) ledger.existing.push(tag);
      else ledger.problems.push(`ALIAS_CONFLICT ${tag}: an ACTIVE alias of this label exists with another target or version`);
      continue;
    }
    await client.query(
      `INSERT INTO canonical_concept_aliases (canonical_concept_id, canonical_subject_id, language, label, stable_concept_id, rationale, review_reference, reviewed_at, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [conceptId, subjectId, a.language, a.label, a.stableConceptId, a.rationale, a.reviewReference, a.reviewedAt, a.version]
    );
    ledger.created.push(tag);
  }
  return ledger;
}
