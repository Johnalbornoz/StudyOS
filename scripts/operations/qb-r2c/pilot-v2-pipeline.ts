/**
 * QB-R2C -- Pilot Generation v2: the PURE pipeline (no file, no database, no network).
 *
 *   pilot units (real units of `buildPaaGenerationPlan()`)
 *     -> repeatable harness (template -> prompt -> promptHash -> provider -> strict parse -> lineage)
 *     -> ALL independent validators -> rights gate -> human review packages -> projection
 *
 * WHAT THIS PILOT IS, HONESTLY. No live provider may be called in this phase, so the provider is a
 * `RecordedResponseProvider`: every response was AUTHORED IN-SESSION by the model working on the phase
 * (`claude-opus-5-5`), stored in `recorded-responses.json` keyed by the hash of the prompt it answers, and is
 * REPLAYED here. That shows the harness is repeatable and the contracts hold on realistic content. It is NOT
 * evidence that a live provider returns well-formed responses, follows the templates, or writes items of this
 * quality: that needs a live run.
 *
 * `pilot-v2-run.ts` does the file IO around `runPilotV2`. A test runs this pipeline in-process and compares
 * its output with the stored files byte for byte.
 */
import { PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';
import { toReferencePackV1 } from '@/lib/exam-core/question-bank/production/concept-profile';
import { generateCandidates, mergeGenerationBatches, renderGenerationPrompt, type GenerateCandidatesInput } from '@/lib/exam-core/question-bank/production/generator/generate-candidates';
import { RecordedResponseProvider, canonicalJson } from '@/lib/exam-core/question-bank/production/generator/provider';
import { DEFAULT_TEMPLATE_REGISTRY } from '@/lib/exam-core/question-bank/production/generator/templates';
import type { GenerationBatch, QuestionCandidate } from '@/lib/exam-core/question-bank/production/generation-contract';
import { AUTOMATED_VALIDATION, validateAnswerCorrectness, validateAnswerNormalizationRoundTrip, validateConceptFidelity, validateLineageCompleteness, validateOriginality, validatePoolIntegrity, validateResponseFormat, validateStimulusIntegrity } from '@/lib/exam-core/question-bank/production/independent-validators';
import type { ComparisonEntry } from '@/lib/exam-core/question-bank/production/originality-gate';
import { paaCellViolations } from '@/lib/exam-core/question-bank/production/paa-backlog';
import { resolvePaaRequirementCells } from '@/lib/exam-core/question-bank/production/paa-cells';
import { paaConceptProfileOf, paaGenerationReadyPack, PAA_CONCEPT_PROFILE_COVERAGE } from '@/lib/exam-core/question-bank/production/paa-concept-profiles';
import { buildPaaGenerationPlan, paaLanguageOf } from '@/lib/exam-core/question-bank/production/paa-generation-plan';
import { projectPilotEligibility } from '@/lib/exam-core/question-bank/production/pilot-projection';
import type { RequirementCell } from '@/lib/exam-core/question-bank/production/requirement-cell';
import { buildHumanReviewPackage } from '@/lib/exam-core/question-bank/production/review-package';
import { evaluateRightsGate } from '@/lib/exam-core/question-bank/production/rights-gate';
import { slotsOfUnit, stimulusPlansOf, type GenerationUnit, type StimulusPlan } from '@/lib/exam-core/question-bank/production/stimulus-plan';
import { validateCandidateStructure } from '@/lib/exam-core/question-bank/production/structural-validation';
import { siblingCorpus, validateQuestionCandidate } from '@/lib/exam-core/question-bank/production/validated-candidate';

export const PILOT_V2_DIR = 'docs/exams/question-bank/pilots/qb-r2c';
export const PILOT_V2_FILES = { recording: 'recorded-responses.json', batch: 'pilot-v2-batch.json', report: 'pilot-v2-automated-report.json', packages: 'pilot-v2-review-packages.json' } as const;
export const PILOT_V2_PROVIDER = { id: 'recorded:in-session-authoring', model: 'claude-opus-5-5' } as const;
export const PILOT_V2_RUN = { runId: 'qb-r2c-pilot-v2-run-1', batchKey: 'qb-r2c-pilot-v2', now: '2026-10-11T12:00:00Z' } as const;
export const PILOT_V2_POLICY = { id: 'qb-r2c-pilot-generation', version: '1' } as const;
/** The section whose answers arithmetic decides: its candidates must carry a machine-checkable answer check. */
const PAA_MATHEMATICS_SECTION = 'paa.sec.matematicas';

/**
 * The pilot's generation units: real units of the PAA generation plan, by key. A stimulus unit is a WHOLE
 * stimulus plan, in one pool. Redacción has ten questions rather than eight: its stimulus plans hold five
 * questions (or two), and a plan is generated whole.
 */
export const PILOT_V2_UNITS: ReadonlyArray<{ unitKey: string; attachOptionalStimulus?: true }> = [
  { unitKey: 'SP|PRACTICE|lectura|PASSAGE|02' },
  { unitKey: 'SP|PRACTICE|lectura|COMPOSITE|01' },
  { unitKey: 'SP|REDUCED_MOCK|redaccion|NUMBERED_TEXT|01' },
  { unitKey: 'SP|DIAGNOSTIC|redaccion|NUMBERED_TEXT|02' },
  { unitKey: 'SU|DIAGNOSTIC|029|math.num.percent|MULTIPLE_CHOICE|STANDARD#1' },
  { unitKey: 'SU|PRACTICE|063|math.stat.central-tendency|MULTIPLE_CHOICE|FOUNDATIONAL#1', attachOptionalStimulus: true },
  { unitKey: 'SU|FULL_MOCK_1|028|math.num.ratio-proportion|STUDENT_PRODUCED|STANDARD#1' },
  { unitKey: 'SU|FULL_MOCK_2|067|math.prob.probability|STUDENT_PRODUCED|FOUNDATIONAL#1' },
  { unitKey: 'SP|FULL_MOCK_1|matematicas|TABLE|01' },
  { unitKey: 'SP|PRACTICE|matematicas|FIGURE|07' },
  { unitKey: 'SP|DIAGNOSTIC|matematicas|FIGURE|07' },
  { unitKey: 'SP|PRACTICE|ingles|PASSAGE|01' },
  { unitKey: 'SP|DIAGNOSTIC|ingles|DRAFT_PARAGRAPH|01' },
  { unitKey: 'SU|PRACTICE|070|efl.vocabulary|MULTIPLE_CHOICE|FOUNDATIONAL#1' },
  { unitKey: 'SU|VERIFICATION|073|efl.grammar.verb-forms|MULTIPLE_CHOICE|STANDARD#1' },
];

export interface RecordedResponse { unitKey: string; promptHash: string; response: unknown }
export interface PilotRecording { about: string; provider: { id: string; model: string }; authoredInSession: true; liveProviderExercised: false; regenerations: Array<{ unitKey: string; slotKey: string | null; trigger: 'SELF_READING' | 'VALIDATOR'; reason: string }>; draftingRevisionsBeforeFirstRecording?: string[]; responses: RecordedResponse[] }

interface PilotContext { cells: RequirementCell[]; cellOf: Map<string, RequirementCell>; units: Array<{ unit: GenerationUnit; attachOptionalStimulus: boolean }>; planOfSlot: Map<string, StimulusPlan> }

function context(): PilotContext {
  const cells = resolvePaaRequirementCells();
  const plan = buildPaaGenerationPlan(cells);
  const byKey = new Map(plan.units.map((u) => [u.unitKey, u]));
  const units = PILOT_V2_UNITS.map((p) => {
    const unit = byKey.get(p.unitKey);
    if (!unit) throw new Error(`PILOT_UNIT_NOT_IN_THE_GENERATION_PLAN: ${p.unitKey}`);
    return { unit, attachOptionalStimulus: p.attachOptionalStimulus === true };
  });
  return { cells, cellOf: new Map(cells.map((c) => [c.cellKey, c])), units, planOfSlot: new Map(stimulusPlansOf(plan).flatMap((p) => p.memberSlots.map((s) => [s.slotKey, p] as [string, StimulusPlan]))) };
}

function inputOf(ctx: PilotContext, u: PilotContext['units'][number], provider: GenerateCandidatesInput['provider']): GenerateCandidatesInput {
  const cells = slotsOfUnit(u.unit).map((s) => ctx.cellOf.get(s.cellKey)!);
  const language = paaLanguageOf(cells[0].sectionCode);
  return {
    unit: u.unit, cells, packs: Object.fromEntries([...new Set(cells.map((c) => c.primaryConcept.stableId))].map((id) => [id, paaGenerationReadyPack(id, PILOT_V2_RUN.now)])),
    policy: { policyId: PILOT_V2_POLICY.id, policyVersion: PILOT_V2_POLICY.version, author: { kind: 'MODEL', model: PILOT_V2_PROVIDER.model, promptVersion: 'template-registry/1', requestedBy: 'qb-r2c-coordinating-session' }, language, copyReferenceExpression: false },
    provider, templateRegistry: DEFAULT_TEMPLATE_REGISTRY, runId: PILOT_V2_RUN.runId, batchKey: PILOT_V2_RUN.batchKey, now: PILOT_V2_RUN.now,
    // Binding needs a database this phase does not open: the pilot generates for UNBOUND cells, explicitly.
    options: { allowUnboundCells: true, attachOptionalStimulus: u.attachOptionalStimulus },
    labels: { topics: Object.fromEntries(PAA_TOPICS.map((t) => [t.code, t.label])) },
  };
}

/** The prompt of every pilot unit and its hash. What a provider would be sent; what a recording is keyed by. */
export function renderPilotPrompts(): Array<{ unitKey: string; template: { id: string; version: string }; promptHash: string; prompt: unknown }> {
  const ctx = context();
  const none = new RecordedResponseProvider(PILOT_V2_PROVIDER.id, PILOT_V2_PROVIDER.model, {});
  return ctx.units.map((u) => {
    const r = renderGenerationPrompt(inputOf(ctx, u, none));
    return { unitKey: u.unit.unitKey, template: r.template, promptHash: r.promptHash, prompt: r.prompt };
  });
}

const count = <T>(xs: readonly T[], f: (x: T) => string): Record<string, number> => xs.reduce<Record<string, number>>((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});

export interface PilotV2Output { batch: GenerationBatch; report: Record<string, unknown>; packages: Record<string, unknown> }

/**
 * Replays the recording through the harness and runs every independent validator. `priorDrafts` are earlier
 * StudyUs drafts the new items must not repeat (the superseded QB-R2B pilot): they join the originality corpus.
 */
export async function runPilotV2(recording: PilotRecording, priorDrafts: readonly ComparisonEntry[] = []): Promise<PilotV2Output> {
  const ctx = context();
  // a recording is replayed exactly as recorded: keyed by the prompt hash it was authored for
  const provider = new RecordedResponseProvider(recording.provider.id, recording.provider.model, new Map(recording.responses.map((r) => [r.promptHash, canonicalJson(r.response)])));
  const unitBatches: GenerationBatch[] = [];
  for (const u of ctx.units) unitBatches.push(await generateCandidates(inputOf(ctx, u, provider)));
  const batch = mergeGenerationBatches(unitBatches);

  const fixedSentences = [...new Set(DEFAULT_TEMPLATE_REGISTRY.flatMap((t) => Object.values(t.fixedInstruction).flatMap((byFormat) => Object.values(byFormat))))];
  const optionIds = DEFAULT_TEMPLATE_REGISTRY[0].constraints.optionIds;
  const pool = validatePoolIntegrity(batch.candidates, batch.stimuli, (k) => ctx.cellOf.get(k), (slotKey) => ctx.planOfSlot.get(slotKey) ?? null);
  const references = toReferencePackV1(paaGenerationReadyPack(batch.candidates[0].primaryConceptStableId, PILOT_V2_RUN.now));
  const packages: unknown[] = [];
  const rows = batch.candidates.map((candidate: QuestionCandidate) => {
    const cell = ctx.cellOf.get(candidate.cellKey)!;
    const stimulus = candidate.stimulusKey === null ? null : batch.stimuli.find((s) => s.stimulusKey === candidate.stimulusKey) ?? null;
    const plan = candidate.slotKey ? ctx.planOfSlot.get(candidate.slotKey) ?? null : null;
    const structural = validateCandidateStructure(candidate, cell, { stimuli: batch.stimuli, hierarchyViolations: paaCellViolations, draftStage: true });
    const answer = validateAnswerCorrectness(candidate, { requiresAnswerCheck: cell.sectionCode === PAA_MATHEMATICS_SECTION });
    const fidelity = validateConceptFidelity(candidate, cell, paaConceptProfileOf(cell.primaryConcept.stableId));
    const format = validateResponseFormat(candidate, cell, { optionIds });
    const stimulusIntegrity = validateStimulusIntegrity(candidate, cell, stimulus, plan);
    const originality = validateOriginality(candidate, batch.candidates, { fixedSentences, extraCorpus: priorDrafts });
    const roundTrip = validateAnswerNormalizationRoundTrip(candidate);
    const lineage = validateLineageCompleteness(candidate);
    const stimulusPool = stimulus ? pool.stimuli.find((s) => s.stimulusKey === stimulus.stimulusKey)! : null;
    const failures = [
      ...(structural.outcome === 'FAIL' ? structural.issues.map((i) => `STRUCTURAL:${i.check}:${i.code}`) : []), ...(answer.outcome === 'FAILED' ? answer.issues.map((i) => `ANSWER_CORRECTNESS:${i}`) : []), ...(fidelity.outcome === 'FAIL' ? fidelity.issues.map((i) => `CONCEPT_FIDELITY_HEURISTIC:${i}`) : []),
      ...(format.outcome === 'FAIL' ? format.issues.map((i) => `RESPONSE_FORMAT:${i}`) : []), ...(stimulusIntegrity.outcome === 'FAIL' ? stimulusIntegrity.issues.map((i) => `STIMULUS_INTEGRITY:${i}`) : []), ...(originality.outcome === 'REJECT_TEXTUAL_SIMILARITY' ? ['ORIGINALITY:REJECT_TEXTUAL_SIMILARITY'] : []),
      ...(roundTrip.outcome === 'FAIL' ? roundTrip.issues.map((i) => `ANSWER_NORMALIZATION_ROUND_TRIP:${i}`) : []), ...(lineage.outcome === 'FAIL' ? lineage.issues : []), ...(stimulusPool && !stimulusPool.ok ? ['POOL_INTEGRITY:STIMULUS_POOL_VIOLATION'] : []),
    ];
    const flags = [...(fidelity.outcome === 'WEAK' ? ['CONCEPT_FIDELITY_HEURISTIC:WEAK'] : []), ...(originality.outcome === 'REVIEW_STRUCTURAL_SIMILARITY' ? ['ORIGINALITY:NEEDS_A_PERSON'] : []), ...(answer.outcome === 'NOT_MACHINE_VERIFIABLE' ? ['ANSWER_CORRECTNESS:NOT_MACHINE_VERIFIABLE'] : [])];

    // the existing automated status, rights gate, review package and projection, unchanged from QB-R2B
    const validated = validateQuestionCandidate({ candidate, cell, corpus: [...siblingCorpus(candidate, batch.candidates), ...priorDrafts], structuralContext: { stimuli: batch.stimuli, hierarchyViolations: paaCellViolations, draftStage: true } });
    // Rights: no person-verified evidence about the model's output is on file, and this pipeline supplies none.
    const rights = evaluateRightsGate({ provenance: candidate.provenance, authorshipTermsReference: null, modelOutputRights: null, sourceUsages: references.sources.map((s) => ({ sourceKey: s.sourceKey, sourceAccess: s.sourceAccess, usage: 'REFERENCE_ONLY' as const })), originality: { outcome: validated.originality.outcome, acceptedByHuman: false }, licenceReference: null, rightsHolder: null, permittedUse: null, dependencies: [] });
    const pkg = buildHumanReviewPackage({ validated, cell, stimuli: batch.stimuli, references, rights, ingested: false, qualifiedReviewerAvailable: false });
    const projection = projectPilotEligibility({
      stage: validated.structural.outcome === 'PASS' ? 'ORIGINALITY_CHECKED' : 'DRAFT', curriculumCurrentness: cell.curriculumCurrentness,
      environment: { qualifiedReviewerAvailable: false, structureVersionPublished: cell.curriculumCurrentness === 'CURRENT', publishedBlueprintVariantForPool: false },
      lifecycleDeliverable: null, humanReviewDecision: null, reviewerIsAuthor: null, reviewedPrimaryConcepts: null, topicLinked: null, topicUnderOfficialDomain: null, responseFormatAllowedBySection: null,
      stimulusRequired: candidate.stimulusKey !== null, stimulusAndAssetsEligible: null, rightsEstablishedForAll: null, provenance: candidate.provenance, lineagePresent: true,
      originality: { result: validated.originality.record.result, disposition: validated.originality.record.disposition }, activePools: null, blueprintRequired: cell.blueprint !== null, fitsBlueprintCell: null,
    });
    const automatedValidation = [answer, fidelity, format, stimulusIntegrity, { kind: originality.kind, validator: originality.validator, outcome: originality.outcome, issues: originality.issues, maxSimilarity: originality.gate.maxSimilarity, closest: originality.gate.closest ? `${originality.gate.closest.source}:${originality.gate.closest.key}` : null }, roundTrip, lineage];
    packages.push({ ...pkg, instruction: candidate.instruction ?? null, slotKey: candidate.slotKey ?? null, stimulusPlanId: candidate.stimulusPlanId ?? null, definitionConfidence: paaConceptProfileOf(cell.primaryConcept.stableId)?.definitionConfidence ?? null, automatedValidation, regenerationRequired: failures.length > 0, failures, flags, projection: projection.conditions.map((c) => ({ n: c.n, key: c.key, state: c.state, reason: c.reason })) });
    const lin = candidate.lineage.kind === 'MODEL' ? candidate.lineage : null;
    return {
      candidateKey: candidate.candidateKey, slotKey: candidate.slotKey ?? null, cellKey: cell.cellKey, section: cell.sectionCode, pool: cell.intendedPool, primaryConcept: cell.primaryConcept.stableId, template: lin?.template ? `${lin.template.id}@${lin.template.version}` : null, promptHash: lin?.promptHash ?? null,
      format: candidate.responseFormat, band: candidate.difficultyBand, unit: lin?.generationUnitKey ?? null, stimulusPlanId: candidate.stimulusPlanId ?? null, stimulusKey: candidate.stimulusKey, stimulusKind: stimulus?.kind ?? null, currentness: cell.curriculumCurrentness,
      structural: structural.outcome, structuralIssues: structural.issues.map((i) => `${i.check}:${i.code}`), answerCorrectness: answer.outcome, answerIssues: answer.issues, computed: answer.computed, conceptFidelity: fidelity.outcome, evidenceHits: fidelity.evidenceHits, foreignHits: fidelity.foreignHits,
      definitionConfidence: paaConceptProfileOf(cell.primaryConcept.stableId)?.definitionConfidence ?? null, responseFormat: format.outcome, responseFormatIssues: format.issues, stimulusIntegrity: stimulusIntegrity.outcome, stimulusIntegrityIssues: stimulusIntegrity.issues,
      originality: originality.outcome, maxSimilarity: originality.gate.maxSimilarity, closest: originality.gate.closest ? `${originality.gate.closest.source}:${originality.gate.closest.key}` : null, roundTrip: roundTrip.outcome, lineage: lineage.outcome,
      regenerationRequired: failures.length > 0, failures, flags, reviewReady: failures.length === 0, automatedStatus: validated.status, rights: pkg.rights, reviewStatus: pkg.reviewStatus, projection: projection.counts,
    };
  });

  type Row = (typeof rows)[number];
  const metricsOf = (xs: readonly Row[]) => ({
    generated: xs.length, structurallyValid: xs.filter((r) => r.structural === 'PASS').length,
    answerKey: { machineVerified: xs.filter((r) => r.answerCorrectness === 'MACHINE_VERIFIED').length, notMachineVerifiable: xs.filter((r) => r.answerCorrectness === 'NOT_MACHINE_VERIFIABLE').length, failed: xs.filter((r) => r.answerCorrectness === 'FAILED').length },
    conceptFidelityHeuristic: { pass: xs.filter((r) => r.conceptFidelity === 'PASS').length, weak: xs.filter((r) => r.conceptFidelity === 'WEAK').length, fail: xs.filter((r) => r.conceptFidelity === 'FAIL').length },
    responseFormatPass: xs.filter((r) => r.responseFormat === 'PASS').length, stimulusBased: xs.filter((r) => r.stimulusKey !== null).length, stimulusIntegrityPass: xs.filter((r) => r.stimulusIntegrity === 'PASS').length, stimulusIntegrityPassAmongStimulusBased: xs.filter((r) => r.stimulusKey !== null && r.stimulusIntegrity === 'PASS').length,
    originality: { lowSimilarity: xs.filter((r) => r.originality === 'PASS_LOW_SIMILARITY').length, review: xs.filter((r) => r.originality === 'REVIEW_STRUCTURAL_SIMILARITY').length, reject: xs.filter((r) => r.originality === 'REJECT_TEXTUAL_SIMILARITY').length },
    regenerationRequired: xs.filter((r) => r.regenerationRequired).length, reviewReady: xs.filter((r) => r.reviewReady).length,
  });
  const groups = (f: (r: Row) => string) => Object.fromEntries([...new Set(rows.map(f))].map((k) => [k, metricsOf(rows.filter((r) => f(r) === k))]));
  const stimulusSimilarity = batch.stimuli.flatMap((a, i) => batch.stimuli.slice(i + 1).map((b) => ({ a: a.stimulusKey, b: b.stimulusKey, similarity: validateOriginalityOfTexts(a.parts.map((p) => p.text).join(' '), b.parts.map((p) => p.text).join(' ')) })));
  const report = {
    about: 'QB-R2C Pilot Generation v2. Every provider response was authored in-session by the model working on the phase and is REPLAYED from recorded-responses.json through the harness. No live provider was called: this file is evidence that the harness is repeatable and that the contracts hold, not that a live provider works. Every result below is an AUTOMATED_VALIDATION; none is a review.',
    kind: AUTOMATED_VALIDATION, batchKey: batch.batchKey, runId: PILOT_V2_RUN.runId, generatedAt: batch.generatedAt, provider: recording.provider, replayedFromRecording: true, liveProviderExercised: false, ingested: false,
    units: ctx.units.length, stimuli: batch.stimuli.length, priorDraftsCompared: priorDrafts.length,
    metrics: {
      ...metricsOf(rows), poolIntegrity: { outcome: pool.outcome, stimuliChecked: pool.stimuli.length, stimulusPoolViolations: pool.stimulusPoolViolations }, PILOT_STIMULUS_POOL_VIOLATIONS: pool.stimulusPoolViolations,
      answerNormalizationRoundTrip: count(rows, (r) => r.roundTrip), lineageComplete: rows.filter((r) => r.lineage === 'PASS').length, automatedStatus: count(rows, (r) => r.automatedStatus), rights: count(rows, (r) => r.rights.status), rightsBlockers: count(rows.flatMap((r) => r.rights.blockers), (b) => b), reviewStatus: count(rows, (r) => r.reviewStatus),
      maxSiblingSimilarity: Math.max(...rows.map((r) => r.maxSimilarity)),
    },
    bySection: groups((r) => r.section), byTemplate: groups((r) => r.template ?? 'NONE'), byPool: count(rows, (r) => r.pool), byBand: count(rows, (r) => r.band), byFormat: count(rows, (r) => r.format), byDefinitionConfidence: groups((r) => r.definitionConfidence ?? 'NONE'),
    stimulusPools: pool.stimuli, stimulusSimilarity, conceptProfileCoverage: { authored: PAA_CONCEPT_PROFILE_COVERAGE.authored, total: PAA_CONCEPT_PROFILE_COVERAGE.total, workingDefinitions: PAA_CONCEPT_PROFILE_COVERAGE.workingDefinitions },
    authoring: { authoredInSession: recording.authoredInSession, regenerationsAfterFirstRecording: recording.regenerations, regenerationsTriggeredByAValidator: recording.regenerations.filter((r) => r.trigger === 'VALIDATOR').length, draftingRevisionsBeforeFirstRecording: recording.draftingRevisionsBeforeFirstRecording ?? [] },
    remainingFailures: rows.filter((r) => r.failures.length > 0).map((r) => ({ candidateKey: r.candidateKey, failures: r.failures })), flagged: rows.filter((r) => r.flags.length > 0).map((r) => ({ candidateKey: r.candidateKey, flags: r.flags })),
    rows,
  };
  return { batch, report, packages: { about: report.about, batchKey: batch.batchKey, reviewStatus: 'BLOCKED_NO_QUALIFIED_REVIEWER', humanReviewed: false, ingested: false, packages } };
}

import { textualSimilarity } from '@/lib/exam-core/question-bank/production/originality-gate';
const validateOriginalityOfTexts = (a: string, b: string): number => Math.round(textualSimilarity(a, b) * 1000) / 1000;

/** The exact bytes of an artifact file. */
export const serializeArtifact = (value: unknown): string => `${JSON.stringify(value, null, 1)}\n`;
