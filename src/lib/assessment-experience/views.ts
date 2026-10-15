/**
 * B4 -- the learner-facing view contracts of an assessment (pure; presentation / read models only).
 *
 *   setup        what the Student is about to do, per depth, with what the Blueprint Core says is possible
 *   mock options which exam attempts exist for this exam right now, by the B1 attempt semantics
 *   run          what the active shell may show, as CAPABILITIES of the frozen assessment
 *   result       what happened, what was demonstrated, what stayed open, what changed
 *
 * Every number and every status here is copied from an authority (B2 solution, B1 fidelity decision, the
 * frozen assessment, B3 PostAssessmentState). Nothing is computed about pedagogy: no count is derived from
 * a number of concepts, no mastery from a score, no availability from a guess. A fact an authority does not
 * state is `null`, and a surface shows nothing for it.
 *
 * These contracts carry CODES, never prose. Words come from the governed messages.
 */
import { canUseAI } from '@/lib/ai-permission-policy';
import type { BlueprintSolution } from '@/lib/assessment-blueprint/result';
import type { UnmetCause } from '@/lib/assessment-blueprint/solver/plan';
import { PRACTICE_DEPTHS, type PracticeDepth } from '@/lib/assessment-blueprint/policy/practice-depth';
import type { OfficialSlotFeasibility } from '@/lib/assessment-blueprint/readiness/feasibility';
import type { AssessmentFamily, AssessmentPath } from '@/lib/assessment-foundation/families';
import { deriveInstanceAttemptType, type FormFidelity, type InstanceAttemptType } from '@/lib/exam-core/form-fidelity';
import type { FrozenAssessment } from '@/lib/assessment-execution/frozen-assessment';
import type { PostAssessmentState } from '@/lib/assessment-execution/post-assessment';

/* ------------------------------------------------------------------ */
/* Setup                                                                */
/* ------------------------------------------------------------------ */

/**
 * ON_DEMAND: a LEARNING / INTERNAL ASSESSMENT setup whose questions are prepared when the Student starts
 * (lib/assessment-supply). It is startable: ordinary Learning never waits for inventory.
 */
export type Availability = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'ON_DEMAND';

/** Why an assessment is limited, in the Student's terms. Internal causes never leave this module. */
export type LimitationCode = 'NOT_ENOUGH_QUESTIONS' | 'SOME_TOPICS_NOT_READY' | 'TIME_LIMIT_TOO_SHORT' | 'TIME_CANNOT_BE_ESTIMATED' | 'ONLY_RECENT_QUESTIONS';

const LIMITATION_OF_CAUSE: Record<UnmetCause, LimitationCode> = {
  NO_ELIGIBLE_CANDIDATE: 'NOT_ENOUGH_QUESTIONS',
  NOT_ENOUGH_CANDIDATES: 'NOT_ENOUGH_QUESTIONS',
  ONLY_WEAKER_COVERAGE: 'NOT_ENOUGH_QUESTIONS',
  NO_ITEM_FOR_SLOT: 'NOT_ENOUGH_QUESTIONS',
  UNRESOLVED_TARGET: 'SOME_TOPICS_NOT_READY',
  TIME_BUDGET: 'TIME_LIMIT_TOO_SHORT',
  DURATION_UNKNOWN: 'TIME_CANNOT_BE_ESTIMATED',
  ONLY_RECENT_CANDIDATES: 'ONLY_RECENT_QUESTIONS',
  ONLY_OTHER_DIFFICULTY: 'NOT_ENOUGH_QUESTIONS',
};

/** Unmet causes that more of the Student's own items resolve (the same set the supply service generates for). */
const ON_DEMAND_CAUSES: ReadonlySet<UnmetCause> = new Set<UnmetCause>(['NO_ELIGIBLE_CANDIDATE', 'NOT_ENOUGH_CANDIDATES', 'ONLY_WEAKER_COVERAGE', 'ONLY_RECENT_CANDIDATES', 'ONLY_OTHER_DIFFICULTY']);

export interface EffortEstimate {
  /** The size of the selected set. null = nothing selected. Never a multiplication. */
  questions: number | null;
  /** From recorded durations only. null = not recorded: the surface shows no time at all. */
  minutes: number | null;
}

export interface AssessmentPreview {
  availability: Availability;
  effort: EffortEstimate;
  /** Targets the Student asked for / targets the selection actually covers. */
  targets: { requested: number; covered: number };
  limitations: LimitationCode[];
  canStart: boolean;
}

/** One Blueprint Core solution, as a preview. The same solution is what a launch would freeze. */
export function previewOf(solution: BlueprintSolution): AssessmentPreview {
  const { outcome, plan } = solution;
  const selected = outcome.selected.length;
  // LEARNING family: what is short only for lack of items is generated at the start (an explicit command), so the
  // setup is startable. A target with no canonical identity, or a time limit, is not a supply matter.
  const supplyOnly = solution.family === 'LEARNING' && plan.mode === 'TARGETS' && plan.targets.length > 0 && outcome.unmet.length > 0 && outcome.unmet.every((u) => ON_DEMAND_CAUSES.has(u.cause));
  const availability: Availability = supplyOnly ? 'ON_DEMAND' : selected === 0 ? 'UNAVAILABLE' : outcome.status === 'READY' ? 'AVAILABLE' : 'PARTIAL';
  const requested = plan.mode === 'SLOTS' ? plan.slots.length : plan.targets.length + plan.unresolvedTargets.length;
  const covered = plan.mode === 'SLOTS' ? selected : new Set(outcome.selected.flatMap((s) => s.contributes.filter((c) => c.counted.length > 0).map((c) => c.targetKey))).size;
  const limitations = supplyOnly ? [] : [...new Set(outcome.unmet.map((u) => LIMITATION_OF_CAUSE[u.cause]))].sort();
  return {
    availability,
    effort: { questions: selected > 0 ? solution.result.estimate.items : null, minutes: selected > 0 ? solution.result.estimate.minutes : null },
    targets: { requested, covered },
    limitations,
    // An official form is all of its positions or it does not start (B1 / B2).
    canStart: solution.family === 'OFFICIAL_EXAM' ? outcome.status === 'READY' : supplyOnly || selected > 0,
  };
}

export interface DepthOption {
  depth: PracticeDepth;
  preview: AssessmentPreview;
}

export interface AssessmentSetupView {
  family: AssessmentFamily;
  /** Depth is a learner choice only where the Blueprint Core has depth presets (learning practice). */
  depthOptions: DepthOption[];
  /** The single preview of a setup with no depth choice (a diagnostic, a preparation practice, a mock). */
  preview: AssessmentPreview | null;
  state: 'READY' | 'PARTIAL' | 'UNAVAILABLE';
}

/** A learning setup: one preview per depth, each from its own Blueprint Core solution for THIS Student. */
export function learningSetupView(byDepth: Readonly<Partial<Record<PracticeDepth, BlueprintSolution>>>): AssessmentSetupView {
  const depthOptions = PRACTICE_DEPTHS.filter((d) => byDepth[d]).map((depth) => ({ depth, preview: previewOf(byDepth[depth] as BlueprintSolution) }));
  const startable = depthOptions.filter((o) => o.preview.canStart);
  return { family: 'LEARNING', depthOptions, preview: null, state: startable.length === 0 ? 'UNAVAILABLE' : startable.some((o) => o.preview.availability === 'AVAILABLE' || o.preview.availability === 'ON_DEMAND') ? 'READY' : 'PARTIAL' };
}

export function singleSetupView(solution: BlueprintSolution): AssessmentSetupView {
  const preview = previewOf(solution);
  return { family: solution.family, depthOptions: [], preview, state: !preview.canStart ? 'UNAVAILABLE' : preview.availability === 'AVAILABLE' || preview.availability === 'ON_DEMAND' ? 'READY' : 'PARTIAL' };
}

/* ------------------------------------------------------------------ */
/* Exam attempt options (B1 semantics)                                  */
/* ------------------------------------------------------------------ */

/** DIFFICULTY_NOT_CALIBRATED: a challenge is harder than the real exam by a CALIBRATED difficulty; content with no calibrated difficulty cannot be offered as one. */
export type ExamOptionReason = 'CONTENT_NOT_READY' | 'FIDELITY_NOT_VERIFIED' | 'OFFICIAL_DIFFICULTY_NOT_MET' | 'DIFFICULTY_NOT_CALIBRATED' | 'READINESS_ENGINE_NOT_READY';

export interface ExamAttemptOption {
  /** The B1 attempt type this option would be stored as. Never a catch-all. */
  type: InstanceAttemptType;
  available: boolean;
  reason: ExamOptionReason | null;
}

/**
 * The exam attempts a Student can be offered for one exam version, in a fixed order. A full mock is offered
 * as available only when B1 would store it as FULL_MOCK; otherwise it is shown unavailable with the reason,
 * and never silently replaced by a smaller attempt.
 */
export function examAttemptOptions(facts: {
  /** Blueprint Core feasibility of the official form (same solver). null = not evaluated. */
  officialForm: Pick<OfficialSlotFeasibility, 'status'> | null;
  /** B1 fidelity of the form that would be served. null = not classified. */
  fidelity: FormFidelity | null;
  difficultyBandMet: boolean | null;
  /** Student-eligible reviewed questions exist for practice at all. */
  practiceContentAvailable: boolean;
  /** Deliverable content with a calibrated difficulty exists. false = a challenge is not offered, whatever the practice content. Absent = not evaluated (the earlier behaviour). */
  challengeDifficultyCalibrated?: boolean;
}): ExamAttemptOption[] {
  const contentReady = facts.officialForm?.status === 'READY';
  const mock = (wanted: 'FULL_MOCK' | 'REDUCED_MOCK'): ExamAttemptOption => {
    if (!contentReady) return { type: wanted, available: false, reason: 'CONTENT_NOT_READY' };
    const decision = deriveInstanceAttemptType({ mode: 'MOCK', fidelity: facts.fidelity, difficultyBandMet: facts.difficultyBandMet });
    if (decision.startable && decision.type === wanted) return { type: wanted, available: true, reason: null };
    if (!decision.startable) return { type: wanted, available: false, reason: decision.reason === 'OFFICIAL_DIFFICULTY_NOT_MET' ? 'OFFICIAL_DIFFICULTY_NOT_MET' : 'FIDELITY_NOT_VERIFIED' };
    // startable as the OTHER mock type: this one is not what the form is
    return { type: wanted, available: false, reason: 'FIDELITY_NOT_VERIFIED' };
  };
  const practice = (type: 'EXAM_PRACTICE' | 'EXAM_CHALLENGE'): ExamAttemptOption => ({ type, available: facts.practiceContentAvailable, reason: facts.practiceContentAvailable ? null : 'CONTENT_NOT_READY' });
  const challenge: ExamAttemptOption = facts.practiceContentAvailable && facts.challengeDifficultyCalibrated === false ? { type: 'EXAM_CHALLENGE', available: false, reason: 'DIFFICULTY_NOT_CALIBRATED' } : practice('EXAM_CHALLENGE');
  return [practice('EXAM_PRACTICE'), mock('REDUCED_MOCK'), mock('FULL_MOCK'), challenge];
}

/* ------------------------------------------------------------------ */
/* Run                                                                  */
/* ------------------------------------------------------------------ */

export interface RunCapabilities {
  /** Hints / explanations while answering: the existing AI-permission policy, from the session's EvidenceMode. */
  canUseAIHelp: boolean;
  /** Feedback after each answer. Learning sessions; never an official form. */
  canShowImmediateFeedback: boolean;
  canNavigateBack: boolean;
  hasMarks: boolean;
  /** Official conditions apply: timing, no assistance, one submission. */
  requiresIntegrity: boolean;
}

export interface AssessmentRunView {
  snapshotId: string;
  family: AssessmentFamily;
  path: AssessmentPath;
  /** From the frozen assessment. Never recounted from the live bank. */
  progress: { answered: number; total: number };
  capabilities: RunCapabilities;
}

/** What the active shell may show for a frozen assessment. Capabilities, not family switches in components. */
export function runViewOf(frozen: FrozenAssessment, answeredItemKeys: readonly string[]): AssessmentRunView {
  const keys = new Set(frozen.items.map((i) => i.key));
  const official = frozen.family === 'OFFICIAL_EXAM';
  const exam = frozen.family !== 'LEARNING';
  return {
    snapshotId: frozen.snapshotId,
    family: frozen.family,
    path: frozen.path,
    progress: { answered: new Set(answeredItemKeys.filter((k) => keys.has(k))).size, total: frozen.items.length },
    capabilities: {
      canUseAIHelp: !exam && frozen.activity !== null && canUseAI({ evidenceMode: frozen.activity.evidenceMode, feature: 'HINT' }),
      canShowImmediateFeedback: !exam,
      canNavigateBack: exam,
      hasMarks: frozen.items.every((i) => i.marks !== null),
      requiresIntegrity: official,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Result                                                               */
/* ------------------------------------------------------------------ */

export type ConceptResultStatus =
  /** Evidence was obtained for the concept (this attempt, or already applied by an earlier run of it). */
  | 'EVIDENCE_OBTAINED'
  /** Its question was served and not answered. Not a failure. */
  | 'NOT_ANSWERED'
  /** Answered; the mark is not final yet. */
  | 'NOT_EVALUATED'
  /** Scored, but the response cannot be credited to this concept. */
  | 'NOT_ATTRIBUTABLE';

export interface ConceptResultRow {
  canonicalConceptId: string;
  status: ConceptResultStatus;
  /** Knowledge State before -> after, as the projector reported it. null when no evidence was applied. */
  state: { before: string | null; after: string | null; changed: boolean } | null;
  /** Direction of the mastery value the writer returned. null when no evidence was applied. */
  direction: 'UP' | 'DOWN' | 'SAME' | null;
}

export interface AssessmentResultView {
  snapshotId: string;
  family: AssessmentFamily;
  path: AssessmentPath;
  /** 1. What happened. */
  happened: { questions: number; answered: number; scored: number; pendingReview: number; scorePercent: number | null; marks: { obtained: number; available: number } | null };
  /** 2-4. What was demonstrated, what stays open, what changed -- per concept the assessment touched. */
  concepts: ConceptResultRow[];
  coverage: { intended: number; withEvidence: number };
  /**
   * AVAILABLE      evidence was credited to at least one concept
   * UNAVAILABLE    the attempt is scored, and its questions do not say which concept each one measures
   * NONE           nothing could be credited for another reason (nothing scored, concepts not linked)
   * NOT_APPLICABLE a technical demonstration: no learner evidence by rule
   */
  learningAttribution: 'AVAILABLE' | 'UNAVAILABLE' | 'NONE' | 'NOT_APPLICABLE';
  examGaps: Array<{ canonicalConceptId: string; learningObjectiveId: string | null; severity: 'HIGH' | 'MEDIUM' | 'LOW' }>;
}

export function resultViewOf(state: PostAssessmentState): AssessmentResultView {
  const outcomes = state.attributionOutcomes;
  const applied = new Map(state.evidence.filter((e) => e.status !== 'WRITE_FAILED').map((e) => [e.canonicalConceptId, e]));
  const change = new Map(state.conceptStateChanges.map((c) => [c.canonicalConceptId, c]));
  const concepts = [...new Set([...state.coverage.intended.canonicalConceptIds, ...state.coverage.selected])].sort();
  const rows: ConceptResultRow[] = concepts.map((id) => {
    const evidence = applied.get(id);
    if (evidence) {
      const c = change.get(id);
      const m = evidence.mastery;
      return { canonicalConceptId: id, status: 'EVIDENCE_OBTAINED', state: c ? { before: c.before, after: c.after, changed: c.changed } : null, direction: m ? (m.after > m.before ? 'UP' : m.after < m.before ? 'DOWN' : 'SAME') : null };
    }
    const mine = outcomes.filter((o) => o.canonicalConceptId === id);
    const status: ConceptResultStatus = state.coverage.scored.includes(id) ? 'NOT_ATTRIBUTABLE' : state.coverage.answered.includes(id) ? 'NOT_EVALUATED' : mine.some((o) => o.status === 'NOT_SCORED' && o.reason === 'PENDING_REVIEW') ? 'NOT_EVALUATED' : 'NOT_ANSWERED';
    return { canonicalConceptId: id, status, state: null, direction: null };
  });
  const derivedOnly = outcomes.length > 0 && outcomes.every((o) => o.status === 'DERIVED_ONLY' || o.status === 'NOT_SCORED' || o.status === 'NO_CANONICAL_CONCEPT');
  const learningAttribution: AssessmentResultView['learningAttribution'] =
    state.learnerEvidence === 'NO_CONSEQUENTIAL_LEARNER_EVIDENCE' ? 'NOT_APPLICABLE' : applied.size > 0 ? 'AVAILABLE' : state.score.scored > 0 && derivedOnly ? 'UNAVAILABLE' : 'NONE';
  return {
    snapshotId: state.assessment.snapshotId,
    family: state.assessment.family,
    path: state.assessment.path,
    happened: {
      questions: state.score.items,
      answered: state.score.answered,
      scored: state.score.scored,
      pendingReview: state.score.pendingReview,
      // the graders' own mean, shown as a percentage; null when nothing is scored
      scorePercent: state.score.meanFraction === null ? null : Math.round(state.score.meanFraction * 100),
      marks: state.score.marks,
    },
    concepts: rows,
    coverage: { intended: state.coverage.intended.canonicalConceptIds.length, withEvidence: state.coverage.consequential.length },
    learningAttribution,
    examGaps: (state.examGaps ?? []).map((g) => ({ canonicalConceptId: g.canonicalConceptId, learningObjectiveId: g.learningObjectiveId, severity: g.severity })),
  };
}

/**
 * R-1: the availability cards under the Exam Bank Readiness Engine, so that they say what the preparation's activities
 * say: practice when the engine does not say NOT_READY everywhere; a mock only when the engine says READY for it AND
 * the preparation offers that mock; a challenge only when the engine says READY (calibrated difficulty).
 */
export function examAttemptOptionsUnderEngine(options: readonly ExamAttemptOption[], engine: { anyPractice: boolean; reducedMock: string; fullMock: string; challenge: string }, offered: { reducedMock: boolean; fullMock: boolean }): ExamAttemptOption[] {
  const no = (type: ExamAttemptOption['type'], reason: ExamOptionReason): ExamAttemptOption => ({ type, available: false, reason });
  return options.map((o) => {
    if (o.type === 'EXAM_PRACTICE') return engine.anyPractice ? o : no(o.type, 'READINESS_ENGINE_NOT_READY');
    if (o.type === 'REDUCED_MOCK') return engine.reducedMock === 'READY' && offered.reducedMock ? { type: o.type, available: true, reason: null } : no(o.type, engine.reducedMock === 'READY' ? 'CONTENT_NOT_READY' : 'READINESS_ENGINE_NOT_READY');
    if (o.type === 'FULL_MOCK') return engine.fullMock === 'READY' && offered.fullMock ? { type: o.type, available: true, reason: null } : no(o.type, engine.fullMock === 'READY' ? 'CONTENT_NOT_READY' : 'READINESS_ENGINE_NOT_READY');
    if (o.type === 'EXAM_CHALLENGE') return engine.challenge === 'READY' && o.available ? o : no(o.type, o.reason === 'DIFFICULTY_NOT_CALIBRATED' ? 'DIFFICULTY_NOT_CALIBRATED' : 'READINESS_ENGINE_NOT_READY');
    return o;
  });
}
