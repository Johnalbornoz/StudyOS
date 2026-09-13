/**
 * LX-9R1 -- CANONICAL PROGRESS PERCENTAGE.
 *
 * Live QA: a concept whose canonical journey had already reached RETAIN
 * showed "2% / Aprendiendo" on the subject detail page's concept row.
 * Root cause: that row's percentage/label came from the RAW
 * `mastery_score` column (via `masteryToPercent`) and the separate
 * `MasteryState` enum -- neither of which is the canonical learner
 * journey (LX-1B). `mastery_score`/`MasteryState` measure a genuinely
 * different thing (multidimensional evidence confidence) than "where is
 * this concept in LEARN -> PRACTICE -> PROVE -> RETAIN -> TRANSFER ->
 * CONSOLIDATED" -- a concept can legitimately have a low raw mastery
 * confidence number while its journey has already advanced past PROVE
 * into an obligation stage like RETAIN.
 *
 * This module is a PURE PRESENTATION projection, exactly like
 * `concept-journey.ts` before it: it takes the SAME canonical
 * `LearnerJourneyStage` every other learner-facing surface (My Path,
 * Concept Mission, Today) already reads (via
 * `path-view.ts::resolveConceptJourneyStage` /
 * `learner-journey-contract.ts::deriveLearnerJourneyStage`) and maps it
 * to a fixed, deterministic percentage + the SAME label vocabulary
 * Concept Mission's journey rail already uses
 * (`conceptMission.stage.*`). It computes NOTHING new about a learner's
 * competence, never reads a raw score, and never feeds back into
 * mastery/decisions -- it is read-only, one-way: canonical stage IN,
 * presentation OUT.
 */
import type { LearnerJourneyStage } from './learner-journey-contract';
import type { MessageKey } from '@/lib/i18n/messages';

export interface JourneyProgressPresentation {
  /** Deterministic completion of the canonical journey -- NEVER raw mastery/confidence/correctness. */
  progressPercent: number;
  /** Reuses Concept Mission's own existing stage vocabulary (`conceptMission.stage.*`) -- never a second set of labels that could drift out of sync. */
  progressLabelKey: MessageKey;
  currentStage: LearnerJourneyStage;
  isConsolidated: boolean;
}

/**
 * Fixed stage anchors (R4). Discrete, not manufactured from quiz count/
 * attempts/time spent (R5) -- StudyUS has no canonical intra-stage
 * progress signal today, so each stage gets one fixed value rather than
 * a fake decimal. Strictly increasing so every required ordering test
 * (LEARN < PRACTICE < PROVE < RETAIN < TRANSFER < CONSOLIDATED) holds by
 * construction, and RETAIN/TRANSFER -- open obligation stages reached
 * only after real prior progress -- always land comfortably above the
 * midpoint, never near-zero.
 */
const STAGE_PROGRESS_PERCENT: Record<LearnerJourneyStage, number> = {
  NOT_STARTED: 0,
  LEARN: 15,
  PRACTICE: 35,
  READY_TO_PROVE: 50,
  PROVE: 55,
  RETAIN: 70,
  TRANSFER: 85,
  CONSOLIDATED: 100,
};

/** R6: the label key for a stage is ALWAYS the one Concept Mission's own journey rail already renders for that exact stage -- structurally impossible to show a percentage from one stage paired with a label from another. */
function stageLabelKey(stage: LearnerJourneyStage): MessageKey {
  return `conceptMission.stage.${stage}` as MessageKey;
}

/**
 * The one canonical presentation function every learner-facing progress
 * percentage should call. Input is a canonical `LearnerJourneyStage`
 * ONLY -- never a score, count, or percentage of its own.
 */
export function deriveJourneyProgress(stage: LearnerJourneyStage): JourneyProgressPresentation {
  return {
    progressPercent: STAGE_PROGRESS_PERCENT[stage],
    progressLabelKey: stageLabelKey(stage),
    currentStage: stage,
    isConsolidated: stage === 'CONSOLIDATED',
  };
}

/**
 * R7: mean of canonical concept journey progress values -- the ONLY
 * sanctioned way to aggregate to a topic/subject level. `stages` must
 * be EVERY concept in the group (assigned, including NOT_STARTED ones)
 * -- silently excluding low-progress concepts to inflate the number is
 * exactly what this must never do. Returns null only for an empty
 * group (never a fabricated 0 that would look like "started and
 * failing" instead of "nothing to show").
 */
export function averageJourneyProgress(stages: LearnerJourneyStage[]): number | null {
  if (stages.length === 0) return null;
  const total = stages.reduce((sum, stage) => sum + STAGE_PROGRESS_PERCENT[stage], 0);
  return Math.round(total / stages.length);
}
