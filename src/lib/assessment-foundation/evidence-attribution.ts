/**
 * B1 -- EvidenceAttribution: the CONTRACT of how one assessment response may contribute evidence to one or
 * more of a learner's concepts (pure; no IO, no writer).
 *
 * This module does not record evidence and changes nothing about how evidence is recorded today:
 * `updateMastery` stays the single evidence writer, Knowledge State stays its projection, and current
 * weighting is untouched. B3 will make the writer consume an attribution; B1 only fixes the semantics so
 * that step cannot be built wrong.
 *
 * Semantics it protects:
 *   - A question that covers several concepts is NOT full independent evidence of each of them. Full
 *     independent credit can be claimed for at most one concept of a response, and only when the question's
 *     coverage names that concept as its single PRIMARY target.
 *   - A SUPPORTING concept receives contributory evidence at most; it never satisfies an independent-evidence
 *     requirement.
 *   - Coverage derived only from an objective mapping (role UNSPECIFIED) does not say which concept the item
 *     really assesses: its credit is UNDETERMINED until item-level attribution exists.
 *   - No weight is invented: `weight` is UNKNOWN unless a source states one.
 *   - Exam evidence never sets a Learning Stage. An attribution only names concepts and the kind of claim;
 *     the stage changes solely inside the Canonical Learning Decision.
 */
import type { AssessmentFamily, AssessmentPath } from './families';
import { UNKNOWN, type Known } from './known';
import type { ConceptCoverageBasis, ConceptCoverageRole, QuestionCoverage, QuestionRef } from './question-coverage';

export const EVIDENCE_ATTRIBUTION_VERSION = 1 as const;

/** The dimensions of the canonical learning journey a response could be evidence for. */
export const EVIDENCE_DIMENSIONS = ['PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER', 'DIAGNOSE', 'EXAM_PERFORMANCE'] as const;
export type EvidenceDimension = (typeof EVIDENCE_DIMENSIONS)[number];

export type CreditClaim =
  /** The response is direct evidence about this concept (it is the question's single primary target). */
  | 'DIRECT'
  /** The concept was needed to answer, but the response is not a measurement of it on its own. */
  | 'CONTRIBUTORY'
  /** The coverage does not say which concept the item assesses (objective-level mapping only). */
  | 'UNDETERMINED';

export interface AttributionTarget {
  canonicalConceptId: string;
  /** The Student's own instance, when they have one. null = no evidence can be written for this Student yet. */
  learnerConceptId: string | null;
  role: ConceptCoverageRole;
  basis: ConceptCoverageBasis;
  credit: CreditClaim;
  /** May this response count toward an INDEPENDENT-evidence requirement of this concept? */
  independentEvidenceEligible: boolean;
  /** Dimensions the response may be evidence for, on this concept. Empty when it may not be used as evidence at all. */
  eligibleDimensions: EvidenceDimension[];
  /** No source states a contribution weight today. */
  weight: Known<number>;
}

export interface EvidenceAttribution {
  v: typeof EVIDENCE_ATTRIBUTION_VERSION;
  source: {
    family: AssessmentFamily;
    path: AssessmentPath;
    /** `quiz_sessions.id` or `exam_attempts.id`. */
    assessmentRef: string;
    question: QuestionRef;
    /** The response row, when one exists. */
    responseRef: string | null;
    /** G6: the exam target whose attempt produced the response. Required for exam paths. */
    examScope: { examTargetId: string; examVersionId: string; examAttemptId: string } | null;
  };
  targets: AttributionTarget[];
  /** Why nothing could be attributed, when `targets` is empty. Kept visible: never silently dropped. */
  unattributed: 'QUESTION_HAS_NO_CANONICAL_CONCEPT' | null;
}

export interface AttributionRequest {
  family: AssessmentFamily;
  path: AssessmentPath;
  assessmentRef: string;
  responseRef?: string | null;
  examScope?: { examTargetId: string; examVersionId: string; examAttemptId: string } | null;
  /** The dimension the activity was run for. */
  dimension: EvidenceDimension;
  /** The Student's concept instance per canonical concept (from the explicit link), where one exists. */
  learnerConceptByCanonical: ReadonlyMap<string, string>;
  /** Was the response produced without assistance (the activity's own contract says so)? */
  independentActivity: boolean;
}

/** Dimensions that are independent-evidence dimensions of the learning journey. */
const INDEPENDENT_DIMENSIONS: readonly EvidenceDimension[] = ['PROVE', 'RETAIN', 'TRANSFER'];

/**
 * Plans the attribution of one response. Deterministic and side-effect free; it writes nothing.
 * An exam-family response is planned for EXAM_PERFORMANCE: whether (and when) exam evidence may also count
 * toward a learning requirement is the validity rule B3 implements, not a default taken here.
 */
export function planEvidenceAttribution(coverage: QuestionCoverage, request: AttributionRequest): EvidenceAttribution {
  const source: EvidenceAttribution['source'] = {
    family: request.family,
    path: request.path,
    assessmentRef: request.assessmentRef,
    question: coverage.ref,
    responseRef: request.responseRef ?? null,
    examScope: request.examScope ?? null,
  };
  if (request.family !== 'LEARNING' && !source.examScope) throw new Error('EXAM_SCOPE_REQUIRED');
  if (coverage.concepts.length === 0) return { v: EVIDENCE_ATTRIBUTION_VERSION, source, targets: [], unattributed: 'QUESTION_HAS_NO_CANONICAL_CONCEPT' };

  const primaries = coverage.concepts.filter((c) => c.role === 'PRIMARY');
  const soleDirect = primaries.length === 1 ? primaries[0].canonicalConceptId : null;
  const dimension: EvidenceDimension = request.family === 'LEARNING' ? request.dimension : 'EXAM_PERFORMANCE';

  const targets: AttributionTarget[] = coverage.concepts.map((c) => {
    const credit: CreditClaim = c.role === 'SUPPORTING' ? 'CONTRIBUTORY' : c.role === 'PRIMARY' && c.canonicalConceptId === soleDirect ? 'DIRECT' : c.role === 'PRIMARY' ? 'CONTRIBUTORY' : 'UNDETERMINED';
    const learnerConceptId = request.learnerConceptByCanonical.get(c.canonicalConceptId) ?? null;
    const independentEvidenceEligible = credit === 'DIRECT' && request.independentActivity && request.family === 'LEARNING' && INDEPENDENT_DIMENSIONS.includes(dimension);
    return {
      canonicalConceptId: c.canonicalConceptId,
      learnerConceptId,
      role: c.role,
      basis: c.basis,
      credit,
      independentEvidenceEligible,
      // Without the Student's own concept instance there is nothing to hang evidence on.
      eligibleDimensions: learnerConceptId ? [dimension] : [],
      weight: UNKNOWN,
    };
  });
  return { v: EVIDENCE_ATTRIBUTION_VERSION, source, targets, unattributed: null };
}

/** Does the attribution claim full, independent evidence of this concept? At most one concept per response can. */
export function claimsFullIndependentEvidence(attribution: EvidenceAttribution, canonicalConceptId: string): boolean {
  return attribution.targets.some((t) => t.canonicalConceptId === canonicalConceptId && t.credit === 'DIRECT' && t.independentEvidenceEligible);
}

export type AttributionViolation = 'MULTIPLE_DIRECT_TARGETS' | 'SUPPORTING_CLAIMS_INDEPENDENT' | 'UNDETERMINED_CLAIMS_INDEPENDENT' | 'DUPLICATE_CONCEPT' | 'EXAM_SCOPE_MISSING';

/** The no-double-credit invariants every attribution must satisfy, whoever builds it (B3 will reuse this check). */
export function attributionViolations(a: EvidenceAttribution): AttributionViolation[] {
  const out: AttributionViolation[] = [];
  if (a.targets.filter((t) => t.credit === 'DIRECT').length > 1) out.push('MULTIPLE_DIRECT_TARGETS');
  if (a.targets.some((t) => t.role === 'SUPPORTING' && t.independentEvidenceEligible)) out.push('SUPPORTING_CLAIMS_INDEPENDENT');
  if (a.targets.some((t) => t.credit === 'UNDETERMINED' && t.independentEvidenceEligible)) out.push('UNDETERMINED_CLAIMS_INDEPENDENT');
  if (new Set(a.targets.map((t) => t.canonicalConceptId)).size !== a.targets.length) out.push('DUPLICATE_CONCEPT');
  if (a.source.family !== 'LEARNING' && !a.source.examScope) out.push('EXAM_SCOPE_MISSING');
  return out;
}
