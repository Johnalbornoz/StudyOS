/**
 * QB-R2C -- Reference Intelligence Pack v2: the pack plus a structured PROFILE of the PRIMARY concept (pure, no IO).
 *
 * QB-R2B found fidelity uncertain exactly where the pack held no definition of the concept. A v2 pack is
 * GENERATION-READY: sources + facts (as in v1) + one `ConceptProfile` for the cell's PRIMARY concept. A pack
 * without a profile, or with the profile of another concept, is refused before anything is generated.
 *
 * A profile is StudyUs's own statement of general pedagogical knowledge (`authoredBy: 'STUDYUS'`), in its own
 * words, and names the registered source(s) it restates. It never quotes a source and it is not an official
 * definition. Where StudyUs has not confirmed its reading of a concept against the exam's own guide, the profile
 * says so: `definitionConfidence: 'WORKING_DEFINITION'` with a note. A working definition is good enough to
 * draft with and is exactly what a reviewer must look at first.
 *
 * `evidenceMarkers` / `foreignMarkers` feed the concept-fidelity HEURISTIC of the independent validators: terms
 * whose presence in a candidate's stem or rationale is expected for this concept, and terms that suggest another
 * one. They are hints for a lexical check, not a definition of the concept.
 */
import { z } from 'zod';
import { PedagogicalFactSchema, ReferenceIntelligencePackSchema, ReferenceSourceSchema, type ReferenceIntelligencePack } from './reference-pack';
import type { RequirementCell } from './requirement-cell';

export const CONCEPT_PROFILE_VERSION = 1 as const;
export const REFERENCE_PACK_V2_VERSION = 2 as const;
export const DEFINITION_CONFIDENCES = ['ESTABLISHED', 'WORKING_DEFINITION'] as const;

const ID = z.string().trim().min(1).max(200);
const STATEMENT = z.string().trim().min(10).max(700);
const SHORT = z.string().trim().min(3).max(300);

export const ConceptProfileSchema = z
  .strictObject({
    v: z.literal(CONCEPT_PROFILE_VERSION),
    /** Version of the authored pack this profile belongs to. A change of any statement is a new version. */
    packVersion: ID,
    authoredBy: z.literal('STUDYUS'),
    conceptStableId: ID,
    canonicalLabel: ID,
    /** The language the profile is written in: the language its items are written in. */
    language: ID,
    definition: STATEMENT,
    definitionConfidence: z.enum(DEFINITION_CONFIDENCES),
    /** Required for a working definition: what is unconfirmed, and against what it must be confirmed. */
    definitionNote: STATEMENT.nullable(),
    /** What a learner who has the concept can be SEEN to do. */
    masteryStatement: STATEMENT,
    prerequisites: z.array(SHORT),
    commonMisconceptions: z.array(SHORT).min(2),
    acceptableReasoningPatterns: z.array(SHORT).min(1),
    /** Ways of reaching the key that do not need the concept: an item must not reward them. */
    inappropriateShortcuts: z.array(SHORT).min(1),
    exampleContextCategories: z.array(SHORT).min(1),
    responseFormatGuidance: STATEMENT,
    /** What makes an item of each band. An editorial estimate, never the exam's classification. */
    difficultyGuidance: z.strictObject({ basis: z.literal('EDITORIAL_ESTIMATE'), FOUNDATIONAL: STATEMENT, STANDARD: STATEMENT, CHALLENGE: STATEMENT }),
    stimulusGuidance: STATEMENT,
    evidenceMarkers: z.array(z.string().trim().min(2).max(60)).min(2),
    foreignMarkers: z.array(z.string().trim().min(2).max(60)),
    /** The registered source(s) the profile restates. */
    sourceKeys: z.array(ID).min(1),
    restatedInOwnWords: z.literal(true),
  })
  .superRefine((p, ctx) => {
    if ((p.definitionConfidence === 'WORKING_DEFINITION') !== (p.definitionNote !== null)) ctx.addIssue({ code: 'custom', path: ['definitionNote'], message: p.definitionNote === null ? 'WORKING_DEFINITION_NEEDS_A_NOTE' : 'NOTE_ONLY_FOR_A_WORKING_DEFINITION' });
    const norm = (s: string) => s.toLowerCase();
    if (p.foreignMarkers.some((f) => p.evidenceMarkers.some((e) => norm(e) === norm(f)))) ctx.addIssue({ code: 'custom', path: ['foreignMarkers'], message: 'MARKER_IS_BOTH_EVIDENCE_AND_FOREIGN' });
  });
export type ConceptProfile = z.infer<typeof ConceptProfileSchema>;

/** v2 = v1 (sources, facts, no copied expression) + the PRIMARY concept's profile. */
export const ReferenceIntelligencePackV2Schema = z
  .strictObject({ v: z.literal(REFERENCE_PACK_V2_VERSION), sources: z.array(ReferenceSourceSchema).min(1), facts: z.array(PedagogicalFactSchema), containsCopiedProtectedExpression: z.literal(false), conceptProfile: ConceptProfileSchema })
  .superRefine((p, ctx) => {
    // everything v1 requires of sources and facts still holds
    const base = ReferenceIntelligencePackSchema.safeParse({ v: 1, sources: p.sources, facts: p.facts, containsCopiedProtectedExpression: p.containsCopiedProtectedExpression });
    if (!base.success) base.error.issues.forEach((i) => ctx.addIssue({ code: 'custom', path: i.path as Array<string | number>, message: i.message }));
    const usable = new Set(p.sources.filter((s) => s.permittedUse !== 'ACCESS_NOT_VALIDATED').map((s) => s.sourceKey));
    if (p.conceptProfile.sourceKeys.some((k) => !usable.has(k))) ctx.addIssue({ code: 'custom', path: ['conceptProfile', 'sourceKeys'], message: 'PROFILE_SOURCE_NOT_IN_PACK' });
  });
export type ReferenceIntelligencePackV2 = z.infer<typeof ReferenceIntelligencePackV2Schema>;

export type GenerationReadyPackIssue = 'PACK_SCHEMA_INVALID' | 'CONCEPT_PROFILE_MISSING' | 'CONCEPT_PROFILE_IS_FOR_ANOTHER_CONCEPT' | 'PROFILE_SOURCE_NOT_IN_PACK';

/** Is this pack ready to generate for this cell? It must carry the profile of the cell's PRIMARY concept, and no other. */
export function generationReadyPackIssues(pack: unknown, cell: Pick<RequirementCell, 'primaryConcept'>): GenerationReadyPackIssue[] {
  if (pack === null || typeof pack !== 'object' || (pack as { conceptProfile?: unknown }).conceptProfile === undefined || (pack as { conceptProfile?: unknown }).conceptProfile === null) return ['CONCEPT_PROFILE_MISSING'];
  const parsed = ReferenceIntelligencePackV2Schema.safeParse(pack);
  if (!parsed.success) return parsed.error.issues.some((i) => i.message === 'PROFILE_SOURCE_NOT_IN_PACK') ? ['PROFILE_SOURCE_NOT_IN_PACK'] : ['PACK_SCHEMA_INVALID'];
  return parsed.data.conceptProfile.conceptStableId === cell.primaryConcept.stableId ? [] : ['CONCEPT_PROFILE_IS_FOR_ANOTHER_CONCEPT'];
}

/** The v1 view of a v2 pack (sources and facts), for the contracts that read only those. */
export const toReferencePackV1 = (p: ReferenceIntelligencePackV2): ReferenceIntelligencePack => ({ v: 1, sources: p.sources, facts: p.facts, containsCopiedProtectedExpression: false });
