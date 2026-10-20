/**
 * QB-R2C -- the difficulty calibration CONTRACT (pure, no IO).
 *
 * Every band in the plan is an EDITORIAL_ESTIMATE: what the author expects. This module states what it takes
 * for a band to become EMPIRICAL -- and nothing else. It calibrates no item today: there are no learner
 * responses, so everything it is given returns NOT_CALIBRATED.
 *
 * What may move a band (all of it, from LEARNERS answering the delivered item):
 *   responses (n), item facility (the proportion correct, the p-value), a discrimination index (point-biserial
 *   with the rest score), the median response time, and who the sample was.
 * What may NOT, by construction: an author's or a model's opinion of its own item. Evidence whose source is not
 * LEARNER_RESPONSES, or whose respondents include authors or staff, is refused by name. There is no parameter,
 * override or default that turns an estimate into an empirical band.
 *
 * AUTHORITY: `DIFFICULTY_CALIBRATION_POLICY` is a StudyUs policy and it is PROVISIONAL. The thresholds and the
 * facility ranges below are placeholders to be set with a psychometrician before the first calibration run;
 * they are here so that the contract is executable and testable, not because they have been validated.
 */
import { DIFFICULTY_BANDS } from './requirement-cell';

export type DifficultyBand = (typeof DIFFICULTY_BANDS)[number];
export const DIFFICULTY_BASES = ['EDITORIAL_ESTIMATE', 'EMPIRICAL'] as const;
export type DifficultyBasis = (typeof DIFFICULTY_BASES)[number];

export const DIFFICULTY_CALIBRATION_POLICY = {
  id: 'studyus-difficulty-calibration', version: '0', authority: 'STUDYUS_POLICY', status: 'PROVISIONAL',
  /** PROVISIONAL minimums. */
  minimumResponses: 200,
  minimumDiscrimination: 0.2,
  minimumMedianResponseSeconds: 5,
  /** PROVISIONAL. Outside this range an item is too easy or too hard to place in a band from its facility alone. */
  calibratableFacility: { min: 0.1, max: 0.95 },
  /** PROVISIONAL mapping from facility (proportion correct) to band: at or above `from`, below the previous band's `from`. */
  facilityToBand: [{ band: 'FOUNDATIONAL', from: 0.7 }, { band: 'STANDARD', from: 0.4 }, { band: 'CHALLENGE', from: 0 }],
} as const;

export const CALIBRATION_EVIDENCE_SOURCES = ['LEARNER_RESPONSES', 'AUTHOR_ESTIMATE', 'MODEL_ESTIMATE', 'SELF_AUTHORED_TRIAL'] as const;

/** What was observed when learners answered the item. Every figure is required: a missing one is "no data". */
export interface CalibrationEvidence {
  source: (typeof CALIBRATION_EVIDENCE_SOURCES)[number];
  /** Scored responses of distinct learners. */
  responses: number | null;
  /** Proportion correct, 0..1. */
  facility: number | null;
  /** Point-biserial correlation of the item score with the rest score, -1..1. */
  discrimination: number | null;
  medianResponseSeconds: number | null;
  sampleComposition: { describedAs: string | null; targetPopulation: 'MATCHES' | 'PARTIAL' | 'UNKNOWN'; respondentsIncludeAuthorsOrStaff: boolean | null } | null;
}

export type NotCalibratedReason =
  | 'NO_EVIDENCE' | 'EVIDENCE_IS_NOT_LEARNER_RESPONSES' | 'RESPONDENTS_INCLUDE_AUTHORS_OR_STAFF' | 'RESPONDENTS_NOT_DECLARED' | 'SAMPLE_COMPOSITION_MISSING' | 'SAMPLE_NOT_THE_TARGET_POPULATION' | 'EVIDENCE_INCOMPLETE' | 'EVIDENCE_OUT_OF_RANGE'
  | 'TOO_FEW_RESPONSES' | 'DISCRIMINATION_TOO_LOW' | 'RESPONSE_TIME_IMPLAUSIBLE' | 'FACILITY_OUT_OF_CALIBRATABLE_RANGE';

export type CalibrationVerdict =
  | { status: 'NOT_CALIBRATED'; basis: 'EDITORIAL_ESTIMATE'; band: DifficultyBand; reasons: NotCalibratedReason[]; policy: { id: string; version: string; status: string } }
  | { status: 'CALIBRATED'; basis: 'EMPIRICAL'; band: DifficultyBand; editorialBand: DifficultyBand; agreesWithEditorialEstimate: boolean; reasons: []; policy: { id: string; version: string; status: string } };

export const bandOfFacility = (facility: number): DifficultyBand => DIFFICULTY_CALIBRATION_POLICY.facilityToBand.find((r) => facility >= r.from)!.band;

/**
 * May this item's band move from EDITORIAL_ESTIMATE to EMPIRICAL? Only with complete learner-response evidence
 * that meets every minimum. Anything else keeps the editorial band and says why.
 */
export function evaluateDifficultyCalibration(editorialBand: DifficultyBand, evidence: CalibrationEvidence | null | undefined): CalibrationVerdict {
  const P = DIFFICULTY_CALIBRATION_POLICY;
  const policy = { id: P.id, version: P.version, status: P.status };
  const not = (...reasons: NotCalibratedReason[]): CalibrationVerdict => ({ status: 'NOT_CALIBRATED', basis: 'EDITORIAL_ESTIMATE', band: editorialBand, reasons, policy });
  if (!evidence) return not('NO_EVIDENCE');
  // an opinion about one's own item is not data, whoever holds it and however many times it is repeated
  if (evidence.source !== 'LEARNER_RESPONSES') return not('EVIDENCE_IS_NOT_LEARNER_RESPONSES');
  if (!evidence.sampleComposition) return not('SAMPLE_COMPOSITION_MISSING');
  if (evidence.sampleComposition.respondentsIncludeAuthorsOrStaff === null) return not('RESPONDENTS_NOT_DECLARED');
  if (evidence.sampleComposition.respondentsIncludeAuthorsOrStaff) return not('RESPONDENTS_INCLUDE_AUTHORS_OR_STAFF');
  const figures = [evidence.responses, evidence.facility, evidence.discrimination, evidence.medianResponseSeconds];
  if (figures.some((x) => x === null || x === undefined || !Number.isFinite(x)) || !evidence.sampleComposition.describedAs?.trim()) return not('EVIDENCE_INCOMPLETE');
  const [n, p, d, t] = figures as number[];
  if (!Number.isInteger(n) || n < 0 || p < 0 || p > 1 || d < -1 || d > 1 || t < 0) return not('EVIDENCE_OUT_OF_RANGE');
  const reasons: NotCalibratedReason[] = [];
  if (evidence.sampleComposition.targetPopulation !== 'MATCHES') reasons.push('SAMPLE_NOT_THE_TARGET_POPULATION');
  if (n < P.minimumResponses) reasons.push('TOO_FEW_RESPONSES');
  if (d < P.minimumDiscrimination) reasons.push('DISCRIMINATION_TOO_LOW');
  if (t < P.minimumMedianResponseSeconds) reasons.push('RESPONSE_TIME_IMPLAUSIBLE');
  if (p < P.calibratableFacility.min || p > P.calibratableFacility.max) reasons.push('FACILITY_OUT_OF_CALIBRATABLE_RANGE');
  if (reasons.length > 0) return not(...reasons);
  const band = bandOfFacility(p);
  return { status: 'CALIBRATED', basis: 'EMPIRICAL', band, editorialBand, agreesWithEditorialEstimate: band === editorialBand, reasons: [], policy };
}
