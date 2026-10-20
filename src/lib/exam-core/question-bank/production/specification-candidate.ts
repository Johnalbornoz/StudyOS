/**
 * QB-R2D -- the contract of a SPECIFICATION-DRIVEN candidate (pure, no IO).
 *
 *   AdaptationSpecification -> specification generation -> SpecificationCandidate -> independent validators
 *
 * QB-R2C generates from a RequirementCell (a planned slot of one exam). An adaptation specification is not a cell:
 * it fixes how one task family is asked by one assessment target, and it may ask for a CONSTRUCTED response, which
 * the cell contract (multiple choice / student-produced number) cannot hold. This contract is for that path. It is
 * ADDITIVE: nothing of the cell contract changes, and a cell-driven batch is byte-identical to what it was.
 *
 * A SpecificationCandidate is a DRAFT outside the Question Bank and is always DEV_TEST_CONTENT here: the type holds
 * no other use class, so an instance of it can never be read as evidence-bearing content.
 *
 * What an item DECLARES, so that a machine can disagree with it:
 *   declaredModel   the construct it is an instance of and the values of the construct's parameters
 *   target          for every keyed answer: which derived QUANTITY or VERDICT of the construct it is, a
 *                   COMPARISON of stimulus numbers that decides a claim, or NOT_MACHINE_CHECKABLE with a reason
 * A declaration earns nothing by itself: the validators recompute from the parameters and the stimulus.
 *
 * MARK POINTS are typed METHOD / ACCURACY / REASONING / CREDIT. They are StudyUs's neutral names for what a
 * specification's rubric style asks for; they are not, and do not claim to be, any examination board's notation.
 */
import { z } from 'zod';
import { AuthorityVersionBindingSchema } from '@/lib/assessment-adaptation/assessment-system-profile';
import { CONTEXT_KINDS, ELICITATION_FORMATS, TASK_DIFFICULTY_BANDS } from '@/lib/exam-core/question-bank/task-families/task-family';
import { NumericAnswerKeySchema } from './answer-normalization';
import { AnswerCheckSchema, CandidateStimulusSchema } from './generation-contract';

export const SPECIFICATION_CANDIDATE_VERSION = 1 as const;
const ID = z.string().trim().min(1).max(200);
const TEXT = z.string().trim().min(1).max(8000);
const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
const VERSIONED = z.strictObject({ id: ID, version: ID });

export const OPTION_IDS = ['A', 'B', 'C', 'D'] as const;
export const COMPARISON_OPERATORS = ['>', '<', '>=', '<=', '='] as const;
export const MARK_POINT_KINDS = ['METHOD', 'ACCURACY', 'REASONING', 'CREDIT'] as const;
export const CREDIT_CODES = ['FULL_CREDIT', 'PARTIAL_CREDIT', 'NO_CREDIT'] as const;

/** What a keyed answer IS, in the construct's vocabulary. */
export const AnswerTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('QUANTITY'), quantity: ID }),
  z.strictObject({ kind: z.literal('VERDICT'), verdict: ID, value: ID }),
  /** A claim decided by comparing two arithmetic expressions over numbers the stimulus states. `holds` is what the item says the comparison gives. */
  z.strictObject({ kind: z.literal('COMPARISON'), left: z.string().trim().min(1).max(300), operator: z.enum(COMPARISON_OPERATORS), right: z.string().trim().min(1).max(300), holds: z.boolean(), verdict: ID.nullable() }),
  z.strictObject({ kind: z.literal('NOT_MACHINE_CHECKABLE'), reason: z.string().trim().min(10).max(300) }),
]);
export type AnswerTarget = z.infer<typeof AnswerTargetSchema>;

export const DeclaredModelSchema = z.strictObject({ construct: ID, parameters: z.record(ID, z.number().finite()) });
export const ItemContextSchema = z.strictObject({ kind: z.enum(CONTEXT_KINDS), description: z.string().trim().min(3).max(400) });

export const SelectedResponseSchema = z.strictObject({
  options: z.array(z.strictObject({ id: ID, text: TEXT })),
  answerKey: ID,
  /** Every wrong option: the misconception model it comes from and why it is wrong. */
  distractors: z.record(ID, z.strictObject({ misconceptionModelId: ID, rationale: TEXT })),
  target: AnswerTargetSchema,
  answerCheck: AnswerCheckSchema,
});
export const NumericEntrySchema = z.strictObject({ numericKey: NumericAnswerKeySchema, target: AnswerTargetSchema, answerCheck: AnswerCheckSchema });
export const MarkPointSchema = z.strictObject({ kind: z.enum(MARK_POINT_KINDS), marks: z.number().int().min(1).max(10), criterion: TEXT });
export const ConstructedPartSchema = z.strictObject({
  label: z.string().regex(/^[a-h]$/),
  prompt: TEXT,
  /** QB-R2E, optional: the ONE command term of this part, from the specification's allowed vocabulary. Absent on a candidate made before it; null when the specification has no vocabulary. */
  commandTerm: z.string().trim().min(2).max(60).nullable().optional(),
  marks: z.number().int().min(1).max(12),
  markScheme: z.array(MarkPointSchema).min(1),
  finalAnswer: TEXT,
  /** Given when the final answer is one number. */
  numericKey: NumericAnswerKeySchema.nullable(),
  target: AnswerTargetSchema,
  answerCheck: AnswerCheckSchema,
});
export type ConstructedPart = z.infer<typeof ConstructedPartSchema>;
export const ConstructedResponseSchema = z
  .strictObject({ parts: z.array(ConstructedPartSchema).min(1).max(6), totalMarks: z.number().int().min(1).max(30), workingOutline: z.array(TEXT).min(1).max(12) })
  .superRefine((c, ctx) => {
    if (c.parts.some((p, i) => p.label !== 'abcdefgh'[i])) ctx.addIssue({ code: 'custom', path: ['parts'], message: 'PART_LABELS_NOT_IN_ORDER' });
    if (c.parts.reduce((n, p) => n + p.marks, 0) !== c.totalMarks) ctx.addIssue({ code: 'custom', path: ['totalMarks'], message: 'PART_MARKS_DO_NOT_SUM_TO_TOTAL' });
    c.parts.forEach((p, i) => {
      if (p.markScheme.reduce((n, m) => n + m.marks, 0) !== p.marks) ctx.addIssue({ code: 'custom', path: ['parts', i, 'markScheme'], message: 'MARK_POINTS_DO_NOT_SUM_TO_PART_MARKS' });
    });
  });
export const CreditLevelSchema = z.strictObject({ code: z.enum(CREDIT_CODES), description: TEXT });

/** The content of an item, as the provider returns it and as the candidate holds it. Exactly one of the three response members is non-null. */
export const SpecificationItemContentSchema = z.strictObject({
  stem: TEXT,
  context: ItemContextSchema,
  declaredModel: DeclaredModelSchema,
  selected: SelectedResponseSchema.nullable(),
  numeric: NumericEntrySchema.nullable(),
  constructed: ConstructedResponseSchema.nullable(),
  /** Coded credit levels, when the specification's rubric style asks for them; null otherwise. */
  credit: z.array(CreditLevelSchema).min(2).max(3).nullable(),
  rationale: TEXT,
  usesStimulusValues: z.array(z.number().finite()).nullable(),
  proposedSupportingConceptStableIds: z.array(ID),
});
export type SpecificationItemContent = z.infer<typeof SpecificationItemContentSchema>;

/** Everything a generated instance traces to. Every member is required: a gap is a schema error, not an omission. */
export const SpecificationLineageSchema = z.strictObject({
  kind: z.literal('MODEL'),
  primaryConcept: z.strictObject({ stableId: ID, canonicalSubject: ID, canonicalName: ID }),
  taskFamily: VERSIONED,
  /**
   * The learning approach the specification was resolved under. STANDARD is never named: it is recorded by ABSENCE
   * in the specification, and here as `{ recordedAs: 'STANDARD_BY_ABSENCE' }` so that a reader of the lineage does
   * not have to infer it.
   */
  learningApproach: z.discriminatedUnion('recordedAs', [z.strictObject({ recordedAs: z.literal('EXPLICIT'), id: ID, version: ID }), z.strictObject({ recordedAs: z.literal('STANDARD_BY_ABSENCE') })]),
  systemProfile: VERSIONED,
  /** null = the specification targeted the system profile only. */
  componentProfile: z.strictObject({ id: ID, version: ID, versionBinding: AuthorityVersionBindingSchema.nullable() }).nullable(),
  systemVersionBinding: AuthorityVersionBindingSchema.nullable(),
  disciplinePolicy: VERSIONED,
  adaptationSpecification: z.strictObject({ id: SHA256, invariantHash: SHA256 }),
  contentUseClass: z.literal('DEV_TEST_CONTENT'),
  generationRequest: z.strictObject({ promptHash: SHA256, template: VERSIONED, policy: VERSIONED, harness: VERSIONED, responseSchema: VERSIONED, unitKey: ID, attempt: z.number().int().min(1).max(9), requestedBy: ID }),
  generationRun: z.strictObject({ runId: ID, provider: ID, model: ID, generatedAt: z.string().datetime({ offset: true }) }),
});
export type SpecificationLineage = z.infer<typeof SpecificationLineageSchema>;

export const SpecificationCandidateSchema = z
  .strictObject({
    v: z.literal(SPECIFICATION_CANDIDATE_VERSION),
    candidateKey: ID,
    unitKey: ID,
    batchKey: ID,
    specificationId: SHA256,
    primaryConceptStableId: ID,
    language: ID,
    /** The specification's elicitation format, restated by the harness. */
    responseFormat: z.enum(ELICITATION_FORMATS),
    difficultyBand: z.enum(TASK_DIFFICULTY_BANDS),
    /** The total marks of the item: 1 for a keyed closed item, the sum of its parts for a constructed response. Set by the harness. */
    marks: z.number().int().min(1).max(30),
    /** The template's fixed instruction, kept out of the stem. */
    instruction: TEXT.nullable(),
    stimulusKey: ID.nullable(),
    content: SpecificationItemContentSchema,
    contentUseClass: z.literal('DEV_TEST_CONTENT'),
    provenance: z.literal('STUDYUS_GENERATED'),
    lineage: SpecificationLineageSchema,
  })
  .superRefine((c, ctx) => {
    if (c.lineage.adaptationSpecification.id !== c.specificationId) ctx.addIssue({ code: 'custom', path: ['lineage'], message: 'LINEAGE_IS_OF_ANOTHER_SPECIFICATION' });
    if (c.lineage.primaryConcept.stableId !== c.primaryConceptStableId) ctx.addIssue({ code: 'custom', path: ['lineage'], message: 'LINEAGE_IS_OF_ANOTHER_CONCEPT' });
    if ([c.content.selected, c.content.numeric, c.content.constructed].filter((x) => x !== null).length !== 1) ctx.addIssue({ code: 'custom', path: ['content'], message: 'EXACTLY_ONE_RESPONSE_MEMBER' });
  });
export type SpecificationCandidate = z.infer<typeof SpecificationCandidateSchema>;

/** One generation unit that produced no candidate: the refusal is a result and is kept, never retried away. */
export const SpecificationGenerationFailureSchema = z.strictObject({ unitKey: ID, specificationId: SHA256, attempt: z.number().int().min(1), promptHash: SHA256, code: ID, detail: z.string() });
export type SpecificationGenerationFailure = z.infer<typeof SpecificationGenerationFailureSchema>;

export const SpecificationBatchSchema = z
  .strictObject({
    v: z.literal(SPECIFICATION_CANDIDATE_VERSION),
    kind: z.literal('SPECIFICATION_DRIVEN_GENERATION_BATCH'),
    label: z.literal('EPHEMERAL -- NOT INGESTED -- DEV_TEST_CONTENT'),
    batchKey: ID,
    generatedAt: z.string().datetime({ offset: true }),
    run: z.strictObject({ runId: ID, provider: ID, model: ID, generationPolicy: VERSIONED }),
    stimuli: z.array(CandidateStimulusSchema),
    candidates: z.array(SpecificationCandidateSchema),
    failures: z.array(SpecificationGenerationFailureSchema),
  })
  .superRefine((b, ctx) => {
    const stimuli = new Set(b.stimuli.map((s) => s.stimulusKey));
    if (new Set(b.candidates.map((c) => c.candidateKey)).size !== b.candidates.length) ctx.addIssue({ code: 'custom', path: ['candidates'], message: 'DUPLICATE_CANDIDATE_KEY' });
    b.candidates.forEach((c, i) => {
      if (c.batchKey !== b.batchKey) ctx.addIssue({ code: 'custom', path: ['candidates', i], message: 'CANDIDATE_OUTSIDE_BATCH' });
      if (c.stimulusKey !== null && !stimuli.has(c.stimulusKey)) ctx.addIssue({ code: 'custom', path: ['candidates', i], message: 'STIMULUS_NOT_IN_BATCH' });
    });
  });
export type SpecificationBatch = z.infer<typeof SpecificationBatchSchema>;

/** The text of an item a similarity comparison reads: stem, options, part prompts. No instruction, no mark scheme. */
export function comparableTextOfSpecificationCandidate(c: Pick<SpecificationCandidate, 'content'>): string {
  const x = c.content;
  return [x.stem, ...(x.selected ? x.selected.options.map((o) => o.text) : []), ...(x.constructed ? x.constructed.parts.map((p) => p.prompt) : [])].join(' \n ');
}
