/**
 * EA-1 -- the Assessment Task Family: a reusable WAY OF ELICITING EVIDENCE of a concept (pure contract, no IO).
 *
 *   Canonical Knowledge -> AssessmentTaskFamily -> AssessmentSystemProfile -> DisciplineAdaptationPolicy
 *     -> AdaptationSpecification -> generation -> QuestionCandidate -> selection (B2) -> evidence (B3)
 *
 * A task family is NOT a question and holds no stem, no option and no number of an item. It says: for this ONE
 * certified concept, this is an observable performance that shows the learner has it, these are the situations
 * it can be asked in, these are the ways it can be made harder, these are the errors it should catch, and these
 * are the response forms that still show the performance. The Question Bank owns it. The adaptation engine
 * reads it; nothing in here knows an exam.
 *
 * WHY IT EXISTS. The Production OS plans by requirement cell (pool x Topic x concept x format x band) and writes
 * each item from the concept profile alone. Two items of one cell may therefore be the same task with other
 * numbers, and nothing records that they are. A family gives that sameness an identity, so that later stages can
 * tell "another instance of the same family" from "independent evidence" -- and so that one evidence target can
 * be asked the way each assessment system asks, without a second copy of the knowledge.
 *
 * CANONICAL KNOWLEDGE IS REFERENCED, NEVER RESTATED. A family names its PRIMARY concept by the certified stable
 * id and its canonical (subject, name). It never creates a concept id and never carries a per-exam one. The
 * concept's canonical subject is the family's: `Matemáticas` and `Mathematics` are two subjects and neither is
 * inferred from the other.
 *
 * WHAT A FAMILY DOES NOT SAY. `profileSupport` answers one question only: can this WAY OF ASKING fit how an
 * assessment system elicits evidence (assessment behaviour)? Whether the family's CONCEPT may legitimately be
 * assessed by that system is ASSESSMENT APPLICABILITY -- a separate contract, owned by the shared assessment
 * architecture and read from the Curriculum's mappings (`assessment-adaptation/assessment-applicability.ts`). A
 * family holds no applicability, never infers one from its support, and never needs its concept's canonical
 * subject to carry the same label as an exam's local subject.
 *
 * NAMING. This is the ASSESSMENT task family: a generation / assessment structure, authored and versioned. The
 * Learning Engine's TRANSFER task family (`computeTransferTaskFamilyId`, `transfer_task_instances.task_family_id`)
 * is another concept -- a hash derived from one learner's transfer task, used as evidence of transfer. Neither
 * imports the other; relating them is deferred to B3.
 *
 * DISCIPLINE SPECIALISATION is an open, registered model: `familyType` is a string, and a registry maps it to the
 * schema of `specialization`. A new type is added by registering a schema; this common schema does not change.
 */
import { z } from 'zod';

export const TASK_FAMILY_CONTRACT_VERSION = 1 as const;

const ID = z.string().trim().min(1).max(200);
const STATEMENT = z.string().trim().min(10).max(700);
const SHORT = z.string().trim().min(3).max(300);

/** What a learner can be SEEN to do. Discipline-neutral verbs: a family lists the ones its task requires. */
export const EVIDENCE_ACTIONS = ['RECALL', 'COMPUTE', 'SOLVE', 'REPRESENT', 'FORMULATE', 'INTERPRET', 'EVALUATE', 'JUSTIFY'] as const;
export type EvidenceAction = (typeof EVIDENCE_ACTIONS)[number];
/** Where a task is set. ABSTRACT = no situation at all: the mathematics (or the text, the data) is the whole task. */
export const CONTEXT_KINDS = ['ABSTRACT', 'PERSONAL', 'OCCUPATIONAL', 'SOCIETAL', 'SCIENTIFIC'] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];
/**
 * How a response is given. The names are those of the exam component definitions (`component-definition.ts`,
 * `responseFormats`), restated so that this directory imports no exam module; a test keeps them a subset.
 */
export const ELICITATION_FORMATS = ['SELECTED_RESPONSE', 'MULTI_SELECT', 'NUMERIC_ENTRY', 'MATH_EXPRESSION', 'SHORT_RESPONSE', 'EXTENDED_RESPONSE'] as const;
export type ElicitationFormat = (typeof ELICITATION_FORMATS)[number];
/** The bands of the requirement cell, restated. An editorial estimate, never an exam's own classification. */
export const TASK_DIFFICULTY_BANDS = ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE'] as const;
export type TaskDifficultyBand = (typeof TASK_DIFFICULTY_BANDS)[number];
/** The calculator policies of the exam component definitions, restated. */
export const CALCULATOR_POLICIES = ['NONE', 'ALLOWED', 'SCIENTIFIC_REQUIRED', 'GDC_REQUIRED'] as const;
export type CalculatorPolicy = (typeof CALCULATOR_POLICIES)[number];
/** What kind of thing a difficulty lever changes. A discipline policy says which kinds an adaptation may pull. */
export const DIFFICULTY_LEVER_KINDS = ['NUMERIC', 'STEPS', 'REPRESENTATION', 'CONTEXT_LOAD', 'ABSTRACTION'] as const;
export type DifficultyLeverKind = (typeof DIFFICULTY_LEVER_KINDS)[number];
export const STIMULUS_NEEDS = ['NONE', 'OPTIONAL', 'REQUIRED'] as const;
/** Does the task need a tool to be answered at all? HELPFUL = it can be done without. */
export const TOOL_DEPENDENCIES = ['NONE', 'HELPFUL', 'REQUIRED'] as const;
export type ToolDependency = (typeof TOOL_DEPENDENCIES)[number];
export const FAMILY_LIFECYCLES = ['DRAFT', 'IN_REVIEW', 'CERTIFIED', 'RETIRED'] as const;
export const FAMILY_REVIEW_STATUSES = ['UNREVIEWED', 'IN_REVIEW', 'REVIEWED'] as const;

/** A certified concept, by reference. The same three fields a requirement cell names its PRIMARY concept by. */
export const ConceptReferenceSchema = z.strictObject({ stableId: ID, canonicalSubject: ID, canonicalName: ID });
export type ConceptReference = z.infer<typeof ConceptReferenceSchema>;

/** The structured statement of what observable performance demonstrates the knowledge. */
export const EvidenceTargetSchema = z
  .strictObject({
    /** In the order the task requires them. */
    actions: z.array(z.enum(EVIDENCE_ACTIONS)).min(1),
    /** What the actions are performed ON, in StudyUs's words. */
    object: STATEMENT,
    /** What a learner who has the concept is seen to do in this task. */
    observablePerformance: STATEMENT,
  })
  .superRefine((e, ctx) => {
    if (new Set(e.actions).size !== e.actions.length) ctx.addIssue({ code: 'custom', path: ['actions'], message: 'ACTION_LISTED_TWICE' });
  });
export type EvidenceTarget = z.infer<typeof EvidenceTargetSchema>;

/**
 * The conditions under which a family fits a system. Each is machine-checkable: an adaptation request that falls
 * outside one is refused by name, it is never bent to fit.
 */
export const SupportConstraintSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('RESPONSE_FORMAT_ONLY'), formats: z.array(z.enum(ELICITATION_FORMATS)).min(1), reason: STATEMENT }),
  z.strictObject({ kind: z.literal('CONTEXT_ONLY'), contexts: z.array(z.enum(CONTEXT_KINDS)).min(1), reason: STATEMENT }),
  z.strictObject({ kind: z.literal('DIFFICULTY_ONLY'), bands: z.array(z.enum(TASK_DIFFICULTY_BANDS)).min(1), reason: STATEMENT }),
  z.strictObject({ kind: z.literal('CALCULATOR_ONLY'), policies: z.array(z.enum(CALCULATOR_POLICIES)).min(1), reason: STATEMENT }),
]);
export type SupportConstraint = z.infer<typeof SupportConstraintSchema>;

/** Assessment-behaviour fit of the family for one system. UNSUPPORTED is final: an adaptation is never forced. */
export const ProfileSupportSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('SUPPORTED') }),
  z.strictObject({ status: z.literal('SUPPORTED_WITH_CONSTRAINTS'), constraints: z.array(SupportConstraintSchema).min(1) }),
  z.strictObject({ status: z.literal('UNSUPPORTED'), reason: STATEMENT }),
]);
export type ProfileSupport = z.infer<typeof ProfileSupportSchema>;

/** Every field that does not depend on the discipline. `specialization` is validated by the registered schema of `familyType`. */
export const TaskFamilyCommonSchema = z
  .strictObject({
    v: z.literal(TASK_FAMILY_CONTRACT_VERSION),
    /** Stable across versions. Never contains an exam's name: a family belongs to no exam. */
    familyId: z.string().regex(/^tf\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'FAMILY_ID_FORMAT'),
    /** A change of any field that an adaptation reads is a new version. */
    version: ID,
    familyType: z.string().regex(/^[A-Z][A-Z0-9_]{2,59}$/, 'FAMILY_TYPE_FORMAT'),
    canonicalSubject: ID,
    /** The PRIMARY concept(s) the family is evidence of, by certified stable id. One instance targets exactly one. */
    primaryConcepts: z.array(ConceptReferenceSchema).min(1),
    /** Skill and competency NAMES of the curated learning catalogue. References, like the concept. */
    targetSkills: z.array(ID),
    targetCompetencies: z.array(ID),
    evidenceTarget: EvidenceTargetSchema,
    supportedContexts: z.array(z.strictObject({ kind: z.enum(CONTEXT_KINDS), note: SHORT })).min(1),
    difficultyLevers: z.array(z.strictObject({ lever: ID, kind: z.enum(DIFFICULTY_LEVER_KINDS), description: SHORT })).min(1),
    commonMisconceptions: z.array(SHORT).min(1),
    responseConstraints: z.strictObject({
      /** The response forms in which the evidence target is still observable. */
      allowedFormats: z.array(z.enum(ELICITATION_FORMATS)).min(1),
      stimulusNeed: z.enum(STIMULUS_NEEDS),
      /** Stimulus kinds of the requirement cell (`STIMULUS_KINDS`) the task can be asked about. Empty when it needs none. */
      stimulusKinds: z.array(ID),
      note: SHORT.nullable(),
    }),
    /** Keyed by assessment-system profile id. A system that is not listed is UNDECLARED, which is not SUPPORTED. */
    profileSupport: z.record(ID, ProfileSupportSchema),
    provenance: z.strictObject({
      authoredBy: z.literal('STUDYUS'),
      /** Who wrote the first draft, as for a candidate: a person, or a model run requested by a person. */
      authoringKind: z.enum(['STUDYUS_AUTHORED', 'STUDYUS_GENERATED']),
      authoredAt: z.string().datetime({ offset: true }),
      /** The registered source(s) consulted. Consulted only: a family carries no expression of a source. */
      referenceSourceKeys: z.array(ID),
      containsCopiedProtectedExpression: z.literal(false),
      note: SHORT.nullable(),
    }),
    lifecycle: z.enum(FAMILY_LIFECYCLES),
    reviewStatus: z.enum(FAMILY_REVIEW_STATUSES),
    specialization: z.unknown(),
  })
  .superRefine((f, ctx) => {
    f.primaryConcepts.forEach((c, i) => {
      // one family, one canonical subject: a concept of another subject is another family
      if (c.canonicalSubject !== f.canonicalSubject) ctx.addIssue({ code: 'custom', path: ['primaryConcepts', i, 'canonicalSubject'], message: 'CONCEPT_IS_OF_ANOTHER_CANONICAL_SUBJECT' });
    });
    if (new Set(f.primaryConcepts.map((c) => c.stableId)).size !== f.primaryConcepts.length) ctx.addIssue({ code: 'custom', path: ['primaryConcepts'], message: 'CONCEPT_LISTED_TWICE' });
    if (new Set(f.supportedContexts.map((c) => c.kind)).size !== f.supportedContexts.length) ctx.addIssue({ code: 'custom', path: ['supportedContexts'], message: 'CONTEXT_LISTED_TWICE' });
    if (new Set(f.difficultyLevers.map((l) => l.lever)).size !== f.difficultyLevers.length) ctx.addIssue({ code: 'custom', path: ['difficultyLevers'], message: 'LEVER_LISTED_TWICE' });
    if ((f.responseConstraints.stimulusNeed === 'NONE') !== (f.responseConstraints.stimulusKinds.length === 0)) ctx.addIssue({ code: 'custom', path: ['responseConstraints', 'stimulusKinds'], message: f.responseConstraints.stimulusNeed === 'NONE' ? 'NO_STIMULUS_NEEDS_NO_KIND' : 'STIMULUS_NEEDS_A_KIND' });
    // a family is certified only by a review; nothing certifies itself
    if (f.lifecycle === 'CERTIFIED' && f.reviewStatus !== 'REVIEWED') ctx.addIssue({ code: 'custom', path: ['lifecycle'], message: 'CERTIFIED_NEEDS_A_REVIEW' });
    for (const [profileId, s] of Object.entries(f.profileSupport)) {
      if (s.status !== 'SUPPORTED_WITH_CONSTRAINTS') continue;
      s.constraints.forEach((c, i) => {
        const outside =
          c.kind === 'RESPONSE_FORMAT_ONLY' ? c.formats.some((x) => !f.responseConstraints.allowedFormats.includes(x))
          : c.kind === 'CONTEXT_ONLY' ? c.contexts.some((x) => !f.supportedContexts.some((s2) => s2.kind === x))
          : false;
        // a constraint narrows what the family allows; it can never add a format or a context the family lacks
        if (outside) ctx.addIssue({ code: 'custom', path: ['profileSupport', profileId, 'constraints', i], message: 'CONSTRAINT_WIDENS_THE_FAMILY' });
      });
    }
  });
export type TaskFamily<S = unknown> = Omit<z.infer<typeof TaskFamilyCommonSchema>, 'specialization'> & { specialization: S };
/** The explicit name of the concept, to tell it from the transfer engine's TransferTaskFamily. Same type. */
export type AssessmentTaskFamily<S = unknown> = TaskFamily<S>;
/** May a family version feed evidence-bearing (certified) content? Only a REVIEWED and CERTIFIED one; any other generates DEV_TEST_CONTENT only. */
export const familyMayFeedEvidenceBearingContent = (f: Pick<TaskFamily, 'lifecycle' | 'reviewStatus'>): boolean => f.reviewStatus === 'REVIEWED' && f.lifecycle === 'CERTIFIED';

/**
 * What the adaptation engine may read from a specialisation, whatever the discipline. The engine never looks
 * inside `specialization` itself: it asks the registered specialisation for these four facts.
 */
export interface SpecializationAdaptationFacts {
  /** The construct that must be the same in every instance of the family (for mathematics: the structure and its relationships). */
  invariantConstruct: unknown;
  toolDependency: ToolDependency;
  /** What an instance may vary inside (for mathematics: the parameter ranges). Carried into a specification verbatim. */
  parameterization: unknown;
  /** Ids of the modelled errors a distractor can be built from. */
  misconceptionModelIds: string[];
}

export interface TaskFamilySpecialization<S = unknown> {
  familyType: string;
  /** The discipline whose adaptation policy applies to families of this type. */
  discipline: string;
  version: string;
  schema: z.ZodType<S>;
  adaptationFacts(specialization: S): SpecializationAdaptationFacts;
}

/**
 * The family types the brief names. IMPLEMENTED has a registered schema in this repository; DECLARED is a
 * reserved name with the fields its specialisation is expected to carry -- documentation of intent, not a schema.
 * A family of a DECLARED type is refused (`FAMILY_TYPE_NOT_REGISTERED`) until its schema is registered.
 */
export const KNOWN_FAMILY_TYPES: Readonly<Record<string, { status: 'IMPLEMENTED' | 'DECLARED'; discipline: string; intendedSpecializationFields: readonly string[] }>> = {
  MATH_PROBLEM: { status: 'IMPLEMENTED', discipline: 'MATHEMATICS', intendedSpecializationFields: ['mathematicalStructure', 'variables', 'parameterRanges', 'relationships', 'constraints', 'validSolutionRules', 'misconceptionModels', 'numericalDifficultyLevers', 'calculatorDependency'] },
  SCIENCE_PROBLEM: { status: 'DECLARED', discipline: 'SCIENCE', intendedSpecializationFields: ['physicalModel', 'quantitiesAndUnits', 'parameterRanges', 'governingRelationships', 'assumptions', 'validSolutionRules', 'misconceptionModels', 'dataBookletDependency'] },
  SCIENCE_INVESTIGATION: { status: 'DECLARED', discipline: 'SCIENCE', intendedSpecializationFields: ['investigationQuestionType', 'variablesAndControls', 'dataShape', 'analysisMoves', 'sourcesOfError', 'validConclusionRules'] },
  READING_ANALYSIS: { status: 'DECLARED', discipline: 'READING', intendedSpecializationFields: ['textTypes', 'textFeaturesRequired', 'readingOperation', 'evidenceLocation', 'distractorLogic', 'textComplexityLevers'] },
  WRITING_EDITING: { status: 'DECLARED', discipline: 'WRITING', intendedSpecializationFields: ['editingOperation', 'draftFeaturesRequired', 'unitOfRevision', 'acceptableRevisionRules', 'distractorLogic'] },
  SOURCE_ANALYSIS: { status: 'DECLARED', discipline: 'HUMANITIES', intendedSpecializationFields: ['sourceTypes', 'sourceCount', 'analysisOperation', 'provenanceFeatures', 'validJudgementRules'] },
  CASE_ANALYSIS: { status: 'DECLARED', discipline: 'SOCIAL_SCIENCES', intendedSpecializationFields: ['caseShape', 'stakeholders', 'analysisFramework', 'decisionOrRecommendation', 'validArgumentRules'] },
  LANGUAGE_USE: { status: 'DECLARED', discipline: 'LANGUAGE', intendedSpecializationFields: ['languageFeature', 'proficiencyBand', 'carrierSentenceRules', 'acceptableAnswerRules', 'distractorLogic'] },
};

export type TaskFamilyIssue = 'COMMON_SCHEMA_INVALID' | 'FAMILY_TYPE_NOT_REGISTERED' | 'SPECIALIZATION_INVALID';
export type TaskFamilyValidation = { ok: true; family: TaskFamily; specialization: TaskFamilySpecialization } | { ok: false; issue: TaskFamilyIssue; details: string[] };

export interface TaskFamilyRegistry {
  familyTypes(): string[];
  specializationOf(familyType: string): TaskFamilySpecialization | null;
  /** A NEW registry that also knows `specialization`. Registries are values: nothing is registered globally. */
  with<S>(specialization: TaskFamilySpecialization<S>): TaskFamilyRegistry;
  validate(input: unknown): TaskFamilyValidation;
}

/** A registry of specialisations. Adding a discipline is `registry.with(spec)`: the common schema is untouched. */
export function createTaskFamilyRegistry(specializations: readonly TaskFamilySpecialization[]): TaskFamilyRegistry {
  const byType = new Map<string, TaskFamilySpecialization>();
  for (const s of specializations) {
    if (byType.has(s.familyType)) throw new Error(`FAMILY_TYPE_ALREADY_REGISTERED: ${s.familyType}`);
    byType.set(s.familyType, s);
  }
  return {
    familyTypes: () => [...byType.keys()].sort(),
    specializationOf: (t) => byType.get(t) ?? null,
    with: (s) => createTaskFamilyRegistry([...byType.values(), s as TaskFamilySpecialization]),
    validate(input) {
      const common = TaskFamilyCommonSchema.safeParse(input);
      if (!common.success) return { ok: false, issue: 'COMMON_SCHEMA_INVALID', details: common.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
      const specialization = byType.get(common.data.familyType);
      if (!specialization) return { ok: false, issue: 'FAMILY_TYPE_NOT_REGISTERED', details: [common.data.familyType] };
      const parsed = specialization.schema.safeParse(common.data.specialization);
      if (!parsed.success) return { ok: false, issue: 'SPECIALIZATION_INVALID', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
      return { ok: true, family: { ...common.data, specialization: parsed.data }, specialization };
    },
  };
}
