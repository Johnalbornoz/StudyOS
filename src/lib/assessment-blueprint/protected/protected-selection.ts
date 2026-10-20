/**
 * B2-A / B2-B2 -- selection for a protected blueprint variant (pure).
 *
 *   B1 eligibility (hard; lifecycle, review, audience, reuse rights, exam version, store)
 *     -> selection units (an ITEM, or a STIMULUS_GROUP derived from Question Bank facts)
 *     -> pool rule      (hard; only the variant's pool -- a group has one pool as a whole)
 *     -> exposure rule  (hard for protected pools; a group is exposed when any of its questions was)
 *     -> stimulus groups placed first, whole and in order, in adjacent positions
 *     -> the existing official pipeline and the one shared solver, unchanged, for the remaining positions
 *     -> B1's fidelity decision, checked against the blueprint's purpose
 *     -> a frozen form, or the reasons there is none
 *
 * Nothing here ranks, weighs or relaxes: a candidate that fails a hard rule is not a candidate, and a
 * missing hard requirement is reported with its cause instead of being covered by a weaker selection.
 * Generated or cached content cannot enter (B1 eligibility refuses the store for an official selection and
 * the solver's slot rule refuses it again).
 *
 * Groups (B2-B2). A question bound to a stimulus is selectable only through its group and only for a
 * STIMULUS_GROUP requirement; it never competes for a position as a loose item. Placement is deterministic
 * and greedy, not exhaustive: requirements in the order given, groups by unit id, the largest allowed
 * number of questions first, the earliest run of adjacent free positions of one section whose slots the
 * questions fit one by one (the solver's own slot rule). When that does not serve a requirement the form
 * is NOT_AVAILABLE -- no smaller group, no loose question and no other kind is substituted.
 */
import type { DeliveryUse } from '@/lib/exam-core/question-bank/lifecycle';
import type { FormFidelity, InstanceAttemptDecision } from '@/lib/exam-core/form-fidelity';
import type { FormPosition } from '@/lib/exam-core/form-assembly';
import { questionRefKey, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import { eligibleSolverCandidates, solveOfficialBlueprint, type CandidateExtras } from '../pipeline';
import { buildOfficialBlueprint, officialAttemptDecision, type OfficialExamPolicyInput } from '../policy/official-exam';
import type { BlueprintSolution } from '../result';
import type { SolverCandidate } from '../solver/candidate';
import type { SelectedQuestion, SolveOutcome, UnmetRequirement } from '../solver/plan';
import { fitsSlot } from '../solver/solve';
import { blueprintKey, purposeFidelityViolations, type BlueprintIdentity, type PurposeFidelityViolation } from './blueprint-identity';
import { PILOT_POOL_POLICY, poolForBlueprint, poolVerdict, type LogicalPool, type PoolAssignments, type PoolPolicy, type PoolRejection } from './pools';
import { PILOT_EXPOSURE_POLICY, exposureVerdict, type ExposurePolicy, type ExposureRejection, type ProtectedExposureFacts } from './exposure-policy';
import { freezeForm, type FrozenForm, type FrozenFormViolation } from './frozen-form';
import { deriveSelectionUnits, selectableItemRange, unitPick, unservableUnitRequirements, type SelectionUnit, type SelectionUnitRequirement, type UnusableGroup } from './selection-unit';

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
  /** A unit requirement of the variant is malformed (no unit, an inverted range): nothing is selected for it. */
  | 'UNIT_REQUIREMENT_INVALID';

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
  /** Units the variant needs beyond single items: its STIMULUS_SET requirements. Absent = no group is taken. */
  unitRequirements?: readonly SelectionUnitRequirement[];
  /** Stimuli the Student has met through any version of any of their questions. Empty when assembling a fixed form. */
  exposedStimulusIds?: ReadonlySet<string>;
}

export interface ProtectedGate {
  offered: number;
  eligible: number;
  /** B1 eligibility reasons of the questions that are not candidates at all. */
  ineligible: Record<string, number>;
  poolRejected: Partial<Record<PoolRejection, number>>;
  exposureRejected: Partial<Record<ExposureRejection, number>>;
  /** Questions that may be selected: standalone ones, and the members of usable groups. */
  usable: number;
}

/** A stimulus group as it sits in the form. */
export interface PlacedGroup {
  unitId: string;
  stimulusSetId: string;
  stimulusVersionId: string;
  setKind: string | null;
  /** Adjacent positions, in form order, and the question in each. */
  slotIndexes: number[];
  memberKeys: string[];
}

export interface UnitShortfall {
  requirement: SelectionUnitRequirement;
  placed: number;
}

/** How units were used. `groupBoundQuestions` = eligible questions that belong to a stimulus and so never competed as loose items. */
export interface ProtectedUnitReport {
  itemUnits: number;
  groupUnits: number;
  groupBoundQuestions: number;
  unusableGroups: UnusableGroup[];
  placed: PlacedGroup[];
  shortfalls: UnitShortfall[];
}

export interface ProtectedFormResult {
  blueprintKey: string;
  pool: LogicalPool | null;
  status: 'FORM_READY' | 'NOT_AVAILABLE';
  causes: ProtectedShortageCause[];
  gate: ProtectedGate;
  /**
   * The solver's result on the usable STANDALONE candidates, for the positions no group took (all of them
   * when the variant asks for no group). null when no selection was attempted or groups took every position.
   */
  solution: BlueprintSolution | null;
  /** The whole form's outcome: placed groups and the solver's items, in position order. null when no selection was attempted. */
  outcome: SolveOutcome | null;
  units: ProtectedUnitReport;
  attempt: InstanceAttemptDecision | { startable: false; reason: string } | null;
  fidelityViolations: PurposeFidelityViolation[];
  freezeViolations: FrozenFormViolation[];
  form: FrozenForm | null;
}

const USE_OF_PURPOSE = { FULL: 'FULL_MOCK', REDUCED: 'REDUCED_MOCK' } as const satisfies Record<'FULL' | 'REDUCED', DeliveryUse>;

const emptyGate = (offered: number): ProtectedGate => ({ offered, eligible: 0, ineligible: {}, poolRejected: {}, exposureRejected: {}, usable: 0 });
const emptyUnits = (): ProtectedUnitReport => ({ itemUnits: 0, groupUnits: 0, groupBoundQuestions: 0, unusableGroups: [], placed: [], shortfalls: [] });

interface Assembly {
  outcome: SolveOutcome;
  solution: BlueprintSolution | null;
  placed: PlacedGroup[];
  shortfalls: UnitShortfall[];
}

/**
 * One assembly attempt on a set of allowed units: groups first, then the shared solver for what is left.
 * Pure and deterministic; called up to three times (usable, pool only, all eligible) to name the binding cause.
 */
function assemble(input: ProtectedFormInput, use: Extract<DeliveryUse, 'FULL_MOCK' | 'REDUCED_MOCK'>, allowed: readonly SelectionUnit[], candidates: ReadonlyMap<string, SolverCandidate>, exposure: ReadonlyMap<string, ProtectedExposureFacts>): Assembly {
  const slots = buildOfficialBlueprint(input.policy).plan.slots;
  const taken = new Map<number, string>(); // slot index -> member key
  const used = new Set<string>();
  const placed: PlacedGroup[] = [];
  const shortfalls: UnitShortfall[] = [];
  const groups = allowed.filter((u) => u.type === 'STIMULUS_GROUP');

  /** The earliest run of `keys.length` adjacent free positions of one section that the questions fit in order. */
  const runFor = (keys: readonly string[], componentId: string | null): number | null => {
    for (let start = 0; start + keys.length <= slots.length; start += 1) {
      const run = slots.slice(start, start + keys.length);
      if (run.some((slot) => taken.has(slot.index) || slot.assessmentComponentId !== run[0].assessmentComponentId || (componentId !== null && slot.assessmentComponentId !== componentId))) continue;
      if (run.every((slot, i) => { const c = candidates.get(keys[i]); return !!c && fitsSlot(slot, c); })) return start;
    }
    return null;
  };

  for (const requirement of (input.unitRequirements ?? []).filter((r) => r.type === 'STIMULUS_GROUP')) {
    let done = 0;
    for (const unit of groups) {
      if (done >= requirement.units) break;
      if (used.has(unit.unitId) || (requirement.setKind !== null && unit.setKind !== requirement.setKind)) continue;
      const range = selectableItemRange(unit);
      for (let n = Math.min(range.max, requirement.maxItems); n >= Math.max(range.min, requirement.minItems); n -= 1) {
        const pick = unitPick(unit, n);
        const start = pick ? runFor(pick.memberKeys, requirement.assessmentComponentId ?? null) : null;
        if (!pick || start === null) continue;
        const run = slots.slice(start, start + n);
        run.forEach((slot, i) => taken.set(slot.index, pick.memberKeys[i]));
        used.add(unit.unitId);
        placed.push({ unitId: unit.unitId, stimulusSetId: unit.stimulusSetId as string, stimulusVersionId: unit.stimulusVersionId as string, setKind: unit.setKind, slotIndexes: run.map((slot) => slot.index), memberKeys: pick.memberKeys });
        done += 1;
        break;
      }
    }
    if (done < requirement.units) shortfalls.push({ requirement, placed: done });
  }

  // What is left goes to the one solver, with standalone questions only. A template already used by a placed group is not used twice.
  const remaining: FormPosition[] = input.policy.positions.filter((p) => !taken.has(p.index));
  const templates = new Set([...taken.values()].map((k) => candidates.get(k)?.templateKey).filter((t): t is string => !!t));
  const itemKeys = new Set(allowed.filter((u) => u.type === 'ITEM' && !(candidates.get(u.unitId)?.templateKey && templates.has(candidates.get(u.unitId)!.templateKey as string))).map((u) => u.unitId));
  const solution = remaining.length > 0 ? solveOfficialBlueprint({ policy: { ...input.policy, positions: remaining }, coverages: input.coverages.filter((c) => itemKeys.has(questionRefKey(c.ref))), extras: input.extras, exposure, use }) : null;

  const groupUnmet: UnmetRequirement[] = shortfalls.map((s) => ({ subject: `STIMULUS_GROUP:${s.requirement.setKind ?? 'ANY'}`, requirement: 'SLOT', missing: s.requirement.units - s.placed, cause: 'NOT_ENOUGH_CANDIDATES' }));
  const unmet = [...groupUnmet, ...(solution?.outcome.unmet ?? [])];
  const complete = unmet.length === 0 && slots.length > 0 && (solution === null || solution.outcome.status === 'READY');
  const bySlot = new Map(slots.map((slot) => [slot.index, slot]));
  // An official form is complete or it is not offered: an incomplete one selects nothing (the solver's own rule, kept for groups).
  const selected: SelectedQuestion[] = !complete ? [] : [
    ...[...taken].map(([slotIndex, key]): SelectedQuestion => {
      const objective = bySlot.get(slotIndex)?.learningObjectiveId ?? null;
      return { question: (candidates.get(key) as SolverCandidate).ref, key, order: 0, slotIndex, contributes: objective ? [{ targetKey: `OBJECTIVE:${objective}`, strength: 'DIRECT', counted: ['OPPORTUNITY', 'DIRECT'] }] : [], dedicatedTo: null, reasons: ['FILLS_OFFICIAL_SLOT'] };
    }),
    ...(solution?.outcome.selected ?? []),
  ].sort((a, b) => (a.slotIndex as number) - (b.slotIndex as number)).map((s, order) => ({ ...s, order }));
  const chosen = selected.map((s) => candidates.get(s.key) as SolverCandidate);
  const sum = (pick: (c: SolverCandidate) => number | null): number | null => (chosen.length > 0 && chosen.every((c) => pick(c) !== null) ? chosen.reduce((n, c) => n + (pick(c) as number), 0) : null);
  const status = complete ? 'READY' : 'INSUFFICIENT_COVERAGE';
  const outcome: SolveOutcome = {
    status, selected, unmet, softShortfalls: solution?.outcome.softShortfalls ?? [], estimatedSeconds: sum((c) => c.estimatedSeconds), marks: sum((c) => c.marks),
    diagnostics: { family: 'OFFICIAL_EXAM', mode: 'SLOTS', candidateCount: itemKeys.size + groups.reduce((n, u) => n + u.itemCount, 0), usableCount: (solution?.outcome.diagnostics.usableCount ?? 0) + taken.size, selectedCount: selected.length, unmetCount: unmet.length, iterations: solution?.outcome.diagnostics.iterations ?? 0, prunedCount: 0, status },
  };
  return { outcome, solution, placed, shortfalls };
}

export function solveProtectedForm(input: ProtectedFormInput): ProtectedFormResult {
  const { identity } = input;
  const key = blueprintKey(identity);
  const pool = poolForBlueprint(identity);
  const none = (causes: ProtectedShortageCause[], gate: ProtectedGate, units: ProtectedUnitReport = emptyUnits()): ProtectedFormResult => ({ blueprintKey: key, pool, status: 'NOT_AVAILABLE', causes, gate, solution: null, outcome: null, units, attempt: null, fidelityViolations: [], freezeViolations: [], form: null });

  if (identity.purpose === 'DIAGNOSTIC' || !pool || identity.status !== 'PUBLISHED' || input.policy.examVersionId !== identity.examVersionId) return none(['BLUEPRINT_PURPOSE_MISMATCH'], emptyGate(input.coverages.length));
  if (unservableUnitRequirements(input.unitRequirements ?? []).length > 0) return none(['UNIT_REQUIREMENT_INVALID'], emptyGate(input.coverages.length));

  const use = USE_OF_PURPOSE[identity.purpose];
  const poolPolicy = input.poolPolicy ?? PILOT_POOL_POLICY;
  const rule = (input.exposurePolicy ?? PILOT_EXPOSURE_POLICY).rules[pool];
  const exposure = input.exposure ?? new Map<string, ProtectedExposureFacts>();

  // 1. B1 eligibility decides who is a candidate at all (reuse rights included: B2 states no rights rule of its own).
  const { candidates, summary } = eligibleSolverCandidates(input.coverages, { family: 'OFFICIAL_EXAM', studentId: input.policy.studentId, examVersionId: input.policy.examVersionId, use }, exposure, input.extras);
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const eligibleKeys = new Set(byKey.keys());
  const gate: ProtectedGate = { offered: input.coverages.length, eligible: candidates.length, ineligible: summary.rejected, poolRejected: {}, exposureRejected: {}, usable: 0 };

  // 2. Units: a standalone question is its own; stimulus-bound questions exist only as their group.
  const derived = deriveSelectionUnits({ coverages: input.coverages, usableKeys: eligibleKeys, poolAssignments: input.poolAssignments, exposure, exposedStimulusIds: input.exposedStimulusIds });

  // 3. Pool, then 4. exposure -- both hard, both decided for the unit as a whole and counted per question.
  const inPool: SelectionUnit[] = [];
  const usable: SelectionUnit[] = [];
  for (const unit of derived.units) {
    const p = poolVerdict(unit.memberKeys[0], pool, input.poolAssignments, poolPolicy);
    if (!p.allowed) {
      gate.poolRejected[p.reason] = (gate.poolRejected[p.reason] ?? 0) + unit.itemCount;
      continue;
    }
    inPool.push(unit);
    // A group carries the exposure of all its questions; an answer revealed for one of them reveals the set.
    const facts: ProtectedExposureFacts = unit.type === 'ITEM' ? (exposure.get(unit.unitId) ?? unit.exposure) : { ...unit.exposure, answerRevealed: unit.memberKeys.some((k) => exposure.get(k)?.answerRevealed === true) };
    const e = exposureVerdict(facts, rule);
    if (!e.allowed) {
      gate.exposureRejected[e.reason] = (gate.exposureRejected[e.reason] ?? 0) + unit.itemCount;
      continue;
    }
    usable.push(unit);
  }
  gate.usable = usable.reduce((n, u) => n + u.itemCount, 0);
  const report = (a: Assembly | null): ProtectedUnitReport => ({
    itemUnits: derived.units.filter((u) => u.type === 'ITEM').length, groupUnits: derived.units.filter((u) => u.type === 'STIMULUS_GROUP').length,
    groupBoundQuestions: input.coverages.filter((c) => c.stimulus && eligibleKeys.has(questionRefKey(c.ref))).length, unusableGroups: derived.unusableGroups, placed: a?.placed ?? [], shortfalls: a?.shortfalls ?? [],
  });

  const assembly = assemble(input, use, usable, byKey, exposure);
  if (assembly.outcome.status !== 'READY') {
    // Name the binding constraint: what would have been enough?
    const cause: ProtectedShortageCause = assemble(input, use, derived.units, byKey, exposure).outcome.status !== 'READY' ? 'INSUFFICIENT_ELIGIBLE_ITEMS' : assemble(input, use, inPool, byKey, exposure).outcome.status !== 'READY' ? 'POOL_SHORTAGE' : 'EXPOSURE_SHORTAGE';
    return { ...none([cause], gate, report(assembly)), solution: assembly.solution, outcome: assembly.outcome };
  }
  const found = { solution: assembly.solution, outcome: assembly.outcome };

  // 5. B1 decides fidelity and the stored type; the purpose may not contradict it.
  const attempt = officialAttemptDecision(assembly.outcome, input.fidelity, input.difficultyBandMet);
  const fidelityViolations = purposeFidelityViolations(identity.purpose, input.fidelity, attempt);
  if (fidelityViolations.length > 0) return { ...none(['FIDELITY_MISMATCH'], gate, report(assembly)), ...found, attempt, fidelityViolations };

  const stimulusOf = new Map(input.coverages.filter((c) => c.stimulus).map((c) => [questionRefKey(c.ref), { stimulusVersionId: c.stimulus!.stimulusVersionId, unitPosition: c.stimulus!.position }]));
  const frozen = freezeForm({ identity, outcome: assembly.outcome, fidelity: input.fidelity, decision: attempt, poolAssignments: input.poolAssignments, poolPolicy, stimulusOf });
  if (!frozen.ok) return { ...none(['FIDELITY_MISMATCH'], gate, report(assembly)), ...found, attempt, freezeViolations: frozen.violations };
  return { blueprintKey: key, pool, status: 'FORM_READY', causes: [], gate, ...found, units: report(assembly), attempt, fidelityViolations: [], freezeViolations: [], form: frozen.form };
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

export function evaluateProtectedFeasibility(input: Omit<ProtectedFormInput, 'exposure' | 'exposedStimulusIds'>): ProtectedFeasibility {
  const r = solveProtectedForm({ ...input, exposure: new Map() });
  return { blueprintKey: r.blueprintKey, pool: r.pool, ready: r.status === 'FORM_READY', causes: r.causes, gate: r.gate, positions: input.policy.positions.length, unfillablePositions: r.outcome ? r.outcome.unmet.filter((u) => u.requirement === 'SLOT').reduce((n, u) => n + u.missing, 0) : input.policy.positions.length };
}
