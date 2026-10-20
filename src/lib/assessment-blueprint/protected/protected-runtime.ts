/**
 * B2-B2 -- from persisted facts to a protected selection (pure).
 *
 *   a PUBLISHED variant, as the persistence adapter loaded it   (identity, pool, authority-tagged requirements)
 *   + the Question Bank's facts for its exam version             (coverage, pool membership)
 *   + one Student's exposure, or none when a fixed form is assembled
 *     -> `solveProtectedForm` (FULL / REDUCED)  or  a selectable Diagnostic plan
 *
 * This file decides nothing new. It refuses a variant that is not what it claims to be before any question
 * is looked at, turns the variant's STIMULUS_SET requirements into unit requirements, and hands everything
 * to the protected selector. It reads no table, and nothing calls it from a route or a start path.
 *
 * What a variant does NOT carry yet: its slot positions. They are the caller's input here, exactly as they
 * are for the existing official pipeline; no reader builds them for a variant (a later gate).
 */
import type { DeliveryUse } from '@/lib/exam-core/question-bank/lifecycle';
import type { FormFidelity } from '@/lib/exam-core/form-fidelity';
import type { FormPosition } from '@/lib/exam-core/form-assembly';
import { questionRefKey, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import { eligibleSolverCandidates, type CandidateExtras } from '../pipeline';
import type { SolverCandidate, TargetKind } from '../solver/candidate';
import type { TargetPlan } from '../solver/plan';
import { specificationViolations, stimulusSetRequirements, type BlueprintSpecification, type SpecificationViolation } from './authority';
import { blueprintKey, type BlueprintIdentity } from './blueprint-identity';
import { diagnosticTargetPlan, type DiagnosticDepthRequirement } from './diagnostic';
import { PILOT_EXPOSURE_POLICY, exposureVerdict, type ExposurePolicy, type ExposureRejection, type ProtectedExposureFacts } from './exposure-policy';
import { PILOT_POOL_POLICY, poolForBlueprint, poolVerdict, type LogicalPool, type PoolAssignments, type PoolPolicy, type PoolRejection } from './pools';
import { FIXED_FORM_SUBJECT, solveProtectedForm, type ProtectedFormResult } from './protected-selection';
import type { SelectionUnitRequirement } from './selection-unit';

/** A blueprint variant as stored: what the persistence adapter reads back. */
export interface PersistedVariant {
  blueprintId: string;
  identity: BlueprintIdentity;
  /** The pool recorded on the variant row. A published variant always names one. */
  pool: LogicalPool | null;
  specification: BlueprintSpecification;
  /** Section subject of a requirement -> `assessment_components.id` (slots are matched by component id). */
  componentIdBySubject: Record<string, string>;
}

/** The read-only facts a protected selection needs for one exam version and, optionally, one Student. */
export interface ProtectedSelectionFacts {
  examVersionId: string;
  /** Coverage of every current item version of the exam version. */
  coverages: readonly QuestionCoverage[];
  poolAssignments: PoolAssignments;
  /** Item-level exposure of the Student. Empty for a fixed-form assembly. */
  exposure: ReadonlyMap<string, ProtectedExposureFacts>;
  /** Stimuli the Student has met through any version of any of their questions, and every version of those stimuli. */
  exposedStimuli: { stimulusIds: ReadonlySet<string>; stimulusVersionIds: ReadonlySet<string> };
}

export type VariantRefusal =
  | { code: 'VARIANT_NOT_PUBLISHED' }
  | { code: 'VARIANT_OF_ANOTHER_EXAM_VERSION' }
  | { code: 'VARIANT_IS_NOT_A_DIAGNOSTIC' }
  /** The stored pool is not the pool the pool policy gives this purpose and form. */
  | { code: 'VARIANT_POOL_MISMATCH'; stored: LogicalPool | null; expected: LogicalPool | null }
  | { code: 'SPECIFICATION_INVALID'; violations: SpecificationViolation[] }
  /** A STIMULUS_SET requirement names a section the variant's exam version does not have. */
  | { code: 'STIMULUS_SET_SECTION_UNKNOWN'; key: string };

/** Why a stored variant may not be used for a selection. Empty = it may. */
export function variantRefusals(variant: PersistedVariant, examVersionId: string): VariantRefusal[] {
  const out: VariantRefusal[] = [];
  if (variant.identity.status !== 'PUBLISHED') out.push({ code: 'VARIANT_NOT_PUBLISHED' });
  if (variant.identity.examVersionId !== examVersionId) out.push({ code: 'VARIANT_OF_ANOTHER_EXAM_VERSION' });
  const expected = poolForBlueprint(variant.identity);
  if (variant.pool === null || variant.pool !== expected) out.push({ code: 'VARIANT_POOL_MISMATCH', stored: variant.pool, expected });
  const violations = specificationViolations(variant.specification);
  if (violations.length > 0) out.push({ code: 'SPECIFICATION_INVALID', violations });
  for (const r of stimulusSetRequirements(variant.specification)) if (r.subject !== null && !variant.componentIdBySubject[r.subject]) out.push({ code: 'STIMULUS_SET_SECTION_UNKNOWN', key: r.key });
  return out;
}

/** The unit requirements of a variant: one per STIMULUS_SET requirement, about its section when it names one. */
export function unitRequirementsOf(variant: PersistedVariant): SelectionUnitRequirement[] {
  return stimulusSetRequirements(variant.specification).map((r) => ({ type: 'STIMULUS_GROUP' as const, setKind: r.kind, units: r.sets, minItems: r.minItems, maxItems: r.maxItems, assessmentComponentId: r.subject === null ? null : variant.componentIdBySubject[r.subject] ?? null }));
}

/** What the caller still supplies: the variant's positions and B1's verified fidelity of the form they describe. */
export interface ProtectedFormShape {
  positions: readonly FormPosition[];
  fidelity: FormFidelity | null;
  difficultyBandMet: boolean | null;
  extras?: ReadonlyMap<string, CandidateExtras>;
  officialMinutes?: number | null;
  /** The Student the form is checked for. Omitted = a fixed form assembled for no one (`FIXED_FORM_SUBJECT`), with no exposure. */
  studentId?: string;
  poolPolicy?: PoolPolicy;
  exposurePolicy?: ExposurePolicy;
}

export type ProtectedAssembly = { ok: true; result: ProtectedFormResult } | { ok: false; refusals: VariantRefusal[] };

/** Stored variant + Question Bank facts -> a protected form, or every reason there is none. FULL and REDUCED only. */
export function assembleProtectedForm(variant: PersistedVariant, facts: ProtectedSelectionFacts, shape: ProtectedFormShape): ProtectedAssembly {
  const refusals = variantRefusals(variant, facts.examVersionId);
  if (refusals.length > 0) return { ok: false, refusals };
  const forStudent = shape.studentId !== undefined;
  return {
    ok: true,
    result: solveProtectedForm({
      identity: variant.identity,
      policy: { studentId: shape.studentId ?? FIXED_FORM_SUBJECT, examTargetId: null, examVersionId: facts.examVersionId, blueprintId: variant.blueprintId, positions: shape.positions, officialMinutes: shape.officialMinutes ?? null },
      coverages: facts.coverages,
      extras: shape.extras,
      // A fixed form is assembled for no Student: nobody's exposure shapes it.
      exposure: forStudent ? facts.exposure : new Map(),
      exposedStimulusIds: forStudent ? facts.exposedStimuli.stimulusIds : new Set(),
      poolAssignments: facts.poolAssignments,
      poolPolicy: shape.poolPolicy,
      exposurePolicy: shape.exposurePolicy,
      fidelity: shape.fidelity,
      difficultyBandMet: shape.difficultyBandMet,
      unitRequirements: unitRequirementsOf(variant),
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Diagnostic: a purpose and a selectable plan -- not Q1 semantics      */
/* ------------------------------------------------------------------ */

export interface ProtectedDiagnosticInput {
  variant: PersistedVariant;
  facts: ProtectedSelectionFacts;
  studentId: string;
  kind: TargetKind;
  targetIds: readonly string[];
  /** A StudyUs policy value, supplied by the caller. */
  depth: DiagnosticDepthRequirement;
  poolPolicy?: PoolPolicy;
  exposurePolicy?: ExposurePolicy;
}

export interface ProtectedDiagnosticSelection {
  blueprintKey: string;
  pool: 'DIAGNOSTIC';
  gate: { offered: number; eligible: number; ineligible: Record<string, number>; stimulusBound: number; poolRejected: Partial<Record<PoolRejection, number>>; exposureRejected: Partial<Record<ExposureRejection, number>>; usable: number };
  /** The Diagnostic target plan and the candidates that may serve it: what the one shared solver is given. */
  plan: TargetPlan;
  candidates: SolverCandidate[];
}

/** A Diagnostic is delivered by the one Student rule's practice use (the bank has no separate diagnostic use). */
const DIAGNOSTIC_USE: DeliveryUse = 'PRACTICE';

/**
 * A selectable Diagnostic: the Diagnostic target plan and its candidates from the DIAGNOSTIC pool, after B1
 * eligibility, the pool rule and hard exposure. The caller hands both to the one shared solver; this file
 * does not solve. Standalone questions only: the target solver takes questions one by one and would split a
 * stimulus group, so stimulus-bound questions are left out and counted.
 *
 * It prepares a selection. It does not establish that two selected questions are independent observations
 * of a concept (`Q1_DIAGNOSTIC_FULL_SEMANTICS`): that rule belongs to the evidence layer.
 */
export function protectedDiagnosticSelection(input: ProtectedDiagnosticInput): { ok: true; selection: ProtectedDiagnosticSelection } | { ok: false; refusals: VariantRefusal[] } {
  const { variant, facts } = input;
  const refusals = variantRefusals(variant, facts.examVersionId);
  if (refusals.length > 0 || variant.identity.purpose !== 'DIAGNOSTIC') return { ok: false, refusals: refusals.length > 0 ? refusals : [{ code: 'VARIANT_IS_NOT_A_DIAGNOSTIC' }] };
  const rule = (input.exposurePolicy ?? PILOT_EXPOSURE_POLICY).rules.DIAGNOSTIC;
  const { candidates, summary } = eligibleSolverCandidates(facts.coverages, { family: 'EXAM_PREPARATION', studentId: input.studentId, examVersionId: facts.examVersionId, use: DIAGNOSTIC_USE }, facts.exposure);
  const stimulusBound = new Set(facts.coverages.filter((c) => c.stimulus).map((c) => questionRefKey(c.ref)));
  const gate: ProtectedDiagnosticSelection['gate'] = { offered: facts.coverages.length, eligible: candidates.length, ineligible: summary.rejected, stimulusBound: 0, poolRejected: {}, exposureRejected: {}, usable: 0 };
  const usable = candidates.filter((c) => {
    if (stimulusBound.has(c.key)) { gate.stimulusBound += 1; return false; }
    const p = poolVerdict(c.key, 'DIAGNOSTIC', facts.poolAssignments, input.poolPolicy ?? PILOT_POOL_POLICY);
    if (!p.allowed) { gate.poolRejected[p.reason] = (gate.poolRejected[p.reason] ?? 0) + 1; return false; }
    const e = exposureVerdict(facts.exposure.get(c.key), rule);
    if (!e.allowed) { gate.exposureRejected[e.reason] = (gate.exposureRejected[e.reason] ?? 0) + 1; return false; }
    return true;
  });
  gate.usable = usable.length;
  return { ok: true, selection: { blueprintKey: blueprintKey(variant.identity), pool: 'DIAGNOSTIC', gate, plan: diagnosticTargetPlan(input.kind, input.targetIds, input.depth), candidates: usable } };
}
