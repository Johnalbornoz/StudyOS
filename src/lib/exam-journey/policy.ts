/**
 * Student Exam Journey -- JOURNEY POLICY (UX pacing), versioned.
 *
 * O-01 (APPROVED): the Blueprint / exam definition owns the academic FACTS
 * (session/date, components, availability, prerequisites, structural rules).
 * The Student Journey decides WHEN to recommend preparation, from the exam
 * date, readiness, historical evidence, current mastery and the preparation
 * intensity required. These values are therefore journey policy -- never
 * Blueprint data, never exam-specific, never an academic rule. Each one is
 * named here; the resolver contains no other threshold.
 *
 * O-04 (APPROVED): every mock threshold below is GUIDANCE (recommended / not
 * recommended). None of them can make a mock unstartable.
 */
export const JOURNEY_POLICY_V1 = {
  version: 'journey-policy-v1',
  /**
   * Preparation window = minWeeks + (maxWeeks - minWeeks) x gapShare, where
   * gapShare = 1 - weighted ready share of the mapped requirements (unknown
   * evidence counts as gap). More to close -> the window opens earlier.
   */
  preparationWindow: { minWeeks: 8, maxWeeks: 26 },
  /** Learning on target-mapped concepts this recent counts as foundation building. */
  foundationRecencyDays: 30,
  /**
   * A diagnostic is due while at least this share of the mapped requirements has
   * no evidence. Mirrors the existing preparation `nextStep` rule (unknown >= 50 %).
   */
  diagnosticUnknownShare: 0.5,
  /** Mock 1 is RECOMMENDED when the weighted ready share reaches this... */
  mockMinReadyShare: 0.4,
  /** ...or when the exam is this close (time overrides readiness). */
  mockTimeOverrideDays: 56,
  /** The next mock is RECOMMENDED this long after the last one, with preparation activity in between... */
  nextMockMinDaysSinceLast: 14,
  /** ...or when the exam is this close. */
  nextMockTimeOverrideDays: 28,
  /** No further mock is recommended when fewer days than this remain. */
  lastMockMinDaysBeforeExam: 14,
  /** Final preparation and exam-ready windows (days before the exam date). */
  finalWindowDays: 21,
  readyWindowDays: 3,
  /** Lowest form fidelity that counts as a numbered mock. */
  minimumMockFidelity: 'REDUCED' as 'REDUCED' | 'FULL',
} as const;

export type JourneyPolicy = typeof JOURNEY_POLICY_V1;

/** Window length in days for a weighted ready share (null = unknown = all gap). */
export function preparationWindowDays(policy: JourneyPolicy, readyShare: number | null): number {
  const gapShare = readyShare === null ? 1 : Math.min(1, Math.max(0, 1 - readyShare));
  const { minWeeks, maxWeeks } = policy.preparationWindow;
  return Math.round((minWeeks + (maxWeeks - minWeeks) * gapShare) * 7);
}
