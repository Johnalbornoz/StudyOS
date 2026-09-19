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
      CASE
        WHEN qs.quiz_mode = 'canonical_retain'
          AND qs.canonical_activity_contract->'novelty'->>'noveltyPolicy' = 'EXACT_DUPLICATE_EXCLUSION_V1'
          AND COALESCE(NULLIF(qs.canonical_activity_contract->'novelty'->>'acceptedNovelQuestionCount', '')::integer, 0)
              >= COALESCE(NULLIF(le.metadata->>'itemCount', '')::integer, 0)
        THEN true
        WHEN qs.quiz_mode = 'canonical_retain' THEN false
        ELSE NULL
      END AS novel,
      le.metadata->>'correctCount' AS correct_count,
      le.metadata->'transferChallenges' AS transfer_challenges,
      le.metadata->>'transferFailureDiagnostic' AS transfer_failure_diagnostic,
      EXISTS (
        SELECT 1 FROM student_misconceptions sm
        JOIN misconception_signatures ms ON ms.id = sm.misconception_signature_id
        WHERE sm.student_id = le.student_id
          AND ms.concept_id = le.concept_id
          AND ms.is_critical = true
          AND sm.evidence @> jsonb_build_array(jsonb_build_object('observedByEvidenceId', le.id::text))
      ) AS has_item_critical_misconception
    FROM learning_evidence le
    LEFT JOIN quiz_sessions qs
      ON split_part(le.operation_key, '::', 2) = qs.id
      AND qs.concept_id = le.concept_id
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
      // Retain evidence is novel only when the session's server-persisted
      // exact-duplicate filter recorded enough accepted novel items.
      novel: row.novel === true ? true : row.novel === false ? false : undefined,
      // CANON-V2-REMEDIATION Part 5 -- additive: NULL for every row until
      // a real canonical Transfer write path exists (none does yet --
      // see StudyUSEvidenceRow.transferChallenges's own grounding note).
      // jsonb columns come back already-parsed from `pg`, but this
      // codebase's own established defensive pattern (see
      // canonical-prepared-activity.service.ts's rowToPreparedActivity)
      // guards against a driver that ever returns the raw string instead.
      transferChallenges:
        row.transfer_challenges == null
          ? undefined
          : typeof row.transfer_challenges === 'string'
            ? JSON.parse(row.transfer_challenges)
            : row.transfer_challenges,
      transferFailureDiagnostic: row.transfer_failure_diagnostic ?? undefined,
      // CANON-V2-REMEDIATION Part 7 (AUDIT-005 closed): wired to the
      // REAL per-attempt link `mastery.service.ts`'s own `updateMastery`
      // already writes -- `recordStudentMisconception`'s
      // `observedByEvidenceId` parameter, persisted inside
      // `student_misconceptions.evidence` (a jsonb array of observation
      // records) in the SAME transaction as this `learning_evidence` row.
      // Deliberately NOT filtered by `sm.status = 'ACTIVE'` above: this
      // is an immutable historical fact ("was a critical misconception
      // detected DURING this specific attempt"), independent of whether
      // it was later resolved -- the GLOBAL, current-state gate
      // (`activeCriticalMisconception`) is what resolution actually
      // affects, never this per-attempt one.
      hasItemCriticalMisconception: row.has_item_critical_misconception === true,
    }),
  );
}
