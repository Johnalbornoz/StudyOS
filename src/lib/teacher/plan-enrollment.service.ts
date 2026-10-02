/**
 * Track A -- a Teacher assignment may put a catalog concept into a learner's
 * plan when the learner does not have it yet.
 *
 * The learner concept is created exactly the way the platform already
 * creates a concept for a learner (`createConceptManually`: concept +
 * localization + the zero-initialized record + catalog mapping), with two
 * differences that make it safe for a Teacher-driven call:
 *  - it is created FROM the canonical concept, so its catalog mapping is
 *    MATCHED by construction (`mapping_method = 'TEACHER_ASSIGNMENT'`), never
 *    a guessed name match;
 *  - its key is deterministic (`CANON_<canonical id>`) and the whole step
 *    runs under a per-learner advisory lock, so a retried or concurrent
 *    publish reuses the same concept: never a duplicate, never a reset.
 *
 * If the learner already has the concept (any MATCHED learner concept), it is
 * reused untouched. Nothing here writes evidence, mastery progress, knowledge
 * state, phase recognitions, retention or transfer: the zero-initialized
 * record is the same "not started" row every new concept gets, and the
 * learner's state starts at LEARN through the normal Learning Engine.
 *
 * Callers MUST already have authorized the Teacher for the class, the
 * learner as ACTIVE in it, and the canonical concept as belonging to the
 * class's subject.
 */
import { db } from '@/lib/db';
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import { catalogSubjectByName, normalizeName } from '@/lib/experience/subject-catalog';
import { getInterfaceLanguage } from '@/lib/i18n/language';

export const TEACHER_ASSIGNMENT_ORIGIN = 'TEACHER_ASSIGNMENT';

export const canonicalConceptKey = (canonicalConceptId: string) => `CANON_${canonicalConceptId.replace(/-/g, '').toUpperCase()}`;

export interface PlanConcept {
  conceptId: string;
  /** true when this call put the concept into the learner's plan. */
  added: boolean;
}

type Executor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/**
 * The learner's subject that corresponds to the class's canonical subject:
 * one already holding a concept of that canonical subject, else one whose
 * name is the same subject in any language (catalog equivalence, e.g.
 * "Matemáticas" = "Mathematics"), else a new subject named in the learner's
 * own language. Never another learner's subject.
 */
async function resolveLearnerSubject(client: Executor, studentId: string, canonicalSubject: { id: string; name: string }): Promise<string> {
  const byMapping = await client.query(
    `SELECT s.id FROM subjects s
     JOIN concepts c ON c.subject_id = s.id
     JOIN concept_catalog_mapping m ON m.learner_concept_id = c.id AND m.status = 'MATCHED'
     JOIN canonical_concepts cc ON cc.id = m.canonical_concept_id
     WHERE s.student_id = $1 AND s.status = 'active' AND cc.canonical_subject_id = $2
     ORDER BY s.created_at LIMIT 1`,
    [studentId, canonicalSubject.id]
  );
  if (byMapping.rows[0]) return byMapping.rows[0].id;

  const catalogEntry = catalogSubjectByName(canonicalSubject.name);
  const own = await client.query(`SELECT id, name FROM subjects WHERE student_id = $1 AND status = 'active' ORDER BY created_at`, [studentId]);
  const wanted = normalizeName(canonicalSubject.name);
  const same = own.rows.find((s: any) => {
    if (normalizeName(s.name) === wanted) return true;
    const entry = catalogSubjectByName(s.name);
    return Boolean(entry && catalogEntry && entry.key === catalogEntry.key);
  });
  if (same) return same.id;

  const locale = await getInterfaceLanguage(studentId).catch(() => 'es' as const);
  const name = (catalogEntry?.names as Record<string, string> | undefined)?.[locale] ?? canonicalSubject.name;
  const inserted = await client.query(`INSERT INTO subjects (student_id, name, status) VALUES ($1, $2, 'active') RETURNING id`, [studentId, name]);
  return inserted.rows[0].id;
}

/**
 * Make sure the learner's plan contains the canonical concept; return the
 * learner's own concept id. Idempotent and safe under concurrency.
 */
export async function ensureConceptInLearnerPlan(params: {
  studentId: string;
  canonicalConceptId: string;
  classId: string;
}): Promise<PlanConcept> {
  const existing = await resolveStudentConceptForCanonicalConcept(params.studentId, params.canonicalConceptId);
  if (existing) return { conceptId: existing, added: false };

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Same lock key as Student subject creation: serialized with the learner's own subject creation and any retried publish.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('subject-create:' || $1::text))`, [params.studentId]);
    const again = await resolveStudentConceptForCanonicalConcept(params.studentId, params.canonicalConceptId, client as any);
    if (again) {
      await client.query('COMMIT');
      return { conceptId: again, added: false };
    }
    const canonical = await client.query(
      `SELECT cc.id, cc.name, cs.id AS subject_id, cs.name AS subject_name
       FROM canonical_concepts cc JOIN canonical_subjects cs ON cs.id = cc.canonical_subject_id
       WHERE cc.id = $1 AND cc.status = 'ACTIVE'`,
      [params.canonicalConceptId]
    );
    const cc = canonical.rows[0];
    if (!cc) throw new Error('CANONICAL_CONCEPT_NOT_AVAILABLE');

    const subjectId = await resolveLearnerSubject(client, params.studentId, { id: cc.subject_id, name: cc.subject_name });
    const key = canonicalConceptKey(cc.id);
    const concept = await client.query(
      `INSERT INTO concepts (subject_id, canonical_id, origin, origin_class_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (subject_id, canonical_id) DO UPDATE SET canonical_id = EXCLUDED.canonical_id
       RETURNING id, (xmax = 0) AS inserted`,
      [subjectId, key, TEACHER_ASSIGNMENT_ORIGIN, params.classId]
    );
    const conceptId: string = concept.rows[0].id;
    const added = Boolean(concept.rows[0].inserted);
    await client.query(
      `INSERT INTO concept_localizations (concept_id, language, label) VALUES ($1, 'en', $2) ON CONFLICT (concept_id, language) DO NOTHING`,
      [conceptId, cc.name]
    );
    // The same zero-initialized "not started" record every new concept gets (no attempts, no score).
    await client.query(
      `INSERT INTO mastery_records (student_id, concept_id, subject_id, mastery_score, confidence_score, attempt_count, correct_count, incorrect_count)
       VALUES ($1, $2, $3, 0, 0, 0, 0, 0) ON CONFLICT (student_id, concept_id) DO NOTHING`,
      [params.studentId, conceptId, subjectId]
    );
    await client.query(
      `INSERT INTO concept_catalog_mapping (learner_concept_id, canonical_concept_id, status, mapping_method)
       VALUES ($1, $2, 'MATCHED', 'TEACHER_ASSIGNMENT')
       ON CONFLICT (learner_concept_id) DO NOTHING`,
      [conceptId, cc.id]
    );
    await client.query('COMMIT');
    return { conceptId, added };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Which of these ACTIVE learners already have the canonical concept in their plan (for the Teacher's preview). */
export async function learnersHavingCanonicalConcept(studentIds: string[], canonicalConceptId: string): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const r = await db.query(
    `SELECT DISTINCT s.student_id FROM subjects s
     JOIN concepts c ON c.subject_id = s.id
     JOIN concept_catalog_mapping m ON m.learner_concept_id = c.id AND m.status = 'MATCHED'
     WHERE s.student_id = ANY($1::uuid[]) AND m.canonical_concept_id = $2`,
    [studentIds, canonicalConceptId]
  );
  return new Set(r.rows.map((row: any) => row.student_id));
}
