/**
 * CANON-R3 Part 16 -- THE OLD CANONICAL SNAPSHOT ADAPTER.
 *
 * This module NEVER reimplements the current canonical model. Every
 * fact in an `OldCanonicalSnapshot` is composed EXCLUSIVELY from
 * already-existing, already-shipped canonical authorities:
 *   - `getConceptKnowledgeState` / `getActiveMasteryPolicy`
 *     (src/services/knowledge-state.service.ts) -- the only real DB
 *     reads this module performs, both pre-existing SELECT-only
 *     functions, called verbatim.
 *   - `resolveConceptJourneyResult` (src/lib/lx/path-view.ts) and
 *     `buildCanonicalLearningProgress` (src/lib/lx/canonical-learning-progress.ts)
 *     -- the SAME pure composition functions My Path / Concept Mission
 *     / Today already call.
 *
 * Split into a PURE composition function (`buildOldCanonicalSnapshot`,
 * testable with zero DB access) and a thin IO wrapper
 * (`fetchOldCanonicalSnapshot`, the actual Preview-execution entry
 * point -- see docs/CANON_R3_SHADOW_INTEGRATION.md's COMMANDS FOR
 * PREVIEW section for exactly how it is meant to be run once Preview DB
 * access exists).
 *
 * A field the current model does not resolve cleanly (most notably
 * `nextAction`, which requires a full Phase 4 `LearningDecision` this
 * module does not itself compute -- reproducing the Phase 4
 * orchestrator here would be exactly the "reimplementing instead of
 * calling" this module must never do) is reported as `null`
 * (UNAVAILABLE), never guessed.
 */
import { getConceptKnowledgeState, getActiveMasteryPolicy, type ConceptKnowledgeState, type MasteryPolicy } from '@/services/knowledge-state.service';
import { resolveConceptJourneyResult } from '@/lib/lx/path-view';
import { buildCanonicalLearningProgress } from '@/lib/lx/canonical-learning-progress';
import type { LearningDecision } from '@/lib/adaptive-learning-policy';
import type { OldCanonicalSnapshot } from './types';

export interface OldCanonicalSnapshotInput {
  conceptId: string;
  subjectId: string;
  knowledgeState: ConceptKnowledgeState | null;
  masteryPolicy: MasteryPolicy;
  /**
   * The real Phase 4 decision for this concept, WHEN a caller has one
   * already fetched (e.g. from `getLearningDecisions`). Optional and
   * commonly absent in this phase's own tooling, since running the full
   * Phase 4 orchestrator is a much larger IO surface than a read-only
   * shadow-comparison CLI needs to pull in; its absence is reported
   * honestly (`nextAction: null`) rather than approximated.
   */
  activeDecision?: LearningDecision;
  memory?: { retentionDue: boolean; nextReviewAt: string | null } | null;
}

/** Pure. No IO. Testable with synthetic fixtures -- exactly how CANON-R3's own test suite exercises it. */
export function buildOldCanonicalSnapshot(input: OldCanonicalSnapshotInput): OldCanonicalSnapshot {
  const journeyResult = resolveConceptJourneyResult(input.conceptId, input.subjectId, input.knowledgeState, input.activeDecision);
  const progress = buildCanonicalLearningProgress({
    conceptId: input.conceptId,
    subjectId: input.subjectId,
    knowledgeState: input.knowledgeState,
    activeDecision: input.activeDecision,
    memory: input.memory,
    masteryPolicy: input.masteryPolicy,
  });

  return {
    stage: journeyResult.stage,
    actionState: progress.actionState,
    // Honest UNAVAILABLE, never guessed: `buildCanonicalLearningProgress`
    // itself already refuses to report a next action unless a REAL
    // Phase 4 decision made it EXECUTABLE -- this module simply passes
    // that through verbatim.
    nextAction: progress.nextCanonicalAction,
    progressPercent: progress.journeyProgressPercent,
    validationReadiness: input.knowledgeState?.validationReadiness ?? null,
    sourceAuthorities: [
      'knowledge-state.service.ts::getConceptKnowledgeState',
      'knowledge-state.service.ts::getActiveMasteryPolicy',
      'path-view.ts::resolveConceptJourneyResult',
      'canonical-learning-progress.ts::buildCanonicalLearningProgress',
    ],
  };
}

/**
 * THE ACTUAL PREVIEW-EXECUTION ENTRY POINT. Read-only: exactly two
 * SELECT-only calls, both to pre-existing, unmodified functions. Never
 * called by any test in this repository (no live DB in this
 * environment) -- documented here, and in the CANON-R3 report's
 * COMMANDS FOR PREVIEW section, as the exact call a future
 * Preview-connected session should make.
 */
export async function fetchOldCanonicalSnapshot(
  studentId: string,
  conceptId: string,
  subjectId: string,
  activeDecision?: LearningDecision,
): Promise<OldCanonicalSnapshot> {
  const [knowledgeState, masteryPolicy] = await Promise.all([
    getConceptKnowledgeState(studentId, conceptId),
    getActiveMasteryPolicy(),
  ]);
  return buildOldCanonicalSnapshot({ conceptId, subjectId, knowledgeState, masteryPolicy, activeDecision });
}
