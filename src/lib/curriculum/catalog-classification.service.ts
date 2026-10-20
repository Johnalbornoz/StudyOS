/**
 * Curriculum catalogue CLASSIFICATION -- the governed, idempotent completion of
 * catalogue rows written after migration 20261018_1500 ran (e.g. the IB /
 * Cambridge programmes created later by the exam-catalogue apply).
 *
 * It applies EXACTLY the rules that migration applied once, and only to rows
 * that are still unclassified (never overwrites a value):
 *   1. international programme bodies (Cambridge*, International Baccalaureate*,
 *      College Board*, OECD) -> source_type INTERNATIONAL_PROGRAMME, authority_level INTERNATIONAL;
 *      Icfes -> GOVERNMENT_AUTHORITY, NATIONAL, CO.
 *   2. CURRICULUM-programme subjects without a canonical subject (exam programmes --
 *      PISA, PAA, Saber -- are never touched) -> the ACTIVE canonical subject
 *      with the same name, else the longest canonical name that prefixes it
 *      ("Mathematics: analysis and approaches" -> Mathematics). A subject with no
 *      such canonical subject stays unmapped (never invented) and therefore is not
 *      offered in curriculum configuration.
 *
 * No institution curriculum, class binding, learner record or structure is touched.
 */
import { db } from '@/lib/db';

export interface ClassificationResult {
  write: boolean;
  organizationsClassified: number;
  subjectsMappedExact: number;
  subjectsMappedPrefix: number;
  subjectsStillUnmapped: number;
}

export async function classifyCurriculumCatalog(options: { write: boolean }): Promise<ClassificationResult> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const intl = await client.query(
      `UPDATE academic_organizations SET source_type = 'INTERNATIONAL_PROGRAMME', authority_level = 'INTERNATIONAL'
        WHERE source_type IS NULL AND (name ILIKE 'Cambridge%' OR name ILIKE 'International Baccalaureate%' OR name ILIKE 'College Board%' OR name = 'OECD')`
    );
    const icfes = await client.query(
      `UPDATE academic_organizations SET source_type = 'GOVERNMENT_AUTHORITY', authority_level = 'NATIONAL', country = 'CO'
        WHERE source_type IS NULL AND name ILIKE 'icfes'`
    );
    const exact = await client.query(
      `UPDATE academic_subjects a SET canonical_subject_id = cs.id
         FROM canonical_subjects cs
        WHERE a.canonical_subject_id IS NULL AND cs.status = 'ACTIVE' AND lower(cs.name) = lower(a.name)
          AND EXISTS (SELECT 1 FROM academic_programmes p WHERE p.id = a.programme_id AND p.programme_type = 'CURRICULUM')`
    );
    const prefix = await client.query(
      `UPDATE academic_subjects a SET canonical_subject_id = m.id
         FROM (SELECT a2.id AS subject_id,
                      (SELECT cs.id FROM canonical_subjects cs WHERE cs.status = 'ACTIVE' AND lower(a2.name) LIKE lower(cs.name) || '%' ORDER BY char_length(cs.name) DESC LIMIT 1) AS id
                 FROM academic_subjects a2 WHERE a2.canonical_subject_id IS NULL AND EXISTS (SELECT 1 FROM academic_programmes p WHERE p.id = a2.programme_id AND p.programme_type = 'CURRICULUM')) m
        WHERE a.id = m.subject_id AND m.id IS NOT NULL`
    );
    const left = await client.query(`SELECT count(*)::int AS n FROM academic_subjects a WHERE a.canonical_subject_id IS NULL AND a.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM academic_programmes p WHERE p.id = a.programme_id AND p.programme_type = 'CURRICULUM')`);
    await client.query(options.write ? 'COMMIT' : 'ROLLBACK');
    return {
      write: options.write,
      organizationsClassified: (intl.rowCount ?? 0) + (icfes.rowCount ?? 0),
      subjectsMappedExact: exact.rowCount ?? 0,
      subjectsMappedPrefix: prefix.rowCount ?? 0,
      subjectsStillUnmapped: left.rows[0].n,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
