/**
 * EA-1 -- the Adaptation Specification: the IMMUTABLE generation input an adaptation produces (pure contract, no IO).
 *
 *   AssessmentTaskFamily + AssessmentSystemProfile + DisciplineAdaptationPolicy + AdaptationRequest
 *     -> adapt() -> AdaptationSpecification | named refusal
 *     -> (Production OS) GenerationRequest -> QuestionCandidate
 *
 * A specification is NOT a question and holds none: no stem, no option, no number of an item, no worked answer.
 * It says, for one family asked the way one system asks: what must be the same as in every other adaptation of
 * the family (`invariants`, with their hash), and what was decided for this one (`variable`), each decision with
 * where it came from (`provenance`).
 *
 * IDENTITY. `specificationId` is the sha256 of the canonical JSON of the specification without its id and without
 * `adaptedAt`. The same family, system profile, component profile, policy, applicability and request give the same
 * id on any machine at any time; a changed rule, lever or request gives another. `lineage` holds the content
 * hashes of the inputs, so a family or a profile edited without a new version is detectable.
 *
 * TARGET. A specification names the system profile and, whenever component-specific behaviour affects generation,
 * the concrete component profile (D2). Every variable dimension that came from a profile says which level it came from.
 */
import { z } from 'zod';
import { EXAM_FAMILIES } from '@/lib/exam-core/taxonomy';
import { CALCULATOR_POLICIES, ConceptReferenceSchema, CONTEXT_KINDS, ELICITATION_FORMATS, EVIDENCE_ACTIONS, EvidenceTargetSchema, FAMILY_LIFECYCLES, FAMILY_REVIEW_STATUSES, TASK_DIFFICULTY_BANDS } from '@/lib/exam-core/question-bank/task-families/task-family';
import { APPLICABILITY_BASES, APPLICABILITY_STATUSES, ApplicabilityEvidenceSchema } from './assessment-applicability';
import { AuthorityVersionBindingSchema, AUTHENTICITY_REQUIREMENTS, MARK_STRUCTURES, PROFILE_STATUSES, REASONING_DEPTHS, RUBRIC_STYLES, RULE_AUTHORITIES, STIMULUS_MODES, TRANSFER_EXPECTATIONS } from './assessment-system-profile';
import { sha256OfCanonicalJson } from './canonical-hash';
import { NUMERIC_PROFILES, VARIABLE_DIMENSIONS } from './discipline-policy';
import { ADAPTATION_POOLS, CONTENT_USE_CLASSES, INSTANCE_CLASSES, INSTANCE_PURPOSES } from './instance-lineage';
import { APPROACH_DIMENSIONS, APPROACH_PARTICIPATION_MODES, APPROACH_STATUSES, EVIDENCE_YIELDS, PREFERENCE_STRENGTHS } from '@/lib/learning-approach/learning-approach-profile';
import { CURRICULUM_STRUCTURE_STATUSES, ENTITLEMENT_BASES } from '@/lib/learning-approach/institution-configuration';

export const ADAPTATION_SPECIFICATION_VERSION = 2 as const;
export const ADAPTATION_ENGINE = { id: 'studyus-adaptation-engine', version: '2' } as const;

const ID = z.string().trim().min(1).max(200);
const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * Whether an adaptation needs ASSESSMENT APPLICABILITY of the concept to be established for its target.
 * EVIDENCE_BEARING content always needs it, whatever is asked here; this option lets dev-test content ask for it too.
 */
export const APPLICABILITY_REQUIREMENTS = ['NOT_REQUIRED', 'ESTABLISHED'] as const;
export type ApplicabilityRequirement = (typeof APPLICABILITY_REQUIREMENTS)[number];

/** What is asked of the engine. Everything optional is decided by profile, policy and family when it is left out. */
export const AdaptationRequestSchema = z.strictObject({
  purpose: z.enum(INSTANCE_PURPOSES),
  /** What the content is produced for. Stated, never defaulted: dev-test content and evidence-bearing content are different uses. */
  contentUseClass: z.enum(CONTENT_USE_CLASSES),
  difficultyBand: z.enum(TASK_DIFFICULTY_BANDS),
  language: ID,
  /** Required when the family has several PRIMARY concepts. A concept the family does not have is a change of invariant. */
  targetPrimaryConceptStableId: ID.optional(),
  responseFormat: z.enum(ELICITATION_FORMATS).optional(),
  context: z.enum(CONTEXT_KINDS).optional(),
  calculatorPolicy: z.enum(CALCULATOR_POLICIES).optional(),
  commandTerm: z.string().trim().min(2).max(60).optional(),
  /** The requirement cell the instance is for, when there is one. */
  requirementCellKey: ID.nullable().optional(),
  /** Default NOT_REQUIRED for dev-test content; evidence-bearing content requires ESTABLISHED regardless. */
  applicabilityRequirement: z.enum(APPLICABILITY_REQUIREMENTS).optional(),
  /** EA-1A, optional (default INDIVIDUAL). COLLABORATIVE needs an approach and a family that support it, and is never evidence-bearing. */
  participationMode: z.enum(APPROACH_PARTICIPATION_MODES).optional(),
  /** Exists so that asking is refused BY NAME: any member present is a request to change an invariant. */
  invariantOverrides: z.strictObject({ primaryConceptStableId: ID.optional(), construct: z.unknown().optional(), evidenceActions: z.array(z.enum(EVIDENCE_ACTIONS)).optional(), evidenceObject: z.string().optional() }).optional(),
});
export type AdaptationRequest = z.infer<typeof AdaptationRequestSchema>;

export const ADAPTATION_REFUSAL_CODES = [
  'FAMILY_INVALID', 'FAMILY_TYPE_NOT_REGISTERED', 'PROFILE_INVALID', 'COMPONENT_PROFILE_INVALID', 'COMPONENT_NOT_OF_THE_SYSTEM', 'DISCIPLINE_POLICY_INVALID', 'REQUEST_INVALID', 'APPLICABILITY_REGISTER_INVALID',
  'FAMILY_RETIRED', 'FAMILY_NOT_REVIEWED_FOR_EVIDENCE_BEARING_CONTENT', 'DISCIPLINE_POLICY_NOT_FOR_FAMILY_TYPE', 'INVARIANT_CHANGE_REQUESTED',
  'PROFILE_SUPPORT_NOT_DECLARED', 'PROFILE_UNSUPPORTED_BY_FAMILY', 'SUPPORT_CONSTRAINT_VIOLATED',
  'COMPONENT_REQUIRED', 'ASSESSMENT_APPLICABILITY_NOT_ESTABLISHED',
  'RESPONSE_FORMAT_NOT_ALLOWED', 'CONTEXT_NOT_ALLOWED', 'PROFILE_REQUIRES_CONTEXT_FAMILY_CANNOT_PROVIDE', 'PROFILE_REQUIRES_TRANSFER_FAMILY_CANNOT_PROVIDE',
  'TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE', 'TOOL_POLICY_NOT_ALLOWED_BY_PROFILE', 'STIMULUS_REQUIRED_BY_FAMILY_NOT_OFFERED_BY_PROFILE',
  'COMMAND_TERM_NOT_IN_PROFILE_VOCABULARY', 'PROFILE_COMPETENCY_NOT_ELICITED',
  // EA-1A: locked rulings, the learning approach and the curriculum
  'ASSESSMENT_PROFILE_NOT_CERTIFIED_FOR_EVIDENCE_BEARING_CONTENT', 'DEV_TEST_CONTENT_NOT_ALLOWED_FOR_PURPOSE',
  'LEARNING_APPROACH_INVALID', 'LEARNING_APPROACH_NOT_CERTIFIED_FOR_EVIDENCE_BEARING_CONTENT', 'LEARNING_APPROACH_REQUIREMENT_UNMET', 'PARTICIPATION_MODE_NOT_ALLOWED', 'COLLABORATIVE_ACTIVITY_IS_NOT_INDIVIDUAL_EVIDENCE',
  'CURRICULUM_PROFILE_INVALID', 'CURRICULUM_ENTITLEMENT_NOT_ESTABLISHED',
] as const;
export type AdaptationRefusalCode = (typeof ADAPTATION_REFUSAL_CODES)[number];
export interface AdaptationRefusal { code: AdaptationRefusalCode; detail: string }

/** Where the value of a variable dimension came from. A dimension may have several contributors. */
/** A profile rule says which level it came from: the system's common rule, or a component's override. */
export const PROVENANCE_ORIGINS = ['REQUEST', 'SYSTEM_PROFILE_RULE', 'COMPONENT_PROFILE_RULE', 'POLICY_RULE', 'FAMILY', 'LEARNING_APPROACH_PREFERENCE'] as const;
export const FieldProvenanceSchema = z.strictObject({
  origin: z.enum(PROVENANCE_ORIGINS),
  /** The profile rule id, the policy rule id, the family field or lever, the request field, or the approach preference id. */
  ref: ID,
  /** The authority of a profile or policy rule; null for a request or a family field. */
  authority: z.enum(RULE_AUTHORITIES).nullable(),
});
export type FieldProvenance = z.infer<typeof FieldProvenanceSchema>;

/** The response formats the Production OS can generate today, by elicitation format. null = no production format or template yet. */
export const PRODUCTION_FORMAT_OF: Readonly<Record<(typeof ELICITATION_FORMATS)[number], 'MULTIPLE_CHOICE' | 'STUDENT_PRODUCED' | null>> = { SELECTED_RESPONSE: 'MULTIPLE_CHOICE', NUMERIC_ENTRY: 'STUDENT_PRODUCED', MULTI_SELECT: null, MATH_EXPRESSION: null, SHORT_RESPONSE: null, EXTENDED_RESPONSE: null };

export const InvariantsSchema = z.strictObject({
  /** Every PRIMARY concept of the family, sorted. Certified stable ids; never an id of an exam. */
  primaryConceptStableIds: z.array(ID).min(1),
  canonicalSubject: ID,
  /** The discipline's construct, verbatim from the family's specialisation. */
  construct: z.unknown(),
  evidenceTarget: EvidenceTargetSchema,
});
export type AdaptationInvariants = z.infer<typeof InvariantsSchema>;

/** How an approach's preference fared. An unmet preference is recorded, never dropped. */
export const UnmetPreferenceSchema = z.strictObject({
  preferenceId: ID, dimension: z.enum(APPROACH_DIMENSIONS), strength: z.enum(PREFERENCE_STRENGTHS),
  wanted: z.array(ID).min(1), decided: ID,
  /** The rule, field or request that decided otherwise, with its authority: OFFICIAL when an official assessment constraint won. */
  overriddenBy: FieldProvenanceSchema,
  /**
   * D6: the certification status of the profile (system or component) that owns the overriding rule; null when the
   * overrider is a family field or the request. A PROVISIONAL rule can only ever be recorded on dev-test content:
   * evidence-bearing content is refused unless every profile is CERTIFIED.
   */
  overridingRuleCertification: z.enum(PROFILE_STATUSES).nullable(),
});
export const LearningApproachResolutionSchema = z
  .strictObject({
    approachId: ID, version: ID, status: z.enum(APPROACH_STATUSES), authority: z.literal('STUDYUS_POLICY'), contentHash: SHA256,
    /** The approach's transversal competencies, by catalogue code, and whether THIS family declares it can evidence each. */
    transversalCompetencies: z.array(z.strictObject({ key: ID, code: ID, catalogueStatus: z.enum(['IN_CATALOGUE', 'NOT_YET_IN_CATALOGUE']), servedByFamily: z.boolean() })),
    participation: z.strictObject({ mode: z.enum(APPROACH_PARTICIPATION_MODES), evidenceYield: z.enum(EVIDENCE_YIELDS) }),
    honouredPreferences: z.array(z.strictObject({ preferenceId: ID, dimension: z.enum(APPROACH_DIMENSIONS), decided: ID })),
    unmetPreferences: z.array(UnmetPreferenceSchema),
  })
  .superRefine((a, ctx) => {
    // STANDARD is recorded by absence: a specification never carries it
    if (a.approachId === 'STANDARD') ctx.addIssue({ code: 'custom', path: ['approachId'], message: 'STANDARD_IS_RECORDED_BY_ABSENCE' });
  });
export type LearningApproachResolution = z.infer<typeof LearningApproachResolutionSchema>;

export const AdaptationSpecificationSchema = z.strictObject({
  v: z.literal(ADAPTATION_SPECIFICATION_VERSION),
  specificationId: SHA256,
  taskFamily: z.strictObject({ familyId: ID, version: ID, familyType: ID, lifecycle: z.enum(FAMILY_LIFECYCLES), reviewStatus: z.enum(FAMILY_REVIEW_STATUSES) }),
  /** `versionBinding` is present only when the system profile holds an OFFICIAL rule of its own (D1). */
  systemProfile: z.strictObject({ profileId: ID, version: ID, status: z.enum(PROFILE_STATUSES), examFamilyCode: z.enum(EXAM_FAMILIES).nullable(), versionBinding: AuthorityVersionBindingSchema.optional() }),
  /** The concrete component the specification targets. null = the system profile only: generic practice that needed no component-specific behaviour. */
  componentProfile: z.strictObject({ componentId: ID, version: ID, status: z.enum(PROFILE_STATUSES), localSubject: ID.nullable(), versionBinding: AuthorityVersionBindingSchema.nullable() }).nullable(),
  disciplinePolicy: z.strictObject({ policyId: ID, version: ID, discipline: ID }),
  /** The ONE concept an instance of this specification is direct evidence of. */
  primaryConcept: ConceptReferenceSchema,
  /**
   * Whether the concept may be assessed by the target, as the applicability register records it: basis, the
   * repository's evidence with its review state, and the threshold policy applied. A fact, never inferred from the
   * behaviour fit, and never a certification of the concept.
   */
  assessmentApplicability: z.strictObject({
    status: z.enum(APPLICABILITY_STATUSES), basis: z.enum(APPLICABILITY_BASES),
    scope: z.strictObject({ systemProfileId: ID, subject: ID.nullable(), componentId: ID.nullable() }),
    evidence: z.array(ApplicabilityEvidenceSchema), thresholdPolicy: z.strictObject({ policyId: ID, version: ID }),
  }),
  /** What the specification was produced for. DEV_TEST_CONTENT never bears evidence and never enters a certified pool. */
  contentUseClass: z.enum(CONTENT_USE_CLASSES),
  targetSkills: z.array(ID),
  targetCompetencies: z.array(ID),
  /** The expected evidence: what an instance must show, and what it may not change. Not a worked answer. */
  invariants: InvariantsSchema,
  invariantHash: SHA256,
  variable: z.strictObject({
    context: z.strictObject({ kind: z.enum(CONTEXT_KINDS), authenticity: z.enum(AUTHENTICITY_REQUIREMENTS), transfer: z.enum(TRANSFER_EXPECTATIONS) }),
    responseFormat: z.strictObject({ format: z.enum(ELICITATION_FORMATS), productionFormat: z.enum(['MULTIPLE_CHOICE', 'STUDENT_PRODUCED']).nullable() }),
    reasoningDepth: z.strictObject({ depth: z.enum(REASONING_DEPTHS), workingShown: z.boolean(), justificationRequired: z.boolean() }),
    commandTerm: z.string().nullable(),
    stimulus: z.strictObject({ mode: z.enum(STIMULUS_MODES), kinds: z.array(ID) }),
    /** Codes of the SYSTEM's competency model this instance would count under. Empty when the system has none. */
    competencies: z.array(ID),
    /** Seconds the system's published totals leave per item or per mark; null when it publishes none. */
    timeBudget: z.strictObject({ secondsPerUnit: z.number().positive().nullable(), unit: z.enum(['ITEM', 'MARK']).nullable() }),
    markStructure: z.enum(MARK_STRUCTURES),
    rubricStyle: z.enum(RUBRIC_STYLES),
    toolPolicy: z.strictObject({ calculator: z.enum(CALCULATOR_POLICIES) }),
    numericProfile: z.enum(NUMERIC_PROFILES),
    /** Present for a selected response: the modelled errors its wrong options come from. */
    distractors: z.strictObject({ source: z.literal('FAMILY_MISCONCEPTION_MODELS'), misconceptionModelIds: z.array(ID).min(1) }).nullable(),
    difficulty: z.strictObject({ band: z.enum(TASK_DIFFICULTY_BANDS), basis: z.literal('EDITORIAL_ESTIMATE') }),
    /** The family's levers this adaptation may pull, by lever id. */
    difficultyLevers: z.array(ID),
    language: ID,
  }),
  /** What an instance may vary inside, verbatim from the family (for mathematics: the parameter ranges and the rules of a valid instance). */
  parameterization: z.unknown(),
  purpose: z.strictObject({ purpose: z.enum(INSTANCE_PURPOSES), pool: z.enum(ADAPTATION_POOLS).nullable(), allowedInstanceClasses: z.array(z.enum(INSTANCE_CLASSES)).min(1), minimumInstanceClass: z.enum(INSTANCE_CLASSES) }),
  blueprintRequirement: z.strictObject({ requirementCellKey: ID }).nullable(),
  /** For every variable dimension: who decided it. */
  provenance: z.record(z.enum(VARIABLE_DIMENSIONS), z.array(FieldProvenanceSchema).min(1)),
  lineage: z.strictObject({ engine: z.strictObject({ id: ID, version: ID }), familyContentHash: SHA256, systemProfileContentHash: SHA256, componentProfileContentHash: SHA256.nullable(), policyContentHash: SHA256, requestHash: SHA256 }),
  /** When the adaptation was made. Passed in; not part of the identity. */
  adaptedAt: z.string().datetime({ offset: true }).nullable(),
  /**
   * EA-1A, OPTIONAL. The learning approach the specification was resolved under: what it emphasised, how the
   * learner takes part, which of its preferences were honoured and which could not be -- each unmet one with what
   * was wanted, what was decided and the rule that overrode it. ABSENT under STANDARD or under no approach: the
   * default is recorded by absence, so a specification made before approaches existed is unchanged.
   */
  learningApproach: LearningApproachResolutionSchema.optional(),
  /**
   * EA-1A, OPTIONAL. The curriculum the content is for, as a reference, and whether the concept's ENTITLEMENT under
   * it is established from what the repository records. Absent when no curriculum was named.
   */
  curriculumContext: z.strictObject({
    curriculumId: ID, country: ID, programmeName: ID, programmeVersion: ID, structureStatus: z.enum(CURRICULUM_STRUCTURE_STATUSES),
    entitlement: z.strictObject({ status: z.enum(['ESTABLISHED', 'NOT_ESTABLISHED']), basis: z.enum(ENTITLEMENT_BASES), evidenceReferences: z.array(ID) }),
  }).optional(),
});
export type AdaptationSpecification = z.infer<typeof AdaptationSpecificationSchema>;

/** The id a specification must have: the hash of everything but the id and the timestamp. */
export function specificationIdOf(spec: Omit<AdaptationSpecification, 'specificationId' | 'adaptedAt'> & { specificationId?: string; adaptedAt?: string | null }): string {
  const { specificationId: _id, adaptedAt: _at, ...content } = spec;
  return sha256OfCanonicalJson(content);
}
export const invariantHashOf = (invariants: AdaptationInvariants): string => sha256OfCanonicalJson(invariants);

export type SpecificationIntegrityIssue = 'SCHEMA_INVALID' | 'SPECIFICATION_ID_MISMATCH' | 'INVARIANT_HASH_MISMATCH' | 'PRIMARY_CONCEPT_NOT_IN_INVARIANTS';
/** Is this object a specification whose id and invariant hash are the ones its content gives? A tampered one is named. */
export function specificationIntegrityIssues(input: unknown): SpecificationIntegrityIssue[] {
  const parsed = AdaptationSpecificationSchema.safeParse(input);
  if (!parsed.success) return ['SCHEMA_INVALID'];
  const s = parsed.data;
  const out: SpecificationIntegrityIssue[] = [];
  if (specificationIdOf(s) !== s.specificationId) out.push('SPECIFICATION_ID_MISMATCH');
  if (invariantHashOf(s.invariants) !== s.invariantHash) out.push('INVARIANT_HASH_MISMATCH');
  if (!s.invariants.primaryConceptStableIds.includes(s.primaryConcept.stableId)) out.push('PRIMARY_CONCEPT_NOT_IN_INVARIANTS');
  return out;
}
