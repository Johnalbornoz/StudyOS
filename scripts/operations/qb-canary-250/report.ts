/**
 * QUESTION FACTORY CANARY 250 -- the metrics and every derived artifact, from the run log (pure). FROZEN.
 *
 * EVERY METRIC IS DEFINED HERE, with its source: the deterministic VALIDATORS (revision 4), the AI REVIEWER (with
 * the decision policy), or EITHER. Reviewer-sourced counts are over the items that were actually reviewed; the
 * number reviewed is always reported beside them.
 *
 * No artifact here is an approval of anything. All content is DEV_TEST_CONTENT with RIGHTS_NOT_ESTABLISHED, is
 * written only under the canary's own directory, and reaches no database, pool or Question Bank.
 */
import type { SpecificationItemValidationR4 } from '@/lib/exam-core/question-bank/production/specification-validators-r4';
import { hasGateFail } from '../qb-r2e/gates';
import { CANARY_CUMULATIVE_CAP_USD, GENERATOR_PRICE_BASIS, REVIEWER_PRICE_BASIS } from './budget';
import { CALIBRATION_NOT_FOR_RESCORING, emptyCalibrationSet } from './calibration';
import type { CanaryEvidence } from './evidence';
import { balanceOf, CANARY_SLOTS, CANARY_UNSUPPLIED_STRATA, type CanaryManifest, type CanarySlot } from './manifest';
import { CANARY_LABEL, CANARY_VERSIONS, deriveGeneration, deriveReviews, generationIsClosed, MAX_AUTOMATIC_REGENERATIONS, validateBatch, validatorStrictPass, type GenerationResult, type ReviewResult } from './pipeline';
import { AI_REVIEW_KIND, AI_REVIEW_LABEL, DECISION_POLICY, REDACTED_GENERATOR_FIELDS, REDACTION_RULE, redactForReview, redactStimulus, REVIEW_DIMENSIONS, REVIEW_STATUS_UNCHANGED, REVIEWER_RUN_PARAMETERS, REVIEWER_VERSION } from './reviewer';
import type { RunLog } from './run-log';
import { selectCalibrationSample, type SampleCandidate } from './sample';

export const CANARY_DIR = 'docs/exams/question-bank/pilots/qb-canary-250' as const;
export const CANARY_FILES = {
  freeze: 'freeze.json', manifest: 'manifest.json', projection: 'spend-projection.json', calibrationTemplate: 'human-calibration-set.template.json',
  runLog: 'run-log.jsonl', candidates: 'generated-candidates.json', validation: 'automated-validation-report.json', aiReview: 'ai-review.json', metrics: 'metrics.json', ledger: 'spend-ledger.json',
  sample: 'human-calibration-sample.json', packet: 'human-calibration-packet.json', sampleKey: 'human-calibration-key.json', calibrationSet: 'human-calibration-set.json', rights: 'rights-record.json',
} as const;
export const serializeCanaryArtifact = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const METRIC_DEFINITIONS = {
  GENERATED: { source: 'RUN_LOG + HARNESS', definition: 'Slots whose one generation call returned an answer the version-3 harness accepted as a candidate, over 250.' },
  PROVIDER_FAILURES: { source: 'RUN_LOG + HARNESS', definition: 'Slots with no usable answer from the provider: a transport failure, a rejected request, a call started and never recorded (NO_CONTENT), or an answer that is not the strict response shape -- not JSON, schema-invalid, empty, truncated, or a provider refusal (MALFORMED).' },
  HARNESS_REFUSALS: { source: 'HARNESS', definition: 'Slots whose answer was well-formed and was refused by one of the harness\'s named rules (duplicate labels, leaked vocabulary, marks or command terms outside the specification, ...). Not a provider failure; not a candidate.' },
  NOT_CALLED_BUDGET_STOP: { source: 'RUN_LOG', definition: 'Slots (or candidates, for the review phase) the budget guard refused to call.' },
  VALIDATOR_STRICT_PASS: { source: 'VALIDATOR', definition: 'Candidates with no gate failure under revision 4, construct preservation PASS and item writing PASS (the strict pass of QB-R2E / QB-R2F).' },
  APPROVED: { source: 'AI_REVIEWER + DECISION_POLICY', definition: 'Reviewed candidates the decision policy classified APPROVED. An AI classification: not a human review, not an approval for use.' },
  NEEDS_HUMAN_REVIEW: { source: 'AI_REVIEWER + DECISION_POLICY', definition: 'Reviewed candidates the decision policy classified NEEDS_HUMAN_REVIEW.' },
  REJECTED: { source: 'AI_REVIEWER + DECISION_POLICY', definition: 'Reviewed candidates the decision policy classified REJECTED.' },
  REVIEWER_FAILURES: { source: 'RUN_LOG + REVIEW_PARSER', definition: 'Candidates whose one review call gave no usable review: transport failure, rejected request, call never recorded, truncated answer, provider refusal, malformed answer, or an answer refused by the no-repair rule. Never counted as approved.' },
  ACADEMIC_FAILURES: { source: 'EITHER', definition: 'VALIDATOR: answer key FAILED or machine recomputation FAIL. AI_REVIEWER: ACADEMIC_CORRECTNESS = FAIL or the reviewer\'s own solution DISAGREES with the key. EITHER: the union.' },
  ANSWER_KEY_FAILURES: { source: 'EITHER', definition: 'VALIDATOR: answer key class FAILED. AI_REVIEWER: the reviewer\'s own solution DISAGREES with the key. EITHER: the union.' },
  CONSTRUCT_FAILURES: { source: 'EITHER', definition: 'VALIDATOR: construct preservation FAIL. AI_REVIEWER: CONSTRUCT_VALIDITY = FAIL. EITHER: the union.' },
  PROFILE_FAILURES: { source: 'EITHER', definition: 'VALIDATOR: profile compliance FAIL (including the item demand policy). AI_REVIEWER: PROFILE_FIDELITY = FAIL. EITHER: the union.' },
  STRUCTURAL_FAILURES: { source: 'EITHER', definition: 'VALIDATOR: structural FAIL. AI_REVIEWER: RESPONSE_CONTRACT = FAIL. EITHER: the union.' },
  MATERIAL_DUPLICATES: { source: 'VALIDATOR', definition: 'Candidates whose originality outcome is not PASS_LOW_SIMILARITY: textual similarity, the same parameter set, a shared defining parameter pair or a near-duplicate scenario, against the other fresh candidates and every QB-R2D and QB-R2E candidate. The reviewer\'s ORIGINALITY verdict is reported beside it and is not part of this count (the reviewer is shown no corpus).' },
  GUIDANCE_FOLLOWED: { source: 'VALIDATOR-SIDE CHECK', definition: 'Candidates whose declared model uses the slot\'s pinned parameter values (and, for claim evaluation, keys the slot\'s verdict where a verdict is keyed).' },
  ASSUMED_CUMULATIVE_SPEND_USD: { source: 'RUN_LOG + EARLIER LEDGERS', definition: 'QB-R2D + QB-R2E spend + canary spend, on the ASSUMED price bases. A call never recorded is charged at its worst case. Not an invoice.' },
  HUMAN_CALIBRATION_SAMPLE_PROPOSED: { source: 'SAMPLE_PROCEDURE', definition: 'The number of items the frozen sample procedure selects, with the reasons for each.' },
} as const;

type ValidatorOutcome = 'STRICT_PASS' | 'DOUBT' | 'FAIL';
const validatorOutcomeOf = (v: SpecificationItemValidationR4): ValidatorOutcome => (validatorStrictPass(v.gates) ? 'STRICT_PASS' : hasGateFail(v.gates) ? 'FAIL' : 'DOUBT');
type AiOutcome = 'APPROVED' | 'NEEDS_HUMAN_REVIEW' | 'REJECTED' | 'REVIEWER_FAILURE' | 'NOT_REVIEWED';
const aiOutcomeOf = (r: ReviewResult): AiOutcome => (r.state === 'REVIEWED' ? r.decision!.classification : r.state === 'REVIEWER_FAILURE' ? 'REVIEWER_FAILURE' : 'NOT_REVIEWED');
const tally = <T>(xs: readonly T[], key: (x: T) => string): Record<string, number> => { const m: Record<string, number> = {}; for (const x of xs) m[key(x)] = (m[key(x)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1))); };

export interface CanaryRow { slot: CanarySlot; generation: GenerationResult; validation: SpecificationItemValidationR4 | null; review: ReviewResult }
export function computeMetrics(rows: readonly CanaryRow[], spend: { priorUsd: number; generationUsd: number; reviewUsd: number }, sampleSize: number) {
  const candidates = rows.filter((r) => r.validation !== null);
  const reviewed = candidates.filter((r) => r.review.state === 'REVIEWED');
  const dim = (r: CanaryRow, d: (typeof REVIEW_DIMENSIONS)[number]) => r.review.review?.dimensions[d].verdict ?? null;
  const both = (validator: (r: CanaryRow) => boolean, reviewer: (r: CanaryRow) => boolean) => {
    const v = candidates.filter(validator), a = reviewed.filter(reviewer);
    return { validator: v.length, aiReviewer: a.length, either: new Set([...v, ...a].map((r) => r.slot.slotId)).size, both: v.filter((r) => a.includes(r)).length };
  };
  const g = (r: CanaryRow) => r.validation!.gates;
  const group = (key: (r: CanaryRow) => string) => Object.fromEntries([...new Set(rows.map(key))].sort().map((k) => {
    const rs = rows.filter((r) => key(r) === k), cs = rs.filter((r) => r.validation !== null);
    return [k, { slots: rs.length, generated: cs.length, validatorStrictPass: cs.filter((r) => validatorStrictPass(g(r))).length, approved: cs.filter((r) => aiOutcomeOf(r.review) === 'APPROVED').length, needsHumanReview: cs.filter((r) => aiOutcomeOf(r.review) === 'NEEDS_HUMAN_REVIEW').length, rejected: cs.filter((r) => aiOutcomeOf(r.review) === 'REJECTED').length, reviewerFailures: cs.filter((r) => aiOutcomeOf(r.review) === 'REVIEWER_FAILURE').length, notReviewed: cs.filter((r) => aiOutcomeOf(r.review) === 'NOT_REVIEWED').length }];
  }));
  const matrix: Record<string, Record<string, number>> = {};
  for (const v of ['STRICT_PASS', 'DOUBT', 'FAIL'] as const) { matrix[v] = {}; for (const a of ['APPROVED', 'NEEDS_HUMAN_REVIEW', 'REJECTED', 'REVIEWER_FAILURE', 'NOT_REVIEWED'] as const) matrix[v][a] = candidates.filter((r) => validatorOutcomeOf(r.validation!) === v && aiOutcomeOf(r.review) === a).length; }
  const proposed: Record<string, Record<string, number>> = {};
  for (const v of ['STRICT_PASS', 'DOUBT', 'FAIL'] as const) { proposed[v] = {}; for (const a of ['APPROVED', 'NEEDS_HUMAN_REVIEW', 'REJECTED'] as const) proposed[v][a] = reviewed.filter((r) => validatorOutcomeOf(r.validation!) === v && r.review.review!.classification === a).length; }
  const cumulative = spend.priorUsd + spend.generationUsd + spend.reviewUsd;
  return {
    slots: rows.length, MAX_AUTOMATIC_REGENERATIONS,
    GENERATED: { count: candidates.length, of: CANARY_SLOTS },
    PROVIDER_FAILURES: { count: rows.filter((r) => r.generation.state === 'MALFORMED' || r.generation.state === 'NO_CONTENT').length, byCode: tally(rows.filter((r) => r.generation.state === 'MALFORMED' || r.generation.state === 'NO_CONTENT'), (r) => `${r.generation.state}:${r.generation.code}`) },
    HARNESS_REFUSALS: { count: rows.filter((r) => r.generation.state === 'REFUSED_BY_HARNESS').length, byCode: tally(rows.filter((r) => r.generation.state === 'REFUSED_BY_HARNESS'), (r) => String(r.generation.code)) },
    NOT_CALLED_BUDGET_STOP: { generation: rows.filter((r) => r.generation.state === 'NOT_CALLED_BUDGET_STOP').length, review: candidates.filter((r) => r.review.state === 'NOT_CALLED_BUDGET_STOP').length },
    NOT_RUN: { generation: rows.filter((r) => r.generation.state === 'NOT_RUN').length, review: candidates.filter((r) => r.review.state === 'NOT_RUN').length },
    VALIDATOR_STRICT_PASS: candidates.filter((r) => validatorStrictPass(g(r))).length,
    REVIEWED: reviewed.length,
    APPROVED: candidates.filter((r) => aiOutcomeOf(r.review) === 'APPROVED').length,
    NEEDS_HUMAN_REVIEW: candidates.filter((r) => aiOutcomeOf(r.review) === 'NEEDS_HUMAN_REVIEW').length,
    REJECTED: candidates.filter((r) => aiOutcomeOf(r.review) === 'REJECTED').length,
    REVIEWER_FAILURES: { count: candidates.filter((r) => r.review.state === 'REVIEWER_FAILURE').length, byCode: tally(candidates.filter((r) => r.review.state === 'REVIEWER_FAILURE'), (r) => String(r.review.code)) },
    ACADEMIC_FAILURES: both((r) => g(r).answerKey === 'FAILED' || g(r).machineRecomputation === 'FAIL', (r) => dim(r, 'ACADEMIC_CORRECTNESS') === 'FAIL' || r.review.review!.independentSolution.agreesWithKey === 'DISAGREES'),
    ANSWER_KEY_FAILURES: both((r) => g(r).answerKey === 'FAILED', (r) => r.review.review!.independentSolution.agreesWithKey === 'DISAGREES'),
    CONSTRUCT_FAILURES: both((r) => g(r).constructPreservation === 'FAIL', (r) => dim(r, 'CONSTRUCT_VALIDITY') === 'FAIL'),
    PROFILE_FAILURES: both((r) => g(r).profileCompliance === 'FAIL', (r) => dim(r, 'PROFILE_FIDELITY') === 'FAIL'),
    STRUCTURAL_FAILURES: both((r) => g(r).structural === 'FAIL', (r) => dim(r, 'RESPONSE_CONTRACT') === 'FAIL'),
    MATERIAL_DUPLICATES: { count: candidates.filter((r) => g(r).originality !== 'PASS_LOW_SIMILARITY').length, byOutcome: tally(candidates.filter((r) => g(r).originality !== 'PASS_LOW_SIMILARITY'), (r) => g(r).originality), withBatchDiversityFinding: candidates.filter((r) => r.validation!.revision4.batchDiversity.length > 0).length, reviewerOriginalityFail: reviewed.filter((r) => dim(r, 'ORIGINALITY') === 'FAIL').length },
    GUIDANCE_FOLLOWED: { count: candidates.filter((r) => r.generation.guidanceFollowed === true).length, of: candidates.length },
    validatorGateFailures: Object.fromEntries((['structural', 'profileCompliance', 'constructPreservation', 'machineRecomputation', 'stimulusIntegrity', 'lineage', 'learnerTextLeakage'] as const).map((k) => [k, candidates.filter((r) => g(r)[k] === 'FAIL').length])),
    validatorOther: { constructWeak: candidates.filter((r) => g(r).constructPreservation === 'WEAK').length, itemWritingFlagged: candidates.filter((r) => g(r).itemWriting === 'FLAGGED').length, answerKeyClass: tally(candidates, (r) => g(r).answerKey) },
    reviewerDimensionVerdicts: Object.fromEntries(REVIEW_DIMENSIONS.map((d) => [d, tally(reviewed, (r) => String(dim(r, d)))])),
    decisionRules: tally(reviewed, (r) => r.review.decision!.rule),
    disagreements: tally(reviewed.flatMap((r) => r.review.decision!.disagreements), (d) => d),
    agreementMatrix: { rows: 'VALIDATOR (STRICT_PASS / DOUBT = no gate failure but construct WEAK or item writing FLAGGED / FAIL)', columns: 'AI classification by the decision policy', matrix },
    reviewerProposalMatrix: { about: 'the reviewer model\'s own proposed classification, before the decision policy, against the validators', matrix: proposed },
    breakdowns: { bySystem: group((r) => r.slot.systemId), byResponseType: group((r) => r.slot.strata.responseType), byFamily: group((r) => r.slot.familyId), byApproach: group((r) => r.slot.approach), byBand: group((r) => r.slot.strata.band) },
    ASSUMED_CUMULATIVE_SPEND_USD: { cumulative: cumulative, capUsd: CANARY_CUMULATIVE_CAP_USD, earlierRuns: spend.priorUsd, canaryGeneration: spend.generationUsd, canaryReview: spend.reviewUsd, basis: 'ASSUMED prices; not an invoice', generatorPriceBasis: GENERATOR_PRICE_BASIS, reviewerPriceBasis: REVIEWER_PRICE_BASIS },
    HUMAN_CALIBRATION_SAMPLE_PROPOSED: sampleSize,
  };
}

const sampleCandidateOf = (r: CanaryRow): SampleCandidate => ({
  slotId: r.slot.slotId, system: r.slot.systemId, responseType: r.slot.strata.responseType, ai: aiOutcomeOf(r.review),
  rule: r.review.decision?.rule ?? r.review.code, disagreements: r.review.decision?.disagreements ?? [],
  doubts: r.review.review ? REVIEW_DIMENSIONS.filter((d) => ['CONCERN', 'FAIL'].includes(r.review.review!.dimensions[d].verdict)).map((d) => `${d}=${r.review.review!.dimensions[d].verdict}`) : [],
  agreement: r.review.review?.independentSolution.agreesWithKey ?? null, answerKeyClass: r.validation?.gates.answerKey ?? null,
});

export interface CanaryDerivation { rows: CanaryRow[]; generationClosed: boolean; artifacts: Record<Exclude<keyof typeof CANARY_FILES, 'freeze' | 'manifest' | 'projection' | 'calibrationTemplate' | 'runLog'>, unknown>; metrics: ReturnType<typeof computeMetrics> }
/** Every derived artifact, from the manifest and the run log alone. The same log gives the same bytes. */
export async function deriveCanary(manifest: CanaryManifest, log: RunLog, evidence: CanaryEvidence, model: string): Promise<CanaryDerivation> {
  const header = log.header();
  const freeze = header?.freeze ?? null;
  const generation = await deriveGeneration(manifest, log, evidence, model);
  const validations = validateBatch(generation, evidence);
  const reviews = deriveReviews(generation, validations, log);
  const rows: CanaryRow[] = generation.map((gen, i) => ({ slot: gen.slot, generation: gen, validation: validations.get(gen.slot.slotId) ?? null, review: reviews[i] }));
  const candidates = rows.filter((r) => r.validation !== null);
  const allReviewed = generationIsClosed(generation) && candidates.every((r) => r.review.state !== 'NOT_RUN');
  const sample = allReviewed ? selectCalibrationSample(candidates.map(sampleCandidateOf)) : null;
  const spend = { priorUsd: evidence.priorSpendUsd.total, generationUsd: log.spentUsdOf('GENERATION'), reviewUsd: log.spentUsdOf('REVIEW') };
  const metrics = computeMetrics(rows, spend, sample?.counts.total ?? 0);
  const stamp = { label: CANARY_LABEL, freeze, run: header ? { runId: header.runId, startedAt: header.startedAt } : null, versions: CANARY_VERSIONS };
  const byId = new Map(rows.map((r) => [r.slot.slotId, r]));
  const humanView = (r: CanaryRow) => ({ canonicalConcept: r.slot.specification.primaryConcept, evidenceTarget: r.slot.specification.invariants.evidenceTarget, target: r.slot.targetId, taskFamily: r.slot.familyId, learningApproach: r.slot.approach, request: r.slot.request, specificationId: r.slot.specification.specificationId, item: redactForReview(r.generation.candidate!), stimulus: redactStimulus(r.generation.stimulus) });
  let seq = 0, running = spend.priorUsd;
  const ledgerEntries = log.lines.flatMap((l) => {
    if (l.type !== 'CALL_STARTED') return [];
    const o = log.outcomeOf(l.phase, l.slotId);
    const finished = o.state === 'FINISHED' ? o.finished : null;
    const cost = finished ? finished.costUsdAssumed : l.worstCaseCostUsdAssumed;
    running += cost; seq += 1;
    return [{ seq, phase: l.phase, slotId: l.slotId, requestHash: l.requestHash, startedAt: l.at, finishedAt: finished?.at ?? null, provider: l.provider, requestedModel: l.requestedModel, servedModel: finished?.servedModel ?? null, responseId: finished?.responseId ?? null, finishReason: finished?.finishReason ?? null, maxOutputTokens: l.maxOutputTokens, inputTokenUpperBound: l.inputTokenUpperBound, worstCaseCostUsdAssumed: l.worstCaseCostUsdAssumed, outcome: finished ? finished.status : 'NO_RESPONSE_RECORDED', usage: finished?.usage ?? null, usageSource: finished ? finished.usageSource : 'NO_RESPONSE_RECORDED_CHARGED_AT_WORST_CASE', costUsdAssumed: cost, cumulativeAfterUsdAssumed: running }];
  });
  return {
    rows, generationClosed: generationIsClosed(generation), metrics,
    artifacts: {
      candidates: { kind: 'QB_CANARY_250_GENERATED_CANDIDATES', ...stamp, contentUseClass: 'DEV_TEST_CONTENT', rights: 'RIGHTS_NOT_ESTABLISHED', slots: rows.map((r) => ({ slotId: r.slot.slotId, state: r.generation.state, code: r.generation.code, detail: r.generation.detail, promptHash: r.generation.plan.promptHash, requestHash: r.generation.plan.requestHash, guidance: r.slot.guidance, guidanceFollowed: r.generation.guidanceFollowed, candidate: r.generation.candidate, stimulus: r.generation.stimulus })) },
      validation: { kind: 'QB_CANARY_250_AUTOMATED_VALIDATION', ...stamp, isHumanReview: false, reviewStatus: REVIEW_STATUS_UNCHANGED, items: candidates.map((r) => ({ slotId: r.slot.slotId, strictPass: validatorStrictPass(r.validation!.gates), outcome: validatorOutcomeOf(r.validation!), validation: r.validation })) },
      aiReview: { kind: 'QB_CANARY_250_AI_REVIEW', reviewKind: AI_REVIEW_KIND, aiReviewLabel: AI_REVIEW_LABEL, isHumanReview: false, reviewStatus: REVIEW_STATUS_UNCHANGED, ...stamp, reviewer: REVIEWER_VERSION, reviewerRun: REVIEWER_RUN_PARAMETERS, decisionPolicy: DECISION_POLICY, redaction: { rule: REDACTION_RULE, redactedGeneratorFields: REDACTED_GENERATOR_FIELDS }, reviews: rows.map((r) => r.review) },
      metrics: { kind: 'QB_CANARY_250_METRICS', ...stamp, definitions: METRIC_DEFINITIONS, complete: allReviewed, balance: balanceOf(manifest), unsuppliedStrata: CANARY_UNSUPPLIED_STRATA, metrics },
      ledger: { kind: 'QB_CANARY_250_SPEND_LEDGER', ...stamp, basis: 'ASSUMED prices; not an invoice', capUsd: CANARY_CUMULATIVE_CAP_USD, generatorPriceBasis: GENERATOR_PRICE_BASIS, reviewerPriceBasis: REVIEWER_PRICE_BASIS, earlierRunsUsd: evidence.priorSpendUsd, canaryUsd: { generation: spend.generationUsd, review: spend.reviewUsd }, cumulativeUsd: spend.priorUsd + spend.generationUsd + spend.reviewUsd, entries: ledgerEntries },
      sample: sample ? { kind: 'QB_CANARY_250_HUMAN_CALIBRATION_SAMPLE', ...stamp, status: 'PROPOSED', ...sample } : { kind: 'QB_CANARY_250_HUMAN_CALIBRATION_SAMPLE', ...stamp, status: 'NOT_YET_SELECTED: the procedure runs when every candidate has a review outcome' },
      // what a person receives: the items in an order that tells nothing; blind items without the AI decision and the validator outcome
      packet: sample ? { kind: 'QB_CANARY_250_HUMAN_CALIBRATION_PACKET', ...stamp, forHumanReviewers: true, notForRescoring: CALIBRATION_NOT_FOR_RESCORING, items: sample.packetOrder.map((slotId, i) => { const e = sample.entries.find((x) => x.slotId === slotId)!; const r = byId.get(slotId)!; return { position: i + 1, ITEM_ID: slotId, ...humanView(r), ...(e.blind ? { presentation: 'BLIND' } : { presentation: 'WITH_AUTOMATED_RESULTS', aiReview: { kind: AI_REVIEW_KIND, isHumanReview: false, state: r.review.state, classification: r.review.decision?.classification ?? null, reviewerQuestion: r.review.decision?.reviewerQuestion ?? null, dimensions: r.review.review?.dimensions ?? null, independentSolution: r.review.review?.independentSolution ?? null }, validatorGates: r.validation!.gates }) }; }) } : null,
      sampleKey: sample ? { kind: 'QB_CANARY_250_HUMAN_CALIBRATION_KEY', ...stamp, notForReviewers: 'Do not give this file to a person reviewing BLIND items.', items: sample.entries.map((e) => { const r = byId.get(e.slotId)!; return { ITEM_ID: e.slotId, blind: e.blind, reasons: e.reasons, uncertaintyScore: e.uncertaintyScore, aiOutcome: aiOutcomeOf(r.review), decision: r.review.decision, validatorOutcome: validatorOutcomeOf(r.validation!), validatorGates: r.validation!.gates }; }) } : null,
      calibrationSet: sample ? emptyCalibrationSet({ items: sample.entries.map((e) => { const a = aiOutcomeOf(byId.get(e.slotId)!.review); return { slotId: e.slotId, aiDecision: a === 'NOT_REVIEWED' ? 'REVIEWER_FAILURE' : a }; }), runId: header?.runId ?? null, freezeCommitSha: freeze?.freezeCommitSha ?? null, freezeManifestHash: freeze?.manifestHash ?? null, sampleProcedure: sample.procedure, reviewerVersion: `${REVIEWER_VERSION.id}@${REVIEWER_VERSION.version}` }) : null,
      rights: { kind: 'QB_CANARY_250_RIGHTS_RECORD', ...stamp, contentUseClass: 'DEV_TEST_CONTENT', rights: 'RIGHTS_NOT_ESTABLISHED', ownership: 'NOT_CLAIMED', statement: 'Model output generated for a development test. No rights are established and no ownership is claimed. Nothing here is ingested, pooled, approved or delivered to a learner.', candidates: candidates.map((r) => ({ slotId: r.slot.slotId, candidateKey: r.generation.candidate!.candidateKey, provenance: r.generation.candidate!.provenance, contentUseClass: r.generation.candidate!.contentUseClass, rights: 'RIGHTS_NOT_ESTABLISHED' })) },
    },
  };
}
