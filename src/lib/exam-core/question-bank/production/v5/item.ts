/**
 * Question Factory V5 -- the immutable generation specification and the candidate item.
 *
 * The specification is the internal scaffolding (bucket, intended difficulty, marks, command term, cognitive target).
 * It is stored beside the item and NEVER rendered into it: `learnerView()` is the only thing a learner, the
 * independent solver or the difficulty calibrator is shown, and it is built from learner-facing fields alone.
 *
 * Pure.
 */
import { z } from 'zod';
import { EXAM_FAMILIES } from '../../../taxonomy';
import { sha256OfCanonicalJson } from '../generator/provider';
import { DIFFICULTY_TIERS, ITEM_FORMATS } from './generation-profile';

export const ITEM_SCHEMA_VERSION = 'qf-v5-item-1';

export const GenerationSpecificationSchema = z
  .object({
    v: z.literal(1),
    slotKey: z.string().min(1).max(200),
    profileId: z.string().min(1).max(120),
    profileVersion: z.string().min(1).max(80),
    family: z.enum(EXAM_FAMILIES),
    configKey: z.string().min(1).max(80),
    sectionKey: z.string().min(1).max(80),
    /** The blueprint bucket this slot fills: objective code + target index within it. */
    bucket: z.object({ objectiveCode: z.string().min(1).max(80), targetIndex: z.number().int().min(0).max(40) }).strict(),
    conceptIds: z.array(z.string().min(1).max(160)).max(8),
    objectiveIds: z.array(z.string().min(1).max(160)).min(1).max(8),
    skillIds: z.array(z.string().min(1).max(160)).max(8),
    competencyIds: z.array(z.string().min(1).max(160)).max(8),
    itemFormat: z.enum(ITEM_FORMATS),
    intendedDifficulty: z.enum(DIFFICULTY_TIERS),
    intendedMarks: z.number().int().min(1).max(60),
    commandTerm: z.string().min(1).max(60).nullable(),
    cognitiveTarget: z.string().min(1).max(400),
    contextRequirement: z.string().min(1).max(400),
    responseExpectation: z.string().min(1).max(400),
    language: z.enum(['es', 'en']),
    /** 0 for the first attempt, 1 for the one automatic regeneration a specification is allowed. */
    attempt: z.number().int().min(0).max(1),
  })
  .strict();
export type GenerationSpecification = z.infer<typeof GenerationSpecificationSchema>;

export const specificationHash = (s: GenerationSpecification): string => sha256OfCanonicalJson(s);

const OptionSchema = z.object({ label: z.string().regex(/^[A-F]$/), text: z.string().min(1).max(1200) }).strict();
const PartSchema = z
  .object({
    label: z.string().regex(/^\(?[a-z]\)?(\(?[ivx]+\)?)?$/),
    prompt: z.string().min(1).max(4000),
    marks: z.number().int().min(1).max(30),
    commandTerm: z.string().min(1).max(60).nullable(),
    canonicalAnswer: z.string().min(1).max(4000),
    /** Labels of earlier parts whose result this part uses. */
    dependsOn: z.array(z.string().min(1).max(12)).max(8),
  })
  .strict();
const RubricPointSchema = z.object({ marks: z.number().int().min(1).max(30), criterion: z.string().min(1).max(1200) }).strict();

/** What the generator returns. Its answer is a PROPOSAL: nothing downstream treats it as authoritative. */
export const CandidateItemSchema = z
  .object({
    v: z.literal(1),
    itemId: z.string().min(1).max(200),
    slotKey: z.string().min(1).max(200),
    itemType: z.enum(ITEM_FORMATS),
    language: z.enum(['es', 'en']),
    /** Passage, data table or situation shown with the question; original StudyUs material. */
    stimulus: z.string().max(12000).nullable(),
    /** The complete learner-facing question. Always populated; never a template. */
    fullLearnerPrompt: z.string().min(20).max(8000),
    parts: z.array(PartSchema).max(12),
    options: z.array(OptionSchema).max(6),
    /** Proposed key: an option label for selected response, the value/expression/answer text otherwise. */
    proposedAnswer: z.string().min(1).max(4000),
    /** A machine-checkable arithmetic expression for the answer, when one exists. */
    answerExpression: z.string().max(400).nullable(),
    acceptedUnits: z.array(z.string().min(1).max(20)).max(6),
    solution: z.string().min(1).max(8000),
    rubric: z.array(RubricPointSchema).max(30),
    /** Per distractor: the reasoning error that produces it. */
    distractorRationales: z.record(z.string().regex(/^[A-F]$/), z.string().min(1).max(600)),
    marks: z.number().int().min(1).max(60),
    commandTerm: z.string().min(1).max(60).nullable(),
    provenance: z.literal('ORIGINAL_STUDYUS'),
  })
  .strict();
export type CandidateItem = z.infer<typeof CandidateItemSchema>;

/** Exactly what a learner sees. The solver and the difficulty calibrator receive this and nothing else. */
export interface LearnerView {
  language: 'es' | 'en';
  itemType: CandidateItem['itemType'];
  stimulus: string | null;
  prompt: string;
  parts: { label: string; prompt: string; marks: number }[];
  options: { label: string; text: string }[];
  marks: number;
}

export function learnerView(item: CandidateItem): LearnerView {
  return {
    language: item.language,
    itemType: item.itemType,
    stimulus: item.stimulus,
    prompt: item.fullLearnerPrompt,
    parts: item.parts.map((p) => ({ label: p.label, prompt: p.prompt, marks: p.marks })),
    options: item.options.map((o) => ({ label: o.label, text: o.text })),
    marks: item.marks,
  };
}

/** Every learner-visible string of an item, for leakage, duplicate and plausibility checks. */
export const learnerText = (item: CandidateItem): string =>
  [item.stimulus ?? '', item.fullLearnerPrompt, ...item.parts.map((p) => p.prompt), ...item.options.map((o) => o.text)].join('\n');
