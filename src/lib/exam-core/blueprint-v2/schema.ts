/**
 * Blueprint Engine V2 / BP-0 -- the canonical Blueprint document.
 *
 * A Blueprint says how a valid assessment instrument (a diagnostic, a paper
 * practice, a Mock) is built and scored for one exam definition + version:
 * components, sections, which items are ELIGIBLE (predicates -- never item
 * ids), mark-allocation expectations, weights, the scoring pipeline and
 * which stages depend on a session (boundaries, conversions). Every academic
 * value carries its provenance or is UNKNOWN.
 *
 * Generic across exam families: no field or branch is specific to IB,
 * Cambridge, PAA or ICFES. Layers that do not apply are absent / empty.
 *
 * BP-0: a representation only. Nothing persists it and no runtime decision
 * reads it yet (see docs/exams/blueprint-v2/BP0_FOUNDATION.md).
 */
import { z } from 'zod';
import { PROVENANCE_KINDS } from './provenance';
import { SCORE_UNITS } from './units';
import { SLOT_DIMENSIONS, SlotConstraintSchema } from '../slot-constraints';

export const BLUEPRINT_SCHEMA_ID = 'studyus.blueprint/v2' as const;

export const ProvenanceSchema = z.object({
  kind: z.enum(PROVENANCE_KINDS),
  authority: z.enum(['AWARDING_BODY', 'INSTITUTION', 'NONE']),
  sourceKeys: z.array(z.string().min(1).max(80)).max(20),
});

/** A fact is STATED (with provenance) or UNKNOWN (with a reason). There is no third, defaulted state. */
export function factSchema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('STATED'), value, provenance: ProvenanceSchema }),
    z.object({ status: z.literal('UNKNOWN'), reason: z.string().min(1).max(300) }),
  ]);
}

export function policySchema<T extends z.ZodTypeAny>(value: T) {
  return z.object({ origin: z.literal('STUDYUS_POLICY'), value, note: z.string().min(1).max(300) });
}

export const BLUEPRINT_KINDS = [
  'GENERAL',
  'FULL_MOCK',
  'REDUCED_MOCK',
  'DIAGNOSTIC',
  'PAPER_PRACTICE',
  'COMPONENT_PRACTICE',
  'SECTION_PRACTICE',
  'TOPIC_PRACTICE',
  'CHECKPOINT_PRACTICE',
] as const;
export type BlueprintKind = (typeof BLUEPRINT_KINDS)[number];

// ---------------------------------------------------------------------------
// Scoring pipeline
// ---------------------------------------------------------------------------

export const STAGE_KINDS = [
  'ITEM_MARKS',
  'COMPONENT_TOTAL',
  'AREA_GROUPING',
  'COMPONENT_WEIGHTING',
  'SCALE_CONVERSION',
  'GLOBAL_COMBINATION',
  'GRADE_BOUNDARIES',
  'QUALIFICATION_AGGREGATION',
] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_INPUTS = ['ITEM_RESPONSE', ...SCORE_UNITS] as const;
export type StageInput = (typeof STAGE_INPUTS)[number];

export const DEPENDENCY_KINDS = [
  'ITEM_MARKSCHEME',
  'COMPONENT_MAX_MARKS',
  'REPORTING_GROUPS',
  'COMPONENT_WEIGHTS',
  'SCALE_CONVERSION',
  'GLOBAL_FORMULA',
  'GRADE_BOUNDARIES',
  'QUALIFICATION_RULE',
] as const;

export const DependencySchema = z.object({
  kind: z.enum(DEPENDENCY_KINDS),
  /** What the dependency varies with: a sitting's boundaries are per SESSION; a paper weight is per VERSION. */
  resolvedPer: z.enum(['ITEM', 'VERSION', 'SESSION', 'QUALIFICATION']),
  status: z.enum(['RESOLVED', 'UNRESOLVED']),
  provenance: ProvenanceSchema,
  reason: z.string().max(300).nullable(),
});
export type StageDependency = z.infer<typeof DependencySchema>;

const KEY = z.string().min(1).max(80);

export const StageSchema = z.object({
  kind: z.enum(STAGE_KINDS),
  input: z.enum(STAGE_INPUTS),
  output: z.enum(SCORE_UNITS),
  dependency: DependencySchema,
  /** Kind-specific references (validated against the document): groups, scale / rule keys, scope. */
  params: z
    .object({
      scope: z.enum(['COMPONENT', 'AREA', 'SUBJECT', 'GLOBAL']).optional(),
      scaleKey: KEY.optional(),
      formulaKey: KEY.optional(),
      ruleKey: KEY.optional(),
      groups: z.array(z.object({ key: KEY, label: z.string().min(1).max(120), componentKeys: z.array(KEY).min(1) })).optional(),
    })
    .default({}),
});
export type PipelineStage = z.infer<typeof StageSchema>;

export const PipelineResolutionSchema = z.object({
  lastResolvableStage: z.enum(STAGE_KINDS).nullable(),
  stoppedAt: z.enum(STAGE_KINDS).nullable(),
  stopReason: z.string().max(300).nullable(),
  /** The pipeline has no stage after the last configured one (e.g. no reported outcome declared). */
  outcomeDeclared: z.boolean(),
});

// ---------------------------------------------------------------------------
// Components, sections, cells
// ---------------------------------------------------------------------------

export const EligibilityPredicateSchema = z.object({
  /** The learning objectives an eligible item must assess (by objective code within the exam version). */
  learningObjectiveCodes: z.array(KEY).min(1),
  questionType: z.string().min(1).max(40).nullable(),
  /** Declared item difficulty (1-5) range; null = any. */
  difficulty: z.object({ scale: z.literal('DECLARED_1_5'), min: z.number().int().min(1).max(5).nullable(), max: z.number().int().min(1).max(5).nullable() }).nullable(),
  commandTerm: z.string().min(1).max(60).nullable(),
  reasoningRequirement: z.string().max(200).nullable(),
  /**
   * Structured slot requirements (Exam Core contract `slot-constraints.ts`, owned by the Blueprint): an item is
   * eligible only if EVERY one matches. Present only when the slot declares any (documents without them are unchanged).
   */
  constraints: z.array(SlotConstraintSchema).min(1).max(6).optional(),
});
export type EligibilityPredicate = z.infer<typeof EligibilityPredicateSchema>;

export const CellSchema = z.object({
  cellKey: z.string().min(1).max(300),
  objectiveCode: KEY,
  objectiveDescription: z.string().max(1000),
  /** Positions this cell contributes to one form of this blueprint. */
  positions: z.number().int().min(1),
  eligibility: EligibilityPredicateSchema,
  /** Marks per position come from the item's own mark scheme unless an official per-cell value is stated. */
  marks: z.object({ source: z.literal('ITEM_MARKSCHEME') }).or(z.object({ source: z.literal('STATED'), value: factSchema(z.number().positive()) })),
});
export type BlueprintCell = z.infer<typeof CellSchema>;

export const COMPONENT_ASSESSMENT = ['EXTERNAL', 'INTERNAL', 'NOT_APPLICABLE'] as const;
/** Origin of a declared allocation (ComponentDefinition.blueprintSpecification). */
export const ALLOCATION_ORIGINS = ['OFFICIAL', 'OFFICIAL_DERIVED', 'STUDYUS_POLICY'] as const;

export const ComponentSchema = z.object({
  key: KEY,
  order: z.number().int().min(0),
  name: z.string().min(1).max(200),
  componentType: z.string().min(1).max(40),
  simulationCapable: z.boolean(),
  official: z.object({
    name: factSchema(z.string()),
    code: factSchema(z.string()),
    kind: factSchema(z.string()),
    assessment: factSchema(z.enum(COMPONENT_ASSESSMENT)),
    durationMinutes: factSchema(z.number().positive()),
    maxMarks: factSchema(z.number().positive()),
    weightPercent: factSchema(z.number()),
    itemCount: factSchema(z.number().int().positive()),
    calculatorPolicy: factSchema(z.string()),
    responseFormats: factSchema(z.array(z.string())),
    resources: z.array(z.string()),
    limitations: z.array(z.string()),
  }),
  sections: z.array(z.object({ key: KEY, label: z.string().min(1).max(200), marksApprox: factSchema(z.number().positive()), responseKind: z.string().max(80).nullable() })),
  assessmentObjectives: z.array(z.object({ code: z.string().min(1).max(20), label: z.string().max(300), weightPercent: factSchema(z.string()) })),
  distributions: z.array(z.object({ dimension: z.string().min(1).max(60), values: z.record(z.string(), z.string()), provenance: ProvenanceSchema })),
  commandTerms: z.array(z.string()),
  /** StudyUs delivery choices for this blueprint -- never assessment facts. */
  delivery: z.object({
    durationMinutes: policySchema(z.number().positive()).nullable(),
    toolRules: z.record(z.string(), z.unknown()).nullable(),
    targetDifficultyIndex: policySchema(z.number()).nullable(),
    blueprintWeight: policySchema(z.number().positive()).nullable(),
  }),
  cells: z.array(CellSchema),
  /**
   * The declared full-form allocation of the slot requirements (definition.blueprintSpecification): margins per
   * dimension, the cell matrix and other policies, each with its origin. OFFICIAL / OFFICIAL_DERIVED carry the
   * provenance of their sources; STUDYUS_POLICY is never authoritative. Present only when declared.
   */
  allocation: z
    .object({
      status: z.enum(['DOCUMENTED', 'PARTIAL', 'UNKNOWN']),
      margins: z.array(z.object({ dimension: z.enum(SLOT_DIMENSIONS), totals: z.record(z.string(), z.number().int().min(0)), origin: z.enum(ALLOCATION_ORIGINS), provenance: ProvenanceSchema, note: z.string().nullable() })),
      cells: z.object({ counts: z.array(z.object({ constraints: z.array(SlotConstraintSchema).min(1), count: z.number().int().min(1) })), origin: z.enum(ALLOCATION_ORIGINS), provenance: ProvenanceSchema, note: z.string().nullable() }).nullable(),
      policies: z.array(z.object({ key: z.string().min(1), origin: z.enum(ALLOCATION_ORIGINS), provenance: ProvenanceSchema, note: z.string().nullable() })),
    })
    .optional(),
  plannedPositions: z.number().int().min(0),
  /** OFFICIAL_LENGTH / REDUCED by item count; DEPENDS_ON_ITEM_MARKS when only marks are published (items carry marks, the blueprint does not). */
  lengthFidelity: z.enum(['OFFICIAL_LENGTH', 'REDUCED', 'DEPENDS_ON_ITEM_MARKS', 'UNKNOWN']),
});
export type BlueprintComponent = z.infer<typeof ComponentSchema>;

export const RouteSchema = z.object({
  key: KEY,
  label: z.string().max(200),
  componentSets: z.array(z.array(KEY).min(1)).min(1),
  stages: z.array(z.array(z.array(KEY).min(1))).nullable(),
  provenance: ProvenanceSchema,
});

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export const BlueprintV2Schema = z.object({
  schema: z.literal(BLUEPRINT_SCHEMA_ID),
  identity: z.object({
    examFamily: z.string().min(1).max(40),
    ecosystem: z.string().min(1).max(40),
    examDefinitionKey: KEY,
    examDefinitionName: z.string().min(1).max(200),
    purpose: z.string().max(500),
    versionLabel: z.string().min(1).max(100),
    blueprintKind: z.enum(BLUEPRINT_KINDS),
    /** Derived from the source configuration's fingerprint when compiled (`config:<hash12>`). */
    blueprintVersion: z.string().min(1).max(60),
    /** The selected official route / component set, when the version has routes. */
    route: z.object({ routeKey: KEY, componentSet: z.array(KEY).min(1) }).nullable(),
    /** ALL components of the version, one official ROUTE_SET, or a SUBSET (paper / component practice). */
    componentScope: z.enum(['ALL', 'ROUTE_SET', 'SUBSET']),
    /** hashCanonical of the parsed Exam Core configuration this was compiled from (= configFingerprint). */
    sourceConfigFingerprint: z.string().nullable(),
  }),
  context: z.object({
    organization: z.string().min(1).max(200),
    programme: z.object({ name: z.string().min(1).max(200), type: z.string().min(1).max(40), stage: z.string().max(60).nullable() }),
    qualification: z.string().max(200).nullable(),
    subject: z.string().max(200).nullable(),
    level: z.string().max(40).nullable(),
    domains: z.array(z.string()),
    contentStatus: z.string().min(1).max(40),
    structureOnly: z.boolean(),
  }),
  framework: z.object({
    frameworkKey: factSchema(z.string()),
    curriculumVersion: factSchema(z.string()),
    frameworkVersion: factSchema(z.string()),
    syllabusCode: factSchema(z.string()),
    firstAssessment: factSchema(z.number().int()),
    lastAssessment: factSchema(z.number().int()),
  }),
  session: z.object({
    /** Some pipeline stage depends on a specific sitting (boundaries / conversions). */
    requiredByPipeline: z.boolean(),
    status: z.enum(['RESOLVED', 'UNKNOWN']),
    reason: z.string().max(300).nullable(),
    /** Free-text hints from the configuration (not a modelled session). */
    configuredSessionLabel: z.string().max(60).nullable(),
    configuredExamYear: z.number().int().nullable(),
  }),
  components: z.array(ComponentSchema).min(1),
  routes: z.array(RouteSchema),
  reportingGroups: z.array(z.object({ key: KEY, label: z.string().max(120), componentKeys: z.array(KEY).min(1), institutionDefined: z.boolean() })),
  commandTerms: z.array(z.object({ term: z.string().min(1).max(60), expectedReasoningType: z.string().max(40).nullable() })),
  scoring: z.object({
    pipeline: z.array(StageSchema).min(1),
    resolution: PipelineResolutionSchema,
    /** The Exam Core V1 policy the runtime executes today (parity reference; not part of V2 resolution). */
    runtimeV1: z.object({
      engine: z.string(),
      strategy: z.string(),
      transform: z.string(),
      unit: z.string().nullable(),
      official: z.boolean(),
      policyHash: z.string(),
    }),
  }),
  qualificationAggregation: z.object({ groupKey: KEY, groupName: z.string().max(200), subjectGroup: z.string().max(100) }).nullable(),
  fingerprint: z.string().length(64),
});
export type BlueprintV2 = z.infer<typeof BlueprintV2Schema>;
export type BlueprintV2Input = z.input<typeof BlueprintV2Schema>;
