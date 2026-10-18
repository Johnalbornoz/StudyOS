/**
 * C14-P0-01 -- ONE reader for the question history held in `quiz_sessions.questions`.
 *
 * `quiz_sessions.questions` (jsonb) is not one shape across quiz modes:
 *   - every quiz / Practice / Prove / Retain / subject Test & Mock session stores a `GeneratedQuestion[]` ARRAY;
 *   - an APPLY transfer ladder session (quiz_mode 'transfer_ladder', transfer-ladder-session.store.ts) stores ONE
 *     OBJECT, the `TransferLadderSessionState` ({ kind: 'TRANSFER_LADDER', challenges: [...] }).
 * History readers that iterated the column directly (`for (const q of row.questions || [])`) threw
 * "object is not iterable" on the APPLY row, so an old Learning session made a Subject Test / Mock start return 500.
 *
 * This module normalizes every supported shape into ONE iterable list of history items, each carrying the visible
 * prompt the exact-novelty fingerprint uses (`fingerprintQuestion` reads only `question`):
 *   - ARRAY: each element with a string `question` (the GeneratedQuestion contract), exactly as before -- elements
 *     without one are skipped, as the readers already did (no novelty-policy change);
 *   - TRANSFER_LADDER object: each SERVED challenge (`challenges[]`, every record is written when served) with a
 *     non-empty string `prompt` becomes one item: `question` = the challenge's prompt (the task text the learner was
 *     asked -- the same role `GeneratedQuestion.question` plays), `conceptId` = the session's own concept (a ladder
 *     session is single-concept; the challenge records carry none). A transfer task is open-response in a NEW context
 *     and practically never byte-identical to a generated subject item, but it IS question text the learner was
 *     served, so it is kept for exact-novelty / recency history rather than discarded (an exact collision would then
 *     be avoided like any seen item). Server-only fields (modelAnswer, grading) are never carried;
 *   - a JSON string of either shape is parsed first (legacy driver behaviour);
 *   - null / undefined -> no history.
 * Anything else (an object of an unknown kind, a malformed state, unparsable text, a scalar) is UNSUPPORTED: it
 * contributes no history, is logged once per shape per process, and never throws.
 *
 * Pure apart from that one-time diagnostic log. No IO.
 */

export type SessionQuestionHistorySource = 'QUESTION_ARRAY' | 'TRANSFER_LADDER_CHALLENGE';

export interface SessionQuestionHistoryItem {
  /** The visible prompt -- the only field the exact-novelty fingerprint reads. */
  question: string;
  /** The item's own conceptId (array items), or the session's concept (transfer ladder challenges); null when unknown. */
  conceptId: string | null;
  source: SessionQuestionHistorySource;
}

export interface SessionQuestionHistoryContext {
  /** quiz_sessions.concept_id -- attributed to items that carry no conceptId of their own (transfer ladder challenges). */
  sessionConceptId?: string | null;
  /** For the one-time diagnostic only (quiz_sessions.quiz_mode). */
  quizMode?: string | null;
}

const loggedUnsupported = new Set<string>();

function logUnsupportedOnce(shape: string, ctx: SessionQuestionHistoryContext): void {
  const key = `${ctx.quizMode ?? 'unknown-mode'}:${shape}`;
  if (loggedUnsupported.has(key)) return;
  loggedUnsupported.add(key);
  console.warn('[session-question-history] unsupported quiz_sessions.questions shape ignored for history', { quizMode: ctx.quizMode ?? null, shape });
}

/** Test hook: forget which unsupported shapes were already logged. */
export function resetSessionQuestionHistoryLogForTests(): void {
  loggedUnsupported.clear();
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Every question the session served, in one shape. Never throws; an unsupported shape yields [].
 */
export function sessionQuestionHistory(raw: unknown, ctx: SessionQuestionHistoryContext = {}): SessionQuestionHistoryItem[] {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      logUnsupportedOnce('unparsable-string', ctx);
      return [];
    }
  }
  if (value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    const out: SessionQuestionHistoryItem[] = [];
    for (const q of value) {
      if (isRecord(q) && typeof q.question === 'string') {
        out.push({ question: q.question, conceptId: typeof q.conceptId === 'string' ? q.conceptId : null, source: 'QUESTION_ARRAY' });
      }
    }
    return out;
  }

  if (isRecord(value) && value.kind === 'TRANSFER_LADDER') {
    if (!Array.isArray(value.challenges)) {
      logUnsupportedOnce('transfer-ladder-without-challenges', ctx);
      return [];
    }
    const conceptId = ctx.sessionConceptId ?? null;
    const out: SessionQuestionHistoryItem[] = [];
    for (const c of value.challenges) {
      if (isRecord(c) && typeof c.prompt === 'string' && c.prompt.trim().length > 0) {
        out.push({ question: c.prompt, conceptId, source: 'TRANSFER_LADDER_CHALLENGE' });
      }
    }
    return out;
  }

  logUnsupportedOnce(isRecord(value) ? `object:${typeof value.kind === 'string' ? value.kind : 'no-kind'}` : typeof value, ctx);
  return [];
}
