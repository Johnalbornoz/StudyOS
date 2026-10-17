/**
 * LEARN -- adaptive guided understanding (operator rule, overnight 2026-10-16).
 *
 * A guided session is a short adaptive loop (4..7 comprehension interactions) for ONE concept:
 *   question -> the student's answer -> grade (the existing grader, gradeQuizAnswer) -> immediate feedback
 *   (what was wrong, the confusion, the concept reinforced, an extra example) -> the AI decides whether to
 *   close (between 4 and 7) -> the next interaction.
 *
 * STATE: server-side, durable, in an EXISTING table -- one `quiz_sessions` row with
 * quiz_mode 'learn_guided', activity_type LEARN_CHECK, evidence_mode PRACTICE. `questions` holds the
 * interaction records (question + answer + grade + feedback), so the answer key never leaves the server.
 * No migration. The legacy quiz submission refuses this mode (generate-and-take), so a guided session can
 * never be graded twice or written as Practice evidence.
 *
 * BOUNDS are enforced here, never by the model: a close before 4 is ignored, 7 always closes (CAP)
 * (src/lib/learn-guided/policy.ts decideTurnOutcome).
 *
 * EVIDENCE: on close exactly ONE learning_evidence row (contract 1.1), idempotent through the unique
 * operation_key `LEARN_GUIDED:<sessionId>`, through mastery.service's recordDiagnosticEvidence (the single
 * evidence writer) -- it is diagnostic, assisted evidence: it does not move mastery_records (no updateMastery)
 * and is never independent.
 *
 * AI: one gated call per turn through executeAI (prompt `learning.guided_understanding_turn`, TUTOR route,
 * Luna first, Terra on the retry), with the shared Student-facing policy. Learning runtime provider calls
 * are allowed (this is Learning, not a standardized exam).
 */
import { randomUUID } from 'crypto';
import { db, type DbExecutor } from '@/lib/db';
import {
  executeAI,
  getPrompt,
  callModel,
  parseCallModelUsage,
  resolveModels,
  budgetFor,
  fitContextChunks,
  validateJson,
} from '@/lib/ai';
import { withStudentFacingPolicy } from '@/lib/ai/policy/student-facing-policy';
import { assertNoSafetySignal } from '@/lib/safety/safety-gate';
import { LOCALE_FULL_NAME } from '@/lib/i18n/messages';
import { gradeQuizAnswer } from '@/lib/quiz/grade-question';
import { stripAnswerReveals } from '@/lib/quiz/feedback-leak-guard';
import { retrieveContext } from '@/services/rag.service';
import { recordDiagnosticEvidence } from '@/services/mastery.service';
import type { GeneratedQuestion } from '@/services/quiz-generation.service';
import { isCanonicalEngineV1Enabled } from '@/lib/pedagogical-decision/feature-gate';
import { verifyV1PracticeLaunchMarker, type V1PracticeLaunchMarker } from '@/lib/pedagogical-decision/v1-practice-launch-marker';
import {
  LEARN_GUIDED_QUIZ_MODE,
  LEARN_GUIDED_SESSION_TTL_HOURS,
  LEARN_GUIDED_SOURCE_TYPE,
  LEARN_GUIDED_VERSION,
  LEARN_MAX_INTERACTIONS,
  LEARN_MIN_INTERACTIONS,
  buildLearnGuidedEvidence,
  closeIsAllowedAt,
  collectWeaknesses,
  decideTurnOutcome,
  toClientInteraction,
  toLearnQuestion,
  weaknessesFromEvidenceMetadata,
  type ClientLearnInteraction,
  type LearnClosedBy,
  type LearnFeedback,
  type LearnInteractionRecord,
  type RawGeneratedInteraction,
} from '@/lib/learn-guided/policy';

/* ================================================================== authorization ================================================================== */

export type LearnAuthorization = { authorized: true; marker: V1PracticeLaunchMarker } | { authorized: false; code: 'LEARN_NOT_AUTHORIZED' };

/**
 * Only when the canonical decision, computed FRESH right now, says LEARN (LEARN_CHECK) is EXECUTABLE for this
 * (student, concept) -- the same re-verification generate-and-take applies to canonical_learn_check
 * (verifyV1PracticeLaunchMarker), behind the same CANONICAL_ENGINE_V1_ENABLED gate.
 */
export async function authorizeGuidedLearn(studentId: string, conceptId: string): Promise<LearnAuthorization> {
  if (!isCanonicalEngineV1Enabled()) return { authorized: false, code: 'LEARN_NOT_AUTHORIZED' };
  const marker = await verifyV1PracticeLaunchMarker({ studentId, conceptId });
  if (!marker || marker.canonicalActivityType !== 'LEARN_CHECK') return { authorized: false, code: 'LEARN_NOT_AUTHORIZED' };
  return { authorized: true, marker };
}

/* ================================================================== persistence ================================================================== */

interface GuidedSessionRow {
  id: string;
  studentId: string;
  subjectId: string;
  conceptId: string;
  language: string;
  status: 'active' | 'completed' | 'expired';
  expired: boolean;
  interactions: LearnInteractionRecord[];
  canonical: { pedagogicalPolicyVersion: string | null; canonicalRevision: string | null; canonicalStage: string | null };
}

function rowToSession(r: any): GuidedSessionRow {
  const qs = typeof r.questions === 'string' ? JSON.parse(r.questions) : r.questions;
  return {
    id: r.id,
    studentId: r.student_id,
    subjectId: r.subject_id,
    conceptId: r.concept_id,
    language: r.language,
    status: r.status,
    expired: r.expired === true,
    interactions: Array.isArray(qs) ? (qs as LearnInteractionRecord[]) : [],
    canonical: { pedagogicalPolicyVersion: r.pedagogical_policy_version ?? null, canonicalRevision: r.canonical_revision ?? null, canonicalStage: r.canonical_stage ?? null },
  };
}

const SESSION_COLUMNS = `id, student_id, subject_id, concept_id, language, status, questions, (expires_at <= now()) AS expired,
  pedagogical_policy_version, canonical_revision, canonical_stage`;

export async function getGuidedSession(studentId: string, sessionId: string): Promise<GuidedSessionRow | null> {
  const r = await db.query(`SELECT ${SESSION_COLUMNS} FROM quiz_sessions WHERE id = $1 AND student_id = $2 AND quiz_mode = $3`, [sessionId, studentId, LEARN_GUIDED_QUIZ_MODE]);
  return r.rows[0] ? rowToSession(r.rows[0]) : null;
}

async function findResumableSession(studentId: string, conceptId: string): Promise<GuidedSessionRow | null> {
  const r = await db.query(
    `SELECT ${SESSION_COLUMNS} FROM quiz_sessions
      WHERE student_id = $1 AND concept_id = $2 AND quiz_mode = $3 AND status = 'active' AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [studentId, conceptId, LEARN_GUIDED_QUIZ_MODE],
  );
  return r.rows[0] ? rowToSession(r.rows[0]) : null;
}

/* ================================================================== the AI turn ================================================================== */

export interface GuidedTurnContext {
  studentId: string;
  subjectId: string;
  conceptId: string;
  sessionId: string;
  language: string;
  conceptLabel: string;
  subjectName: string;
  material: string[];
  misconceptionCatalog: Array<{ id: string; description: string }>;
  /** Interactions already answered BEFORE the current one (question + answer + verdict). */
  history: LearnInteractionRecord[];
  /** The interaction just answered, with its grade -- null for the very first interaction. */
  current: { record: LearnInteractionRecord; graderFeedback: string | null } | null;
  /** How many interactions are answered including `current`. */
  answeredCount: number;
}

export interface GuidedTurnModelOutput {
  feedback: Omit<LearnFeedback, 'verdict' | 'explanation'> | null;
  weakness: string | null;
  misconceptionId: string | null;
  closeRecommended: boolean;
  closingMessage: string | null;
  nextInteraction: RawGeneratedInteraction | null;
}

const nullableString = { type: ['string', 'null'] };
const GUIDED_TURN_SCHEMA = {
  name: 'learn_guided_turn',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['feedback', 'weakness', 'misconceptionId', 'closeRecommended', 'closingMessage', 'nextInteraction'],
    properties: {
      feedback: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['whatWasWrong', 'misconception', 'reinforcement', 'extraContext'],
            properties: { whatWasWrong: nullableString, misconception: nullableString, reinforcement: { type: 'string' }, extraContext: nullableString },
          },
          { type: 'null' },
        ],
      },
      weakness: nullableString,
      misconceptionId: nullableString,
      closeRecommended: { type: 'boolean' },
      closingMessage: nullableString,
      nextInteraction: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'question', 'options', 'correctAnswer', 'explanation', 'difficulty'],
            properties: {
              type: { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer'] },
              question: { type: 'string' },
              options: {
                type: 'array',
                items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' } } },
              },
              correctAnswer: { type: 'string' },
              explanation: { type: 'string' },
              difficulty: { type: 'integer' },
            },
          },
          { type: 'null' },
        ],
      },
    },
  },
};

function describeQuestion(q: GeneratedQuestion): string {
  const opts = q.options && q.options.length > 0 ? `\n   Options: ${q.options.map((o) => `[${o.id}] ${o.text}`).join(' | ')}` : '';
  return `${q.question}${opts}`;
}
function describeAnswer(q: GeneratedQuestion, answer: string | undefined): string {
  if (answer == null) return '(no answer)';
  const opt = q.options?.find((o) => o.id === answer);
  return opt ? `[${opt.id}] ${opt.text}` : answer;
}
const verdictOf = (r: LearnInteractionRecord) => (r.correct ? 'CORRECT' : r.partial ? 'PARTIAL' : 'INCORRECT');

export function buildGuidedTurnPrompts(ctx: GuidedTurnContext): { system: string; user: string } {
  const languageName = LOCALE_FULL_NAME[ctx.language] || ctx.language;
  const isFinal = ctx.answeredCount >= LEARN_MAX_INTERACTIONS;
  const mayClose = closeIsAllowedAt(ctx.answeredCount);
  const system = `You are the StudyUs guided-understanding tutor for the LEARN step of ONE concept. LEARN is adaptive guided understanding, NOT a test or a certification: the goal is that the student genuinely understands the core idea before practising it.

Each turn you receive the interaction the student just answered (with the grader's verdict, which you must never contradict) and you produce:
1. "feedback" (null only when no answer was given yet, i.e. before the first interaction):
   - when the answer is NOT correct: "whatWasWrong" = what exactly in the student's answer does not work; "misconception" = the likely confusion behind it, in kind, learner-safe words (null if it was a mere slip); "reinforcement" = the key idea of the concept stated correctly and simply; "extraContext" = one additional short example or context that makes the idea click.
   - when the answer IS correct: "whatWasWrong" = null, "misconception" = null, "reinforcement" = one or two sentences confirming WHY it is right; "extraContext" = optional, a short extension (or null).
   - You MAY explain the correct answer of the question just answered -- that interaction is closed.
2. "weakness": when the answer was not correct (or was correct but revealed a confusion), ONE short learner-safe phrase (at most 20 words) naming what the student still confuses, e.g. "confunde el numerador con el denominador". Otherwise null. Never judgmental, never about the person.
3. "misconceptionId": the id of the matching entry of the misconception catalog when one clearly applies, otherwise null. Never invent an id.
4. "closeRecommended": ${
    isFinal
      ? 'this is the LAST interaction (the maximum) -- set it to true.'
      : mayClose
        ? `true ONLY if the answers so far show the student genuinely understands the core idea (the latest answer is correct and earlier confusions were resolved). Otherwise false.`
        : `must be false: at least ${LEARN_MIN_INTERACTIONS} interactions are needed before LEARN can close.`
  }
5. "closingMessage": when closeRecommended is true, one or two encouraging sentences summarising what the student understood and what practice will keep reinforcing; otherwise null.
6. "nextInteraction": ${
    isFinal
      ? 'null (this was the last interaction).'
      : `ALWAYS provide one (even when you recommend closing -- StudyUs decides). A NEW comprehension interaction about this same concept, different from every previous one. After a wrong or partial answer, target the detected confusion from a different angle (simpler, or with a concrete example). After a correct answer, check a different aspect or go one step deeper. Types:
   - "multiple_choice": 4 options with ids "A".."D" (one correct, plausible distractors based on real confusions); "correctAnswer" is the correct id.
   - "true_false": options exactly [{"id":"true","text":"<True in ${languageName}>"},{"id":"false","text":"<False in ${languageName}>"}]; "correctAnswer" is "true" or "false".
   - "short_answer": one short sentence or value expected; "options" is []; "correctAnswer" is the model answer.
   "explanation" explains the correct answer (shown only after the student answers). "difficulty" 1-5 (start around 2; adapt).
   The question must not contain or hint at its own answer.`
  }

CRITICAL: the feedback must NEVER reveal or hint at the answer of the NEXT interaction.
Ground everything in the study material when provided; otherwise use standard secondary-school knowledge of the concept. Stay on this concept.
Write every text in ${languageName}.
Output ONLY a JSON object with exactly the keys: feedback, weakness, misconceptionId, closeRecommended, closingMessage, nextInteraction.`;

  const material = ctx.material.length > 0 ? ctx.material.map((m, i) => `[${i + 1}] ${m}`).join('\n') : '(none -- use standard knowledge of the concept)';
  const catalog = ctx.misconceptionCatalog.length > 0 ? ctx.misconceptionCatalog.map((m) => `- ${m.id}: ${m.description}`).join('\n') : '(empty)';
  const history =
    ctx.history.length > 0
      ? ctx.history.map((h, i) => `${i + 1}. Q: ${describeQuestion(h.question)}\n   Student: ${describeAnswer(h.question, h.answer)}\n   Verdict: ${verdictOf(h)}`).join('\n')
      : '(none)';
  const current = ctx.current
    ? `Question: ${describeQuestion(ctx.current.record.question)}
Correct answer: ${describeAnswer(ctx.current.record.question, ctx.current.record.question.correctAnswer)}
Explanation: ${ctx.current.record.question.explanation}
Student's answer: ${describeAnswer(ctx.current.record.question, ctx.current.record.answer)}
Grader verdict: ${verdictOf(ctx.current.record)}${ctx.current.graderFeedback ? `\nGrader note: ${ctx.current.graderFeedback}` : ''}`
    : '(none yet -- this is the start: set feedback, weakness, misconceptionId and closingMessage to null, closeRecommended to false, and write the FIRST interaction: a gentle check of the core idea, difficulty 2)';

  const user = `Concept: ${ctx.conceptLabel}
Subject: ${ctx.subjectName || '(unknown)'}

Study material:
${material}

Misconception catalog for this concept:
${catalog}

Earlier interactions:
${history}

Interaction just answered:
${current}

Interactions answered so far: ${ctx.answeredCount} (LEARN closes between ${LEARN_MIN_INTERACTIONS} and ${LEARN_MAX_INTERACTIONS}; ${LEARN_MAX_INTERACTIONS} is the maximum).`;
  return { system: withStudentFacingPolicy(system), user };
}

/** Structural validation of the model output (the server still enforces bounds and leak safety afterwards). */
export function validateGuidedTurnOutput(parsed: any, ctx: Pick<GuidedTurnContext, 'answeredCount' | 'current' | 'misconceptionCatalog' | 'conceptId'>): { value: GuidedTurnModelOutput; errors: string[] } {
  const errors: string[] = [];
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const fb = parsed?.feedback && typeof parsed.feedback === 'object' ? parsed.feedback : null;
  const feedback = fb ? { whatWasWrong: s(fb.whatWasWrong), misconception: s(fb.misconception), reinforcement: s(fb.reinforcement) ?? '', extraContext: s(fb.extraContext) } : null;
  if (ctx.current && (!feedback || !feedback.reinforcement)) errors.push('MISSING_FEEDBACK');
  const catalogIds = new Set(ctx.misconceptionCatalog.map((m) => m.id));
  const misconceptionId = s(parsed?.misconceptionId);
  const isFinal = ctx.answeredCount >= LEARN_MAX_INTERACTIONS;
  const next = parsed?.nextInteraction ?? null;
  if (!isFinal && !toLearnQuestion(next, ctx.conceptId, 'validation')) errors.push('INVALID_NEXT_INTERACTION');
  return {
    value: {
      feedback,
      weakness: s(parsed?.weakness),
      misconceptionId: misconceptionId && catalogIds.has(misconceptionId) ? misconceptionId : null,
      closeRecommended: parsed?.closeRecommended === true,
      closingMessage: s(parsed?.closingMessage),
      nextInteraction: isFinal ? null : next,
    },
    errors,
  };
}

const TURN_ATTEMPTS = 2;
const TURN_TIMEOUT_MS = 45_000;

/** One guided turn from the model -- Luna first, Terra on the retry. Throws after the last failed attempt. */
export async function generateGuidedTurn(ctx: GuidedTurnContext): Promise<GuidedTurnModelOutput> {
  if (ctx.current?.record.answer) assertNoSafetySignal(ctx.current.record.answer);
  const prompt = getPrompt('learning.guided_understanding_turn');
  const route = resolveModels(prompt.capability);
  const budget = budgetFor('learn_guided_turn');
  const { system, user } = buildGuidedTurnPrompts(ctx);
  let lastError: unknown = null;
  for (let attempt = 0; attempt < TURN_ATTEMPTS; attempt++) {
    const model = attempt === 0 ? route.primary : route.fallback;
    try {
      const { result } = await executeAI({
        capability: prompt.capability,
        risk: 'LOW_RISK',
        provider: route.provider,
        model,
        promptId: prompt.id,
        promptVersion: prompt.version,
        timeoutMs: TURN_TIMEOUT_MS,
        context: { studentId: ctx.studentId, subjectId: ctx.subjectId, conceptId: ctx.conceptId, sourceId: ctx.sessionId, sourceComponent: 'learn-guided.service.ts:generateGuidedTurn' },
        call: (signal) =>
          callModel({ provider: route.provider, model, maxTokens: budget.maxOutputTokens, reasoningEffort: budget.reasoningEffort, system, user, jsonSchema: GUIDED_TURN_SCHEMA }, signal),
        parseUsage: (raw) => parseCallModelUsage(raw),
        validate: (raw) => validateJson(raw, (parsed) => validateGuidedTurnOutput(parsed, ctx)),
      });
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('LEARN_GUIDED_TURN_FAILED');
}

/* ================================================================== context ================================================================== */

async function loadConceptContext(studentId: string, subjectId: string, conceptId: string, language: string) {
  const [labelRow, catalogRows, rag] = await Promise.all([
    db.query(
      `SELECT COALESCE(cl.label, (SELECT anyl.label FROM concept_localizations anyl WHERE anyl.concept_id = c.id ORDER BY anyl.language LIMIT 1), c.canonical_id) AS label, s.name AS subject_name
         FROM concepts c JOIN subjects s ON s.id = c.subject_id
         LEFT JOIN concept_localizations cl ON cl.concept_id = c.id AND cl.language = $2
        WHERE c.id = $1`,
      [conceptId, language],
    ),
    db.query(`SELECT id, COALESCE(description, misconception_code) AS description FROM misconception_signatures WHERE concept_id = $1 ORDER BY created_at LIMIT 20`, [conceptId]).catch(() => ({ rows: [] as any[] })),
    retrieveContext(studentId, subjectId, { conceptId, limit: 5 }).catch(() => ({ chunks: [] as Array<{ text: string }> })),
  ]);
  const material = fitContextChunks(rag.chunks, budgetFor('learn_guided_turn').maxContextChars).map((c) => c.text);
  return {
    conceptLabel: (labelRow.rows[0]?.label as string) ?? '',
    subjectName: (labelRow.rows[0]?.subject_name as string) ?? '',
    found: !!labelRow.rows[0],
    material,
    misconceptionCatalog: (catalogRows.rows as any[]).map((r) => ({ id: String(r.id), description: String(r.description) })),
  };
}

/* ================================================================== start ================================================================== */

export interface GuidedSessionView {
  sessionId: string;
  resumed: boolean;
  interaction: ClientLearnInteraction;
  /** 1-based number of the interaction being shown. */
  interactionNumber: number;
  answeredCount: number;
  minInteractions: number;
  maxInteractions: number;
  conceptLabel: string;
  subjectName: string;
  language: string;
}

export type StartGuidedResult =
  | ({ ok: true } & GuidedSessionView)
  | { ok: false; code: 'LEARN_NOT_AUTHORIZED' | 'CONCEPT_NOT_FOUND' | 'GENERATION_FAILED' };

function viewOf(s: GuidedSessionRow, ctx: { conceptLabel: string; subjectName: string }, resumed: boolean): GuidedSessionView | null {
  const pendingIndex = s.interactions.length - 1;
  const pending = s.interactions[pendingIndex];
  if (!pending || typeof pending.answer === 'string') return null;
  return {
    sessionId: s.id,
    resumed,
    interaction: toClientInteraction(pending.question, pendingIndex),
    interactionNumber: pendingIndex + 1,
    answeredCount: pendingIndex,
    minInteractions: LEARN_MIN_INTERACTIONS,
    maxInteractions: LEARN_MAX_INTERACTIONS,
    conceptLabel: ctx.conceptLabel,
    subjectName: ctx.subjectName,
    language: s.language,
  };
}

/**
 * Starts (or resumes) the guided LEARN session of one concept. The caller has already verified that the
 * concept belongs to the student and the subject; this re-verifies the canonical decision itself.
 */
export async function startGuidedLearnSession(params: { studentId: string; subjectId: string; conceptId: string; language: string }): Promise<StartGuidedResult> {
  const { studentId, subjectId, conceptId, language } = params;
  const auth = await authorizeGuidedLearn(studentId, conceptId);
  if (!auth.authorized) return { ok: false, code: auth.code };

  const ctx = await loadConceptContext(studentId, subjectId, conceptId, language);
  if (!ctx.found) return { ok: false, code: 'CONCEPT_NOT_FOUND' };

  // Resume an unfinished session (a reload, a double click) -- never a second one.
  const existing = await findResumableSession(studentId, conceptId);
  if (existing) {
    const view = viewOf(existing, ctx, true);
    if (view) return { ok: true, ...view };
    await db.query(`UPDATE quiz_sessions SET status = 'expired' WHERE id = $1 AND status = 'active'`, [existing.id]);
  }

  const sessionId = randomUUID();
  let first: GeneratedQuestion | null = null;
  try {
    const out = await generateGuidedTurn({ studentId, subjectId, conceptId, sessionId, language, ...ctx, history: [], current: null, answeredCount: 0 });
    first = toLearnQuestion(out.nextInteraction, conceptId, `${sessionId}-1`);
  } catch (error) {
    console.warn('[learn-guided] START_GENERATION_FAILED', JSON.stringify({ conceptId, error: error instanceof Error ? error.message : String(error) }));
  }
  if (!first) return { ok: false, code: 'GENERATION_FAILED' };

  const interactions: LearnInteractionRecord[] = [{ question: first, askedAt: new Date().toISOString() }];
  const m = auth.marker;
  await db.query(
    `INSERT INTO quiz_sessions (
       id, student_id, concept_id, subject_id, questions, language, status, created_at, expires_at,
       concept_ids, quiz_mode, hints_used_questions, activity_type, evidence_mode,
       pedagogical_policy_version, canonical_revision, canonical_stage, canonical_activity_contract
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'active', NOW(), NOW() + ($7 || ' hours')::interval,
       ARRAY[$3]::uuid[], $8, '{}', 'LEARN_CHECK', 'PRACTICE', $9, $10, $11, $12::jsonb)`,
    [
      sessionId, studentId, conceptId, subjectId, JSON.stringify(interactions), language, String(LEARN_GUIDED_SESSION_TTL_HOURS), LEARN_GUIDED_QUIZ_MODE,
      m.pedagogicalPolicyVersion, m.canonicalRevision, m.canonicalStage,
      JSON.stringify({
        canonicalActivityType: m.canonicalActivityType,
        itemCount: m.itemCount,
        difficulty: m.difficulty,
        assistanceAllowed: m.assistanceAllowed,
        independence: m.independence,
        supportLevel: m.supportLevel,
        minimumScorePercent: m.minimumScorePercent,
        learnGuided: { version: LEARN_GUIDED_VERSION, minInteractions: LEARN_MIN_INTERACTIONS, maxInteractions: LEARN_MAX_INTERACTIONS },
      }),
    ],
  );
  const created = await getGuidedSession(studentId, sessionId);
  const view = created ? viewOf(created, ctx, false) : null;
  if (!view) return { ok: false, code: 'GENERATION_FAILED' };
  return { ok: true, ...view };
}

/* ================================================================== turn ================================================================== */

export interface GuidedTurnView {
  sessionId: string;
  answeredCount: number;
  minInteractions: number;
  maxInteractions: number;
  correct: boolean;
  partial: boolean;
  feedback: LearnFeedback;
  closed: boolean;
  closedBy: LearnClosedBy | null;
  /** The next interaction (null once closed). */
  nextInteraction: ClientLearnInteraction | null;
  /** Present once closed: what PRACTICE will keep reinforcing. */
  weaknesses: string[] | null;
  closingMessage: string | null;
  evidenceId: string | null;
  alreadyClosed?: boolean;
}

export type GuidedTurnResult =
  | ({ ok: true } & GuidedTurnView)
  | { ok: false; code: 'NOT_FOUND' | 'SESSION_NOT_ACTIVE' | 'TURN_CONFLICT' | 'GENERATION_FAILED' };

function fallbackFeedback(record: LearnInteractionRecord): LearnFeedback {
  return {
    verdict: record.correct ? 'CORRECT' : record.partial ? 'PARTIAL' : 'INCORRECT',
    whatWasWrong: null,
    misconception: null,
    reinforcement: record.question.explanation,
    extraContext: null,
    explanation: record.question.explanation,
  };
}

/** Feedback texts never reveal the NEXT interaction's answer (they may explain the closed one). */
function guardFeedbackAgainst(next: GeneratedQuestion | null, fb: LearnFeedback): LearnFeedback {
  if (!next) return fb;
  const guard = { answerFormat: next.answerFormat, correctAnswer: next.correctAnswer, options: next.options, explanation: next.explanation };
  const strip = (t: string | null) => (t ? stripAnswerReveals(t, guard) : null);
  return {
    ...fb,
    whatWasWrong: strip(fb.whatWasWrong),
    misconception: strip(fb.misconception),
    reinforcement: strip(fb.reinforcement) ?? fb.explanation ?? '',
    extraContext: strip(fb.extraContext),
    explanation: strip(fb.explanation),
  };
}

function closedView(s: GuidedSessionRow, evidenceId: string | null): GuidedTurnView {
  const last = s.interactions[s.interactions.length - 1] as LearnInteractionRecord & { closedBy?: LearnClosedBy; closingMessage?: string | null };
  return {
    sessionId: s.id,
    answeredCount: s.interactions.filter((i) => typeof i.answer === 'string').length,
    minInteractions: LEARN_MIN_INTERACTIONS,
    maxInteractions: LEARN_MAX_INTERACTIONS,
    correct: last?.correct === true,
    partial: last?.partial === true,
    feedback: last?.feedback ?? fallbackFeedback(last),
    closed: true,
    closedBy: last?.closedBy ?? null,
    nextInteraction: null,
    weaknesses: collectWeaknesses(s.interactions),
    closingMessage: last?.closingMessage ?? null,
    evidenceId,
    alreadyClosed: true,
  };
}

/** Writes THE evidence row of a closed session (idempotent) through the single evidence writer. Returns its id. */
async function writeLearnEvidence(client: DbExecutor, s: GuidedSessionRow, interactions: LearnInteractionRecord[], closedBy: LearnClosedBy): Promise<string | null> {
  const ev = buildLearnGuidedEvidence({ sessionId: s.id, interactions, closedBy, canonical: s.canonical });
  const written = await recordDiagnosticEvidence(
    {
      studentId: s.studentId,
      conceptId: s.conceptId,
      subjectId: s.subjectId,
      sourceType: ev.sourceType,
      result: ev.result,
      difficulty: ev.difficulty,
      scorePercent: ev.scorePercent,
      activityType: LEARN_GUIDED_QUIZ_MODE,
      learningMode: ev.learningMode,
      hintsUsed: ev.hintsUsed,
      aiAssistanceType: ev.aiAssistanceType,
      metadata: ev.metadata,
      operationKey: ev.operationKey,
    },
    client,
  );
  return written.id;
}

export async function submitGuidedLearnTurn(params: { studentId: string; sessionId: string; answer: string }): Promise<GuidedTurnResult> {
  const { studentId, sessionId, answer } = params;
  const s = await getGuidedSession(studentId, sessionId);
  if (!s) return { ok: false, code: 'NOT_FOUND' };
  if (s.status === 'completed') {
    // a retried final turn (its response was lost) -- the stored outcome, never a second evidence row
    const ev = await db.query(`SELECT id FROM learning_evidence WHERE operation_key = $1`, [`LEARN_GUIDED:${s.id}`]);
    return { ok: true, ...closedView(s, (ev.rows[0]?.id as string) ?? null) };
  }
  if (s.status !== 'active' || s.expired) return { ok: false, code: 'SESSION_NOT_ACTIVE' };
  const pendingIndex = s.interactions.length - 1;
  const pending = s.interactions[pendingIndex];
  if (!pending || typeof pending.answer === 'string') return { ok: false, code: 'TURN_CONFLICT' };

  const grade = await gradeQuizAnswer(pending.question, answer, s.language, 'PRACTICE', { studentId, subjectId: s.subjectId });
  const partial = grade.pedagogical ? grade.pedagogical.finalJudgment === 'ALMOST' : !grade.correct && grade.score > 0;
  const answered: LearnInteractionRecord = { ...pending, answer, answeredAt: new Date().toISOString(), correct: grade.correct, partial: !grade.correct && partial };
  const answeredCount = pendingIndex + 1;

  const ctx = await loadConceptContext(studentId, s.subjectId, s.conceptId, s.language);
  let out: GuidedTurnModelOutput | null = null;
  try {
    out = await generateGuidedTurn({
      studentId, subjectId: s.subjectId, conceptId: s.conceptId, sessionId: s.id, language: s.language,
      conceptLabel: ctx.conceptLabel, subjectName: ctx.subjectName, material: ctx.material, misconceptionCatalog: ctx.misconceptionCatalog,
      history: s.interactions.slice(0, pendingIndex),
      current: { record: answered, graderFeedback: grade.correct ? null : grade.feedback || null },
      answeredCount,
    });
  } catch (error) {
    console.warn('[learn-guided] TURN_GENERATION_FAILED', JSON.stringify({ sessionId: s.id, answeredCount, error: error instanceof Error ? error.message : String(error) }));
  }

  const outcome = decideTurnOutcome({ answeredCount, lastAnswerCorrect: answered.correct === true, aiCloseRecommended: out?.closeRecommended === true });
  // Without the model a session can still close at the CAP (deterministic feedback); otherwise there is no
  // next interaction to ask -- nothing is persisted and the same answer can be retried.
  if (!out && !outcome.closed) return { ok: false, code: 'GENERATION_FAILED' };
  const next = !outcome.closed && out ? toLearnQuestion(out.nextInteraction, s.conceptId, `${s.id}-${answeredCount + 1}`) : null;
  if (!outcome.closed && !next) return { ok: false, code: 'GENERATION_FAILED' };

  const baseFeedback: LearnFeedback = out?.feedback
    ? {
        verdict: answered.correct ? 'CORRECT' : answered.partial ? 'PARTIAL' : 'INCORRECT',
        whatWasWrong: answered.correct ? null : out.feedback.whatWasWrong,
        misconception: answered.correct ? null : out.feedback.misconception,
        reinforcement: out.feedback.reinforcement,
        extraContext: out.feedback.extraContext,
        explanation: pending.question.explanation,
      }
    : fallbackFeedback(answered);
  const feedback = guardFeedbackAgainst(next, baseFeedback);
  const closingMessage = outcome.closed ? (out?.closingMessage ?? null) : null;
  const record: LearnInteractionRecord & { closedBy?: LearnClosedBy; closingMessage?: string | null } = {
    ...answered,
    feedback,
    weakness: out?.weakness ?? null,
    misconceptionId: out?.misconceptionId ?? null,
    ...(outcome.closed ? { closedBy: outcome.closedBy!, closingMessage } : {}),
  };
  const interactions: LearnInteractionRecord[] = [...s.interactions.slice(0, pendingIndex), record, ...(next ? [{ question: next, askedAt: new Date().toISOString() }] : [])];

  const client = await db.connect();
  let evidenceId: string | null = null;
  try {
    await client.query('BEGIN');
    // optimistic concurrency: only the turn that saw this exact pending interaction may write
    const upd = await client.query(
      `UPDATE quiz_sessions SET questions = $2::jsonb, status = $3, completed_at = CASE WHEN $3 = 'completed' THEN NOW() ELSE completed_at END
        WHERE id = $1 AND status = 'active' AND jsonb_array_length(questions) = $4`,
      [s.id, JSON.stringify(interactions), outcome.closed ? 'completed' : 'active', s.interactions.length],
    );
    if (upd.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { ok: false, code: 'TURN_CONFLICT' };
    }
    if (outcome.closed) evidenceId = await writeLearnEvidence(client, s, interactions, outcome.closedBy!);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (outcome.overridden) console.info('[learn-guided] CLOSE_OVERRIDDEN', JSON.stringify({ sessionId: s.id, answeredCount, overridden: outcome.overridden }));

  return {
    ok: true,
    sessionId: s.id,
    answeredCount,
    minInteractions: LEARN_MIN_INTERACTIONS,
    maxInteractions: LEARN_MAX_INTERACTIONS,
    correct: answered.correct === true,
    partial: answered.partial === true,
    feedback,
    closed: outcome.closed,
    closedBy: outcome.closedBy,
    nextInteraction: next ? toClientInteraction(next, answeredCount) : null,
    weaknesses: outcome.closed ? collectWeaknesses(interactions) : null,
    closingMessage,
    evidenceId,
  };
}

/* ================================================================== carried into PRACTICE ================================================================== */

/**
 * The weaknesses of the LATEST closed guided LEARN session of (student, concept), read directly from its
 * learning_evidence row metadata (contract 1.1) -- independent of how the engine reads that row.
 * Never throws: a read failure means "no extra guidance".
 */
export async function loadLatestLearnWeaknesses(studentId: string, conceptId: string): Promise<string[]> {
  try {
    const r = await db.query(
      `SELECT metadata FROM learning_evidence
        WHERE student_id = $1 AND concept_id = $2 AND source_type = $3 AND metadata->>'activityType' = 'LEARN_CHECK'
        ORDER BY timestamp DESC LIMIT 1`,
      [studentId, conceptId, LEARN_GUIDED_SOURCE_TYPE],
    );
    return r.rows[0] ? weaknessesFromEvidenceMetadata(r.rows[0].metadata) : [];
  } catch {
    return [];
  }
}
