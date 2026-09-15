/**
 * CANON-R4 Part 5/29/30 -- the ONE cutover-boundary mechanism. Pure,
 * deterministic. `cutoverAt: null` (the only value this phase ever
 * configures -- see the report's CUTOVER MODEL section) means no v1
 * cutover has been approved yet, so EVERY timestamp classifies as
 * `LEGACY_UNVERSIONED`, unconditionally -- there is no scenario in
 * which this function labels real data `studyus-canonical-v1` before a
 * human has actually set a cutover date.
 */
import { LEGACY_UNVERSIONED, V1_POLICY_VERSION, type EvidenceVersionLabel, type MigrationPolicy } from './types';

export function classifyEvidenceVersion(evidenceTimestamp: string, policy: MigrationPolicy): EvidenceVersionLabel {
  if (policy.cutoverAt == null) return LEGACY_UNVERSIONED;
  return new Date(evidenceTimestamp).getTime() >= new Date(policy.cutoverAt).getTime() ? V1_POLICY_VERSION : LEGACY_UNVERSIONED;
}

/**
 * CANON-R4 Part 30 -- the second, independent gate a caller must apply
 * before ever attaching `studyus-canonical-v1` to a real write: being
 * on-or-after the cutover boundary is necessary but NOT sufficient --
 * the activity actually administered must also satisfy the frozen v1
 * activity contract (item count, independence, difficulty range, etc.).
 * This function only answers the temporal half; it deliberately does
 * NOT import anything from `@/lib/pedagogical-engine` to make that
 * qualification check itself, so a caller can never mistake "temporally
 * eligible" for "policy compliant."
 */
export function isTemporallyEligibleForV1(evidenceTimestamp: string, policy: MigrationPolicy): boolean {
  return classifyEvidenceVersion(evidenceTimestamp, policy) === V1_POLICY_VERSION;
}

/** No cutover configured -- the only value this phase ever ships (Part 5: "Implement/configure the mechanism without executing Production cutover"). */
export const UNCONFIGURED_MIGRATION_POLICY: MigrationPolicy = { cutoverAt: null };
