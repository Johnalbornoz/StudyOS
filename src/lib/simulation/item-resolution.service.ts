/**
 * F15 -- the missing wiring F14 explicitly deferred (IVG-F14-01): a
 * `SimulationPlanTarget` only ever specified WHAT KIND of question to
 * ask (component/type/difficulty) -- nothing in F9 turned that spec
 * into actual, renderable question content. This file is an
 * ORCHESTRATOR, never a second exam/grading engine: it generates a
 * real item by reusing the SAME three already-certified systems the
 * rest of the platform already trusts, in the SAME order F9's own
 * `recordSimulationItemResponse` already resolves a concept for
 * evidence-writing:
 *
 *   BlueprintObjectiveTarget (F7)
 *         -> resolveActivityMetadataForObjective (F6, PUBLISHED
 *            objective_concept_mappings only)
 *         -> resolveStudentConceptForCanonicalConcept (F9's own
 *            reverse-lookup, already used by scoring.service.ts)
 *         -> generatePracticeQuestions (the existing AI question
 *            generator every self-service Practice quiz already uses)
 *         -> toClientQuestion (the existing sanitizer that strips the
 *            correct answer before anything reaches the browser)
 *
 * Grading remains 100% delegated to the real, unmodified
 * `recordSimulationItemResponse` (F9) -- this file never grades an
 * answer itself. The one new piece of state this file owns is
 * `simulation_attempts.navigation_state` (already a real, empty JSONB
 * column F9 initialized at attempt-start but never advanced) -- used
 * to track which target is current and to hold the SERVER's own copy
 * of the currently-pending question (never trusting a client-submitted
 * question/answer-key pair back).
 */
import { db } from '@/lib/db';
import { isOwner } from '@/lib/authorization';
import { getSimulationAttempt } from './attempt.service';
import { getSimulationPlanById } from './plan.service';
import { getObjectiveTarget } from '@/lib/assessment/blueprint.service';
import { resolveActivityMetadataForObjective } from '@/lib/curriculum/activity-metadata-bridge.service';
import { resolveStudentConceptForCanonicalConcept } from '@/lib/readiness/student-concept-resolution.service';
import { generatePracticeQuestions, type GeneratedQuestion } from '@/services/quiz-generation.service';
import { recordSimulationItemResponse } from './scoring.service';
import { toClientQuestion } from '@/lib/quiz/client-question';

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

interface NavigationState {
  currentTargetIndex?: number;
  visitedTargetIds?: string[];
  pendingQuestion?: GeneratedQuestion;
  pendingQuestionTargetIndex?: number;
  pendingObjectiveContext?: { assessmentComponentId: string; learningObjectiveId: string | null; commandTermId: string | null };
  mode?: string;
  rules?: unknown;
}

export type ItemUnavailableReason = 'NO_CURRICULUM_MAPPING' | 'CONCEPT_NOT_MATCHED' | 'NO_ITEM_GENERATED';

export type NextSimulationItemResult =
  | { outcome: 'ITEM_READY'; targetIndex: number; totalTargets: number; question: ReturnType<typeof toClientQuestion> }
  | { outcome: 'COMPLETE' }
  | { outcome: 'ITEM_UNAVAILABLE'; targetIndex: number; totalTargets: number; reason: ItemUnavailableReason };

async function loadOwnedActiveAttempt(actorUserId: string, attemptId: string) {
  const attempt = await getSimulationAttempt(attemptId);
  if (!attempt) throw new SimulationItemNotFoundError(attemptId);
  const owns = await isOwner(actorUserId, attempt.studentId);
  if (!owns) throw new SimulationItemAccessDeniedError('actor does not own this simulation attempt (Teacher and Parent relationships never authorize execution)');
  if (attempt.status !== 'ACTIVE') throw new SimulationItemNotActiveError(attempt.status);
  const plan = await getSimulationPlanById(attempt.simulationPlanId);
  if (!plan) throw new Error(`simulation_plans row ${attempt.simulationPlanId} referenced by attempt ${attemptId} is missing -- data integrity violation`);
  return { attempt, plan };
}

/**
 * Resolves and, if needed, generates the current item. Idempotent: a
 * repeated call for the same current target index returns the SAME
 * server-held question rather than generating a new one -- a page
 * refresh or a resumed attempt never silently swaps the question
 * underneath the student.
 */
export async function getNextSimulationItem(actorUserId: string, attemptId: string): Promise<NextSimulationItemResult> {
  const { attempt, plan } = await loadOwnedActiveAttempt(actorUserId, attemptId);
  const nav = (attempt.navigationState || {}) as NavigationState;
  const currentIndex = nav.currentTargetIndex ?? 0;
  const totalTargets = plan.selectedTargets.length;

  if (currentIndex >= totalTargets) return { outcome: 'COMPLETE' };

  if (nav.pendingQuestion && nav.pendingQuestionTargetIndex === currentIndex) {
    return { outcome: 'ITEM_READY', targetIndex: currentIndex, totalTargets, question: toClientQuestion(nav.pendingQuestion, currentIndex) };
  }

  const target = plan.selectedTargets[currentIndex];
  const objectiveTarget = await getObjectiveTarget(target.blueprintObjectiveTargetId);
  if (!objectiveTarget) return { outcome: 'ITEM_UNAVAILABLE', targetIndex: currentIndex, totalTargets, reason: 'NO_CURRICULUM_MAPPING' };

  const bridge = await resolveActivityMetadataForObjective(objectiveTarget.learningObjectiveId);
  if (!bridge || bridge.canonicalConceptIds.length === 0) {
    return { outcome: 'ITEM_UNAVAILABLE', targetIndex: currentIndex, totalTargets, reason: 'NO_CURRICULUM_MAPPING' };
  }

  let studentConceptId: string | null = null;
  for (const canonicalConceptId of bridge.canonicalConceptIds) {
    studentConceptId = await resolveStudentConceptForCanonicalConcept(attempt.studentId, canonicalConceptId);
    if (studentConceptId) break;
  }
  if (!studentConceptId) return { outcome: 'ITEM_UNAVAILABLE', targetIndex: currentIndex, totalTargets, reason: 'CONCEPT_NOT_MATCHED' };

  const subjectRow = await db.query(`SELECT subject_id FROM concepts WHERE id = $1`, [studentConceptId]);
  const subjectId = subjectRow.rows[0]?.subject_id;
  if (!subjectId) return { outcome: 'ITEM_UNAVAILABLE', targetIndex: currentIndex, totalTargets, reason: 'NO_CURRICULUM_MAPPING' };

  const midDifficulty = target.difficultyRange ? Math.round((target.difficultyRange.min + target.difficultyRange.max) / 2) : undefined;
  const questions = await generatePracticeQuestions(studentConceptId, attempt.studentId, subjectId, { count: 1, difficulty: midDifficulty });
  const question = questions[0];
  if (!question) return { outcome: 'ITEM_UNAVAILABLE', targetIndex: currentIndex, totalTargets, reason: 'NO_ITEM_GENERATED' };

  const updatedNav: NavigationState = {
    ...nav,
    currentTargetIndex: currentIndex,
    pendingQuestion: question,
    pendingQuestionTargetIndex: currentIndex,
    pendingObjectiveContext: { assessmentComponentId: target.assessmentComponentId, learningObjectiveId: objectiveTarget.learningObjectiveId, commandTermId: target.commandTermId },
  };
  await db.query(`UPDATE simulation_attempts SET navigation_state = $2 WHERE id = $1`, [attemptId, JSON.stringify(updatedNav)]);

  return { outcome: 'ITEM_READY', targetIndex: currentIndex, totalTargets, question: toClientQuestion(question, currentIndex) };
}

/**
 * Advances past an item the platform could not generate content for
 * (`ITEM_UNAVAILABLE`) WITHOUT recording any response -- an honest
 * "the platform could not offer this part," never a fabricated
 * correct/incorrect grade and never a permanently stuck exam.
 */
export async function skipUnavailableSimulationItem(actorUserId: string, attemptId: string): Promise<{ done: boolean; targetIndex: number; totalTargets: number }> {
  const { attempt, plan } = await loadOwnedActiveAttempt(actorUserId, attemptId);
  const nav = (attempt.navigationState || {}) as NavigationState;
  const currentIndex = nav.currentTargetIndex ?? 0;
  const totalTargets = plan.selectedTargets.length;
  if (currentIndex >= totalTargets) return { done: true, targetIndex: currentIndex, totalTargets };

  const target = plan.selectedTargets[currentIndex];
  const nextIndex = currentIndex + 1;
  const updatedNav: NavigationState = {
    ...nav,
    currentTargetIndex: nextIndex,
    pendingQuestion: undefined,
    pendingQuestionTargetIndex: undefined,
    pendingObjectiveContext: undefined,
    visitedTargetIds: [...(nav.visitedTargetIds || []), target.blueprintObjectiveTargetId],
  };
  await db.query(`UPDATE simulation_attempts SET navigation_state = $2 WHERE id = $1`, [attemptId, JSON.stringify(updatedNav)]);
  return { done: nextIndex >= totalTargets, targetIndex: currentIndex, totalTargets };
}

export interface SubmitSimulationItemResult {
  evaluation: { score: number; maxScore: number; feedback: string | null };
  done: boolean;
  targetIndex: number;
  totalTargets: number;
}

/**
 * Grades via the real, unmodified `recordSimulationItemResponse` (F9)
 * using the SERVER's own held copy of the pending question -- the
 * client only ever sends its answer STRING, never the question or a
 * correct-answer field, so a client cannot forge a correct grade by
 * resubmitting a doctored question object.
 */
export async function submitSimulationItemAnswer(
  actorUserId: string,
  attemptId: string,
  studentAnswer: string,
  idempotencyKey?: string
): Promise<SubmitSimulationItemResult> {
  const { attempt, plan } = await loadOwnedActiveAttempt(actorUserId, attemptId);
  const nav = (attempt.navigationState || {}) as NavigationState;

  if (!nav.pendingQuestion || nav.pendingQuestionTargetIndex === undefined || !nav.pendingObjectiveContext) {
    throw new SimulationItemNoPendingItemError();
  }

  const targetIndex = nav.pendingQuestionTargetIndex;
  const target = plan.selectedTargets[targetIndex];
  const ctx = nav.pendingObjectiveContext;

  const result = await recordSimulationItemResponse({
    examAttemptId: attempt.examAttemptId,
    studentId: attempt.studentId,
    examVersionId: attempt.examVersionId,
    assessmentComponentId: ctx.assessmentComponentId,
    learningObjectiveId: ctx.learningObjectiveId ?? undefined,
    commandTermId: ctx.commandTermId,
    question: nav.pendingQuestion,
    studentAnswer,
    language: attempt.language,
    idempotencyKey,
  });

  const nextIndex = targetIndex + 1;
  const updatedNav: NavigationState = {
    ...nav,
    currentTargetIndex: nextIndex,
    pendingQuestion: undefined,
    pendingQuestionTargetIndex: undefined,
    pendingObjectiveContext: undefined,
    visitedTargetIds: [...(nav.visitedTargetIds || []), target.blueprintObjectiveTargetId],
  };
  await db.query(`UPDATE simulation_attempts SET navigation_state = $2 WHERE id = $1`, [attemptId, JSON.stringify(updatedNav)]);

  return {
    evaluation: { score: result.evaluation.score, maxScore: result.evaluation.maxScore, feedback: result.evaluation.feedback ?? null },
    done: nextIndex >= plan.selectedTargets.length,
    targetIndex,
    totalTargets: plan.selectedTargets.length,
  };
}
