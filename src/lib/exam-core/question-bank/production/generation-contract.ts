/**
 * The generation contract: what authoring or a model receives, and what it must hand back (pure, no IO).
 *
 *   RequirementCell -> GenerationRequest -> QuestionCandidate -> ValidatedQuestionCandidate -> HumanReviewPackage
 *
 * A QuestionCandidate is a DRAFT outside the Question Bank. It is written FOR the cell's PRIMARY concept: the
 * target is given, never inferred afterwards from the text. Its SUPPORTING concepts are a proposal and stay
 * non-authoritative until a qualified reviewer sets the attribution. Provenance is decided by who wrote the
 * first draft and never changes: a model's draft is STUDYUS_GENERATED however much a person edits it.
 *
 * QB-R2C extends the contract ADDITIVELY (every new field is optional, so the QB-R2B batch still parses):
 *   lineage    provider, generation policy, template, prompt hash, generation unit, cell, pack and profile version
 *   candidate  the template's fixed instruction (kept apart from the stem), its item slot and stimulus plan, a
 *              machine-checkable `answerCheck`, a structured NUMERIC key for a student-produced response, and the
 *              stimulus values the question relies on
 *   stimulus   its stimulus plan, the structured specification (data first) and the assets rendered from it
 *   batch      the run's lineage
 * The repeatable generator sets all of them; `lineageGaps` says which are missing.
 *
 * EA-1 adds ONE more optional member, on the same terms: `lineage.adaptation` (task family, assessment-system
 * profile, discipline policy, adaptation specification, run), present only on a draft generated from an
 * adaptation specification. A draft without it is as valid as before and is never reported as a gap.
 */
import { z } from 'zod';
import { AdaptationLineageSchema } from '@/lib/assessment-adaptation/instance-lineage';
import { NumericAnswerKeySchema } from './answer-normalization';
import { ReferenceIntelligencePackSchema } from './reference-pack';
import { AssetRequirementSchema, DIFFICULTY_BANDS, RequirementCellSchema, RESPONSE_FORMATS, STIMULUS_KINDS } from './requirement-cell';
import { RenderedAssetSchema, StructuredStimulusSchema } from './stimulus-spec';

export const GENERATION_CONTRACT_VERSION = 2 as const;
const ID = z.string().trim().min(1).max(200);
const UUID = z.string().uuid();
const TEXT = z.string().trim().min(1).max(8000);
const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const VERSIONED = z.strictObject({ id: ID, version: ID });

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
    // QB-R2C, set by the repeatable generator. Optional so that drafts written before it still parse.
    /** Who answered the prompt: a provider id, never a hard-coded vendor (`recorded:...` for a replayed recording). */
    provider: ID.optional(),
    generationPolicy: VERSIONED.optional(),
    template: VERSIONED.optional(),
    /** sha256 of the canonical JSON of the rendered prompt. */
    promptHash: SHA256.optional(),
    generationUnitKey: ID.optional(),
    requirementCellKey: ID.optional(),
    referencePack: z.strictObject({ version: z.number().int(), conceptProfileVersion: z.number().int(), conceptProfilePackVersion: ID }).optional(),
    // EA-1, set by the generator only when the slot was given an adaptation specification. Optional and NOT one of
    // the repeatable lineage fields: fixed and legacy content has no task family, and stays valid without one.
    /** The task family, assessment-system profile, discipline policy and specification the draft was generated from. */
    adaptation: AdaptationLineageSchema.optional(),
  }),
]);
export type GenerationLineage = z.infer<typeof GenerationLineageSchema>;

/** The lineage fields the repeatable generator must record on every candidate. */
export const REPEATABLE_LINEAGE_FIELDS = ['provider', 'generationPolicy', 'template', 'promptHash', 'generationUnitKey', 'requirementCellKey', 'referencePack'] as const;
/** Which of them a lineage lacks. A human lineage has none of them and is reported as such. */
export function lineageGaps(lineage: GenerationLineage): string[] {
  if (lineage.kind !== 'MODEL') return ['NOT_A_MODEL_LINEAGE'];
  return REPEATABLE_LINEAGE_FIELDS.filter((f) => lineage[f] === undefined);
}

/**
 * How a mathematics candidate's key can be recomputed by a machine. ARITHMETIC_EXPRESSION is evaluated by the
 * independent evaluator and compared with the key. NOT_COMPUTABLE declares that no arithmetic decides the answer
 * (a conceptual question): it earns nothing -- the validator reports the key as not machine-verifiable.
 */
export const AnswerCheckSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ARITHMETIC_EXPRESSION'), expression: z.string().trim().min(1).max(500) }),
  z.strictObject({ kind: z.literal('NOT_COMPUTABLE'), reason: z.string().trim().min(10).max(300) }),
]);
export type AnswerCheck = z.infer<typeof AnswerCheckSchema>;

/** A stimulus written for the batch: original StudyUs text or a specification of a figure. Never third-party text. */
export const CandidateStimulusSchema = z.strictObject({
  stimulusKey: ID,
  kind: z.enum(STIMULUS_KINDS),
  language: ID,
  parts: z.array(z.strictObject({ label: ID.nullable(), partKind: z.enum(['TEXT', 'NUMBERED_TEXT', 'VERSE', 'TABLE', 'GRAPH', 'FIGURE', 'DATA_SET', 'SOURCE_NOTE']), text: TEXT })).min(1),
  provenance: z.enum(CANDIDATE_PROVENANCES),
  // QB-R2C (optional, additive)
  /** The stimulus plan this stimulus was written for; null for a single question's own optional stimulus. */
  stimulusPlanId: ID.nullable().optional(),
  generationUnitKey: ID.optional(),
  /** DATA FIRST: tables, data sets, chart and figure specifications. The source of truth of a numerical or visual stimulus. */
  structured: StructuredStimulusSchema.optional(),
  /** DERIVED from `structured` by the renderers; re-rendering must reproduce them byte for byte. */
  renderedAssets: z.array(RenderedAssetSchema).optional(),
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
    // QB-R2C (optional, additive)
    /** The template's fixed instruction sentence, kept OUT of the stem so that boilerplate is never compared as content. */
    instruction: TEXT.nullable().optional(),
    /** The item slot of the cell this candidate fills (`<cellKey>#<index>`). */
    slotKey: ID.optional(),
    stimulusPlanId: ID.nullable().optional(),
    answerCheck: AnswerCheckSchema.optional(),
    /** STUDENT_PRODUCED only: the structured numeric key. `answerKey` restates its value. */
    numericKey: NumericAnswerKeySchema.optional(),
    /** The numbers of the stimulus the question relies on. Checked against the stimulus's structured data. */
    usesStimulusValues: z.array(z.number().finite()).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.numericKey && c.responseFormat !== 'STUDENT_PRODUCED') ctx.addIssue({ code: 'custom', path: ['numericKey'], message: 'NUMERIC_KEY_ONLY_FOR_STUDENT_PRODUCED' });
    if (c.numericKey && c.numericKey.value !== c.answerKey) ctx.addIssue({ code: 'custom', path: ['answerKey'], message: 'ANSWER_KEY_IS_NOT_THE_NUMERIC_KEY_VALUE' });
    if (c.slotKey !== undefined && !c.slotKey.startsWith(`${c.cellKey}#`)) ctx.addIssue({ code: 'custom', path: ['slotKey'], message: 'SLOT_IS_NOT_OF_THE_CELL' });
    // The first draft decides: MODEL => STUDYUS_GENERATED, whatever a person did to it later.
    if ((c.lineage.kind === 'MODEL') !== (c.provenance === 'STUDYUS_GENERATED')) ctx.addIssue({ code: 'custom', path: ['provenance'], message: 'PROVENANCE_DOES_NOT_MATCH_LINEAGE' });
    if (c.proposedSupportingConceptStableIds.includes(c.primaryConceptStableId) || new Set(c.proposedSupportingConceptStableIds).size !== c.proposedSupportingConceptStableIds.length) ctx.addIssue({ code: 'custom', path: ['proposedSupportingConceptStableIds'], message: 'CONCEPT_LISTED_TWICE' });
  });
export type QuestionCandidate = z.infer<typeof QuestionCandidateSchema>;

/** The run that produced a batch: who answered, under which policy, from which prompts. Set by the repeatable generator. */
export const BatchLineageSchema = z.strictObject({
  runId: ID, provider: ID, model: ID, generationPolicy: VERSIONED, generatedAt: z.string().datetime({ offset: true }),
  units: z.array(z.strictObject({ generationUnitKey: ID, template: VERSIONED, promptHash: SHA256, candidates: z.number().int().min(1) })).min(1),
});
export type BatchLineage = z.infer<typeof BatchLineageSchema>;

export const GenerationBatchSchema = z
  .strictObject({ v: z.literal(GENERATION_CONTRACT_VERSION), batchKey: ID, generatedAt: z.string().datetime({ offset: true }), stimuli: z.array(CandidateStimulusSchema), candidates: z.array(QuestionCandidateSchema), lineage: BatchLineageSchema.optional() })
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
