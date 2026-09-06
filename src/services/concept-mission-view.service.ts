/**
 * LX-3B / LX-3R -- CONCEPT MISSION read boundary.
 *
 * The ONE server-side read for the Concept Mission screen. Presentation
 * + orchestration only: it decides NOTHING. It reads canonical outputs
 * that already exist (Phase 2.2 knowledge-state, Phase 4 LearningDecision,
 * Phase 6 memory via the Learner Twin, Phase 7 transfer depth) and hands
 * them to the pure `buildConceptMissionView` mapper.
 *
 * Mirrors the pattern of `learning-os-snapshot.service.ts` and
 * `remediation-session-view.ts`: one bounded view object, every decision
 * left with its canonical owner, failures degraded honestly (never
 * fabricated).
 *
 * JOURNEY STATE (LX-3R). This boundary NEVER invents a `LearningState`.
 * It resolves one of exactly three ways and hands the pure builder a
 * discriminated `journeyInput`:
 *
 *   1. Phase 4 returned a LearningDecision  -> use decision.learningState
 *      (source LEARNING_DECISION).
 *   2. Phase 4 returned no decision for this concept (the call SUCCEEDED
 *      and the concept simply produced zero signals) -> call the
 *      CANONICAL pure policy `computeLearningState({ knowledgeState,
 *      signals: [] })` verbatim -- reused, never re-implemented. This is
 *      correct precisely because every signal-only precedence branch in
 *      `computeLearningState` corresponds to a state that WOULD have
 *      produced a decision; the remaining branches read only
 *      `knowledgeState`, which we have (source CANONICAL_POLICY_NO_SIGNALS).
 *   3. The decision read FAILED (threw) -> journeyInput { kind:
 *      'UNAVAILABLE' }. Canonical truth is genuinely unavailable; the
 *      Mission says so and shows no stage.
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
import { computeLearningState, type ConceptDecisionContext } from '@/lib/adaptive-learning-policy';
import type { ConceptKnowledgeState } from '@/services/knowledge-state.service';
import {
  buildConceptMissionView,
  type ConceptMissionJourneyInput,
  type ConceptMissionView,
} from '@/lib/lx/concept-mission';

export type ConceptMissionViewResult =
  | { status: 'NOT_FOUND' }
  | { status: 'OK'; view: ConceptMissionView };

type DecisionRead =
  | { status: 'OK'; decision: Awaited<ReturnType<typeof getBestLearningDecisionForConcept>> }
  | { status: 'READ_FAILED' };

/**
 * The minimal, ACCURATE `ConceptDecisionContext` for a concept the
 * orchestrator produced no decision for: it emitted zero signals, so
 * `signals: []` is truthful. `computeLearningState` reads only
 * `.knowledgeState` and `.signals` (see its own doc comment) -- passing
 * the canonical `knowledgeState` here is reuse of the canonical policy,
 * not a reconstruction of its rules.
 */
function zeroSignalContext(
  conceptId: string,
  subjectId: string,
  knowledgeState: ConceptKnowledgeState | null,
): ConceptDecisionContext {
  return {
    actionConceptId: conceptId,
    subjectId,
    knowledgeState,
    signals: [],
    targetConceptIds: [],
    remediationPathIds: [],
    diagnosisIds: [],
    occurrenceIds: [],
    calibrationConflictIds: [],
    verificationAttemptIds: [],
    quizSessionIds: [],
  };
}

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

  const [conceptView, knowledgeState, decisionRead, transferDepth, explanationRow] = await Promise.all([
    getConceptView(studentId, conceptId).catch(() => null),
    getConceptKnowledgeState(studentId, conceptId).catch(() => null),
    // The decision read's SUCCESS vs FAILURE is load-bearing (LX-3R):
    // a thrown read must not be silently converted into "no signals".
    getBestLearningDecisionForConcept(studentId, conceptId).then(
      (decision): DecisionRead => ({ status: 'OK', decision }),
      (): DecisionRead => ({ status: 'READ_FAILED' }),
    ),
    getConceptTransferDepth(db, studentId, conceptId).catch(() => null),
    query(
      `SELECT 1 FROM concept_explanations WHERE concept_id = $1 AND language = $2 LIMIT 1`,
      [conceptId, locale],
    ).catch(() => ({ rows: [] as unknown[] })),
  ]);

  const learningDecision = decisionRead.status === 'OK' ? decisionRead.decision : null;

  let journeyInput: ConceptMissionJourneyInput;
  if (decisionRead.status === 'READ_FAILED') {
    journeyInput = { kind: 'UNAVAILABLE' };
  } else if (decisionRead.decision) {
    journeyInput = { kind: 'RESOLVED', learningState: decisionRead.decision.learningState, source: 'LEARNING_DECISION' };
  } else {
    // Phase 4 succeeded and produced no decision -> zero signals for
    // this concept -> the canonical pure policy resolves the state from
    // knowledgeState alone.
    journeyInput = {
      kind: 'RESOLVED',
      learningState: computeLearningState(zeroSignalContext(conceptId, subjectId, knowledgeState)),
      source: 'CANONICAL_POLICY_NO_SIGNALS',
    };
  }

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
    journeyInput,
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
