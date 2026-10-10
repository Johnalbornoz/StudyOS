/**
 * B2 -- evidence need per concept: a READ-ONLY projection of the canonical learner state (pure).
 *
 * It defines no mastery and no formula. Every number it uses is a canonical one:
 *   - `concept_knowledge_state.mastery_state`, `.validation_readiness`, `.evidence_count`,
 *     `.independent_evidence_count`, `.next_review_at`             (the Knowledge State projection)
 *   - `mastery_policies.minimum_evidence_count`, `.minimum_independent_evidence_count`  (the mastery policy)
 *
 * What it adds is a translation: "how many more assessment OPPORTUNITIES would this concept need before
 * the canonical policy's own minimum counts could be reached", and a coarse ordering of how pressing that
 * is. An opportunity is a chance to produce evidence, not evidence: whether a response counts, and for
 * how much, is decided after the attempt by the Learner State Authority (B3), never here.
 *
 * A concept the Student selected stays in scope whatever its state: state changes its priority and how
 * many opportunities it needs, never whether it is practised.
 */
import type { MasteryState, ValidationReadiness } from '@/services/knowledge-state.service';

export const EVIDENCE_REQUIREMENT_VERSION = 'b2-evidence-need-1' as const;

/** The canonical minimum counts (one row of `mastery_policies`). */
export interface EvidenceCountPolicy {
  version: number;
  minimumEvidenceCount: number;
  minimumIndependentEvidenceCount: number;
}

/** One row of `concept_knowledge_state`, as far as selection needs it. null fields = not recorded. */
export interface LearnerConceptState {
  canonicalConceptId: string;
  /** The Student's own instance (through a CANONICAL link). null = the Student has no instance of the concept. */
  learnerConceptId: string | null;
  masteryState: MasteryState | null;
  validationReadiness: ValidationReadiness | null;
  evidenceCount: number | null;
  independentEvidenceCount: number | null;
  /** `next_review_at` (ISO), when the canonical memory projection scheduled one. */
  nextReviewAt: string | null;
}

export type EvidenceNeedLevel =
  /** No canonical state row, or zero evidence. */
  | 'NO_EVIDENCE'
  /** Evidence exists but the canonical state is LEARNING / AT_RISK / INTERVENTION_REQUIRED, or below the minimum counts. */
  | 'WEAK'
  | 'DEVELOPING'
  /** PROVISIONAL / VALIDATED mastery with the minimum counts reached. */
  | 'STRONG';

export interface EvidenceNeed {
  canonicalConceptId: string;
  learnerConceptId: string | null;
  level: EvidenceNeedLevel;
  /** Evidence rows still missing to reach `minimum_evidence_count` (0 when reached). */
  evidenceDeficit: number;
  /** Independent evidence rows still missing to reach `minimum_independent_evidence_count`. */
  independentDeficit: number;
  /** Canonical readiness facts that make a specific kind of opportunity relevant. */
  retentionDue: boolean;
  transferRequired: boolean;
  /** Selection priority, 1 (lowest) .. 5. Orders the solver; removes nothing. */
  priority: number;
  /** The canonical values it was derived from (for the audit snapshot). */
  basis: { masteryState: MasteryState | null; validationReadiness: ValidationReadiness | null; evidenceCount: number | null; independentEvidenceCount: number | null; policyVersion: number };
}

/** B2_SELECTION_POLICY: how pressing each canonical state is for SELECTION (not a mastery judgement). */
export const NEED_PRIORITY: Record<EvidenceNeedLevel, number> = { NO_EVIDENCE: 4, WEAK: 4, DEVELOPING: 3, STRONG: 1 };

const WEAK_STATES: ReadonlySet<string> = new Set(['UNKNOWN', 'LEARNING', 'AT_RISK', 'INTERVENTION_REQUIRED']);
const STRONG_STATES: ReadonlySet<string> = new Set(['PROVISIONAL_MASTERY', 'VALIDATED_MASTERY']);

/**
 * @param asOf explicit "now" (ISO). The only time input: retention is due when `nextReviewAt <= asOf`.
 */
export function projectEvidenceNeed(state: LearnerConceptState, policy: EvidenceCountPolicy, asOf: string): EvidenceNeed {
  const evidence = state.evidenceCount ?? 0;
  const independent = state.independentEvidenceCount ?? 0;
  const evidenceDeficit = Math.max(0, policy.minimumEvidenceCount - evidence);
  const independentDeficit = Math.max(0, policy.minimumIndependentEvidenceCount - independent);
  const noState = state.masteryState === null && state.evidenceCount === null;
  let level: EvidenceNeedLevel;
  if (noState || evidence === 0) level = 'NO_EVIDENCE';
  else if (state.masteryState !== null && WEAK_STATES.has(state.masteryState)) level = 'WEAK';
  else if (evidenceDeficit > 0 || independentDeficit > 0 || state.validationReadiness === 'INSUFFICIENT_EVIDENCE') level = state.masteryState !== null && STRONG_STATES.has(state.masteryState) ? 'DEVELOPING' : 'WEAK';
  else if (state.masteryState !== null && STRONG_STATES.has(state.masteryState)) level = 'STRONG';
  else level = 'DEVELOPING';

  const retentionDue = state.validationReadiness === 'WAITING_FOR_RETENTION' && state.nextReviewAt !== null && state.nextReviewAt <= asOf;
  const transferRequired = state.validationReadiness === 'TRANSFER_REQUIRED';
  // A canonical retention / transfer fact makes the concept one step more pressing; a critical misconception too.
  const bump = retentionDue || transferRequired || state.validationReadiness === 'ACTIVE_CRITICAL_MISCONCEPTION' ? 1 : 0;
  return {
    canonicalConceptId: state.canonicalConceptId,
    learnerConceptId: state.learnerConceptId,
    level,
    evidenceDeficit,
    independentDeficit,
    retentionDue,
    transferRequired,
    priority: Math.min(5, NEED_PRIORITY[level] + bump),
    basis: { masteryState: state.masteryState, validationReadiness: state.validationReadiness, evidenceCount: state.evidenceCount, independentEvidenceCount: state.independentEvidenceCount, policyVersion: policy.version },
  };
}

/** Need of every target concept. A concept with no recorded state is NO_EVIDENCE (the Student has not shown anything yet). */
export function projectEvidenceNeeds(canonicalConceptIds: readonly string[], states: readonly LearnerConceptState[], policy: EvidenceCountPolicy, asOf: string): EvidenceNeed[] {
  const byConcept = new Map(states.map((s) => [s.canonicalConceptId, s]));
  return [...new Set(canonicalConceptIds)]
    .sort()
    .map((id) => projectEvidenceNeed(byConcept.get(id) ?? { canonicalConceptId: id, learnerConceptId: null, masteryState: null, validationReadiness: null, evidenceCount: null, independentEvidenceCount: null, nextReviewAt: null }, policy, asOf));
}

/** A generic learner with no evidence at all: the context readiness / feasibility projections run with. */
export function neutralEvidenceNeeds(canonicalConceptIds: readonly string[], policy: EvidenceCountPolicy): EvidenceNeed[] {
  return projectEvidenceNeeds(canonicalConceptIds, [], policy, '1970-01-01T00:00:00.000Z');
}
