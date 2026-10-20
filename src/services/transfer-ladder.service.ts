/**
 * APPLY -- the adaptive transfer ladder service (transfer-ladder-v1).
 *
 * Orchestrates ONE attempt of 3..5 challenges (pure rules: src/lib/transfer-ladder/ladder.ts) on top
 * of the EXISTING Phase 7 machinery, reused, not re-implemented:
 *   - generation: generateStructuredTransferActivity (one task at the requested distance), with the
 *     additive ladder options (a server-only model answer for the grader; contexts to avoid);
 *   - anti-repetition: the 7B2 structural-fingerprint guard (evaluateTransferNoveltyGuard) over the
 *     learner's recent TRANSFER evidence + transfer_task_instances, exactly as /transfer/generate;
 *     plus a different context within the attempt (isRepeatedContext);
 *   - distance certification: certifyStructuredTransferNovelty (validateTransferDistanceNovelty +
 *     guard outcome + target-concept resolution) -- the ONLY source of `certified`;
 *   - persistence: one transfer_task_instances row per served task (noveltyValidationPassed = the
 *     certifier's verdict), so every challenge keeps its server-minted task id;
 *   - grading: the canonical free-text grader gradeQuizAnswer (score 0..1 -> scorePercent,
 *     errorType), never evaluateTransferResponse's correct/partial/incorrect (100/50/0);
 *   - evidence: ONE learning_evidence row through updateMastery (metadata.activityType 'TRANSFER',
 *     metadata.transferLadder per contract section 1.2, canonical attribution like other v1 rows).
 *
 * Distance authority INSIDE an attempt is the attempt's own previous step (the ladder state), never
 * concept_transfer_state's earned depth cap (authorizeRequestedTransferDistance) and never the client.
 * The attempt itself is authorized only when the fresh canonical decision is TRANSFER + EXECUTABLE
 * (the same check as /api/cognitive/transfer/generate).
 */
import { randomUUID } from 'crypto';
import {
  applyTransferLadderChallenge,
  buildTransferLadderEvidence,
  highestLevelReached,
  isRepeatedContext,
  isTransferChallengePassed,
  replayTransferLadder,
  toScorePercent,
  transferLadderCompetency,
  transferLadderCompletesApply,
  transferLadderPerformanceByLevel,
  TRANSFER_LADDER_VERSION,
  type TransferLadderChallenge,
  type TransferLadderCompetency,
  type TransferLadderLevel,
  type TransferLadderLevelPerformance,
  type TransferLadderState,
} from '@/lib/transfer-ladder/ladder';
import {
  createDbTransferLadderStore,
  type TransferLadderChallengeRecord,
  type TransferLadderSession,
  type TransferLadderSessionState,
  type TransferLadderStore,
} from './transfer-ladder-session.store';
import { generateStructuredTransferActivity, type StructuredTransferCandidate } from './transfer.service';
import { evaluateTransferNoveltyGuard, getRecentTransferFingerprints, type RecentTransferFingerprint } from './transfer-novelty.service';
import { getRecentTransferTaskFingerprints, persistTransferTaskInstance, resolveKnownConceptIds } from './transfer-task-instance.service';
import { certifyStructuredTransferNovelty } from '@/lib/transfer-novelty-certification';
import { computeTransferPromptExactHash, computeTransferPromptFingerprint, computeTransferTaskFamilyId } from '@/lib/transfer-task-identity';
import { gradeQuizAnswer } from '@/lib/quiz/grade-question';
import type { GeneratedQuestion } from './quiz-generation.service';
import { updateMastery, type MasteryUpdateInput, type MasteryUpdateResult } from './mastery.service';
import { getCanonicalPedagogicalDecision, CanonicalDecisionUnavailableError, isCanonicalEngineV1Enabled } from '@/lib/pedagogical-decision';
import type { CanonicalPedagogicalDecision } from '@/lib/pedagogical-engine';
import { V1_POLICY_VERSION } from '@/lib/pedagogical-migration';
import { evidenceModeForActivity } from '@/lib/activity-taxonomy';
import { canUseAI } from '@/lib/ai-permission-policy';

/** Bounded generation, same budget as /transfer/generate: at most 2 AI calls per served challenge. */
export const MAX_LADDER_GENERATION_AI_CALLS = 2;
const DEFAULT_LEARNED_CONTEXT = 'the way it was originally taught';
const LEVEL_DIFFICULTY: Record<TransferLadderLevel, number> = { NEAR: 3, MID: 4, FAR: 5 };

/** APPLY is independent: evidence mode of the TRANSFER activity type, which denies every student-assistance feature. */
export const TRANSFER_LADDER_EVIDENCE_MODE = evidenceModeForActivity('TRANSFER');

export type TransferLadderErrorCode =
  | 'TRANSFER_NOT_AUTHORIZED'
  | 'CANONICAL_DECISION_UNAVAILABLE'
  | 'TRANSFER_GENERATION_TEMPORARILY_UNAVAILABLE'
  | 'APPLY_CHALLENGE_NOT_NOVEL_ENOUGH'
  | 'APPLY_SESSION_NOT_FOUND'
  | 'APPLY_SESSION_EXPIRED'
  | 'APPLY_SESSION_COMPLETED'
  | 'APPLY_NO_PENDING_CHALLENGE'
  | 'APPLY_SESSION_CONFLICT'
  | 'APPLY_GRADING_UNAVAILABLE'
  | 'EVIDENCE_PERSISTENCE_FAILED';

const STATUS: Record<TransferLadderErrorCode, number> = {
  TRANSFER_NOT_AUTHORIZED: 409,
  CANONICAL_DECISION_UNAVAILABLE: 503,
  TRANSFER_GENERATION_TEMPORARILY_UNAVAILABLE: 503,
  APPLY_CHALLENGE_NOT_NOVEL_ENOUGH: 409,
  APPLY_SESSION_NOT_FOUND: 404,
  APPLY_SESSION_EXPIRED: 410,
  APPLY_SESSION_COMPLETED: 409,
  APPLY_NO_PENDING_CHALLENGE: 409,
  APPLY_SESSION_CONFLICT: 409,
  APPLY_GRADING_UNAVAILABLE: 503,
  EVIDENCE_PERSISTENCE_FAILED: 500,
};

export class TransferLadderError extends Error {
  readonly status: number;
  constructor(readonly code: TransferLadderErrorCode) {
    super(code);
    this.name = 'TransferLadderError';
    this.status = STATUS[code];
  }
}

/** What the learner may see of a challenge while the attempt is open: no model answer, no novelty metadata. */
export interface TransferLadderChallengeView {
  index: number;
  level: TransferLadderLevel;
  context: string;
  prompt: string;
  taskId: string;
}

export interface TransferLadderChallengeResultView {
  index: number;
  level: TransferLadderLevel;
  scorePercent: number;
  passed: boolean;
  /** passed AND distance-certified -- only such a challenge can move the ladder up. */
  countsTowardLevel: boolean;
}

export interface TransferLadderSummary {
  version: typeof TRANSFER_LADDER_VERSION;
  highestLevelReached: TransferLadderLevel | null;
  competency: TransferLadderCompetency;
  applyCompleted: boolean;
  closeReason: TransferLadderState['closeReason'];
  performance: TransferLadderLevelPerformance[];
  /** Full review -- only after the attempt ends (the model answer is never shown while it is open). */
  challenges: Array<{
    index: number;
    level: TransferLadderLevel;
    context: string;
    prompt: string;
    scorePercent: number;
    passed: boolean;
    countsTowardLevel: boolean;
    feedback: string;
    modelAnswer: string;
  }>;
}

export interface TransferLadderView {
  sessionId: string;
  conceptId: string;
  subjectId: string;
  conceptLabel: string;
  challengeCount: number;
  currentLevel: TransferLadderLevel;
  results: TransferLadderChallengeResultView[];
  pending: TransferLadderChallengeView | null;
  /** Set when a next challenge could not be prepared yet (retry via start). */
  nextUnavailable: TransferLadderErrorCode | null;
  summary: TransferLadderSummary | null;
}

export interface TransferLadderDeps {
  store: TransferLadderStore;
  canonicalEnabled: () => boolean;
  getDecision: (studentId: string, conceptId: string) => Promise<CanonicalPedagogicalDecision>;
  generate: (
    conceptLabel: string,
    learnedContext: string,
    level: TransferLadderLevel,
    language: string,
    aiContext: { studentId: string; subjectId: string; conceptId: string },
    options: { includeModelAnswer: true; avoidContexts: string[] },
  ) => Promise<StructuredTransferCandidate>;
  recentFingerprints: (studentId: string, conceptId: string) => Promise<RecentTransferFingerprint[]>;
  resolveKnownConceptIds: (ids: readonly string[]) => Promise<string[]>;
  persistTask: typeof persistTransferTaskInstance;
  grade: (question: GeneratedQuestion, answer: string, language: string, ctx: { studentId: string; subjectId: string }) => Promise<{
    score: number;
    feedback: string;
    errorType: string | null;
    pedagogical?: unknown;
    aiExecution?: { aiExecutionId: string } | null;
  }>;
  writeEvidence: (input: MasteryUpdateInput) => Promise<MasteryUpdateResult>;
  newId: () => string;
  now: () => string;
}

export function defaultTransferLadderDeps(): TransferLadderDeps {
  return {
    store: createDbTransferLadderStore(),
    canonicalEnabled: () => isCanonicalEngineV1Enabled(),
    getDecision: async (studentId, conceptId) => (await getCanonicalPedagogicalDecision({ studentId, conceptId })).decision,
    generate: (conceptLabel, learnedContext, level, language, aiContext, options) =>
      generateStructuredTransferActivity(conceptLabel, learnedContext, level, language, aiContext, options),
    recentFingerprints: async (studentId, conceptId) => {
      const [evidenceFps, instanceFps] = await Promise.all([
        getRecentTransferFingerprints(studentId, conceptId),
        getRecentTransferTaskFingerprints(studentId, conceptId, 20),
      ]);
      return [
        ...evidenceFps,
        ...instanceFps.map((r) => ({ promptFingerprint: r.promptFingerprint, transferTaskId: r.transferTaskId, transferDistance: null, timestamp: new Date() })),
      ];
    },
    resolveKnownConceptIds: (ids) => resolveKnownConceptIds(ids),
    persistTask: persistTransferTaskInstance,
    grade: (question, answer, language, ctx) => gradeQuizAnswer(question, answer, language, TRANSFER_LADDER_EVIDENCE_MODE, ctx) as never,
    writeEvidence: updateMastery,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  };
}

/** The canonical authorization check, identical to /api/cognitive/transfer/generate's precondition. */
export function isTransferLadderAuthorized(decision: Pick<CanonicalPedagogicalDecision, 'stage' | 'actionState'>): boolean {
  return decision.stage === 'TRANSFER' && decision.actionState === 'EXECUTABLE';
}

function gradedChallenges(state: TransferLadderSessionState): TransferLadderChallenge[] {
  return state.challenges
    .filter((c) => c.graded !== null)
    .map((c) => ({
      level: c.level,
      scorePercent: c.graded!.scorePercent,
      passed: c.graded!.passed,
      certified: c.certified,
      taskId: c.taskId,
      contextDomain: c.contextDomain,
    }));
}

function pendingChallenge(state: TransferLadderSessionState): TransferLadderChallengeRecord | null {
  const last = state.challenges[state.challenges.length - 1];
  return last && last.graded === null ? last : null;
}

function buildSummary(state: TransferLadderSessionState): TransferLadderSummary {
  const graded = gradedChallenges(state);
  const ladder = replayTransferLadder(graded);
  const highest = highestLevelReached(graded);
  return {
    version: TRANSFER_LADDER_VERSION,
    highestLevelReached: highest,
    competency: transferLadderCompetency(highest),
    applyCompleted: transferLadderCompletesApply(highest),
    closeReason: ladder.closeReason,
    performance: transferLadderPerformanceByLevel(graded),
    challenges: state.challenges
      .filter((c) => c.graded !== null)
      .map((c) => ({
        index: c.index,
        level: c.level,
        context: c.context,
        prompt: c.prompt,
        scorePercent: c.graded!.scorePercent,
        passed: c.graded!.passed,
        countsTowardLevel: c.graded!.passed && c.certified,
        feedback: c.graded!.feedback,
        modelAnswer: c.modelAnswer,
      })),
  };
}

function toView(session: TransferLadderSession, opts: { nextUnavailable?: TransferLadderErrorCode | null; completed?: boolean } = {}): TransferLadderView {
  const state = session.state;
  const graded = gradedChallenges(state);
  const ladder = replayTransferLadder(graded);
  const pending = pendingChallenge(state);
  const done = opts.completed === true || session.status === 'completed';
  return {
    sessionId: session.id,
    conceptId: session.conceptId,
    subjectId: session.subjectId,
    conceptLabel: state.conceptLabel,
    challengeCount: state.challenges.length,
    currentLevel: ladder.currentLevel,
    results: state.challenges
      .filter((c) => c.graded !== null)
      .map((c) => ({ index: c.index, level: c.level, scorePercent: c.graded!.scorePercent, passed: c.graded!.passed, countsTowardLevel: c.graded!.passed && c.certified })),
    pending: !done && pending ? { index: pending.index, level: pending.level, context: pending.context, prompt: pending.prompt, taskId: pending.taskId } : null,
    nextUnavailable: done ? null : opts.nextUnavailable ?? null,
    summary: done ? buildSummary(state) : null,
  };
}

/** The ONE evidence write input -- exported so the contract shape is unit-testable without a database. */
export function buildTransferLadderEvidenceInput(session: TransferLadderSession): MasteryUpdateInput {
  const state = session.state;
  const graded = gradedChallenges(state);
  const transferLadder = buildTransferLadderEvidence(graded);
  const highest = transferLadder.highestLevelReached;
  const highestAttempted = graded.reduce<TransferLadderLevel>((acc, c) => (LEVEL_DIFFICULTY[c.level] > LEVEL_DIFFICULTY[acc] ? c.level : acc), 'NEAR');
  // score_percent column: the plain mean of the challenge scores -- an input to the legacy Mastery
  // algorithm only. It is NOT the APPLY rule (no mean gate exists; the engine reads transferLadder).
  const meanScore = graded.length > 0 ? Math.round(graded.reduce((s, c) => s + c.scorePercent, 0) / graded.length) : 0;
  const aiGrading = state.challenges
    .filter((c) => c.graded?.aiExecutionId)
    .map((c) => ({ taskId: c.taskId, aiExecutionId: c.graded!.aiExecutionId }));
  return {
    studentId: session.studentId,
    conceptId: session.conceptId,
    subjectId: session.subjectId,
    evidence: {
      result: transferLadderCompletesApply(highest) ? 'correct' : highest === 'NEAR' ? 'partial' : 'incorrect',
      difficulty: LEVEL_DIFFICULTY[highestAttempted],
      sourceType: 'SOLO_VERIFICATION',
      confidenceWeight: 0.9,
      scorePercent: meanScore,
      sampleSize: graded.length,
    },
    identity: { operationType: 'TRANSFER_LADDER', operationId: session.id, conceptId: session.conceptId },
    telemetry: { activityType: 'transfer', learningMode: 'SOLO', hintsUsed: 0, aiAssistanceType: 'NONE' },
    metadata: {
      activityType: 'TRANSFER',
      evidenceMode: TRANSFER_LADDER_EVIDENCE_MODE,
      assisted: false,
      transferLadder,
      pedagogicalPolicyVersion: state.attribution.pedagogicalPolicyVersion,
      canonicalRevision: state.attribution.canonicalRevision,
      canonicalStage: state.attribution.canonicalStage,
      canonicalActivityType: state.attribution.canonicalActivityType,
      itemCount: graded.length,
      correctCount: graded.filter((c) => c.passed).length,
      sourceConceptId: session.conceptId,
      transferLadderSessionId: session.id,
      ...(aiGrading.length > 0 ? { aiGrading } : {}),
    },
  };
}

export function createTransferLadderService(deps: TransferLadderDeps = defaultTransferLadderDeps()) {
  async function serveNext(session: TransferLadderSession): Promise<TransferLadderSession> {
    const state = session.state;
    const ladder = replayTransferLadder(gradedChallenges(state));
    if (ladder.closed) return session;
    const level = ladder.currentLevel;
    const previous = state.challenges.map((c) => ({ contextDomain: c.contextDomain, context: c.context }));
    const avoidContexts = [...new Set(state.challenges.flatMap((c) => [c.contextDomain, c.context]).filter((v): v is string => !!v))];
    const recentFingerprints = await deps.recentFingerprints(session.studentId, session.conceptId);

    type Candidate = { candidate: StructuredTransferCandidate; fingerprint: string; certified: boolean; reason: string; dims: string[] };
    let chosen: Candidate | null = null;
    let fallback: Candidate | null = null;
    for (let calls = 0; calls < MAX_LADDER_GENERATION_AI_CALLS; calls++) {
      let candidate: StructuredTransferCandidate;
      try {
        candidate = await deps.generate(state.conceptLabel, state.learnedContext, level, session.language, {
          studentId: session.studentId,
          subjectId: session.subjectId,
          conceptId: session.conceptId,
        }, { includeModelAnswer: true, avoidContexts });
      } catch {
        throw new TransferLadderError('TRANSFER_GENERATION_TEMPORARILY_UNAVAILABLE');
      }
      if (candidate.distance !== level) throw new TransferLadderError('TRANSFER_GENERATION_TEMPORARILY_UNAVAILABLE');
      const fingerprint = computeTransferPromptFingerprint(candidate.prompt);
      const guard = evaluateTransferNoveltyGuard({ candidateFingerprint: fingerprint, recentFingerprints });
      const repeated = isRepeatedContext({ contextDomain: candidate.contextDomain, context: candidate.context }, previous);
      const usable = guard.eligible && !repeated && !!candidate.modelAnswer && candidate.prompt.trim().length > 0;
      const resolved = await deps.resolveKnownConceptIds(candidate.targetConceptIds);
      const certification = certifyStructuredTransferNovelty({
        transferDistance: candidate.distance,
        noveltyDimensions: candidate.noveltyDimensions,
        fingerprintGuardEligible: guard.eligible,
        requestedTargetConceptIds: candidate.targetConceptIds,
        resolvedTargetConceptIds: resolved,
      });
      const entry = { candidate, fingerprint, certified: certification.certified, reason: certification.reason, dims: certification.noveltyDimensions };
      if (usable && certification.certified) {
        chosen = entry;
        break;
      }
      if (usable && !fallback) fallback = entry;
    }
    // An uncertified-but-unique task is still served (Phase 7 precedent); it simply never counts toward the level.
    const pick = chosen ?? fallback;
    if (!pick) throw new TransferLadderError('APPLY_CHALLENGE_NOT_NOVEL_ENOUGH');

    const { candidate } = pick;
    const taskId = deps.newId();
    await deps.persistTask({
      id: taskId,
      studentId: session.studentId,
      conceptId: session.conceptId,
      subjectId: session.subjectId,
      transferDistance: candidate.distance,
      transferModality: candidate.transferModality,
      noveltyDimensions: pick.dims as never,
      targetConceptIds: candidate.targetConceptIds,
      contextDomain: candidate.contextDomain,
      taskFamilyId: computeTransferTaskFamilyId({
        sourceConceptId: session.conceptId,
        transferDistance: candidate.distance,
        transferModality: candidate.transferModality,
        noveltyDimensions: pick.dims as never,
        targetConceptIds: candidate.targetConceptIds,
        contextDomain: candidate.contextDomain,
      }),
      promptFingerprint: pick.fingerprint,
      promptExactHash: computeTransferPromptExactHash(candidate.prompt),
      generatorVersion: null,
      generatorPromptVersion: candidate.generatorPromptVersion,
      noveltyValidationPassed: pick.certified,
    });

    const next: TransferLadderSessionState = {
      ...state,
      revision: state.revision + 1,
      challenges: [
        ...state.challenges,
        {
          index: state.challenges.length + 1,
          level,
          taskId,
          context: candidate.context,
          contextDomain: candidate.contextDomain,
          prompt: candidate.prompt,
          modelAnswer: candidate.modelAnswer!,
          certified: pick.certified,
          certificationReason: pick.reason,
          servedAt: deps.now(),
          graded: null,
        },
      ],
    };
    if (!(await deps.store.save(session.id, next, state.revision))) throw new TransferLadderError('APPLY_SESSION_CONFLICT');
    return { ...session, state: next };
  }

  /** Writes the ONE evidence row (idempotent per session) and completes the attempt. */
  async function finalize(session: TransferLadderSession): Promise<TransferLadderSession> {
    try {
      await deps.writeEvidence(buildTransferLadderEvidenceInput(session));
    } catch {
      throw new TransferLadderError('EVIDENCE_PERSISTENCE_FAILED');
    }
    await deps.store.complete(session.id);
    return { ...session, status: 'completed' };
  }

  async function serveOrFlag(session: TransferLadderSession): Promise<TransferLadderView> {
    try {
      return toView(await serveNext(session));
    } catch (error) {
      if (error instanceof TransferLadderError && error.code !== 'APPLY_SESSION_CONFLICT') return toView(session, { nextUnavailable: error.code });
      throw error;
    }
  }

  async function resume(session: TransferLadderSession): Promise<TransferLadderView> {
    if (session.isExpired) {
      await deps.store.markExpired(session.id);
      throw new TransferLadderError('APPLY_SESSION_EXPIRED');
    }
    if (session.state.closedAt) return toView(await finalize(session), { completed: true });
    if (pendingChallenge(session.state)) return toView(session);
    return serveOrFlag(session);
  }

  return {
    /**
     * Resume the learner's open attempt for this concept, or start a new one when the fresh canonical
     * decision is TRANSFER + EXECUTABLE. Ownership, entitlement and subject verification are the
     * caller's (route's) job.
     */
    async start(params: { studentId: string; conceptId: string; subjectId: string; language: string; conceptLabel?: string | null }): Promise<TransferLadderView> {
      const active = await deps.store.findActive(params.studentId, params.conceptId);
      if (active && !active.isExpired) return resume(active);
      if (active?.isExpired) await deps.store.markExpired(active.id);

      if (!deps.canonicalEnabled()) throw new TransferLadderError('TRANSFER_NOT_AUTHORIZED');
      let decision: CanonicalPedagogicalDecision;
      try {
        decision = await deps.getDecision(params.studentId, params.conceptId);
      } catch (error) {
        if (error instanceof CanonicalDecisionUnavailableError) throw new TransferLadderError('CANONICAL_DECISION_UNAVAILABLE');
        throw error;
      }
      if (!isTransferLadderAuthorized(decision)) throw new TransferLadderError('TRANSFER_NOT_AUTHORIZED');
      // Defence in depth: APPLY is independent -- the policy for its evidence mode must deny hints.
      if (canUseAI({ evidenceMode: TRANSFER_LADDER_EVIDENCE_MODE, feature: 'HINT' })) throw new TransferLadderError('TRANSFER_NOT_AUTHORIZED');

      const label = (params.conceptLabel ?? '').trim() || (await deps.store.conceptLabel(params.conceptId, params.language)) || params.conceptId;
      const id = `apply-${deps.newId()}`;
      const state: TransferLadderSessionState = {
        kind: 'TRANSFER_LADDER',
        version: TRANSFER_LADDER_VERSION,
        revision: 0,
        conceptLabel: label,
        learnedContext: DEFAULT_LEARNED_CONTEXT,
        attribution: {
          pedagogicalPolicyVersion: V1_POLICY_VERSION,
          canonicalRevision: decision.canonicalRevision,
          canonicalStage: decision.stage,
          canonicalActivityType: 'TRANSFER',
        },
        challenges: [],
        closedAt: null,
      };
      await deps.store.create({ id, studentId: params.studentId, conceptId: params.conceptId, subjectId: params.subjectId, language: params.language, state });
      const session: TransferLadderSession = {
        id,
        studentId: params.studentId,
        conceptId: params.conceptId,
        subjectId: params.subjectId,
        language: params.language,
        status: 'active',
        isExpired: false,
        state,
      };
      return serveOrFlag(session);
    },

    /** The learner's open (active, unexpired) attempt for this concept, if any -- an open attempt may be continued without a new licence check (D-8(c)). */
    async findOpen(studentId: string, conceptId: string): Promise<TransferLadderSession | null> {
      const active = await deps.store.findActive(studentId, conceptId);
      return active && !active.isExpired ? active : null;
    },

    async load(sessionId: string): Promise<TransferLadderSession | null> {
      return deps.store.load(sessionId);
    },

    /** Grades the pending challenge; closes + writes evidence, or serves the next challenge. */
    async answer(session: TransferLadderSession, answer: string): Promise<{ result: TransferLadderChallengeResultView; view: TransferLadderView }> {
      if (session.status === 'completed') throw new TransferLadderError('APPLY_SESSION_COMPLETED');
      if (session.status !== 'active') throw new TransferLadderError('APPLY_SESSION_EXPIRED');
      if (session.isExpired) {
        await deps.store.markExpired(session.id);
        throw new TransferLadderError('APPLY_SESSION_EXPIRED');
      }
      const state = session.state;
      const pending = pendingChallenge(state);
      if (!pending) throw new TransferLadderError(state.closedAt ? 'APPLY_SESSION_COMPLETED' : 'APPLY_NO_PENDING_CHALLENGE');

      const question: GeneratedQuestion = {
        id: pending.taskId,
        conceptId: session.conceptId,
        type: 'scenario',
        answerFormat: 'text',
        question: pending.prompt,
        correctAnswer: pending.modelAnswer,
        explanation: '',
        difficulty: LEVEL_DIFFICULTY[pending.level],
        expectedReasoningType: 'CONCEPTUAL',
      };
      const grade = await deps.grade(question, answer, session.language, { studentId: session.studentId, subjectId: session.subjectId });
      // The grader's fallbacks (provider failure / unparseable reply) carry no pedagogical grade: never
      // turn an outage into a failed challenge -- the challenge stays open.
      if (!grade.pedagogical) throw new TransferLadderError('APPLY_GRADING_UNAVAILABLE');
      const scorePercent = toScorePercent(grade.score);
      const passed = isTransferChallengePassed(scorePercent);

      const before = replayTransferLadder(gradedChallenges(state));
      const after = applyTransferLadderChallenge(before, {
        level: pending.level,
        scorePercent,
        passed,
        certified: pending.certified,
        taskId: pending.taskId,
        contextDomain: pending.contextDomain,
      });
      const next: TransferLadderSessionState = {
        ...state,
        revision: state.revision + 1,
        closedAt: after.closed ? deps.now() : null,
        challenges: state.challenges.map((c) =>
          c.taskId === pending.taskId
            ? {
                ...c,
                graded: {
                  scorePercent,
                  passed,
                  feedback: grade.feedback ?? '',
                  errorType: grade.errorType ?? null,
                  answer,
                  answeredAt: deps.now(),
                  aiExecutionId: grade.aiExecution?.aiExecutionId ?? null,
                },
              }
            : c,
        ),
      };
      if (!(await deps.store.save(session.id, next, state.revision))) throw new TransferLadderError('APPLY_SESSION_CONFLICT');
      const saved: TransferLadderSession = { ...session, state: next };
      const result = { index: pending.index, level: pending.level, scorePercent, passed, countsTowardLevel: passed && pending.certified };
      if (after.closed) return { result, view: toView(await finalize(saved), { completed: true }) };
      return { result, view: await serveOrFlag(saved) };
    },

    resume,
  };
}

export type TransferLadderService = ReturnType<typeof createTransferLadderService>;
