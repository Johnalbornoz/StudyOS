/**
 * Exam V2 -- AssessmentSourceRegistry persistence (section 4). Sources are
 * upserted by `source_key` from the reviewed registry (sources.ts); a
 * structural fact is only ever linked to a registered source.
 */
import type { PoolClient } from 'pg';
import { ASSESSMENT_SOURCES, VERIFIED_AT, type AssessmentSourceSeed } from './sources';

type Exec = Pick<PoolClient, 'query'>;

export class UnknownSourceError extends Error {
  constructor(public readonly keys: string[]) {
    super(`UNKNOWN_SOURCE: ${keys.join(', ')}`);
    this.name = 'UnknownSourceError';
  }
}

export function sourceSeed(key: string): AssessmentSourceSeed | undefined {
  return ASSESSMENT_SOURCES.find((s) => s.key === key);
}

/** Upserts the given registry sources (all when `keys` is omitted). Unknown keys throw -- never a dangling citation. */
export async function upsertSources(client: Exec, keys?: string[]): Promise<Map<string, string>> {
  const wanted = keys ? [...new Set(keys)] : ASSESSMENT_SOURCES.map((s) => s.key);
  const missing = wanted.filter((k) => !sourceSeed(k));
  if (missing.length) throw new UnknownSourceError(missing);
  for (const k of wanted) {
    const s = sourceSeed(k)!;
    await client.query(
      `INSERT INTO assessment_sources (source_key, framework, title, publisher, url, document_version, publication_year, effective_session, verified_at, confidence, license_status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (source_key) DO UPDATE SET framework = EXCLUDED.framework, title = EXCLUDED.title, publisher = EXCLUDED.publisher, url = EXCLUDED.url,
         document_version = EXCLUDED.document_version, publication_year = EXCLUDED.publication_year, effective_session = EXCLUDED.effective_session,
         verified_at = EXCLUDED.verified_at, confidence = EXCLUDED.confidence, license_status = EXCLUDED.license_status, notes = EXCLUDED.notes`,
      [s.key, s.framework, s.title, s.publisher, s.url, s.documentVersion ?? null, s.publicationYear, s.effectiveSession ?? null, VERIFIED_AT, s.confidence, s.license, s.notes ?? null]
    );
  }
  const rows = await client.query(`SELECT id, source_key FROM assessment_sources WHERE source_key = ANY($1::text[])`, [wanted]);
  return new Map(rows.rows.map((r: any) => [r.source_key, r.id]));
}
