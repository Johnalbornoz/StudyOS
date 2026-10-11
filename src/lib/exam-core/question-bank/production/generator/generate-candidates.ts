/**
 * QB-R2C -- the repeatable generation harness (pure, no IO).
 *
 *   GenerationUnit + cells + Reference Intelligence Pack v2 + GenerationPolicy
 *     -> template (by format and stimulus) -> provider-neutral PROMPT + promptHash
 *     -> GenerationProvider.generate(prompt) -> strict parse of the response -> GenerationBatch with LINEAGE
 *
 * REPEATABLE means: the same unit, cells, packs, policy, template, provider answer, run id and `now` give the
 * same batch, byte for byte. There is no clock and no randomness in here: `now` is passed in.
 *
 * The harness asks the provider for CONTENT and takes everything else from the plan: a candidate's cell,
 * PRIMARY concept, band, format, language, marks and stimulus plan come from the cell and the unit, never from
 * the response. A response that does not fit the unit and the template is refused by name and not repaired.
 *
 * EA-1 -- ADAPTATION SPECIFICATIONS (optional). A slot may be given the specification an adaptation produced for
 * it (`adaptationSpecifications`, by slot key). The harness then checks that it is intact and is for that slot,
 * puts its generation-relevant content into the prompt -- so it is part of the prompt hash -- and records its
 * identity on the candidate's lineage. When none is given the prompt, the hash and the batch are exactly what
 * they were before: the member is absent, not empty. A specification is never created, completed or relaxed here.
 *
 * What the harness does NOT do: judge the content. Answer correctness, concept fidelity, stimulus integrity and
 * originality are checked by the independent validators, which this directory must not import.
 */
import { AdaptationSpecificationSchema, specificationIntegrityIssues, type AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { generationReadyPackIssues, REFERENCE_PACK_V2_VERSION, type ConceptProfile, type ReferenceIntelligencePackV2 } from '../concept-profile';
import { GENERATION_CONTRACT_VERSION, GenerationBatchSchema, GenerationPolicySchema, type CandidateStimulus, type GenerationBatch, type QuestionCandidate } from '../generation-contract';
import { isBound, type RequirementCell } from '../requirement-cell';
import { altText, dataSetAsText, renderStructuredAssets, structuredStimulusViolations, tableAsText } from '../stimulus-spec';
import { GenerationUnitSchema, slotsOfUnit, type GenerationUnit } from '../stimulus-plan';
import { GenerationError, sha256OfCanonicalJson, type GenerationProvider, type RenderedPrompt } from './provider';
import { GENERATION_RESPONSE_SCHEMA, parseGenerationResponse, RESPONSE_SHAPE_DESCRIPTION, type GenerationResponse } from './response-schema';
import { selectTemplate, templateSelectionKeyOf, type GenerationTemplate } from './templates';

export const GENERATION_HARNESS = { id: 'studyus-generation-harness', version: '1' } as const;
export const GENERATION_PROMPT_VERSION = 1 as const;

/** Fixed for every prompt. Structure and conduct only; no subject matter. */
export const GENERATION_SYSTEM_TEXT = [
  'You write original assessment content for StudyUs.',
  'Every stem, option, passage, poem, table and figure is your own: do not copy or paraphrase any published exam question or any third-party text.',
  'References are given so that you understand the concept. Their wording is never carried into an item (copyReferenceExpression is false).',
  'Each question is written for the ONE primary concept of its slot and must require that concept to be answered.',
  'Return exactly the JSON object described in responseSchema and nothing else.',
].join(' ');

export interface GenerationPrompt {
  v: typeof GENERATION_PROMPT_VERSION;
  system: string;
  instruction: {
    task: string;
    harness: { id: string; version: string };
    template: { id: string; version: string; constraints: GenerationTemplate['constraints']; fixedInstruction: Record<string, string> };
    policy: { id: string; version: string; language: string; copyReferenceExpression: false };
    unit: { unitKey: string; type: 'STANDALONE' | 'STIMULUS'; stimulus: null | { stimulusPlanId: string | null; kind: string; language: string; questionCount: number; integrity: unknown } };
    slots: Array<{ slotKey: string; cellKey: string; examFamily: string; sectionCode: string; domainNodeCode: string; topicNodeCode: string; topicLabel: string | null; primaryConcept: RequirementCell['primaryConcept']; responseFormat: string; difficultyBand: string; difficultyBasis: string }>;
    conceptProfiles: ConceptProfile[];
    references: { sources: Array<{ sourceKey: string; sourceType: string; title: string; permittedUse: string }>; facts: Array<{ kind: string; statement: string }> };
    responseSchema: { id: string; version: string; shape: typeof RESPONSE_SHAPE_DESCRIPTION };
    /** EA-1. Present ONLY when a slot was given an adaptation specification; absent otherwise, so earlier prompts hash as before. */
    adaptation?: Array<{ slotKey: string; specificationId: string; contentUseClass: string; taskFamily: { familyId: string; version: string }; systemProfile: { profileId: string; version: string }; componentProfile: { componentId: string; version: string } | null; disciplinePolicy: { policyId: string; version: string }; invariants: AdaptationSpecification['invariants']; invariantHash: string; variable: AdaptationSpecification['variable']; parameterization: unknown }>;
  };
}

export interface GenerateCandidatesInput {
  unit: GenerationUnit;
  /** The cells of the unit's slots (more may be given; they are looked up by key). */
  cells: readonly RequirementCell[];
  /** One generation-ready pack per PRIMARY concept of the unit, keyed by the concept's stable id. */
  packs: Readonly<Record<string, ReferenceIntelligencePackV2>>;
  policy: unknown;
  provider: GenerationProvider;
  templateRegistry: readonly GenerationTemplate[];
  runId: string;
  batchKey: string;
  /** ISO date-time of the run. Passed in: the harness reads no clock. */
  now: string;
  options?: {
    /** Binding attaches an environment's row ids and needs a database. A planning run may generate for unbound cells by saying so. */
    allowUnboundCells?: boolean;
    /** A standalone question on a cell whose stimulus is OPTIONAL is given a stimulus of its own. */
    attachOptionalStimulus?: boolean;
  };
  /** Human-readable labels for codes, supplied by the exam's own module (the harness knows no exam). */
  labels?: { topics?: Readonly<Record<string, string>> };
  /** EA-1: the adaptation specification of a slot, by slot key. Optional; a slot without one is generated as before. */
  adaptationSpecifications?: Readonly<Record<string, unknown>>;
}

interface Prepared { unit: GenerationUnit; cells: RequirementCell[]; template: GenerationTemplate; policy: ReturnType<typeof GenerationPolicySchema.parse>; rendered: RenderedPrompt<GenerationPrompt>; ownStimulusKind: string | null; adaptation: ReadonlyMap<string, AdaptationSpecification> }

/**
 * The specifications given for the unit's slots, checked. Each must be intact (its id and invariant hash are the
 * ones its content gives) and must agree with everything the plan already fixed for the slot: exam family (of the
 * specification's system profile), the
 * PRIMARY concept with its canonical subject, format, band, pool, language and cell. A disagreement is refused:
 * the plan is never bent to a specification, nor a specification to the plan.
 */
function adaptationOf(input: GenerateCandidatesInput, unit: GenerationUnit, cells: readonly RequirementCell[], language: string): Map<string, AdaptationSpecification> {
  const out = new Map<string, AdaptationSpecification>();
  const given = input.adaptationSpecifications;
  if (!given) return out;
  const slots = slotsOfUnit(unit);
  for (const key of Object.keys(given).sort()) {
    const i = slots.findIndex((s) => s.slotKey === key);
    if (i < 0) throw new GenerationError('ADAPTATION_SPECIFICATION_NOT_FOR_THE_SLOT', `${key}: not a slot of ${unit.unitKey}`);
    const issues = specificationIntegrityIssues(given[key]);
    if (issues.length > 0) throw new GenerationError('ADAPTATION_SPECIFICATION_INVALID', `${key}: ${issues.join(',')}`);
    const spec = AdaptationSpecificationSchema.parse(given[key]);
    const cell = cells[i];
    const misfit =
      spec.systemProfile.examFamilyCode !== cell.examFamily ? 'EXAM_FAMILY'
      : spec.primaryConcept.stableId !== cell.primaryConcept.stableId || spec.primaryConcept.canonicalSubject !== cell.primaryConcept.canonicalSubject ? 'PRIMARY_CONCEPT'
      : spec.variable.responseFormat.productionFormat !== cell.responseFormat ? 'RESPONSE_FORMAT'
      : spec.variable.difficulty.band !== cell.difficultyBand ? 'DIFFICULTY_BAND'
      : spec.purpose.pool !== cell.intendedPool ? 'POOL'
      : spec.variable.language !== language ? 'LANGUAGE'
      : spec.blueprintRequirement !== null && spec.blueprintRequirement.requirementCellKey !== cell.cellKey ? 'REQUIREMENT_CELL'
      : null;
    if (misfit) throw new GenerationError('ADAPTATION_SPECIFICATION_NOT_FOR_THE_SLOT', `${key}: ${misfit}`);
    out.set(key, spec);
  }
  return out;
}

function prepare(input: GenerateCandidatesInput): Prepared {
  const unitParsed = GenerationUnitSchema.safeParse(input.unit);
  if (!unitParsed.success) throw new GenerationError('UNIT_INVALID', unitParsed.error.issues.map((i) => i.message).join('; '));
  const unit = unitParsed.data;
  const policyParsed = GenerationPolicySchema.safeParse(input.policy);
  if (!policyParsed.success) throw new GenerationError('POLICY_INVALID', policyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const policy = policyParsed.data;
  if (policy.author.kind !== 'MODEL') throw new GenerationError('POLICY_AUTHOR_IS_NOT_A_MODEL');
  if (policy.author.model !== input.provider.model) throw new GenerationError('POLICY_MODEL_IS_NOT_THE_PROVIDERS', `${policy.author.model} / ${input.provider.model}`);
  if (unit.type === 'STIMULUS' && unit.plan.language !== policy.language) throw new GenerationError('POLICY_LANGUAGE_IS_NOT_THE_UNITS', `${policy.language} / ${unit.plan.language}`);
  const byKey = new Map(input.cells.map((c) => [c.cellKey, c]));
  const cells = slotsOfUnit(unit).map((s) => {
    const cell = byKey.get(s.cellKey);
    if (!cell) throw new GenerationError('UNKNOWN_CELL', s.cellKey);
    if (s.index > cell.count) throw new GenerationError('SLOT_OUT_OF_RANGE', s.slotKey);
    if (!isBound(cell) && !input.options?.allowUnboundCells) throw new GenerationError('CELL_NOT_BOUND', s.cellKey);
    const issues = generationReadyPackIssues(input.packs[cell.primaryConcept.stableId], cell);
    if (issues.length > 0) throw new GenerationError('PACK_NOT_GENERATION_READY', `${cell.primaryConcept.stableId}: ${issues.join(',')}`);
    return cell;
  });
  const key = templateSelectionKeyOf(unit, cells, input.options?.attachOptionalStimulus === true);
  const template = selectTemplate(input.templateRegistry, key);
  const concepts = [...new Set(cells.map((c) => c.primaryConcept.stableId))].sort();
  const packs = concepts.map((id) => input.packs[id]);
  const sources = new Map(packs.flatMap((p) => p.sources).map((s) => [s.sourceKey, { sourceKey: s.sourceKey, sourceType: s.sourceType, title: s.title, permittedUse: s.permittedUse }]));
  const facts = new Map(packs.flatMap((p) => p.facts).map((f) => [`${f.kind}|${f.statement}`, { kind: f.kind, statement: f.statement }]));
  const slots = slotsOfUnit(unit);
  const adaptation = adaptationOf(input, unit, cells, policy.language);
  const prompt: GenerationPrompt = {
    v: GENERATION_PROMPT_VERSION,
    system: GENERATION_SYSTEM_TEXT,
    instruction: {
      task: template.task,
      harness: { ...GENERATION_HARNESS },
      template: { id: template.id, version: template.version, constraints: template.constraints, fixedInstruction: template.fixedInstruction[policy.language] ?? {} },
      policy: { id: policy.policyId, version: policy.policyVersion, language: policy.language, copyReferenceExpression: false },
      unit: { unitKey: unit.unitKey, type: unit.type, stimulus: unit.type === 'STIMULUS' ? { stimulusPlanId: unit.plan.stimulusPlanId, kind: unit.plan.stimulusKind, language: unit.plan.language, questionCount: unit.plan.questionCount, integrity: unit.plan.integrity } : key.ownStimulus ? { stimulusPlanId: null, kind: key.stimulusKind!, language: policy.language, questionCount: 1, integrity: { rule: 'WHOLE' } } : null },
      slots: slots.map((s, i) => ({ slotKey: s.slotKey, cellKey: s.cellKey, examFamily: cells[i].examFamily, sectionCode: cells[i].sectionCode, domainNodeCode: cells[i].domainNodeCode, topicNodeCode: cells[i].topicNodeCode, topicLabel: input.labels?.topics?.[cells[i].topicNodeCode] ?? null, primaryConcept: cells[i].primaryConcept, responseFormat: cells[i].responseFormat, difficultyBand: cells[i].difficultyBand, difficultyBasis: cells[i].difficultyBasis })),
      conceptProfiles: packs.map((p) => p.conceptProfile),
      references: { sources: [...sources.values()].sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1)), facts: [...facts.values()] },
      responseSchema: { id: GENERATION_RESPONSE_SCHEMA.id, version: GENERATION_RESPONSE_SCHEMA.version, shape: RESPONSE_SHAPE_DESCRIPTION },
      // the member exists only when a specification was given: a prompt without one is byte-identical to what it was
      ...(adaptation.size > 0 ? { adaptation: slots.filter((s) => adaptation.has(s.slotKey)).map((s) => {
        const a = adaptation.get(s.slotKey)!;
        return { slotKey: s.slotKey, specificationId: a.specificationId, contentUseClass: a.contentUseClass, taskFamily: { familyId: a.taskFamily.familyId, version: a.taskFamily.version }, systemProfile: { profileId: a.systemProfile.profileId, version: a.systemProfile.version }, componentProfile: a.componentProfile ? { componentId: a.componentProfile.componentId, version: a.componentProfile.version } : null, disciplinePolicy: { policyId: a.disciplinePolicy.policyId, version: a.disciplinePolicy.version }, invariants: a.invariants, invariantHash: a.invariantHash, variable: a.variable, parameterization: a.parameterization };
      }) } : {}),
    },
  };
  return { unit, cells, template, policy, rendered: { prompt, promptHash: sha256OfCanonicalJson(prompt) }, ownStimulusKind: key.ownStimulus ? key.stimulusKind : null, adaptation };
}

/** The prompt a unit renders to, and its hash, without calling any provider. Deterministic. */
export function renderGenerationPrompt(input: Omit<GenerateCandidatesInput, 'runId' | 'batchKey' | 'now'>): RenderedPrompt<GenerationPrompt> & { template: { id: string; version: string } } {
  const p = prepare({ ...input, runId: 'render', batchKey: 'render', now: '1970-01-01T00:00:00Z' });
  return { ...p.rendered, template: { id: p.template.id, version: p.template.version } };
}

/** Does the response fit the unit and the template? Every misfit is a named error; nothing is repaired. */
function fit(response: GenerationResponse, p: Prepared): void {
  const slots = slotsOfUnit(p.unit);
  const got = response.items.map((i) => i.slotKey);
  if (got.length !== slots.length || new Set(got).size !== got.length || slots.some((s) => !got.includes(s.slotKey))) throw new GenerationError('RESPONSE_SLOTS_DO_NOT_MATCH_UNIT', `${got.join(', ')}`);
  const c = p.template.constraints;
  if (c.stimulus === 'REQUIRED' && response.stimulus === null) throw new GenerationError('RESPONSE_STIMULUS_MISSING');
  if (c.stimulus === 'NONE' && response.stimulus !== null) throw new GenerationError('RESPONSE_UNEXPECTED_STIMULUS');
  if (response.stimulus) {
    const kind = (p.unit.type === 'STIMULUS' ? p.unit.plan.stimulusKind : p.ownStimulusKind) as Parameters<typeof structuredStimulusViolations>[0];
    const st = response.stimulus;
    if ((c.textParts === 'REQUIRED' && st.parts.length === 0) || (c.textParts === 'NONE' && st.parts.length > 0) || (c.structured === 'NONE' && st.structured !== null) || (c.structured === 'REQUIRED' && st.structured === null)) throw new GenerationError('RESPONSE_STIMULUS_HAS_NO_CONTENT', `parts ${st.parts.length}, structured ${st.structured !== null}`);
    const violations = structuredStimulusViolations(kind, st.structured);
    if (violations.length > 0) throw new GenerationError('RESPONSE_STRUCTURED_STIMULUS_INVALID', violations.join(','));
  }
  const fixed = Object.values(p.template.fixedInstruction[p.policy.language] ?? {});
  response.items.forEach((item) => {
    const cell = p.cells[slots.findIndex((s) => s.slotKey === item.slotKey)];
    if (fixed.some((f) => item.stem.includes(f))) throw new GenerationError('RESPONSE_REPEATS_FIXED_INSTRUCTION', item.slotKey);
    if (cell.responseFormat === 'MULTIPLE_CHOICE') {
      if (item.numericKey !== null) throw new GenerationError('RESPONSE_FORMAT_IS_NOT_THE_SLOTS', `${item.slotKey}: numeric key on a multiple-choice slot`);
      if (item.options.length !== c.optionIds.length || item.options.some((o, i) => o.id !== c.optionIds[i])) throw new GenerationError('RESPONSE_OPTIONS_DO_NOT_FIT_TEMPLATE', item.slotKey);
      if (!c.optionIds.includes(item.answerKey)) throw new GenerationError('RESPONSE_KEY_IS_NOT_AN_OPTION', item.slotKey);
    } else {
      if (item.options.length > 0 || Object.keys(item.distractorRationales).length > 0) throw new GenerationError('RESPONSE_FORMAT_IS_NOT_THE_SLOTS', `${item.slotKey}: options on a student-produced slot`);
      if (item.numericKey === null || item.numericKey.value !== item.answerKey) throw new GenerationError('RESPONSE_NUMERIC_KEY_MISSING', item.slotKey);
    }
  });
}

/** Runs one generation unit through the provider and returns its batch, with lineage on every candidate. */
export async function generateCandidates(input: GenerateCandidatesInput): Promise<GenerationBatch> {
  const p = prepare(input);
  const answer = await input.provider.generate(p.rendered);
  if (answer.promptHash !== p.rendered.promptHash) throw new GenerationError('PROVIDER_ANSWERED_ANOTHER_PROMPT', answer.promptHash);
  const response = parseGenerationResponse(answer.rawText);
  fit(response, p);
  const language = p.policy.language;
  const slots = slotsOfUnit(p.unit);
  const stimulusPlanId = p.unit.type === 'STIMULUS' ? p.unit.plan.stimulusPlanId : null;
  let stimulus: CandidateStimulus | null = null;
  if (response.stimulus) {
    const st = response.stimulus;
    const s = st.structured;
    // derived parts: every table, data set, chart and figure also exists as text, made from the structured data
    const derived = s ? [
      ...s.tables.map((t) => ({ label: t.tableKey, partKind: 'TABLE' as const, text: tableAsText(t, language) })),
      ...s.dataSets.map((d) => ({ label: d.dataSetKey, partKind: 'DATA_SET' as const, text: dataSetAsText(d, language) })),
      ...s.charts.map((c) => ({ label: c.chartKey, partKind: 'GRAPH' as const, text: altText(c, language, s) })),
      ...s.figures.map((f) => ({ label: f.figureKey, partKind: 'FIGURE' as const, text: altText(f, language) })),
    ] : [];
    stimulus = {
      stimulusKey: `stim|${p.unit.unitKey}`, kind: (p.unit.type === 'STIMULUS' ? p.unit.plan.stimulusKind : p.ownStimulusKind) as CandidateStimulus['kind'], language, parts: [...st.parts, ...derived], provenance: 'STUDYUS_GENERATED',
      stimulusPlanId, generationUnitKey: p.unit.unitKey, ...(s ? { structured: s, renderedAssets: renderStructuredAssets(s, language) } : {}),
    };
  }
  const author = p.policy.author as Extract<typeof p.policy.author, { kind: 'MODEL' }>;
  const candidates: QuestionCandidate[] = slots.map((slot, i) => {
    const item = response.items.find((x) => x.slotKey === slot.slotKey)!;
    const cell = p.cells[i];
    const pack = input.packs[cell.primaryConcept.stableId];
    const adapted = p.adaptation.get(slot.slotKey);
    return {
      v: GENERATION_CONTRACT_VERSION, candidateKey: `cand|${slot.slotKey}`, cellKey: cell.cellKey, batchKey: input.batchKey, stem: item.stem, responseFormat: cell.responseFormat, options: item.options, answerKey: item.answerKey, rationale: item.rationale,
      distractorRationales: item.distractorRationales, primaryConceptStableId: cell.primaryConcept.stableId, proposedSupportingConceptStableIds: item.proposedSupportingConceptStableIds, difficultyBand: cell.difficultyBand, marks: 1, language,
      stimulusKey: stimulus ? stimulus.stimulusKey : null, assets: [], provenance: 'STUDYUS_GENERATED',
      lineage: {
        kind: 'MODEL', model: input.provider.model, promptVersion: `${p.template.id}@${p.template.version}`, runId: input.runId, requestedBy: author.requestedBy, generatedAt: input.now, humanEdits: [],
        provider: input.provider.id, generationPolicy: { id: p.policy.policyId, version: p.policy.policyVersion }, template: { id: p.template.id, version: p.template.version }, promptHash: p.rendered.promptHash, generationUnitKey: p.unit.unitKey, requirementCellKey: cell.cellKey,
        referencePack: { version: REFERENCE_PACK_V2_VERSION, conceptProfileVersion: pack.conceptProfile.v, conceptProfilePackVersion: pack.conceptProfile.packVersion },
        ...(adapted ? { adaptation: { taskFamily: { id: adapted.taskFamily.familyId, version: adapted.taskFamily.version }, systemProfile: { id: adapted.systemProfile.profileId, version: adapted.systemProfile.version }, componentProfile: adapted.componentProfile ? { id: adapted.componentProfile.componentId, version: adapted.componentProfile.version } : null, disciplinePolicy: { id: adapted.disciplinePolicy.policyId, version: adapted.disciplinePolicy.version }, adaptationSpecificationId: adapted.specificationId, invariantHash: adapted.invariantHash, contentUseClass: adapted.contentUseClass, generationRunId: input.runId } } : {}),
      },
      instruction: p.template.fixedInstruction[language]?.[cell.responseFormat] ?? null, slotKey: slot.slotKey, stimulusPlanId,
      ...(item.answerCheck ? { answerCheck: item.answerCheck } : {}), ...(item.numericKey ? { numericKey: item.numericKey } : {}), ...(item.usesStimulusValues ? { usesStimulusValues: item.usesStimulusValues } : {}),
    };
  });
  const batch: GenerationBatch = {
    v: GENERATION_CONTRACT_VERSION, batchKey: input.batchKey, generatedAt: input.now, stimuli: stimulus ? [stimulus] : [], candidates,
    lineage: { runId: input.runId, provider: input.provider.id, model: input.provider.model, generationPolicy: { id: p.policy.policyId, version: p.policy.policyVersion }, generatedAt: input.now, units: [{ generationUnitKey: p.unit.unitKey, template: { id: p.template.id, version: p.template.version }, promptHash: p.rendered.promptHash, candidates: candidates.length }] },
  };
  // the harness hands back only what the contract accepts
  return GenerationBatchSchema.parse(batch);
}

/** The unit batches of ONE run as one batch. Batches of different runs, providers or policies are not merged. */
export function mergeGenerationBatches(batches: readonly GenerationBatch[]): GenerationBatch {
  const first = batches[0];
  if (!first?.lineage) throw new GenerationError('BATCHES_NOT_OF_ONE_RUN', 'no batch, or a batch without lineage');
  const same = (b: GenerationBatch) => b.batchKey === first.batchKey && b.generatedAt === first.generatedAt && !!b.lineage && b.lineage.runId === first.lineage!.runId && b.lineage.provider === first.lineage!.provider && b.lineage.model === first.lineage!.model && b.lineage.generationPolicy.id === first.lineage!.generationPolicy.id && b.lineage.generationPolicy.version === first.lineage!.generationPolicy.version;
  if (!batches.every(same)) throw new GenerationError('BATCHES_NOT_OF_ONE_RUN');
  return GenerationBatchSchema.parse({ ...first, stimuli: batches.flatMap((b) => b.stimuli), candidates: batches.flatMap((b) => b.candidates), lineage: { ...first.lineage, units: batches.flatMap((b) => b.lineage!.units) } });
}
