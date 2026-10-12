/**
 * Question Factory V5 -- what governs a run: the dashboard, the calibration gates, the stop conditions, the audit
 * sample, the spend guard, the review queue and the checkpoint. A run is restartable from its checkpoints and can
 * never spend past an amount a person authorised.
 *
 * Pure: the caller supplies every timestamp and persists every checkpoint.
 */
import { sha256OfCanonicalJson } from '../generator/provider';
import type { ReviewPriority, SpecificationOutcome, ValidationRecord } from './pipeline';

// ------------------------------------------------------------------------------------------------ dashboard (38)
export interface Metrics {
  rawGenerated: number; structuralPass: number; answerPass: number; constructPass: number; difficultyMatch: number;
  autoApproved: number; humanReview: number; autoRejected: number;
  specifications: number; firstAttemptPass: number; regenerated: number; specificationIssues: number;
  firstAttemptPassRate: number; regenerationRate: number; humanReviewRate: number; rejectionRate: number;
}
const rate = (n: number, d: number): number => (d ? Math.round((n / d) * 10000) / 10000 : 0);

export function metricsOf(outcomes: readonly SpecificationOutcome[]): Metrics {
  const all = outcomes.flatMap((o) => o.attempts.map((a) => a.record));
  const finals = outcomes.map((o) => o.final.record);
  const count = (xs: readonly ValidationRecord[], f: (r: ValidationRecord) => boolean) => xs.filter(f).length;
  const autoApproved = count(finals, (r) => r.reviewDecision === 'AUTO_APPROVE');
  const humanReview = count(finals, (r) => r.reviewDecision === 'HUMAN_REVIEW');
  const autoRejected = count(finals, (r) => r.reviewDecision === 'AUTO_REJECT');
  const firstAttemptPass = outcomes.filter((o) => o.firstAttemptPass).length;
  const regenerated = outcomes.filter((o) => o.regenerated).length;
  return {
    rawGenerated: all.length,
    structuralPass: count(all, (r) => r.stagesCompleted.includes('INDEPENDENT_SOLVING')),
    answerPass: count(all, (r) => r.answerMatch === 'CONFIRMED' || r.answerMatch === 'JUDGED_EQUIVALENT'),
    constructPass: count(all, (r) => r.constructFit === 'PASS'),
    difficultyMatch: count(all, (r) => r.tierFit === 'YES'),
    autoApproved, humanReview, autoRejected,
    specifications: outcomes.length, firstAttemptPass, regenerated, specificationIssues: outcomes.filter((o) => o.specificationIssue).length,
    firstAttemptPassRate: rate(firstAttemptPass, outcomes.length), regenerationRate: rate(regenerated, outcomes.length), humanReviewRate: rate(humanReview, outcomes.length), rejectionRate: rate(autoRejected, outcomes.length),
  };
}

export const DASHBOARD_DIMENSIONS = ['family', 'subject', 'profileId', 'intendedDifficulty', 'itemType'] as const;
export type DashboardDimension = (typeof DASHBOARD_DIMENSIONS)[number];
/** A high global pass rate must not hide a broken family: every figure is also cut by each dimension. */
export function metricsBy(outcomes: readonly SpecificationOutcome[], dimension: DashboardDimension): Record<string, Metrics> {
  const groups = new Map<string, SpecificationOutcome[]>();
  for (const o of outcomes) { const k = String(o.final.record[dimension]); groups.set(k, [...(groups.get(k) ?? []), o]); }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, metricsOf(v)]));
}

// ------------------------------------------------------------------------------------------- calibration (20)
export const CALIBRATION_PHASES = { C1: { size: 20, firstAttemptPassMin: 0.8, humanReviewMax: 0.1 }, C2: { size: 50, firstAttemptPassMin: null, humanReviewMax: 0.1 } } as const;
export type CalibrationPhase = keyof typeof CALIBRATION_PHASES;
export interface GateResult { phase: CalibrationPhase; pass: boolean; unmet: string[] }

/** Whether a calibration batch of one profile cluster passes. A failed batch is discarded, never rescored. */
export function calibrationGate(phase: CalibrationPhase, outcomes: readonly SpecificationOutcome[]): GateResult {
  const rule = CALIBRATION_PHASES[phase];
  const m = metricsOf(outcomes);
  const firsts = outcomes.map((o) => o.attempts[0].record);
  const reason = (r: ValidationRecord) => r.reviewReason.split(':')[0];
  const unmet: string[] = [];
  if (outcomes.length < rule.size) unmet.push(`BATCH_TOO_SMALL: ${outcomes.length} of ${rule.size}`);
  if (rule.firstAttemptPassMin !== null && m.firstAttemptPassRate < rule.firstAttemptPassMin) unmet.push(`FIRST_ATTEMPT_PASS ${m.firstAttemptPassRate} < ${rule.firstAttemptPassMin}`);
  const n = (f: (r: ValidationRecord) => boolean) => firsts.filter(f).length;
  const zero: [string, number][] = [
    ['ANSWER_FAILURES', n((r) => r.answerMatch === 'MISMATCH' || r.flags.some((x) => x.startsWith('KEY_CONTRADICTS') || x.includes('COMPUTED_ANSWER')))],
    ['CONSTRUCT_FAIL', n((r) => r.constructFit === 'FAIL')],
    ['SPEC_LEAKAGE', n((r) => r.flags.includes('SPEC_LEAKAGE'))],
    ['PROVENANCE_ISSUES', n((r) => r.provenance !== 'ORIGINAL_STUDYUS')],
    ['BLUEPRINT_FAILURES', n((r) => r.blueprintFit === 'FAIL')],
    ['STAGE_ERRORS', n((r) => reason(r) === 'STAGE_NOT_COMPLETED')],
  ];
  if (phase === 'C1') zero.push(['SCHEMA_FAILURES', n((r) => r.flags.includes('SCHEMA_INVALID'))]);
  for (const [name, value] of zero) if (value > 0) unmet.push(`${name} = ${value} (must be 0)`);
  if (m.humanReviewRate > rule.humanReviewMax) unmet.push(`HUMAN_REVIEW ${m.humanReviewRate} > ${rule.humanReviewMax}`);
  return { phase, pass: unmet.length === 0, unmet };
}

// ------------------------------------------------------------------------------------------ stop conditions (39)
export const HUMAN_REVIEW_TARGET = 0.08;
export const HUMAN_REVIEW_WARNING = 0.1;
export const DUPLICATE_RATE_LIMIT = 0.1;
export const TIER_DIVERGENCE_LIMIT = 0.25;

export interface StopVerdict { stop: boolean; reasons: string[]; warnings: string[] }
/** Evaluated for ONE profile after each of its scaled batches, oldest batch first. */
export function stopCondition(batches: readonly (readonly SpecificationOutcome[])[]): StopVerdict {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const last = batches[batches.length - 1] ?? [];
  const records = last.flatMap((o) => o.attempts.map((a) => a.record));
  const accepted = last.map((o) => o.final.record).filter((r) => r.reviewDecision === 'AUTO_APPROVE');
  // an error that reached the certified set is the one thing that stops a profile outright
  if (accepted.some((r) => r.answerMatch === 'MISMATCH' || r.constructFit === 'FAIL' || r.flags.includes('SPEC_LEAKAGE') || r.provenance !== 'ORIGINAL_STUDYUS')) reasons.push('A_HARD_GATE_FAILURE_WAS_ACCEPTED');
  if (records.some((r) => r.flags.includes('SPEC_LEAKAGE'))) reasons.push('LEAKAGE_DETECTED');
  if (records.some((r) => r.provenance !== 'ORIGINAL_STUDYUS')) reasons.push('PROVENANCE_PROBLEM');
  if (records.some((r) => r.reviewReason.startsWith('STAGE_NOT_COMPLETED') || r.reviewReason.startsWith('AUTHORING_FAILED'))) reasons.push('PROVIDER_OR_HARNESS_ERROR');
  if (records.some((r) => r.constructFit === 'FAIL')) reasons.push('CONSTRUCT_FAIL_IN_BATCH');
  if (records.some((r) => r.answerMatch === 'MISMATCH')) reasons.push('ANSWER_ERROR_IN_BATCH');
  const hr = batches.map((b) => metricsOf(b).humanReviewRate);
  if (hr.length >= 2 && hr[hr.length - 1] > HUMAN_REVIEW_WARNING && hr[hr.length - 2] > HUMAN_REVIEW_WARNING) reasons.push(`HUMAN_REVIEW_OVER_${HUMAN_REVIEW_WARNING}_TWICE`);
  else if (hr.length && hr[hr.length - 1] > HUMAN_REVIEW_WARNING) warnings.push(`HUMAN_REVIEW ${hr[hr.length - 1]} > ${HUMAN_REVIEW_WARNING}`);
  if (records.length && records.filter((r) => r.originality === 'FAIL').length / records.length > DUPLICATE_RATE_LIMIT) reasons.push('DUPLICATE_RATE_RISING');
  const judged = records.filter((r) => r.tierFit !== null);
  const easy = judged.filter((r) => r.direction === 'TOO_EASY').length;
  const hardSide = judged.filter((r) => r.direction === 'TOO_HARD').length;
  if (judged.length >= 10 && Math.max(easy, hardSide) / judged.length > TIER_DIVERGENCE_LIMIT) reasons.push(`DIFFICULTY_SYSTEMATICALLY_${easy >= hardSide ? 'TOO_EASY' : 'TOO_HARD'}`);
  return { stop: reasons.length > 0, reasons, warnings };
}

// ---------------------------------------------------------------------------------------------- audit sample (19)
export const AUDIT_SAMPLE_RATE = 0.02;
export const AUDIT_ERROR_RATE_PAUSE = 0.01;
/** A 2 % sample of the auto-approved, stratified, reproducible from the seed: at least one item per stratum. */
export function auditSample(approved: readonly ValidationRecord[], seed: string): ValidationRecord[] {
  const strata = new Map<string, ValidationRecord[]>();
  for (const r of approved) { const k = [r.family, r.subject, r.intendedDifficulty, r.itemType, r.component].join('|'); strata.set(k, [...(strata.get(k) ?? []), r]); }
  const out: ValidationRecord[] = [];
  for (const k of [...strata.keys()].sort()) {
    const ranked = [...strata.get(k)!].sort((a, b) => { const x = sha256OfCanonicalJson([seed, a.itemId]); const y = sha256OfCanonicalJson([seed, b.itemId]); return x < y ? -1 : x > y ? 1 : 0; });
    out.push(...ranked.slice(0, Math.max(1, Math.ceil(ranked.length * AUDIT_SAMPLE_RATE))));
  }
  return out;
}
export const auditPausesPromotion = (audited: number, materialErrors: number): boolean => audited > 0 && materialErrors / audited > AUDIT_ERROR_RATE_PAUSE;

// ------------------------------------------------------------------------------------------- review queue (31, 32)
const ORDER: Record<ReviewPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
export const reviewQueue = (records: readonly ValidationRecord[]): ValidationRecord[] =>
  records.filter((r) => r.reviewDecision === 'HUMAN_REVIEW').sort((a, b) => ORDER[a.reviewPriority ?? 'P3'] - ORDER[b.reviewPriority ?? 'P3'] || (a.itemId < b.itemId ? -1 : 1));

// ------------------------------------------------------------------------------------------------- lifecycle (33)
export const V5_LIFECYCLE = ['GENERATED', 'VALIDATING', 'AUTO_REJECTED', 'REVIEW_REQUIRED', 'CERTIFIED', 'PUBLISHED'] as const;
export type V5Lifecycle = (typeof V5_LIFECYCLE)[number];
/** Where a decision leaves an item. Only CERTIFIED and PUBLISHED may ever be Student eligible. */
export const lifecycleAfter = (r: ValidationRecord): V5Lifecycle => (r.reviewDecision === 'AUTO_APPROVE' ? 'CERTIFIED' : r.reviewDecision === 'HUMAN_REVIEW' ? 'REVIEW_REQUIRED' : 'AUTO_REJECTED');
export const isStudentEligibleLifecycle = (s: V5Lifecycle): boolean => s === 'CERTIFIED' || s === 'PUBLISHED';

// ------------------------------------------------------------------------------------------------- spend (28)
export interface SpendLedger { authorizedUsd: number | null; entries: SpendEntry[] }
export interface SpendEntry { batchId: string; provider: string; model: string; purpose: 'GENERATION' | 'VALIDATION'; calls: number; succeeded: number; failed: number; estimatedUsd: number }
export const cumulativeSpend = (l: SpendLedger): number => Math.round(l.entries.reduce((a, e) => a + e.estimatedUsd, 0) * 1e6) / 1e6;

export type SpendPermission = { allowed: true; remainingUsd: number } | { allowed: false; code: 'BUDGET_NOT_AUTHORIZED' | 'BUDGET_WOULD_BE_EXCEEDED'; detail: string };
/** Asked BEFORE a batch with its worst-case cost. No authorised amount means no call; the amount is never raised here. */
export function maySpend(ledger: SpendLedger, worstCaseUsd: number): SpendPermission {
  if (ledger.authorizedUsd === null || !(ledger.authorizedUsd > 0)) return { allowed: false, code: 'BUDGET_NOT_AUTHORIZED', detail: 'the operator has not provided QB_GENERATION_BUDGET_USD' };
  const spent = cumulativeSpend(ledger);
  if (spent + worstCaseUsd > ledger.authorizedUsd) return { allowed: false, code: 'BUDGET_WOULD_BE_EXCEEDED', detail: `spent ${spent} + worst case ${worstCaseUsd} > authorised ${ledger.authorizedUsd}` };
  return { allowed: true, remainingUsd: Math.round((ledger.authorizedUsd - spent - worstCaseUsd) * 1e6) / 1e6 };
}

// -------------------------------------------------------------------------------------------- checkpoint (41, 21)
export interface Checkpoint {
  runId: string; batchId: string; phase: CalibrationPhase | 'SCALE'; profileId: string;
  profileVersion: string; validatorVersion: string;
  candidateIds: string[]; decisions: Record<string, ValidationRecord['reviewDecision']>;
  metrics: Metrics; cumulativeSpendUsd: number; timestamp: string; hash: string;
}
export function checkpoint(input: Omit<Checkpoint, 'hash' | 'metrics' | 'candidateIds' | 'decisions'> & { outcomes: readonly SpecificationOutcome[] }): Checkpoint {
  const { outcomes, ...rest } = input;
  const records = outcomes.flatMap((o) => o.attempts.map((a) => a.record));
  const body = { ...rest, candidateIds: records.map((r) => r.itemId), decisions: Object.fromEntries(outcomes.map((o) => [o.final.record.itemId, o.final.record.reviewDecision])), metrics: metricsOf(outcomes) };
  return { ...body, hash: sha256OfCanonicalJson(body) };
}
/** Batches a restarted run does not repeat. A batch scored by another validator version is NOT reusable. */
export const completedBatchIds = (checkpoints: readonly Checkpoint[], versions: { profileVersion: string; validatorVersion: string }): string[] =>
  checkpoints.filter((c) => c.profileVersion === versions.profileVersion && c.validatorVersion === versions.validatorVersion).map((c) => c.batchId);
/** Brief 21: records scored under a validator version that has since changed must all be revalidated. */
export const needsRevalidation = (records: readonly ValidationRecord[], currentValidatorVersion: string): ValidationRecord[] => records.filter((r) => r.validatorVersion !== currentValidatorVersion);
