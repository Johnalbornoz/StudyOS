/**
 * A Student's own partial exam -- the selection rules. No dependency: usable by any route or service.
 */
/** The launch request accepts at most this many concepts in one scope (assessment-experience/launch.ts). */
export const AD_HOC_EXAM_MAX_CONCEPTS = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export type AdHocSelectionIssue = 'NO_CONCEPTS' | 'TOO_MANY_CONCEPTS' | 'MALFORMED_CONCEPT';

/** The Student's selection, de-duplicated and in a stable order. It never adds a concept. */
export function normalizeSelection(conceptIds: readonly unknown[]): { ok: true; conceptIds: string[] } | { ok: false; issue: AdHocSelectionIssue } {
  if (!conceptIds.every(isUuid)) return { ok: false, issue: 'MALFORMED_CONCEPT' };
  const unique = [...new Set(conceptIds as string[])].sort();
  if (unique.length === 0) return { ok: false, issue: 'NO_CONCEPTS' };
  if (unique.length > AD_HOC_EXAM_MAX_CONCEPTS) return { ok: false, issue: 'TOO_MANY_CONCEPTS' };
  return { ok: true, conceptIds: unique };
}
