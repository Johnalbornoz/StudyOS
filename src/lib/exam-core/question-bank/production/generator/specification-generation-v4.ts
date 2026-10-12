/**
 * POST-CANARY -- specification-driven generation, VERSION 4 (pure, no IO). FOR FUTURE RUNS: nothing has been
 * generated with it. Versions 1, 2 and 3 are untouched beside it: they are what QB-R2D, QB-R2E and the Canary were
 * recorded against, and those replays must not move.
 *
 * Version 4 is version 3 with three changes, each from the Canary's evidence:
 *   L  THE LEAK RULE no longer refuses an ordinary word. Version 3 refused any multi-letter symbol of the construct
 *      found in learner text; three constructs have symbols that are ordinary words ("result", "verdict",
 *      "categories"), and 6 of the Canary's 8 leak refusals were of those words used as words. In version 4 a symbol
 *      that is a plain word of five letters or more is a leak only where it is used AS AN IDENTIFIER (followed by
 *      "=" or ":" and a value, or quoted as a code). Symbols with a digit or of fewer than five letters (r1, vi, xv)
 *      and code words (UPPER_SNAKE, action names) are refused as before.
 *   D  DEMAND: a unit may carry a `demand` block (the difficulty and paper-fidelity profile, version 2). It is part
 *      of the prompt when present; absent, the prompt has no such member.
 *   G  TYPED SLOT GUIDANCE: a unit may carry `slotGuidance`, each pinned value with the ROLE it must play. Part of
 *      the prompt when present (version 3 had no place for it; the Canary had to add it outside the harness).
 */
import { AdaptationSpecificationSchema, specificationIntegrityIssues, type AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { ITEM_DEMAND_POLICY } from '@/lib/assessment-adaptation/item-demand-policy';
import { GenerationPolicySchema, type CandidateStimulus } from '../generation-contract';
import type { ConstructVocabulary } from '../math-construct-registry';
import type { StimulusKind } from '../requirement-cell';
import { OPTION_IDS, SPECIFICATION_CANDIDATE_VERSION, SpecificationCandidateSchema, type SpecificationCandidate, type SpecificationItemContent } from '../specification-candidate';
import { altText, dataSetAsText, renderStructuredAssets, structuredStimulusViolations, tableAsText, type StructuredStimulus } from '../stimulus-spec';
import { sha256OfCanonicalJson, type GenerationProvider, type RenderedPrompt } from './provider';
import { normalizeWireResponse, parseSpecificationWireResponse, SPECIFICATION_RESPONSE_RULES_V2, SPECIFICATION_RESPONSE_SCHEMA_V2, SpecificationGenerationV2Error, type SpecificationWireResponse } from './specification-generation-v2';

export const SPECIFICATION_GENERATION_HARNESS_V4 = { id: 'studyus-specification-generation-harness', version: '4' } as const;
export const SPECIFICATION_PROMPT_VERSION_V4 = 4 as const;

export const SPECIFICATION_GENERATION_V4_ERROR_CODES = [
  'SPECIFICATION_INVALID', 'SPECIFICATION_IS_NOT_DEV_TEST_CONTENT', 'SPECIFICATION_HAS_NO_MARKS', 'POLICY_INVALID', 'POLICY_AUTHOR_IS_NOT_A_MODEL', 'POLICY_MODEL_IS_NOT_THE_PROVIDERS', 'POLICY_LANGUAGE_IS_NOT_THE_SPECIFICATIONS',
  'NO_TEMPLATE_FOR_SPECIFICATION', 'CONSTRUCT_VOCABULARY_MISSING', 'CONSTRUCT_VOCABULARY_IS_FOR_ANOTHER_CONSTRUCT', 'ATTEMPT_INVALID',
  'PROVIDER_ANSWERED_ANOTHER_PROMPT', 'PROVIDER_RESPONSE_NOT_JSON', 'PROVIDER_RESPONSE_SCHEMA_INVALID', 'RESPONSE_WIRE_INCONSISTENT', 'RESPONSE_CONTENT_INVALID',
  'RESPONSE_DUPLICATE_PART_LABEL', 'RESPONSE_PART_LABELS_NOT_IN_ORDER', 'RESPONSE_PART_WITHOUT_MARKS_OR_PROMPT',
  'RESPONSE_KIND_IS_NOT_THE_FORMATS', 'RESPONSE_OPTIONS_DO_NOT_FIT_TEMPLATE', 'RESPONSE_KEY_IS_NOT_AN_OPTION', 'RESPONSE_DISTRACTORS_DO_NOT_COVER_THE_WRONG_OPTIONS',
  'RESPONSE_STIMULUS_MISSING', 'RESPONSE_UNEXPECTED_STIMULUS', 'RESPONSE_STIMULUS_HAS_NO_STRUCTURED_DATA', 'RESPONSE_STIMULUS_KIND_NOT_IN_SPECIFICATION', 'RESPONSE_STRUCTURED_STIMULUS_INVALID',
  'RESPONSE_MARKS_OUTSIDE_SPECIFICATION', 'RESPONSE_COMMAND_TERM_NOT_IN_SPECIFICATION', 'RESPONSE_QUANTITY_TARGET_WITHOUT_A_NUMERIC_VALUE', 'RESPONSE_LEAKS_SPECIFICATION_VOCABULARY',
] as const;
export type SpecificationGenerationV4ErrorCode = (typeof SPECIFICATION_GENERATION_V4_ERROR_CODES)[number];
export class SpecificationGenerationV4Error extends Error {
  constructor(public readonly code: SpecificationGenerationV4ErrorCode, public readonly detail: string = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'SpecificationGenerationV4Error';
  }
}
/** Version 2's parser and normaliser are reused; their refusals keep their names. */
function underV4<T>(f: () => T): T {
  try { return f(); } catch (e) {
    if (e instanceof SpecificationGenerationV2Error && (SPECIFICATION_GENERATION_V4_ERROR_CODES as readonly string[]).includes(e.code)) throw new SpecificationGenerationV4Error(e.code as SpecificationGenerationV4ErrorCode, e.detail);
    throw e;
  }
}

export interface SpecificationTemplateV4 {
  id: string;
  version: '4';
  purpose: string;
  appliesTo: { formats: ReadonlyArray<AdaptationSpecification['variable']['responseFormat']['format']> };
  responseKind: 'SELECTED' | 'NUMERIC' | 'CONSTRUCTED';
  constraints: { optionIds: readonly string[]; oneDefensibleAnswer: true; fixedInstruction: 'NONE' };
  task: string;
}
export const DEMAND_AND_GUIDANCE_RULES_V4 = [
  'DEMAND. When the instruction has a demand member, the item must MEET it: at least demand.minimumReasoningSteps distinct steps of working that the mark scheme rewards one by one; the non-routine element demand.nonRoutineElement when one is named, present in the task and rewarded by a REASONING mark point; number types, representation changes and distractor design as demand states. An item that is correct but below the demand is a failed item.',
  'SLOT GUIDANCE. When the instruction has a slotGuidance member, every entry of slotGuidance.pinned is used exactly, as the value of the quantity its role describes and of nothing else; slotGuidance.display, when present, describes the DISPLAY (how many categories it has, what verdict it must give) and is never a quantity of the situation. Nothing of slotGuidance is quoted or named in the item.',
] as const;
export const ITEM_WRITING_RULES_V4 = [
  'LEARNER TEXT. The stem, the prompts of the parts, the options and the stimulus are read by a learner. They never contain a word of the specification: no parameter symbol or variable symbol of the construct, no quantity or verdict code, no name of an evidence action in capitals, no word such as construct, parameter set, misconception, free measure or specification. Symbols a learner needs are introduced in the item itself, in the item\'s own letters.',
  'A REAL QUESTION. The stem asks about the SITUATION -- how much, which one, whether, what it means. It never asks which option "presents", "indicates", "describes", "expresses", "formulates", "compares" or "interprets" something "correctly", never asks for "the correct decision / comparison / option", and never says "which option correctly ...". In Spanish the same holds for "presenta / indica / describe / expresa / califica ... correctamente" and "la decisión / comparación / opción correcta".',
  'PLAUSIBLE SITUATION. A context that is not ABSTRACT is a situation a person could meet, of the kind the specification describes in variable.context.situation, with named things, units and magnitudes that are realistic for them. A situation that is only a relabelled abstraction (a quantity, a measure, an effect, a category, units of a product) is not a context.',
  'NOTHING HANDED OVER. The item never states what constructIntegrity lists: the learner must produce it.',
  'A STIMULUS IS THERE TO BE READ. When the item has a stimulus, its text introduces the data and nothing more: it never states a rate, a starting value, a total, a change, a percentage or a conclusion that the learner is meant to obtain from the table or the graph. What the question needs is ONLY in the data.',
  'NEW NUMBERS. No parameter value pair of the sets in avoid.parameterSets is reused, and no set is reused whole. Choose values that have not appeared.',
  'A NEW SCENARIO. The situation is not one of avoid.scenarios nor a variation of one (the same kind of place, object and decision with other names).',
  'EVERY ACTION OF THE EVIDENCE TARGET IS ASKED FOR. evidenceGuidance says, for each action of the specification\'s evidence target, what in the item must ask for it. An action that nothing asks for is a defect.',
] as const;
/** What asks for each action. Structure only: no subject matter. */
export const EVIDENCE_GUIDANCE_V4: Readonly<Record<string, string>> = {
  RECALL: 'A question whose answer is a fact or a definition of the concept.',
  COMPUTE: 'A question whose answer is a number the construct determines: key it as a QUANTITY of the vocabulary with its numericValue.',
  SOLVE: 'A question whose answer is the unknown of the construct: key it as a QUANTITY of the vocabulary with its numericValue, or -- for a decision the construct makes -- as its VERDICT.',
  REPRESENT: 'A question that asks for an equation, an expression or a representation, which the learner writes.',
  FORMULATE: 'The situation gives the quantities in words and the learner must set up the relationship: nothing in the item writes it for them. In a constructed response a part asks for the relationship itself, and a mark point names it.',
  INTERPRET: 'A question that asks what a quantity or a result MEANS in the situation, or asks for a decision read from the result, in words of the situation. When the vocabulary has a verdict for that decision, key it as that VERDICT.',
  EVALUATE: 'A question that asks whether a statement holds, or which of the situation\'s options is better, and why. When the vocabulary has a verdict for it, key it as that VERDICT.',
  JUSTIFY: 'A part of its own that asks for the argument, with REASONING points.',
};
const COMMON_V4 = 'Everything the specification fixes is binding: the invariants (concept, construct, evidence target), every variable dimension and the parameter ranges with their constraints and valid-solution rules. State the construct, the value of every parameter you used, and for every keyed answer its target in the construct vocabulary. A closed answer (selected or numeric) is keyed as a QUANTITY or a VERDICT of the vocabulary whenever the vocabulary names what is asked; NOT_MACHINE_CHECKABLE is only for an answer no code of the vocabulary describes. When the specification names a learning approach, serve what it records as honoured and do not act on a preference it records as unmet. The item demand policy in demandPolicy is binding.';
export const TEMPLATE_V4_SELECTED: SpecificationTemplateV4 = {
  id: 'spec-selected-response', version: '4', purpose: 'One selected-response item written from an adaptation specification.', appliesTo: { formats: ['SELECTED_RESPONSE'] }, responseKind: 'SELECTED',
  constraints: { optionIds: OPTION_IDS, oneDefensibleAnswer: true, fixedInstruction: 'NONE' },
  task: `Write ONE selected-response item. The stem asks for ONE RESULT or ONE DECISION about the situation. Each option states that one thing and nothing else -- one value, or one choice -- so that the options are PARALLEL: the same kind, the same form, similar length. No option shows working, a calculation, an equals sign that is not part of the answer itself, or a reason; no option combines two results. The key must not be the only option of its form or length. Exactly one option is correct; every wrong option is the result one misconception model of the specification produces. responseKind is SELECTED, and answers has exactly one entry labelled item. ${COMMON_V4}`,
};
export const TEMPLATE_V4_NUMERIC: SpecificationTemplateV4 = {
  id: 'spec-numeric-entry', version: '4', purpose: 'One item answered with a number the student writes, from an adaptation specification.', appliesTo: { formats: ['NUMERIC_ENTRY'] }, responseKind: 'NUMERIC',
  constraints: { optionIds: [], oneDefensibleAnswer: true, fixedInstruction: 'NONE' },
  task: `Write ONE item whose answer is a single number. The stem asks its question and may state the unit and the rounding of the answer; how an answer is typed is not the item's to say. responseKind is NUMERIC, options and distractors are empty, and answers has exactly one entry labelled item with numericValue (an integer, a decimal with a point, or a fraction a/b), decimalPlaces only if the stem asks for rounding, a QUANTITY target and arithmeticExpression: the arithmetic that gives the number. ${COMMON_V4}`,
};
export const TEMPLATE_V4_CONSTRUCTED: SpecificationTemplateV4 = {
  id: 'spec-constructed-response', version: '4', purpose: 'One constructed-response item with parts, marks and a mark scheme, from an adaptation specification.', appliesTo: { formats: ['SHORT_RESPONSE', 'EXTENDED_RESPONSE'] }, responseKind: 'CONSTRUCTED',
  constraints: { optionIds: [], oneDefensibleAnswer: true, fixedInstruction: 'NONE' },
  task: `Write ONE constructed-response item: a stem that sets the situation and asks nothing by itself (the parts are NOT repeated in the stem), and parts. PARTS: answers has ONE ENTRY PER PART, labelled a, b, c in order, each label used once. A part asks ONE thing and has ONE answer: two numbers are two parts, never one part with two answers and never two entries with one label. Every entry has a prompt and at least one mark. MARKS: the total and the number of parts lie inside specification.variable.marks; each part has mark points of the kinds marks.markPointKinds whose marks sum to the part's marks, and -- by the demand policy -- every mark point carries exactly one mark, so a part of k marks has k mark points and needs k creditable steps. COMMAND TERMS: when the specification has variable.commandTerms, every part uses exactly ONE term of commandTerms.allowed -- the one that fits what that part asks (byEvidenceAction says which terms suit which action); the part's prompt begins with it and commandTerm states it; at least one part uses commandTerms.lead; no term outside the list is used and none is forced onto a part it does not fit. Without commandTerms, commandTerm is null. A part whose answer is one number gives numericValue and, when the vocabulary names that number, a QUANTITY target. A part that asks for an interpretation, a justification or an expression is a part of its own, with a NOT_MACHINE_CHECKABLE target and a reason. MARK POINTS follow the reasoning depth and rubric style: when working is shown, at least one METHOD point; when a justification is required, a part that asks for it with REASONING points; under a method-and-accuracy rubric, at least one ACCURACY point. The working outline has one line per METHOD or REASONING point. Mark-point names are neutral: do not imitate any examination board's notation. ${COMMON_V4}`,
};
export const SPECIFICATION_TEMPLATE_REGISTRY_V4: readonly SpecificationTemplateV4[] = [TEMPLATE_V4_SELECTED, TEMPLATE_V4_NUMERIC, TEMPLATE_V4_CONSTRUCTED];
export function selectSpecificationTemplateV4(registry: readonly SpecificationTemplateV4[], specification: AdaptationSpecification): SpecificationTemplateV4 {
  const fits = registry.filter((t) => t.appliesTo.formats.includes(specification.variable.responseFormat.format));
  if (fits.length !== 1) throw new SpecificationGenerationV4Error('NO_TEMPLATE_FOR_SPECIFICATION', `${fits.length} templates fit ${specification.variable.responseFormat.format}`);
  return fits[0];
}
/** Version 2's response rules, without the sentence about a fixed instruction (there is none), plus the rule on parts. */
export const SPECIFICATION_RESPONSE_RULES_V4: readonly string[] = [...SPECIFICATION_RESPONSE_RULES_V2.filter((r) => !/fixed instruction/.test(r)), 'The item is written in the specification\'s language.', 'answers: one entry labelled item for a selected or numeric response; for a constructed response one entry per part, labelled a, b, c ... in order, no label twice, each with a prompt and at least one mark.'];

export const SPECIFICATION_SYSTEM_TEXT_V4 = [
  'You write original assessment content for StudyUs.',
  'Every stem, option, table and figure is your own: do not copy or paraphrase any published exam question or any third-party text.',
  'You are given an ADAPTATION SPECIFICATION. It, and nothing else, says what to write: which task family the item is an instance of, the one primary concept and the construct that must be preserved, and how the assessment target asks for it.',
  'The item must require the primary concept and elicit every action of the evidence target.',
  'Write it as a careful human item writer would for that target: a real question about a real situation, natural wording, no trace of these instructions.',
  'Return exactly the JSON object of the response schema.',
].join(' ');

export interface AvoidLists { parameterSets: ReadonlyArray<Readonly<Record<string, number>>>; scenarios: readonly string[] }
export interface SpecificationGenerationPromptV4 {
  v: typeof SPECIFICATION_PROMPT_VERSION_V4;
  system: string;
  instruction: {
    task: string;
    itemWritingRules: readonly string[];
    harness: { id: string; version: string };
    template: { id: string; version: string; constraints: SpecificationTemplateV4['constraints'] };
    policy: { id: string; version: string; language: string; copyReferenceExpression: false };
    unit: { unitKey: string; attempt: number };
    specification: Record<string, unknown>;
    constructVocabulary: { construct: string; parameters: readonly string[]; optionalParameters: readonly string[]; quantities: ConstructVocabulary['quantities']; verdicts: ConstructVocabulary['verdicts'] };
    constructIntegrity: readonly string[];
    evidenceGuidance: Record<string, string>;
    demandPolicy: { id: string; version: string; authority: string; maximumMarksPerMarkPoint: number; multiMarkPartNeedsAMethodOrReasoningPoint: boolean; workingOutlineHasALinePerMethodPoint: boolean; minimumTotalMarks: number | null; demand: string };
    avoid: AvoidLists;
    demand?: Readonly<Record<string, unknown>>;
    slotGuidance?: Readonly<Record<string, unknown>>;
    responseSchema: { id: string; version: string; rules: readonly string[] };
  };
}
export interface SpecificationGenerationUnitV4 { unitKey: string; specification: unknown; attempt: number; avoid: AvoidLists; /** The demand block of the difficulty and paper-fidelity profile; absent = none. */ demand?: Readonly<Record<string, unknown>>; /** Typed slot guidance: each pinned value with its role; absent = none. */ slotGuidance?: Readonly<Record<string, unknown>> }
export interface GenerateFromSpecificationV4Input {
  unit: SpecificationGenerationUnitV4;
  constructVocabulary: ConstructVocabulary | null;
  constructIntegrity: readonly string[];
  policy: unknown;
  provider: GenerationProvider;
  templateRegistry: readonly SpecificationTemplateV4[];
  runId: string;
  batchKey: string;
  now: string;
}
interface PreparedV4 { specification: AdaptationSpecification; template: SpecificationTemplateV4; language: string; requestedBy: string; policyRef: { id: string; version: string }; rendered: RenderedPrompt<SpecificationGenerationPromptV4>; unitKey: string; attempt: number; vocabulary: ConstructVocabulary }
const constructOf = (s: AdaptationSpecification): string => String((s.invariants.construct as { construct?: unknown } | null)?.construct ?? '');

function prepare(input: Omit<GenerateFromSpecificationV4Input, 'runId' | 'batchKey' | 'now'>): PreparedV4 {
  const refuse = (code: SpecificationGenerationV4ErrorCode, detail = ''): never => { throw new SpecificationGenerationV4Error(code, detail); };
  const issues = specificationIntegrityIssues(input.unit.specification);
  if (issues.length > 0) refuse('SPECIFICATION_INVALID', issues.join(','));
  const s = AdaptationSpecificationSchema.parse(input.unit.specification);
  if (s.contentUseClass !== 'DEV_TEST_CONTENT') refuse('SPECIFICATION_IS_NOT_DEV_TEST_CONTENT', s.contentUseClass);
  if (!s.variable.marks) refuse('SPECIFICATION_HAS_NO_MARKS', s.specificationId);
  if (!Number.isInteger(input.unit.attempt) || input.unit.attempt < 1 || input.unit.attempt > 2) refuse('ATTEMPT_INVALID', String(input.unit.attempt));
  const policyParsed = GenerationPolicySchema.safeParse(input.policy);
  if (!policyParsed.success) return refuse('POLICY_INVALID', policyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const policy = policyParsed.data;
  if (policy.author.kind !== 'MODEL') return refuse('POLICY_AUTHOR_IS_NOT_A_MODEL');
  if (policy.author.model !== input.provider.model) refuse('POLICY_MODEL_IS_NOT_THE_PROVIDERS', `${policy.author.model} / ${input.provider.model}`);
  if (policy.language !== s.variable.language) refuse('POLICY_LANGUAGE_IS_NOT_THE_SPECIFICATIONS', `${policy.language} / ${s.variable.language}`);
  const template = selectSpecificationTemplateV4(input.templateRegistry, s);
  const vocabulary = input.constructVocabulary;
  if (!vocabulary) return refuse('CONSTRUCT_VOCABULARY_MISSING', constructOf(s));
  if (vocabulary.construct !== constructOf(s)) refuse('CONSTRUCT_VOCABULARY_IS_FOR_ANOTHER_CONSTRUCT', `${vocabulary.construct} / ${constructOf(s)}`);
  const la = s.learningApproach;
  const actions = s.invariants.evidenceTarget.actions as readonly string[];
  const constructed = template.responseKind === 'CONSTRUCTED';
  const prompt: SpecificationGenerationPromptV4 = {
    v: SPECIFICATION_PROMPT_VERSION_V4,
    system: SPECIFICATION_SYSTEM_TEXT_V4,
    instruction: {
      task: template.task,
      itemWritingRules: [...ITEM_WRITING_RULES_V4, ...(input.unit.demand ? [DEMAND_AND_GUIDANCE_RULES_V4[0]] : []), ...(input.unit.slotGuidance ? [DEMAND_AND_GUIDANCE_RULES_V4[1]] : [])],
      harness: { ...SPECIFICATION_GENERATION_HARNESS_V4 },
      template: { id: template.id, version: template.version, constraints: template.constraints },
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
      evidenceGuidance: Object.fromEntries(actions.map((a) => [a, EVIDENCE_GUIDANCE_V4[a] ?? 'A question that asks for this action explicitly.'])),
      demandPolicy: {
        id: ITEM_DEMAND_POLICY.policyId, version: ITEM_DEMAND_POLICY.version, authority: ITEM_DEMAND_POLICY.authority, maximumMarksPerMarkPoint: ITEM_DEMAND_POLICY.maximumMarksPerMarkPoint, multiMarkPartNeedsAMethodOrReasoningPoint: ITEM_DEMAND_POLICY.multiMarkPartNeedsAMethodOrReasoningPoint, workingOutlineHasALinePerMethodPoint: ITEM_DEMAND_POLICY.workingOutlineHasALinePerMethodPoint,
        minimumTotalMarks: constructed ? actions.length + ITEM_DEMAND_POLICY.minimumTotalMarksOverEvidenceActions : null, demand: ITEM_DEMAND_POLICY.demandByReasoningDepth[s.variable.reasoningDepth.depth],
      },
      avoid: { parameterSets: [...input.unit.avoid.parameterSets], scenarios: [...input.unit.avoid.scenarios] },
      ...(input.unit.demand ? { demand: input.unit.demand } : {}),
      ...(input.unit.slotGuidance ? { slotGuidance: input.unit.slotGuidance } : {}),
      responseSchema: { id: SPECIFICATION_RESPONSE_SCHEMA_V2.id, version: SPECIFICATION_RESPONSE_SCHEMA_V2.version, rules: SPECIFICATION_RESPONSE_RULES_V4 },
    },
  };
  return { specification: s, template, language: policy.language, requestedBy: policy.author.requestedBy, policyRef: { id: policy.policyId, version: policy.policyVersion }, rendered: { prompt, promptHash: sha256OfCanonicalJson(prompt) }, unitKey: input.unit.unitKey, attempt: input.unit.attempt, vocabulary };
}
export function renderSpecificationPromptV4(input: Omit<GenerateFromSpecificationV4Input, 'runId' | 'batchKey' | 'now'>): RenderedPrompt<SpecificationGenerationPromptV4> & { template: { id: string; version: string } } {
  const p = prepare(input);
  return { ...p.rendered, template: { id: p.template.id, version: p.template.version } };
}

/** The checks on the provider's parts that come BEFORE anything else is read: each label once, in order, each a real part. */
export function partLabelRefusal(wire: SpecificationWireResponse): { code: SpecificationGenerationV4ErrorCode; detail: string } | null {
  if (wire.item.responseKind !== 'CONSTRUCTED') return null;
  const labels = wire.item.answers.map((a) => a.label);
  const twice = labels.filter((l, i) => labels.indexOf(l) !== i);
  if (twice.length > 0) return { code: 'RESPONSE_DUPLICATE_PART_LABEL', detail: [...new Set(twice)].join(',') };
  if (labels.some((l, i) => l !== 'abcdefgh'[i])) return { code: 'RESPONSE_PART_LABELS_NOT_IN_ORDER', detail: labels.join(',') };
  const empty = wire.item.answers.filter((a) => a.prompt === null || a.prompt.trim().length === 0 || a.marks < 1);
  return empty.length > 0 ? { code: 'RESPONSE_PART_WITHOUT_MARKS_OR_PROMPT', detail: empty.map((a) => a.label).join(',') } : null;
}

const CODE_WORDS = /(?<![\p{L}_])(FORMULATE|SOLVE|INTERPRET|COMPUTE|EVALUATE|REPRESENT|JUSTIFY|RECALL|SUPPORTED|CONTRADICTED|NOT_DECIDABLE|OPTION_[12]|[A-Z]{2,}(?:_[A-Z0-9]+)+)(?![\p{L}_])/u;
/** A symbol that is a plain word (letters only, five or more) is ordinary language unless it is used as an identifier. */
export const isOrdinaryWordSymbol = (symbol: string): boolean => /^[\p{L}]{5,}$/u.test(symbol);
export const LEAK_RULE_V4 = { id: 'studyus-learner-text-leak-rule', version: '4', rule: 'Refused in learner text: a code word (an evidence action or verdict code in capitals, an UPPER_SNAKE identifier); a construct symbol with a digit or of fewer than five letters, as a whole token; a construct symbol that is a plain word of five letters or more ONLY where it is used as an identifier -- followed by "=" or ":" and a value, or written inside backticks or as a quoted single token.' } as const;
export function leakedVocabularyV4(text: string, symbols: readonly string[]): string[] {
  const out: string[] = [];
  const code = CODE_WORDS.exec(text);
  if (code) out.push(code[1]);
  for (const symbol of new Set(symbols)) {
    if (!/^[\p{L}][\p{L}\d]+$/u.test(symbol)) continue;
    const token = `(?<![\\p{L}\\d_])${symbol}(?![\\p{L}\\d_])`;
    if (isOrdinaryWordSymbol(symbol)) { if (new RegExp(`${token}\\s*[=:]\\s*[-\\d"'A-Z]|\`${symbol}\`|["'«]${symbol}["'»]`, 'u').test(text)) out.push(symbol); }
    else if (new RegExp(token, 'u').test(text)) out.push(symbol);
  }
  return out;
}
function leakedVocabulary(text: string, vocabulary: ConstructVocabulary, specification: AdaptationSpecification): string[] {
  const constructSymbols = ((specification.invariants.construct as { variables?: Array<{ symbol?: unknown }> } | null)?.variables ?? []).map((v) => String(v.symbol ?? ''));
  return leakedVocabularyV4(text, [...vocabulary.parameters, ...vocabulary.optionalParameters, ...constructSymbols]);
}
const kindOfStimulus = (s: StructuredStimulus): StimulusKind | null => (s.charts.length > 0 ? 'GRAPH' : s.tables.length > 0 ? 'TABLE' : s.dataSets.length > 0 ? 'DATA_SET' : null);

function fit(item: SpecificationItemContent, stimulus: ReturnType<typeof normalizeWireResponse>['stimulus'], p: PreparedV4): StimulusKind | null {
  const refuse = (code: SpecificationGenerationV4ErrorCode, detail = ''): never => { throw new SpecificationGenerationV4Error(code, detail); };
  const given = { SELECTED: item.selected !== null, NUMERIC: item.numeric !== null, CONSTRUCTED: item.constructed !== null };
  if (!given[p.template.responseKind]) refuse('RESPONSE_KIND_IS_NOT_THE_FORMATS', `${p.template.id}: ${JSON.stringify(given)}`);
  if (item.selected) {
    const ids = p.template.constraints.optionIds;
    if (item.selected.options.length !== ids.length || item.selected.options.some((o, i) => o.id !== ids[i])) refuse('RESPONSE_OPTIONS_DO_NOT_FIT_TEMPLATE');
    if (!ids.includes(item.selected.answerKey)) refuse('RESPONSE_KEY_IS_NOT_AN_OPTION', item.selected.answerKey);
    const wrong = ids.filter((id) => id !== item.selected!.answerKey).sort();
    if (Object.keys(item.selected.distractors).sort().join(',') !== wrong.join(',')) refuse('RESPONSE_DISTRACTORS_DO_NOT_COVER_THE_WRONG_OPTIONS', Object.keys(item.selected.distractors).sort().join(','));
  }
  const marks = p.specification.variable.marks!;
  const total = item.constructed ? item.constructed.totalMarks : 1;
  if (total < marks.total.min || total > marks.total.max) refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', `total ${total} not in [${marks.total.min}, ${marks.total.max}]`);
  if (item.constructed) {
    if (marks.scoredAs !== 'MARKED_PARTS') refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', `a constructed response of marked parts under ${marks.scoredAs}`);
    const n = item.constructed.parts.length;
    if (marks.parts && (n < marks.parts.min || n > marks.parts.max)) refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', `${n} parts not in [${marks.parts.min}, ${marks.parts.max}]`);
    const foreign = item.constructed.parts.flatMap((x) => x.markScheme).filter((m) => !(marks.markPointKinds as string[]).includes(m.kind));
    if (foreign.length > 0) refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', `mark point kind ${foreign[0].kind}`);
    const terms = p.specification.variable.commandTerms;
    for (const part of item.constructed.parts) if (terms ? !part.commandTerm || !terms.allowed.includes(part.commandTerm) : part.commandTerm !== null && part.commandTerm !== undefined) refuse('RESPONSE_COMMAND_TERM_NOT_IN_SPECIFICATION', `${part.label}: ${part.commandTerm ?? 'none'}`);
  } else if (marks.scoredAs === 'MARKED_PARTS') refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', 'a closed response under MARKED_PARTS');
  if ((item.credit !== null) !== marks.creditLevels) refuse('RESPONSE_MARKS_OUTSIDE_SPECIFICATION', `credit levels ${item.credit !== null ? 'given' : 'missing'}; the specification says ${marks.creditLevels}`);
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

export interface SpecificationUnitResultV4 { candidate: SpecificationCandidate; stimulus: CandidateStimulus | null; promptHash: string }
export async function generateFromSpecificationV4(input: GenerateFromSpecificationV4Input): Promise<SpecificationUnitResultV4> {
  const p = prepare(input);
  const answer = await input.provider.generate(p.rendered);
  if (answer.promptHash !== p.rendered.promptHash) throw new SpecificationGenerationV4Error('PROVIDER_ANSWERED_ANOTHER_PROMPT', answer.promptHash);
  const wire = underV4(() => parseSpecificationWireResponse(answer.rawText));
  const labels = partLabelRefusal(wire);
  if (labels) throw new SpecificationGenerationV4Error(labels.code, labels.detail);
  const { item, stimulus: wireStimulus } = underV4(() => normalizeWireResponse(wire));
  const stimulusKind = fit(item, wireStimulus, p);
  const s = p.specification;
  const language = p.language;
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
  const candidate: SpecificationCandidate = {
    v: SPECIFICATION_CANDIDATE_VERSION, candidateKey: `cand|${p.unitKey}`, unitKey: p.unitKey, batchKey: input.batchKey, specificationId: s.specificationId, primaryConceptStableId: s.primaryConcept.stableId, language,
    responseFormat: s.variable.responseFormat.format, difficultyBand: s.variable.difficulty.band, marks: item.constructed ? item.constructed.totalMarks : 1,
    // this path has no fixed instruction: how a response is entered is the delivery surface's to say
    instruction: null,
    stimulusKey: stimulus ? stimulus.stimulusKey : null, content: item, contentUseClass: 'DEV_TEST_CONTENT', provenance: 'STUDYUS_GENERATED',
    lineage: {
      kind: 'MODEL', primaryConcept: s.primaryConcept, taskFamily: { id: s.taskFamily.familyId, version: s.taskFamily.version },
      learningApproach: s.learningApproach ? { recordedAs: 'EXPLICIT', id: s.learningApproach.approachId, version: s.learningApproach.version } : { recordedAs: 'STANDARD_BY_ABSENCE' },
      systemProfile: { id: s.systemProfile.profileId, version: s.systemProfile.version },
      componentProfile: s.componentProfile ? { id: s.componentProfile.componentId, version: s.componentProfile.version, versionBinding: s.componentProfile.versionBinding } : null,
      systemVersionBinding: s.systemProfile.versionBinding ?? null,
      disciplinePolicy: { id: s.disciplinePolicy.policyId, version: s.disciplinePolicy.version },
      adaptationSpecification: { id: s.specificationId, invariantHash: s.invariantHash }, contentUseClass: 'DEV_TEST_CONTENT',
      generationRequest: { promptHash: p.rendered.promptHash, template: { id: p.template.id, version: p.template.version }, policy: p.policyRef, harness: { ...SPECIFICATION_GENERATION_HARNESS_V4 }, responseSchema: { ...SPECIFICATION_RESPONSE_SCHEMA_V2 }, unitKey: p.unitKey, attempt: p.attempt, requestedBy: p.requestedBy },
      generationRun: { runId: input.runId, provider: input.provider.id, model: input.provider.model, generatedAt: input.now },
    },
  };
  return { candidate: SpecificationCandidateSchema.parse(candidate), stimulus, promptHash: p.rendered.promptHash };
}
