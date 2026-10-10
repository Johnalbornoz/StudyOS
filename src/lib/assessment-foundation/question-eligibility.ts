/**
 * B1 -- QuestionEligibility: may THIS question be a candidate for THIS assessment request? (pure, no IO)
 *
 * It extends the existing delivery rule rather than replacing it: a reviewed-bank item is still judged by
 * `isEligible` / `DEFAULT_ELIGIBILITY` (question-bank/lifecycle) -- the one Student delivery rule. This
 * module adds what that rule cannot see: the store, the assessment family, applicability to the request's
 * exam / curriculum / objectives / concepts, licensing, and ownership of per-student cached content.
 *
 * Family boundaries (hard):
 *   OFFICIAL_EXAM      reviewed bank only, mock-eligible, for the request's exam version. Never a generated,
 *                      unreviewed or learner-adaptive item, whatever a caller's policy flag says.
 *   EXAM_PREPARATION   reviewed bank by the practice rule. Unreviewed cached content only when the request's
 *                      policy explicitly allows it, and only the Student's own, canonically resolved.
 *
 * Concept identity (B1-C, hard): only a CANONICAL identity satisfies a canonical target. A TRANSITIONAL
 * (label-matched, unconfirmed) link behaves as unresolved and no request policy can change that.
 *   LEARNING           the Student's own validated cached questions; reviewed bank by the practice rule.
 *
 * Eligibility PERMITS a candidate. It never ranks, combines or counts: B2 decides combinations, and no
 * question store decides how many questions a learner needs.
 */
import { isEligible, DEFAULT_ELIGIBILITY, type DeliveryUse, type EligibilityPolicy } from '@/lib/exam-core/question-bank/lifecycle';
import type { ContentAudience } from '@/lib/exam-core/audience';
import type { AssessmentFamily } from './families';
import { coveredConceptIds, type QuestionCoverage } from './question-coverage';

export interface QuestionEligibilityRequest {
  family: AssessmentFamily;
  /** The Student the assessment is for (ownership of per-student cached questions). */
  studentId: string;
  audience?: ContentAudience;
  /** Reviewed-bank delivery use. Defaults per family: FULL_MOCK (official), PRACTICE (otherwise). */
  use?: DeliveryUse;
  /** Required for OFFICIAL_EXAM and EXAM_PREPARATION: the exam version the assessment is built for. */
  examVersionId?: string | null;
  assessmentComponentIds?: readonly string[] | null;
  /** Curriculum applicability: structure versions the request is scoped to. */
  structureVersionIds?: readonly string[] | null;
  learningObjectiveIds?: readonly string[] | null;
  canonicalConceptIds?: readonly string[] | null;
  questionTypes?: readonly string[] | null;
  policy?: {
    /** EXAM_PREPARATION only: may the Student's own unreviewed cached content be used? Default false. */
    allowUnreviewedInPreparation?: boolean;
    bankPolicy?: EligibilityPolicy;
  };
}

export type IneligibilityReason =
  | 'STORE_NOT_ALLOWED_FOR_FAMILY'
  | 'UNREVIEWED_CONTENT_NOT_ALLOWED'
  | 'NOT_OWNED_BY_STUDENT'
  | 'CACHE_ITEM_NOT_VALIDATED'
  | 'BANK_DELIVERY_RULE'
  | 'EXAM_VERSION_REQUIRED'
  | 'EXAM_APPLICABILITY_UNKNOWN'
  | 'EXAM_VERSION_MISMATCH'
  | 'COMPONENT_MISMATCH'
  | 'CURRICULUM_APPLICABILITY_UNKNOWN'
  | 'CURRICULUM_MISMATCH'
  | 'OBJECTIVE_MISMATCH'
  | 'CONCEPT_UNRESOLVED'
  | 'CONCEPT_MISMATCH'
  | 'QUESTION_TYPE_MISMATCH'
  | 'LICENCE_UNKNOWN'
  | 'LICENCE_NOT_PERMITTED';

export type QuestionEligibility = { eligible: true; use: DeliveryUse | null } | { eligible: false; reasons: IneligibilityReason[] };

/** Licence statuses (`assessment_sources.license_status`) under which third-party content may be delivered. */
const DELIVERABLE_LICENCES = new Set(['PUBLIC', 'LICENSED']);

const defaultUse = (family: AssessmentFamily): DeliveryUse => (family === 'OFFICIAL_EXAM' ? 'FULL_MOCK' : 'PRACTICE');

const MOCK_USES: readonly DeliveryUse[] = ['REDUCED_MOCK', 'FULL_MOCK', 'FULL_MOCK_CALIBRATED'];

export function evaluateQuestionEligibility(coverage: QuestionCoverage, request: QuestionEligibilityRequest): QuestionEligibility {
  const reasons: IneligibilityReason[] = [];
  const audience = request.audience ?? 'STUDENT';
  const reviewed = coverage.ref.store === 'REVIEWED_EXAM_BANK';
  // An official exam is never practised with a practice-only use, whatever the caller passes.
  const use = request.family === 'OFFICIAL_EXAM' && !MOCK_USES.includes(request.use ?? 'FULL_MOCK') ? 'FULL_MOCK' : request.use ?? defaultUse(request.family);

  /* ---- store and content class, per family ---- */
  if (!reviewed) {
    if (request.family === 'OFFICIAL_EXAM') reasons.push('STORE_NOT_ALLOWED_FOR_FAMILY', 'UNREVIEWED_CONTENT_NOT_ALLOWED');
    else if (request.family === 'EXAM_PREPARATION' && !request.policy?.allowUnreviewedInPreparation) reasons.push('UNREVIEWED_CONTENT_NOT_ALLOWED');
    if (coverage.ownerStudentId !== request.studentId) reasons.push('NOT_OWNED_BY_STUDENT');
    if (!(coverage.cacheStatus.state === 'KNOWN' && coverage.cacheStatus.value === 'VALIDATED')) reasons.push('CACHE_ITEM_NOT_VALIDATED');
    // A cached question with no canonical concept cannot be reasoned about by curriculum or exam.
    if (coverage.conceptResolution.status !== 'RESOLVED' && request.family !== 'LEARNING') reasons.push('CONCEPT_UNRESOLVED');
  } else {
    if (!coverage.bankFacts || !isEligible(coverage.bankFacts, use, request.policy?.bankPolicy ?? DEFAULT_ELIGIBILITY, audience)) reasons.push('BANK_DELIVERY_RULE');
    // Third-party content needs a known, deliverable licence. StudyUs-authored content carries none.
    if (coverage.provenance === 'OFFICIAL' || coverage.provenance === 'LICENSED') {
      if (coverage.licensing.state !== 'KNOWN' || coverage.licensing.value.statuses.length === 0) reasons.push('LICENCE_UNKNOWN');
      else if (!coverage.licensing.value.statuses.every((s) => DELIVERABLE_LICENCES.has(s))) reasons.push('LICENCE_NOT_PERMITTED');
    }
  }

  /* ---- exam applicability ---- */
  if (request.family !== 'LEARNING') {
    if (!request.examVersionId) reasons.push('EXAM_VERSION_REQUIRED');
    else if (reviewed) {
      if (coverage.examApplicability.state !== 'KNOWN') reasons.push('EXAM_APPLICABILITY_UNKNOWN');
      else {
        if (coverage.examApplicability.value.examVersionId !== request.examVersionId) reasons.push('EXAM_VERSION_MISMATCH');
        const components = request.assessmentComponentIds ?? null;
        if (components && components.length > 0 && !components.includes(coverage.examApplicability.value.assessmentComponentId ?? '')) reasons.push('COMPONENT_MISMATCH');
      }
    }
  }

  /* ---- curriculum / objective / concept applicability ---- */
  const versions = request.structureVersionIds ?? null;
  if (versions && versions.length > 0 && reviewed) {
    if (coverage.curriculumApplicability.state !== 'KNOWN') reasons.push('CURRICULUM_APPLICABILITY_UNKNOWN');
    else if (!coverage.curriculumApplicability.value.some((s) => versions.includes(s.structureVersionId))) reasons.push('CURRICULUM_MISMATCH');
  }
  const objectives = request.learningObjectiveIds ?? null;
  if (objectives && objectives.length > 0) {
    const own = coverage.learningObjectiveIds.state === 'KNOWN' ? coverage.learningObjectiveIds.value : [];
    if (!own.some((id) => objectives.includes(id))) reasons.push('OBJECTIVE_MISMATCH');
  }
  const wanted = request.canonicalConceptIds ?? null;
  if (wanted && wanted.length > 0) {
    if (coverage.conceptResolution.status !== 'RESOLVED') {
      if (!reasons.includes('CONCEPT_UNRESOLVED')) reasons.push('CONCEPT_UNRESOLVED');
    } else {
      // Coverage holds CANONICAL identities only (B1-C): a TRANSITIONAL link never satisfies a canonical target,
      // and no policy flag can make it.
      if (!coveredConceptIds(coverage).some((id) => wanted.includes(id))) reasons.push('CONCEPT_MISMATCH');
    }
  }

  /* ---- question type ---- */
  const types = request.questionTypes ?? null;
  if (types && types.length > 0 && !(coverage.questionType.state === 'KNOWN' && types.includes(coverage.questionType.value))) reasons.push('QUESTION_TYPE_MISMATCH');

  return reasons.length === 0 ? { eligible: true, use: reviewed ? use : null } : { eligible: false, reasons: [...new Set(reasons)] };
}

/** The permitted candidates of a set. It filters; the order given is kept and nothing is selected. */
export function eligibleCandidates(coverages: readonly QuestionCoverage[], request: QuestionEligibilityRequest): QuestionCoverage[] {
  return coverages.filter((c) => evaluateQuestionEligibility(c, request).eligible);
}
