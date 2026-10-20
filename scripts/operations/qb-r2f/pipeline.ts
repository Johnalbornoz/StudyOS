/**
 * QB-R2F -- from the recording to every derived artifact and to the pre-registered gates (pure: no network, no clock,
 * no file IO). FROZEN with validators revision 4, generator version 3 and the gate evaluator.
 *
 * What is new against QB-R2E's pipeline:
 *   - PROMPTS DEPEND ON THE ANSWERS BEFORE THEM. Each unit is told the parameter sets and the scenarios already used
 *     -- by QB-R2D and QB-R2E for its construct, and by the units of this batch that came before it. So units are
 *     planned one after another, in selection order, each from the recording so far. The same recording gives the
 *     same prompts, hashes and artifacts.
 *   - the validators are revision 4, and the batch-diversity rule is given its peers: the other fresh items of the
 *     same view (same run) and every QB-R2D and QB-R2E candidate (earlier runs).
 * Everything else is as before: the run writes only the recording and the ledger; which regenerations exist is
 * computed here by the pre-registered rule; nothing is repaired.
 */
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { COMPARED_DIMENSIONS, differingDimensions } from '@/lib/assessment-adaptation/math-poc-matrix';
import type { CandidateStimulus } from '@/lib/exam-core/question-bank/production/generation-contract';
import { RecordedResponseProvider } from '@/lib/exam-core/question-bank/production/generator/provider';
import { assembleSpecificationBatch } from '@/lib/exam-core/question-bank/production/generator/specification-generation';
import { parseSpecificationWireResponse, SpecificationGenerationV2Error } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v2';
import { generateFromSpecificationV3, renderSpecificationPromptV3, SPECIFICATION_TEMPLATE_REGISTRY_V3, SpecificationGenerationV3Error, type AvoidLists, type SpecificationUnitResultV3 } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v3';
import { constructIntegrityOf, constructVocabularyOf } from '@/lib/exam-core/question-bank/production/math-construct-registry';
import { evaluateModelOutputRights, evaluateRightsGate, type ModelOutputRightsEvidence } from '@/lib/exam-core/question-bank/production/rights-gate';
import type { SpecificationCandidate, SpecificationGenerationFailure } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { validateSpecificationCandidateR4, type SpecificationItemValidationR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';
import type { R2eRecording } from '../qb-r2e/budget';
import { finalAttemptOf, isRegenerable, isStrictPass, type AdaptationResult, type AttemptResult, type AttemptStatus, type GateEvaluation } from '../qb-r2e/gates';
import type { R2fEvidence } from './evidence';
import { evaluateR2fGates, R2F_PRE_REGISTRATION } from './gates';
import { buildR2fSelection, R2F_APPROACH_PAIRS, r2fUnitKey, type R2fAdaptation } from './selection';

export const QB_R2F_DIR = 'docs/exams/question-bank/pilots/qb-r2f' as const;
export const QB_R2F_FILES = {
  freeze: 'validator-freeze.json', selection: 'selection.json', specifications: 'specifications.json', recording: 'recorded-live-responses.json', ledger: 'spend-ledger.json', batch: 'generated-batch.json',
  report: 'automated-validation-report.json', gates: 'gate-evaluation.json', sameFamilyProof: 'multi-system-same-family-proof.json', approachProof: 'standard-vs-stem-plus-proof.json', rights: 'rights-record.json',
} as const;
export const QB_R2F_LABEL = 'EPHEMERAL -- NOT INGESTED -- DEV_TEST_CONTENT -- AUTOMATED VALIDATION ONLY, NO HUMAN REVIEW' as const;
export const QB_R2F_BATCH_KEY = 'qb-r2f-pre-registered' as const;
export const QB_R2F_POLICY = { id: 'qb-r2f-live-generation', version: '1' } as const;
export const QB_R2F_REQUESTED_BY = 'qb-r2f-lane' as const;
/** A scenario is passed on as at most this many characters of the item's own context description. */
export const AVOID_SCENARIO_MAX_CHARACTERS = 160 as const;

export interface FreezeStamp { freezeCommitSha: string; manifestHash: string }
export interface R2fRecordingFile {
  kind: 'QB_R2F_RECORDED_LIVE_RESPONSES';
  label: 'LIVE PROVIDER RESPONSES -- raw model text as returned -- EPHEMERAL, NOT INGESTED, DEV_TEST_CONTENT';
  freeze: FreezeStamp;
  run: { runId: string; startedAt: string; provider: string; requestedModel: string; requestedBy: string; reasoningEffort: string; maxOutputTokens: number; responseMode: 'STRICT_JSON_SCHEMA'; gateway: 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN' };
  responses: R2eRecording[];
}
export const serializeR2fArtifact = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
export const r2fPolicyFor = (model: string, language: string) => ({ policyId: QB_R2F_POLICY.id, policyVersion: QB_R2F_POLICY.version, author: { kind: 'MODEL' as const, model, promptVersion: 'specification-prompt@3', requestedBy: QB_R2F_REQUESTED_BY }, language, copyReferenceExpression: false as const });
const constructOf = (s: AdaptationSpecification): string => String((s.invariants.construct as { construct?: unknown }).construct ?? '');
const sortedParameters = (c: SpecificationCandidate): Record<string, number> => Object.fromEntries(Object.entries(c.content.declaredModel.parameters).sort(([a], [b]) => (a < b ? -1 : 1)));
const scenarioOf = (c: SpecificationCandidate): string => c.content.context.description.replace(/\s+/g, ' ').trim().slice(0, AVOID_SCENARIO_MAX_CHARACTERS);

/**
 * What a unit is told not to reuse: the parameter sets of its construct that QB-R2D, QB-R2E and the fresh items
 * before it used, and the scenarios of its task family in earlier runs plus those of every fresh item before it.
 * Deterministic: lists are in the order given, without repeats.
 */
export function avoidListsFor(a: R2fAdaptation, evidence: R2fEvidence, freshBefore: readonly SpecificationCandidate[]): AvoidLists {
  const construct = constructOf(a.specification);
  const unique = <T>(xs: T[]): T[] => { const seen = new Set<string>(); return xs.filter((x) => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
  return {
    parameterSets: unique([...evidence.priorCandidates, ...freshBefore].filter((c) => c.content.declaredModel.construct === construct).map(sortedParameters)),
    scenarios: unique([...evidence.priorCandidates.filter((c) => c.lineage.taskFamily.id === a.familyId), ...freshBefore].map(scenarioOf)),
  };
}

export interface R2fPlannedUnit { unitKey: string; adaptation: R2fAdaptation; attempt: 1 | 2; promptHash: string; system: string; user: string; avoid: AvoidLists }
const inputOf = (a: R2fAdaptation, attempt: 1 | 2, model: string, avoid: AvoidLists) => {
  const construct = constructOf(a.specification);
  return { unit: { unitKey: r2fUnitKey(a.selectionKey, attempt), specification: a.specification, attempt, avoid }, constructVocabulary: constructVocabularyOf(construct), constructIntegrity: constructIntegrityOf(construct), policy: r2fPolicyFor(model, a.specification.variable.language), templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY_V3 };
};
export function planR2fUnit(a: R2fAdaptation, attempt: 1 | 2, model: string, avoid: AvoidLists): R2fPlannedUnit {
  const rendered = renderSpecificationPromptV3({ ...inputOf(a, attempt, model, avoid), provider: { id: 'render', model, generate: async () => { throw new Error('RENDER_ONLY'); } } });
  return { unitKey: r2fUnitKey(a.selectionKey, attempt), adaptation: a, attempt, promptHash: rendered.promptHash, system: rendered.prompt.system, user: JSON.stringify(rendered.prompt.instruction), avoid };
}
export function r2fMalformedCodeOf(rawText: string): string | null {
  try { parseSpecificationWireResponse(rawText); return null; } catch (e) { return e instanceof SpecificationGenerationV2Error ? e.code : 'PROVIDER_RESPONSE_NOT_JSON'; }
}

interface Attempted { unit: R2fPlannedUnit; status: AttemptStatus; refusal: { code: string; detail: string } | null; result: SpecificationUnitResultV3 | null }
async function attempt(unit: R2fPlannedUnit, recording: R2fRecordingFile): Promise<Attempted> {
  const r = recording.responses.find((x) => x.promptHash === unit.promptHash);
  if (!r) return { unit, status: 'NOT_RUN', refusal: null, result: null };
  if (r.status === 'TRANSPORT_ERROR' || r.status === 'REQUEST_REJECTED') return { unit, status: 'NO_CONTENT_RECEIVED', refusal: { code: r.status, detail: '' }, result: null };
  const model = recording.run.requestedModel;
  try {
    const result = await generateFromSpecificationV3({ ...inputOf(unit.adaptation, unit.attempt, model, unit.avoid), provider: new RecordedResponseProvider(recording.run.provider, model, { [unit.promptHash]: r.rawText }), runId: recording.run.runId, batchKey: QB_R2F_BATCH_KEY, now: r.recordedAt });
    return { unit, status: 'CANDIDATE', refusal: null, result };
  } catch (e) {
    if (!(e instanceof SpecificationGenerationV3Error)) throw e;
    return { unit, status: e.code === 'PROVIDER_RESPONSE_NOT_JSON' || e.code === 'PROVIDER_RESPONSE_SCHEMA_INVALID' ? 'MALFORMED' : 'REFUSED_BY_HARNESS', refusal: { code: e.code, detail: e.detail }, result: null };
  }
}
/** The first round, one unit after another: each planned from the answers before it. Stops planning at the first unit that has not been run. */
async function firstRound(recording: R2fRecordingFile, evidence: R2fEvidence, selection: readonly R2fAdaptation[]): Promise<{ done: Attempted[]; next: R2fPlannedUnit | null }> {
  const done: Attempted[] = [];
  for (const a of selection) {
    const unit = planR2fUnit(a, 1, recording.run.requestedModel, avoidListsFor(a, evidence, done.flatMap((x) => (x.result ? [x.result.candidate] : []))));
    const x = await attempt(unit, recording);
    if (x.status === 'NOT_RUN') return { done, next: unit };
    done.push(x);
  }
  return { done, next: null };
}
const stimulusOf = (x: Attempted): CandidateStimulus | null => x.result?.stimulus ?? null;
function score(x: Attempted, freshPeers: readonly SpecificationCandidate[], evidence: R2fEvidence): SpecificationItemValidationR4 | null {
  if (!x.result) return null;
  return validateSpecificationCandidateR4({
    candidate: x.result.candidate, specification: x.unit.adaptation.specification, stimulus: stimulusOf(x), siblings: [...freshPeers, ...evidence.priorCandidates], extraCorpus: evidence.pilotCorpus,
    peers: [...freshPeers.map((candidate) => ({ candidate, sameRun: true })), ...evidence.priorCandidates.map((candidate) => ({ candidate, sameRun: false }))],
  });
}
const toResult = (x: Attempted, v: SpecificationItemValidationR4 | null): AttemptResult => ({ attempt: x.unit.attempt, status: x.status, refusalCode: x.refusal?.code ?? null, gates: v?.gates ?? null });

/**
 * The next call the run must make, or null when the run is complete: first attempts in selection order, then the
 * regenerations the pre-registered rule makes due, in selection order. Computed from the recording; nothing is chosen.
 */
export async function nextUnitToCall(recording: R2fRecordingFile, evidence: R2fEvidence, selection: readonly R2fAdaptation[] = buildR2fSelection()): Promise<R2fPlannedUnit | null> {
  const { done, next } = await firstRound(recording, evidence, selection);
  if (next) return next;
  const firstCandidates = done.flatMap((x) => (x.result ? [x.result.candidate] : []));
  const regenerations: SpecificationCandidate[] = [];
  for (const x of done) {
    if (!isRegenerable(toResult(x, score(x, firstCandidates, evidence)))) continue;
    const unit = planR2fUnit(x.unit.adaptation, 2, recording.run.requestedModel, avoidListsFor(x.unit.adaptation, evidence, [...firstCandidates, ...regenerations]));
    const y = await attempt(unit, recording);
    if (y.status === 'NOT_RUN') return unit;
    if (y.result) regenerations.push(y.result.candidate);
  }
  return null;
}

const brief = (c: SpecificationCandidate, stimulus: CandidateStimulus | null) => ({
  stem: c.content.stem, declaredContext: c.content.context, declaredModel: c.content.declaredModel, marks: c.marks, responseFormat: c.responseFormat,
  stimulus: stimulus ? { kind: stimulus.kind, parts: stimulus.parts.map((p) => ({ partKind: p.partKind, text: p.text })) } : null,
  selected: c.content.selected ? { options: c.content.selected.options, answerKey: c.content.selected.answerKey, target: c.content.selected.target } : null,
  numeric: c.content.numeric ? { numericKey: c.content.numeric.numericKey, target: c.content.numeric.target } : null,
  constructed: c.content.constructed ? { totalMarks: c.content.constructed.totalMarks, parts: c.content.constructed.parts.map((p) => ({ label: p.label, commandTerm: p.commandTerm ?? null, prompt: p.prompt, marks: p.marks, markPoints: p.markScheme.map((m) => `${m.kind}${m.marks}`), finalAnswer: p.finalAnswer, target: p.target })) } : null,
  credit: c.content.credit,
});
const parameterSignature = (c: SpecificationCandidate): string => JSON.stringify(sortedParameters(c));

export interface QbR2fOutput { selection: unknown; specifications: unknown; batch: unknown; report: unknown; gates: { freeze: FreezeStamp; evaluation: GateEvaluation } & Record<string, unknown>; sameFamilyProof: Record<string, unknown>; approachProof: Record<string, unknown>; rights: unknown }

/** Replays the recording. The same recording gives the same output, byte for byte. */
export async function runQbR2f(recording: R2fRecordingFile, evidence: R2fEvidence, selection: readonly R2fAdaptation[] = buildR2fSelection()): Promise<QbR2fOutput> {
  const model = recording.run.requestedModel;
  const freeze = recording.freeze;
  const runVoid = recording.responses.some((r) => r.status === 'REQUEST_REJECTED');
  const round = await firstRound(recording, evidence, selection);
  // adaptations the first round did not reach are NOT_RUN, planned with what is known so that they have a unit key and a hash
  const reached = round.done;
  const first: Attempted[] = selection.map((a, i) => reached[i] ?? { unit: planR2fUnit(a, 1, model, avoidListsFor(a, evidence, reached.flatMap((x) => (x.result ? [x.result.candidate] : [])))), status: 'NOT_RUN' as const, refusal: null, result: null });
  const firstCandidates = first.flatMap((x) => (x.result ? [x.result.candidate] : []));
  const firstScores = first.map((x) => score(x, firstCandidates, evidence));
  const firstResults = first.map((x, i) => toResult(x, firstScores[i]));
  const second: Array<Attempted | null> = [];
  const regenerated: SpecificationCandidate[] = [];
  for (let i = 0; i < first.length; i += 1) {
    if (!isRegenerable(firstResults[i]) || round.next !== null) { second.push(isRegenerable(firstResults[i]) ? { unit: planR2fUnit(first[i].unit.adaptation, 2, model, avoidListsFor(first[i].unit.adaptation, evidence, firstCandidates)), status: 'NOT_RUN', refusal: null, result: null } : null); continue; }
    const y = await attempt(planR2fUnit(first[i].unit.adaptation, 2, model, avoidListsFor(first[i].unit.adaptation, evidence, [...firstCandidates, ...regenerated])), recording);
    if (y.result) regenerated.push(y.result.candidate);
    second.push(y);
  }
  const finals = first.map((x, i) => second[i] ?? x);
  const finalCandidates = finals.flatMap((x) => (x.result ? [x.result.candidate] : []));
  const finalScores = finals.map((x) => score(x, finalCandidates, evidence));
  const adaptations: AdaptationResult[] = selection.map((a, i) => ({ selectionKey: a.selectionKey, hasStimulus: a.specification.variable.stimulus.mode !== 'NONE', first: firstResults[i], second: second[i] ? toResult(second[i]!, finalScores[i]) : null, finalGates: finalScores[i]?.gates ?? null }));

  const idx = (key: string) => selection.findIndex((s) => s.selectionKey === key);
  const finalOf = (key: string) => ({ a: selection[idx(key)], x: finals[idx(key)], v: finalScores[idx(key)], c: finals[idx(key)].result?.candidate ?? null });
  const clean = (v: SpecificationItemValidationR4 | null): boolean => !!v && v.gates.structural === 'PASS' && v.gates.profileCompliance === 'PASS' && v.gates.constructPreservation !== 'FAIL' && v.gates.answerKey !== 'FAILED' && v.gates.learnerTextLeakage === 'PASS';
  const side = (key: string) => {
    const { a, x, v, c } = finalOf(key);
    const s = a.specification;
    return { selectionKey: key, targetId: a.targetId, approach: a.approach, systemProfileId: s.systemProfile.profileId, specificationId: s.specificationId, invariantHash: s.invariantHash, primaryConceptStableId: s.primaryConcept.stableId, taskFamily: { id: s.taskFamily.familyId, version: s.taskFamily.version }, variable: Object.fromEntries(COMPARED_DIMENSIONS.map((d) => [d, s.variable[d]])), marks: s.variable.marks ?? null, commandTerms: s.variable.commandTerms ?? null, language: s.variable.language, finalAttempt: x.unit.attempt, finalStatus: x.status, unitKey: x.unit.unitKey, item: c ? brief(c, stimulusOf(x)) : null, gates: v?.gates ?? null, clean: clean(v) };
  };

  const sf = selection.filter((s) => s.group === 'SAME_FAMILY_ALL_SYSTEMS');
  const sfPairs = sf.flatMap((a, i) => sf.slice(i + 1).map((b) => ({ a: a.targetId, b: b.targetId, sameSystem: a.specification.systemProfile.profileId === b.specification.systemProfile.profileId, differingDimensions: differingDimensions(a.specification, b.specification) })));
  const sfClean = sf.filter((a) => { const { v, c } = finalOf(a.selectionKey); return clean(v) && !!c && c.content.declaredModel.construct === constructOf(a.specification) && c.lineage.adaptationSpecification.invariantHash === a.specification.invariantHash; });
  const sfChecks = {
    oneInvariantHash: new Set(sf.map((a) => a.specification.invariantHash)).size === 1, onePrimaryConcept: new Set(sf.map((a) => a.specification.primaryConcept.stableId)).size === 1,
    everyCrossSystemPairDiffersInTheSpecification: sfPairs.filter((x) => !x.sameSystem).every((x) => x.differingDimensions.length > 0),
    systemsAttempted: [...new Set(sf.map((a) => a.specification.systemProfile.profileId))].sort(), cleanSystems: [...new Set(sfClean.map((a) => a.specification.systemProfile.profileId))].sort(),
    atLeastThreeCleanSystems: new Set(sfClean.map((a) => a.specification.systemProfile.profileId)).size >= 3,
  };
  const sameFamilyVerdict: 'PASS' | 'FAIL' = sfChecks.oneInvariantHash && sfChecks.onePrimaryConcept && sfChecks.everyCrossSystemPairDiffersInTheSpecification && sfChecks.atLeastThreeCleanSystems ? 'PASS' : 'FAIL';
  const sameFamilyProof = { kind: 'QB_R2F_MULTI_SYSTEM_SAME_FAMILY_PROOF', label: QB_R2F_LABEL, freeze, criterion: R2F_PRE_REGISTRATION.definitions.SAME_FAMILY_PROOF, familyId: sf[0]?.familyId ?? null, invariantHash: sf[0]?.specification.invariantHash ?? null, invariants: sf[0]?.specification.invariants ?? null, targets: sf.map((a) => side(a.selectionKey)), pairwiseSpecificationDifferences: sfPairs, checks: sfChecks, MULTI_PROFILE_SAME_FAMILY_PROOF: sameFamilyVerdict };

  const pairs = R2F_APPROACH_PAIRS.map(([base, stem, why]) => {
    const A = finalOf(base), B = finalOf(stem);
    const la = B.a.specification.learningApproach;
    const unmet = (la?.unmetPreferences ?? []).map((u) => ({ preferenceId: u.preferenceId, dimension: u.dimension, wanted: u.wanted, decided: u.decided, overriddenBy: u.overriddenBy, overridingRuleCertification: u.overridingRuleCertification }));
    const against = (v: SpecificationItemValidationR4 | null, other: SpecificationCandidate | null) => (v && other ? v.revision4.batchDiversity.filter((i) => i.includes(`:${other.candidateKey}:`)) : []);
    const diversity = [...against(A.v, B.c), ...against(B.v, A.c)];
    const checks = {
      bothClean: clean(A.v) && clean(B.v),
      sameConceptInvariantAndConstruct: A.a.specification.primaryConcept.stableId === B.a.specification.primaryConcept.stableId && A.a.specification.invariantHash === B.a.specification.invariantHash && !!A.c && !!B.c && A.c.content.declaredModel.construct === B.c.content.declaredModel.construct,
      doNotShareAParameterSet: !!A.c && !!B.c && parameterSignature(A.c) !== parameterSignature(B.c),
      notNearDuplicatesOfEachOther: !!A.c && !!B.c && diversity.length === 0,
      baselineByAbsenceAndStemPlusExplicit: A.a.specification.learningApproach === undefined && !!A.c && A.c.lineage.learningApproach.recordedAs === 'STANDARD_BY_ABSENCE' && !!B.c && B.c.lineage.learningApproach.recordedAs === 'EXPLICIT',
      unmetPreferencesCarryTheirOverrider: unmet.every((u) => u.overriddenBy.ref.length > 0 && (u.overriddenBy.authority === null) === (u.overridingRuleCertification === null)),
    };
    return { why, baseline: side(base), stemPlus: side(stem), specificationDimensionsChangedByTheApproach: differingDimensions(A.a.specification, B.a.specification), honouredPreferences: la?.honouredPreferences ?? [], unmetPreferences: unmet, officialConstraintWon: unmet.some((u) => u.overriddenBy.authority === 'OFFICIAL'), responseFormatInItems: { baseline: A.c?.responseFormat ?? null, stemPlus: B.c?.responseFormat ?? null }, batchDiversityBetweenThePair: diversity, checks, pairPasses: Object.values(checks).every(Boolean) };
  });
  const [school, paa] = pairs;
  const apChecks = {
    everyPairPasses: pairs.every((x) => x.pairPasses),
    schoolPairDiffersInResponseFormat: school.specificationDimensionsChangedByTheApproach.includes('responseFormat') && school.responseFormatInItems.baseline !== null && school.responseFormatInItems.stemPlus !== null && school.responseFormatInItems.baseline !== school.responseFormatInItems.stemPlus,
    officialConstraintsWonOnPaa: paa.officialConstraintWon && paa.responseFormatInItems.baseline !== null && paa.responseFormatInItems.baseline === paa.responseFormatInItems.stemPlus,
  };
  const approachVerdict: 'PASS' | 'FAIL' = Object.values(apChecks).every(Boolean) ? 'PASS' : 'FAIL';
  const approachProof = { kind: 'QB_R2F_STANDARD_VS_STEM_PLUS_PROOF', label: QB_R2F_LABEL, freeze, criterion: R2F_PRE_REGISTRATION.definitions.APPROACH_PROOF, familyId: R2F_APPROACH_PAIRS.length > 0 ? selection[idx(R2F_APPROACH_PAIRS[0][0])].familyId : null, pairs, checks: apChecks, STANDARD_VS_STEM_PLUS_PROOF: approachVerdict };

  const evaluation = evaluateR2fGates({ adaptations, sameFamilyProof: sameFamilyVerdict, approachProof: approachVerdict, maxAttemptsObserved: Math.max(0, ...selection.map((_, i) => (second[i] && second[i]!.status !== 'NOT_RUN' ? 2 : first[i].status !== 'NOT_RUN' ? 1 : 0))), artifactsAreAReplay: true, runVoid });

  const all = [...first, ...second.filter((x): x is Attempted => x !== null)];
  const failures: SpecificationGenerationFailure[] = all.filter((x) => x.refusal !== null).map((x) => ({ unitKey: x.unit.unitKey, specificationId: x.unit.adaptation.specification.specificationId, attempt: x.unit.attempt, promptHash: x.unit.promptHash, code: x.refusal!.code, detail: x.refusal!.detail }));
  const batch = assembleSpecificationBatch({ batchKey: QB_R2F_BATCH_KEY, now: recording.run.startedAt, runId: recording.run.runId, provider: { id: recording.run.provider, model }, generationPolicy: { ...QB_R2F_POLICY }, results: all.flatMap((x) => (x.result ? [x.result] : [])), failures });
  const rows = selection.map((a, i) => ({
    selectionKey: a.selectionKey, group: a.group, familyId: a.familyId, targetId: a.targetId, approach: a.approach, specificationId: a.specification.specificationId,
    firstAttempt: { unitKey: first[i].unit.unitKey, promptHash: first[i].unit.promptHash, avoid: first[i].unit.avoid, status: first[i].status, refusal: first[i].refusal, strictPass: isStrictPass(firstResults[i]), regenerable: isRegenerable(firstResults[i]), validation: firstScores[i] },
    regeneration: second[i] ? { unitKey: second[i]!.unit.unitKey, promptHash: second[i]!.unit.promptHash, avoid: second[i]!.unit.avoid, status: second[i]!.status, refusal: second[i]!.refusal, validationAmongFinalAttempts: finalScores[i] } : null,
    finalAttempt: finalAttemptOf(adaptations[i]).attempt, finalStatus: finals[i].status, finalValidation: finalScores[i],
  }));
  const evidenceRights: ModelOutputRightsEvidence = { provider: recording.run.provider, model, termsReference: null, accountContext: null, termsVersionOrDate: null, commercialUse: { permitted: null, note: null }, restrictions: null, verification: { verifiedByPerson: false, verifiedBy: null, verifiedAt: null } };
  const dates = recording.responses.map((r) => r.recordedAt).sort();
  const rights = {
    kind: 'QB_R2F_RIGHTS_RECORD', label: QB_R2F_LABEL, freeze,
    run: { runId: recording.run.runId, provider: recording.run.provider, requestedModel: model, servedModels: [...new Set(recording.responses.flatMap((r) => (r.servedModel ? [r.servedModel] : [])))].sort(), firstResponseAt: dates[0] ?? null, lastResponseAt: dates[dates.length - 1] ?? null, gateway: recording.run.gateway },
    providerTermsEvidenceInTheRepository: 'NONE on file. No web page was read and no legal question was decided.',
    modelOutputRightsEvidence: evidenceRights, modelOutputRightsGate: evaluateModelOutputRights(evidenceRights),
    candidates: batch.candidates.map((c) => { const v = evaluateRightsGate({ provenance: 'STUDYUS_GENERATED', authorshipTermsReference: null, sourceUsages: [], originality: null, licenceReference: null, rightsHolder: null, permittedUse: null, dependencies: [], modelOutputRights: evidenceRights }); return { candidateKey: c.candidateKey, rightsStatus: v.deliverable ? 'UNEXPECTEDLY_ESTABLISHABLE' : 'RIGHTS_NOT_ESTABLISHED', supportedReuseRights: v.supportedReuseRights, deliverable: v.deliverable }; }),
    statement: 'Every generated candidate is RIGHTS_NOT_ESTABLISHED. Nothing here is claimed as STUDYUS_OWNED.',
  };
  return {
    selection: { kind: 'QB_R2F_SELECTION', label: QB_R2F_LABEL, freeze, adaptations: selection.map((a) => ({ selectionKey: a.selectionKey, group: a.group, familyId: a.familyId, familyVersion: a.specification.taskFamily.version, targetId: a.targetId, approach: a.approach, primaryConceptStableId: a.specification.primaryConcept.stableId, specificationId: a.specification.specificationId, invariantHash: a.specification.invariantHash, responseFormat: a.specification.variable.responseFormat.format, calculator: a.specification.variable.toolPolicy.calculator, commandTerms: a.specification.variable.commandTerms?.allowed ?? null, marks: a.specification.variable.marks ?? null, stimulus: a.specification.variable.stimulus, context: a.specification.variable.context, language: a.specification.variable.language, tests: a.tests })) },
    specifications: { kind: 'QB_R2F_SPECIFICATIONS', label: QB_R2F_LABEL, freeze, specifications: Object.fromEntries(selection.map((a) => [a.selectionKey, a.specification])) },
    batch: { kind: 'QB_R2F_GENERATED_BATCH', label: QB_R2F_LABEL, freeze, batch },
    report: { kind: 'QB_R2F_AUTOMATED_VALIDATION_REPORT', label: QB_R2F_LABEL, freeze, about: 'Scored by validators revision 4. Every result is an AUTOMATED_VALIDATION; none is a review. Review status of every item: BLOCKED_NO_QUALIFIED_REVIEWER.', run: recording.run, runVoid, rows },
    gates: { kind: 'QB_R2F_GATE_EVALUATION', label: QB_R2F_LABEL, freeze, evaluation },
    sameFamilyProof, approachProof, rights,
  };
}
