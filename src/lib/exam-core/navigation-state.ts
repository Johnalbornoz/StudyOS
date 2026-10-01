/**
 * Track B / B10 -- the attempt's server-held delivery state, stored in the
 * existing `simulation_attempts.navigation_state` jsonb (no new table).
 *
 * v2 holds, per plan position (target index), the SERVER copy of the
 * delivered item (with its answer key -- never sent to the client), the
 * autosaved draft, and the item status. Plus the frozen delivery policy, the
 * section clock (server timestamps only), breaks, and a revision counter used
 * for compare-and-swap writes (two tabs / retries can never lose an update).
 *
 * Everything here is pure; persistence lives in item-resolution.service.ts.
 */
import type { SimulationPlanSection } from '@/lib/simulation/types';
import type { ResolvedDeliveryPolicy } from './delivery-policy';
import { examItemFromGenerated, type ExamItem } from './items';
import type { ItemUnavailableReason } from './item-sourcing.service';

export type ExamItemStatus = 'DELIVERED' | 'ANSWERED' | 'UNAVAILABLE' | 'EXCLUDED' | 'MISSING';

export interface ExamItemContext {
  assessmentComponentId: string;
  learningObjectiveId: string | null;
  commandTermId: string | null;
}

export interface ExamItemState {
  status: ExamItemStatus;
  item?: ExamItem;
  ctx?: ExamItemContext;
  draft?: string;
  draftSavedAt?: string;
  responseId?: string;
  unavailableReason?: ItemUnavailableReason;
  deliveredAt?: string;
}

export interface ExamNavState {
  v: 2;
  rev: number;
  policy: ResolvedDeliveryPolicy | null;
  sections: SimulationPlanSection[];
  sectionIndex: number;
  sectionStartedAt: string | null;
  sectionPausedSeconds: number;
  breakUntil: string | null;
  items: Record<string, ExamItemState>;
  visitedTargetIds: string[];
  lastActivityAt: string;
  /** Legacy F9 fields kept for audit (navigation rules snapshot). */
  mode?: string;
  rules?: unknown;
}

export const RESOLVED_STATUSES: ReadonlySet<ExamItemStatus> = new Set(['ANSWERED', 'EXCLUDED', 'MISSING']);

export function initNavState(params: { policy: ResolvedDeliveryPolicy; sections: SimulationPlanSection[]; now: string; rules: unknown }): ExamNavState {
  return {
    v: 2,
    rev: 0,
    policy: params.policy,
    sections: params.sections,
    sectionIndex: 0,
    sectionStartedAt: null,
    sectionPausedSeconds: 0,
    breakUntil: null,
    items: {},
    visitedTargetIds: [],
    lastActivityAt: params.now,
    mode: params.rules ? 'CONFIGURED' : 'UNKNOWN',
    rules: params.rules ?? null,
  };
}

/**
 * Upgrades a pre-Track-B (F9/F15) navigation state in place of reading it:
 * the pending server-held question becomes item[pendingIndex]; every earlier
 * position was already committed or skipped (the old flow was strictly
 * linear), so it is treated as resolved. Never invents an answer.
 */
export function upgradeNavState(raw: unknown, sections: SimulationPlanSection[], fallbackNow: string): ExamNavState {
  // Deep copy: the caller mutates the returned state; the stored value must never change underneath it.
  const nav = structuredClone((raw ?? {}) as Record<string, any>);
  if (nav.v === 2) return { ...(nav as ExamNavState), sections: (nav as ExamNavState).sections?.length ? (nav as ExamNavState).sections : sections };

  const current: number = typeof nav.currentTargetIndex === 'number' ? nav.currentTargetIndex : 0;
  const items: Record<string, ExamItemState> = {};
  for (let i = 0; i < current; i++) items[String(i)] = { status: 'EXCLUDED' };
  if (nav.pendingQuestion && typeof nav.pendingQuestionTargetIndex === 'number') {
    items[String(nav.pendingQuestionTargetIndex)] = {
      status: 'DELIVERED',
      item: nav.pendingQuestion.exam ? nav.pendingQuestion : examItemFromGenerated(nav.pendingQuestion, nav.pendingObjectiveContext?.learningObjectiveId ?? null),
      ctx: nav.pendingObjectiveContext,
    };
  }
  const sectionIndex = Math.max(0, sections.findIndex((s) => current >= s.startIndex && current <= s.endIndex));
  return {
    v: 2,
    rev: 0,
    policy: null,
    sections,
    sectionIndex: current > (sections[sections.length - 1]?.endIndex ?? -1) ? sections.length : sectionIndex,
    sectionStartedAt: null,
    sectionPausedSeconds: 0,
    breakUntil: null,
    items,
    visitedTargetIds: Array.isArray(nav.visitedTargetIds) ? nav.visitedTargetIds : [],
    lastActivityAt: fallbackNow,
    mode: nav.mode,
    rules: nav.rules,
  };
}

/** The legacy (pre-Track-B) policy: linear, feedback after each item, no time enforcement, pause per timing mode. */
export function legacyPolicy(timingMode: string): ResolvedDeliveryPolicy {
  return {
    v: 1,
    navigation: 'LINEAR',
    breaks: [],
    itemFeedback: 'AFTER_EACH_ITEM',
    resultReview: 'FULL',
    permittedResources: [],
    timeLimit: timingMode === 'UNTIMED' ? 'NONE' : 'SOFT',
    pauseAllowed: timingMode !== 'OFFICIAL_SIMULATION_TIMED',
    tutorAssistance: 'BLOCKED',
    inactivityExpiryHours: 24,
  };
}

export function itemStatus(nav: ExamNavState, index: number): ExamItemStatus | 'NOT_DELIVERED' {
  return nav.items[String(index)]?.status ?? 'NOT_DELIVERED';
}

export function isResolved(nav: ExamNavState, index: number): boolean {
  const s = itemStatus(nav, index);
  return s !== 'NOT_DELIVERED' && RESOLVED_STATUSES.has(s);
}

/** Lowest unresolved index of a section, or null when the section is fully resolved. */
export function firstOpenIndex(nav: ExamNavState, section: SimulationPlanSection): number | null {
  for (let i = section.startIndex; i <= section.endIndex; i++) if (!isResolved(nav, i)) return i;
  return null;
}

/** Deadline of the current section (server time), or null when it has no hard/soft limit or has not started. */
export function sectionDeadline(nav: ExamNavState, section: SimulationPlanSection | undefined): number | null {
  if (!section || section.durationSeconds === null || !nav.sectionStartedAt) return null;
  return new Date(nav.sectionStartedAt).getTime() + (section.durationSeconds + (nav.sectionPausedSeconds || 0)) * 1000;
}

export function remainingSeconds(nav: ExamNavState, section: SimulationPlanSection | undefined, nowMs: number): number | null {
  const deadline = sectionDeadline(nav, section);
  return deadline === null ? null : Math.floor((deadline - nowMs) / 1000);
}

export function isInactiveExpired(nav: ExamNavState, nowMs: number): boolean {
  const hours = nav.policy?.inactivityExpiryHours ?? 24;
  const last = new Date(nav.lastActivityAt).getTime();
  return Number.isFinite(last) && nowMs - last > hours * 3600 * 1000;
}

/** Stimulus key of the most recently delivered item in the same section (keeps PISA units / passages together). */
export function precedingStimulusKey(nav: ExamNavState, section: SimulationPlanSection, index: number): string | null {
  for (let i = index - 1; i >= section.startIndex; i--) {
    const key = nav.items[String(i)]?.item?.exam.stimulus?.key;
    if (key) return key;
  }
  return null;
}

export function usedApprovedItemIds(nav: ExamNavState): string[] {
  return Object.values(nav.items)
    .map((s) => s.item?.exam.approvedItemId)
    .filter((id): id is string => typeof id === 'string');
}
