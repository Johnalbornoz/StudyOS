/**
 * B2-A -- selection for a protected blueprint variant (pure).
 *
 *   B1 eligibility (hard; lifecycle, review, audience, licence, exam version, store)
 *     -> pool rule      (hard; only the variant's pool)
 *     -> exposure rule  (hard for protected pools; decided by the pool, not globally)
 *     -> the existing official pipeline and the one shared solver, unchanged
 *     -> B1's fidelity decision, checked against the blueprint's purpose
 *     -> a frozen form, or the reasons there is none
 *
 * Nothing here ranks, weighs or relaxes: a candidate that fails a hard rule is not a candidate, and a
 * missing hard requirement is reported with its cause instead of being covered by a weaker selection.
 * Generated or cached content cannot enter (B1 eligibility refuses the store for an official selection and
 * the solver's slot rule refuses it again).
 */
import type { DeliveryUse } from '@/lib/exam-core/question-bank/lifecycle';
import type { FormFidelity, InstanceAttemptDecision } from '@/lib/exam-core/form-fidelity';
import { questionRefKey, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import { eligibleSolverCandidates, solveOfficialBlueprint, type CandidateExtras } from '../pipeline';
import { officialAttemptDecision, type OfficialExamPolicyInput } from '../policy/official-exam';
import type { BlueprintSolution } from '../result';
import { blueprintKey, purposeFidelityViolations, type BlueprintIdentity, type PurposeFidelityViolation } from './blueprint-identity';
import { PILOT_POOL_POLICY, poolForBlueprint, poolVerdict, type LogicalPool, type PoolAssignments, type PoolPolicy, type PoolRejection } from './pools';
import { PILOT_EXPOSURE_POLICY, exposureVerdict, type ExposurePolicy, type ExposureRejection, type ProtectedExposureFacts } from './exposure-policy';
import { freezeForm, type FrozenForm, type FrozenFormViolation } from './frozen-form';
import { unservableUnitRequirements, type SelectionUnitRequirement } from './selection-unit';

export type ProtectedShortageCause =
  /** Even ignoring pools and exposure, the eligible reviewed bank cannot fill the blueprint. */
  | 'INSUFFICIENT_ELIGIBLE_ITEMS'
  /** Eligible items exist, but not enough of them belong to this variant's pool. */
  | 'POOL_SHORTAGE'
  /** The pool could fill the blueprint, but not with items this Student has not been exposed to. */
  | 'EXPOSURE_SHORTAGE'
  /** The variant cannot be assembled as a fixed protected form (wrong purpose, no pool, another exam version, not published). */
  | 'BLUEPRINT_PURPOSE_MISMATCH'
  /** A complete selection exists, but its verified fidelity does not match the blueprint's purpose. */
  | 'FIDELITY_MISMATCH'
  /** The blueprint requires stimulus groups and no source provides their facts yet. */
  | 'STIMULUS_GROUP_FACTS_MISSING';

/**
 * The subject of a fixed-form assembly. B1's requirement contract always names who a requirement is for; a
 * fixed form is assembled once for no Student in particular, so it is assembled for this named subject and
 * with no exposure. It is never a Student id.
 */
export const FIXED_FORM_SUBJECT = 'fixed-form-assembly' as const;

export interface ProtectedFormInput {
  identity: BlueprintIdentity;
  /** The official positions of THIS variant. `studentId` is FIXED_FORM_SUBJECT when a fixed form is assembled for no one in particular. */
  policy: OfficialExamPolicyInput;
  coverages: readonly QuestionCoverage[];
  extras?: ReadonlyMap<string, CandidateExtras>;
  /** Per-Student exposure by `<store>:<id>`. Empty when assembling a fixed form. */
  exposure?: ReadonlyMap<string, ProtectedExposureFacts>;
  poolAssignments: PoolAssignments;
  poolPolicy?: PoolPolicy;
  exposurePolicy?: ExposurePolicy;
  /** B1's verified fidelity of the form this variant describes (`classifyExamFormFidelity`). */
  fidelity: FormFidelity | null;
  difficultyBandMet: boolean | null;
  /** Units the variant needs beyond single items. A STIMULUS_GROUP requirement cannot be served yet. */
  unitRequirements?: readonly SelectionUnitRequirement[];
}

export interface ProtectedGate {
  offered: number;
  eligible: number;
  /** B1 eligibility reasons of the questions that are not candidates at all. */
  ineligible: Record<string, number>;
  poolRejected: Partial<Record<PoolRejection, number>>;
  exposureRejected: Partial<Record<ExposureRejection, number>>;
  usable: number;
}

export interface ProtectedFormResult {
  blueprintKey: string;
  pool: LogicalPool | null;
  status: 'FORM_READY' | 'NOT_AVAILABLE';
  causes: ProtectedShortageCause[];
  gate: ProtectedGate;
  /** The solver's result on the usable candidates. null when no selection was attempted. */
  solution: BlueprintSolution | null;
  attempt: InstanceAttemptDecision | { startable: false; reason: string } | null;
  fidelityViolations: PurposeFidelityViolation[];
  freezeViolations: FrozenFormViolation[];
  form: FrozenForm | null;
}

const USE_OF_PURPOSE = { FULL: 'FULL_MOCK', REDUCED: 'REDUCED_MOCK' } as const satisfies Record<'FULL' | 'REDUCED', DeliveryUse>;

const emptyGate = (offered: number): ProtectedGate => ({ offered, eligible: 0, ineligible: {}, poolRejected: {}, exposureRejected: {}, usable: 0 });

export function solveProtectedForm(input: ProtectedFormInput): ProtectedFormResult {
  const { identity } = input;
  const key = blueprintKey(identity);
  const pool = poolForBlueprint(identity);
  const none = (causes: ProtectedShortageCause[], gate: ProtectedGate): ProtectedFormResult => ({ blueprintKey: key, pool, status: 'NOT_AVAILABLE', causes, gate, solution: null, attempt: null, fidelityViolations: [], freezeViolations: [], form: null });

  if (identity.purpose === 'DIAGNOSTIC' || !pool || identity.status !== 'PUBLISHED' || input.policy.examVersionId !== identity.examVersionId) return none(['BLUEPRINT_PURPOSE_MISMATCH'], emptyGate(input.coverages.length));
  if (unservableUnitRequirements(input.unitRequirements ?? []).length > 0) return none(['STIMULUS_GROUP_FACTS_MISSING'], emptyGate(input.coverages.length));

  const use = USE_OF_PURPOSE[identity.purpose];
  const poolPolicy = input.poolPolicy ?? PILOT_POOL_POLICY;
  const rule = (input.exposurePolicy ?? PILOT_EXPOSURE_POLICY).rules[pool];
  const exposure = input.exposure ?? new Map<string, ProtectedExposureFacts>();

  // 1. B1 eligibility decides who is a candidate at all.
  const { candidates, summary } = eligibleSolverCandidates(input.coverages, { family: 'OFFICIAL_EXAM', studentId: input.policy.studentId, examVersionId: input.policy.examVersionId, use });
  const eligibleKeys = new Set(candidates.map((c) => c.key));
  const gate: ProtectedGate = { offered: input.coverages.length, eligible: candidates.length, ineligible: summary.rejected, poolRejected: {}, exposureRejected: {}, usable: 0 };

  // 2. Pool, then 3. exposure -- both hard.
  const inPool = new Set<string>();
  const usable = new Set<string>();
  for (const k of [...eligibleKeys].sort()) {
    const p = poolVerdict(k, pool, input.poolAssignments, poolPolicy);
    if (!p.allowed) {
      gate.poolRejected[p.reason] = (gate.poolRejected[p.reason] ?? 0) + 1;
      continue;
    }
    inPool.add(k);
    const e = exposureVerdict(exposure.get(k), rule);
    if (!e.allowed) {
      gate.exposureRejected[e.reason] = (gate.exposureRejected[e.reason] ?? 0) + 1;
      continue;
    }
    usable.add(k);
  }
  gate.usable = usable.size;

  const solveWith = (keys: ReadonlySet<string>): BlueprintSolution =>
    solveOfficialBlueprint({ policy: input.policy, coverages: input.coverages.filter((c) => keys.has(questionRefKey(c.ref))), extras: input.extras, exposure, use });

  const solution = solveWith(usable);
  if (solution.outcome.status !== 'READY') {
    // Name the binding constraint: what would have been enough?
    const cause: ProtectedShortageCause = solveWith(eligibleKeys).outcome.status !== 'READY' ? 'INSUFFICIENT_ELIGIBLE_ITEMS' : solveWith(inPool).outcome.status !== 'READY' ? 'POOL_SHORTAGE' : 'EXPOSURE_SHORTAGE';
    return { ...none([cause], gate), solution };
  }

  // 4. B1 decides fidelity and the stored type; the purpose may not contradict it.
  const attempt = officialAttemptDecision(solution.outcome, input.fidelity, input.difficultyBandMet);
  const fidelityViolations = purposeFidelityViolations(identity.purpose, input.fidelity, attempt);
  if (fidelityViolations.length > 0) return { ...none(['FIDELITY_MISMATCH'], gate), solution, attempt, fidelityViolations };

  const frozen = freezeForm({ identity, outcome: solution.outcome, fidelity: input.fidelity, decision: attempt, poolAssignments: input.poolAssignments, poolPolicy });
  if (!frozen.ok) return { ...none(['FIDELITY_MISMATCH'], gate), solution, attempt, freezeViolations: frozen.violations };
  return { blueprintKey: key, pool, status: 'FORM_READY', causes: [], gate, solution, attempt, fidelityViolations: [], freezeViolations: [], form: frozen.form };
}

/** The readiness view of a protected variant: counts and causes, and no selected question. */
export interface ProtectedFeasibility {
  blueprintKey: string;
  pool: LogicalPool | null;
  ready: boolean;
  causes: ProtectedShortageCause[];
  gate: ProtectedGate;
  positions: number;
  unfillablePositions: number;
}

export function evaluateProtectedFeasibility(input: Omit<ProtectedFormInput, 'exposure'>): ProtectedFeasibility {
  const r = solveProtectedForm({ ...input, exposure: new Map() });
  return { blueprintKey: r.blueprintKey, pool: r.pool, ready: r.status === 'FORM_READY', causes: r.causes, gate: r.gate, positions: input.policy.positions.length, unfillablePositions: r.solution ? r.solution.outcome.unmet.filter((u) => u.requirement === 'SLOT').length : input.policy.positions.length };
}
