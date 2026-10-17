/**
 * LEARN -- adaptive guided understanding (operator rule, overnight 2026-10-16). PURE: no IO, no model.
 *
 * LEARN is guided understanding, NOT certification:
 *   - between LEARN_MIN_INTERACTIONS (4) and LEARN_MAX_INTERACTIONS (7) comprehension interactions;
 *   - NO percentage threshold ever blocks progression;
 *   - immediate feedback after every response (explanation, misconception, reinforcement, extra context);
 *   - the AI decides whether to close between interaction 4 and 7 from the understanding it observed;
 *   - at interaction 7 LEARN ends regardless (closedBy CAP) and the student advances to PRACTICE;
 *   - the weaknesses it detected are carried to PRACTICE as generation context.
 *
 * This module owns the bounds/state machine and the ONE evidence payload (contract 1.1 of
 * docs/orchestration/OVERNIGHT_2026-10-16_CONTRACTS.md). How the engine READS that row is the ENGINE
 * workstream's (src/lib/pedagogical-engine/*, evidence-adapter.ts) -- nothing here touches it.
 */
import type { GeneratedQuestion, QuestionType } from '@/services/quiz-generation.service';

export const LEARN_MIN_INTERACTIONS = 4;
export const LEARN_MAX_INTERACTIONS = 7;
export const LEARN_GUIDED_VERSION = 'learn-guided-v1' as const;
/** contract 1.1: the new evidence source type. */
export const LEARN_GUIDED_SOURCE_TYPE = 'LEARN_GUIDED' as const;
/** The quiz_sessions.quiz_mode that holds a guided session's server-side state (an existing table; no migration). */
export const LEARN_GUIDED_QUIZ_MODE = 'learn_guided' as const;
/** How long an unfinished guided session stays resumable. */
export const LEARN_GUIDED_SESSION_TTL_HOURS = 24;
/** Weaknesses carried to PRACTICE: short, deduplicated, bounded. */
export const LEARN_MAX_WEAKNESSES = 5;
export const LEARN_WEAKNESS_MAX_CHARS = 200;

export type LearnClosedBy = 'AI' | 'CAP';

/** The comprehension interaction formats a guided turn may ask (each graded by the existing grader). */
export const LEARN_INTERACTION_TYPES = ['multiple_choice', 'true_false', 'short_answer'] as const;
export type LearnInteractionType = (typeof LEARN_INTERACTION_TYPES)[number];

export interface LearnFeedback {
  verdict: 'CORRECT' | 'PARTIAL' | 'INCORRECT';
  /** What was wrong in the answer (null when correct). */
  whatWasWrong: string | null;
  /** The confusion / misconception behind it, in learner-safe words (null when none). */
  misconception: string | null;
  /** The concept, reinforced. */
  reinforcement: string;
  /** An additional example or context (optional). */
  extraContext: string | null;
  /** The answered question's own explanation -- safe to show: that interaction is already closed. */
  explanation: string | null;
}

/** One interaction as persisted in quiz_sessions.questions (server-side only: it carries the answer key). */
export interface LearnInteractionRecord {
  question: GeneratedQuestion;
  askedAt: string;
  answer?: string;
  answeredAt?: string;
  correct?: boolean;
  partial?: boolean;
  feedback?: LearnFeedback;
  weakness?: string | null;
  misconceptionId?: string | null;
}

export interface LearnTurnOutcome {
  closed: boolean;
  closedBy: LearnClosedBy | null;
  /** Why the server overrode the model, for diagnostics only. */
  overridden: 'CLOSE_BEFORE_MIN_IGNORED' | 'CLOSE_AFTER_WRONG_IGNORED' | 'CAP_FORCED' | null;
}

/**
 * THE close decision, enforced by the server whatever the model said:
 *   - answeredCount >= 7                      -> CLOSE (CAP), regardless of the model;
 *   - answeredCount <  4                      -> continue (a model close is ignored);
 *   - 4..6 and the model recommends closing   -> CLOSE (AI) -- unless the latest answer was not correct:
 *     a wrong/partial answer is always followed by another interaction ("when wrong ... then ask another
 *     appropriate comprehension interaction"), so understanding is never concluded right after a miss.
 */
export function decideTurnOutcome(params: { answeredCount: number; lastAnswerCorrect: boolean; aiCloseRecommended: boolean }): LearnTurnOutcome {
  const { answeredCount, lastAnswerCorrect, aiCloseRecommended } = params;
  if (answeredCount >= LEARN_MAX_INTERACTIONS) {
    return { closed: true, closedBy: 'CAP', overridden: aiCloseRecommended ? null : 'CAP_FORCED' };
  }
  if (!aiCloseRecommended) return { closed: false, closedBy: null, overridden: null };
  if (answeredCount < LEARN_MIN_INTERACTIONS) return { closed: false, closedBy: null, overridden: 'CLOSE_BEFORE_MIN_IGNORED' };
  if (!lastAnswerCorrect) return { closed: false, closedBy: null, overridden: 'CLOSE_AFTER_WRONG_IGNORED' };
  return { closed: true, closedBy: 'AI', overridden: null };
}

/** May the model's close recommendation be honoured at this count? (prompt hint only; the decision above is the authority) */
export function closeIsAllowedAt(answeredCount: number): boolean {
  return answeredCount >= LEARN_MIN_INTERACTIONS;
}

const normalizeWeakness = (w: string) => w.replace(/\s+/g, ' ').trim().slice(0, LEARN_WEAKNESS_MAX_CHARS);

/** Every weakness the session detected (kept even when later resolved: PRACTICE reinforces it), deduplicated, bounded. */
export function collectWeaknesses(interactions: ReadonlyArray<Pick<LearnInteractionRecord, 'weakness'>>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const i of interactions) {
    if (!i.weakness) continue;
    const w = normalizeWeakness(i.weakness);
    const key = w.toLowerCase();
    if (!w || seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= LEARN_MAX_WEAKNESSES) break;
  }
  return out;
}

export function collectMisconceptionIds(interactions: ReadonlyArray<Pick<LearnInteractionRecord, 'misconceptionId'>>): string[] {
  return [...new Set(interactions.map((i) => i.misconceptionId).filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

export interface LearnSessionMetadata {
  version: typeof LEARN_GUIDED_VERSION;
  interactionCount: number;
  closedBy: LearnClosedBy;
  weaknesses: string[];
  misconceptionIds?: string[];
}

export interface LearnGuidedEvidence {
  sourceType: typeof LEARN_GUIDED_SOURCE_TYPE;
  /** Diagnostic only -- NEVER a gate (contract 1.1: no score gate). Required by the column (NOT NULL). */
  result: 'correct' | 'partial' | 'incorrect';
  /** Diagnostic only -- the share of correct interactions; never gates progression. */
  scorePercent: number;
  difficulty: number;
  /** Assisted by construction (explanations/feedback after every answer) -- never independent evidence. */
  aiAssistanceType: 'TUTOR_GUIDANCE';
  hintsUsed: number;
  learningMode: 'COACH';
  operationKey: string;
  metadata: {
    activityType: 'LEARN_CHECK';
    evidenceMode: 'PRACTICE';
    independenceEligible: false;
    learnSession: LearnSessionMetadata;
    itemCount: number;
    correctCount: number;
    sessionId: string;
    pedagogicalPolicyVersion?: string;
    canonicalRevision?: string;
    canonicalStage?: string;
    canonicalActivityType?: string;
  };
}

/**
 * THE evidence row of a closed guided session (contract 1.1). Exactly one per session: `operationKey`
 * (`LEARN_GUIDED:<sessionId>`) is unique in learning_evidence, so a retried close is a no-op.
 * Throws when the bounds were not respected -- an out-of-contract row is never written.
 */
export function buildLearnGuidedEvidence(params: {
  sessionId: string;
  interactions: ReadonlyArray<LearnInteractionRecord>;
  closedBy: LearnClosedBy;
  canonical?: { pedagogicalPolicyVersion?: string | null; canonicalRevision?: string | null; canonicalStage?: string | null } | null;
}): LearnGuidedEvidence {
  const answered = params.interactions.filter((i) => typeof i.answer === 'string');
  const interactionCount = answered.length;
  if (interactionCount < LEARN_MIN_INTERACTIONS || interactionCount > LEARN_MAX_INTERACTIONS) {
    throw new Error(`LEARN_GUIDED_BOUNDS: ${interactionCount} interactions is outside ${LEARN_MIN_INTERACTIONS}..${LEARN_MAX_INTERACTIONS}`);
  }
  if (params.closedBy === 'CAP' && interactionCount !== LEARN_MAX_INTERACTIONS) {
    throw new Error(`LEARN_GUIDED_BOUNDS: CAP close at ${interactionCount} (only at ${LEARN_MAX_INTERACTIONS})`);
  }
  const correctCount = answered.filter((i) => i.correct === true).length;
  const scorePercent = Math.round((correctCount / interactionCount) * 100);
  const difficulty = Math.round((answered.reduce((s, i) => s + (Number(i.question.difficulty) || 2), 0) / interactionCount) * 100) / 100;
  const weaknesses = collectWeaknesses(answered);
  const misconceptionIds = collectMisconceptionIds(answered);
  const c = params.canonical ?? null;
  return {
    sourceType: LEARN_GUIDED_SOURCE_TYPE,
    result: scorePercent >= 70 ? 'correct' : scorePercent >= 50 ? 'partial' : 'incorrect',
    scorePercent,
    difficulty,
    aiAssistanceType: 'TUTOR_GUIDANCE',
    hintsUsed: 0,
    learningMode: 'COACH',
    operationKey: `LEARN_GUIDED:${params.sessionId}`,
    metadata: {
      activityType: 'LEARN_CHECK',
      evidenceMode: 'PRACTICE',
      independenceEligible: false,
      learnSession: {
        version: LEARN_GUIDED_VERSION,
        interactionCount,
        closedBy: params.closedBy,
        weaknesses,
        ...(misconceptionIds.length > 0 ? { misconceptionIds } : {}),
      },
      itemCount: interactionCount,
      correctCount,
      sessionId: params.sessionId,
      ...(c?.pedagogicalPolicyVersion ? { pedagogicalPolicyVersion: c.pedagogicalPolicyVersion } : {}),
      ...(c?.canonicalRevision ? { canonicalRevision: c.canonicalRevision } : {}),
      ...(c?.canonicalStage ? { canonicalStage: c.canonicalStage, canonicalActivityType: 'LEARN_CHECK' } : {}),
    },
  };
}

/* ------------------------------------------------------------------ the model's interaction ------------------------------------------------------------------ */

export interface RawGeneratedInteraction {
  type?: unknown;
  question?: unknown;
  options?: unknown;
  correctAnswer?: unknown;
  explanation?: unknown;
  difficulty?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Validates the model's next interaction into a gradeable GeneratedQuestion, or null.
 *   multiple_choice: 3-5 options with distinct ids, correctAnswer = one option id;
 *   true_false:      options exactly ids true/false, correctAnswer true|false;
 *   short_answer:    a model answer (graded by the existing free-text grader).
 */
export function toLearnQuestion(raw: RawGeneratedInteraction | null | undefined, conceptId: string, id: string): GeneratedQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = str(raw.type) as LearnInteractionType;
  if (!(LEARN_INTERACTION_TYPES as readonly string[]).includes(type)) return null;
  const question = str(raw.question);
  const correctAnswer = str(raw.correctAnswer);
  const explanation = str(raw.explanation);
  if (question.length < 5 || !correctAnswer || !explanation) return null;
  const difficulty = Math.max(1, Math.min(5, Math.round(Number(raw.difficulty) || 2)));
  const base = { id, conceptId, question, correctAnswer, explanation, difficulty };
  if (type === 'short_answer') {
    return { ...base, type: 'short_answer' as QuestionType, answerFormat: 'text' };
  }
  const options = Array.isArray(raw.options)
    ? (raw.options as unknown[])
        .map((o) => (o && typeof o === 'object' ? { id: str((o as any).id), text: str((o as any).text) } : null))
        .filter((o): o is { id: string; text: string } => !!o && !!o.id && !!o.text)
    : [];
  const ids = new Set(options.map((o) => o.id));
  if (ids.size !== options.length) return null;
  if (type === 'true_false') {
    const answer = correctAnswer.toLowerCase();
    if (options.length !== 2 || !ids.has('true') || !ids.has('false') || (answer !== 'true' && answer !== 'false')) return null;
    return { ...base, correctAnswer: answer, type: 'true_false' as QuestionType, answerFormat: 'single_choice', options };
  }
  if (options.length < 3 || options.length > 5 || !ids.has(correctAnswer)) return null;
  return { ...base, type: 'multiple_choice' as QuestionType, answerFormat: 'single_choice', options };
}

/** What the client may see of an interaction: never the answer key, never the explanation before answering. */
export function toClientInteraction(q: GeneratedQuestion, index: number) {
  return {
    index,
    type: q.type,
    answerFormat: q.answerFormat,
    question: q.question,
    options: q.options?.map((o) => ({ id: o.id, text: o.text })),
  };
}
export type ClientLearnInteraction = ReturnType<typeof toClientInteraction>;

/* ------------------------------------------------------------------ carried into PRACTICE ------------------------------------------------------------------ */

/**
 * PRACTICE generation guidance with the latest LEARN session's weaknesses appended (additive: the
 * base guidance is unchanged; no weaknesses -> the base guidance, byte-identical).
 */
export function practiceGuidanceWithLearnWeaknesses(baseGuidance: string, weaknesses: ReadonlyArray<string>): string {
  const list = weaknesses.map(normalizeWeakness).filter(Boolean).slice(0, LEARN_MAX_WEAKNESSES);
  if (list.length === 0) return baseGuidance;
  return `${baseGuidance}\n\nDuring the guided LEARN step for this concept the student showed these confusions -- include questions that let them practise exactly these points (without naming them as the student's mistakes):\n${list.map((w) => `- ${w}`).join('\n')}`;
}

/** Reads `metadata.learnSession.weaknesses` defensively from a learning_evidence metadata value. */
export function weaknessesFromEvidenceMetadata(metadata: unknown): string[] {
  const m = typeof metadata === 'string' ? safeParse(metadata) : metadata;
  const ls = m && typeof m === 'object' ? (m as any).learnSession : null;
  if (!ls || ls.version !== LEARN_GUIDED_VERSION || !Array.isArray(ls.weaknesses)) return [];
  return (ls.weaknesses as unknown[]).filter((w): w is string => typeof w === 'string' && w.trim().length > 0).map(normalizeWeakness);
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
