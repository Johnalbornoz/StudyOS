/**
 * CANON-R3 -- Pedagogical Engine Shadow Integration: public surface.
 *
 * Read-only, comparison-only. Nothing exported here has authority over
 * learner-facing behavior -- see docs/CANON_R3_SHADOW_INTEGRATION.md.
 */
export { mapStudyUSEvidenceToPedagogicalEvidence, normalizeScorePercent, fingerprintEvidenceRows } from './evidence-adapter';
export { fnv1aHex } from './fingerprint';
export { buildOldCanonicalSnapshot, fetchOldCanonicalSnapshot, type OldCanonicalSnapshotInput } from './old-canonical-snapshot';
export { fetchStudyUSEvidenceRows } from './evidence-fetch';
export { buildNewCanonicalSnapshot } from './new-canonical-snapshot';
export { compareCanonicalDecisions, type ComparatorAdapterMetadata } from './comparator';
export { buildShadowComparisonRecord } from './shadow-record';

export type {
  AdapterConfidence,
  AdapterUnresolvedMapping,
  AdapterUnresolvedReason,
  ComparisonOutcome,
  ComparisonResult,
  DisagreementReasonCode,
  EvidenceAdapterResult,
  NewCanonicalSnapshot,
  OldCanonicalSnapshot,
  ScoreShape,
  ShadowComparisonRecord,
  StudyUSEvidenceRow,
} from './types';
