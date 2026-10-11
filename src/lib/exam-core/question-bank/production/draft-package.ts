/**
 * QB-R1B -- the Question Production draft package: the INPUT to authoring or generation (pure contract, no IO).
 *
 *   Requirement Cell -> Reference Intelligence Pack -> Author / AI Generation -> ...
 *
 * A package says what question is wanted and what may be consulted while writing it. It is not a question, it
 * is not stored in the bank, and nothing becomes eligible because a package exists: every eligibility fact
 * (review, attribution, rights, originality, pool) is established later, on the ingested item version.
 *
 * Three things are kept apart and none implies another:
 *   reference source     what was consulted (`ReferenceSource`)            -> never a right to reuse
 *   content provenance   who will write the item (`provenance`)            -> STUDYUS_AUTHORED or STUDYUS_GENERATED
 *   reuse rights         whether StudyUs may deliver it                    -> a rights record, after review
 *
 * Identifiers are canonical ids / codes (structure-node codes, canonical concept ids). A name is never used to
 * find a Domain, a Topic or a concept.
 */
import { z } from 'zod';

export const DRAFT_PACKAGE_VERSION = 1 as const;

const ID = z.string().trim().min(1).max(200);
const UUID = z.string().uuid();

/** What kind of thing a reference is. PEDAGOGICAL_REFERENCE is an external teaching source (the policy slot). */
export const REFERENCE_SOURCE_TYPES = ['OFFICIAL_SPECIFICATION', 'OFFICIAL_SAMPLE', 'PEDAGOGICAL_REFERENCE', 'STUDYUS_INTERNAL'] as const;
/**
 * What the source may be used for. REFERENCE_ONLY is the only class a pedagogical reference can have: it may be
 * read to understand, and nothing of its expression may be carried into an item.
 */
export const PERMITTED_USE_CLASSES = ['REFERENCE_ONLY', 'ADAPTATION_LICENSED', 'REPRODUCTION_LICENSED', 'ACCESS_NOT_VALIDATED'] as const;

export const ReferenceSourceSchema = z
  .strictObject({
    /** Stable identity of the source: the `assessment_sources.source_key` it is, or will be, registered under. */
    sourceKey: ID,
    sourceType: z.enum(REFERENCE_SOURCE_TYPES),
    title: ID,
    publisher: ID.nullable(),
    locator: z.string().trim().max(300).nullable(),
    /** How the source can be read (`assessment_sources.source_access`). Not a right to reuse. */
    sourceAccess: z.enum(['PUBLICLY_ACCESSIBLE', 'PRIVATE', 'LICENSED_SOURCE', 'NOT_APPLICABLE']),
    permittedUse: z.enum(PERMITTED_USE_CLASSES),
    /** The licence or authorisation that allows adaptation or reproduction. Required for those two classes. */
    licenceReference: z.string().trim().max(300).nullable(),
  })
  .superRefine((s, ctx) => {
    if ((s.permittedUse === 'ADAPTATION_LICENSED' || s.permittedUse === 'REPRODUCTION_LICENSED') && !s.licenceReference) ctx.addIssue({ code: 'custom', path: ['licenceReference'], message: 'LICENCE_REFERENCE_REQUIRED' });
    // An external teaching source is consulted, never adapted or reproduced, whatever access StudyUs has to it.
    if (s.sourceType === 'PEDAGOGICAL_REFERENCE' && s.permittedUse !== 'REFERENCE_ONLY' && s.permittedUse !== 'ACCESS_NOT_VALIDATED') ctx.addIssue({ code: 'custom', path: ['permittedUse'], message: 'PEDAGOGICAL_REFERENCE_IS_REFERENCE_ONLY' });
  });
export type ReferenceSource = z.infer<typeof ReferenceSourceSchema>;

/** A fact about how the concept is taught or assessed, restated by StudyUs. Never a quotation. */
export const PedagogicalFactSchema = z.strictObject({
  kind: z.enum(['CONCEPT_DEFINITION', 'COMMON_MISCONCEPTION', 'TYPICAL_TASK_FORM', 'DIFFICULTY_DRIVER', 'PREREQUISITE', 'STYLE_RULE']),
  /** StudyUs's own statement of the fact. */
  statement: z.string().trim().min(10).max(600),
  /** Which registered source(s) the fact was learned from. */
  sourceKeys: z.array(ID).min(1),
  /** Declared by whoever compiled the pack: the statement reproduces no protected expression of its sources. */
  restatedInOwnWords: z.literal(true),
});

export const ReferenceIntelligencePackSchema = z
  .strictObject({
    v: z.literal(DRAFT_PACKAGE_VERSION),
    sources: z.array(ReferenceSourceSchema).min(1),
    facts: z.array(PedagogicalFactSchema),
    /** The pack carries no copied question, passage or text of a source. Declared, and checked again at originality review. */
    containsCopiedProtectedExpression: z.literal(false),
  })
  .superRefine((p, ctx) => {
    const keys = new Set(p.sources.map((s) => s.sourceKey));
    if (keys.size !== p.sources.length) ctx.addIssue({ code: 'custom', path: ['sources'], message: 'DUPLICATE_SOURCE' });
    p.facts.forEach((f, i) => f.sourceKeys.forEach((k) => {
      if (!keys.has(k)) ctx.addIssue({ code: 'custom', path: ['facts', i, 'sourceKeys'], message: 'FACT_SOURCE_NOT_IN_PACK' });
    }));
    // A source whose access has not been validated can be listed (so the need is visible) but teaches nothing yet.
    const unvalidated = new Set(p.sources.filter((s) => s.permittedUse === 'ACCESS_NOT_VALIDATED').map((s) => s.sourceKey));
    p.facts.forEach((f, i) => {
      if (f.sourceKeys.some((k) => unvalidated.has(k))) ctx.addIssue({ code: 'custom', path: ['facts', i, 'sourceKeys'], message: 'FACT_FROM_UNVALIDATED_SOURCE' });
    });
  });
export type ReferenceIntelligencePack = z.infer<typeof ReferenceIntelligencePackSchema>;

export const DRAFT_PROVENANCES = ['STUDYUS_AUTHORED', 'STUDYUS_GENERATED'] as const;

export const ProductionDraftPackageSchema = z
  .strictObject({
    v: z.literal(DRAFT_PACKAGE_VERSION),
    packageKey: ID,
    /** The requirement cell. */
    examFamily: ID,
    examVersionId: UUID,
    canonicalSubjectId: UUID,
    /** `structure_nodes.code` of the official Domain and of the certified Topic under it. */
    domainNodeCode: ID,
    topicNodeCode: ID,
    learningObjectiveCode: ID,
    targetPrimaryConceptId: UUID,
    intendedSupportingConceptIds: z.array(UUID),
    /** Not modelled yet for any exam: null until the Curriculum has Exam Skills. */
    examSkill: ID.nullable(),
    responseFormat: ID,
    difficultyBand: z.enum(['FOUNDATIONAL', 'STANDARD', 'CHALLENGE']),
    language: ID,
    intendedPool: z.enum(['PRACTICE', 'DIAGNOSTIC', 'VERIFICATION', 'REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2']),
    stimulus: z.discriminatedUnion('required', [
      z.strictObject({ required: z.literal(false) }),
      z.strictObject({ required: z.literal(true), kind: z.enum(['PASSAGE', 'PAIRED_PASSAGE', 'POEM', 'NUMBERED_TEXT', 'DRAFT_PARAGRAPH', 'TABLE', 'GRAPH', 'FIGURE', 'DATA_SET', 'COMPOSITE']), stimulusKey: ID.nullable(), itemsInGroup: z.number().int().min(1).max(20) }),
    ]),
    assets: z.array(z.strictObject({ kind: z.enum(['DIAGRAM', 'GRAPH', 'CHART', 'IMAGE', 'DATA_VISUALISATION']), purpose: ID })),
    /** Who will write the item. Fixed here and for ever on the bank item: generated content never becomes authored. */
    provenance: z.enum(DRAFT_PROVENANCES),
    authorship: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('HUMAN'), authorUserId: UUID }),
      z.strictObject({ kind: z.literal('MODEL'), model: ID, promptVersion: ID, requestedByUserId: UUID }),
    ]),
    references: ReferenceIntelligencePackSchema,
  })
  .superRefine((p, ctx) => {
    if ((p.provenance === 'STUDYUS_AUTHORED') !== (p.authorship.kind === 'HUMAN')) ctx.addIssue({ code: 'custom', path: ['authorship'], message: 'PROVENANCE_AUTHORSHIP_MISMATCH' });
    if (p.intendedSupportingConceptIds.includes(p.targetPrimaryConceptId) || new Set(p.intendedSupportingConceptIds).size !== p.intendedSupportingConceptIds.length) ctx.addIssue({ code: 'custom', path: ['intendedSupportingConceptIds'], message: 'CONCEPT_LISTED_TWICE' });
  });
export type ProductionDraftPackage = z.infer<typeof ProductionDraftPackageSchema>;

/**
 * What a package does NOT establish. Each is decided on the ingested item version, by its own owner; a field
 * named `target...` or `intended...` here is a request, never the reviewed fact.
 */
export const NOT_ESTABLISHED_BY_A_PACKAGE = ['HUMAN_REVIEW', 'PRIMARY_ATTRIBUTION', 'TOPIC_LINK', 'REUSE_RIGHTS', 'ORIGINALITY', 'POOL_MEMBERSHIP', 'PILOT_ELIGIBILITY'] as const;

export function validateDraftPackage(input: unknown): { ok: true; package: ProductionDraftPackage } | { ok: false; issues: string[] } {
  const parsed = ProductionDraftPackageSchema.safeParse(input);
  if (parsed.success) return { ok: true, package: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}
