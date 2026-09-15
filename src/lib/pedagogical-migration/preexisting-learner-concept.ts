/**
 * CANON-R4R1A -- PREEXISTING LEARNER-CONCEPT POPULATION (corrected).
 *
 * FINAL PRODUCT RULE (supersedes CANON-R4R1's own original rule): a
 * learner-concept pair is preexisting when the concept is already
 * LOADED/ASSIGNED to that exact learner at cutover -- REGARDLESS of
 * whether any `learning_evidence` row exists for it. CANON-R4R1's own
 * rule ("earliest learning_evidence timestamp < cutover") wrongly
 * excluded every concept a student had loaded but never yet attempted --
 * exactly the case Product has now explicitly corrected (Part 0/5 of
 * this phase's spec).
 *
 * GROUNDING (direct schema audit, database/baseline/STUDYUS_BASELINE_2026_08.sql):
 * StudyUS has NO global, shared concept catalog and NO separate
 * enrollment/assignment junction table. `subjects.student_id` is a
 * direct, NOT NULL foreign key -- a subject row is already owned by
 * exactly one student (subjects are created per-student, never shared).
 * `concepts.subject_id` links a concept to exactly one subject, and
 * therefore -- transitively, through that one FK hop -- to exactly one
 * student. A `concepts` row EXISTING for a subject already IS the
 * authoritative "this concept is loaded for this learner" fact; there
 * is no separate assignment table to join against, because the concept
 * row itself cannot exist independently of its one owning student.
 *
 * `concepts.created_at` (a real, non-nullable, already-populated
 * `timestamp with time zone DEFAULT now()` column) is therefore the
 * real, authoritative "when was this concept loaded for this learner"
 * timestamp CANON-R4R1's own Part 7/8 asked to find or otherwise
 * document a snapshot fallback for -- no such fallback is needed here;
 * a real timestamp already exists on the one authoritative table.
 *
 * `learning_evidence` plays NO role in this determination anymore
 * (Part 9) -- it remains available separately for higher-stage
 * (Practice/Prove/Retention/Transfer) legacy recognition via
 * `ConceptKnowledgeState`, entirely unchanged from CANON-R4.
 */
import { db } from '@/lib/db';

/** Pure. The one classification rule: this exact (student, concept) pair's concept row was created (loaded/assigned) strictly before the cutover. `loadedAt` is `concepts.created_at` for the real query below -- the parameter itself is deliberately generic (a plain ISO timestamp) so this function stays independently testable with a synthetic value, never coupled to how the caller sourced it. */
export function isPreexistingLearnerConcept(loadedAt: string | null, cutoverAt: string): boolean {
  if (loadedAt == null) return false;
  return new Date(loadedAt).getTime() < new Date(cutoverAt).getTime();
}

export interface PreexistingLearnerConceptPair {
  studentId: string;
  conceptId: string;
  /** `concepts.created_at` -- the real, authoritative "loaded for this learner" timestamp. */
  loadedAt: string;
  /**
   * CANON-R4R1A Part 17 -- for dry-run REPORTING only (the required
   * "relationships with zero learning_evidence" breakdown). Never used
   * to decide eligibility -- see the module's own header. `undefined`
   * unless the caller explicitly requested it (Part 17's dry-run needs
   * it; most callers, including the pure engine-input path, do not).
   */
  hasHistoricalEvidence?: boolean;
}

/**
 * THE ACTUAL PREVIEW-EXECUTION QUERY (corrected). Read-only -- one
 * SELECT against `concepts JOIN subjects` (the real, authoritative
 * learner-loaded-concept relationship; see the module header), scoped
 * to concepts created strictly before `cutoverAt`. Optionally annotates
 * each row with whether ANY `learning_evidence` exists for it (a
 * correlated EXISTS subquery, for reporting only -- Part 17). One
 * output row per real `concepts.id`, which is already unique per
 * (student, concept) by construction (a concept row cannot belong to
 * more than one subject, and a subject cannot belong to more than one
 * student) -- no deduplication step is needed. Never called by any test
 * in this repository (no live DB in this environment).
 */
export async function loadPreexistingLearnerConceptPairs(
  cutoverAt: string,
  studentId?: string,
  includeEvidenceFlag = false,
): Promise<PreexistingLearnerConceptPair[]> {
  const params: unknown[] = [cutoverAt];
  let studentFilter = '';
  if (studentId) {
    params.push(studentId);
    studentFilter = `AND s.student_id = $${params.length}`;
  }
  const evidenceSelect = includeEvidenceFlag
    ? `, EXISTS (SELECT 1 FROM learning_evidence le WHERE le.student_id = s.student_id AND le.concept_id = c.id) AS has_evidence`
    : '';

  const result = await db.query(
    `
    SELECT c.id AS concept_id, s.student_id AS student_id, c.created_at AS loaded_at${evidenceSelect}
    FROM concepts c
    JOIN subjects s ON s.id = c.subject_id
    WHERE c.created_at < $1
    ${studentFilter}
    `,
    params,
  );
  return result.rows.map((row: any) => ({
    studentId: row.student_id,
    conceptId: row.concept_id,
    loadedAt: new Date(row.loaded_at).toISOString(),
    ...(includeEvidenceFlag ? { hasHistoricalEvidence: row.has_evidence === true } : {}),
  }));
}
