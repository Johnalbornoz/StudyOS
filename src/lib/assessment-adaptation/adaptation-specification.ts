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
 * `adaptedAt`. The same family, profile, policy and request give the same id on any machine at any time; a
 * changed rule, lever or request gives another. `lineage` holds the content hashes of the three inputs, so a
 * family or a profile edited without a new version is detectable.
 */
import { z } from 'zod';
import { EXAM_FAMILIES } from '@/lib/exam-core/taxonomy';
import { CALCULATOR_POLICIES, ConceptReferenceSchema, CONTEXT_KINDS, ELICITATION_FORMATS, EVIDENCE_ACTIONS, EvidenceTargetSchema, FAMILY_LIFECYCLES, FAMILY_REVIEW_STATUSES, KnowledgeAvailabilitySchema, TASK_DIFFICULTY_BANDS } from '@/lib/exam-core/question-bank/task-families/task-family';
import { AUTHENTICITY_REQUIREMENTS, MARK_STRUCTURES, PROFILE_STATUSES, REASONING_DEPTHS, RUBRIC_STYLES, RULE_AUTHORITIES, STIMULUS_MODES, TRANSFER_EXPECTATIONS } from './assessment-system-profile';
import { sha256OfCanonicalJson } from './canonical-hash';
import { NUMERIC_PROFILES, VARIABLE_DIMENSIONS } from './discipline-policy';
import { ADAPTATION_POOLS, INSTANCE_CLASSES, INSTANCE_PURPOSES } from './instance-lineage';

export const ADAPTATION_SPECIFICATION_VERSION = 1 as const;
export const ADAPTATION_ENGINE = { id: 'studyus-adaptation-engine', version: '1' } as const;

const ID = z.string().trim().min(1).max(200);
const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);

/** Whether an adaptation needs the family's concept to be recorded for the profile's exam family, and how firmly. */
export const KNOWLEDGE_REQUIREMENTS = ['NONE', 'CATALOGUE_LINK_OR_CERTIFIED', 'CERTIFIED'] as const;
export type KnowledgeRequirement = (typeof KNOWLEDGE_REQUIREMENTS)[number];

/** What is asked of the engine. Everything optional is decided by profile, policy and family when it is left out. */
export const AdaptationRequestSchema = z.strictObject({
  purpose: z.enum(INSTANCE_PURPOSES),
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
  /** Default NONE: behaviour fit alone. Production for an exam family asks for more. */
  knowledgeRequirement: z.enum(KNOWLEDGE_REQUIREMENTS).optional(),
  /** Exists so that asking is refused BY NAME: any member present is a request to change an invariant. */
  invariantOverrides: z.strictObject({ primaryConceptStableId: ID.optional(), construct: z.unknown().optional(), evidenceActions: z.array(z.enum(EVIDENCE_ACTIONS)).optional(), evidenceObject: z.string().optional() }).optional(),
});
export type AdaptationRequest = z.infer<typeof AdaptationRequestSchema>;

export const ADAPTATION_REFUSAL_CODES = [
  'FAMILY_INVALID', 'FAMILY_TYPE_NOT_REGISTERED', 'PROFILE_INVALID', 'DISCIPLINE_POLICY_INVALID', 'REQUEST_INVALID',
  'FAMILY_RETIRED', 'DISCIPLINE_POLICY_NOT_FOR_FAMILY_TYPE', 'INVARIANT_CHANGE_REQUESTED',
  'PROFILE_SUPPORT_NOT_DECLARED', 'PROFILE_UNSUPPORTED_BY_FAMILY', 'SUPPORT_CONSTRAINT_VIOLATED',
  'CANONICAL_KNOWLEDGE_NOT_CERTIFIED_FOR_EXAM_FAMILY',
  'RESPONSE_FORMAT_NOT_ALLOWED', 'CONTEXT_NOT_ALLOWED', 'PROFILE_REQUIRES_CONTEXT_FAMILY_CANNOT_PROVIDE', 'PROFILE_REQUIRES_TRANSFER_FAMILY_CANNOT_PROVIDE',
  'TOOL_REQUIRED_BY_FAMILY_FORBIDDEN_BY_PROFILE', 'TOOL_POLICY_NOT_ALLOWED_BY_PROFILE', 'STIMULUS_REQUIRED_BY_FAMILY_NOT_OFFERED_BY_PROFILE',
  'COMMAND_TERM_NOT_IN_PROFILE_VOCABULARY', 'PROFILE_COMPETENCY_NOT_ELICITED',
] as const;
export type AdaptationRefusalCode = (typeof ADAPTATION_REFUSAL_CODES)[number];
export interface AdaptationRefusal { code: AdaptationRefusalCode; detail: string }

/** Where the value of a variable dimension came from. A dimension may have several contributors. */
export const PROVENANCE_ORIGINS = ['REQUEST', 'PROFILE_RULE', 'POLICY_RULE', 'FAMILY'] as const;
export const FieldProvenanceSchema = z.strictObject({
  origin: z.enum(PROVENANCE_ORIGINS),
  /** The profile rule id, the policy rule id, the family field or lever, or the request field. */
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

export const AdaptationSpecificationSchema = z.strictObject({
  v: z.literal(ADAPTATION_SPECIFICATION_VERSION),
  specificationId: SHA256,
  taskFamily: z.strictObject({ familyId: ID, version: ID, familyType: ID, lifecycle: z.enum(FAMILY_LIFECYCLES), reviewStatus: z.enum(FAMILY_REVIEW_STATUSES) }),
  assessmentProfile: z.strictObject({ profileId: ID, version: ID, status: z.enum(PROFILE_STATUSES), examFamilyCode: z.enum(EXAM_FAMILIES).nullable() }),
  disciplinePolicy: z.strictObject({ policyId: ID, version: ID, discipline: ID }),
  /** The ONE concept an instance of this specification is direct evidence of. */
  primaryConcept: ConceptReferenceSchema,
  /** Read from the family for this profile. Surfaced, never inferred: a behaviour fit says nothing about it. */
  canonicalKnowledgeAvailability: KnowledgeAvailabilitySchema,
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
  purpose: z.strictObject({ purpose: z.enum(INSTANCE_PURPOSES), pool: z.enum(ADAPTATION_POOLS).nullable(), minimumInstanceClass: z.enum(INSTANCE_CLASSES) }),
  blueprintRequirement: z.strictObject({ requirementCellKey: ID }).nullable(),
  /** For every variable dimension: who decided it. */
  provenance: z.record(z.enum(VARIABLE_DIMENSIONS), z.array(FieldProvenanceSchema).min(1)),
  lineage: z.strictObject({ engine: z.strictObject({ id: ID, version: ID }), familyContentHash: SHA256, profileContentHash: SHA256, policyContentHash: SHA256, requestHash: SHA256 }),
  /** When the adaptation was made. Passed in; not part of the identity. */
  adaptedAt: z.string().datetime({ offset: true }).nullable(),
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
