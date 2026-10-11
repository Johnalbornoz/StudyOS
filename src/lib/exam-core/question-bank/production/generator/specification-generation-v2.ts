/**
 * QB-R2E -- specification-driven generation, VERSION 2 (pure, no IO). Version 1 (QB-R2D) is untouched beside it:
 * its templates, prompt and response schema are what its recording was made against, and that replay must not move.
 *
 * WHAT VERSION 2 CHANGES, and why (each is a finding of the QB-R2D live run):
 *   1 NO FORBIDDEN SENTENCE. Version 1 showed the provider the fixed instruction of a constructed response and then
 *     refused any item that used it: a trap of the template. A constructed response now has NO fixed instruction;
 *     what a part asks is said by its own command term, and "working is shown" is the specification's reasoning depth.
 *   2 A STRICT PROVIDER SCHEMA. Version 1 described the response in prose and asked for a JSON object; one first
 *     answer in five was malformed. Version 2 defines the response ONCE, as a tree of nodes, and derives from that
 *     tree both the harness's strict parser and the JSON Schema the provider is constrained by (strict mode: every
 *     member required, no member beyond those listed). They agree by construction, and a test checks that they do.
 *     The provider-side shape is FLAT (arrays instead of maps, null instead of absence, no unions), because that is
 *     what a strict provider schema can express; the harness normalises it into the same candidate contract.
 *   3 THE SPECIFICATION'S NEW CONTENT IS BINDING HERE: the marks it states (total range, number of parts, kinds of
 *     mark point, credit levels) and the command terms it allows, one per part. A response outside them is refused.
 *   4 ITEM-WRITING RULES in the template: a selected response asks for a result or a decision and has parallel
 *     options, none of which shows working; nothing of the specification's own vocabulary reaches the learner;
 *     quantities are plausible for the situation; nothing the construct is evidence of is handed over.
 *
 * As before: no clock, no randomness, no network, no vendor name; a misfit is refused BY NAME and never repaired; the
 * content is judged by the independent validators, which this directory does not import.
 */
import { z } from 'zod';
import { AdaptationSpecificationSchema, specificationIntegrityIssues, type AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { CONTEXT_KINDS } from '@/lib/exam-core/question-bank/task-families/task-family';
import { GenerationPolicySchema, type CandidateStimulus } from '../generation-contract';
import type { ConstructVocabulary } from '../math-construct-registry';
import type { StimulusKind } from '../requirement-cell';
import { OPTION_IDS, SPECIFICATION_CANDIDATE_VERSION, SpecificationCandidateSchema, SpecificationItemContentSchema, type AnswerTarget, type SpecificationCandidate, type SpecificationItemContent } from '../specification-candidate';
import { altText, dataSetAsText, renderStructuredAssets, structuredStimulusViolations, tableAsText, type StructuredStimulus } from '../stimulus-spec';
import { sha256OfCanonicalJson, type GenerationProvider, type RenderedPrompt } from './provider';

export const SPECIFICATION_GENERATION_HARNESS_V2 = { id: 'studyus-specification-generation-harness', version: '2' } as const;
export const SPECIFICATION_RESPONSE_SCHEMA_V2 = { id: 'studyus-specification-generation-response', version: '2' } as const;
export const SPECIFICATION_PROMPT_VERSION_V2 = 2 as const;

export const SPECIFICATION_GENERATION_V2_ERROR_CODES = [
  'SPECIFICATION_INVALID', 'SPECIFICATION_IS_NOT_DEV_TEST_CONTENT', 'SPECIFICATION_HAS_NO_MARKS', 'POLICY_INVALID', 'POLICY_AUTHOR_IS_NOT_A_MODEL', 'POLICY_MODEL_IS_NOT_THE_PROVIDERS', 'POLICY_LANGUAGE_IS_NOT_THE_SPECIFICATIONS',
  'NO_TEMPLATE_FOR_SPECIFICATION', 'CONSTRUCT_VOCABULARY_MISSING', 'CONSTRUCT_VOCABULARY_IS_FOR_ANOTHER_CONSTRUCT', 'ATTEMPT_INVALID',
  'PROVIDER_ANSWERED_ANOTHER_PROMPT', 'PROVIDER_RESPONSE_NOT_JSON', 'PROVIDER_RESPONSE_SCHEMA_INVALID', 'RESPONSE_WIRE_INCONSISTENT', 'RESPONSE_CONTENT_INVALID',
  'RESPONSE_KIND_IS_NOT_THE_FORMATS', 'RESPONSE_OPTIONS_DO_NOT_FIT_TEMPLATE', 'RESPONSE_KEY_IS_NOT_AN_OPTION', 'RESPONSE_DISTRACTORS_DO_NOT_COVER_THE_WRONG_OPTIONS',
  'RESPONSE_STIMULUS_MISSING', 'RESPONSE_UNEXPECTED_STIMULUS', 'RESPONSE_STIMULUS_HAS_NO_STRUCTURED_DATA', 'RESPONSE_STIMULUS_KIND_NOT_IN_SPECIFICATION', 'RESPONSE_STRUCTURED_STIMULUS_INVALID',
  'RESPONSE_REPEATS_FIXED_INSTRUCTION', 'RESPONSE_MARKS_OUTSIDE_SPECIFICATION', 'RESPONSE_COMMAND_TERM_NOT_IN_SPECIFICATION', 'RESPONSE_QUANTITY_TARGET_WITHOUT_A_NUMERIC_VALUE', 'RESPONSE_LEAKS_SPECIFICATION_VOCABULARY',
] as const;
export type SpecificationGenerationV2ErrorCode = (typeof SPECIFICATION_GENERATION_V2_ERROR_CODES)[number];
export class SpecificationGenerationV2Error extends Error {
  constructor(public readonly code: SpecificationGenerationV2ErrorCode, public readonly detail: string = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SpecificationGenerationV2Error';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// ONE definition of the provider response: each node gives the harness's parser AND the provider's JSON Schema
// ---------------------------------------------------------------------------------------------------------------
type JsonSchema = Record<string, unknown>;
interface Node<T = unknown> { zod: z.ZodType<T>; json: JsonSchema }
const str = (): Node<string> => ({ zod: z.string(), json: { type: 'string' } });
const num = (): Node<number> => ({ zod: z.number().finite(), json: { type: 'number' } });
const int = (): Node<number> => ({ zod: z.number().int(), json: { type: 'integer' } });
const bool = (): Node<boolean> => ({ zod: z.boolean(), json: { type: 'boolean' } });
const enm = <const V extends readonly [string, ...string[]]>(values: V): Node<V[number]> => ({ zod: z.enum(values), json: { type: 'string', enum: [...values] } });
const arr = <T>(item: Node<T>): Node<T[]> => ({ zod: z.array(item.zod), json: { type: 'array', items: item.json } });
/** A member that may be null. Never absent: strict mode has no optional member. */
const nul = <T>(node: Node<T>): Node<T | null> => ({ zod: node.zod.nullable(), json: { ...node.json, type: [...(Array.isArray(node.json.type) ? (node.json.type as string[]) : [node.json.type as string]), 'null'], ...(Array.isArray(node.json.enum) ? { enum: [...(node.json.enum as unknown[]), null] } : {}) } });
const strOrNum = (): Node<string | number> => ({ zod: z.union([z.string(), z.number().finite()]), json: { type: ['string', 'number'] } });
const obj = <S extends Record<string, Node>>(shape: S): Node<{ [K in keyof S]: S[K] extends Node<infer T> ? T : never }> => ({
  zod: z.strictObject(Object.fromEntries(Object.entries(shape).map(([k, n]) => [k, n.zod]))) as never,
  json: { type: 'object', additionalProperties: false, required: Object.keys(shape), properties: Object.fromEntries(Object.entries(shape).map(([k, n]) => [k, n.json])) },
});

const answerNode = obj({
  /** `item` for a selected or numeric response; a, b, c ... for the parts of a constructed response. */
  label: str(),
  prompt: nul(str()),
  commandTerm: nul(str()),
  marks: int(),
  markPoints: arr(obj({ kind: enm(['METHOD', 'ACCURACY', 'REASONING']), marks: int(), criterion: str() })),
  finalAnswer: str(),
  numericValue: nul(str()),
  decimalPlaces: nul(int()),
  targetKind: enm(['QUANTITY', 'VERDICT', 'COMPARISON', 'NOT_MACHINE_CHECKABLE']),
  targetCode: nul(str()),
  verdictValue: nul(str()),
  comparisonLeft: nul(str()),
  comparisonOperator: nul(enm(['>', '<', '>=', '<=', '='])),
  comparisonRight: nul(str()),
  comparisonHolds: nul(bool()),
  notCheckableReason: nul(str()),
  arithmeticExpression: nul(str()),
});
const responseNode = obj({
  stimulus: nul(obj({
    text: nul(str()),
    tables: arr(obj({ tableKey: str(), title: str(), columns: arr(obj({ key: str(), label: str(), type: enm(['TEXT', 'NUMBER']), unit: nul(str()) })), rows: arr(arr(strOrNum())) })),
    dataSets: arr(obj({ dataSetKey: str(), title: str(), categories: nul(arr(str())), series: arr(obj({ seriesKey: str(), label: str(), unit: nul(str()), values: arr(num()) })) })),
    charts: arr(obj({ chartKey: str(), chartType: enm(['BAR', 'LINE', 'SCATTER']), title: str(), xLabel: nul(str()), yLabel: nul(str()), sourceKind: enm(['TABLE', 'DATA_SET']), sourceKey: str(), xKey: nul(str()), valueKeys: arr(str()) })),
  })),
  item: obj({
    stem: str(),
    contextKind: enm(CONTEXT_KINDS as unknown as readonly [string, ...string[]]),
    contextDescription: str(),
    construct: str(),
    parameters: arr(obj({ symbol: str(), value: num() })),
    responseKind: enm(['SELECTED', 'NUMERIC', 'CONSTRUCTED']),
    options: arr(obj({ id: str(), text: str() })),
    answerKey: nul(str()),
    distractors: arr(obj({ optionId: str(), misconceptionModelId: str(), rationale: str() })),
    answers: arr(answerNode),
    workingOutline: arr(str()),
    creditLevels: arr(obj({ code: enm(['FULL_CREDIT', 'PARTIAL_CREDIT', 'NO_CREDIT']), description: str() })),
    rationale: str(),
    usesStimulusValues: arr(num()),
    supportingConceptStableIds: arr(str()),
  }),
});

/** The harness's strict parser of the provider's answer. */
export const SpecificationWireResponseSchema = responseNode.zod;
export type SpecificationWireResponse = z.infer<typeof SpecificationWireResponseSchema>;
/** The JSON Schema the provider is constrained by, in strict mode. Derived from the same nodes as the parser above. */
export const SPECIFICATION_PROVIDER_JSON_SCHEMA: { name: string; schema: JsonSchema } = { name: 'studyus_specification_item_v2', schema: responseNode.json };

// ---------------------------------------------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------------------------------------------
export interface SpecificationTemplateV2 {
  id: string;
  version: '2';
  purpose: string;
  appliesTo: { formats: ReadonlyArray<AdaptationSpecification['variable']['responseFormat']['format']> };
  responseKind: 'SELECTED' | 'NUMERIC' | 'CONSTRUCTED';
  constraints: { optionIds: readonly string[]; oneDefensibleAnswer: true };
  task: string;
  /** Shown with the item, never part of it. A constructed response has none. */
  fixedInstruction: Record<string, string>;
}
export const ITEM_WRITING_RULES_V2 = [
  'LEARNER TEXT. The stem, the prompts of the parts, the options and the stimulus are read by a learner. They never contain a word of the specification: no parameter symbol of the construct vocabulary, no quantity or verdict code, no name of an evidence action in capitals, no word such as construct, parameter set, misconception, free measure or specification. Symbols a learner needs are introduced in the item itself, in the item\'s own letters.',
  'PLAUSIBLE SITUATION. A context that is not ABSTRACT is a situation a person could meet, of the kind the specification describes in variable.context.situation, with named things, units and magnitudes that are realistic for them. A situation that is only a relabelled abstraction (a quantity, a measure, a category, units of a product) is not a context.',
  'NOTHING HANDED OVER. The item never states what constructIntegrity lists: the learner must produce it.',
  'NEW NUMBERS. The parameter values are not any of the sets listed in avoidParameterSets.',
] as const;
const COMMON_V2 = 'Everything the specification fixes is binding: the invariants (concept, construct, evidence target), every variable dimension and the parameter ranges with their constraints and valid-solution rules. State the construct, the value of every parameter you used, and for every keyed answer its target in the construct vocabulary. When the specification names a learning approach, serve what it records as honoured and do not act on a preference it records as unmet.';
export const TEMPLATE_V2_SELECTED: SpecificationTemplateV2 = {
  id: 'spec-selected-response', version: '2', purpose: 'One selected-response item written from an adaptation specification.', appliesTo: { formats: ['SELECTED_RESPONSE'] }, responseKind: 'SELECTED',
  constraints: { optionIds: OPTION_IDS, oneDefensibleAnswer: true },
  task: `Write ONE selected-response item. The stem asks for a RESULT or a DECISION -- a value, a choice among what the situation offers, a verdict -- and never asks which option formulates, expresses, compares or interprets correctly. The options are PARALLEL: all of one kind and form and of similar length; no option shows working, a calculation or a justification, because that would mark it as the key -- the working belongs in the rationale. Exactly one option is correct; every wrong option is the result one misconception model of the specification produces. responseKind is SELECTED, answers has one entry labelled item, and its marks are those of the specification. ${COMMON_V2}`,
  fixedInstruction: { es: 'Selecciona la única opción correcta.', en: 'Choose the one correct option.' },
};
export const TEMPLATE_V2_NUMERIC: SpecificationTemplateV2 = {
  id: 'spec-numeric-entry', version: '2', purpose: 'One item answered with a number the student writes, from an adaptation specification.', appliesTo: { formats: ['NUMERIC_ENTRY'] }, responseKind: 'NUMERIC',
  constraints: { optionIds: [], oneDefensibleAnswer: true },
  task: `Write ONE item whose answer is a single number. responseKind is NUMERIC, options and distractors are empty, and answers has one entry labelled item with numericValue (an integer, a decimal with a point, or a fraction a/b), decimalPlaces only if the stem asks for rounding, and arithmeticExpression: the arithmetic that gives the number. ${COMMON_V2}`,
  fixedInstruction: { es: 'Escribe tu respuesta como un número.', en: 'Write your answer as a number.' },
};
export const TEMPLATE_V2_CONSTRUCTED: SpecificationTemplateV2 = {
  id: 'spec-constructed-response', version: '2', purpose: 'One constructed-response item with parts, marks and a mark scheme, from an adaptation specification.', appliesTo: { formats: ['SHORT_RESPONSE', 'EXTENDED_RESPONSE'] }, responseKind: 'CONSTRUCTED',
  constraints: { optionIds: [], oneDefensibleAnswer: true },
  task: `Write ONE constructed-response item: a stem that sets the situation and asks nothing by itself, and parts labelled a, b, c in order, each asking ONE thing. MARKS: the total and the number of parts lie inside specification.variable.marks; each part has its marks and mark points of the kinds marks.markPointKinds whose marks sum to the part's marks. COMMAND TERMS: when the specification has variable.commandTerms, every part uses exactly ONE term of commandTerms.allowed -- the one that fits what that part asks (byEvidenceAction says which terms suit which action); the part's prompt begins with it and commandTerm states it. At least one part uses commandTerms.lead, the term that suits the first action of the evidence target; beyond that a term is never forced onto a part it does not fit, and no term outside the list is used. When the specification has no commandTerms, commandTerm is null. MARK POINTS follow the specification's reasoning depth and rubric style: when working is shown, at least one METHOD point; when a justification is required, at least one REASONING point and a part that asks for the justification; under a method-and-accuracy rubric, at least one ACCURACY point, and every part of two marks or more has a METHOD or REASONING point. A part whose answer is one number gives numericValue and, when the construct vocabulary names that number, a QUANTITY target. A part that asks for an interpretation, a justification or an expression is a part of its own, with a NOT_MACHINE_CHECKABLE target and a reason. Give the working outline of a full-credit response. Mark-point names are neutral: do not imitate any examination board's notation. ${COMMON_V2}`,
  fixedInstruction: {},
};
export const SPECIFICATION_TEMPLATE_REGISTRY_V2: readonly SpecificationTemplateV2[] = [TEMPLATE_V2_SELECTED, TEMPLATE_V2_NUMERIC, TEMPLATE_V2_CONSTRUCTED];

export function selectSpecificationTemplateV2(registry: readonly SpecificationTemplateV2[], specification: AdaptationSpecification): SpecificationTemplateV2 {
  const format = specification.variable.responseFormat.format;
  const fits = registry.filter((t) => t.appliesTo.formats.includes(format));
  if (fits.length !== 1) throw new SpecificationGenerationV2Error('NO_TEMPLATE_FOR_SPECIFICATION', `${fits.length} templates fit ${format}`);
  return fits[0];
}

export const SPECIFICATION_RESPONSE_RULES_V2 = [
  'Every member of the schema is present; a member that does not apply is null or an empty list.',
  'stimulus is null unless the specification\'s stimulus mode is not NONE; then it holds structured data of a kind the specification lists (a table, a data set, or a chart that references one of them and carries no numbers of its own) and usesStimulusValues lists the stimulus numbers the item relies on.',
  'construct is the construct of the specification\'s invariants; parameters lists exactly the parameter symbols of the construct vocabulary (and an optional one only when an asked quantity needs it), each with its value, inside the specification\'s ranges.',
  'contextKind is the context kind the specification decided.',
  'targetKind QUANTITY: targetCode is a quantity code of the vocabulary and numericValue is given. VERDICT: targetCode is a verdict code and verdictValue one of its values. COMPARISON: comparisonLeft, comparisonOperator, comparisonRight (arithmetic over numbers the item states) and comparisonHolds. NOT_MACHINE_CHECKABLE: notCheckableReason, at least ten characters.',
  'arithmeticExpression is arithmetic only -- numbers, + - * / ^, parentheses, sqrt( ) -- with no comparison sign and no letter, or null.',
  'creditLevels is given (FULL_CREDIT and NO_CREDIT at least) exactly when specification.variable.marks.creditLevels is true; otherwise it is empty.',
  'Numbers are written as digits without thousands separators; every declared parameter value appears in the item exactly as declared (or, where the vocabulary says so, in the stimulus or as the coefficients of the stated equation).',
  'The item is written in the specification\'s language and does not contain the fixed instruction.',
] as const;

export const SPECIFICATION_SYSTEM_TEXT_V2 = [
  'You write original assessment content for StudyUs.',
  'Every stem, option, table and figure is your own: do not copy or paraphrase any published exam question or any third-party text.',
  'You are given an ADAPTATION SPECIFICATION. It, and nothing else, says what to write: which task family the item is an instance of, the one primary concept and the construct that must be preserved, and how the assessment target asks for it.',
  'The item must require the primary concept and elicit every action of the evidence target.',
  'Write it as a careful human item writer would for that target: a real question, natural wording, no trace of these instructions.',
  'Return exactly the JSON object of the response schema.',
].join(' ');

export interface SpecificationGenerationPromptV2 {
  v: typeof SPECIFICATION_PROMPT_VERSION_V2;
  system: string;
  instruction: {
    task: string;
    itemWritingRules: readonly string[];
    harness: { id: string; version: string };
    template: { id: string; version: string; constraints: SpecificationTemplateV2['constraints']; fixedInstruction: string | null };
    policy: { id: string; version: string; language: string; copyReferenceExpression: false };
    unit: { unitKey: string; attempt: number };
    specification: Record<string, unknown>;
    constructVocabulary: { construct: string; parameters: readonly string[]; optionalParameters: readonly string[]; quantities: ConstructVocabulary['quantities']; verdicts: ConstructVocabulary['verdicts'] };
    constructIntegrity: readonly string[];
    avoidParameterSets: ReadonlyArray<Readonly<Record<string, number>>>;
    responseSchema: { id: string; version: string; rules: readonly string[] };
  };
}

export interface SpecificationGenerationUnitV2 { unitKey: string; specification: unknown; attempt: number; /** Parameter sets earlier runs already used for this construct: not to be reused. */ avoidParameterSets?: ReadonlyArray<Readonly<Record<string, number>>> }
export interface GenerateFromSpecificationV2Input {
  unit: SpecificationGenerationUnitV2;
  constructVocabulary: ConstructVocabulary | null;
  /** What the construct must not hand to the learner, supplied by the discipline's own module. */
  constructIntegrity: readonly string[];
  policy: unknown;
  provider: GenerationProvider;
  templateRegistry: readonly SpecificationTemplateV2[];
  runId: string;
  batchKey: string;
  now: string;
}

interface PreparedV2 { specification: AdaptationSpecification; template: SpecificationTemplateV2; policy: z.infer<typeof GenerationPolicySchema>; rendered: RenderedPrompt<SpecificationGenerationPromptV2>; unitKey: string; attempt: number; vocabulary: ConstructVocabulary }
const constructOf = (s: AdaptationSpecification): string => String((s.invariants.construct as { construct?: unknown } | null)?.construct ?? '');

function prepare(input: Omit<GenerateFromSpecificationV2Input, 'runId' | 'batchKey' | 'now'>): PreparedV2 {
  const issues = specificationIntegrityIssues(input.unit.specification);
  if (issues.length > 0) throw new SpecificationGenerationV2Error('SPECIFICATION_INVALID', issues.join(','));
  const s = AdaptationSpecificationSchema.parse(input.unit.specification);
  if (s.contentUseClass !== 'DEV_TEST_CONTENT') throw new SpecificationGenerationV2Error('SPECIFICATION_IS_NOT_DEV_TEST_CONTENT', s.contentUseClass);
  // version 2 generates only from a specification that states its marks: an older specification is not completed here
  if (!s.variable.marks) throw new SpecificationGenerationV2Error('SPECIFICATION_HAS_NO_MARKS', s.specificationId);
  if (!Number.isInteger(input.unit.attempt) || input.unit.attempt < 1 || input.unit.attempt > 2) throw new SpecificationGenerationV2Error('ATTEMPT_INVALID', String(input.unit.attempt));
  const policyParsed = GenerationPolicySchema.safeParse(input.policy);
  if (!policyParsed.success) throw new SpecificationGenerationV2Error('POLICY_INVALID', policyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const policy = policyParsed.data;
  if (policy.author.kind !== 'MODEL') throw new SpecificationGenerationV2Error('POLICY_AUTHOR_IS_NOT_A_MODEL');
  if (policy.author.model !== input.provider.model) throw new SpecificationGenerationV2Error('POLICY_MODEL_IS_NOT_THE_PROVIDERS', `${policy.author.model} / ${input.provider.model}`);
  if (policy.language !== s.variable.language) throw new SpecificationGenerationV2Error('POLICY_LANGUAGE_IS_NOT_THE_SPECIFICATIONS', `${policy.language} / ${s.variable.language}`);
  const template = selectSpecificationTemplateV2(input.templateRegistry, s);
  const vocabulary = input.constructVocabulary;
  if (!vocabulary) throw new SpecificationGenerationV2Error('CONSTRUCT_VOCABULARY_MISSING', constructOf(s));
  if (vocabulary.construct !== constructOf(s)) throw new SpecificationGenerationV2Error('CONSTRUCT_VOCABULARY_IS_FOR_ANOTHER_CONSTRUCT', `${vocabulary.construct} / ${constructOf(s)}`);
  const la = s.learningApproach;
  const prompt: SpecificationGenerationPromptV2 = {
    v: SPECIFICATION_PROMPT_VERSION_V2,
    system: SPECIFICATION_SYSTEM_TEXT_V2,
    instruction: {
      task: template.task,
      itemWritingRules: ITEM_WRITING_RULES_V2,
      harness: { ...SPECIFICATION_GENERATION_HARNESS_V2 },
      template: { id: template.id, version: template.version, constraints: template.constraints, fixedInstruction: template.fixedInstruction[policy.language] ?? null },
      policy: { id: policy.policyId, version: policy.policyVersion, language: policy.language, copyReferenceExpression: false },
      unit: { unitKey: input.unit.unitKey, attempt: input.unit.attempt },
      specification: {
        specificationId: s.specificationId, contentUseClass: s.contentUseClass, taskFamily: { familyId: s.taskFamily.familyId, version: s.taskFamily.version, familyType: s.taskFamily.familyType },
        systemProfile: { profileId: s.systemProfile.profileId, version: s.systemProfile.version }, componentProfile: s.componentProfile ? { componentId: s.componentProfile.componentId, version: s.componentProfile.version, localSubject: s.componentProfile.localSubject } : null,
        disciplinePolicy: { policyId: s.disciplinePolicy.policyId, version: s.disciplinePolicy.version }, primaryConcept: s.primaryConcept, targetSkills: s.targetSkills, invariants: s.invariants, invariantHash: s.invariantHash, variable: s.variable, parameterization: s.parameterization,
        ...(la ? { learningApproach: { approachId: la.approachId, version: la.version, transversalCompetencies: la.transversalCompetencies.map((c) => ({ key: c.key, code: c.code, servedByFamily: c.servedByFamily })), participation: la.participation, honouredPreferences: la.honouredPreferences.map((h) => ({ preferenceId: h.preferenceId, dimension: h.dimension, decided: h.decided })), unmetPreferences: la.unmetPreferences.map((u) => ({ preferenceId: u.preferenceId, dimension: u.dimension, decided: u.decided })) } } : {}),
      },
      constructVocabulary: { construct: vocabulary.construct, parameters: vocabulary.parameters, optionalParameters: vocabulary.optionalParameters, quantities: vocabulary.quantities, verdicts: vocabulary.verdicts },
      constructIntegrity: [...input.constructIntegrity],
      avoidParameterSets: [...(input.unit.avoidParameterSets ?? [])],
      responseSchema: { id: SPECIFICATION_RESPONSE_SCHEMA_V2.id, version: SPECIFICATION_RESPONSE_SCHEMA_V2.version, rules: SPECIFICATION_RESPONSE_RULES_V2 },
    },
  };
  return { specification: s, template, policy, rendered: { prompt, promptHash: sha256OfCanonicalJson(prompt) }, unitKey: input.unit.unitKey, attempt: input.unit.attempt, vocabulary };
}

export function renderSpecificationPromptV2(input: Omit<GenerateFromSpecificationV2Input, 'runId' | 'batchKey' | 'now'>): RenderedPrompt<SpecificationGenerationPromptV2> & { template: { id: string; version: string } } {
  const p = prepare(input);
  return { ...p.rendered, template: { id: p.template.id, version: p.template.version } };
}

/** Text -> the provider's flat answer, strictly parsed. */
export function parseSpecificationWireResponse(rawText: string): SpecificationWireResponse {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new SpecificationGenerationV2Error('PROVIDER_RESPONSE_NOT_JSON');
  }
  const parsed = SpecificationWireResponseSchema.safeParse(json);
  if (!parsed.success) throw new SpecificationGenerationV2Error('PROVIDER_RESPONSE_SCHEMA_INVALID', parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return parsed.data;
}

type WireAnswer = SpecificationWireResponse['item']['answers'][number];
const inconsistent = (detail: string): never => { throw new SpecificationGenerationV2Error('RESPONSE_WIRE_INCONSISTENT', detail); };
function targetOf(a: WireAnswer): AnswerTarget {
  if (a.targetKind === 'QUANTITY') return a.targetCode ? { kind: 'QUANTITY', quantity: a.targetCode } : inconsistent(`${a.label}: QUANTITY without targetCode`);
  if (a.targetKind === 'VERDICT') return a.targetCode && a.verdictValue ? { kind: 'VERDICT', verdict: a.targetCode, value: a.verdictValue } : inconsistent(`${a.label}: VERDICT without targetCode or verdictValue`);
  if (a.targetKind === 'COMPARISON') return a.comparisonLeft && a.comparisonRight && a.comparisonOperator && a.comparisonHolds !== null ? { kind: 'COMPARISON', left: a.comparisonLeft, operator: a.comparisonOperator, right: a.comparisonRight, holds: a.comparisonHolds, verdict: a.verdictValue } : inconsistent(`${a.label}: COMPARISON without its four members`);
  return a.notCheckableReason && a.notCheckableReason.trim().length >= 10 ? { kind: 'NOT_MACHINE_CHECKABLE', reason: a.notCheckableReason } : inconsistent(`${a.label}: NOT_MACHINE_CHECKABLE without a reason`);
}
const NO_ARITHMETIC = 'No arithmetic expression was declared for this answer.';

/**
 * The provider's flat answer as the candidate contract's content and stimulus. A pure re-shaping: nothing is
 * defaulted into correctness, and a combination the flat shape allows but the contract does not is refused by name.
 */
export function normalizeWireResponse(wire: SpecificationWireResponse): { item: SpecificationItemContent; stimulus: { parts: Array<{ label: string | null; partKind: 'TEXT'; text: string }>; structured: StructuredStimulus } | null } {
  const w = wire.item;
  const answerCheck = (a: WireAnswer) => (a.arithmeticExpression !== null ? { kind: 'ARITHMETIC_EXPRESSION' as const, expression: a.arithmeticExpression } : { kind: 'NOT_COMPUTABLE' as const, reason: NO_ARITHMETIC });
  const numericKey = (a: WireAnswer) => (a.numericValue === null ? null : { kind: 'NUMERIC' as const, value: a.numericValue, equivalentFormsAllowed: true, ...(a.decimalPlaces !== null ? { decimalPlaces: a.decimalPlaces } : {}) });
  const single = (): WireAnswer => (w.answers.length === 1 && w.answers[0].label === 'item' ? w.answers[0] : inconsistent(`${w.responseKind}: answers must be one entry labelled item`));
  let selected: SpecificationItemContent['selected'] = null, numeric: SpecificationItemContent['numeric'] = null, constructed: SpecificationItemContent['constructed'] = null;
  if (w.responseKind === 'SELECTED') {
    const a = single();
    if (w.answerKey === null) inconsistent('SELECTED without answerKey');
    selected = { options: w.options, answerKey: w.answerKey!, distractors: Object.fromEntries(w.distractors.map((d) => [d.optionId, { misconceptionModelId: d.misconceptionModelId, rationale: d.rationale }])), target: targetOf(a), answerCheck: answerCheck(a) };
    if (new Set(w.distractors.map((d) => d.optionId)).size !== w.distractors.length) inconsistent('a distractor is listed twice');
  } else if (w.responseKind === 'NUMERIC') {
    const a = single();
    if (w.options.length > 0 || w.distractors.length > 0 || w.answerKey !== null) inconsistent('NUMERIC with options, distractors or an answerKey');
    const key = numericKey(a);
    if (key === null) throw new SpecificationGenerationV2Error('RESPONSE_QUANTITY_TARGET_WITHOUT_A_NUMERIC_VALUE', 'item');
    numeric = { numericKey: key, target: targetOf(a), answerCheck: answerCheck(a) };
  } else {
    if (w.options.length > 0 || w.distractors.length > 0 || w.answerKey !== null) inconsistent('CONSTRUCTED with options, distractors or an answerKey');
    if (w.answers.length === 0) inconsistent('CONSTRUCTED without parts');
    const parts = w.answers.map((a) => {
      if (a.prompt === null) inconsistent(`${a.label}: a part without a prompt`);
      // the contract of QB-R2D's most frequent structural defect: a part declared to be a quantity carries its number
      if (a.targetKind === 'QUANTITY' && a.numericValue === null) throw new SpecificationGenerationV2Error('RESPONSE_QUANTITY_TARGET_WITHOUT_A_NUMERIC_VALUE', a.label);
      return { label: a.label, prompt: a.prompt!, commandTerm: a.commandTerm, marks: a.marks, markScheme: a.markPoints, finalAnswer: a.finalAnswer, numericKey: numericKey(a), target: targetOf(a), answerCheck: answerCheck(a) };
    });
    constructed = { parts, totalMarks: parts.reduce((n, p) => n + p.marks, 0), workingOutline: w.workingOutline };
  }
  const content = { stem: w.stem, context: { kind: w.contextKind, description: w.contextDescription }, declaredModel: { construct: w.construct, parameters: Object.fromEntries(w.parameters.map((p) => [p.symbol, p.value])) }, selected, numeric, constructed, credit: w.creditLevels.length > 0 ? w.creditLevels : null, rationale: w.rationale, usesStimulusValues: wire.stimulus ? w.usesStimulusValues : null, proposedSupportingConceptStableIds: w.supportingConceptStableIds };
  if (new Set(w.parameters.map((p) => p.symbol)).size !== w.parameters.length) inconsistent('a parameter is listed twice');
  const parsed = SpecificationItemContentSchema.safeParse(content);
  if (!parsed.success) throw new SpecificationGenerationV2Error('RESPONSE_CONTENT_INVALID', parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const st = wire.stimulus;
  const stimulus = st === null ? null : {
    parts: st.text ? [{ label: null, partKind: 'TEXT' as const, text: st.text }] : [],
    structured: {
      v: 1 as const, tables: st.tables, dataSets: st.dataSets, figures: [],
      charts: st.charts.map((c) => ({ chartKey: c.chartKey, chartType: c.chartType, title: c.title, xLabel: c.xLabel, yLabel: c.yLabel, source: c.sourceKind === 'TABLE' ? { kind: 'TABLE' as const, tableKey: c.sourceKey, xColumn: c.xKey, valueColumns: c.valueKeys } : { kind: 'DATA_SET' as const, dataSetKey: c.sourceKey, xSeriesKey: c.xKey, seriesKeys: c.valueKeys } })),
    } as StructuredStimulus,
  };
  return { item: parsed.data, stimulus };
}

/** Words of the specification that must never reach a learner. The generator's own, deliberately small, list: the validators hold theirs. */
const CODE_WORDS = /(?<![\p{L}_])(FORMULATE|SOLVE|INTERPRET|COMPUTE|EVALUATE|REPRESENT|JUSTIFY|RECALL|SUPPORTED|CONTRADICTED|NOT_DECIDABLE|OPTION_[12]|[A-Z]{2,}(?:_[A-Z0-9]+)+)(?![\p{L}_])/u;
function leakedVocabulary(text: string, vocabulary: ConstructVocabulary, specification: AdaptationSpecification): string[] {
  const out: string[] = [];
  const code = CODE_WORDS.exec(text);
  if (code) out.push(code[1]);
  const constructSymbols = ((specification.invariants.construct as { variables?: Array<{ symbol?: unknown }> } | null)?.variables ?? []).map((v) => String(v.symbol ?? ''));
  for (const symbol of new Set([...vocabulary.parameters, ...vocabulary.optionalParameters, ...constructSymbols])) if (/^[\p{L}][\p{L}\d]+$/u.test(symbol) && new RegExp(`(?<![\\p{L}\\d_])${symbol}(?![\\p{L}\\d_])`, 'u').test(text)) out.push(symbol);
  return out;
}
const kindOfStimulus = (s: StructuredStimulus): StimulusKind | null => (s.charts.length > 0 ? 'GRAPH' : s.tables.length > 0 ? 'TABLE' : s.dataSets.length > 0 ? 'DATA_SET' : null);

/** Does the response have the STRUCTURE the template and the specification ask for? Every misfit is a named refusal. */
function fit(item: SpecificationItemContent, stimulus: ReturnType<typeof normalizeWireResponse>['stimulus'], p: PreparedV2): StimulusKind | null {
  const refuse = (code: SpecificationGenerationV2ErrorCode, detail = ''): never => { throw new SpecificationGenerationV2Error(code, detail); };
  const given = { SELECTED: item.selected !== null, NUMERIC: item.numeric !== null, CONSTRUCTED: item.constructed !== null };
  if (!given[p.template.responseKind]) refuse('RESPONSE_KIND_IS_NOT_THE_FORMATS', `${p.template.id}: ${JSON.stringify(given)}`);
  if (item.selected) {
    const ids = p.template.constraints.optionIds;
    if (item.selected.options.length !== ids.length || item.selected.options.some((o, i) => o.id !== ids[i])) refuse('RESPONSE_OPTIONS_DO_NOT_FIT_TEMPLATE');
    if (!ids.includes(item.selected.answerKey)) refuse('RESPONSE_KEY_IS_NOT_AN_OPTION', item.selected.answerKey);
    const wrong = ids.filter((id) => id !== item.selected!.answerKey).sort();
    if (Object.keys(item.selected.distractors).sort().join(',') !== wrong.join(',')) refuse('RESPONSE_DISTRACTORS_DO_NOT_COVER_THE_WRONG_OPTIONS', Object.keys(item.selected.distractors).sort().join(','));
  }
  const fixed = p.template.fixedInstruction[p.policy.language];
  if (fixed && item.stem.includes(fixed)) refuse('RESPONSE_REPEATS_FIXED_INSTRUCTION');
  // the marks the specification states
  const marks = p.specification.variable.marks!;
  const total = item.constructed ? item.constructed.totalMarks : 1;
  if (total < marks.total.min || total > marks.total.max) refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', `total ${total} not in [${marks.total.min}, ${marks.total.max}]`);
  if (item.constructed) {
    if (marks.scoredAs !== 'MARKED_PARTS') refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', `a constructed response of marked parts under ${marks.scoredAs}`);
    const n = item.constructed.parts.length;
    if (marks.parts && (n < marks.parts.min || n > marks.parts.max)) refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', `${n} parts not in [${marks.parts.min}, ${marks.parts.max}]`);
    const foreign = item.constructed.parts.flatMap((x) => x.markScheme).filter((m) => !(marks.markPointKinds as string[]).includes(m.kind));
    if (foreign.length > 0) refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', `mark point kind ${foreign[0].kind}`);
    // one command term per part, from the specification's own list
    const terms = p.specification.variable.commandTerms;
    for (const part of item.constructed.parts) {
      if (terms ? !part.commandTerm || !terms.allowed.includes(part.commandTerm) : part.commandTerm !== null && part.commandTerm !== undefined) refuse('RESPONSE_COMMAND_TERM_NOT_IN_SPECIFICATION', `${part.label}: ${part.commandTerm ?? 'none'}`);
    }
  } else if (marks.scoredAs === 'MARKED_PARTS') refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', 'a closed response under MARKED_PARTS');
  if ((item.credit !== null) !== marks.creditLevels) refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', `credit levels ${item.credit !== null ? 'given' : 'missing'}; the specification says ${marks.creditLevels}`);
  // nothing of the specification's vocabulary in what a learner reads
  const learnerText = [item.stem, ...(item.constructed?.parts.map((x) => x.prompt) ?? []), ...(item.selected?.options.map((o) => o.text) ?? []), ...(stimulus ? [...stimulus.parts.map((x) => x.text), ...stimulus.structured.tables.flatMap((t) => [t.title, ...t.columns.map((c) => c.label)]), ...stimulus.structured.dataSets.flatMap((d) => [d.title, ...d.series.map((q) => q.label)])] : [])].join(' \n ');
  const leaked = leakedVocabulary(learnerText, p.vocabulary, p.specification);
  if (leaked.length > 0) refuse('RESPONSE_LEAKS_SPECIFICATION_VOCABULARY', leaked.join(','));
  const wanted = p.specification.variable.stimulus;
  if (wanted.mode === 'NONE') {
    if (stimulus !== null) refuse('RESPONSE_UNEXPECTED_STIMULUS');
    return null;
  }
  if (stimulus === null) return refuse('RESPONSE_STIMULUS_MISSING');
  const kind = kindOfStimulus(stimulus.structured);
  if (kind === null) return refuse('RESPONSE_STIMULUS_HAS_NO_STRUCTURED_DATA');
  if (!wanted.kinds.includes(kind)) refuse('RESPONSE_STIMULUS_KIND_NOT_IN_SPECIFICATION', `${kind} not in ${wanted.kinds.join('/')}`);
  const violations = structuredStimulusViolations(kind, stimulus.structured);
  if (violations.length > 0) refuse('RESPONSE_STRUCTURED_STIMULUS_INVALID', violations.join(','));
  return kind;
}

export interface SpecificationUnitResultV2 { candidate: SpecificationCandidate; stimulus: CandidateStimulus | null; promptHash: string }

/** Runs ONE specification through the provider and returns its candidate, with complete lineage. */
export async function generateFromSpecificationV2(input: GenerateFromSpecificationV2Input): Promise<SpecificationUnitResultV2> {
  const p = prepare(input);
  const answer = await input.provider.generate(p.rendered);
  if (answer.promptHash !== p.rendered.promptHash) throw new SpecificationGenerationV2Error('PROVIDER_ANSWERED_ANOTHER_PROMPT', answer.promptHash);
  const { item, stimulus: wireStimulus } = normalizeWireResponse(parseSpecificationWireResponse(answer.rawText));
  const stimulusKind = fit(item, wireStimulus, p);
  const s = p.specification;
  const language = p.policy.language;
  let stimulus: CandidateStimulus | null = null;
  if (wireStimulus && stimulusKind) {
    const st = wireStimulus.structured;
    const derived = [
      ...st.tables.map((t) => ({ label: t.tableKey, partKind: 'TABLE' as const, text: tableAsText(t, language) })),
      ...st.dataSets.map((d) => ({ label: d.dataSetKey, partKind: 'DATA_SET' as const, text: dataSetAsText(d, language) })),
      ...st.charts.map((c) => ({ label: c.chartKey, partKind: 'GRAPH' as const, text: altText(c, language, st) })),
    ];
    stimulus = { stimulusKey: `stim|${p.unitKey}`, kind: stimulusKind, language, parts: [...wireStimulus.parts, ...derived], provenance: 'STUDYUS_GENERATED', stimulusPlanId: null, generationUnitKey: p.unitKey, structured: st, renderedAssets: renderStructuredAssets(st, language) };
  }
  const author = p.policy.author as Extract<typeof p.policy.author, { kind: 'MODEL' }>;
  const candidate: SpecificationCandidate = {
    v: SPECIFICATION_CANDIDATE_VERSION, candidateKey: `cand|${p.unitKey}`, unitKey: p.unitKey, batchKey: input.batchKey, specificationId: s.specificationId, primaryConceptStableId: s.primaryConcept.stableId, language,
    responseFormat: s.variable.responseFormat.format, difficultyBand: s.variable.difficulty.band, marks: item.constructed ? item.constructed.totalMarks : 1, instruction: p.template.fixedInstruction[language] ?? null,
    stimulusKey: stimulus ? stimulus.stimulusKey : null, content: item, contentUseClass: 'DEV_TEST_CONTENT', provenance: 'STUDYUS_GENERATED',
    lineage: {
      kind: 'MODEL', primaryConcept: s.primaryConcept, taskFamily: { id: s.taskFamily.familyId, version: s.taskFamily.version },
      learningApproach: s.learningApproach ? { recordedAs: 'EXPLICIT', id: s.learningApproach.approachId, version: s.learningApproach.version } : { recordedAs: 'STANDARD_BY_ABSENCE' },
      systemProfile: { id: s.systemProfile.profileId, version: s.systemProfile.version },
      componentProfile: s.componentProfile ? { id: s.componentProfile.componentId, version: s.componentProfile.version, versionBinding: s.componentProfile.versionBinding } : null,
      systemVersionBinding: s.systemProfile.versionBinding ?? null,
      disciplinePolicy: { id: s.disciplinePolicy.policyId, version: s.disciplinePolicy.version },
      adaptationSpecification: { id: s.specificationId, invariantHash: s.invariantHash }, contentUseClass: 'DEV_TEST_CONTENT',
      generationRequest: { promptHash: p.rendered.promptHash, template: { id: p.template.id, version: p.template.version }, policy: { id: p.policy.policyId, version: p.policy.policyVersion }, harness: { ...SPECIFICATION_GENERATION_HARNESS_V2 }, responseSchema: { ...SPECIFICATION_RESPONSE_SCHEMA_V2 }, unitKey: p.unitKey, attempt: p.attempt, requestedBy: author.requestedBy },
      generationRun: { runId: input.runId, provider: input.provider.id, model: input.provider.model, generatedAt: input.now },
    },
  };
  return { candidate: SpecificationCandidateSchema.parse(candidate), stimulus, promptHash: p.rendered.promptHash };
}
