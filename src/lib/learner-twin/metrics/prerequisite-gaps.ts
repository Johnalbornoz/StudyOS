/**
 * Phase 1E, Steps 11-12: Learner-Specific Prerequisite Gaps (student +
 * concept).
 *
 * Derives learner-specific gaps from the EXISTING global concept graph
 * (concept_relationships, via concept-graph.service.ts::getPrerequisites
 * -- reused, not duplicated) plus the learner's own mastery/Knowledge
 * State. No new table.
 *
 * Step 12 (release-blocking for correctness): no arbitrary weighting
 * such as `relationshipConfidence * (100 - mastery)` was invented. The
 * source audit found no existing StudyUs policy defining a numeric
 * "prerequisite mastery threshold" anywhere (mastery_policies' own
 * thresholds are per-dimension Knowledge State cutoffs, not
 * prerequisite-specific). Instead, `gap` reuses the prerequisite's own
 * ALREADY-CERTIFIED MasteryState classification (produced by the real
 * Knowledge State projector using the real mastery_policies
 * thresholds): a gap exists when that classification is below
 * PROVISIONAL_MASTERY, or when no Knowledge State row exists at all.
 * The raw score/state are always exposed alongside `gap`, so no
 * information is hidden behind the boolean.
 */
import { db } from '@/lib/db';
import { getPrerequisites } from '@/services/concept-graph.service';
import type { MasteryState } from '@/services/knowledge-state.service';
import {
  type PrerequisiteGapDetail,
  type PrerequisiteGapsSummary,
  type MetricResult,
  PREREQUISITE_GAP_MODEL_VERSION,
  metricAvailable,
  metricUnavailable,
  quality,
} from './types';

const MASTERED_STATES: ReadonlySet<MasteryState> = new Set(['PROVISIONAL_MASTERY', 'VALIDATED_MASTERY']);

export async function readPrerequisiteGaps(studentId: string, targetConceptId: string): Promise<MetricResult<PrerequisiteGapsSummary>> {
  const prerequisites = await getPrerequisites(targetConceptId);
  if (prerequisites.length === 0) {
    return metricUnavailable('NOT_APPLICABLE', 'This concept has no prerequisite relationships in the concept graph.');
  }

  const prereqIds = prerequisites.map((p) => p.sourceConceptId);

  const [labelsResult, masteryResult, stateResult] = await Promise.all([
    db.query<{ id: string; label: string }>(
      `SELECT c.id, COALESCE(cl.label, c.canonical_id) AS label
       FROM concepts c LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = 'en'
       WHERE c.id = ANY($1)`,
      [prereqIds]
    ),
    db.query<{ concept_id: string; mastery_score: string }>(
      `SELECT concept_id, mastery_score FROM mastery_records WHERE student_id = $1 AND concept_id = ANY($2)`,
      [studentId, prereqIds]
    ),
    db.query<{ concept_id: string; mastery_state: MasteryState }>(
      `SELECT concept_id, mastery_state FROM concept_knowledge_state WHERE student_id = $1 AND concept_id = ANY($2)`,
      [studentId, prereqIds]
    ),
  ]);

  const labels = new Map(labelsResult.rows.map((r) => [r.id, r.label]));
  const masteryByPrereq = new Map(masteryResult.rows.map((r) => [r.concept_id, Number(r.mastery_score)]));
  const stateByPrereq = new Map(stateResult.rows.map((r) => [r.concept_id, r.mastery_state]));

  const gaps: PrerequisiteGapDetail[] = prerequisites.map((rel) => {
    const state = stateByPrereq.get(rel.sourceConceptId) ?? null;
    return {
      targetConceptId,
      prerequisiteConceptId: rel.sourceConceptId,
      prerequisiteLabel: labels.get(rel.sourceConceptId) ?? rel.sourceConceptId,
      relationshipConfidence: rel.confidence,
      prerequisiteMasteryScore: masteryByPrereq.get(rel.sourceConceptId) ?? null,
      prerequisiteMasteryState: state,
      gap: state === null || !MASTERED_STATES.has(state),
    };
  });

  return metricAvailable({
    gaps,
    gapCount: gaps.filter((g) => g.gap).length,
    totalPrerequisiteCount: gaps.length,
    quality: quality(gaps.length, null, PREREQUISITE_GAP_MODEL_VERSION),
  });
}
