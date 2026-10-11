/**
 * The Reference Intelligence Pack: what may be consulted while a question is written (pure contract, no IO).
 *
 *   RequirementCell -> GenerationRequest (cell + this pack + policy) -> QuestionCandidate -> ...
 *
 * Three things are kept apart and none implies another:
 *   reference source     what was consulted (`ReferenceSource`)            -> never a right to reuse
 *   content provenance   who writes the item (on the candidate)            -> STUDYUS_AUTHORED or STUDYUS_GENERATED
 *   reuse rights         whether StudyUs may deliver it                    -> a rights record, after review
 * A pack carries facts restated by StudyUs. It never carries a question, a passage or any other protected
 * expression of a source.
 */
import { z } from 'zod';

export const REFERENCE_PACK_VERSION = 1 as const;

const ID = z.string().trim().min(1).max(200);
const UUID = z.string().uuid();

/** What kind of thing a reference is. PEDAGOGICAL_REFERENCE is an external teaching source (the policy slot). */
export const REFERENCE_SOURCE_TYPES = ['OFFICIAL_SPECIFICATION', 'OFFICIAL_SAMPLE', 'PEDAGOGICAL_REFERENCE', 'STUDYUS_INTERNAL'] as const;
/**
 * What the source may be used for. REFERENCE_ONLY is the only class a pedagogical reference can have: it may be
 * read to understand, and nothing of its expression may be carried into an item.
 */
export const PERMITTED_USE_CLASSES = ['REFERENCE_ONLY', 'ADAPTATION_LICENSED', 'REPRODUCTION_LICENSED', 'ACCESS_NOT_VALIDATED'] as const;

export const ACCESS_STATUSES = ['VALIDATED', 'NOT_VALIDATED', 'NOT_REQUIRED'] as const;

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
    /** Has StudyUs's access to the source been validated? A source that needs no validation says so. */
    accessStatus: z.enum(ACCESS_STATUSES),
    /** When the source was consulted (ISO date-time). null until it has been. */
    referencedAt: z.string().datetime({ offset: true }).nullable(),
    /** The licence or authorisation that allows adaptation or reproduction. Required for those two classes. */
    licenceReference: z.string().trim().max(300).nullable(),
  })
  .superRefine((s, ctx) => {
    if ((s.permittedUse === 'ADAPTATION_LICENSED' || s.permittedUse === 'REPRODUCTION_LICENSED') && !s.licenceReference) ctx.addIssue({ code: 'custom', path: ['licenceReference'], message: 'LICENCE_REFERENCE_REQUIRED' });
    // An external teaching source is consulted, never adapted or reproduced, whatever access StudyUs has to it.
    // The two ways of saying "not validated" agree, and an unvalidated source has not been consulted.
    if ((s.permittedUse === 'ACCESS_NOT_VALIDATED') !== (s.accessStatus === 'NOT_VALIDATED')) ctx.addIssue({ code: 'custom', path: ['accessStatus'], message: 'ACCESS_STATUS_INCONSISTENT' });
    if (s.accessStatus === 'NOT_VALIDATED' && s.referencedAt !== null) ctx.addIssue({ code: 'custom', path: ['referencedAt'], message: 'UNVALIDATED_SOURCE_NOT_CONSULTED' });
    if (s.sourceType === 'PEDAGOGICAL_REFERENCE' && s.accessStatus === 'NOT_REQUIRED') ctx.addIssue({ code: 'custom', path: ['accessStatus'], message: 'PEDAGOGICAL_REFERENCE_NEEDS_ACCESS_VALIDATION' });
    if (s.sourceType === 'PEDAGOGICAL_REFERENCE' && s.permittedUse !== 'REFERENCE_ONLY' && s.permittedUse !== 'ACCESS_NOT_VALIDATED') ctx.addIssue({ code: 'custom', path: ['permittedUse'], message: 'PEDAGOGICAL_REFERENCE_IS_REFERENCE_ONLY' });
  });
export type ReferenceSource = z.infer<typeof ReferenceSourceSchema>;

/** What a Reference Intelligence Pack may say. Every entry is a fact restated by StudyUs. */
export const PEDAGOGICAL_FACT_KINDS = [
  'CURRICULUM_FACT', 'LEARNING_OBJECTIVE', 'CONCEPT_DEFINITION', 'PREREQUISITE', 'COMMON_MISCONCEPTION', 'REASONING_SKILL', 'EXPECTED_DIFFICULTY', 'DIFFICULTY_DRIVER',
  'APPROPRIATE_CONTEXT', 'TYPICAL_TASK_FORM', 'RESPONSE_FORMAT_GUIDANCE', 'STIMULUS_GUIDANCE', 'STYLE_RULE',
] as const;

/** A fact about how the concept is taught or assessed, restated by StudyUs. Never a quotation. */
export const PedagogicalFactSchema = z.strictObject({
  kind: z.enum(PEDAGOGICAL_FACT_KINDS),
  /** StudyUs's own statement of the fact. */
  statement: z.string().trim().min(10).max(600),
  /** Which registered source(s) the fact was learned from. */
  sourceKeys: z.array(ID).min(1),
  /** Declared by whoever compiled the pack: the statement reproduces no protected expression of its sources. */
  restatedInOwnWords: z.literal(true),
});

export const ReferenceIntelligencePackSchema = z
  .strictObject({
    v: z.literal(REFERENCE_PACK_VERSION),
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
