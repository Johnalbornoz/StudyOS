/**
 * Practice Coach / time review -- what the exam runtime may say about the SPEED of an item (pure, no IO, no model).
 *
 * Everything here is read from certified content: the item's inherited speed-strategy family
 * (strategy-resolution.ts) and its governed timing. It is not the answer key and not an explanation, and it is kept
 * out of both. An item with no certified strategy has no coach: nothing is improvised.
 */
import type { ExamItem } from '@/lib/exam-core/items';
import { isAssisted, timeVerdict, type InheritedStrategy, type SpeedStrategy, type StrategyType, type TimeVerdict, type TimingProvenance } from '../engines/speed-strategy';
import { strategyForBankItem } from './strategy-resolution';

export interface CoachTiming { targetSeconds: number; skipThresholdSeconds: number; targetProvenance: TimingProvenance; skipThresholdProvenance: TimingProvenance }
/** The strategy as the browser may show it: the method, never a key. */
export interface CoachStrategyView {
  strategyId: string; strategyVersion: number; strategyType: StrategyType; noReliableShortcut: boolean; title: string;
  fastPath: string[]; whyFastPathWorks: string; directPath: string[]; commonTimeTrap: string; whenNotToUse: string; mentalMathOpportunity: string | null;
}
export interface ItemCoach { timing: CoachTiming; strategy: SpeedStrategy; inherited: InheritedStrategy }

/** The coach of a server-held item, or null: only a certified Exam Bank item with a proven inherited family has one. */
export function coachOfItem(item: ExamItem): ItemCoach | null {
  const l = item.exam.certifiedLineage;
  if (!l || item.exam.source !== 'APPROVED_BANK' || item.exam.studyusCertified !== true) return null;
  const r = strategyForBankItem({ systemId: l.systemId, componentId: l.adapterId, constructFamilyId: l.constructFamilyId, constructFamilyVersion: l.constructFamilyVersion, language: (item as { language?: string }).language ?? 'es', stem: item.question, keyText: item.correctAnswer, hasOptions: (item.options ?? []).length > 0 });
  if (!r.ok) return null;
  const s = r.strategy;
  return { timing: { targetSeconds: s.targetTimeSeconds, skipThresholdSeconds: s.skipThresholdSeconds, targetProvenance: s.timingProvenance.target, skipThresholdProvenance: s.timingProvenance.skipThreshold }, strategy: s, inherited: r.inherited };
}

export const strategyClientView = (s: SpeedStrategy): CoachStrategyView => ({
  strategyId: s.strategyId, strategyVersion: s.strategyVersion, strategyType: s.strategyType, noReliableShortcut: s.strategyType === 'NO_RELIABLE_SHORTCUT', title: s.strategyTitle,
  fastPath: [...s.fastPath], whyFastPathWorks: s.whyFastPathWorks, directPath: [...s.directPath], commonTimeTrap: s.commonTimeTrap, whenNotToUse: s.whenNotToUse, mentalMathOpportunity: s.mentalMathOpportunity,
});

const secondsBetween = (from: string | undefined, toMs: number): number | null => { const t = from ? new Date(from).getTime() : NaN; return Number.isFinite(t) ? Math.max(0, Math.round((toMs - t) / 1000)) : null; };

/** What is stored with a response (grading_detail.coach): the timing, the exact inherited strategy and whether it was opened first. Never part of the score. */
export interface CoachRecord {
  v: 1; assisted: boolean; strategyRevealedAt: string | null; elapsedSeconds: number | null; targetSeconds: number; skipThresholdSeconds: number;
  targetProvenance: TimingProvenance; skipThresholdProvenance: TimingProvenance; strategy: InheritedStrategy;
}
export function coachRecordOf(coach: ItemCoach, state: { deliveredAt?: string; shownAt?: string; strategyRevealedAt?: string }, answeredAtMs: number): CoachRecord {
  const revealedMs = state.strategyRevealedAt ? new Date(state.strategyRevealedAt).getTime() : null;
  return {
    v: 1, assisted: isAssisted({ strategyRevealedAtMs: revealedMs, answeredAtMs }), strategyRevealedAt: state.strategyRevealedAt ?? null, elapsedSeconds: secondsBetween(state.shownAt ?? state.deliveredAt, answeredAtMs),
    targetSeconds: coach.timing.targetSeconds, skipThresholdSeconds: coach.timing.skipThresholdSeconds, targetProvenance: coach.timing.targetProvenance, skipThresholdProvenance: coach.timing.skipThresholdProvenance, strategy: coach.inherited,
  };
}

/** The review of one answered item: how it went against the clock, and the certified method. Shown after answering (coach) or after submission (simulation). */
export interface SpeedReview { correct: boolean; assisted: boolean; targetSeconds: number; skipThresholdSeconds: number; actualSeconds: number | null; deltaSeconds: number | null; verdict: TimeVerdict | null; targetProvenance: TimingProvenance; strategy: CoachStrategyView }
export function speedReviewOf(record: Pick<CoachRecord, 'assisted' | 'elapsedSeconds' | 'targetSeconds' | 'skipThresholdSeconds' | 'targetProvenance'>, strategy: SpeedStrategy, correct: boolean): SpeedReview {
  const actual = record.elapsedSeconds;
  return {
    correct, assisted: record.assisted, targetSeconds: record.targetSeconds, skipThresholdSeconds: record.skipThresholdSeconds, actualSeconds: actual, deltaSeconds: actual === null ? null : actual - record.targetSeconds,
    verdict: actual === null ? null : timeVerdict({ seconds: actual, answered: true, correct, targetSeconds: record.targetSeconds, skipThresholdSeconds: record.skipThresholdSeconds }), targetProvenance: record.targetProvenance, strategy: strategyClientView(strategy),
  };
}
