/**
 * QB-R2E -- from the recording to every derived artifact and to the pre-registered gates (pure: no network, no clock,
 * no file IO). FROZEN with the validators and the gate evaluator.
 *
 *   selection (20 specifications, engine 3) + recorded live responses
 *     -> version-2 generation, replayed -> revision-3 validators -> proofs -> evaluateGates()
 *
 * The live run writes only the recording and the ledger. Everything else is produced here, so the stored artifacts
 * are what a replay gives -- there is no place where a person could repair an item.
 *
 * WHICH ATTEMPT-2 UNITS EXIST is not a choice: it is computed here from the attempt-1 results by the pre-registered
 * rule (`isRegenerable`). The run script asks this file which regenerations are due and makes exactly those calls.
 */
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { COMPARED_DIMENSIONS, differingDimensions } from '@/lib/assessment-adaptation/math-poc-matrix';
import type { CandidateStimulus } from '@/lib/exam-core/question-bank/production/generation-contract';
import { RecordedResponseProvider } from '@/lib/exam-core/question-bank/production/generator/provider';
import { assembleSpecificationBatch } from '@/lib/exam-core/question-bank/production/generator/specification-generation';
import { generateFromSpecificationV2, parseSpecificationWireResponse, renderSpecificationPromptV2, SPECIFICATION_TEMPLATE_REGISTRY_V2, SpecificationGenerationV2Error, type SpecificationUnitResultV2 } from '@/lib/exam-core/question-bank/production/generator/specification-generation-v2';
import { constructIntegrityOf, constructVocabularyOf } from '@/lib/exam-core/question-bank/production/math-construct-registry';
import type { ComparisonEntry } from '@/lib/exam-core/question-bank/production/originality-gate';
import { evaluateModelOutputRights, evaluateRightsGate, type ModelOutputRightsEvidence } from '@/lib/exam-core/question-bank/production/rights-gate';
import type { SpecificationCandidate, SpecificationGenerationFailure } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { validateSpecificationCandidateR3, type SpecificationItemValidationR3 } from '@/lib/exam-core/question-bank/production/specification-validators-r3';
import type { R2eRecording } from './budget';
import { evaluateGates, finalAttemptOf, isRegenerable, isStrictPass, PRE_REGISTRATION, type AdaptationResult, type AttemptResult, type AttemptStatus, type GateEvaluation } from './gates';
import { buildR2eSelection, R2E_APPROACH_PAIRS, r2eUnitKey, type R2eAdaptation } from './selection';

export const QB_R2E_DIR = 'docs/exams/question-bank/pilots/qb-r2e' as const;
export const QB_R2E_FILES = {
  freeze: 'validator-freeze.json', selection: 'selection.json', specifications: 'specifications.json', recording: 'recorded-live-responses.json', ledger: 'spend-ledger.json', batch: 'generated-batch.json',
  report: 'automated-validation-report.json', gates: 'gate-evaluation.json', sameFamilyProof: 'multi-system-same-family-proof.json', approachProof: 'standard-vs-stem-plus-proof.json', rights: 'rights-record.json',
} as const;
export const QB_R2E_LABEL = 'EPHEMERAL -- NOT INGESTED -- DEV_TEST_CONTENT -- AUTOMATED VALIDATION ONLY, NO HUMAN REVIEW' as const;
export const QB_R2E_BATCH_KEY = 'qb-r2e-pre-registered' as const;
export const QB_R2E_POLICY = { id: 'qb-r2e-live-generation', version: '1' } as const;
export const QB_R2E_REQUESTED_BY = 'qb-r2e-lane' as const;

export interface FreezeStamp { freezeCommitSha: string; manifestHash: string }
export interface R2eRecordingFile {
  kind: 'QB_R2E_RECORDED_LIVE_RESPONSES';
  label: 'LIVE PROVIDER RESPONSES -- raw model text as returned -- EPHEMERAL, NOT INGESTED, DEV_TEST_CONTENT';
  freeze: FreezeStamp;
  run: { runId: string; startedAt: string; provider: string; requestedModel: string; requestedBy: string; reasoningEffort: string; maxOutputTokens: number; responseMode: 'STRICT_JSON_SCHEMA'; gateway: 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN' };
  responses: R2eRecording[];
}
export interface R2eEvidence { r2dCandidates: readonly SpecificationCandidate[]; pilotCorpus: readonly ComparisonEntry[]; avoidParameterSets: Readonly<Record<string, ReadonlyArray<Readonly<Record<string, number>>>>> }

export const serializeR2eArtifact = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
export const r2ePolicyFor = (model: string, language: string) => ({ policyId: QB_R2E_POLICY.id, policyVersion: QB_R2E_POLICY.version, author: { kind: 'MODEL' as const, model, promptVersion: 'specification-prompt@2', requestedBy: QB_R2E_REQUESTED_BY }, language, copyReferenceExpression: false as const });
const constructOf = (s: AdaptationSpecification): string => String((s.invariants.construct as { construct?: unknown }).construct ?? '');

export interface R2ePlannedUnit { unitKey: string; adaptation: R2eAdaptation; attempt: 1 | 2; promptHash: string; system: string; user: string }
const inputOf = (a: R2eAdaptation, attempt: 1 | 2, model: string, evidence: R2eEvidence) => {
  const construct = constructOf(a.specification);
  return { unit: { unitKey: r2eUnitKey(a.selectionKey, attempt), specification: a.specification, attempt, avoidParameterSets: evidence.avoidParameterSets[construct] ?? [] }, constructVocabulary: constructVocabularyOf(construct), constructIntegrity: constructIntegrityOf(construct), policy: r2ePolicyFor(model, a.specification.variable.language), templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY_V2 };
};
/** One unit: its prompt and hash. Calls no provider. */
export function planUnit(a: R2eAdaptation, attempt: 1 | 2, model: string, evidence: R2eEvidence): R2ePlannedUnit {
  const rendered = renderSpecificationPromptV2({ ...inputOf(a, attempt, model, evidence), provider: { id: 'render', model, generate: async () => { throw new Error('RENDER_ONLY'); } } });
  return { unitKey: r2eUnitKey(a.selectionKey, attempt), adaptation: a, attempt, promptHash: rendered.promptHash, system: rendered.prompt.system, user: JSON.stringify(rendered.prompt.instruction) };
}
export const plannedFirstAttempts = (model: string, evidence: R2eEvidence, selection: readonly R2eAdaptation[] = buildR2eSelection()): R2ePlannedUnit[] => selection.map((a) => planUnit(a, 1, model, evidence));
export function r2eMalformedCodeOf(rawText: string): string | null {
  try { parseSpecificationWireResponse(rawText); return null; } catch (e) { return e instanceof SpecificationGenerationV2Error ? e.code : 'PROVIDER_RESPONSE_NOT_JSON'; }
}

interface Attempted { unit: R2ePlannedUnit; status: AttemptStatus; refusal: { code: string; detail: string } | null; result: SpecificationUnitResultV2 | null; recordedAt: string | null }
async function attempt(unit: R2ePlannedUnit, recording: R2eRecordingFile, evidence: R2eEvidence): Promise<Attempted> {
  const r = recording.responses.find((x) => x.promptHash === unit.promptHash);
  if (!r) return { unit, status: 'NOT_RUN', refusal: null, result: null, recordedAt: null };
  if (r.status === 'TRANSPORT_ERROR' || r.status === 'REQUEST_REJECTED') return { unit, status: 'NO_CONTENT_RECEIVED', refusal: { code: r.status, detail: '' }, result: null, recordedAt: r.recordedAt };
  const model = recording.run.requestedModel;
  try {
    const result = await generateFromSpecificationV2({ ...inputOf(unit.adaptation, unit.attempt, model, evidence), provider: new RecordedResponseProvider(recording.run.provider, model, { [unit.promptHash]: r.rawText }), runId: recording.run.runId, batchKey: QB_R2E_BATCH_KEY, now: r.recordedAt });
    return { unit, status: 'CANDIDATE', refusal: null, result, recordedAt: r.recordedAt };
  } catch (e) {
    if (!(e instanceof SpecificationGenerationV2Error)) throw e;
    return { unit, status: e.code === 'PROVIDER_RESPONSE_NOT_JSON' || e.code === 'PROVIDER_RESPONSE_SCHEMA_INVALID' ? 'MALFORMED' : 'REFUSED_BY_HARNESS', refusal: { code: e.code, detail: e.detail }, result: null, recordedAt: r.recordedAt };
  }
}
const stimulusOf = (x: Attempted): CandidateStimulus | null => x.result?.stimulus ?? null;
function score(x: Attempted, siblings: readonly SpecificationCandidate[], evidence: R2eEvidence): SpecificationItemValidationR3 | null {
  if (!x.result) return null;
  // QB-R2D candidates stand beside the fresh ones as siblings: wording AND parameter sets are compared with them
  return validateSpecificationCandidateR3({ candidate: x.result.candidate, specification: x.unit.adaptation.specification, stimulus: stimulusOf(x), siblings: [...siblings, ...evidence.r2dCandidates], extraCorpus: evidence.pilotCorpus });
}
const toResult = (x: Attempted, v: SpecificationItemValidationR3 | null): AttemptResult => ({ attempt: x.unit.attempt, status: x.status, refusalCode: x.refusal?.code ?? null, gates: v?.gates ?? null });

/** After the first attempts: which adaptations are due their one regeneration, by the pre-registered rule. Deterministic. */
export async function regenerationsDue(recording: R2eRecordingFile, evidence: R2eEvidence, selection: readonly R2eAdaptation[] = buildR2eSelection()): Promise<R2ePlannedUnit[]> {
  const model = recording.run.requestedModel;
  const first = await Promise.all(selection.map((a) => attempt(planUnit(a, 1, model, evidence), recording, evidence)));
  if (first.some((x) => x.status === 'NOT_RUN')) throw new Error('FIRST_ATTEMPTS_NOT_COMPLETE: regenerations are decided only when every first attempt has been made');
  const firstCandidates = first.flatMap((x) => (x.result ? [x.result.candidate] : []));
  return first.filter((x) => isRegenerable(toResult(x, score(x, firstCandidates, evidence)))).map((x) => planUnit(x.unit.adaptation, 2, model, evidence));
}

const brief = (c: SpecificationCandidate, stimulus: CandidateStimulus | null) => ({
  stem: c.content.stem, instruction: c.instruction, declaredContext: c.content.context, declaredModel: c.content.declaredModel, marks: c.marks, responseFormat: c.responseFormat,
  stimulus: stimulus ? { kind: stimulus.kind, parts: stimulus.parts.map((p) => ({ partKind: p.partKind, text: p.text })) } : null,
  selected: c.content.selected ? { options: c.content.selected.options, answerKey: c.content.selected.answerKey, target: c.content.selected.target } : null,
  numeric: c.content.numeric ? { numericKey: c.content.numeric.numericKey, target: c.content.numeric.target } : null,
  constructed: c.content.constructed ? { totalMarks: c.content.constructed.totalMarks, parts: c.content.constructed.parts.map((p) => ({ label: p.label, commandTerm: p.commandTerm ?? null, prompt: p.prompt, marks: p.marks, markPoints: p.markScheme.map((m) => `${m.kind}${m.marks}`), finalAnswer: p.finalAnswer, target: p.target })) } : null,
  credit: c.content.credit,
});
const parameterSignature = (c: SpecificationCandidate): string => JSON.stringify(Object.entries(c.content.declaredModel.parameters).sort(([a], [b]) => (a < b ? -1 : 1)));

export interface QbR2eOutput { selection: unknown; specifications: unknown; batch: unknown; report: unknown; gates: { freeze: FreezeStamp; evaluation: GateEvaluation } & Record<string, unknown>; sameFamilyProof: Record<string, unknown>; approachProof: Record<string, unknown>; rights: unknown }

/** Replays the recording. The same recording gives the same output, byte for byte. */
export async function runQbR2e(recording: R2eRecordingFile, evidence: R2eEvidence, selection: readonly R2eAdaptation[] = buildR2eSelection()): Promise<QbR2eOutput> {
  const model = recording.run.requestedModel;
  const freeze = recording.freeze;
  const runVoid = recording.responses.some((r) => r.status === 'REQUEST_REJECTED');
  const first = await Promise.all(selection.map((a) => attempt(planUnit(a, 1, model, evidence), recording, evidence)));
  const firstCandidates = first.flatMap((x) => (x.result ? [x.result.candidate] : []));
  const firstScores = first.map((x) => score(x, firstCandidates, evidence));
  const firstResults = first.map((x, i) => toResult(x, firstScores[i]));
  const second = await Promise.all(first.map((x, i) => (isRegenerable(firstResults[i]) ? attempt(planUnit(x.unit.adaptation, 2, model, evidence), recording, evidence) : Promise.resolve(null))));
  const finals = first.map((x, i) => second[i] ?? x);
  const finalCandidates = finals.flatMap((x) => (x.result ? [x.result.candidate] : []));
  const finalScores = finals.map((x) => score(x, finalCandidates, evidence));
  const adaptations: AdaptationResult[] = selection.map((a, i) => ({ selectionKey: a.selectionKey, hasStimulus: a.specification.variable.stimulus.mode !== 'NONE', first: firstResults[i], second: second[i] ? toResult(second[i]!, finalScores[i]) : null, finalGates: finalScores[i]?.gates ?? null }));

  const idx = (key: string) => selection.findIndex((s) => s.selectionKey === key);
  const finalOf = (key: string) => ({ a: selection[idx(key)], x: finals[idx(key)], v: finalScores[idx(key)], c: finals[idx(key)].result?.candidate ?? null });
  const clean = (v: SpecificationItemValidationR3 | null): boolean => !!v && v.gates.structural === 'PASS' && v.gates.profileCompliance === 'PASS' && v.gates.constructPreservation !== 'FAIL' && v.gates.answerKey !== 'FAILED' && v.gates.learnerTextLeakage === 'PASS';
  const side = (key: string) => {
    const { a, x, v, c } = finalOf(key);
    const s = a.specification;
    return { selectionKey: key, targetId: a.targetId, approach: a.approach, systemProfileId: s.systemProfile.profileId, specificationId: s.specificationId, invariantHash: s.invariantHash, primaryConceptStableId: s.primaryConcept.stableId, taskFamily: { id: s.taskFamily.familyId, version: s.taskFamily.version }, variable: Object.fromEntries(COMPARED_DIMENSIONS.map((d) => [d, s.variable[d]])), marks: s.variable.marks ?? null, commandTerms: s.variable.commandTerms ?? null, language: s.variable.language, finalAttempt: x.unit.attempt, finalStatus: x.status, unitKey: x.unit.unitKey, item: c ? brief(c, stimulusOf(x)) : null, gates: v?.gates ?? null, clean: clean(v) };
  };

  // ---- one family, five systems ---------------------------------------------------------------------------------
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
  const sameFamilyProof = { kind: 'QB_R2E_MULTI_SYSTEM_SAME_FAMILY_PROOF', label: QB_R2E_LABEL, freeze, criterion: PRE_REGISTRATION.definitions.SAME_FAMILY_PROOF, familyId: sf[0]?.familyId ?? null, invariantHash: sf[0]?.specification.invariantHash ?? null, invariants: sf[0]?.specification.invariants ?? null, targets: sf.map((a) => side(a.selectionKey)), pairwiseSpecificationDifferences: sfPairs, checks: sfChecks, MULTI_PROFILE_SAME_FAMILY_PROOF: sameFamilyVerdict };

  // ---- STANDARD against STEM_PLUS --------------------------------------------------------------------------------
  const pairs = R2E_APPROACH_PAIRS.map(([base, stem, why]) => {
    const A = finalOf(base), B = finalOf(stem);
    const la = B.a.specification.learningApproach;
    const unmet = (la?.unmetPreferences ?? []).map((u) => ({ preferenceId: u.preferenceId, dimension: u.dimension, wanted: u.wanted, decided: u.decided, overriddenBy: u.overriddenBy, overridingRuleCertification: u.overridingRuleCertification }));
    const checks = {
      bothClean: clean(A.v) && clean(B.v),
      sameConceptInvariantAndConstruct: A.a.specification.primaryConcept.stableId === B.a.specification.primaryConcept.stableId && A.a.specification.invariantHash === B.a.specification.invariantHash && !!A.c && !!B.c && A.c.content.declaredModel.construct === B.c.content.declaredModel.construct,
      doNotShareAParameterSet: !!A.c && !!B.c && parameterSignature(A.c) !== parameterSignature(B.c),
      standardByAbsenceAndStemPlusExplicit: A.a.specification.learningApproach === undefined && !!A.c && A.c.lineage.learningApproach.recordedAs === 'STANDARD_BY_ABSENCE' && !!B.c && B.c.lineage.learningApproach.recordedAs === 'EXPLICIT',
      unmetPreferencesCarryTheirOverrider: unmet.every((u) => u.overriddenBy.ref.length > 0 && (u.overriddenBy.authority === null) === (u.overridingRuleCertification === null)),
    };
    return { why, baseline: side(base), stemPlus: side(stem), specificationDimensionsChangedByTheApproach: differingDimensions(A.a.specification, B.a.specification), honouredPreferences: la?.honouredPreferences ?? [], unmetPreferences: unmet, officialConstraintWon: unmet.some((u) => u.overriddenBy.authority === 'OFFICIAL'), responseFormatInItems: { baseline: A.c?.responseFormat ?? null, stemPlus: B.c?.responseFormat ?? null }, checks, pairPasses: Object.values(checks).every(Boolean) };
  });
  const [school, paa] = pairs;
  const apChecks = {
    everyPairPasses: pairs.every((x) => x.pairPasses),
    schoolPairDiffersInResponseFormat: school.specificationDimensionsChangedByTheApproach.includes('responseFormat') && school.responseFormatInItems.baseline !== null && school.responseFormatInItems.stemPlus !== null && school.responseFormatInItems.baseline !== school.responseFormatInItems.stemPlus,
    officialConstraintsWonOnPaa: paa.officialConstraintWon && paa.responseFormatInItems.baseline !== null && paa.responseFormatInItems.baseline === paa.responseFormatInItems.stemPlus,
  };
  const approachVerdict: 'PASS' | 'FAIL' = Object.values(apChecks).every(Boolean) ? 'PASS' : 'FAIL';
  const approachProof = { kind: 'QB_R2E_STANDARD_VS_STEM_PLUS_PROOF', label: QB_R2E_LABEL, freeze, criterion: PRE_REGISTRATION.definitions.APPROACH_PROOF, familyId: sf[0]?.familyId ?? null, pairs, checks: apChecks, STANDARD_VS_STEM_PLUS_PROOF: approachVerdict };

  const evaluation = evaluateGates({ adaptations, sameFamilyProof: sameFamilyVerdict, approachProof: approachVerdict, maxAttemptsObserved: Math.max(0, ...selection.map((_, i) => (second[i] && second[i]!.status !== 'NOT_RUN' ? 2 : first[i].status !== 'NOT_RUN' ? 1 : 0))), artifactsAreAReplay: true, runVoid });

  // ---- batch, report, rights ------------------------------------------------------------------------------------
  const all = [...first, ...second.filter((x): x is Attempted => x !== null)];
  const failures: SpecificationGenerationFailure[] = all.filter((x) => x.refusal !== null).map((x) => ({ unitKey: x.unit.unitKey, specificationId: x.unit.adaptation.specification.specificationId, attempt: x.unit.attempt, promptHash: x.unit.promptHash, code: x.refusal!.code, detail: x.refusal!.detail }));
  const batch = assembleSpecificationBatch({ batchKey: QB_R2E_BATCH_KEY, now: recording.run.startedAt, runId: recording.run.runId, provider: { id: recording.run.provider, model }, generationPolicy: { ...QB_R2E_POLICY }, results: all.flatMap((x) => (x.result ? [x.result] : [])), failures });
  const rows = selection.map((a, i) => ({
    selectionKey: a.selectionKey, group: a.group, familyId: a.familyId, targetId: a.targetId, approach: a.approach, specificationId: a.specification.specificationId,
    firstAttempt: { unitKey: first[i].unit.unitKey, promptHash: first[i].unit.promptHash, status: first[i].status, refusal: first[i].refusal, strictPass: isStrictPass(firstResults[i]), regenerable: isRegenerable(firstResults[i]), validation: firstScores[i] },
    regeneration: second[i] ? { unitKey: second[i]!.unit.unitKey, promptHash: second[i]!.unit.promptHash, status: second[i]!.status, refusal: second[i]!.refusal, validationAmongFinalAttempts: finalScores[i] } : null,
    finalAttempt: finalAttemptOf(adaptations[i]).attempt, finalStatus: finals[i].status, finalValidation: finalScores[i],
  }));
  const evidenceRights: ModelOutputRightsEvidence = { provider: recording.run.provider, model, termsReference: null, accountContext: null, termsVersionOrDate: null, commercialUse: { permitted: null, note: null }, restrictions: null, verification: { verifiedByPerson: false, verifiedBy: null, verifiedAt: null } };
  const dates = recording.responses.map((r) => r.recordedAt).sort();
  const rights = {
    kind: 'QB_R2E_RIGHTS_RECORD', label: QB_R2E_LABEL, freeze,
    run: { runId: recording.run.runId, provider: recording.run.provider, requestedModel: model, servedModels: [...new Set(recording.responses.flatMap((r) => (r.servedModel ? [r.servedModel] : [])))].sort(), firstResponseAt: dates[0] ?? null, lastResponseAt: dates[dates.length - 1] ?? null, gateway: recording.run.gateway },
    providerTermsEvidenceInTheRepository: 'NONE on file (unchanged since QB-R2D). No web page was read and no legal question was decided.',
    modelOutputRightsEvidence: evidenceRights, modelOutputRightsGate: evaluateModelOutputRights(evidenceRights),
    candidates: batch.candidates.map((c) => { const v = evaluateRightsGate({ provenance: 'STUDYUS_GENERATED', authorshipTermsReference: null, sourceUsages: [], originality: null, licenceReference: null, rightsHolder: null, permittedUse: null, dependencies: [], modelOutputRights: evidenceRights }); return { candidateKey: c.candidateKey, rightsStatus: v.deliverable ? 'UNEXPECTEDLY_ESTABLISHABLE' : 'RIGHTS_NOT_ESTABLISHED', supportedReuseRights: v.supportedReuseRights, deliverable: v.deliverable }; }),
    statement: 'Every generated candidate is RIGHTS_NOT_ESTABLISHED. Nothing here is claimed as STUDYUS_OWNED.',
  };
  return {
    selection: { kind: 'QB_R2E_SELECTION', label: QB_R2E_LABEL, freeze, adaptations: selection.map((a) => ({ selectionKey: a.selectionKey, group: a.group, familyId: a.familyId, familyVersion: a.specification.taskFamily.version, targetId: a.targetId, approach: a.approach, primaryConceptStableId: a.specification.primaryConcept.stableId, specificationId: a.specification.specificationId, invariantHash: a.specification.invariantHash, responseFormat: a.specification.variable.responseFormat.format, calculator: a.specification.variable.toolPolicy.calculator, commandTerms: a.specification.variable.commandTerms?.allowed ?? null, marks: a.specification.variable.marks ?? null, stimulus: a.specification.variable.stimulus, context: a.specification.variable.context, language: a.specification.variable.language, tests: a.tests })) },
    specifications: { kind: 'QB_R2E_SPECIFICATIONS', label: QB_R2E_LABEL, freeze, specifications: Object.fromEntries(selection.map((a) => [a.selectionKey, a.specification])) },
    batch: { kind: 'QB_R2E_GENERATED_BATCH', label: QB_R2E_LABEL, freeze, batch },
    report: { kind: 'QB_R2E_AUTOMATED_VALIDATION_REPORT', label: QB_R2E_LABEL, freeze, about: 'Scored by validators revision 3 (revision 2 plus additions). Every result is an AUTOMATED_VALIDATION; none is a review. Review status of every item: BLOCKED_NO_QUALIFIED_REVIEWER.', run: recording.run, runVoid, rows },
    gates: { kind: 'QB_R2E_GATE_EVALUATION', label: QB_R2E_LABEL, freeze, evaluation },
    sameFamilyProof, approachProof, rights,
  };
}
