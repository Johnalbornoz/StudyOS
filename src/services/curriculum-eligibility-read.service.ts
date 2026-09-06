/**
 * Phase 8 -- Step 8C1: a THIN canonical read of "which NOT_STARTED
 * concept comes next" per active subject.
 *
 * Phase 8 does NOT invent curriculum order. Ordering is the existing
 * curriculum outline: `topics.display_order` -> `subtopics.display_order`
 * -> `concepts.canonical_id`. "Eligible" = the concept has NO
 * `concept_knowledge_state` row for this student (never touched). The
 * caller (8D) additionally drops any concept for which Phase 4 is
 * currently emitting a `PREREQUISITE_GAP` signal -- prerequisite truth
 * stays a Phase 4 / concept-graph concern, never re-implemented here.
 *
 * No trusted `concept_relationships` graph exists in production (0
 * rows, AI-inferred only -- same finding as Phase 7 7G2), so there is
 * no prerequisite-order refinement here in 8C1: pure `display_order`
 * plus "not started" is the deterministic MVP. This limitation is
 * recorded as non-blocking debt.
 *
 * READ-ONLY. One batched query for the whole student. No writes, no AI.
 */
import { db, type DbExecutor } from '@/lib/db';

export interface EligibleCurriculumConcept {
  conceptId: string;
  subjectId: string;
  /** COALESCE(concept_localizations.label, concepts.canonical_id) is resolved by the caller when a display label is needed -- this read stays label-free. */
  canonicalId: string;
  topicDisplayOrder: number;
  subtopicDisplayOrder: number;
  /** Position within its subject's eligible list (1 = next). */
  rankInSubject: number;
}

/**
 * The next `perSubjectLimit` NOT_STARTED concepts for each ACTIVE
 * subject, in curriculum-outline order. ONE query.
 */
export async function getCurriculumEligibleConcepts(
  studentId: string,
  perSubjectLimit = 3,
  client: DbExecutor = db,
): Promise<EligibleCurriculumConcept[]> {
  const res = await client.query(
    `
    SELECT concept_id, subject_id, canonical_id, topic_display_order, subtopic_display_order, rank_in_subject
    FROM (
      SELECT
        c.id  AS concept_id,
        c.subject_id,
        c.canonical_id,
        COALESCE(t.display_order, 999999)  AS topic_display_order,
        COALESCE(st.display_order, 999999) AS subtopic_display_order,
        ROW_NUMBER() OVER (
          PARTITION BY c.subject_id
          ORDER BY COALESCE(t.display_order, 999999), COALESCE(st.display_order, 999999), c.canonical_id, c.id
        ) AS rank_in_subject
      FROM concepts c
      JOIN subjects s ON s.id = c.subject_id AND s.student_id = $1 AND s.status = 'active'
      LEFT JOIN subtopics st ON st.id = c.subtopic_id
      LEFT JOIN topics t ON t.id = st.topic_id
      WHERE NOT EXISTS (
        SELECT 1 FROM concept_knowledge_state cks
        WHERE cks.student_id = $1 AND cks.concept_id = c.id
      )
    ) ranked
    WHERE rank_in_subject <= $2
    ORDER BY subject_id, rank_in_subject
    `,
    [studentId, Math.max(1, Math.floor(perSubjectLimit))],
  );
  return res.rows.map((r) => ({
    conceptId: r.concept_id,
    subjectId: r.subject_id,
    canonicalId: r.canonical_id,
    topicDisplayOrder: Number(r.topic_display_order),
    subtopicDisplayOrder: Number(r.subtopic_display_order),
    rankInSubject: Number(r.rank_in_subject),
  }));
}
