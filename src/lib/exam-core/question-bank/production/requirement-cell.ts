/**
 * The Requirement Cell: ONE actionable unit of production demand (pure contract, no IO).
 *
 *   RequirementCell -> GenerationRequest -> QuestionCandidate -> ValidatedQuestionCandidate -> HumanReviewPackage
 *
 * A cell says exactly what is wanted: how many items, for which pool, on which Topic of which Domain, as
 * evidence of which ONE concept, in which format and difficulty, on what kind of stimulus -- and who says so.
 * Nothing in it is left to be inferred from a generated question.
 *
 * Identity is by stable code (structure-node codes, the certified concept's stable id). Database row ids differ
 * per environment and live in `binding`, attached by a read-only step. A cell can be planned unbound; it must be
 * bound before generation.
 */
import { z } from 'zod';

export const REQUIREMENT_CELL_VERSION = 2 as const;

/**
 * The six pilot pools and their policy. B2 owns the pool contract (`assessment-blueprint/protected/pools`); the
 * production contracts restate the names so that planning code does not import the selection engine. A test
 * keeps the two lists and the policy identical.
 */
export const PRODUCTION_POOLS = ['PRACTICE', 'DIAGNOSTIC', 'VERIFICATION', 'REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2'] as const;
export type ProductionPool = (typeof PRODUCTION_POOLS)[number];
export const PRODUCTION_POOL_POLICY = { id: 'b2-pilot-pools', version: '1', overlap: 'ZERO_INTENTIONAL_OVERLAP' } as const;
export const RESPONSE_FORMATS = ['MULTIPLE_CHOICE', 'STUDENT_PRODUCED'] as const;
export const DIFFICULTY_BANDS = ['FOUNDATIONAL', 'STANDARD', 'CHALLENGE'] as const;
export const STIMULUS_KINDS = ['PASSAGE', 'PAIRED_PASSAGE', 'POEM', 'NUMBERED_TEXT', 'DRAFT_PARAGRAPH', 'TABLE', 'GRAPH', 'FIGURE', 'DATA_SET', 'COMPOSITE'] as const;
export type StimulusKind = (typeof STIMULUS_KINDS)[number];
export const STIMULUS_CLASSES = ['STANDALONE', 'STIMULUS_REQUIRED', 'STIMULUS_OPTIONAL'] as const;
export const ASSET_KINDS = ['DIAGRAM', 'GRAPH', 'CHART', 'IMAGE', 'DATA_VISUALISATION'] as const;
/** Who says a planning value is what it is. */
export const PLANNING_AUTHORITIES = ['OFFICIAL', 'STUDYUS_POLICY'] as const;
/** The structure version of the cell's Topic is not the published one: condition 5 cannot hold until the cutover. */
export const CURRICULUM_CURRENTNESS = ['CURRENT', 'CURRICULUM_CURRENTNESS_BLOCKED_UNTIL_PAA_CUTOVER'] as const;
/** Pools whose content is assembled into a form by a blueprint. */
export const MOCK_POOLS: ReadonlySet<ProductionPool> = new Set(['REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2']);

const ID = z.string().trim().min(1).max(200);
const UUID = z.string().uuid();

export const StimulusPlanSchema = z.discriminatedUnion('class', [
  z.strictObject({ class: z.literal('STANDALONE') }),
  z.strictObject({ class: z.literal('STIMULUS_REQUIRED'), kind: z.enum(STIMULUS_KINDS) }),
  z.strictObject({ class: z.literal('STIMULUS_OPTIONAL'), kind: z.enum(STIMULUS_KINDS) }),
]);
export type StimulusPlan = z.infer<typeof StimulusPlanSchema>;
export const AssetRequirementSchema = z.strictObject({ kind: z.enum(ASSET_KINDS), purpose: ID });

/** Row ids of one environment. Attached read-only; never guessed and never copied between environments. */
export const CellBindingSchema = z.strictObject({ environmentFingerprint: ID, examVersionId: UUID, topicNodeId: UUID, domainNodeId: UUID, primaryConceptId: UUID });

export const RequirementCellSchema = z
  .strictObject({
    v: z.literal(REQUIREMENT_CELL_VERSION),
    cellKey: ID,
    examFamily: ID,
    /** `exam_definitions.config_key` of the exam version the content is for. */
    examConfigKey: ID,
    sectionCode: ID,
    domainNodeCode: ID,
    /** Exactly one Topic. */
    topicNodeCode: ID,
    /** Exactly one target PRIMARY concept, by its certified stable id and its canonical (subject, name). */
    primaryConcept: z.strictObject({ stableId: ID, canonicalSubject: ID, canonicalName: ID }),
    /** Not modelled yet for any exam: null until the Curriculum has Exam Skills. */
    examSkill: ID.nullable(),
    /** How many unique items the cell needs. */
    count: z.number().int().min(1),
    intendedPool: z.enum(PRODUCTION_POOLS),
    responseFormat: z.enum(RESPONSE_FORMATS),
    responseFormatAuthority: z.enum(PLANNING_AUTHORITIES),
    difficultyBand: z.enum(DIFFICULTY_BANDS),
    /** The bands are StudyUs's editorial estimate. They are never the exam's own classification. */
    difficultyBasis: z.literal('EDITORIAL_ESTIMATE'),
    stimulus: StimulusPlanSchema,
    assets: z.array(AssetRequirementSchema),
    /** Who requires the COUNT. OFFICIAL cites the exam's specification; STUDYUS_POLICY names the policy. */
    authority: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('OFFICIAL'), sourceKeys: z.array(ID).min(1) }),
      z.strictObject({ kind: z.literal('STUDYUS_POLICY'), policyId: ID, policyVersion: ID }),
    ]),
    /** The blueprint variant the cell serves. Required for a mock pool; null for per-concept pools. */
    blueprint: z.strictObject({ purpose: z.enum(['FULL', 'REDUCED']), formNumber: z.number().int().min(1) }).nullable(),
    curriculumCurrentness: z.enum(CURRICULUM_CURRENTNESS),
    binding: CellBindingSchema.nullable(),
  })
  .superRefine((c, ctx) => {
    if (MOCK_POOLS.has(c.intendedPool) !== (c.blueprint !== null)) ctx.addIssue({ code: 'custom', path: ['blueprint'], message: MOCK_POOLS.has(c.intendedPool) ? 'MOCK_CELL_NEEDS_BLUEPRINT' : 'PER_CONCEPT_CELL_HAS_NO_BLUEPRINT' });
    if (c.blueprint && (c.intendedPool === 'REDUCED_MOCK') !== (c.blueprint.purpose === 'REDUCED')) ctx.addIssue({ code: 'custom', path: ['blueprint'], message: 'BLUEPRINT_PURPOSE_DOES_NOT_MATCH_POOL' });
  });
export type RequirementCell = z.infer<typeof RequirementCellSchema>;
export type BoundRequirementCell = RequirementCell & { binding: NonNullable<RequirementCell['binding']> };

export function validateRequirementCell(input: unknown): { ok: true; cell: RequirementCell } | { ok: false; issues: string[] } {
  const parsed = RequirementCellSchema.safeParse(input);
  return parsed.success ? { ok: true, cell: parsed.data } : { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

export const isBound = (cell: RequirementCell): cell is BoundRequirementCell => cell.binding !== null;
