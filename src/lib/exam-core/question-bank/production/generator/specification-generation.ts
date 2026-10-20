/**
 * QB-R2D -- generation DRIVEN BY AN ADAPTATION SPECIFICATION (pure, no IO).
 *
 *   AdaptationSpecification (+ construct vocabulary + GenerationPolicy)
 *     -> template (by the specification's elicitation format) -> provider-neutral PROMPT + promptHash
 *     -> GenerationProvider.generate(prompt) -> strict parse -> fit against the specification -> SpecificationCandidate
 *
 * The unit of generation is ONE specification. The input is the specification itself -- family, target, invariants,
 * every decided variable dimension, the parameter ranges -- never an exam name plus a topic. No requirement cell is
 * invented for it: a specification for a target that has no planned cell is generated as what it is.
 *
 * It adds the CONSTRUCTED-RESPONSE path: a stem, parts with marks, a typed mark scheme, final answers with a
 * machine-checkable target where the answer is a number, and a working outline.
 *
 * ADDITIVE. Nothing of the cell-driven harness is changed or re-exported; a cell-driven batch is byte-identical.
 * Same rules as that harness: no clock, no randomness, no network, no vendor name; `now` is passed in; a response
 * that does not fit is refused BY NAME and never repaired. `attempt` is part of the prompt, so an explicit
 * regeneration is a different prompt with a different hash and its own recording.
 *
 * It does NOT judge the content. Whether the key is right, the construct is kept or the profile is respected is the
 * work of the independent validators, which this directory must not import.
 */
import { z } from 'zod';
import { AdaptationSpecificationSchema, specificationIntegrityIssues, type AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { GenerationPolicySchema, type CandidateStimulus } from '../generation-contract';
import type { ConstructVocabulary } from '../math-construct-registry';
import type { StimulusKind } from '../requirement-cell';
import { OPTION_IDS, SPECIFICATION_CANDIDATE_VERSION, SpecificationBatchSchema, SpecificationCandidateSchema, SpecificationItemContentSchema, type SpecificationBatch, type SpecificationCandidate, type SpecificationGenerationFailure, type SpecificationItemContent } from '../specification-candidate';
import { altText, dataSetAsText, renderStructuredAssets, structuredStimulusViolations, tableAsText } from '../stimulus-spec';
import { sha256OfCanonicalJson, type GenerationProvider, type RenderedPrompt } from './provider';
import { ResponseStimulusSchema } from './response-schema';

export const SPECIFICATION_GENERATION_HARNESS = { id: 'studyus-specification-generation-harness', version: '1' } as const;
export const SPECIFICATION_RESPONSE_SCHEMA = { id: 'studyus-specification-generation-response', version: '1' } as const;
export const SPECIFICATION_PROMPT_VERSION = 1 as const;

export const SPECIFICATION_GENERATION_ERROR_CODES = [
  'SPECIFICATION_INVALID', 'SPECIFICATION_IS_NOT_DEV_TEST_CONTENT', 'POLICY_INVALID', 'POLICY_AUTHOR_IS_NOT_A_MODEL', 'POLICY_MODEL_IS_NOT_THE_PROVIDERS', 'POLICY_LANGUAGE_IS_NOT_THE_SPECIFICATIONS',
  'NO_TEMPLATE_FOR_SPECIFICATION', 'CONSTRUCT_VOCABULARY_MISSING', 'CONSTRUCT_VOCABULARY_IS_FOR_ANOTHER_CONSTRUCT', 'ATTEMPT_INVALID',
  'PROVIDER_ANSWERED_ANOTHER_PROMPT', 'PROVIDER_RESPONSE_NOT_JSON', 'PROVIDER_RESPONSE_SCHEMA_INVALID',
  'RESPONSE_MEMBER_IS_NOT_THE_FORMATS', 'RESPONSE_OPTIONS_DO_NOT_FIT_TEMPLATE', 'RESPONSE_KEY_IS_NOT_AN_OPTION', 'RESPONSE_DISTRACTORS_DO_NOT_COVER_THE_WRONG_OPTIONS',
  'RESPONSE_STIMULUS_MISSING', 'RESPONSE_UNEXPECTED_STIMULUS', 'RESPONSE_STIMULUS_HAS_NO_STRUCTURED_DATA', 'RESPONSE_STIMULUS_KIND_NOT_IN_SPECIFICATION', 'RESPONSE_STRUCTURED_STIMULUS_INVALID',
  'RESPONSE_REPEATS_FIXED_INSTRUCTION', 'BATCH_INPUT_INVALID',
] as const;
export type SpecificationGenerationErrorCode = (typeof SPECIFICATION_GENERATION_ERROR_CODES)[number];
/** Codes of a response that is not even well-formed: the only failures a caller may retry once without counting a regeneration. */
export const MALFORMED_RESPONSE_CODES: readonly SpecificationGenerationErrorCode[] = ['PROVIDER_RESPONSE_NOT_JSON', 'PROVIDER_RESPONSE_SCHEMA_INVALID'];

export class SpecificationGenerationError extends Error {
  constructor(public readonly code: SpecificationGenerationErrorCode, public readonly detail: string = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SpecificationGenerationError';
  }
}

export type SpecificationResponseKind = 'SELECTED' | 'NUMERIC' | 'CONSTRUCTED';
export interface SpecificationTemplate {
  id: string;
  version: string;
  purpose: string;
  appliesTo: { formats: ReadonlyArray<AdaptationSpecification['variable']['responseFormat']['format']> };
  responseKind: SpecificationResponseKind;
  constraints: { optionIds: readonly string[]; oneDefensibleAnswer: true; marksFromSpecification: true };
  /** The structural task, addressed to the provider. No subject matter. */
  task: string;
  fixedInstruction: Record<string, string>;
}

const COMMON = 'Everything the specification fixes is binding: the invariants (concept, construct, evidence target), every variable dimension (context, response format, reasoning depth, command term, stimulus, tool policy, numeric profile, mark structure, rubric style, language) and the parameter ranges. Declare the construct and the value of every parameter you used in declaredModel, and for every keyed answer state its target in the construct vocabulary. When the specification names a learning approach, serve the emphasis it records as honoured and do not act on a preference it records as unmet.';
export const TEMPLATE_SPEC_SELECTED_RESPONSE: SpecificationTemplate = {
  id: 'spec-selected-response', version: '1', purpose: 'One selected-response item written from an adaptation specification.', appliesTo: { formats: ['SELECTED_RESPONSE'] }, responseKind: 'SELECTED',
  constraints: { optionIds: OPTION_IDS, oneDefensibleAnswer: true, marksFromSpecification: true },
  task: `Write ONE selected-response item for the specification. Return the options with the ids given, exactly one of them correct, and for every wrong option the misconception model of the specification it comes from and why it is wrong. ${COMMON}`,
  fixedInstruction: { es: 'Selecciona la única opción correcta.', en: 'Choose the one correct option.' },
};
export const TEMPLATE_SPEC_NUMERIC_ENTRY: SpecificationTemplate = {
  id: 'spec-numeric-entry', version: '1', purpose: 'One item answered with a number the student writes, from an adaptation specification.', appliesTo: { formats: ['NUMERIC_ENTRY'] }, responseKind: 'NUMERIC',
  constraints: { optionIds: [], oneDefensibleAnswer: true, marksFromSpecification: true },
  task: `Write ONE item whose answer is a single number. Return a NUMERIC key: its canonical value (integer, decimal with a point, or fraction a/b), whether equivalent forms are accepted, and a number of decimal places ONLY if the stem asks for rounding. Return an answerCheck: the arithmetic expression that gives the key. ${COMMON}`,
  fixedInstruction: { es: 'Escribe tu respuesta como un número.', en: 'Write your answer as a number.' },
};
export const TEMPLATE_SPEC_CONSTRUCTED_RESPONSE: SpecificationTemplate = {
  id: 'spec-constructed-response', version: '1', purpose: 'One constructed-response item with parts, marks and a mark scheme, from an adaptation specification.', appliesTo: { formats: ['SHORT_RESPONSE', 'EXTENDED_RESPONSE'] }, responseKind: 'CONSTRUCTED',
  constraints: { optionIds: [], oneDefensibleAnswer: true, marksFromSpecification: true },
  task: `Write ONE constructed-response item: a stem and one or more parts labelled a, b, c in order. Use the command term the specification fixes, when it fixes one. Each part has its marks, a mark scheme of typed points (METHOD, ACCURACY, REASONING) whose marks sum to the part's marks, a final answer, a NUMERIC key when the final answer is one number, its target, and an answerCheck. totalMarks is the sum of the parts. Give the working outline a full-credit response follows. The mark-point names are neutral: do not imitate any examination board's notation. ${COMMON}`,
  fixedInstruction: { es: 'Muestra tu procedimiento.', en: 'Show your working.' },
};
export const SPECIFICATION_TEMPLATE_REGISTRY: readonly SpecificationTemplate[] = [TEMPLATE_SPEC_SELECTED_RESPONSE, TEMPLATE_SPEC_NUMERIC_ENTRY, TEMPLATE_SPEC_CONSTRUCTED_RESPONSE];

/** Exactly one template must serve the specification's elicitation format. None is a named error: a format is never approximated. */
export function selectSpecificationTemplate(registry: readonly SpecificationTemplate[], specification: AdaptationSpecification): SpecificationTemplate {
  const format = specification.variable.responseFormat.format;
  const fits = registry.filter((t) => t.appliesTo.formats.includes(format));
  if (fits.length !== 1) throw new SpecificationGenerationError('NO_TEMPLATE_FOR_SPECIFICATION', `${fits.length} templates fit ${format}`);
  return fits[0];
}

/** What the provider returns: the item's content and, when the specification gives the item a stimulus of its own, that stimulus. Strict. */
export const SpecificationResponseSchema = z.strictObject({ stimulus: ResponseStimulusSchema.nullable(), item: SpecificationItemContentSchema });
export type SpecificationResponse = z.infer<typeof SpecificationResponseSchema>;

export const SPECIFICATION_RESPONSE_SHAPE = {
  format: 'One JSON object and nothing else: { stimulus, item }. Every member listed is required; use null where a member does not apply. No other member is accepted.',
  stimulus: 'null, or { parts: [{ label, partKind: TEXT | SOURCE_NOTE, text }], structured: { v: 1, tables: [{ tableKey, title, columns: [{ key, label, type: TEXT | NUMBER, unit: string | null }], rows: [[cell per column]] }], dataSets: [{ dataSetKey, title, categories: string[] | null, series: [{ seriesKey, label, unit: string | null, values: number[] }] }], charts: [{ chartKey, chartType: BAR | LINE | SCATTER, title, xLabel, yLabel, source: { kind: TABLE, tableKey, xColumn: string | null, valueColumns: string[] } | { kind: DATA_SET, dataSetKey, xSeriesKey: string | null, seriesKeys: string[] } }], figures: [] } }. DATA FIRST: a chart references a table or data set and carries no numbers of its own.',
  item: '{ stem, context: { kind, description }, declaredModel: { construct, parameters: { symbol: number } }, selected, numeric, constructed, credit, rationale, usesStimulusValues: number[] | null, proposedSupportingConceptStableIds: string[] }',
  selected: 'null, or { options: [{ id, text }], answerKey: option id, distractors: { wrongOptionId: { misconceptionModelId, rationale } }, target, answerCheck }',
  numeric: 'null, or { numericKey: { kind: NUMERIC, value, equivalentFormsAllowed, decimalPlaces? }, target, answerCheck }',
  constructed: 'null, or { parts: [{ label, prompt, marks, markScheme: [{ kind: METHOD | ACCURACY | REASONING, marks, criterion }], finalAnswer, numericKey: null | { kind: NUMERIC, value, equivalentFormsAllowed, decimalPlaces? }, target, answerCheck }], totalMarks, workingOutline: string[] }',
  credit: 'null, or [{ code: FULL_CREDIT | PARTIAL_CREDIT | NO_CREDIT, description }] -- given exactly when the specification\'s rubricStyle is CODED_CREDIT_LEVELS',
  target: '{ kind: QUANTITY, quantity: a quantity code of the construct vocabulary } | { kind: VERDICT, verdict: a verdict code, value: one of its values } | { kind: COMPARISON, left: arithmetic expression, operator: > | < | >= | <= | =, right: arithmetic expression, holds: boolean, verdict: string | null } (numbers of the stimulus only) | { kind: NOT_MACHINE_CHECKABLE, reason }',
  answerCheck: '{ kind: ARITHMETIC_EXPRESSION, expression } (numbers, + - * / ^, parentheses, sqrt( ); decimal point) | { kind: NOT_COMPUTABLE, reason }',
  rules: [
    'Exactly one of selected, numeric, constructed is given: the one the template asks for. The other two are null.',
    'declaredModel.construct is the construct of the specification\'s invariants; declaredModel.parameters has exactly the parameter symbols of the construct vocabulary (plus an optional one only when the asked quantity needs it).',
    'Every parameter value lies inside the specification\'s parameterization ranges and respects its constraints and valid-solution rules.',
    'context.kind is the context kind the specification decided.',
    'A stimulus is given exactly when the specification\'s stimulus mode is not NONE, and only of the kinds it lists; then usesStimulusValues lists the stimulus numbers the item relies on.',
    'The stem does not repeat the fixed instruction and is written in the specification\'s language.',
    'Every declared parameter value is written in the item as digits, without thousands separators, exactly as declared (or, where the vocabulary says so, in the stimulus or as the coefficients of the stated equation).',
    'A keyed answer that is one number carries a numeric key and, when the construct vocabulary names that number, a QUANTITY target; a keyed answer that is a choice the construct decides carries a VERDICT target. NOT_MACHINE_CHECKABLE is for an answer no quantity or verdict of the vocabulary describes.',
    'Types are exact: numericKey.value is a STRING (an integer, a decimal with a point, or a fraction a/b); parameters, marks and usesStimulusValues are numbers; a part label is one lower-case letter; every reason has at least ten characters.',
    'With the mark structure MULTI_MARK_PARTS a constructed response has a total of at least two marks; with ONE_MARK_PER_ITEM or CODED_CREDIT the item is one scored unit.',
  ],
} as const;

export const SPECIFICATION_SYSTEM_TEXT = [
  'You write original assessment content for StudyUs.',
  'Every stem, option, table and figure is your own: do not copy or paraphrase any published exam question or any third-party text.',
  'You are given an ADAPTATION SPECIFICATION. It, and nothing else, says what to write: which task family the item is an instance of, the one primary concept and the construct that must be preserved, and how the assessment target asks for it.',
  'The item must require the primary concept and elicit every action of the evidence target.',
  'Return exactly the JSON object described in responseSchema and nothing else.',
].join(' ');

export interface SpecificationGenerationPrompt {
  v: typeof SPECIFICATION_PROMPT_VERSION;
  system: string;
  instruction: {
    task: string;
    harness: { id: string; version: string };
    template: { id: string; version: string; constraints: SpecificationTemplate['constraints']; fixedInstruction: string | null };
    policy: { id: string; version: string; language: string; copyReferenceExpression: false };
    unit: { unitKey: string; attempt: number };
    specification: {
      specificationId: string; contentUseClass: string; taskFamily: { familyId: string; version: string; familyType: string };
      systemProfile: { profileId: string; version: string }; componentProfile: { componentId: string; version: string; localSubject: string | null } | null; disciplinePolicy: { policyId: string; version: string };
      primaryConcept: AdaptationSpecification['primaryConcept']; targetSkills: string[]; invariants: AdaptationSpecification['invariants']; invariantHash: string; variable: AdaptationSpecification['variable']; parameterization: unknown;
      learningApproach?: { approachId: string; version: string; transversalCompetencies: Array<{ key: string; code: string; servedByFamily: boolean }>; participation: { mode: string; evidenceYield: string }; honouredPreferences: Array<{ preferenceId: string; dimension: string; decided: string }>; unmetPreferences: Array<{ preferenceId: string; dimension: string; decided: string }> };
    };
    constructVocabulary: { construct: string; parameters: readonly string[]; optionalParameters: readonly string[]; quantities: ConstructVocabulary['quantities']; verdicts: ConstructVocabulary['verdicts'] };
    responseSchema: { id: string; version: string; shape: typeof SPECIFICATION_RESPONSE_SHAPE };
  };
}

export interface SpecificationGenerationUnit { unitKey: string; specification: unknown; attempt: number }
export interface GenerateFromSpecificationInput {
  unit: SpecificationGenerationUnit;
  /** The vocabulary of the specification's construct, supplied by the discipline's own module (the harness knows no subject). */
  constructVocabulary: ConstructVocabulary | null;
  policy: unknown;
  provider: GenerationProvider;
  templateRegistry: readonly SpecificationTemplate[];
  runId: string;
  batchKey: string;
  /** ISO date-time of the run. Passed in: the harness reads no clock. */
  now: string;
}

interface Prepared { specification: AdaptationSpecification; template: SpecificationTemplate; policy: z.infer<typeof GenerationPolicySchema>; rendered: RenderedPrompt<SpecificationGenerationPrompt>; unitKey: string; attempt: number }

const constructOf = (s: AdaptationSpecification): string => String((s.invariants.construct as { construct?: unknown } | null)?.construct ?? '');

function prepare(input: Omit<GenerateFromSpecificationInput, 'runId' | 'batchKey' | 'now'>): Prepared {
  const issues = specificationIntegrityIssues(input.unit.specification);
  if (issues.length > 0) throw new SpecificationGenerationError('SPECIFICATION_INVALID', issues.join(','));
  const s = AdaptationSpecificationSchema.parse(input.unit.specification);
  // this path produces dev-test content only: an evidence-bearing specification is not generated here
  if (s.contentUseClass !== 'DEV_TEST_CONTENT') throw new SpecificationGenerationError('SPECIFICATION_IS_NOT_DEV_TEST_CONTENT', s.contentUseClass);
  if (!Number.isInteger(input.unit.attempt) || input.unit.attempt < 1 || input.unit.attempt > 9) throw new SpecificationGenerationError('ATTEMPT_INVALID', String(input.unit.attempt));
  const policyParsed = GenerationPolicySchema.safeParse(input.policy);
  if (!policyParsed.success) throw new SpecificationGenerationError('POLICY_INVALID', policyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const policy = policyParsed.data;
  if (policy.author.kind !== 'MODEL') throw new SpecificationGenerationError('POLICY_AUTHOR_IS_NOT_A_MODEL');
  if (policy.author.model !== input.provider.model) throw new SpecificationGenerationError('POLICY_MODEL_IS_NOT_THE_PROVIDERS', `${policy.author.model} / ${input.provider.model}`);
  if (policy.language !== s.variable.language) throw new SpecificationGenerationError('POLICY_LANGUAGE_IS_NOT_THE_SPECIFICATIONS', `${policy.language} / ${s.variable.language}`);
  const template = selectSpecificationTemplate(input.templateRegistry, s);
  const vocabulary = input.constructVocabulary;
  if (!vocabulary) throw new SpecificationGenerationError('CONSTRUCT_VOCABULARY_MISSING', constructOf(s));
  if (vocabulary.construct !== constructOf(s)) throw new SpecificationGenerationError('CONSTRUCT_VOCABULARY_IS_FOR_ANOTHER_CONSTRUCT', `${vocabulary.construct} / ${constructOf(s)}`);
  const la = s.learningApproach;
  const prompt: SpecificationGenerationPrompt = {
    v: SPECIFICATION_PROMPT_VERSION,
    system: SPECIFICATION_SYSTEM_TEXT,
    instruction: {
      task: template.task,
      harness: { ...SPECIFICATION_GENERATION_HARNESS },
      template: { id: template.id, version: template.version, constraints: template.constraints, fixedInstruction: template.fixedInstruction[policy.language] ?? null },
      policy: { id: policy.policyId, version: policy.policyVersion, language: policy.language, copyReferenceExpression: false },
      unit: { unitKey: input.unit.unitKey, attempt: input.unit.attempt },
      specification: {
        specificationId: s.specificationId, contentUseClass: s.contentUseClass, taskFamily: { familyId: s.taskFamily.familyId, version: s.taskFamily.version, familyType: s.taskFamily.familyType },
        systemProfile: { profileId: s.systemProfile.profileId, version: s.systemProfile.version }, componentProfile: s.componentProfile ? { componentId: s.componentProfile.componentId, version: s.componentProfile.version, localSubject: s.componentProfile.localSubject } : null,
        disciplinePolicy: { policyId: s.disciplinePolicy.policyId, version: s.disciplinePolicy.version }, primaryConcept: s.primaryConcept, targetSkills: s.targetSkills, invariants: s.invariants, invariantHash: s.invariantHash, variable: s.variable, parameterization: s.parameterization,
        // present only under a non-STANDARD approach: STANDARD is recorded by absence, in the prompt as in the specification
        ...(la ? { learningApproach: { approachId: la.approachId, version: la.version, transversalCompetencies: la.transversalCompetencies.map((c) => ({ key: c.key, code: c.code, servedByFamily: c.servedByFamily })), participation: la.participation, honouredPreferences: la.honouredPreferences.map((h) => ({ preferenceId: h.preferenceId, dimension: h.dimension, decided: h.decided })), unmetPreferences: la.unmetPreferences.map((u) => ({ preferenceId: u.preferenceId, dimension: u.dimension, decided: u.decided })) } } : {}),
      },
      constructVocabulary: { construct: vocabulary.construct, parameters: vocabulary.parameters, optionalParameters: vocabulary.optionalParameters, quantities: vocabulary.quantities, verdicts: vocabulary.verdicts },
      responseSchema: { id: SPECIFICATION_RESPONSE_SCHEMA.id, version: SPECIFICATION_RESPONSE_SCHEMA.version, shape: SPECIFICATION_RESPONSE_SHAPE },
    },
  };
  return { specification: s, template, policy, rendered: { prompt, promptHash: sha256OfCanonicalJson(prompt) }, unitKey: input.unit.unitKey, attempt: input.unit.attempt };
}

/** The prompt a specification renders to, and its hash, without calling any provider. Deterministic. */
export function renderSpecificationPrompt(input: Omit<GenerateFromSpecificationInput, 'runId' | 'batchKey' | 'now'>): RenderedPrompt<SpecificationGenerationPrompt> & { template: { id: string; version: string } } {
  const p = prepare(input);
  return { ...p.rendered, template: { id: p.template.id, version: p.template.version } };
}

/** Text -> validated response, or a named error. Nothing is trimmed into shape or defaulted. */
export function parseSpecificationResponse(rawText: string): SpecificationResponse {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new SpecificationGenerationError('PROVIDER_RESPONSE_NOT_JSON');
  }
  const parsed = SpecificationResponseSchema.safeParse(json);
  if (!parsed.success) throw new SpecificationGenerationError('PROVIDER_RESPONSE_SCHEMA_INVALID', parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return parsed.data;
}

const STIMULUS_KIND_OF = (s: NonNullable<SpecificationResponse['stimulus']>['structured']): StimulusKind | null => (!s ? null : s.charts.length > 0 ? 'GRAPH' : s.tables.length > 0 ? 'TABLE' : s.dataSets.length > 0 ? 'DATA_SET' : null);

/** Does the response have the STRUCTURE the template and the specification ask for? Every misfit is a named error. Content is not judged here. */
function fit(response: SpecificationResponse, p: Prepared): StimulusKind | null {
  const item: SpecificationItemContent = response.item;
  const kind = p.template.responseKind;
  const given = { SELECTED: item.selected !== null, NUMERIC: item.numeric !== null, CONSTRUCTED: item.constructed !== null };
  if (!given[kind] || Object.values(given).filter(Boolean).length !== 1) throw new SpecificationGenerationError('RESPONSE_MEMBER_IS_NOT_THE_FORMATS', `${p.template.id}: ${JSON.stringify(given)}`);
  if (item.selected) {
    const ids = p.template.constraints.optionIds;
    if (item.selected.options.length !== ids.length || item.selected.options.some((o, i) => o.id !== ids[i])) throw new SpecificationGenerationError('RESPONSE_OPTIONS_DO_NOT_FIT_TEMPLATE');
    if (!ids.includes(item.selected.answerKey)) throw new SpecificationGenerationError('RESPONSE_KEY_IS_NOT_AN_OPTION', item.selected.answerKey);
    const wrong = ids.filter((id) => id !== item.selected!.answerKey).sort();
    if (Object.keys(item.selected.distractors).sort().join(',') !== wrong.join(',')) throw new SpecificationGenerationError('RESPONSE_DISTRACTORS_DO_NOT_COVER_THE_WRONG_OPTIONS', Object.keys(item.selected.distractors).sort().join(','));
  }
  const fixed = p.template.fixedInstruction[p.policy.language];
  if (fixed && (item.stem.includes(fixed) || (item.constructed?.parts.some((x) => x.prompt.includes(fixed)) ?? false))) throw new SpecificationGenerationError('RESPONSE_REPEATS_FIXED_INSTRUCTION');
  const wanted = p.specification.variable.stimulus;
  if (wanted.mode === 'NONE') {
    if (response.stimulus !== null) throw new SpecificationGenerationError('RESPONSE_UNEXPECTED_STIMULUS');
    return null;
  }
  if (response.stimulus === null) throw new SpecificationGenerationError('RESPONSE_STIMULUS_MISSING');
  const stimulusKind = STIMULUS_KIND_OF(response.stimulus.structured);
  if (stimulusKind === null) throw new SpecificationGenerationError('RESPONSE_STIMULUS_HAS_NO_STRUCTURED_DATA');
  if (!wanted.kinds.includes(stimulusKind)) throw new SpecificationGenerationError('RESPONSE_STIMULUS_KIND_NOT_IN_SPECIFICATION', `${stimulusKind} not in ${wanted.kinds.join('/')}`);
  const violations = structuredStimulusViolations(stimulusKind, response.stimulus.structured);
  if (violations.length > 0) throw new SpecificationGenerationError('RESPONSE_STRUCTURED_STIMULUS_INVALID', violations.join(','));
  return stimulusKind;
}

export interface SpecificationUnitResult { candidate: SpecificationCandidate; stimulus: CandidateStimulus | null; promptHash: string }

/** Runs ONE specification through the provider and returns its candidate, with complete lineage. */
export async function generateFromSpecification(input: GenerateFromSpecificationInput): Promise<SpecificationUnitResult> {
  const p = prepare(input);
  const answer = await input.provider.generate(p.rendered);
  if (answer.promptHash !== p.rendered.promptHash) throw new SpecificationGenerationError('PROVIDER_ANSWERED_ANOTHER_PROMPT', answer.promptHash);
  const response = parseSpecificationResponse(answer.rawText);
  const stimulusKind = fit(response, p);
  const s = p.specification;
  const language = p.policy.language;
  let stimulus: CandidateStimulus | null = null;
  if (response.stimulus && stimulusKind) {
    const st = response.stimulus.structured!;
    // every table, data set and chart also exists as text, derived from the structured data
    const derived = [
      ...st.tables.map((t) => ({ label: t.tableKey, partKind: 'TABLE' as const, text: tableAsText(t, language) })),
      ...st.dataSets.map((d) => ({ label: d.dataSetKey, partKind: 'DATA_SET' as const, text: dataSetAsText(d, language) })),
      ...st.charts.map((c) => ({ label: c.chartKey, partKind: 'GRAPH' as const, text: altText(c, language, st) })),
    ];
    stimulus = { stimulusKey: `stim|${p.unitKey}`, kind: stimulusKind, language, parts: [...response.stimulus.parts, ...derived], provenance: 'STUDYUS_GENERATED', stimulusPlanId: null, generationUnitKey: p.unitKey, structured: st, renderedAssets: renderStructuredAssets(st, language) };
  }
  const author = p.policy.author as Extract<typeof p.policy.author, { kind: 'MODEL' }>;
  const item = response.item;
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
      generationRequest: { promptHash: p.rendered.promptHash, template: { id: p.template.id, version: p.template.version }, policy: { id: p.policy.policyId, version: p.policy.policyVersion }, harness: { ...SPECIFICATION_GENERATION_HARNESS }, responseSchema: { ...SPECIFICATION_RESPONSE_SCHEMA }, unitKey: p.unitKey, attempt: p.attempt, requestedBy: author.requestedBy },
      generationRun: { runId: input.runId, provider: input.provider.id, model: input.provider.model, generatedAt: input.now },
    },
  };
  return { candidate: SpecificationCandidateSchema.parse(candidate), stimulus, promptHash: p.rendered.promptHash };
}

/** The results of the units of ONE run as one batch, failures included. The harness hands back only what the contract accepts. */
export function assembleSpecificationBatch(p: { batchKey: string; now: string; runId: string; provider: { id: string; model: string }; generationPolicy: { id: string; version: string }; results: readonly SpecificationUnitResult[]; failures: readonly SpecificationGenerationFailure[] }): SpecificationBatch {
  if (p.results.some((r) => r.candidate.batchKey !== p.batchKey || r.candidate.lineage.generationRun.runId !== p.runId || r.candidate.lineage.generationRun.model !== p.provider.model)) throw new SpecificationGenerationError('BATCH_INPUT_INVALID', 'a candidate of another batch, run or model');
  return SpecificationBatchSchema.parse({
    v: SPECIFICATION_CANDIDATE_VERSION, kind: 'SPECIFICATION_DRIVEN_GENERATION_BATCH', label: 'EPHEMERAL -- NOT INGESTED -- DEV_TEST_CONTENT', batchKey: p.batchKey, generatedAt: p.now,
    run: { runId: p.runId, provider: p.provider.id, model: p.provider.model, generationPolicy: p.generationPolicy },
    stimuli: p.results.flatMap((r) => (r.stimulus ? [r.stimulus] : [])), candidates: p.results.map((r) => r.candidate), failures: [...p.failures],
  });
}
