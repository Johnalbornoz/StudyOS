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

import { query } from '@/lib/db';
import { getLearningOSSnapshot, loadConceptLabels, type LearningOSSnapshot } from '@/services/learning-os-snapshot.service';
import { getSubjectHierarchy, type SubjectHierarchy, type HierarchyConcept } from '@/services/topic-hierarchy.service';
import { getSubjectKnowledgeState, type ConceptKnowledgeState } from '@/services/knowledge-state.service';
import { zeroSignalContext } from '@/services/concept-mission-view.service';
import { rankLearningDecisions, computeLearningState, type LearningDecision } from '@/lib/adaptive-learning-policy';
import type { ActivityType } from '@/lib/activity-taxonomy';
import { deriveLearnerJourneyStage, conceptJourneyFromResult, type ConceptJourney } from './concept-journey';

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
  activityType: ActivityType;
  estimatedMinutes: number;
  /** Provenance only (R30) -- never rendered to the learner. */
  reasonCode: string;
  decision: LearningDecision;
  /** Same ConceptJourney already computed for this concept inside its SubjectPathView -- never recomputed a second time. */
  journey: ConceptJourney;
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

  return { studentId, locale, snapshot, snapshotReadFailed, activeSubjects };
}

/**
 * Resolves one concept's journey. `activeActivityType`/decision comes
 * from the caller (the subject's slice of the shared snapshot); when
 * absent, this concept has zero active signals right now, so
 * `computeLearningState` is called with the same zero-signal context
 * Concept Mission's own read boundary uses -- reused verbatim, never
 * re-implemented.
 */
function resolveConceptJourney(
  conceptId: string,
  subjectId: string,
  ks: ConceptKnowledgeState | null,
  activeDecision: LearningDecision | undefined
): ConceptJourney {
  const learningState = activeDecision ? activeDecision.learningState : computeLearningState(zeroSignalContext(conceptId, subjectId, ks));
  const result = deriveLearnerJourneyStage({
    learningState,
    masteryState: ks?.masteryState ?? null,
    validationReadiness: ks?.validationReadiness ?? null,
  });
  return conceptJourneyFromResult(result);
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
  const globalCurrentConceptId = snapshot?.nextExecutableItem?.decision.actionConceptId ?? null;
  const subjectHasGlobalCurrent = globalCurrentConceptId != null && decisionByConceptId.has(globalCurrentConceptId);
  const currentConceptId = subjectHasGlobalCurrent ? globalCurrentConceptId : (subjectDecisions[0]?.actionConceptId ?? null);

  const toConceptView = (concept: HierarchyConcept): ConceptPathView => ({
    conceptId: concept.id,
    title: concept.label,
    journey: resolveConceptJourney(concept.id, subjectId, ksByConceptId.get(concept.id) ?? null, decisionByConceptId.get(concept.id)),
    isCurrent: concept.id === currentConceptId,
    hasEvidence: concept.hasEvidence,
  });

  const topics: TopicPathView[] = hierarchy.topics.map((topic) => ({
    topicId: topic.id,
    title: topic.name,
    concepts: topic.subtopics.flatMap((subtopic) => subtopic.concepts.map(toConceptView)),
  }));
  const unassigned = hierarchy.unassigned.map(toConceptView);

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
    current = {
      subjectId: best.decision.subjectId,
      subjectTitle: subject?.name ?? label?.subjectName ?? '',
      conceptId: best.decision.actionConceptId,
      conceptTitle: label?.label ?? best.decision.actionConceptId,
      activityType: best.decision.activityType,
      estimatedMinutes: best.estimatedMinutes,
      reasonCode: best.decision.reasonCode,
      decision: best.decision,
      journey: heroConcept?.journey ?? resolveConceptJourney(best.decision.actionConceptId, best.decision.subjectId, null, best.decision),
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
