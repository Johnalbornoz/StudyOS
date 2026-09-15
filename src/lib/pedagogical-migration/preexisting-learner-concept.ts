/**
 * CANON-R4R1 Part 5 -- PREEXISTING LEARNER-CONCEPT POPULATION.
 *
 * "A learner-concept is preexisting if authoritative StudyUS data shows
 * the learner had that concept in their learning history/state before
 * cutover" -- scoped PER (student_id, concept_id), never globally by
 * concept existence in the content catalog (Part 5's own explicit
 * warning).
 *
 * Split, like the rest of this module, into a PURE classification
 * function (testable with zero DB access) and a thin IO wrapper (the
 * actual Preview-execution query, not run in this environment).
 */
import { db } from '@/lib/db';

/** Pure. The one classification rule: real StudyUS evidence for this exact (student, concept) pair exists with a timestamp strictly before the cutover. Never "the concept is assigned/enrolled" -- only genuine learning history counts. */
export function isPreexistingLearnerConcept(earliestEvidenceAt: string | null, cutoverAt: string): boolean {
  if (earliestEvidenceAt == null) return false;
  return new Date(earliestEvidenceAt).getTime() < new Date(cutoverAt).getTime();
}

export interface PreexistingLearnerConceptPair {
  studentId: string;
  conceptId: string;
  earliestEvidenceAt: string;
}

/**
 * THE ACTUAL PREVIEW-EXECUTION QUERY. Read-only -- a single SELECT
 * against `learning_evidence`, grouped per (student, concept), scoped to
 * rows strictly before `cutoverAt`. Never called by any test in this
 * repository (no live DB in this environment).
 */
export async function loadPreexistingLearnerConceptPairs(cutoverAt: string, studentId?: string): Promise<PreexistingLearnerConceptPair[]> {
  const result = await db.query(
    `
    SELECT student_id, concept_id, MIN(timestamp) AS earliest_evidence_at
    FROM learning_evidence
    WHERE timestamp < $1
    ${studentId ? 'AND student_id = $2' : ''}
    GROUP BY student_id, concept_id
    `,
    studentId ? [cutoverAt, studentId] : [cutoverAt],
  );
  return result.rows.map((row: any) => ({
    studentId: row.student_id,
    conceptId: row.concept_id,
    earliestEvidenceAt: new Date(row.earliest_evidence_at).toISOString(),
  }));
}
