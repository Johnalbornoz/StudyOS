/**
 * Admin Question Bank -- academic review navigation (pure, no I/O).
 *
 *   - the row ACTION of the review queue (what a reviewer can do with that version);
 *   - the queue URL for a set of filters (stable exam identity: `examConfigKey`, never only a version id);
 *   - a SAFE `returnTo` back to the queue: internal review-queue path only, never an open redirect.
 */

export const REVIEW_QUEUE_PATH = '/dashboard/admin/question-bank/review';
export const QUESTION_DETAIL_PATH = '/dashboard/admin/question-bank/questions';

/** Lifecycle states the detail page shows read-only (no review form). Mirrors the detail page's rule. */
const READ_ONLY_LIFECYCLES = new Set(['REJECTED', 'SUPERSEDED', 'RETIRED']);

export interface ReviewRowAction {
  label: 'Revisar' | 'Ver rechazo' | 'Ver';
  mode: 'REVIEW' | 'READ_ONLY';
  href: string;
}

/** The queue filters carried back and forth (already validated by the queue page). */
export type QueueFilterParams = Partial<Record<'examConfigKey' | 'examVersionId' | 'sectionKey' | 'objectiveCode' | 'band' | 'generatedFrom' | 'generatedTo' | 'validation' | 'usage' | 'alignment' | 'status', string | undefined>>;
const FILTER_KEYS: Array<keyof QueueFilterParams> = ['examConfigKey', 'examVersionId', 'sectionKey', 'objectiveCode', 'band', 'generatedFrom', 'generatedTo', 'validation', 'usage', 'alignment', 'status'];

/** The review-queue URL for these filters (only known filter keys; empty values dropped; stable order). */
export function reviewQueueHref(filters: QueueFilterParams): string {
  const q = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = filters[k];
    if (typeof v === 'string' && v.length > 0) q.set(k, v);
  }
  const qs = q.toString();
  return qs ? `${REVIEW_QUEUE_PATH}?${qs}` : REVIEW_QUEUE_PATH;
}

/**
 * The action of one queue row. A pending candidate (PILOT / VALIDATED / REVIEW_REQUIRED, whatever its
 * automated findings) is "Revisar"; an (automatically) rejected version is "Ver rechazo" and opens read-only.
 * The detail link carries the queue URL so "volver" keeps the filters.
 */
export function reviewRowAction(item: { versionId: string; lifecycle: string | null }, queueHref: string): ReviewRowAction {
  const href = `${QUESTION_DETAIL_PATH}/${encodeURIComponent(item.versionId)}?returnTo=${encodeURIComponent(queueHref)}`;
  if (item.lifecycle === 'REJECTED') return { label: 'Ver rechazo', mode: 'READ_ONLY', href };
  if (item.lifecycle && READ_ONLY_LIFECYCLES.has(item.lifecycle)) return { label: 'Ver', mode: 'READ_ONLY', href };
  return { label: 'Revisar', mode: 'REVIEW', href };
}

/**
 * A safe back URL: only the internal review queue path (with its query) is accepted. Absolute URLs,
 * protocol-relative `//host`, backslashes, other paths and over-long values fall back to the plain queue.
 */
export function safeReviewReturnTo(raw: string | undefined | null): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1000) return REVIEW_QUEUE_PATH;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return REVIEW_QUEUE_PATH;
  let url: URL;
  try {
    url = new URL(raw, 'https://internal.invalid');
  } catch {
    return REVIEW_QUEUE_PATH;
  }
  if (url.origin !== 'https://internal.invalid' || url.pathname !== REVIEW_QUEUE_PATH) return REVIEW_QUEUE_PATH;
  return `${url.pathname}${url.search}`;
}
