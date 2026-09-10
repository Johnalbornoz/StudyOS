/**
 * LX-4P-PERF-R1C C12 -- the Continue -> teaching-launch handoff.
 *
 * `/api/learning/continue` resolves the canonical Phase 4 / first-touch
 * `LearningDecision` AND derives the Teaching Experience for it in the
 * SAME request (one canonical `TeachingIntent` read). Rather than have
 * the quiz page immediately recompute the identical thing via
 * `/api/learning/teaching-intent`, `ContinuationPanel` stashes the
 * server-derived view here and the quiz page consumes it ONCE on launch.
 *
 * This module only TRANSPORTS and VALIDATES -- it never derives a
 * Teaching Experience (the client "may transport that server-derived
 * result; the client may NOT compute it"). A handoff is honoured only
 * when it is:
 *   - for the SAME concept, and
 *   - for the SAME launch mode/activity, and
 *   - FRESH (within `LAUNCH_TEACHING_MAX_AGE_MS`), and
 *   - a STRUCTURALLY INTACT `TeachingExperienceView` at the current
 *     contract version.
 * Anything else -> `null`, and the caller falls back to the canonical
 * `/api/learning/teaching-intent` fetch -- identical behaviour to before
 * this optimisation.
 *
 * Consume-once: the key is ALWAYS cleared when present, so a later
 * transfer / remediation launch on a different concept can never read a
 * stale pedagogy snapshot. And because the transported view is
 * presentation-only -- every evidence / permission / support gate is
 * still enforced server-side regardless of what the client hands in -- a
 * forged entry cannot unlock help, change EvidenceMode, or alter
 * scoring; at worst it cosmetically restages one activity, and the
 * strict shape + concept + mode + freshness checks below make even that
 * require an already-same-origin actor forging a fully-valid view.
 */
import {
  TEACHING_EXPERIENCE_CONTRACT_VERSION,
  type TeachingExperienceView,
} from '@/lib/lx/teaching-experience';

const KEY = 'lx.launchTeaching';

/** A handoff older than this (or implausibly future-dated) is ignored. */
export const LAUNCH_TEACHING_MAX_AGE_MS = 60_000;
const MAX_CLOCK_SKEW_MS = 5_000;

export interface LaunchTeachingHandoff {
  /** The concept the continuation launched for. */
  conceptId: string;
  /** The `mode` query param of the launch target (QuizMode), or null. */
  mode: string | null;
  /** The server-derived Teaching Experience -- or null when there was none. */
  teachingExperience: TeachingExperienceView | null;
  /** `Date.now()` at write time. */
  ts: number;
}

function safeSession(store?: Storage): Storage | undefined {
  if (store) return store;
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Write the handoff. Never throws -- a missing/broken store is a no-op. */
export function writeLaunchTeachingHandoff(h: LaunchTeachingHandoff, store?: Storage): void {
  const s = safeSession(store);
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(h));
  } catch {
    /* quota / disabled storage -- the quiz page falls back to its canonical fetch */
  }
}

/**
 * Read + DELETE the handoff. Returns the transported view ONLY when it
 * is valid for this exact launch (same concept + mode, fresh,
 * structurally intact, non-null). Returns `null` in every other case
 * (absent, unparsable, wrong concept, wrong mode, stale, or an explicit
 * null view) so the caller resolves the Teaching Experience canonically.
 * Always clears the key when one was present (consume-once).
 */
export function consumeLaunchTeachingHandoff(
  conceptId: string,
  mode: string,
  now: number = Date.now(),
  store?: Storage,
): TeachingExperienceView | null {
  const s = safeSession(store);
  if (!s) return null;

  let raw: string | null = null;
  try {
    raw = s.getItem(KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    s.removeItem(KEY);
  } catch {
    /* best effort */
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const h = parsed as Partial<LaunchTeachingHandoff>;

  if (h.conceptId !== conceptId) return null; // concept match
  if (h.mode !== mode) return null; // mode / activity match (missing mode -> mismatch)
  if (typeof h.ts !== 'number') return null;
  if (now - h.ts > LAUNCH_TEACHING_MAX_AGE_MS) return null; // freshness / lifecycle
  if (h.ts - now > MAX_CLOCK_SKEW_MS) return null; // implausibly future-dated

  return isIntactTeachingView(h.teachingExperience) ? h.teachingExperience : null;
}

/**
 * Structural integrity check only -- NOT a re-derivation. The client is
 * allowed to reject a malformed/forged snapshot; it is not allowed to
 * compute or "repair" one. A view that fails any check is discarded and
 * the canonical fetch runs instead.
 */
export function isIntactTeachingView(v: unknown): v is TeachingExperienceView {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  return (
    typeof w.mode === 'string' &&
    Array.isArray(w.stages) &&
    w.stages.every((x) => typeof x === 'string') &&
    typeof w.showWorkedExample === 'boolean' &&
    typeof w.scaffolding === 'string' &&
    typeof w.helpAvailable === 'boolean' &&
    typeof w.retryAllowed === 'boolean' &&
    typeof w.explanationProminence === 'string' &&
    typeof w.reinforceCorrect === 'boolean' &&
    typeof w.isProve === 'boolean' &&
    w.contractVersion === TEACHING_EXPERIENCE_CONTRACT_VERSION
  );
}
