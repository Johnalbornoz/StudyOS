/**
 * F9 -- the reverse of F4's ensureCatalogMapping (which proposes/
 * confirms a match starting from the student's own concept). Never
 * fabricates a correspondence: null means "not yet matched."
 */
import { db, type DbExecutor } from '@/lib/db';

export async function resolveStudentConceptForCanonicalConcept(
  studentId: string,
  canonicalConceptId: string,
  client: DbExecutor = db
): Promise<string | null> {
  const result = await client.query(
    `
    SELECT c.id FROM concepts c
    JOIN subjects s ON s.id = c.subject_id
    JOIN concept_catalog_mapping ccm ON ccm.learner_concept_id = c.id
    WHERE s.student_id = $1 AND ccm.canonical_concept_id = $2 AND ccm.status = 'MATCHED'
    LIMIT 1
    `,
    [studentId, canonicalConceptId]
  );
  return result.rows.length === 0 ? null : result.rows[0].id;
}
