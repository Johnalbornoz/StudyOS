/**
 * The generation contract: what authoring or a model receives, and what it must hand back (pure, no IO).
 *
 *   RequirementCell -> GenerationRequest -> QuestionCandidate -> ValidatedQuestionCandidate -> HumanReviewPackage
 *
 * A QuestionCandidate is a DRAFT outside the Question Bank. It is written FOR the cell's PRIMARY concept: the
 * target is given, never inferred afterwards from the text. Its SUPPORTING concepts are a proposal and stay
 * non-authoritative until a qualified reviewer sets the attribution. Provenance is decided by who wrote the
 * first draft and never changes: a model's draft is STUDYUS_GENERATED however much a person edits it.
 */
import { z } from 'zod';
import { ReferenceIntelligencePackSchema } from './reference-pack';
import { AssetRequirementSchema, DIFFICULTY_BANDS, RequirementCellSchema, RESPONSE_FORMATS, STIMULUS_KINDS } from './requirement-cell';

export const GENERATION_CONTRACT_VERSION = 2 as const;
const ID = z.string().trim().min(1).max(200);
const UUID = z.string().uuid();
const TEXT = z.string().trim().min(1).max(8000);

export const GenerationPolicySchema = z.strictObject({
  policyId: ID,
  policyVersion: ID,
  /** Who writes: a person, or a model run requested by a person. */
  author: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('HUMAN'), authorUserId: UUID }),
    z.strictObject({ kind: z.literal('MODEL'), model: ID, promptVersion: ID, requestedBy: ID }),
  ]),
  language: ID,
  /** A reference may be read; its expression may not be carried into a candidate. Fixed, not a setting. */
  copyReferenceExpression: z.literal(false),
});

export const GenerationRequestSchema = z
  .strictObject({ v: z.literal(GENERATION_CONTRACT_VERSION), cell: RequirementCellSchema, references: ReferenceIntelligencePackSchema, policy: GenerationPolicySchema, desiredCount: z.number().int().min(1).max(50) })
  .superRefine((r, ctx) => {
    if (r.cell.binding === null) ctx.addIssue({ code: 'custom', path: ['cell', 'binding'], message: 'CELL_NOT_BOUND' });
    if (r.desiredCount > r.cell.count) ctx.addIssue({ code: 'custom', path: ['desiredCount'], message: 'MORE_THAN_THE_CELL_NEEDS' });
  });
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;

export const CANDIDATE_PROVENANCES = ['STUDYUS_AUTHORED', 'STUDYUS_GENERATED'] as const;

export const GenerationLineageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('HUMAN'), authorUserId: UUID, writtenAt: z.string().datetime({ offset: true }) }),
  z.strictObject({
    kind: z.literal('MODEL'), model: ID, promptVersion: ID, runId: ID, requestedBy: ID, generatedAt: z.string().datetime({ offset: true }),
    /** People who edited the model's draft. Editing does not change the provenance. */
    humanEdits: z.array(z.strictObject({ editorUserId: UUID, editedAt: z.string().datetime({ offset: true }) })),
  }),
]);

/** A stimulus written for the batch: original StudyUs text or a specification of a figure. Never third-party text. */
export const CandidateStimulusSchema = z.strictObject({
  stimulusKey: ID,
  kind: z.enum(STIMULUS_KINDS),
  language: ID,
  parts: z.array(z.strictObject({ label: ID.nullable(), partKind: z.enum(['TEXT', 'NUMBERED_TEXT', 'VERSE', 'TABLE', 'GRAPH', 'FIGURE', 'DATA_SET', 'SOURCE_NOTE']), text: TEXT })).min(1),
  provenance: z.enum(CANDIDATE_PROVENANCES),
});
export type CandidateStimulus = z.infer<typeof CandidateStimulusSchema>;

export const QuestionCandidateSchema = z
  .strictObject({
    v: z.literal(GENERATION_CONTRACT_VERSION),
    candidateKey: ID,
    cellKey: ID,
    /** Candidates produced together: siblings for the originality gate. */
    batchKey: ID,
    stem: TEXT,
    responseFormat: z.enum(RESPONSE_FORMATS),
    /** Present for MULTIPLE_CHOICE; empty for STUDENT_PRODUCED. */
    options: z.array(z.strictObject({ id: ID, text: TEXT })),
    /** MULTIPLE_CHOICE: the id of the correct option. STUDENT_PRODUCED: the expected response. */
    answerKey: TEXT,
    rationale: TEXT,
    /** Why each wrong option is wrong (the misconception it catches). Keyed by option id. */
    distractorRationales: z.record(ID, TEXT),
    /** The cell's PRIMARY concept, restated: the candidate is written for it. */
    primaryConceptStableId: ID,
    /** Proposed by the author; non-authoritative until review. Stable ids of certified concepts. */
    proposedSupportingConceptStableIds: z.array(ID),
    difficultyBand: z.enum(DIFFICULTY_BANDS),
    marks: z.number().int(),
    language: ID,
    /** The stimulus of the batch the question is asked about; null for a standalone question. */
    stimulusKey: ID.nullable(),
    assets: z.array(AssetRequirementSchema),
    provenance: z.enum(CANDIDATE_PROVENANCES),
    lineage: GenerationLineageSchema,
  })
  .superRefine((c, ctx) => {
    // The first draft decides: MODEL => STUDYUS_GENERATED, whatever a person did to it later.
    if ((c.lineage.kind === 'MODEL') !== (c.provenance === 'STUDYUS_GENERATED')) ctx.addIssue({ code: 'custom', path: ['provenance'], message: 'PROVENANCE_DOES_NOT_MATCH_LINEAGE' });
    if (c.proposedSupportingConceptStableIds.includes(c.primaryConceptStableId) || new Set(c.proposedSupportingConceptStableIds).size !== c.proposedSupportingConceptStableIds.length) ctx.addIssue({ code: 'custom', path: ['proposedSupportingConceptStableIds'], message: 'CONCEPT_LISTED_TWICE' });
  });
export type QuestionCandidate = z.infer<typeof QuestionCandidateSchema>;

export const GenerationBatchSchema = z
  .strictObject({ v: z.literal(GENERATION_CONTRACT_VERSION), batchKey: ID, generatedAt: z.string().datetime({ offset: true }), stimuli: z.array(CandidateStimulusSchema), candidates: z.array(QuestionCandidateSchema) })
  .superRefine((b, ctx) => {
    const stimuli = new Set(b.stimuli.map((s) => s.stimulusKey));
    if (stimuli.size !== b.stimuli.length) ctx.addIssue({ code: 'custom', path: ['stimuli'], message: 'DUPLICATE_STIMULUS_KEY' });
    if (new Set(b.candidates.map((c) => c.candidateKey)).size !== b.candidates.length) ctx.addIssue({ code: 'custom', path: ['candidates'], message: 'DUPLICATE_CANDIDATE_KEY' });
    b.candidates.forEach((c, i) => {
      if (c.batchKey !== b.batchKey) ctx.addIssue({ code: 'custom', path: ['candidates', i, 'batchKey'], message: 'CANDIDATE_OUTSIDE_BATCH' });
      if (c.stimulusKey !== null && !stimuli.has(c.stimulusKey)) ctx.addIssue({ code: 'custom', path: ['candidates', i, 'stimulusKey'], message: 'STIMULUS_NOT_IN_BATCH' });
    });
  });
export type GenerationBatch = z.infer<typeof GenerationBatchSchema>;

/** What a candidate does NOT establish. Each is decided later, on the ingested item version, by its own owner. */
export const NOT_ESTABLISHED_BY_A_CANDIDATE = ['HUMAN_REVIEW', 'PRIMARY_ATTRIBUTION', 'TOPIC_LINK', 'REUSE_RIGHTS', 'ORIGINALITY_RECORD', 'POOL_MEMBERSHIP', 'PILOT_ELIGIBILITY'] as const;
