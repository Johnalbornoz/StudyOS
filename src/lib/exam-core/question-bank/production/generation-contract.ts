/**
 * QB-R2A -- the generation contract: what authoring or a model receives, and what it must hand back (pure, no IO).
 *
 *   input   Requirement Cell + Reference Intelligence Pack + generation policy + desired count
 *   output  candidates: a question each, with its answer, rationale, intended attribution and lineage
 *
 * A candidate is a DRAFT outside the Question Bank. Its `primaryConceptId` is what the author aimed at; the
 * reviewed attribution is set later by a qualified reviewer. Provenance is decided by who wrote the first
 * draft and never changes: a model's draft is STUDYUS_GENERATED however much a person edits it afterwards.
 */
import { z } from 'zod';
import { ReferenceIntelligencePackSchema } from './draft-package';
import { AssetRequirementSchema, DIFFICULTY_BANDS, RequirementCellSchema, RESPONSE_FORMATS, StimulusRequirementSchema } from './requirement-cell';

export const GENERATION_CONTRACT_VERSION = 1 as const;
const ID = z.string().trim().min(1).max(200);
const UUID = z.string().uuid();
const TEXT = z.string().trim().min(1).max(6000);

export const GenerationPolicySchema = z.strictObject({
  policyId: ID,
  policyVersion: ID,
  /** Who writes: a person, or a model run requested by a person. */
  author: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('HUMAN'), authorUserId: UUID }),
    z.strictObject({ kind: z.literal('MODEL'), model: ID, promptVersion: ID, requestedByUserId: UUID }),
  ]),
  language: ID,
  /** A reference may be read; its expression may not be carried into a candidate. Fixed, not a setting. */
  copyReferenceExpression: z.literal(false),
});

export const GenerationRequestSchema = z.strictObject({
  v: z.literal(GENERATION_CONTRACT_VERSION),
  cell: RequirementCellSchema,
  references: ReferenceIntelligencePackSchema,
  policy: GenerationPolicySchema,
  desiredCount: z.number().int().min(1).max(50),
});
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;

export const CANDIDATE_PROVENANCES = ['STUDYUS_AUTHORED', 'STUDYUS_GENERATED'] as const;

export const GenerationLineageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('HUMAN'), authorUserId: UUID, writtenAt: z.string().datetime({ offset: true }) }),
  z.strictObject({
    kind: z.literal('MODEL'), model: ID, promptVersion: ID, runId: ID, requestedByUserId: UUID, generatedAt: z.string().datetime({ offset: true }),
    /** People who edited the model's draft. Editing does not change the provenance. */
    humanEdits: z.array(z.strictObject({ editorUserId: UUID, editedAt: z.string().datetime({ offset: true }) })),
  }),
]);

export const GeneratedCandidateSchema = z
  .strictObject({
    v: z.literal(GENERATION_CONTRACT_VERSION),
    candidateKey: ID,
    cellKey: ID,
    /** Candidates produced by the same request: siblings for the originality gate. */
    batchKey: ID,
    stem: TEXT,
    responseFormat: z.enum(RESPONSE_FORMATS),
    /** Present for MULTIPLE_CHOICE; empty for STUDENT_PRODUCED. */
    options: z.array(z.strictObject({ id: ID, text: TEXT })),
    /** MULTIPLE_CHOICE: the id of the correct option. STUDENT_PRODUCED: the expected response. */
    answerKey: TEXT,
    rationale: TEXT,
    primaryConceptId: UUID,
    supportingConceptIds: z.array(UUID),
    difficultyBand: z.enum(DIFFICULTY_BANDS),
    marks: z.number().int(),
    language: ID,
    stimulus: StimulusRequirementSchema,
    assets: z.array(AssetRequirementSchema),
    provenance: z.enum(CANDIDATE_PROVENANCES),
    lineage: GenerationLineageSchema,
  })
  .superRefine((c, ctx) => {
    // The first draft decides: MODEL => STUDYUS_GENERATED, whatever a person did to it later.
    if ((c.lineage.kind === 'MODEL') !== (c.provenance === 'STUDYUS_GENERATED')) ctx.addIssue({ code: 'custom', path: ['provenance'], message: 'PROVENANCE_DOES_NOT_MATCH_LINEAGE' });
  });
export type GeneratedCandidate = z.infer<typeof GeneratedCandidateSchema>;

export const GenerationResultSchema = z.strictObject({ v: z.literal(GENERATION_CONTRACT_VERSION), cellKey: ID, batchKey: ID, candidates: z.array(GeneratedCandidateSchema) });

/** Does a result answer its request? Count, cell, batch, and the author the policy named. */
export function generationResultViolations(request: GenerationRequest, result: z.infer<typeof GenerationResultSchema>): string[] {
  const out: string[] = [];
  if (result.cellKey !== request.cell.cellKey) out.push('RESULT_FOR_ANOTHER_CELL');
  if (result.candidates.length > request.desiredCount) out.push('MORE_CANDIDATES_THAN_REQUESTED');
  if (new Set(result.candidates.map((c) => c.candidateKey)).size !== result.candidates.length) out.push('DUPLICATE_CANDIDATE_KEY');
  for (const c of result.candidates) {
    if (c.cellKey !== request.cell.cellKey || c.batchKey !== result.batchKey) out.push(`CANDIDATE_OUTSIDE_BATCH:${c.candidateKey}`);
    if (c.lineage.kind !== request.policy.author.kind) out.push(`LINEAGE_DOES_NOT_MATCH_POLICY:${c.candidateKey}`);
  }
  return out;
}
