/**
 * UX-5 -- APPROVED EDUCATIONAL SOURCE REGISTRY.
 *
 * The only channels the Tutor may ever search or show. Kept as typed,
 * code-reviewed configuration (a change here is a reviewed pull request --
 * that IS the approval workflow until a persistent registry exists; see the
 * proposed schema in docs/ux/UX5_TUTOR_FUNCTIONAL_MULTIMODAL_SAFETY_REPORT.md).
 *
 * Trust is recorded, never inferred: popularity, subscriber counts and views
 * are NOT inputs. A source records WHY it is trusted (`rationale`) and who
 * reviewed it. StudyUS does not claim any external certification that does
 * not exist.
 *
 * DEV ships EMPTY on purpose: no channel id is added without a real review
 * (an invented id would be a fabricated approval). With no approved source,
 * video retrieval is disabled and the Tutor offers another representation.
 */
import type { AgeBand } from '../age-band';

/** A: recognized educational institution / official body. B: reviewed educational creator. */
export type SourceTier = 'A' | 'B';
export type SourceType = 'INSTITUTION' | 'UNIVERSITY' | 'MUSEUM_SCIENCE' | 'OFFICIAL_BODY' | 'PUBLISHER' | 'REVIEWED_EDUCATOR';
export type SourceStatus = 'APPROVED' | 'SUSPENDED' | 'PENDING_REVIEW';

export interface ApprovedSource {
  /** YouTube channel id (UC...). */
  channelId: string;
  organization: string;
  /** Shown to the Student as the source; never translated. */
  displayName: string;
  sourceType: SourceType;
  tier: SourceTier;
  /** Broad subject areas this source is approved for (lowercase keywords matched against the subject/topic names). */
  subjects: string[];
  /** Interface languages the source publishes in. */
  languages: string[];
  /** Age bands the source is approved for. */
  ageBands: Exclude<AgeBand, 'UNKNOWN'>[];
  status: SourceStatus;
  /** Why StudyUS trusts it (institution, publisher, reviewed provenance...). */
  rationale: string;
  reviewedBy: string;
  reviewedAt: string;
  /** Re-review due date; past it the source is treated as not approved. */
  reviewExpiresAt: string;
}

export const APPROVED_SOURCES: readonly ApprovedSource[] = [];

export function activeSources(registry: readonly ApprovedSource[], now: Date): ApprovedSource[] {
  return registry.filter((s) => s.status === 'APPROVED' && new Date(s.reviewExpiresAt) > now);
}
