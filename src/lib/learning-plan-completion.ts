/**
 * Phase 8 -- Step 8E1: PURE derivation of a plan item's real status
 * from CANONICAL activity, never from "a page was opened".
 *
 * Completion is DERIVED, not a second source of truth: an item counts
 * as COMPLETED only when `learning_evidence` (concept-scoped) exists on
 * or after its `scheduled_date`, matching Phase 1E-R's concept-
 * granularity linkage but tightened to the item's own concept +
 * scheduled date. A live item whose window has fully passed with no
 * such evidence is EXPIRED (orchestration evidence, NOT a cognitive
 * failure). Otherwise it stays LIVE.
 *
 * No DB, no AI, no clock -- `todayIso` is explicit.
 */
export type DerivedPlanItemStatus = 'COMPLETED' | 'EXPIRED' | 'LIVE';

export interface CompletionItemView {
  conceptId: string | null;
  scheduledDate: string; // YYYY-MM-DD
  /** Only live items (PLANNED / READY) are reconciled; terminal items are returned unchanged. */
  status: 'PLANNED' | 'READY' | 'COMPLETED' | 'SKIPPED' | 'EXPIRED' | 'SUPERSEDED';
}

export interface CanonicalEvidenceRow {
  conceptId: string;
  /** YYYY-MM-DD of the evidence timestamp. */
  date: string;
}

/**
 * @param item          one plan item
 * @param evidence      the learner's recent canonical evidence rows (concept + date)
 * @param todayIso      YYYY-MM-DD "now" in the learner's timezone
 */
export function derivePlanItemStatus(
  item: CompletionItemView,
  evidence: readonly CanonicalEvidenceRow[],
  todayIso: string,
): DerivedPlanItemStatus {
  if (item.status !== 'PLANNED' && item.status !== 'READY') {
    // terminal -- never reopened / re-expired
    return item.status === 'COMPLETED' ? 'COMPLETED' : item.status === 'EXPIRED' ? 'EXPIRED' : 'LIVE';
  }
  if (item.conceptId) {
    const done = evidence.some((e) => e.conceptId === item.conceptId && e.date >= item.scheduledDate);
    if (done) return 'COMPLETED';
  }
  // Window passed (scheduled date is strictly before today) and no completion evidence.
  if (item.scheduledDate < todayIso) return 'EXPIRED';
  return 'LIVE';
}
