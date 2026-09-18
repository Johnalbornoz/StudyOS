/**
 * LX-7 -- MY PATH VIEW CONTRACT.
 *
 * A server-side PRESENTATION projection of already-canonical state.
 * Every read here is an existing, reused service:
 *   - `getLearningOSSnapshot` (Phase 3E) -- the exact same read Today
 *     uses, so My Path's "current position" can never contradict
 *     Today (R20). Loaded once per render via `loadMyPathContext` and
 *     shared by both the overview and per-subject builders.
 *   - `getSubjectHierarchy` (topic-hierarchy.service) -- the existing,
 *     unchanged Subject -> Topic -> Concept structure (R3: knowledge
 *     architecture is not touched by LX-7).
 *   - `getSubjectKnowledgeState` (knowledge-state.service) -- one
 *     batched read per subject of the already-persisted MasteryState/
 *     ValidationReadiness.
 *   - `computeLearningState` + `zeroSignalContext` (adaptive-learning-
 *     policy.ts / concept-mission-view.service.ts) -- for any concept
 *     in the subject that has no active `LearningDecision` right now,
 *     this is the EXACT same fallback Concept Mission's own read
 *     boundary uses to resolve a `LearningState` from Knowledge State
 *     alone. Pure, no I/O -- safe to call once per concept.
 *   - `deriveLearnerJourneyStage` (LX-1B) -- the one canonical stage
 *     authority, shared with Concept Mission, turned into My Path's
 *     rendering line by `conceptJourneyFromResult` (concept-journey.ts).
 *
 * No adaptive decision is made or recomputed here (R4/R32) -- every
 * concept's stage is either read verbatim off its own active decision
 * or composed from the same two pure, already-certified functions
 * Concept Mission itself calls.
 */

import { db, query } from '@/lib/db';
import { getLearningOSSnapshot, loadConceptLabels, type LearningOSSnapshot } from '@/services/learning-os-snapshot.service';
import { getSubjectHierarchy, type SubjectHierarchy, type HierarchyConcept } from '@/services/topic-hierarchy.service';
import { getSubjectKnowledgeState, getConceptKnowledgeState, getActiveMasteryPolicy, type ConceptKnowledgeState } from '@/services/knowledge-state.service';
import { zeroSignalContext } from '@/services/concept-mission-view.service';
import { getTwinMemorySignalsForStudent, type TwinMemorySignal } from '@/services/memory-read.service';
import { rankLearningDecisions, computeLearningState, type LearningDecision } from '@/lib/adaptive-learning-policy';
import type { ActivityType } from '@/lib/activity-taxonomy';
import { deriveLearnerJourneyStage, conceptJourneyFromResult, type ConceptJourney, type LearnerJourneyStage } from './concept-journey';
import { isRetentionWaiting, LEARNER_JOURNEY_CONTRACT_VERSION, type LearnerJourneyResult } from './learner-journey-contract';
import { isZeroGapPracticeMismatch } from './evidence-sufficiency-contract';
import type { CanonicalActionState, CanonicalWaitingReason } from './canonical-learning-progress';
import {
  isCanonicalEngineV1Enabled,
  getCanonicalPedagogicalDecision,
  CanonicalDecisionUnavailableError,
} from '@/lib/pedagogical-decision';

export interface ConceptPathView {
  conceptId: string;
  title: string;
  journey: ConceptJourney;
  /** True for exactly one concept across the whole path -- the same concept Today would launch right now (R20). */
  isCurrent: boolean;
  hasEvidence: boolean;
}

export interface TopicPathView {
  topicId: string;
  title: string;
  concepts: ConceptPathView[];
}

export interface SubjectPathSummary {
  totalConcepts: number;
  inProgressCount: number;
  consolidatedCount: number;
  retentionDueCount: number;
  transferPendingCount: number;
  interventionCount: number;
}

export interface SubjectPathView {
  subjectId: string;
  title: string;
  topics: TopicPathView[];
  unassigned: ConceptPathView[];
  summary: SubjectPathSummary;
  /** Null when nothing in this subject currently has an active decision -- either fully consolidated or simply quiet right now; never a fabricated pick. */
  currentConceptId: string | null;
}

export interface CurrentPosition {
  subjectId: string;
  subjectTitle: string;
  conceptId: string;
  conceptTitle: string;
  /**
   * LX-9R5 PART A1: `null` whenever `actionState !== 'EXECUTABLE'`.
   * Stage RETAIN never implies "offer Practice" -- a LearningDecision
   * can exist for a concept whose canonical obligation (retention)
   * isn't due yet, and this field must never surface THAT decision's
   * own activityType as if it were the required next action.
   */
  activityType: ActivityType | null;
  estimatedMinutes: number;
  /** Provenance only (R30) -- never rendered to the learner. */
  reasonCode: string;
  decision: LearningDecision;
  /** Same ConceptJourney already computed for this concept inside its SubjectPathView -- never recomputed a second time. */
  journey: ConceptJourney;
  /** LX-9R5 PART B/A1: the canonical actionability of this concept, right now -- the ONE field My Path branches on before ever reading `activityType`. */
  actionState: CanonicalActionState;
  waitingReason: CanonicalWaitingReason | null;
  nextEligibleAt: string | null;
}

export type MyPathState = 'READY' | 'COLD' | 'NO_ACTIVE_SUBJECTS' | 'UNRESOLVED';

export interface SubjectSummaryCard {
  subjectId: string;
  title: string;
  summary: SubjectPathSummary;
}

export interface MyPathOverview {
  state: MyPathState;
  current: CurrentPosition | null;
  subjects: SubjectSummaryCard[];
  /** Full journey view for the subject holding `current`, when there is one -- lets the overview show a few "coming up" concepts (R5) without a second per-subject query. Null otherwise. */
  currentSubjectView: SubjectPathView | null;
}

export interface MyPathContext {
  studentId: string;
  locale: string;
  snapshot: LearningOSSnapshot | null;
  snapshotReadFailed: boolean;
  activeSubjects: { id: string; name: string }[];
  /** LX-9R5 PART A/B: one batched read for the whole student -- the SAME canonical Phase 6 memory facts Concept Mission's NOW card already gates its Retention CTA on (`isRetentionWaiting`). Never one query per concept. */
  memorySignals: Map<string, TwinMemorySignal>;
}

/** One shared read boundary for both the overview page and a subject page -- never called twice per render (mirrors Today's own single-snapshot discipline). */
export async function loadMyPathContext(studentId: string, locale: string): Promise<MyPathContext> {
  let snapshot: LearningOSSnapshot | null = null;
  let snapshotReadFailed = false;
  try {
    snapshot = await getLearningOSSnapshot(studentId, { preferredLanguage: locale });
  } catch (err) {
    snapshotReadFailed = true;
    console.error('[my-path] snapshot read failed:', err instanceof Error ? err.message : String(err));
  }

  let activeSubjects: { id: string; name: string }[] = [];
  try {
    const result = await query(`SELECT id, name FROM subjects WHERE student_id = $1 AND status != 'archived' ORDER BY name`, [studentId]);
    activeSubjects = result.rows;
  } catch (err) {
    snapshotReadFailed = true;
    console.error('[my-path] subject list read failed:', err instanceof Error ? err.message : String(err));
  }

  const memorySignals = await getTwinMemorySignalsForStudent(db, studentId).catch((err) => {
    console.error('[my-path] memory signal read failed:', err instanceof Error ? err.message : String(err));
    return new Map<string, TwinMemorySignal>();
  });

  return { studentId, locale, snapshot, snapshotReadFailed, activeSubjects, memorySignals };
}

/**
 * Resolves one concept's canonical LX-1B stage (the full 8-value
 * `LearnerJourneyStage`, before My Path's own 5-rung collapse).
 * `activeActivityType`/decision comes from the caller (the subject's
 * slice of the shared snapshot); when absent, this concept has zero
 * active signals right now, so `computeLearningState` is called with
 * the same zero-signal context Concept Mission's own read boundary
 * uses -- reused verbatim, never re-implemented.
 *
 * LX-9R1: exported so any OTHER learner-facing surface needing this
 * concept's canonical stage (e.g. the Subjects detail page's journey-
 * based progress percentage, `journey-progress.ts`) reads the EXACT
 * same authority My Path/Concept Mission already do -- never a second,
 * independently-derived stage that could disagree (R10).
 */
/**
 * LX-9R5 PART B: the one shared computation both `resolveConceptJourneyStage`
 * and `resolveConceptJourney` already ran independently (byte-identical
 * duplicated logic) -- factored out so a THIRD caller
 * (`canonical-learning-progress.ts`) can get the FULL result (including
 * `.intervention`) without a third copy of this exact composition.
 */
function resolveJourneyResult(
  conceptId: string,
  subjectId: string,
  ks: ConceptKnowledgeState | null,
  activeDecision: LearningDecision | undefined
) {
  const learningState = activeDecision ? activeDecision.learningState : computeLearningState(zeroSignalContext(conceptId, subjectId, ks));
  return deriveLearnerJourneyStage({
    learningState,
    masteryState: ks?.masteryState ?? null,
    validationReadiness: ks?.validationReadiness ?? null,
  });
}

export function resolveConceptJourneyStage(
  conceptId: string,
  subjectId: string,
  ks: ConceptKnowledgeState | null,
  activeDecision: LearningDecision | undefined
): LearnerJourneyStage {
  return resolveJourneyResult(conceptId, subjectId, ks, activeDecision).stage;
}

/**
 * LX-9R5 PART B: exported so `canonical-learning-progress.ts` can read
 * `.intervention` alongside `.stage` without re-deriving either --
 * the exact same authority `resolveConceptJourneyStage` above and
 * Concept Mission's own `deriveLearnerJourneyStage` call already use.
 *
 * PROD-02 REMEDIATION (AUDIT-006 closed for this authority): this
 * function, and `resolveConceptJourneyStage` above, remain the LEGACY
 * (pre-Canonical-V2) computation, exactly as before -- unchanged, so
 * `canonical-learning-progress.ts` and the shadow snapshot
 * (`old-canonical-snapshot.ts`) keep their existing, pure, synchronous
 * behavior for the feature-gate-off path. The canonical-aware
 * authority every LEARNER-FACING caller must use instead is
 * `resolveConceptJourneyResultAuthoritative` below.
 */
export function resolveConceptJourneyResult(
  conceptId: string,
  subjectId: string,
  ks: ConceptKnowledgeState | null,
  activeDecision: LearningDecision | undefined
) {
  return resolveJourneyResult(conceptId, subjectId, ks, activeDecision);
}

/**
 * PROD-02 ROOT-CAUSE FIX -- SINGLE SOURCE OF TRUTH for every
 * LEARNER-FACING journey-stage read in this module (My Path, and the
 * Subjects detail page via the exported wrapper below).
 *
 * When the Canonical V2 gate is on, the legacy computation above
 * (`resolveJourneyResult` -> `computeLearningState` -> Phase 2.2
 * Knowledge State's `validationReadiness`) is NEVER consulted for the
 * learner-facing stage -- exactly the CV2-08 discipline
 * (`learning-continuation.service.ts`'s `resolveCanonicalContinuation`)
 * applied here to a second, previously-unwired surface. This is the
 * confirmed PROD-02 mechanism: a concept with ZERO PROVE/SOLO evidence
 * can legitimately reach legacy `validationReadiness ===
 * 'WAITING_FOR_RETENTION'` the moment ordinary PRACTICE evidence
 * satisfies generic sufficiency and no retention evidence exists yet
 * (`determineValidationReadiness`'s own documented behavior --
 * unrelated to whether PROVE ever happened) -- which legacy
 * `computeLearningState` then reads as `RETENTION_RISK`, and
 * `deriveLearnerJourneyStage` as `RETAIN`. Reusing the EXISTING
 * `getCanonicalPedagogicalDecision` engine (never a second
 * implementation of its rules) guarantees PROVE is only ever reported
 * satisfied when Canonical V2 itself says so.
 *
 * A read failure (`CanonicalDecisionUnavailableError`) degrades to the
 * legacy result -- never a canonical-looking guess -- matching every
 * other canonical-aware call site's existing fail-safe discipline.
 */
async function resolveJourneyResultAuthoritative(
  studentId: string,
  conceptId: string,
  subjectId: string,
  ks: ConceptKnowledgeState | null,
  activeDecision: LearningDecision | undefined
): Promise<LearnerJourneyResult> {
  if (isCanonicalEngineV1Enabled()) {
    try {
      const { decision } = await getCanonicalPedagogicalDecision({ studentId, conceptId });
      return {
        // `PedagogicalStage` (LEARN|PRACTICE|PROVE|RETAIN|TRANSFER|CONSOLIDATED)
        // is a literal subset of `LearnerJourneyStage` -- the SAME
        // direct assignment `progress-overview.service.ts`'s own
        // canonical override already uses, never a second mapping
        // table.
        stage: decision.stage,
        intervention: decision.intervention,
        reason: 'CANONICAL_ENGINE_V1',
        contractVersion: LEARNER_JOURNEY_CONTRACT_VERSION,
      };
    } catch (error) {
      if (!(error instanceof CanonicalDecisionUnavailableError)) throw error;
    }
  }
  return resolveJourneyResult(conceptId, subjectId, ks, activeDecision);
}

/**
 * THE authoritative, canonical-aware journey result -- the function
 * every learner-facing surface needing a concept's stage must call
 * (Subjects detail page's `HierarchicalConceptList`/journey badges,
 * and, via `resolveConceptJourneyAuthoritative` below, My Path).
 * `resolveConceptJourneyResult` above stays legacy-only and untouched
 * for the two non-learner-facing/gate-off callers that still use it.
 */
export async function resolveConceptJourneyResultAuthoritative(
  studentId: string,
  conceptId: string,
  subjectId: string,
  ks: ConceptKnowledgeState | null,
  activeDecision: LearningDecision | undefined
): Promise<LearnerJourneyResult> {
  return resolveJourneyResultAuthoritative(studentId, conceptId, subjectId, ks, activeDecision);
}

/** Adapts `resolveConceptJourneyResultAuthoritative`'s result into My Path's flat rendering line -- the canonical-aware replacement for the old, legacy-only `resolveConceptJourney`. */
async function resolveConceptJourneyAuthoritative(
  studentId: string,
  conceptId: string,
  subjectId: string,
  ks: ConceptKnowledgeState | null,
  activeDecision: LearningDecision | undefined
): Promise<ConceptJourney> {
  return conceptJourneyFromResult(await resolveJourneyResultAuthoritative(studentId, conceptId, subjectId, ks, activeDecision));
}

function summarize(concepts: ConceptPathView[]): SubjectPathSummary {
  const summary: SubjectPathSummary = {
    totalConcepts: concepts.length,
    inProgressCount: 0,
    consolidatedCount: 0,
    retentionDueCount: 0,
    transferPendingCount: 0,
    interventionCount: 0,
  };
  for (const c of concepts) {
    if (c.journey.intervention) summary.interventionCount++;
    if (c.journey.consolidated) summary.consolidatedCount++;
    else summary.inProgressCount++;
    if (c.journey.currentStage === 'RETAIN') summary.retentionDueCount++;
    if (c.journey.currentStage === 'TRANSFER') summary.transferPendingCount++;
  }
  return summary;
}

/**
 * LX-7R1: the ONE place that decides "what is this subject's current
 * canonical action, if any" -- reused by both `buildSubjectPathView`
 * below and any other learner-facing surface (e.g. the Subjects detail
 * page's CTA) that needs a subject-scoped action. Never an independent
 * recommendation algorithm: it only filters and ranks the SAME
 * `LearningDecision[]` Today/My Path already read off the shared
 * snapshot, preferring the globally-best concept when it happens to
 * belong to this subject so a subject-scoped surface can never disagree
 * with Today/My Path about the same concept (R20/B6).
 */
export function resolveSubjectCurrentDecision(snapshot: LearningOSSnapshot | null, subjectId: string): LearningDecision | null {
  if (!snapshot) return null;
  const subjectDecisions = rankLearningDecisions(snapshot.decisions.filter((d) => d.subjectId === subjectId));
  if (subjectDecisions.length === 0) return null;
  const globalCurrentConceptId = snapshot.nextExecutableItem?.decision.actionConceptId ?? null;
  const preferred = globalCurrentConceptId ? subjectDecisions.find((d) => d.actionConceptId === globalCurrentConceptId) : undefined;
  return preferred ?? subjectDecisions[0];
}

/**
 * Full Topic -> Concept journey for one subject. `currentConceptId`
 * prefers the globally-best concept from the shared snapshot when it
 * belongs to this subject, so the SAME concept is marked current on
 * both the overview page and this subject's page.
 */
export async function buildSubjectPathView(context: MyPathContext, subjectId: string, subjectTitle: string): Promise<SubjectPathView> {
  const { studentId, locale, snapshot } = context;

  const [hierarchy, knowledgeStates]: [SubjectHierarchy, ConceptKnowledgeState[]] = await Promise.all([
    getSubjectHierarchy(subjectId, studentId, locale).catch(() => ({ topics: [], unassigned: [] })),
    getSubjectKnowledgeState(studentId, subjectId).catch(() => []),
  ]);
  const ksByConceptId = new Map(knowledgeStates.map((ks) => [ks.conceptId, ks]));

  const subjectDecisions = snapshot ? rankLearningDecisions(snapshot.decisions.filter((d) => d.subjectId === subjectId)) : [];
  const decisionByConceptId = new Map(subjectDecisions.map((d) => [d.actionConceptId, d]));
  const currentConceptId = resolveSubjectCurrentDecision(snapshot, subjectId)?.actionConceptId ?? null;

  const toConceptView = async (concept: HierarchyConcept): Promise<ConceptPathView> => ({
    conceptId: concept.id,
    title: concept.label,
    journey: await resolveConceptJourneyAuthoritative(
      studentId,
      concept.id,
      subjectId,
      ksByConceptId.get(concept.id) ?? null,
      decisionByConceptId.get(concept.id)
    ),
    isCurrent: concept.id === currentConceptId,
    hasEvidence: concept.hasEvidence,
  });

  const topics: TopicPathView[] = await Promise.all(
    hierarchy.topics.map(async (topic) => ({
      topicId: topic.id,
      title: topic.name,
      concepts: (
        await Promise.all(topic.subtopics.flatMap((subtopic) => subtopic.concepts.map(toConceptView)))
      ),
    }))
  );
  const unassigned = await Promise.all(hierarchy.unassigned.map(toConceptView));

  const allConcepts = [...topics.flatMap((t) => t.concepts), ...unassigned];

  return {
    subjectId,
    title: subjectTitle,
    topics,
    unassigned,
    summary: summarize(allConcepts),
    currentConceptId,
  };
}

/**
 * Cross-subject overview: the single current-position hero (identical
 * authority to Today's `nextExecutableItem`) plus a lightweight
 * per-subject summary card for every active subject. Calls
 * `buildSubjectPathView` once per active subject (bounded by how many
 * subjects a student has, never per-concept) -- see LX-7 report R33
 * for the N+1 audit at subject-count scale.
 */
export async function buildMyPathOverview(context: MyPathContext): Promise<MyPathOverview> {
  const { snapshot, snapshotReadFailed, activeSubjects } = context;

  if (snapshotReadFailed) return { state: 'UNRESOLVED', current: null, subjects: [], currentSubjectView: null };
  if (activeSubjects.length === 0) return { state: 'NO_ACTIVE_SUBJECTS', current: null, subjects: [], currentSubjectView: null };

  const subjectViews = await Promise.all(activeSubjects.map((s) => buildSubjectPathView(context, s.id, s.name)));
  const subjects: SubjectSummaryCard[] = subjectViews.map((v) => ({ subjectId: v.subjectId, title: v.title, summary: v.summary }));

  const best = snapshot?.nextExecutableItem ?? null;
  let current: CurrentPosition | null = null;
  if (best) {
    const label = snapshot!.conceptLabels.get(best.decision.actionConceptId);
    const subject = activeSubjects.find((s) => s.id === best.decision.subjectId);
    const heroConcept = subjectViews
      .flatMap((v) => [...v.topics.flatMap((t) => t.concepts), ...v.unassigned])
      .find((c) => c.conceptId === best.decision.actionConceptId);
    const journey =
      heroConcept?.journey ??
      (await resolveConceptJourneyAuthoritative(context.studentId, best.decision.actionConceptId, best.decision.subjectId, null, best.decision));
    // LX-9R5 PART A1/D: never trust `best.decision.activityType` on its
    // own -- a LearningDecision can exist (and be genuinely the "best"
    // ranked one) for a concept whose canonical obligation (RETAIN)
    // isn't due yet; `selectActivityType`'s own residual fallthrough can
    // independently resolve to PRACTICE for that same concept with no
    // awareness that it isn't actionable. Gate on the SAME
    // `isRetentionWaiting` check Concept Mission's NOW card already
    // uses. An active REINFORCE intervention is the ONE explicit,
    // canonical exception (Part D) -- a blocking misconception/
    // prerequisite/repair genuinely makes Practice/Remediation
        // executable even though it can co-occur with other stage facts.
    const memorySignal = context.memorySignals.get(best.decision.actionConceptId);
    const waiting = !journey.intervention && isRetentionWaiting(journey.currentStage, memorySignal?.retentionDue);
    // LX-9R8 PART A1/A5: a PRACTICE/REVIEW decision whose canonical
    // evidence gap is already 0, with no REINFORCE intervention, is NOT
    // executable -- selectActivityType's qualitative fallthrough
    // (masteryState/understandingScore) never checked the quantitative
    // evidence count. Checked here, alongside the existing WAITING gate,
    // before My Path can ever offer this CTA.
    const [zeroGapKs, zeroGapPolicy] = await Promise.all([
      getConceptKnowledgeState(context.studentId, best.decision.actionConceptId).catch(() => null),
      getActiveMasteryPolicy().catch(() => null),
    ]);
    const zeroGapMismatch =
      !waiting &&
      !!zeroGapPolicy &&
      isZeroGapPracticeMismatch({
        activityType: best.decision.activityType,
        hasReinforceIntervention: journey.intervention === 'REINFORCE',
        currentSufficiency: zeroGapKs
          ? {
              evidenceCount: zeroGapKs.evidenceCount,
              independentEvidenceCount: zeroGapKs.independentEvidenceCount,
              passed:
                zeroGapKs.evidenceCount >= zeroGapPolicy.minimumEvidenceCount &&
                zeroGapKs.independentEvidenceCount >= zeroGapPolicy.minimumIndependentEvidenceCount,
            }
          : null,
        masteryPolicy: zeroGapPolicy,
      });
    const actionState: CanonicalActionState = journey.consolidated ? 'CONSOLIDATED' : waiting ? 'WAITING' : zeroGapMismatch ? 'BLOCKED' : 'EXECUTABLE';
    current = {
      subjectId: best.decision.subjectId,
      subjectTitle: subject?.name ?? label?.subjectName ?? '',
      conceptId: best.decision.actionConceptId,
      conceptTitle: label?.label ?? best.decision.actionConceptId,
      activityType: actionState === 'EXECUTABLE' ? best.decision.activityType : null,
      estimatedMinutes: best.estimatedMinutes,
      reasonCode: best.decision.reasonCode,
      decision: best.decision,
      journey,
      actionState,
      waitingReason: actionState === 'WAITING' ? 'RETENTION_NOT_DUE' : null,
      nextEligibleAt: actionState === 'WAITING' ? memorySignal?.nextReviewAt ?? null : null,
    };
  }

  // Step 6L-A-style cold check (see today-view.ts): a brand-new profile
  // with zero evidence anywhere is a different, calmer state than "no
  // active decision right now" -- a plain existence check over the
  // per-concept `hasEvidence` flag already returned by
  // getSubjectHierarchy, never a new heuristic.
  const hasAnyEvidence = subjectViews.some((v) =>
    [...v.topics.flatMap((t) => t.concepts), ...v.unassigned].some((c) => c.hasEvidence)
  );

  const currentSubjectView = current ? (subjectViews.find((v) => v.subjectId === current!.subjectId) ?? null) : null;

  if (!current && !hasAnyEvidence) return { state: 'COLD', current: null, subjects, currentSubjectView: null };
  return { state: 'READY', current, subjects, currentSubjectView };
}

export { loadConceptLabels };
