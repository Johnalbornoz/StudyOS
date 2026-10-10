/**
 * B1-E -- Exam form fidelity: is a frozen MOCK form a VERIFIED COMPLETE official-format form? (pure, no IO)
 *
 *   FULL      every fact that makes a form the complete official one is recorded AND met.
 *   REDUCED   the form follows the official model and is KNOWN to be smaller than the complete official form.
 *   UNKNOWN   a fact needed to decide is not recorded, so completeness can be neither confirmed nor denied.
 *
 * It is derived only from machine-readable exam / blueprint facts -- never from the attempt type, a UI label
 * or the instance mode -- and it names no vertical: every exam is judged by the same facts.
 *
 * Facts used (each from its existing source):
 *   - the frozen form: positions, filled positions, planned marks per component        (AssembledForm)
 *   - the component definition: official marks, official item count, official duration (ComponentDefinition)
 *   - the blueprint: how many positions it holds for the component                     (blueprint_objective_targets)
 *   - the full-form distribution status: DOCUMENTED / PARTIAL / UNKNOWN                (blueprintSpecificationOf)
 *   - the configured timing of the component                                           (assessment_components)
 *   - the official component combinations of the exam                                  (exam_versions.navigation_rules.assessmentRoutes)
 *
 * Size alone never proves FULL. A form that reaches the official marks and item count is still UNKNOWN when
 * its full-form distribution is not documented with a source, when its official timing cannot be confirmed,
 * or when the official size itself is not recorded. Nothing is assumed, estimated or filled in.
 *
 * Difficulty is a separate question (`difficultyBandMet`): a MOCK must land in the official difficulty band
 * to be a full mock; a CHALLENGE deliberately does not, and is never classified here.
 *
 * This is NOT the Mock Certification gate (question-bank/mock-certification.ts): that certifies whether the
 * BANK can serve mocks; this classifies ONE frozen form.
 */
import type { ContentAudience } from './audience';

export type ExamFormFidelity = 'FULL' | 'REDUCED' | 'UNKNOWN';

export type BlueprintDistributionStatus = 'DOCUMENTED' | 'PARTIAL' | 'UNKNOWN';

export interface FormComponentFacts {
  componentId: string;
  sectionKey: string | null;
  /** A verified component definition exists (the source of every official fact below). */
  definitionPresent: boolean;
  officialMarks: number | null;
  officialItemCount: number | null;
  officialDurationMinutes: number | null;
  /** Duration the component is configured to run with (null = not configured). */
  configuredDurationMinutes: number | null;
  distribution: BlueprintDistributionStatus;
  /** Positions the published blueprint holds for this component. */
  blueprintPositions: number;
  /** From the frozen form. */
  formPositions: number;
  filledPositions: number;
  plannedMarks: number;
}

export interface FormFidelityFacts {
  /** The instance has a form and `form_frozen_at`. */
  formFrozen: boolean;
  components: FormComponentFacts[];
  /** Section keys of every mockable component of the exam version. */
  versionMockableSectionKeys: string[];
  /** Official component combinations (and stages of staged routes), as section-key sets. Empty = none recorded. */
  officialComponentSets: string[][];
}

export type FidelityReason =
  // UNKNOWN: a needed fact is not recorded
  | 'FORM_NOT_FROZEN'
  | 'NO_COMPONENTS'
  | 'COMPONENT_DEFINITION_MISSING'
  | 'OFFICIAL_SIZE_NOT_RECORDED'
  | 'OFFICIAL_TIMING_NOT_VERIFIABLE'
  | 'DISTRIBUTION_NOT_DOCUMENTED'
  // REDUCED: known to be smaller than the complete official form
  | 'UNFILLED_POSITIONS'
  | 'FORM_SHORTER_THAN_BLUEPRINT'
  | 'BELOW_OFFICIAL_MARKS'
  | 'BELOW_OFFICIAL_ITEM_COUNT'
  | 'COMPONENT_SET_INCOMPLETE';

export interface FormFidelity {
  fidelity: ExamFormFidelity;
  reasons: FidelityReason[];
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

export function classifyExamFormFidelity(f: FormFidelityFacts): FormFidelity {
  const add = (list: FidelityReason[], r: FidelityReason) => {
    if (!list.includes(r)) list.push(r);
  };

  /* ---- facts without which nothing can be said about size ---- */
  const blocking: FidelityReason[] = [];
  if (!f.formFrozen) add(blocking, 'FORM_NOT_FROZEN');
  if (f.components.length === 0) add(blocking, 'NO_COMPONENTS');
  for (const c of f.components) {
    if (!c.definitionPresent) add(blocking, 'COMPONENT_DEFINITION_MISSING');
    else if (c.officialMarks === null && c.officialItemCount === null) add(blocking, 'OFFICIAL_SIZE_NOT_RECORDED');
  }
  if (blocking.length > 0) return { fidelity: 'UNKNOWN', reasons: blocking };

  /* ---- known to be smaller than the complete official form ---- */
  const reduced: FidelityReason[] = [];
  for (const c of f.components) {
    if (c.filledPositions < c.formPositions) add(reduced, 'UNFILLED_POSITIONS');
    if (c.formPositions < c.blueprintPositions) add(reduced, 'FORM_SHORTER_THAN_BLUEPRINT');
    if (c.officialMarks !== null && c.plannedMarks < c.officialMarks) add(reduced, 'BELOW_OFFICIAL_MARKS');
    if (c.officialItemCount !== null && c.filledPositions < c.officialItemCount) add(reduced, 'BELOW_OFFICIAL_ITEM_COUNT');
  }
  // Required components: the whole exam (every mockable component), or exactly one recorded official combination.
  const selected = f.components.map((c) => c.sectionKey);
  const keyed = selected.every((k): k is string => !!k);
  const completeSet = keyed && (sameSet(selected as string[], f.versionMockableSectionKeys) || f.officialComponentSets.some((set) => sameSet(selected as string[], set)));
  if (!completeSet) add(reduced, 'COMPONENT_SET_INCOMPLETE');
  if (reduced.length > 0) return { fidelity: 'REDUCED', reasons: reduced };

  /* ---- size is complete: FULL only if the rest of the official structure is verified too ---- */
  const unverified: FidelityReason[] = [];
  for (const c of f.components) {
    if (c.officialDurationMinutes === null || c.configuredDurationMinutes === null || c.configuredDurationMinutes !== c.officialDurationMinutes) add(unverified, 'OFFICIAL_TIMING_NOT_VERIFIABLE');
    if (c.distribution !== 'DOCUMENTED') add(unverified, 'DISTRIBUTION_NOT_DOCUMENTED');
  }
  if (unverified.length > 0) return { fidelity: 'UNKNOWN', reasons: unverified };

  return { fidelity: 'FULL', reasons: [] };
}

/* ------------------------------------------------------------------ */
/* Stored attempt type of an exam instance                              */
/* ------------------------------------------------------------------ */

export type InstanceAttemptType = 'EXAM_PRACTICE' | 'EXAM_CHALLENGE' | 'FULL_MOCK' | 'REDUCED_MOCK';

/** Why a MOCK instance may not be created / started (the canonical not-ready code is FIDELITY_NOT_VERIFIABLE). */
export type MockNotStartableReason = 'FIDELITY_UNKNOWN' | 'OFFICIAL_DIFFICULTY_NOT_MET';

export type InstanceAttemptDecision = { startable: true; type: InstanceAttemptType } | { startable: false; reason: MockNotStartableReason; fidelityReasons: FidelityReason[] };

/**
 * The ONE place the stored attempt type of an exam instance is decided (the exam-instance start service is
 * its only caller that writes):
 *
 *   PRACTICE                      -> EXAM_PRACTICE
 *   CHALLENGE                     -> EXAM_CHALLENGE   (frozen, officially timed, deliberately above official difficulty)
 *   MOCK, fidelity FULL           -> FULL_MOCK        (and only when the form lands in the official difficulty band)
 *   MOCK, fidelity REDUCED        -> REDUCED_MOCK
 *   MOCK, fidelity UNKNOWN        -> not startable. Never downgraded to preparation.
 *
 * A TECHNICAL_DEMO instance (in-process engine certification on DEV fixtures; no Student route creates one)
 * is never a verified official mock: it is stored as REDUCED_MOCK whatever its fidelity, and is not refused
 * for UNKNOWN fidelity. It keeps every REDUCED_MOCK guarantee (frozen form, no generated content).
 */
export function deriveInstanceAttemptType(p: { mode: string; fidelity: FormFidelity | null; difficultyBandMet: boolean | null; contentAudience?: ContentAudience }): InstanceAttemptDecision {
  if (p.mode === 'PRACTICE') return { startable: true, type: 'EXAM_PRACTICE' };
  if (p.mode === 'CHALLENGE') return { startable: true, type: 'EXAM_CHALLENGE' };
  if (p.contentAudience === 'TECHNICAL_DEMO') return { startable: true, type: 'REDUCED_MOCK' };
  const fidelity = p.fidelity ?? { fidelity: 'UNKNOWN' as const, reasons: ['FORM_NOT_FROZEN' as const] };
  if (fidelity.fidelity === 'REDUCED') return { startable: true, type: 'REDUCED_MOCK' };
  if (fidelity.fidelity === 'UNKNOWN') return { startable: false, reason: 'FIDELITY_UNKNOWN', fidelityReasons: fidelity.reasons };
  // FULL structure: a full mock is also the official difficulty.
  if (p.difficultyBandMet !== true) return { startable: false, reason: 'OFFICIAL_DIFFICULTY_NOT_MET', fidelityReasons: [] };
  return { startable: true, type: 'FULL_MOCK' };
}
