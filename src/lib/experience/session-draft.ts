/**
 * UX-3 -- refresh continuity for an in-progress activity.
 *
 * Holds ONLY the learner's own unsubmitted input (which question they are
 * on, the answers they already entered, the answer they are typing) so a
 * reload does not throw it away. It is never evidence and never progress:
 *
 *   - Scoped to the signed-in student AND the exact server session
 *     (quizId) AND a fingerprint of that session's questions. A draft is
 *     restored only into the SAME session the server resumed (the
 *     canonical delivery path returns the same quizId after a reload);
 *     a new session -- different quizId -- never receives it.
 *   - sessionStorage, not localStorage: it survives a reload of this tab
 *     and is gone when the tab closes, so it cannot outlive the visit on
 *     a shared device. Drafts of any other student are purged on read.
 *   - Stale after MAX_AGE_MS; cleared on authoritative completion.
 *   - Nothing here scores, submits, or advances anything. The server's
 *     own session state always wins: a draft can only refill inputs.
 */

export const DRAFT_PREFIX = 'studyus.learnDraft.v1:';
export const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** The subset of the Storage API this module needs (injectable for tests). */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export interface DraftPending {
  singleChoice: string | null;
  multiChoice: string[];
  textAnswer: string;
  matchingAnswer: Record<string, string>;
  orderingAnswer: string[];
  classificationAnswer: Record<string, string>;
  confidenceSelected: string | null;
}

export interface SessionDraft {
  v: 1;
  studentId: string;
  quizId: string;
  fingerprint: string;
  current: number;
  /** Answers already entered for earlier questions (still unsubmitted -- the whole set is sent once, at the end). */
  answers: Record<number, string>;
  confidences: Record<number, string>;
  presentedAt: Record<number, string>;
  submittedAt: Record<number, string>;
  /** The in-progress answer to `current`. */
  pending: DraftPending;
  /** LEARN_CHECK: a server read-only check already shown for `current` keeps that answer locked. */
  check: unknown;
  savedAt: number;
}

export function draftKey(studentId: string, quizId: string): string {
  return `${DRAFT_PREFIX}${studentId}:${quizId}`;
}

/** Stable, content-derived id for a question batch (djb2 over each question's text + format). */
export function questionFingerprint(questions: readonly { question: string; answerFormat?: string }[]): string {
  let h = 5381;
  const src = questions.map((q) => `${q.answerFormat ?? ''}|${q.question}`).join('\u0001');
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  return `${questions.length}:${(h >>> 0).toString(36)}`;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function saveDraft(storage: DraftStorage | null, draft: SessionDraft): void {
  if (!storage) return;
  safe(() => storage.setItem(draftKey(draft.studentId, draft.quizId), JSON.stringify(draft)), undefined);
}

export function clearDraft(storage: DraftStorage | null, studentId: string, quizId: string): void {
  if (!storage) return;
  safe(() => storage.removeItem(draftKey(studentId, quizId)), undefined);
}

/** Removes every draft that belongs to another student, is stale, or is unreadable. */
export function purgeForeignDrafts(storage: DraftStorage | null, studentId: string, now: number): void {
  if (!storage) return;
  safe(() => {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      const d = parse(storage.getItem(k));
      if (!d || d.studentId !== studentId || now - d.savedAt > DRAFT_MAX_AGE_MS || k !== draftKey(d.studentId, d.quizId)) storage.removeItem(k);
    }
  }, undefined);
}

function parse(raw: string | null): SessionDraft | null {
  if (!raw) return null;
  const d = safe(() => JSON.parse(raw) as SessionDraft, null);
  if (!d || d.v !== 1 || typeof d.studentId !== 'string' || typeof d.quizId !== 'string' || typeof d.fingerprint !== 'string') return null;
  if (typeof d.current !== 'number' || typeof d.savedAt !== 'number' || !d.pending || typeof d.answers !== 'object') return null;
  return d;
}

/**
 * The draft for exactly this student + session + question batch, or null.
 * Anything that does not match is removed rather than restored.
 */
export function loadDraft(
  storage: DraftStorage | null,
  scope: { studentId: string; quizId: string; fingerprint: string; questionCount: number; now: number },
): SessionDraft | null {
  if (!storage) return null;
  const key = draftKey(scope.studentId, scope.quizId);
  const d = parse(safe(() => storage.getItem(key), null));
  if (!d) return null;
  const valid =
    d.studentId === scope.studentId &&
    d.quizId === scope.quizId &&
    d.fingerprint === scope.fingerprint &&
    scope.now - d.savedAt <= DRAFT_MAX_AGE_MS &&
    Number.isInteger(d.current) &&
    d.current >= 0 &&
    d.current < scope.questionCount &&
    Object.keys(d.answers).every((k) => Number(k) >= 0 && Number(k) < scope.questionCount);
  if (!valid) {
    safe(() => storage.removeItem(key), undefined);
    return null;
  }
  return d;
}

/** True when the draft holds any learner input worth restoring. */
export function draftHasInput(d: SessionDraft): boolean {
  const p = d.pending;
  return (
    d.current > 0 ||
    Object.keys(d.answers).length > 0 ||
    !!p.singleChoice ||
    p.multiChoice.length > 0 ||
    !!p.textAnswer ||
    Object.keys(p.matchingAnswer).length > 0 ||
    Object.keys(p.classificationAnswer).length > 0
  );
}

/** sessionStorage when available (never throws; null in SSR / blocked storage). */
export function browserDraftStorage(): DraftStorage | null {
  return safe(() => (typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null), null);
}
