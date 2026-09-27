/**
 * Learner progress explainability -- "Dónde estoy -> Qué llevo -> Qué falta
 * -> Qué pasa después", derived ONLY from the canonical Pedagogical Engine
 * decision. Pure: it restates the engine's own requirement statuses and the
 * PRACTICE window the engine used (`decision.practiceProgress`); it never
 * re-implements, loosens or tightens a rule, and never invents a number.
 *
 * PRACTICE rule (CANON-V2 Policy Section 3, unchanged): the concept leaves
 * PRACTICE when at least `requiredPasses` (2) of the last `windowSize` (3)
 * valid Practice attempts scored >= `minimumScorePercent` (80%). There is
 * no average in this rule; help used during Practice does not disqualify
 * an attempt (Practice is assisted).
 */
import { CANONICAL_POLICY } from '@/lib/pedagogical-engine/policy';
import type { CanonicalPedagogicalDecision, PedagogicalStage } from '@/lib/pedagogical-engine/types';
import type { MessageKey } from '@/lib/i18n/messages';

export type ProgressRung = 'LEARN' | 'PRACTICE' | 'PROVE' | 'RETAIN' | 'TRANSFER';
export const PROGRESS_RUNGS: readonly ProgressRung[] = ['LEARN', 'PRACTICE', 'PROVE', 'RETAIN', 'TRANSFER'];

export type ProgressStepState = 'DONE' | 'CURRENT' | 'WAITING' | 'UPCOMING';

export interface ProgressStep {
  stage: ProgressRung;
  state: ProgressStepState;
  /** Only on the current PRACTICE step: passes toward the requirement. */
  counter?: { done: number; required: number };
}

export interface PracticeExplanation {
  passes: number;
  required: number;
  windowSize: number;
  minimumScorePercent: number;
  /** The current window, oldest first (score + pass/fail only). */
  attempts: Array<{ scorePercent: number; passed: boolean }>;
  /** Fewest additional passing practices that satisfy the rule (the window slides). */
  remainingPasses: number;
  satisfied: boolean;
}

export interface LocalizedLine {
  key: MessageKey;
  params: Record<string, string>;
}

export interface ProgressExplanation {
  stage: PedagogicalStage;
  steps: ProgressStep[];
  practice: PracticeExplanation | null;
  /** "Qué falta" -- one sentence. */
  remaining: LocalizedLine;
  /** "Qué pasa después" -- one sentence (null when everything is complete). */
  after: LocalizedLine | null;
  /** Under a REINFORCE overlay (repair after a failed Prove/Transfer). */
  reinforcing: boolean;
}

type DecisionInput = Pick<CanonicalPedagogicalDecision, 'stage' | 'actionState' | 'nextEligibleAt' | 'intervention' | 'requirements' | 'practiceProgress'>;

/** Fewest additional passing attempts so that >= required of the last windowSize pass. */
export function remainingPassesFor(window: boolean[], windowSize: number, required: number): number {
  for (let k = 0; k <= required; k++) {
    const next = [...window, ...Array<boolean>(k).fill(true)].slice(-windowSize);
    if (next.filter(Boolean).length >= required) return k;
  }
  return required;
}

function practiceFrom(decision: DecisionInput): PracticeExplanation {
  const p = decision.practiceProgress;
  const windowSize = p?.windowSize ?? 3;
  const required = p?.requiredPasses ?? 2;
  const attempts = (p?.recentValidAttempts ?? []).map((a) => ({ scorePercent: a.scorePercent, passed: a.passed }));
  const passes = p?.passesInWindow ?? attempts.filter((a) => a.passed).length;
  const satisfied = p?.satisfied ?? false;
  return {
    passes,
    required,
    windowSize,
    minimumScorePercent: p?.minimumScorePercent ?? CANONICAL_POLICY.practice.minimumScorePercent,
    attempts,
    remainingPasses: satisfied ? 0 : remainingPassesFor(attempts.map((a) => a.passed), windowSize, required),
    satisfied,
  };
}

export function buildProgressExplanation(decision: DecisionInput, formatDate: (iso: string) => string = (d) => d.slice(0, 10)): ProgressExplanation {
  const statusOf = (s: ProgressRung) => decision.requirements.find((r) => r.stage === s)?.status ?? 'LOCKED';
  const stage = decision.stage;
  const practice = practiceFrom(decision);

  const steps: ProgressStep[] = PROGRESS_RUNGS.map((rung) => {
    const status = statusOf(rung);
    let state: ProgressStepState;
    if (stage === 'CONSOLIDATED' || status === 'SATISFIED') state = 'DONE';
    else if (rung === stage) state = status === 'WAITING' ? 'WAITING' : 'CURRENT';
    else state = 'UPCOMING';
    const step: ProgressStep = { stage: rung, state };
    if (rung === 'PRACTICE' && state === 'CURRENT') step.counter = { done: practice.passes, required: practice.required };
    return step;
  });

  const P = CANONICAL_POLICY;
  let remaining: LocalizedLine;
  let after: LocalizedLine | null;
  switch (stage) {
    case 'LEARN':
      remaining = { key: 'progress.remaining.LEARN', params: { min: String(P.learn.minimumScorePercentExclusive) } };
      after = { key: 'progress.after.LEARN', params: {} };
      break;
    case 'PRACTICE':
      remaining =
        practice.remainingPasses === 1
          ? { key: 'progress.remaining.PRACTICE_ONE', params: { min: String(practice.minimumScorePercent) } }
          : { key: 'progress.remaining.PRACTICE_MANY', params: { n: String(practice.remainingPasses), min: String(practice.minimumScorePercent) } };
      after = { key: practice.remainingPasses === 1 ? 'progress.after.PRACTICE_ONE' : 'progress.after.PRACTICE_MANY', params: {} };
      break;
    case 'PROVE':
      remaining = { key: 'progress.remaining.PROVE', params: { count: String(P.prove.itemCount), min: String(P.prove.minimumScorePercent) } };
      after = { key: 'progress.after.PROVE', params: {} };
      break;
    case 'RETAIN':
      remaining =
        decision.actionState === 'WAITING' && decision.nextEligibleAt
          ? { key: 'progress.remaining.RETAIN_WAITING', params: { date: formatDate(decision.nextEligibleAt) } }
          : { key: 'progress.remaining.RETAIN', params: { count: String(P.retention.itemCount), min: String(P.retention.minimumScorePercent) } };
      after = { key: 'progress.after.RETAIN', params: {} };
      break;
    case 'TRANSFER':
      remaining = {
        key: 'progress.remaining.TRANSFER',
        params: { count: String(P.transfer.challengeCount), min: String(P.transfer.minimumOverallScorePercent), per: String(P.transfer.perChallengeMinimumScorePercent) },
      };
      after = { key: 'progress.after.TRANSFER', params: {} };
      break;
    default:
      remaining = { key: 'progress.remaining.CONSOLIDATED', params: {} };
      after = null;
  }

  return { stage, steps, practice: stage === 'PRACTICE' ? practice : null, remaining, after, reinforcing: decision.intervention === 'REINFORCE' };
}

/** A stage the learner has not reached yet (its requirement is still LOCKED) -- shown as a future step, never as a problem. */
export function isFutureStage(explanation: ProgressExplanation | null, rung: ProgressRung): boolean {
  return !!explanation && explanation.steps.find((s) => s.stage === rung)?.state === 'UPCOMING';
}

export function fillLine(t: Record<string, string>, line: LocalizedLine): string {
  return Object.entries(line.params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t[line.key] ?? line.key);
}
