/**
 * LX-3B -- CONCEPT MISSION read boundary.
 *
 * The ONE server-side read for the Concept Mission screen. Presentation
 * + orchestration only: it decides NOTHING. It reads canonical outputs
 * that already exist (Phase 2.2 knowledge-state, Phase 4 LearningDecision,
 * Phase 6 memory via the Learner Twin, Phase 7 transfer depth) and hands
 * them to the pure `buildConceptMissionView` mapper.
 *
 * Mirrors the pattern of `learning-os-snapshot.service.ts` and
 * `remediation-session-view.ts`: one bounded view object, every decision
 * left with its canonical owner, failures degraded softly (never
 * fabricated).
 *
 * Deliberately does NOT call `getConceptExplanation` -- that generates
 * and persists AI content on a cache miss. The Mission only needs to
 * know whether an explanation is already cached (a cheap existence
 * check); the explanation itself is fetched lazily, on demand, by the
 * existing `/api/concepts/[id]/explanation` client flow.
 */
import { db, query } from '@/lib/db';
import { getConceptView } from '@/lib/learner-twin';
import { getConceptKnowledgeState } from '@/services/knowledge-state.service';
import { getBestLearningDecisionForConcept } from '@/services/adaptive-teaching.service';
import { getConceptTransferDepth } from '@/services/transfer-read.service';
import {
  buildConceptMissionView,
  type ConceptMissionView,
} from '@/lib/lx/concept-mission';

export type ConceptMissionViewResult =
  | { status: 'NOT_FOUND' }
  | { status: 'OK'; view: ConceptMissionView };

/**
 * `locale` only affects the concept LABEL / DESCRIPTION localization
 * lookup and which explanation cache row is checked -- same convention
 * as the concept-detail and today pages. It never changes which stage,
 * decision, or milestone is returned.
 */
export async function getConceptMissionView(
  studentId: string,
  subjectId: string,
  conceptId: string,
  locale: string,
  /** Pre-interpolated fallback goal copy (interface language), used only when the concept has no description. */
  goalFallbackText: string,
): Promise<ConceptMissionViewResult> {
  const conceptRow = await query(
    `SELECT s.name AS subject_name,
            COALESCE(cl.label, c.canonical_id) AS label,
            cl.description AS description
     FROM concepts c
     JOIN subjects s ON s.id = c.subject_id
     LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $3
     WHERE c.id = $1 AND c.subject_id = $2 AND s.student_id = $4`,
    [conceptId, subjectId, locale, studentId],
  );
  const row = conceptRow.rows[0];
  if (!row) return { status: 'NOT_FOUND' };

  const [conceptView, knowledgeState, learningDecision, transferDepth, explanationRow] = await Promise.all([
    getConceptView(studentId, conceptId).catch(() => null),
    getConceptKnowledgeState(studentId, conceptId).catch(() => null),
    // Same call chain and the same accepted background-write caveat as
    // the concept-detail page (6L-C1): `.catch(() => null)` so a failure
    // degrades to "no canonical action right now" rather than breaking
    // the Mission or fabricating a recommendation.
    getBestLearningDecisionForConcept(studentId, conceptId).catch(() => null),
    getConceptTransferDepth(db, studentId, conceptId).catch(() => null),
    query(
      `SELECT 1 FROM concept_explanations WHERE concept_id = $1 AND language = $2 LIMIT 1`,
      [conceptId, locale],
    ).catch(() => ({ rows: [] as unknown[] })),
  ]);

  const view = buildConceptMissionView({
    conceptName: row.label,
    subjectId,
    subjectName: row.subject_name,
    conceptDescription: row.description ?? null,
    goalFallbackText,
    knowledgeState: knowledgeState
      ? {
          masteryState: knowledgeState.masteryState,
          validationReadiness: knowledgeState.validationReadiness,
          evidenceCount: knowledgeState.evidenceCount,
          independentEvidenceCount: knowledgeState.independentEvidenceCount,
        }
      : null,
    learningDecision: learningDecision
      ? {
          activityType: learningDecision.activityType,
          actionConceptId: learningDecision.actionConceptId,
          learningState: learningDecision.learningState,
          facts: learningDecision.facts,
        }
      : null,
    memory: conceptView
      ? {
          lastSuccessfulRetentionAt: conceptView.memory.lastSuccessfulRetentionAt,
          retentionDue: conceptView.memory.retentionDue,
          memoryStatus: conceptView.memory.memoryStatus,
        }
      : null,
    transferDepth: transferDepth ?? null,
    hasCachedExplanation: (explanationRow.rows?.length ?? 0) > 0,
  });

  return { status: 'OK', view };
}
