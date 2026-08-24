/**
 * Phase 3A: Activity Type and Evidence Mode are two separate
 * dimensions -- this is fixed, not a stylistic choice (see
 * docs/architecture/phase-3-adaptive-learning-orchestration.md).
 *
 * Activity Type answers: what learning experience is the student
 * doing? Evidence Mode answers: under what conditions was their
 * performance produced? A student never sees "Evidence Mode" --
 * they see one of the five visible activities (Practice, Review,
 * Solo Check, Cumulative Assessment, Mock Exam); Evidence Mode is
 * purely an engine concept that determines AI permission and how
 * strongly the resulting evidence counts toward Independence.
 *
 * The mapping below is fixed and total (every Activity Type has
 * exactly one Evidence Mode) -- there is no per-call override. This
 * is what makes Evidence Mode immutable within an attempt: once an
 * attempt is created with an Activity Type, its Evidence Mode is a
 * pure function of that type, for its entire lifetime.
 */

export type EvidenceMode = 'PRACTICE' | 'INDEPENDENT' | 'ASSESSMENT';

export type ActivityType =
  | 'PRACTICE'
  | 'REVIEW'
  | 'SOLO_CHECK'
  | 'DIAGNOSTIC_CHECK'
  | 'REMEDIATION'
  | 'SOLO_VERIFY'
  | 'TRANSFER'
  | 'RETENTION_CHECK'
  | 'CUMULATIVE_ASSESSMENT'
  | 'MOCK_EXAM';

/**
 * Review has two cognitive purposes that are deliberately split into
 * two Activity Types rather than one REVIEW type with a flag:
 * REVIEW (reinforcement -- AI may assist, evidenceMode PRACTICE) and
 * RETENTION_CHECK (StudyUS needs proof the student still remembers --
 * no AI assistance, evidenceMode INDEPENDENT). Which one fires for a
 * given "Repasar" moment is a caller decision (student-initiated vs.
 * scheduler-triggered), not something this table decides.
 */
const EVIDENCE_MODE_BY_ACTIVITY: Record<ActivityType, EvidenceMode> = {
  PRACTICE: 'PRACTICE',
  REVIEW: 'PRACTICE',
  SOLO_CHECK: 'INDEPENDENT',
  DIAGNOSTIC_CHECK: 'ASSESSMENT',
  REMEDIATION: 'PRACTICE',
  SOLO_VERIFY: 'INDEPENDENT',
  TRANSFER: 'INDEPENDENT',
  RETENTION_CHECK: 'INDEPENDENT',
  CUMULATIVE_ASSESSMENT: 'ASSESSMENT',
  MOCK_EXAM: 'ASSESSMENT',
};

export function evidenceModeForActivity(activityType: ActivityType): EvidenceMode {
  return EVIDENCE_MODE_BY_ACTIVITY[activityType];
}
