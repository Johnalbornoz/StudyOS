/**
 * Question Bank V2 -- QUALITY metadata of an item version (pure).
 *
 *   difficulty  -- LOW / MEDIUM / HIGH for people; the 1..5 scale stays internal.
 *                  Three sources, never conflated: declared (the author / generator),
 *                  validated (the human reviewer), observed (Student responses, only with
 *                  enough evidence). Difficulty is NOT exam realism.
 *   usage       -- where a version may be used (PRACTICE, DIAGNOSTIC, QUIZ, REDUCED_MOCK,
 *                  FULL_MOCK, FORMAL_ASSESSMENT); assembly respects it.
 *   alignment   -- how close it is to the real exam: PRACTICE < EXAM_STYLE < MOCK_READY < OFFICIAL.
 *                  OFFICIAL only with official / licensed provenance (also a DB trigger);
 *                  generated content tops out at MOCK_READY, and only after a human review.
 *   review      -- the human certification (Approve / Request correction / Reject).
 *
 * A legacy row (usage / alignment NULL) behaves exactly as before: every use.
 */
import type { CalibrationConfidence } from './lifecycle';
import type { Provenance } from './policy';

export const USAGE_TYPES = ['PRACTICE', 'DIAGNOSTIC', 'QUIZ', 'REDUCED_MOCK', 'FULL_MOCK', 'FORMAL_ASSESSMENT'] as const;
export type UsageType = (typeof USAGE_TYPES)[number];
export const MOCK_USAGES: readonly UsageType[] = ['REDUCED_MOCK', 'FULL_MOCK', 'FORMAL_ASSESSMENT'];

export const ALIGNMENTS = ['PRACTICE', 'EXAM_STYLE', 'MOCK_READY', 'OFFICIAL'] as const;
export type ExamAlignment = (typeof ALIGNMENTS)[number];

export type DifficultyBand = 'LOW' | 'MEDIUM' | 'HIGH';
export const DIFFICULTY_BANDS: readonly DifficultyBand[] = ['LOW', 'MEDIUM', 'HIGH'];

/** 1-2 LOW, 3 MEDIUM, 4-5 HIGH. */
export function bandOf(difficulty: number | null | undefined): DifficultyBand | null {
  if (difficulty === null || difficulty === undefined || !Number.isFinite(difficulty)) return null;
  const d = Math.round(difficulty);
  return d <= 2 ? 'LOW' : d === 3 ? 'MEDIUM' : 'HIGH';
}
export const BAND_CENTER: Record<DifficultyBand, number> = { LOW: 2, MEDIUM: 3, HIGH: 4 };

/**
 * Observed band from the empirical difficulty (share of marks obtained; higher = easier).
 * Only with at least EARLY_SIGNAL evidence -- never fabricated from a handful of responses.
 */
export function observedBand(empiricalDifficulty: number | null | undefined, confidence: CalibrationConfidence | null | undefined): DifficultyBand | null {
  if (empiricalDifficulty === null || empiricalDifficulty === undefined || !confidence || confidence === 'INSUFFICIENT_DATA') return null;
  return empiricalDifficulty >= 0.7 ? 'LOW' : empiricalDifficulty >= 0.4 ? 'MEDIUM' : 'HIGH';
}

export interface DifficultyView {
  declared: DifficultyBand | null;
  validated: DifficultyBand | null;
  observed: DifficultyBand | null;
  /** What assembly and inventory use: validated, else declared. Observed is reported, not substituted, in V1. */
  effective: DifficultyBand | null;
}

export function difficultyView(p: { declared: number | null; validated: number | null; empiricalDifficulty: number | null; confidence: CalibrationConfidence | null }): DifficultyView {
  const declared = bandOf(p.declared);
  const validated = bandOf(p.validated);
  return { declared, validated, observed: observedBand(p.empiricalDifficulty, p.confidence), effective: validated ?? declared };
}

/** Effective usage of a version: a legacy row (NULL) may be used for everything it was used for before. */
export function effectiveUsage(usage: readonly string[] | null | undefined): readonly UsageType[] {
  return usage && usage.length ? (usage.filter((u) => (USAGE_TYPES as readonly string[]).includes(u)) as UsageType[]) : USAGE_TYPES.filter((u) => u !== 'FORMAL_ASSESSMENT');
}

export function effectiveAlignment(alignment: string | null | undefined, provenance: Provenance): ExamAlignment {
  if (alignment && (ALIGNMENTS as readonly string[]).includes(alignment)) return alignment as ExamAlignment;
  return provenance === 'OFFICIAL' || provenance === 'LICENSED' ? 'OFFICIAL' : 'MOCK_READY';
}

/** May this version be used for `use`? (usage AND, for mock-type uses, a mock-ready alignment) */
export function usageAllows(usage: readonly string[] | null | undefined, alignment: string | null | undefined, provenance: Provenance, use: UsageType): boolean {
  if (!effectiveUsage(usage).includes(use)) return false;
  if (MOCK_USAGES.includes(use)) return ['MOCK_READY', 'OFFICIAL'].includes(effectiveAlignment(alignment, provenance));
  return true;
}

/** Defaults for a generated candidate that passed automated validation (before any human decision). */
export const GENERATED_DEFAULT_USAGE: readonly UsageType[] = ['PRACTICE', 'DIAGNOSTIC', 'QUIZ'];
export const GENERATED_DEFAULT_ALIGNMENT: ExamAlignment = 'EXAM_STYLE';

/* ------------------------------------------------------------------ */
/* Human review decisions                                               */
/* ------------------------------------------------------------------ */

export type ReviewDecision = 'APPROVED' | 'CORRECTION_REQUESTED' | 'REJECTED';

export interface ReviewInput {
  decision: ReviewDecision;
  notes: string | null;
  validatedDifficulty: number | null;
  usage: UsageType[] | null;
  alignment: ExamAlignment | null;
  /** Structured review checklist (key -> confirmed). Required on APPROVED when the subject declares one. */
  checklist?: Record<string, boolean> | null;
}

export interface ReviewSubject {
  provenance: Provenance;
  lifecycle: string | null;
  createdBy: string;
  /** Automated validation outcome stored on the version (PASS / NEEDS / REJECTED ...). */
  automatedOutcome: string | null;
  /** Belongs to an exam blueprint cell (a structure the item was validated against). */
  inBlueprintCell: boolean;
  /** A governed pilot's review checklist: every key must be confirmed before APPROVED (null = none declared). */
  requiredChecklist?: readonly string[] | null;
}

export class ReviewError extends Error {
  constructor(public readonly code: 'SELF_REVIEW' | 'NOT_REVIEWABLE' | 'AUTOMATED_VALIDATION_NOT_PASSED' | 'OFFICIAL_NOT_ALLOWED' | 'MOCK_USE_NEEDS_MOCK_READY' | 'MOCK_READY_NEEDS_BLUEPRINT' | 'NOTES_REQUIRED' | 'INVALID_USAGE' | 'CHECKLIST_INCOMPLETE', detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ReviewError';
  }
}

export const REVIEWABLE_STATES = ['PILOT', 'VALIDATED', 'REVIEW_REQUIRED', 'ACTIVE', 'CALIBRATED', 'SUSPENDED'] as const;
export const PASSING_AUTOMATED = ['PASS'] as const;

/**
 * The rules of a human decision (pure; the service applies them and the DB re-checks the
 * critical ones). AI generates -> the system validates -> an editor may correct -> a
 * DIFFERENT person approves.
 */
export function checkReview(subject: ReviewSubject, input: ReviewInput, reviewerUserId: string): { usage: UsageType[]; alignment: ExamAlignment } {
  if (subject.createdBy === reviewerUserId) throw new ReviewError('SELF_REVIEW', 'the author / editor of a version cannot certify it');
  if (!subject.lifecycle || !(REVIEWABLE_STATES as readonly string[]).includes(subject.lifecycle)) throw new ReviewError('NOT_REVIEWABLE', subject.lifecycle ?? 'none');
  if (input.decision !== 'APPROVED') {
    if (!input.notes || input.notes.trim().length < 5) throw new ReviewError('NOTES_REQUIRED');
    return { usage: [...GENERATED_DEFAULT_USAGE], alignment: GENERATED_DEFAULT_ALIGNMENT };
  }
  // A governed pilot: the reviewer confirms every declared point (answer, distractors, competence, ...).
  if (subject.requiredChecklist?.length) {
    const missing = subject.requiredChecklist.filter((k) => input.checklist?.[k] !== true);
    if (missing.length) throw new ReviewError('CHECKLIST_INCOMPLETE', missing.join(','));
  }
  // Generated content needs a passed automated validation before a human may approve it.
  if (subject.provenance === 'STUDYUS_GENERATED' && !(PASSING_AUTOMATED as readonly string[]).includes(subject.automatedOutcome ?? '')) {
    throw new ReviewError('AUTOMATED_VALIDATION_NOT_PASSED', subject.automatedOutcome ?? 'none');
  }
  const official = subject.provenance === 'OFFICIAL' || subject.provenance === 'LICENSED';
  const alignment: ExamAlignment = input.alignment ?? (official ? 'OFFICIAL' : GENERATED_DEFAULT_ALIGNMENT);
  if (alignment === 'OFFICIAL' && !official) throw new ReviewError('OFFICIAL_NOT_ALLOWED', 'only official / licensed content can be OFFICIAL');
  if (alignment === 'MOCK_READY' && !subject.inBlueprintCell) throw new ReviewError('MOCK_READY_NEEDS_BLUEPRINT');
  const usage = input.usage ?? [...GENERATED_DEFAULT_USAGE];
  if (usage.length === 0 || usage.some((u) => !(USAGE_TYPES as readonly string[]).includes(u))) throw new ReviewError('INVALID_USAGE');
  if (usage.some((u) => MOCK_USAGES.includes(u)) && !['MOCK_READY', 'OFFICIAL'].includes(alignment)) throw new ReviewError('MOCK_USE_NEEDS_MOCK_READY');
  return { usage: [...new Set(usage)], alignment };
}

/** Human-readable status of the certification of a version. */
export function reviewStatusOf(p: { provenance: Provenance; latestDecision: ReviewDecision | null; lifecycle: string | null }): 'APPROVED' | 'PENDING' | 'REJECTED' | 'CORRECTION_REQUESTED' | 'NOT_REQUIRED' {
  if (p.latestDecision) return p.latestDecision;
  if (p.provenance !== 'STUDYUS_GENERATED') return 'NOT_REQUIRED';
  return p.lifecycle === 'REJECTED' ? 'REJECTED' : 'PENDING';
}
