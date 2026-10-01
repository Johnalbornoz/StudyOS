/**
 * F15 -> Track B -- server-authoritative exam item delivery.
 *
 * An ORCHESTRATOR, never a second grading engine:
 *
 *   SimulationPlanTarget (F9, frozen)
 *     -> sourceExamItem (exam-core: PUBLISHED approved bank first, else the
 *        existing AI generator + blueprint validation)
 *     -> navigation_state.items[i] (the SERVER copy, with its answer key)
 *     -> toExamClientItem (the only browser-bound shape; key-bearing fields
 *        stripped, checked again by a runtime leak guard)
 *     -> recordSimulationItemResponse (F9, grading via exam-core) against the
 *        SERVER-HELD item only -- the client sends its answer string, never a
 *        question or a key, and never a student/version/attempt identity that
 *        is trusted (the attempt is resolved server-side and owner-checked).
 *
 * Track B adds, on the same `simulation_attempts.navigation_state` column:
 * sections in blueprint order, per-section server clocks (HARD limits close a
 * section at its deadline, committing autosaved answers), breaks, LINEAR or
 * FREE_ORDER_WITHIN_SECTION navigation, autosave + refresh recovery,
 * inactivity expiry, and compare-and-swap writes (`rev`) so concurrent tabs or
 * retries can never lose or duplicate an update. A delivered item is never
 * swapped on refresh; a committed item can never be answered twice
 * (UNIQUE exam_attempt_id + target_index).
 */
import { db } from '@/lib/db';
import { isOwner } from '@/lib/authorization';
import { getSimulationAttempt } from './attempt.service';
import { deriveSections, getSimulationPlanById } from './plan.service';
import { getObjectiveTarget } from '@/lib/assessment/blueprint.service';
import { listComponentsForVersion } from '@/lib/assessment/component.service';
import { recordSimulationItemResponse } from './scoring.service';
import { sourceExamItem, type ItemUnavailableReason } from '@/lib/exam-core/item-sourcing.service';
import { findAnswerKeyLeak, toExamClientItem, type ExamClientItem } from '@/lib/exam-core/items';
import { structuredAnswerProblem } from '@/lib/exam-core/item-grading';
import { portfolioAnswerProblem } from '@/lib/exam-core/submissions/submission.service';
import {
  firstOpenIndex,
  isInactiveExpired,
  isResolved,
  itemStatus,
  legacyPolicy,
  precedingStimulusKey,
  remainingSeconds,
  sectionDeadline,
  upgradeNavState,
  usedApprovedItemIds,
  type ExamNavState,
} from '@/lib/exam-core/navigation-state';
import type { SimulationAttempt, SimulationPlan, SimulationPlanSection } from './types';

export type { ItemUnavailableReason };

export class SimulationItemAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationItemAccessDeniedError';
  }
}
export class SimulationItemNotFoundError extends Error {
  constructor(attemptId: string) {
    super(`No simulation_attempts row found for id ${attemptId}`);
    this.name = 'SimulationItemNotFoundError';
  }
}
export class SimulationItemNotActiveError extends Error {
  constructor(status: string) {
    super(`attempt status is ${status}, not ACTIVE -- cannot fetch or answer an item`);
    this.name = 'SimulationItemNotActiveError';
  }
}
export class SimulationItemNoPendingItemError extends Error {
  constructor() {
    super('no pending item exists for this attempt -- call getNextSimulationItem first');
    this.name = 'SimulationItemNoPendingItemError';
  }
}
/** The requested item is not reachable under the attempt's navigation policy (or its section is closed). */
export class SimulationNavigationError extends Error {
  constructor(public readonly code: 'NAVIGATION_NOT_ALLOWED' | 'SECTION_CLOSED' | 'ON_BREAK') {
    super(code);
    this.name = 'SimulationNavigationError';
  }
}
/** The answer could never have been produced by the rendered controls -- rejected, nothing recorded. */
export class SimulationInvalidResponseError extends Error {
  constructor(public readonly reason: string) {
    super(`INVALID_RESPONSE: ${reason}`);
    this.name = 'SimulationInvalidResponseError';
  }
}

const MAX_DRAFT_LENGTH = 20000;
const CAS_RETRIES = 4;

export interface SectionView {
  index: number;
  count: number;
  key: string;
  name: string;
  startIndex: number;
  endIndex: number;
  durationSeconds: number | null;
  remainingSeconds: number | null;
  timeLimit: 'NONE' | 'SOFT' | 'HARD';
}

export type NavItemView = { targetIndex: number; status: 'OPEN' | 'DRAFT' | 'ANSWERED' | 'UNAVAILABLE' | 'SKIPPED' | 'MISSING' };

export interface ItemContextView {
  section: SectionView;
  navigation: { mode: 'LINEAR' | 'FREE_ORDER_WITHIN_SECTION'; items: NavItemView[] };
  policy: { itemFeedback: 'NEVER' | 'AFTER_EACH_ITEM'; pauseAllowed: boolean; permittedResources: string[] };
  serverTime: string;
}

export type NextSimulationItemResult =
  | ({ outcome: 'ITEM_READY'; targetIndex: number; totalTargets: number; question: ExamClientItem; draft: string | null } & ItemContextView)
  | { outcome: 'COMPLETE'; totalTargets: number }
  | { outcome: 'BREAK'; totalTargets: number; breakUntil: string; nextSectionName: string | null; serverTime: string }
  | ({ outcome: 'ITEM_UNAVAILABLE'; targetIndex: number; totalTargets: number; reason: ItemUnavailableReason } & ItemContextView);

interface LoadedAttempt {
  attempt: SimulationAttempt;
  plan: SimulationPlan;
  sections: SimulationPlanSection[];
  nav: ExamNavState;
  expectedRev: number;
}

async function loadOwnedAttempt(actorUserId: string, attemptId: string, allowedStatuses: Array<SimulationAttempt['status']> = ['ACTIVE']): Promise<LoadedAttempt> {
  const attempt = await getSimulationAttempt(attemptId);
  if (!attempt) throw new SimulationItemNotFoundError(attemptId);
  const owns = await isOwner(actorUserId, attempt.studentId);
  if (!owns) throw new SimulationItemAccessDeniedError('actor does not own this simulation attempt (Teacher and Parent relationships never authorize execution)');
  const plan = await getSimulationPlanById(attempt.simulationPlanId);
  if (!plan) throw new Error(`simulation_plans row ${attempt.simulationPlanId} referenced by attempt ${attemptId} is missing -- data integrity violation`);

  const sections = plan.sections && plan.sections.length > 0 ? plan.sections : deriveSections(plan.selectedTargets, await listComponentsForVersion(attempt.examVersionId), attempt.timingMode);
  const raw = attempt.navigationState as Record<string, unknown>;
  const nav = upgradeNavState(raw, sections, attempt.resumedAt ?? attempt.createdAt);
  if (!nav.policy) nav.policy = legacyPolicy(attempt.timingMode);
  const expectedRev = typeof raw?.rev === 'number' ? (raw.rev as number) : 0;

  // Integrity: an open attempt left idle beyond the policy's expiry is closed
  // (lazily, on the next access) -- it can never be resumed after the Student
  // could have used unrestricted help in the meantime.
  if ((attempt.status === 'ACTIVE' || attempt.status === 'PAUSED') && isInactiveExpired(nav, Date.now())) {
    await db.query(`UPDATE simulation_attempts SET status = 'ABANDONED' WHERE id = $1 AND status IN ('ACTIVE','PAUSED')`, [attempt.id]);
    await db.query(`UPDATE exam_attempts SET status = 'ABANDONED' WHERE id = $1 AND status = 'IN_PROGRESS'`, [attempt.examAttemptId]);
    console.log('[exam-core]', JSON.stringify({ at: 'attempt_expired_inactive', attemptId: attempt.id }));
    throw new SimulationItemNotActiveError('ABANDONED');
  }
  if (!allowedStatuses.includes(attempt.status)) throw new SimulationItemNotActiveError(attempt.status);
  return { attempt, plan, sections, nav, expectedRev };
}

/** Compare-and-swap write of the navigation state (rev must still be the one we read). */
async function casWriteNav(attemptId: string, expectedRev: number, nav: ExamNavState, allowedStatuses: string[] = ['ACTIVE']): Promise<boolean> {
  const next = { ...nav, rev: expectedRev + 1 };
  const result = await db.query(
    `UPDATE simulation_attempts SET navigation_state = $2
      WHERE id = $1 AND status = ANY($4::text[]) AND COALESCE((navigation_state->>'rev')::int, 0) = $3
      RETURNING id`,
    [attemptId, JSON.stringify(next), expectedRev, allowedStatuses]
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

async function withCas<T>(
  actorUserId: string,
  attemptId: string,
  allowedStatuses: Array<SimulationAttempt['status']>,
  step: (loaded: LoadedAttempt) => Promise<{ result: T; write: boolean }>
): Promise<T> {
  for (let i = 0; i < CAS_RETRIES; i++) {
    const loaded = await loadOwnedAttempt(actorUserId, attemptId, allowedStatuses);
    const { result, write } = await step(loaded);
    if (!write) return result;
    if (await casWriteNav(attemptId, loaded.expectedRev, loaded.nav, allowedStatuses)) return result;
  }
  throw new Error(`navigation state for attempt ${attemptId} kept changing concurrently -- retry`);
}

/** Commits an autosaved draft (or a direct answer) through the real grading path. */
async function commitAnswer(loaded: LoadedAttempt, index: number, answer: string, idempotencyKey: string) {
  const state = loaded.nav.items[String(index)];
  if (!state?.item || !state.ctx) throw new SimulationItemNoPendingItemError();
  const rec = await recordSimulationItemResponse({
    examAttemptId: loaded.attempt.examAttemptId,
    studentId: loaded.attempt.studentId,
    examVersionId: loaded.attempt.examVersionId,
    assessmentComponentId: state.ctx.assessmentComponentId,
    learningObjectiveId: state.ctx.learningObjectiveId ?? undefined,
    commandTermId: state.ctx.commandTermId,
    question: state.item,
    studentAnswer: answer,
    language: loaded.attempt.language,
    idempotencyKey,
    targetIndex: index,
  });
  loaded.nav.items[String(index)] = { ...state, status: 'ANSWERED', responseId: rec.responseId, draft: undefined, draftSavedAt: undefined };
  const target = loaded.plan.selectedTargets[index];
  if (target && !loaded.nav.visitedTargetIds.includes(target.blueprintObjectiveTargetId)) loaded.nav.visitedTargetIds.push(target.blueprintObjectiveTargetId);
  return rec;
}

/**
 * Brings the state up to date with the server clock: ends elapsed breaks,
 * closes a HARD-timed section whose deadline passed (autosaved drafts are
 * committed, everything else in it becomes MISSING), and advances past fully
 * resolved sections (starting a configured break). Returns true when it
 * changed anything.
 */
async function housekeep(loaded: LoadedAttempt, nowMs: number): Promise<boolean> {
  const { nav, sections } = loaded;
  let changed = false;
  for (let guard = 0; guard < sections.length + 2; guard++) {
    const section = sections[nav.sectionIndex];
    if (!section) return changed;
    if (nav.breakUntil) {
      if (nowMs < new Date(nav.breakUntil).getTime()) return changed;
      nav.breakUntil = null;
      changed = true;
    }
    const deadline = sectionDeadline(nav, section);
    if (nav.policy?.timeLimit === 'HARD' && deadline !== null && nowMs > deadline) {
      for (let i = section.startIndex; i <= section.endIndex; i++) {
        const state = nav.items[String(i)];
        if (isResolved(nav, i)) continue;
        if (state?.status === 'DELIVERED' && state.draft) {
          await commitAnswer(loaded, i, state.draft, `auto:${loaded.attempt.id}:${i}`);
        } else if (state?.status === 'UNAVAILABLE') {
          nav.items[String(i)] = { ...state, status: 'EXCLUDED' };
        } else {
          nav.items[String(i)] = { ...(state ?? {}), status: 'MISSING' };
        }
      }
      changed = true;
    }
    if (firstOpenIndex(nav, section) !== null) return changed;
    // Section fully resolved: move on (and start a configured break before the next one).
    nav.sectionIndex += 1;
    nav.sectionStartedAt = null;
    nav.sectionPausedSeconds = 0;
    const brk = nav.policy?.breaks.find((b) => b.afterSectionKey === section.key);
    if (brk && nav.sectionIndex < sections.length) nav.breakUntil = new Date(nowMs + brk.minutes * 60 * 1000).toISOString();
    changed = true;
  }
  return changed;
}

function navItemView(nav: ExamNavState, index: number): NavItemView {
  const s = itemStatus(nav, index);
  const state = nav.items[String(index)];
  const status: NavItemView['status'] =
    s === 'ANSWERED' ? 'ANSWERED' : s === 'MISSING' ? 'MISSING' : s === 'EXCLUDED' ? 'SKIPPED' : s === 'UNAVAILABLE' ? 'UNAVAILABLE' : state?.draft ? 'DRAFT' : 'OPEN';
  return { targetIndex: index, status };
}

function contextView(loaded: LoadedAttempt, nowMs: number): ItemContextView {
  const { nav, sections } = loaded;
  const section = sections[nav.sectionIndex];
  const items: NavItemView[] = [];
  for (let i = section.startIndex; i <= section.endIndex; i++) items.push(navItemView(nav, i));
  return {
    section: {
      index: nav.sectionIndex,
      count: sections.length,
      key: section.key,
      name: section.name,
      startIndex: section.startIndex,
      endIndex: section.endIndex,
      durationSeconds: section.durationSeconds,
      remainingSeconds: nav.policy?.timeLimit === 'NONE' ? null : remainingSeconds(nav, section, nowMs),
      timeLimit: nav.policy?.timeLimit ?? 'NONE',
    },
    navigation: { mode: nav.policy?.navigation ?? 'LINEAR', items },
    policy: { itemFeedback: nav.policy?.itemFeedback ?? 'NEVER', pauseAllowed: loaded.attempt.pauseAllowed, permittedResources: nav.policy?.permittedResources ?? [] },
    serverTime: new Date(nowMs).toISOString(),
  };
}

/** Which index the Student may work on now (requested or default), enforcing the navigation policy. */
function resolveWorkingIndex(loaded: LoadedAttempt, requested: number | undefined): number {
  const { nav, sections } = loaded;
  const section = sections[nav.sectionIndex];
  const open = firstOpenIndex(nav, section);
  if (open === null) throw new SimulationNavigationError('SECTION_CLOSED');
  if (requested === undefined) return open;
  if (!Number.isInteger(requested) || requested < section.startIndex || requested > section.endIndex) throw new SimulationNavigationError('NAVIGATION_NOT_ALLOWED');
  if (isResolved(nav, requested)) throw new SimulationNavigationError('SECTION_CLOSED');
  if ((nav.policy?.navigation ?? 'LINEAR') === 'LINEAR' && requested !== open) throw new SimulationNavigationError('NAVIGATION_NOT_ALLOWED');
  return requested;
}

function guardNoLeak(question: ExamClientItem): ExamClientItem {
  const leak = findAnswerKeyLeak(question);
  if (leak) throw new Error(`refusing to send an answer-bearing field to the client (${leak})`);
  return question;
}

/**
 * Resolves (sourcing if needed) the working item. Idempotent: a repeated call
 * for the same position returns the SAME server-held item and its autosaved
 * draft -- a refresh or resume never swaps the question.
 */
export async function getNextSimulationItem(actorUserId: string, attemptId: string, requestedIndex?: number): Promise<NextSimulationItemResult> {
  return withCas<NextSimulationItemResult>(actorUserId, attemptId, ['ACTIVE'], async (loaded) => {
    const nowMs = Date.now();
    const { nav, sections, plan, attempt } = loaded;
    const totalTargets = plan.selectedTargets.length;
    let write = await housekeep(loaded, nowMs);

    if (nav.sectionIndex >= sections.length) return { result: { outcome: 'COMPLETE', totalTargets }, write };
    if (nav.breakUntil) {
      return { result: { outcome: 'BREAK', totalTargets, breakUntil: nav.breakUntil, nextSectionName: sections[nav.sectionIndex]?.name ?? null, serverTime: new Date(nowMs).toISOString() }, write };
    }

    const index = resolveWorkingIndex(loaded, requestedIndex);
    const section = sections[nav.sectionIndex];
    if (!nav.sectionStartedAt) {
      nav.sectionStartedAt = new Date(nowMs).toISOString();
      write = true;
    }
    if (write || nowMs - new Date(nav.lastActivityAt).getTime() > 60_000) {
      nav.lastActivityAt = new Date(nowMs).toISOString();
      write = true;
    }

    let state = nav.items[String(index)];
    if (!state) {
      const target = plan.selectedTargets[index];
      const objectiveTarget = await getObjectiveTarget(target.blueprintObjectiveTargetId);
      const ctx = { assessmentComponentId: target.assessmentComponentId, learningObjectiveId: objectiveTarget?.learningObjectiveId ?? null, commandTermId: target.commandTermId };
      if (!objectiveTarget) {
        state = { status: 'UNAVAILABLE', unavailableReason: 'NO_CURRICULUM_MAPPING', ctx };
      } else {
        const sourced = await sourceExamItem({
          attemptId: attempt.id,
          studentId: attempt.studentId,
          target: { learningObjectiveId: objectiveTarget.learningObjectiveId, assessmentComponentId: target.assessmentComponentId, questionType: target.questionType, difficultyRange: target.difficultyRange },
          excludeApprovedItemIds: usedApprovedItemIds(nav),
          preferredStimulusKey: precedingStimulusKey(nav, section, index),
          language: attempt.language,
        });
        state = sourced.outcome === 'READY'
          ? { status: 'DELIVERED', item: sourced.item, ctx, deliveredAt: new Date(nowMs).toISOString() }
          : { status: 'UNAVAILABLE', unavailableReason: sourced.reason, ctx };
      }
      nav.items[String(index)] = state;
      write = true;
    }

    const view = contextView(loaded, nowMs);
    if (state.status === 'UNAVAILABLE') {
      return { result: { outcome: 'ITEM_UNAVAILABLE', targetIndex: index, totalTargets, reason: state.unavailableReason ?? 'NO_ITEM_GENERATED', ...view }, write };
    }
    return {
      result: { outcome: 'ITEM_READY', targetIndex: index, totalTargets, question: guardNoLeak(toExamClientItem(state.item!, index)), draft: state.draft ?? null, ...view },
      write,
    };
  });
}

/** Autosave: stores the Student's in-progress answer for a delivered item. Never graded, never evidence. */
export async function saveSimulationItemDraft(actorUserId: string, attemptId: string, index: number, draft: string): Promise<{ savedAt: string; targetIndex: number }> {
  if (typeof draft !== 'string' || draft.length > MAX_DRAFT_LENGTH) throw new SimulationInvalidResponseError('DRAFT_TOO_LONG');
  return withCas(actorUserId, attemptId, ['ACTIVE'], async (loaded) => {
    const nowMs = Date.now();
    await housekeep(loaded, nowMs);
    if (loaded.nav.sectionIndex >= loaded.sections.length) throw new SimulationNavigationError('SECTION_CLOSED');
    if (loaded.nav.breakUntil) throw new SimulationNavigationError('ON_BREAK');
    const section = loaded.sections[loaded.nav.sectionIndex];
    if (index < section.startIndex || index > section.endIndex) throw new SimulationNavigationError('SECTION_CLOSED');
    const state = loaded.nav.items[String(index)];
    if (!state || state.status !== 'DELIVERED') throw new SimulationItemNoPendingItemError();
    const savedAt = new Date(nowMs).toISOString();
    loaded.nav.items[String(index)] = { ...state, draft, draftSavedAt: savedAt };
    loaded.nav.lastActivityAt = savedAt;
    return { result: { savedAt, targetIndex: index }, write: true };
  });
}

export interface SubmitSimulationItemResult {
  /** Present only when the attempt's delivery policy allows item feedback. */
  evaluation: { score: number; maxScore: number; feedback: string | null } | null;
  done: boolean;
  targetIndex: number;
  totalTargets: number;
  duplicate: boolean;
}

/**
 * Commits the Student's answer for a delivered item, grading against the
 * SERVER's own held item. The client only ever sends its answer string (plus
 * an optional item position and idempotency key) -- never a question, never
 * an answer key, never an identity that is trusted.
 */
export async function submitSimulationItemAnswer(
  actorUserId: string,
  attemptId: string,
  studentAnswer: string,
  idempotencyKey?: string,
  requestedIndex?: number
): Promise<SubmitSimulationItemResult> {
  return withCas(actorUserId, attemptId, ['ACTIVE'], async (loaded) => {
    const nowMs = Date.now();
    await housekeep(loaded, nowMs);
    const { nav, sections, plan } = loaded;
    if (nav.sectionIndex >= sections.length) throw new SimulationNavigationError('SECTION_CLOSED');
    if (nav.breakUntil) throw new SimulationNavigationError('ON_BREAK');

    const section = sections[nav.sectionIndex];
    let index = requestedIndex;
    if (index === undefined) {
      // Legacy clients send no position: the (only) delivered item of the working position.
      const open = firstOpenIndex(nav, section);
      if (open === null) throw new SimulationItemNoPendingItemError();
      index = open;
    }
    if (index < section.startIndex || index > section.endIndex) throw new SimulationNavigationError('SECTION_CLOSED');
    const state = nav.items[String(index)];
    if (!state || state.status !== 'DELIVERED' || !state.item) throw new SimulationItemNoPendingItemError();

    // Shape check BEFORE anything is recorded: a tampered answer is rejected, the item stays open.
    if (!state.item.exam.parts && state.item.answerFormat !== 'text') {
      const problem = structuredAnswerProblem(state.item, studentAnswer);
      if (problem) throw new SimulationInvalidResponseError(problem);
    }
    // V2: a portfolio task is committed only with this position's own, complete submission.
    if (state.item.exam.portfolio) {
      const problem = await portfolioAnswerProblem({ examAttemptId: loaded.attempt.examAttemptId, targetIndex: index, studentId: loaded.attempt.studentId, answer: studentAnswer, item: state.item });
      if (problem) throw new SimulationInvalidResponseError(problem);
    }

    const rec = await commitAnswer(loaded, index, studentAnswer, idempotencyKey ?? `submit:${attemptId}:${index}`);
    if (rec.grade.status === 'INVALID' && !rec.duplicate) {
      // Multi-part / text shape problems are only detectable by the grader; the response is kept as INVALID (0 marks, no evidence).
      console.log('[exam-core]', JSON.stringify({ at: 'invalid_response_recorded', attemptId, targetIndex: index, reason: rec.grade.invalidReason }));
    }
    nav.lastActivityAt = new Date(nowMs).toISOString();
    await housekeep(loaded, nowMs);
    const feedbackAllowed = nav.policy?.itemFeedback === 'AFTER_EACH_ITEM';
    return {
      result: {
        evaluation: feedbackAllowed ? { score: rec.evaluation.score, maxScore: rec.evaluation.maxScore, feedback: rec.evaluation.feedback ?? null } : null,
        done: nav.sectionIndex >= sections.length,
        targetIndex: index,
        totalTargets: plan.selectedTargets.length,
        duplicate: rec.duplicate,
      },
      write: true,
    };
  });
}

/**
 * Advances past an item the platform could not prepare (ITEM_UNAVAILABLE)
 * WITHOUT recording any response -- an honest "the platform could not offer
 * this part", never a fabricated grade, never a permanently stuck exam. The
 * item is excluded from scoring (not counted against the Student).
 */
export async function skipUnavailableSimulationItem(actorUserId: string, attemptId: string, requestedIndex?: number): Promise<{ done: boolean; targetIndex: number; totalTargets: number }> {
  return withCas(actorUserId, attemptId, ['ACTIVE'], async (loaded) => {
    const nowMs = Date.now();
    await housekeep(loaded, nowMs);
    const { nav, sections, plan } = loaded;
    const totalTargets = plan.selectedTargets.length;
    if (nav.sectionIndex >= sections.length) return { result: { done: true, targetIndex: totalTargets, totalTargets }, write: true };
    const section = sections[nav.sectionIndex];
    const index = requestedIndex ?? firstOpenIndex(nav, section) ?? section.endIndex;
    const state = nav.items[String(index)];
    if (!state || state.status !== 'UNAVAILABLE') throw new SimulationItemNoPendingItemError();
    nav.items[String(index)] = { ...state, status: 'EXCLUDED' };
    const target = plan.selectedTargets[index];
    if (target && !nav.visitedTargetIds.includes(target.blueprintObjectiveTargetId)) nav.visitedTargetIds.push(target.blueprintObjectiveTargetId);
    nav.lastActivityAt = new Date(nowMs).toISOString();
    await housekeep(loaded, nowMs);
    return { result: { done: nav.sectionIndex >= sections.length, targetIndex: index, totalTargets }, write: true };
  });
}

/** Ends a configured break early (the next section's clock starts on its first item). */
export async function endSimulationBreak(actorUserId: string, attemptId: string): Promise<{ ended: boolean }> {
  return withCas<{ ended: boolean }>(actorUserId, attemptId, ['ACTIVE'], async (loaded) => {
    if (!loaded.nav.breakUntil) return { result: { ended: false }, write: false };
    loaded.nav.breakUntil = null;
    loaded.nav.lastActivityAt = new Date().toISOString();
    return { result: { ended: true }, write: true };
  });
}

/**
 * Submission integrity: before an attempt is completed, every autosaved draft
 * is committed through the real grading path (an INVALID draft is recorded as
 * INVALID -- 0 marks, never evidence), every other open position becomes
 * MISSING, and an item the platform could not prepare becomes EXCLUDED.
 * Allowed from ACTIVE and PAUSED (a paused attempt may be handed in).
 */
export async function finalizeOpenItemsForSubmission(actorUserId: string, attemptId: string): Promise<{ committedDrafts: number; missing: number }> {
  return withCas(actorUserId, attemptId, ['ACTIVE', 'PAUSED'], async (loaded) => {
    const { nav, plan, sections } = loaded;
    let committedDrafts = 0;
    let missing = 0;
    for (let i = 0; i < plan.selectedTargets.length; i++) {
      if (isResolved(nav, i)) continue;
      const state = nav.items[String(i)];
      if (state?.status === 'DELIVERED' && state.draft) {
        await commitAnswer(loaded, i, state.draft, `final:${loaded.attempt.id}:${i}`);
        committedDrafts++;
      } else if (state?.status === 'UNAVAILABLE') {
        nav.items[String(i)] = { ...state, status: 'EXCLUDED' };
      } else {
        nav.items[String(i)] = { ...(state ?? {}), status: 'MISSING' };
        missing++;
      }
    }
    nav.sectionIndex = sections.length;
    nav.breakUntil = null;
    nav.lastActivityAt = new Date().toISOString();
    return { result: { committedDrafts, missing }, write: true };
  });
}
