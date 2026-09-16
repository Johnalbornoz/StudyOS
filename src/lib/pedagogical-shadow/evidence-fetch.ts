/**
 * CANON-R5 Part 7 -- THE ONE real-evidence fetch for one (student,
 * concept).
 *
 * Extracted verbatim from `scripts/canon-r3-shadow-compare.ts`'s own
 * `loadEvidenceRows` (CANON-R3), which until this phase was the only
 * place in the repository that queried `learning_evidence` for the
 * shadow/migration layers. CANON-R5 Part 7: "Reuse CANON-R3 adapter. Do
 * not create another mapping from learning_evidence." -- the canonical
 * decision service (`src/lib/pedagogical-decision/`) needs the exact
 * same real evidence rows the shadow CLI already fetches, so this moves
 * the ONE query into the shared library instead of duplicating it a
 * second time. The SQL, column list, and row mapping are byte-identical
 * to the original CLI copy -- this is a relocation, not a behavior
 * change. `scripts/canon-r3-shadow-compare.ts` is updated in this same
 * phase to import this function instead of keeping its own copy.
 *
 * Read-only. One SELECT against `learning_evidence`, LEFT JOINed
 * against `decision_events` for the historical fallback item count
 * (`reason_details->>'sampleSize'`) pre-v1 rows persist there (see
 * src/services/mastery.service.ts's own `recordDecisionEvent` call --
 * `learning_evidence` itself has no dedicated item-count COLUMN). Never
 * writes.
 *
 * CANON-R5R1 Part 4/7 -- a genuinely v1-stamped row (generate-and-take's
 * submission write, when a trusted quiz_sessions v1 marker was present)
 * stamps `metadata.itemCount`/`metadata.correctCount` DIRECTLY --
 * `COALESCE(le.metadata->>'itemCount', de.reason_details->>'sampleSize')`
 * below prefers that direct value when present, falling back to the
 * decision_events join only for older/non-v1 rows that never had it.
 * Never "buried exclusively in decision_events" for new v1 evidence,
 * per this phase's own instruction.
 */
import { db, type DbExecutor } from '@/lib/db';
import type { StudyUSEvidenceRow } from './types';

export async function fetchStudyUSEvidenceRows(
  studentId: string,
  conceptId: string,
  client: DbExecutor = db,
): Promise<StudyUSEvidenceRow[]> {
  const result = await client.query(
    `
    SELECT
      le.id,
      le.source_type,
      le.result,
      le.score_percent,
      le.difficulty,
      le.timestamp,
      le.hints_used,
      le.ai_assistance_type,
      le.metadata->>'activityType' AS activity_type,
      COALESCE(le.metadata->>'itemCount', de.reason_details->>'sampleSize') AS item_count,
      le.metadata->>'correctCount' AS correct_count
    FROM learning_evidence le
    LEFT JOIN decision_events de
      ON de.source_event_type = 'learning_evidence'
      AND de.source_event_id = le.id
      AND de.decision_type = 'MASTERY_UPDATED'
    WHERE le.student_id = $1 AND le.concept_id = $2
    ORDER BY le.timestamp ASC
    `,
    [studentId, conceptId],
  );
  return result.rows.map(
    (row: any): StudyUSEvidenceRow => ({
      id: row.id,
      sourceType: row.source_type,
      result: row.result,
      scorePercent: row.score_percent !== null ? Number(row.score_percent) : null,
      difficulty: Number(row.difficulty),
      timestamp: new Date(row.timestamp).toISOString(),
      hintsUsed: row.hints_used ?? 0,
      aiAssistanceType: row.ai_assistance_type ?? 'NONE',
      activityType: row.activity_type ?? null,
      itemCount: row.item_count != null ? Number(row.item_count) : undefined,
      correctCount: row.correct_count != null ? Number(row.correct_count) : undefined,
    }),
  );
}
