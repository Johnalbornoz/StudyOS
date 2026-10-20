/**
 * B1 -- StudentAssessmentContext: the canonical aggregate INPUT of assessment planning.
 *
 * It composes the existing authorities and owns none of them. It carries identities and references, not
 * mutable copies:
 *   - curriculum is referenced by structure version (`CurriculumScopeRef`), never embedded;
 *   - learner state is referenced by its authority and by the Student's concept identities -- no mastery
 *     score, no knowledge state value is copied here (a planner reads the Learner State Authority);
 *   - the preparation target is the existing exam target projection (`PreparationContext`);
 *   - question content never appears here.
 *
 * It decides nothing: which assessment should occur is the Learning Decision Authority's (LEARNING) or the
 * family policy's concern in B2. This contract only states, unambiguously, what is being asked and for whom.
 */
import type { CurriculumScopeRef } from '@/lib/curriculum/curriculum-scope';
import type { ConceptIdentity, ConceptIdentitySummary } from '@/lib/catalog/concept-identity';
import { summarizeConceptIdentities } from '@/lib/catalog/concept-identity';
import type { AssessmentFamily } from './families';
import { isPlannablePreparation, type PreparationContext } from './preparation-context';

export const STUDENT_ASSESSMENT_CONTEXT_VERSION = 1 as const;

/** What is being asked for. A request, not a decision. */
export interface AssessmentIntent {
  family: AssessmentFamily;
  /** Free of pedagogy: the caller names the kind of activity; the family policy interprets it in B2. */
  purpose: 'PRACTICE' | 'DIAGNOSTIC' | 'PROVE' | 'RETAIN' | 'TRANSFER' | 'EXAM_PRACTICE' | 'OFFICIAL_MOCK';
  /** Required for EXAM_PREPARATION and OFFICIAL_EXAM. */
  examTargetId?: string | null;
  /** Optional targets, always by canonical identity. */
  canonicalConceptIds?: string[];
  learningObjectiveIds?: string[];
  /** Optional time the Student states they have. */
  availableMinutes?: number | null;
}

export interface LearnerStateReference {
  /** The single authority a planner reads for "what does this learner know". */
  authority: 'concept_knowledge_state';
  /** The single writer of the evidence that state is projected from. */
  evidenceWriter: 'updateMastery';
  /** The Student's concept instances and their canonical identity (no scores). */
  concepts: ConceptIdentity[];
  identity: ConceptIdentitySummary;
}

export interface StudentAcademicReference {
  contextType: string | null;
  profileCompleted: boolean;
  programme: { id: string; name: string } | null;
  qualification: string | null;
  /** Catalogue subjects of the Student's own profile (explicit ids). */
  academicSubjectIds: string[];
}

export interface StudentAssessmentContext {
  v: typeof STUDENT_ASSESSMENT_CONTEXT_VERSION;
  studentId: string;
  intent: AssessmentIntent;
  academic: StudentAcademicReference;
  /** Structure versions in play, by reference, and why each is. */
  curriculum: Array<CurriculumScopeRef & { basis: 'PREPARATION_TARGET' | 'ACADEMIC_PROFILE' }>;
  learnerState: LearnerStateReference;
  /** The exam target of the intent, when it names one. */
  preparation: PreparationContext | null;
}

export type IntentIssue =
  | 'EXAM_TARGET_REQUIRED'
  | 'EXAM_TARGET_NOT_FOUND'
  | 'EXAM_TARGET_NOT_OWNED'
  | 'EXAM_TARGET_NOT_PLANNABLE'
  | 'PURPOSE_NOT_ALLOWED_FOR_FAMILY'
  | 'OFFICIAL_EXAM_TAKES_NO_LEARNER_TARGETS';

const PURPOSES: Record<AssessmentFamily, ReadonlyArray<AssessmentIntent['purpose']>> = {
  LEARNING: ['PRACTICE', 'DIAGNOSTIC', 'PROVE', 'RETAIN', 'TRANSFER'],
  EXAM_PREPARATION: ['EXAM_PRACTICE', 'DIAGNOSTIC', 'PRACTICE'],
  OFFICIAL_EXAM: ['OFFICIAL_MOCK'],
};

/**
 * Structural validity of an intent against the family boundaries. An OFFICIAL_EXAM intent never carries
 * learner-chosen concept / objective targets: its content is the official blueprint's, not the learner's.
 */
export function validateAssessmentIntent(studentId: string, intent: AssessmentIntent, preparation: PreparationContext | null): IntentIssue[] {
  const issues: IntentIssue[] = [];
  if (!PURPOSES[intent.family].includes(intent.purpose)) issues.push('PURPOSE_NOT_ALLOWED_FOR_FAMILY');
  if (intent.family !== 'LEARNING') {
    if (!intent.examTargetId) issues.push('EXAM_TARGET_REQUIRED');
    else if (!preparation) issues.push('EXAM_TARGET_NOT_FOUND');
    else if (preparation.studentId !== studentId) issues.push('EXAM_TARGET_NOT_OWNED');
    else if (!isPlannablePreparation(preparation)) issues.push('EXAM_TARGET_NOT_PLANNABLE');
  }
  if (intent.family === 'OFFICIAL_EXAM' && ((intent.canonicalConceptIds?.length ?? 0) > 0 || (intent.learningObjectiveIds?.length ?? 0) > 0)) issues.push('OFFICIAL_EXAM_TAKES_NO_LEARNER_TARGETS');
  return issues;
}

export function composeStudentAssessmentContext(parts: {
  studentId: string;
  intent: AssessmentIntent;
  academic: StudentAcademicReference;
  concepts: readonly ConceptIdentity[];
  preparation: PreparationContext | null;
  profileScopes: readonly CurriculumScopeRef[];
}): StudentAssessmentContext {
  const seen = new Set<string>();
  const curriculum: StudentAssessmentContext['curriculum'] = [];
  const add = (ref: CurriculumScopeRef, basis: 'PREPARATION_TARGET' | 'ACADEMIC_PROFILE') => {
    if (seen.has(ref.structureVersionId)) return;
    seen.add(ref.structureVersionId);
    curriculum.push({ ...ref, basis });
  };
  // The exam target's curriculum first: it is the more specific statement when the intent names a target.
  for (const ref of parts.preparation?.curriculumScopes ?? []) add(ref, 'PREPARATION_TARGET');
  for (const ref of parts.profileScopes) add(ref, 'ACADEMIC_PROFILE');
  return {
    v: STUDENT_ASSESSMENT_CONTEXT_VERSION,
    studentId: parts.studentId,
    intent: { ...parts.intent },
    academic: parts.academic,
    curriculum,
    learnerState: { authority: 'concept_knowledge_state', evidenceWriter: 'updateMastery', concepts: [...parts.concepts], identity: summarizeConceptIdentities(parts.concepts) },
    preparation: parts.preparation,
  };
}

/**
 * The Student's own instance of a canonical concept, through a CANONICAL link only (B1-C). A concept the
 * Student holds under a TRANSITIONAL (label-matched) link is NOT returned: for assessment planning it is
 * unresolved.
 */
export function learnerConceptFor(context: StudentAssessmentContext, canonicalConceptId: string): ConceptIdentity | null {
  return context.learnerState.concepts.find((c) => c.status === 'CANONICAL' && c.canonicalConceptId === canonicalConceptId) ?? null;
}
