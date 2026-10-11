/**
 * QB-R2A -- the Requirement Cell: ONE unit of production demand (pure contract, no IO).
 *
 *   Requirement Cell -> Reference Intelligence Pack -> Author / AI Generation -> ...
 *
 * A cell says what kind of question is wanted and why (who requires it). It is not a question and is not a
 * blueprint: a mock cell REFERS to the blueprint requirement it serves. Domain and Topic are structure-node
 * codes and concepts are canonical ids -- a name is never used to find any of them.
 */
import { z } from 'zod';

export const REQUIREMENT_CELL_VERSION = 1 as const;
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
export const ASSET_KINDS = ['DIAGRAM', 'GRAPH', 'CHART', 'IMAGE', 'DATA_VISUALISATION'] as const;
/** Pools whose content is assembled into a form by a blueprint. */
export const MOCK_POOLS: ReadonlySet<ProductionPool> = new Set(['REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2']);

const ID = z.string().trim().min(1).max(200);
const UUID = z.string().uuid();

export const StimulusRequirementSchema = z.discriminatedUnion('required', [
  z.strictObject({ required: z.literal(false) }),
  z.strictObject({ required: z.literal(true), kind: z.enum(STIMULUS_KINDS), stimulusKey: ID.nullable(), itemsInGroup: z.number().int().min(1).max(20) }),
]);
export const AssetRequirementSchema = z.strictObject({ kind: z.enum(ASSET_KINDS), purpose: ID });

export const RequirementCellSchema = z
  .strictObject({
    v: z.literal(REQUIREMENT_CELL_VERSION),
    cellKey: ID,
    examFamily: ID,
    examVersionId: UUID,
    sectionCode: ID,
    domainNodeCode: ID,
    topicNodeCode: ID,
    primaryConceptId: UUID,
    supportingConceptIds: z.array(UUID),
    /** Not modelled yet for any exam: null until the Curriculum has Exam Skills. */
    examSkill: ID.nullable(),
    responseFormat: z.enum(RESPONSE_FORMATS),
    difficultyBand: z.enum(DIFFICULTY_BANDS),
    stimulus: StimulusRequirementSchema,
    assets: z.array(AssetRequirementSchema),
    intendedPool: z.enum(PRODUCTION_POOLS),
    /** Who says this cell is needed. OFFICIAL cites the exam's specification; STUDYUS_POLICY names the policy. */
    authority: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('OFFICIAL'), sourceKeys: z.array(ID).min(1) }),
      z.strictObject({ kind: z.literal('STUDYUS_POLICY'), policyId: ID, policyVersion: ID }),
    ]),
    /** The blueprint requirement the cell serves. Required for a mock pool; null for per-concept pools. */
    blueprintRequirement: z.strictObject({ purpose: z.enum(['FULL', 'REDUCED', 'DIAGNOSTIC']), formNumber: z.number().int().min(1), requirementKey: ID }).nullable(),
  })
  .superRefine((c, ctx) => {
    if (c.supportingConceptIds.includes(c.primaryConceptId) || new Set(c.supportingConceptIds).size !== c.supportingConceptIds.length) ctx.addIssue({ code: 'custom', path: ['supportingConceptIds'], message: 'CONCEPT_LISTED_TWICE' });
    if (MOCK_POOLS.has(c.intendedPool) && !c.blueprintRequirement) ctx.addIssue({ code: 'custom', path: ['blueprintRequirement'], message: 'MOCK_CELL_NEEDS_BLUEPRINT_REQUIREMENT' });
    if (c.blueprintRequirement) {
      const expected = c.intendedPool === 'REDUCED_MOCK' ? 'REDUCED' : c.intendedPool === 'DIAGNOSTIC' ? 'DIAGNOSTIC' : MOCK_POOLS.has(c.intendedPool) ? 'FULL' : null;
      if (expected !== c.blueprintRequirement.purpose) ctx.addIssue({ code: 'custom', path: ['blueprintRequirement'], message: 'BLUEPRINT_PURPOSE_DOES_NOT_MATCH_POOL' });
    }
  });
export type RequirementCell = z.infer<typeof RequirementCellSchema>;

export function validateRequirementCell(input: unknown): { ok: true; cell: RequirementCell } | { ok: false; issues: string[] } {
  const parsed = RequirementCellSchema.safeParse(input);
  return parsed.success ? { ok: true, cell: parsed.data } : { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}
