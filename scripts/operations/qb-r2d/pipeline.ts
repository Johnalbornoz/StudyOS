/**
 * QB-R2D -- the pipeline from RECORDED live responses to every derived artifact (pure: no network, no clock, no file IO).
 *
 *   selection (20 adaptation specifications) + recorded live responses
 *     -> specification-driven generation, replayed through RecordedResponseProvider
 *     -> the independent validators -> report, same-family proof, approach proof, rights record
 *
 * The live run writes ONLY the recording and the spend ledger. Every other artifact is produced HERE, from the
 * recording, so that the stored artifacts are by construction what a replay gives -- and a unit test replays the
 * stored recording and compares byte for byte.
 *
 * HISTORICAL. The run is replayed against the specifications STORED with it (`stored-selection.ts`), the version-1
 * templates and response schema, and revision 2 of the validators -- the versions that produced and scored it.
 * Later work (QB-R2E) adds new versions beside them and changes none of these.
 *
 * A unit whose response the harness refuses is a RESULT: it is kept as a failure with the refusal's name. A unit
 * with no recording is NOT_RUN. Neither is repaired, and no item is edited by hand.
 */
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { COMPARED_DIMENSIONS, differingDimensions } from '@/lib/assessment-adaptation/math-poc-matrix';
import type { CandidateStimulus } from '@/lib/exam-core/question-bank/production/generation-contract';
import { RecordedResponseProvider } from '@/lib/exam-core/question-bank/production/generator/provider';
import { assembleSpecificationBatch, generateFromSpecification, parseSpecificationResponse, renderSpecificationPrompt, SPECIFICATION_TEMPLATE_REGISTRY, SpecificationGenerationError, type SpecificationUnitResult } from '@/lib/exam-core/question-bank/production/generator/specification-generation';
import { constructVocabularyOf } from '@/lib/exam-core/question-bank/production/math-construct-registry';
import type { ComparisonEntry } from '@/lib/exam-core/question-bank/production/originality-gate';
import { evaluateModelOutputRights, evaluateRightsGate, type ModelOutputRightsEvidence } from '@/lib/exam-core/question-bank/production/rights-gate';
import type { SpecificationBatch, SpecificationCandidate, SpecificationGenerationFailure } from '@/lib/exam-core/question-bank/production/specification-candidate';
import { ANSWER_CLASSES, validateSpecificationCandidate, type SpecificationItemValidation } from '@/lib/exam-core/question-bank/production/specification-validators';
import type { LiveRecording } from './budget';
import { unitKeyOf, type SelectedAdaptation } from './selection';
import { storedR2dSelection } from './stored-selection';

export const QB_R2D_DIR = 'docs/exams/question-bank/pilots/qb-r2d' as const;
export const QB_R2D_FILES = {
  selection: 'selection.json', specifications: 'specifications.json', recording: 'recorded-live-responses.json', ledger: 'spend-ledger.json', batch: 'generated-batch.json', report: 'automated-validation-report.json',
  sameFamilyProof: 'multi-system-same-family-proof.json', approachProof: 'standard-vs-stem-plus-proof.json', rights: 'rights-record.json',
} as const;
export const QB_R2D_LABEL = 'EPHEMERAL -- NOT INGESTED -- DEV_TEST_CONTENT -- AUTOMATED VALIDATION ONLY, NO HUMAN REVIEW' as const;
export const QB_R2D_BATCH_KEY = 'qb-r2d-live-multi-profile' as const;
export const QB_R2D_POLICY = { id: 'qb-r2d-live-generation', version: '1' } as const;
export const QB_R2D_REQUESTED_BY = 'qb-r2d-lane' as const;

export interface LiveRecordingFile {
  kind: 'QB_R2D_RECORDED_LIVE_RESPONSES';
  label: 'LIVE PROVIDER RESPONSES -- raw model text as returned -- EPHEMERAL, NOT INGESTED, DEV_TEST_CONTENT';
  run: { runId: string; startedAt: string; provider: string; requestedModel: string; requestedBy: string; reasoningEffort: string; maxOutputTokens: number; gateway: 'BYPASSED_NO_GOVERNANCE_ROW_WRITTEN' };
  /** Explicit, counted second attempts at CONTENT: a new unit key, a new prompt, a new hash. */
  regenerations: Array<{ selectionKey: string; attempt: number; reason: string }>;
  responses: LiveRecording[];
}

export const serializeArtifact = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
export const policyFor = (model: string, language: string) => ({ policyId: QB_R2D_POLICY.id, policyVersion: QB_R2D_POLICY.version, author: { kind: 'MODEL' as const, model, promptVersion: 'specification-prompt@1', requestedBy: QB_R2D_REQUESTED_BY }, language, copyReferenceExpression: false as const });

export interface PlannedUnit { unitKey: string; selection: SelectedAdaptation; attempt: number; promptHash: string; system: string; user: string }
/** The units of a run: every selected adaptation once, plus each recorded regeneration. Renders every prompt; calls no provider. */
export function plannedUnits(model: string, regenerations: LiveRecordingFile['regenerations'] = [], selection: readonly SelectedAdaptation[] = storedR2dSelection()): PlannedUnit[] {
  const one = (s: SelectedAdaptation, attempt: number): PlannedUnit => {
    const unitKey = unitKeyOf(s.selectionKey, attempt);
    const construct = String((s.specification.invariants.construct as { construct?: unknown }).construct ?? '');
    const rendered = renderSpecificationPrompt({ unit: { unitKey, specification: s.specification, attempt }, constructVocabulary: constructVocabularyOf(construct), policy: policyFor(model, s.specification.variable.language), provider: { id: 'render', model, generate: async () => { throw new Error('RENDER_ONLY'); } }, templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY });
    return { unitKey, selection: s, attempt, promptHash: rendered.promptHash, system: rendered.prompt.system, user: JSON.stringify(rendered.prompt.instruction) };
  };
  return [...selection.map((s) => one(s, 1)), ...regenerations.map((r) => { const s = selection.find((x) => x.selectionKey === r.selectionKey); if (!s) throw new Error(`REGENERATION_OF_AN_UNSELECTED_ADAPTATION: ${r.selectionKey}`); return one(s, r.attempt); })];
}

/** The harness's own strict parse, as the one-retry rule needs it: null = well-formed. */
export function malformedCodeOf(rawText: string): string | null {
  try { parseSpecificationResponse(rawText); return null; } catch (e) { return e instanceof SpecificationGenerationError ? e.code : 'PROVIDER_RESPONSE_NOT_JSON'; }
}

type UnitStatus = 'GENERATED' | 'GENERATION_REFUSED_BY_HARNESS' | 'NOT_RUN';
interface ReportRow {
  unitKey: string; selectionKey: string; attempt: number; group: string; familyId: string; targetId: string; approach: string | null; specificationId: string; promptHash: string;
  status: UnitStatus; providerTries: number; firstTryWellFormed: boolean | null; refusal: { code: string; detail: string } | null;
  validation: SpecificationItemValidation | null;
}

const count = <T extends string>(values: readonly T[]): Record<string, number> => { const o: Record<string, number> = {}; for (const v of [...values].sort()) o[v] = (o[v] ?? 0) + 1; return o; };
const briefOf = (c: SpecificationCandidate, stimulus: CandidateStimulus | null) => ({
  stem: c.content.stem, instruction: c.instruction, declaredContext: c.content.context, declaredModel: c.content.declaredModel, marks: c.marks,
  stimulus: stimulus ? { kind: stimulus.kind, parts: stimulus.parts.map((p) => ({ partKind: p.partKind, text: p.text })) } : null,
  selected: c.content.selected ? { options: c.content.selected.options, answerKey: c.content.selected.answerKey, target: c.content.selected.target } : null,
  numeric: c.content.numeric ? { numericKey: c.content.numeric.numericKey, target: c.content.numeric.target } : null,
  constructed: c.content.constructed ? { totalMarks: c.content.constructed.totalMarks, parts: c.content.constructed.parts.map((p) => ({ label: p.label, prompt: p.prompt, marks: p.marks, markPoints: p.markScheme.map((m) => `${m.kind}${m.marks}`), finalAnswer: p.finalAnswer, target: p.target })) } : null,
  credit: c.content.credit,
});

export interface QbR2dOutput { selection: unknown; specifications: unknown; batch: SpecificationBatch; report: Record<string, unknown> & { rows: ReportRow[] }; sameFamilyProof: Record<string, unknown>; approachProof: Record<string, unknown>; rights: Record<string, unknown> }

/** Replays the recording through the harness and the validators. Deterministic: the same recording gives the same output, byte for byte. */
export async function runQbR2d(recording: LiveRecordingFile, extraCorpus: readonly ComparisonEntry[] = [], selection: readonly SelectedAdaptation[] = storedR2dSelection()): Promise<QbR2dOutput> {
  const model = recording.run.requestedModel;
  const units = plannedUnits(model, recording.regenerations, selection);
  // what the harness saw for a prompt is the LAST answer recorded for it (the retry, when there was one)
  const lastByHash = new Map<string, LiveRecording>();
  for (const r of recording.responses) { const prior = lastByHash.get(r.promptHash); if (!prior || r.try >= prior.try) lastByHash.set(r.promptHash, r); }
  const provider = new RecordedResponseProvider(recording.run.provider, model, new Map([...lastByHash.entries()].map(([hash, r]) => [hash, r.rawText])));
  const results: Array<SpecificationUnitResult & { unit: PlannedUnit }> = [];
  const failures: SpecificationGenerationFailure[] = [];
  const rows: ReportRow[] = [];
  for (const u of units) {
    const s = u.selection;
    const tries = recording.responses.filter((r) => r.promptHash === u.promptHash);
    const head = { unitKey: u.unitKey, selectionKey: s.selectionKey, attempt: u.attempt, group: s.group, familyId: s.familyId, targetId: s.targetId, approach: s.approach, specificationId: s.specification.specificationId, promptHash: u.promptHash, providerTries: tries.length, firstTryWellFormed: tries.length === 0 ? null : tries.find((t) => t.try === 1)?.status === 'WELL_FORMED' };
    const accepted = lastByHash.get(u.promptHash);
    if (!accepted) { rows.push({ ...head, status: 'NOT_RUN', refusal: null, validation: null }); continue; }
    const construct = String((s.specification.invariants.construct as { construct?: unknown }).construct ?? '');
    try {
      const r = await generateFromSpecification({ unit: { unitKey: u.unitKey, specification: s.specification, attempt: u.attempt }, constructVocabulary: constructVocabularyOf(construct), policy: policyFor(model, s.specification.variable.language), provider, templateRegistry: SPECIFICATION_TEMPLATE_REGISTRY, runId: recording.run.runId, batchKey: QB_R2D_BATCH_KEY, now: accepted.recordedAt });
      results.push({ ...r, unit: u });
      rows.push({ ...head, status: 'GENERATED', refusal: null, validation: null });
    } catch (e) {
      if (!(e instanceof SpecificationGenerationError)) throw e;
      failures.push({ unitKey: u.unitKey, specificationId: s.specification.specificationId, attempt: u.attempt, promptHash: u.promptHash, code: e.code, detail: e.detail });
      rows.push({ ...head, status: 'GENERATION_REFUSED_BY_HARNESS', refusal: { code: e.code, detail: e.detail }, validation: null });
    }
  }
  const batch = assembleSpecificationBatch({ batchKey: QB_R2D_BATCH_KEY, now: recording.run.startedAt, runId: recording.run.runId, provider: { id: recording.run.provider, model }, generationPolicy: { ...QB_R2D_POLICY }, results, failures });
  const stimulusOf = (c: SpecificationCandidate): CandidateStimulus | null => (c.stimulusKey === null ? null : batch.stimuli.find((x) => x.stimulusKey === c.stimulusKey) ?? null);
  const specOf = new Map(results.map((r) => [r.candidate.candidateKey, r.unit.selection.specification]));
  const validations = new Map<string, SpecificationItemValidation>();
  for (const c of batch.candidates) validations.set(c.unitKey, validateSpecificationCandidate({ candidate: c, specification: specOf.get(c.candidateKey)!, stimulus: stimulusOf(c), siblings: batch.candidates, extraCorpus }));
  for (const row of rows) if (row.status === 'GENERATED') row.validation = validations.get(row.unitKey)!;

  // ---- latest candidate per selected adaptation -----------------------------------------------------------------
  const latest = new Map<string, { row: ReportRow; candidate: SpecificationCandidate }>();
  for (const row of [...rows].sort((a, b) => a.attempt - b.attempt)) if (row.status === 'GENERATED') latest.set(row.selectionKey, { row, candidate: batch.candidates.find((c) => c.unitKey === row.unitKey)! });
  // ---- totals --------------------------------------------------------------------------------------------------
  const generated = rows.filter((r) => r.validation !== null);
  const V = generated.map((r) => r.validation!);
  const N = V.length;
  const firstAttemptRows = rows.filter((r) => r.attempt === 1);
  const ran = rows.filter((r) => r.status !== 'NOT_RUN');
  const answerClasses = count(V.map((v) => v.answerKey.outcome));
  const partClasses = count(V.flatMap((v) => v.answerKey.units.map((u) => u.class)));
  const recomputationApplicable = V.filter((v) => v.machineRecomputation.outcome !== 'NOT_APPLICABLE');
  const stimulusApplicable = V.filter((v) => v.stimulusIntegrity.outcome !== 'NOT_APPLICABLE');
  const itemLevelCompliance = V.filter((v) => v.profileCompliance.issues.every((i) => i.startsWith('SPECIFICATION_LEVEL:')));
  const totals = {
    selectedAdaptations: selection.length, unitsPlanned: units.length, unitsRun: ran.length, regenerations: recording.regenerations.length,
    GENERATED_ITEMS: N,
    generationRefusedByHarness: rows.filter((r) => r.status === 'GENERATION_REFUSED_BY_HARNESS').map((r) => ({ unitKey: r.unitKey, code: r.refusal!.code })),
    notRun: rows.filter((r) => r.status === 'NOT_RUN').map((r) => r.unitKey),
    STRUCTURAL_VALIDATION: `${V.filter((v) => v.structural.outcome === 'PASS').length}/${N}`,
    PROFILE_COMPLIANCE: `${V.filter((v) => v.profileCompliance.outcome === 'PASS').length}/${N}`,
    profileComplianceItemLevelOnly: `${itemLevelCompliance.length}/${N}`,
    specificationLevelFindings: generated.filter((r) => r.validation!.profileCompliance.specificationLevelIssues.length > 0).map((r) => ({ unitKey: r.unitKey, issues: r.validation!.profileCompliance.specificationLevelIssues })),
    CONSTRUCT_PRESERVATION: `${V.filter((v) => v.constructPreservation.outcome !== 'FAIL').length}/${N}`,
    constructPreservationByOutcome: count(V.map((v) => v.constructPreservation.outcome)),
    ANSWER_VALIDATION: `${V.filter((v) => v.answerKey.outcome !== 'FAILED').length}/${N}`,
    answerValidationByItemClass: Object.fromEntries(ANSWER_CLASSES.map((c) => [c, answerClasses[c] ?? 0])),
    answerValidationByKeyedAnswerClass: Object.fromEntries(ANSWER_CLASSES.map((c) => [c, partClasses[c] ?? 0])),
    MACHINE_RECOMPUTATION: `${recomputationApplicable.filter((v) => v.machineRecomputation.outcome === 'PASS').length}/${recomputationApplicable.length}`,
    STIMULUS_INTEGRITY: `${stimulusApplicable.filter((v) => v.stimulusIntegrity.outcome === 'PASS').length}/${stimulusApplicable.length}`,
    ORIGINALITY: `${V.filter((v) => v.originality.outcome === 'PASS_LOW_SIMILARITY').length}/${N}`,
    originalityMaxSimilarity: N === 0 ? null : Math.max(...V.map((v) => v.originality.maxSimilarity)),
    LINEAGE_COMPLETENESS: `${V.filter((v) => v.lineage.outcome === 'PASS').length}/${N}`,
    automatedStatus: count(V.map((v) => v.automatedStatus)),
    /** One line per selected adaptation: the state of its LATEST attempt that produced an item (or that it never produced one). */
    latestAttemptPerAdaptation: count(selection.map((s) => latest.get(s.selectionKey)?.row.validation?.automatedStatus ?? 'NO_ITEM_GENERATED')),
    answerFailuresByKind: count(V.flatMap((v) => v.answerKey.units.flatMap((u) => (u.failureKind ? [u.failureKind] : [])))),
    providerBehaviour: {
      firstAttemptUnits: firstAttemptRows.length,
      firstTryWellFormed: firstAttemptRows.filter((r) => r.firstTryWellFormed === true).length,
      unitsThatNeededTheOneRetry: ran.filter((r) => r.providerTries > 1).length,
      firstAttemptGenerated: firstAttemptRows.filter((r) => r.status === 'GENERATED').length,
      firstAttemptPassedEveryAutomatedCheck: firstAttemptRows.filter((r) => r.validation !== null && r.validation.automatedStatus !== 'AUTOMATED_CHECKS_FAILED').length,
    },
  };

  const side = (s: SelectedAdaptation) => {
    const l = latest.get(s.selectionKey);
    const spec: AdaptationSpecification = s.specification;
    return {
      selectionKey: s.selectionKey, targetId: s.targetId, approach: s.approach, specificationId: spec.specificationId, invariantHash: spec.invariantHash, primaryConceptStableId: spec.primaryConcept.stableId, taskFamily: { id: spec.taskFamily.familyId, version: spec.taskFamily.version },
      variable: Object.fromEntries(COMPARED_DIMENSIONS.map((d) => [d, spec.variable[d]])), language: spec.variable.language,
      generated: l !== undefined, unitKey: l?.row.unitKey ?? null, item: l ? briefOf(l.candidate, stimulusOf(l.candidate)) : null,
      validation: l ? { automatedStatus: l.row.validation!.automatedStatus, profileCompliance: l.row.validation!.profileCompliance.outcome, profileComplianceIssues: l.row.validation!.profileCompliance.issues, constructPreservation: l.row.validation!.constructPreservation.outcome, answerKey: l.row.validation!.answerKey.outcome } : null,
    };
  };
  const itemLevelOk = (s: SelectedAdaptation): boolean => { const v = latest.get(s.selectionKey)?.row.validation; return !!v && v.structural.outcome === 'PASS' && v.profileCompliance.issues.every((i) => i.startsWith('SPECIFICATION_LEVEL:')) && v.constructPreservation.outcome !== 'FAIL' && v.answerKey.outcome !== 'FAILED'; };

  // ---- same family on every system ------------------------------------------------------------------------------
  const sameFamily = selection.filter((s) => s.group === 'SAME_FAMILY_ALL_SYSTEMS');
  const pairs = sameFamily.flatMap((a, i) => sameFamily.slice(i + 1).map((b) => ({ a: a.targetId, b: b.targetId, sameSystem: a.specification.systemProfile.profileId === b.specification.systemProfile.profileId, differingDimensions: differingDimensions(a.specification, b.specification) })));
  const sfChecks = {
    everyAdaptationGenerated: sameFamily.every((s) => latest.has(s.selectionKey)),
    systemsCovered: [...new Set(sameFamily.map((s) => s.specification.systemProfile.profileId))].sort(),
    allFiveSystems: new Set(sameFamily.map((s) => s.specification.systemProfile.profileId)).size === 5,
    oneInvariantHash: new Set(sameFamily.map((s) => s.specification.invariantHash)).size === 1,
    onePrimaryConcept: new Set(sameFamily.map((s) => s.specification.primaryConcept.stableId)).size === 1,
    everyItemDeclaresTheFamilysConstruct: sameFamily.every((s) => latest.get(s.selectionKey)?.candidate.content.declaredModel.construct === (s.specification.invariants.construct as { construct: string }).construct),
    everyItemCarriesTheInvariantHashInItsLineage: sameFamily.every((s) => latest.get(s.selectionKey)?.candidate.lineage.adaptationSpecification.invariantHash === s.specification.invariantHash),
    everyCrossSystemPairDiffersInTheSpecification: pairs.filter((p) => !p.sameSystem).every((p) => p.differingDimensions.length > 0),
    everyItemPassesItsItemLevelAutomatedChecks: sameFamily.every(itemLevelOk),
    responseKindsProduced: [...new Set(sameFamily.flatMap((s) => { const c = latest.get(s.selectionKey)?.candidate; return c ? [c.content.selected ? 'SELECTED' : c.content.numeric ? 'NUMERIC' : 'CONSTRUCTED'] : []; }))].sort(),
  };
  // SUBSTANCE: the family's invariants reach every system and each item keeps them. CONTRACT: each item also follows the response contract.
  const sfSubstance = sfChecks.everyAdaptationGenerated && sfChecks.allFiveSystems && sfChecks.oneInvariantHash && sfChecks.onePrimaryConcept && sfChecks.everyItemDeclaresTheFamilysConstruct && sfChecks.everyItemCarriesTheInvariantHashInItsLineage && sfChecks.everyCrossSystemPairDiffersInTheSpecification
    && sameFamily.every((s) => { const v = latest.get(s.selectionKey)?.row.validation; return !!v && v.profileCompliance.issues.every((i) => i.startsWith('SPECIFICATION_LEVEL:')) && v.constructPreservation.outcome !== 'FAIL' && v.answerKey.outcome !== 'FAILED'; });
  const sfNotContractClean = sameFamily.filter((s) => latest.get(s.selectionKey)?.row.validation?.structural.outcome !== 'PASS').map((s) => ({ selectionKey: s.selectionKey, unitKey: latest.get(s.selectionKey)?.row.unitKey ?? null, structuralIssues: latest.get(s.selectionKey)?.row.validation?.structural.issues ?? ['NOT_GENERATED'] }));
  const sameFamilyProof = {
    kind: 'QB_R2D_MULTI_SYSTEM_SAME_FAMILY_PROOF', label: QB_R2D_LABEL,
    about: 'One task family (the constant-rate linear model) generated live for six components of five assessment systems. Left: what is identical (concept, construct, evidence target, by invariant hash). Right: what each specification decided differently and the item that was written from it. A proof that the pipeline carries a specification into an item; NOT a judgement that any item is good -- no person has reviewed one.',
    familyId: sameFamily[0]?.familyId ?? null, invariantHash: sameFamily[0]?.specification.invariantHash ?? null, invariants: sameFamily[0]?.specification.invariants ?? null,
    targets: sameFamily.map(side), pairwiseSpecificationDifferences: pairs, checks: sfChecks,
    substance: { holds: sfSubstance, means: 'one invariant hash on five systems; every specification pair of different systems differs; every latest item was generated, declares the family\'s construct, complies with its profile at item level, has no construct contradiction and no contradicted key' },
    responseContract: { everyItemClean: sfNotContractClean.length === 0, itemsNotClean: sfNotContractClean },
    MULTI_PROFILE_SAME_FAMILY_PROOF: sfChecks.everyAdaptationGenerated && sfChecks.allFiveSystems && sfChecks.oneInvariantHash && sfChecks.onePrimaryConcept && sfChecks.everyItemDeclaresTheFamilysConstruct && sfChecks.everyItemCarriesTheInvariantHashInItsLineage && sfChecks.everyCrossSystemPairDiffersInTheSpecification && sfChecks.everyItemPassesItsItemLevelAutomatedChecks ? 'PASS' : 'FAIL',
  };

  // ---- STANDARD vs STEM_PLUS ------------------------------------------------------------------------------------
  const byKey = (k: string) => selection.find((s) => s.selectionKey === k)!;
  const pairDefs: Array<[string, string, string]> = [['16.approach.school.standard', '17.approach.school.stem-plus', 'A target with no official constraint: the approach can act.'], ['18.approach.paa.standard', '19.approach.paa.stem-plus', 'A target with OFFICIAL constraints: they win, and the unmet preferences are recorded.'], ['08.proportion-rate-comparison.pisa', '20.approach.pisa.stem-plus', 'PISA: the same family under no approach (EA-1 family version) and under STEM_PLUS (EA-1A family version, same invariants).']];
  const approachPairs = pairDefs.map(([a, b, why]) => {
    const sa = byKey(a), sb = byKey(b);
    const la = sb.specification.learningApproach;
    const ca = latest.get(a)?.candidate, cb = latest.get(b)?.candidate;
    const kindOf = (c?: SpecificationCandidate) => (!c ? null : c.content.selected ? 'SELECTED' : c.content.numeric ? 'NUMERIC' : 'CONSTRUCTED');
    return {
      why, standard: side(sa), stemPlus: side(sb),
      curriculumKnowledgeUnchanged: { samePrimaryConcept: sa.specification.primaryConcept.stableId === sb.specification.primaryConcept.stableId, sameInvariantHash: sa.specification.invariantHash === sb.specification.invariantHash, sameDeclaredConstructInBothItems: !!ca && !!cb && ca.content.declaredModel.construct === cb.content.declaredModel.construct },
      standardRecordedByAbsence: sa.specification.learningApproach === undefined && (ca ? ca.lineage.learningApproach.recordedAs === 'STANDARD_BY_ABSENCE' : null),
      stemPlusRecordedExplicitly: cb ? cb.lineage.learningApproach.recordedAs === 'EXPLICIT' : null,
      specificationDimensionsChangedByTheApproach: differingDimensions(sa.specification, sb.specification),
      honouredPreferences: la?.honouredPreferences ?? [],
      unmetPreferences: (la?.unmetPreferences ?? []).map((u) => ({ preferenceId: u.preferenceId, dimension: u.dimension, wanted: u.wanted, decided: u.decided, overriddenBy: u.overriddenBy, overridingRuleCertification: u.overridingRuleCertification })),
      officialConstraintWon: (la?.unmetPreferences ?? []).some((u) => u.overriddenBy.authority === 'OFFICIAL'),
      observedInTheItems: ca && cb ? { responseKind: { standard: kindOf(ca), stemPlus: kindOf(cb) }, declaredContextKind: { standard: ca.content.context.kind, stemPlus: cb.content.context.kind }, marks: { standard: ca.marks, stemPlus: cb.marks }, reasoningMarkPoints: { standard: ca.content.constructed?.parts.flatMap((p) => p.markScheme).filter((m) => m.kind === 'REASONING').length ?? 0, stemPlus: cb.content.constructed?.parts.flatMap((p) => p.markScheme).filter((m) => m.kind === 'REASONING').length ?? 0 }, hasStimulus: { standard: ca.stimulusKey !== null, stemPlus: cb.stimulusKey !== null } } : null,
      bothGenerated: !!ca && !!cb, bothPassItemLevelAutomatedChecks: itemLevelOk(sa) && itemLevelOk(sb),
    };
  });
  const [school, paa] = approachPairs;
  const apChecks = {
    everyPairGenerated: approachPairs.every((p) => p.bothGenerated),
    knowledgeUnchangedInEveryPair: approachPairs.every((p) => p.curriculumKnowledgeUnchanged.samePrimaryConcept && p.curriculumKnowledgeUnchanged.sameInvariantHash && p.curriculumKnowledgeUnchanged.sameDeclaredConstructInBothItems),
    approachChangedTheItemWhereItCould: school.observedInTheItems !== null && school.observedInTheItems.responseKind.standard === 'SELECTED' && school.observedInTheItems.responseKind.stemPlus === 'CONSTRUCTED' && school.observedInTheItems.reasoningMarkPoints.stemPlus > 0,
    officialConstraintsWonOnPaa: paa.officialConstraintWon && paa.observedInTheItems !== null && paa.observedInTheItems.responseKind.standard === 'SELECTED' && paa.observedInTheItems.responseKind.stemPlus === 'SELECTED',
    unmetPreferencesRecordedWithAuthorityAndCertification: approachPairs.every((p) => p.unmetPreferences.every((u) => u.overriddenBy.ref.length > 0 && (u.overriddenBy.authority === null) === (u.overridingRuleCertification === null))),
    standardByAbsenceEverywhere: approachPairs.every((p) => p.standardRecordedByAbsence !== false && p.stemPlusRecordedExplicitly !== false),
    everyItemPassesItsItemLevelAutomatedChecks: approachPairs.every((p) => p.bothPassItemLevelAutomatedChecks),
  };
  const approachProof = {
    kind: 'QB_R2D_STANDARD_VS_STEM_PLUS_PROOF', label: QB_R2D_LABEL,
    about: 'One family (the rate-comparison model) generated under the STANDARD and the STEM_PLUS learning approach. STEM_PLUS is PROVISIONAL and uncertified; the school profile is an illustrative design. The approach changes how the knowledge is asked, never which knowledge: concept and invariant hash are compared, and every preference an assessment rule overrode is listed with that rule\'s authority and certification status.',
    familyId: 'tf.math.proportion.rate-comparison-model', pairs: approachPairs, checks: apChecks,
    STANDARD_VS_STEM_PLUS_PROOF: Object.values(apChecks).every(Boolean) ? 'PASS' : 'FAIL',
  };

  // ---- rights ---------------------------------------------------------------------------------------------------
  const evidence: ModelOutputRightsEvidence = { provider: recording.run.provider, model, termsReference: null, accountContext: null, termsVersionOrDate: null, commercialUse: { permitted: null, note: null }, restrictions: null, verification: { verifiedByPerson: false, verifiedBy: null, verifiedAt: null } };
  const modelOutput = evaluateModelOutputRights(evidence);
  const dates = recording.responses.map((r) => r.recordedAt).sort();
  const rights = {
    kind: 'QB_R2D_RIGHTS_RECORD', label: QB_R2D_LABEL,
    run: { runId: recording.run.runId, provider: recording.run.provider, requestedModel: model, servedModels: [...new Set(recording.responses.flatMap((r) => (r.servedModel ? [r.servedModel] : [])))].sort(), firstResponseAt: dates[0] ?? null, lastResponseAt: dates[dates.length - 1] ?? null, gateway: recording.run.gateway },
    providerTermsEvidenceInTheRepository: {
      searched: 'src/, docs/, scripts/ for a recorded reference to provider terms, an agreement, an account or a licence governing model output',
      found: 'NONE. The repository records that no such reference is on file (QB_R2B_PRODUCTION_PLANNING_AND_PILOT.md: rights gate NOT_ESTABLISHABLE; QB_R2C_PLANNING_HARDENING_AND_REPEATABLE_GENERATOR.md: REUSE_RIGHTS = NOT_ESTABLISHED). No web page was read and no legal question was decided.',
    },
    modelOutputRightsEvidence: evidence, modelOutputRightsGate: modelOutput,
    candidates: batch.candidates.map((c) => {
      const o = validations.get(c.unitKey)!.originality.outcome;
      const verdict = evaluateRightsGate({ provenance: 'STUDYUS_GENERATED', authorshipTermsReference: null, sourceUsages: [], originality: { outcome: o, acceptedByHuman: false }, licenceReference: null, rightsHolder: null, permittedUse: null, dependencies: [], modelOutputRights: evidence });
      return { candidateKey: c.candidateKey, rightsStatus: verdict.deliverable ? 'UNEXPECTEDLY_ESTABLISHABLE' : 'RIGHTS_NOT_ESTABLISHED', supportedReuseRights: verdict.supportedReuseRights, deliverable: verdict.deliverable, blockers: verdict.blockers };
    }),
    statement: 'Every generated candidate is RIGHTS_NOT_ESTABLISHED. Nothing here is claimed as STUDYUS_OWNED. What is missing is listed in modelOutputRightsGate.missingFields and must be established and verified by a person.',
  };

  const report = {
    kind: 'QB_R2D_AUTOMATED_VALIDATION_REPORT', label: QB_R2D_LABEL,
    about: 'Every result is an AUTOMATED_VALIDATION. None is a review. HUMAN_REVIEW_REQUIRED is never counted as verified. Review status of every item: BLOCKED_NO_QUALIFIED_REVIEWER.',
    run: recording.run, batchKey: QB_R2D_BATCH_KEY, totals,
    proofs: { MULTI_PROFILE_SAME_FAMILY_PROOF: sameFamilyProof.MULTI_PROFILE_SAME_FAMILY_PROOF, STANDARD_VS_STEM_PLUS_PROOF: approachProof.STANDARD_VS_STEM_PLUS_PROOF },
    fixedGates: { GENERATOR_READY_FOR_PILOT_CONTENT: 'NO', READY_FOR_BANK_INGESTION: 'NO', QUESTION_BANK_READY: 'FAIL', reviewStatus: 'BLOCKED_NO_QUALIFIED_REVIEWER', rights: 'RIGHTS_NOT_ESTABLISHED' },
    rows,
  };
  return {
    selection: { kind: 'QB_R2D_SELECTION', label: QB_R2D_LABEL, adaptations: selection.map((s) => ({ selectionKey: s.selectionKey, group: s.group, familyId: s.familyId, familyVersion: s.specification.taskFamily.version, targetId: s.targetId, approach: s.approach, primaryConceptStableId: s.specification.primaryConcept.stableId, specificationId: s.specification.specificationId, invariantHash: s.specification.invariantHash, responseFormat: s.specification.variable.responseFormat.format, calculator: s.specification.variable.toolPolicy.calculator, commandTerm: s.specification.variable.commandTerm, markStructure: s.specification.variable.markStructure, stimulus: s.specification.variable.stimulus, context: s.specification.variable.context.kind, language: s.specification.variable.language, tests: s.tests })) },
    specifications: { kind: 'QB_R2D_SPECIFICATIONS', label: QB_R2D_LABEL, specifications: Object.fromEntries(selection.map((s) => [s.selectionKey, s.specification])) },
    batch, report, sameFamilyProof, approachProof, rights,
  };
}
