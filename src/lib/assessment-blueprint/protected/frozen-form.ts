/**
 * B2-A -- the frozen form of a protected blueprint variant (pure representation).
 *
 * Full Mock 1, Full Mock 2 and Reduced Mock 1 are fixed forms: assembled once, frozen, and the same for
 * every Student who takes them. A frozen form keeps what must never drift afterwards: the item identities
 * and their order, the blueprint revision, the purpose, the pool and the verified fidelity.
 *
 * Nothing is stored here and no real form exists yet: this is the shape and its invariants.
 */
import { createHash } from 'crypto';
import type { ExamFormFidelity, FormFidelity, InstanceAttemptDecision } from '@/lib/exam-core/form-fidelity';
import type { QuestionRef } from '@/lib/assessment-foundation/question-coverage';
import type { SolveOutcome } from '../solver/plan';
import { ATTEMPT_TYPE_OF_PURPOSE, blueprintKey, purposeFidelityViolations, type BlueprintIdentity, type PurposeFidelityViolation } from './blueprint-identity';
import { poolForBlueprint, poolVerdict, PILOT_POOL_POLICY, type LogicalPool, type PoolAssignments, type PoolPolicy } from './pools';
import { exposureVerdict, type ExposureRule, type ProtectedExposureFacts } from './exposure-policy';

export const FROZEN_FORM_VERSION = 1 as const;

export interface FrozenFormPosition {
  slotIndex: number;
  key: string;
  question: QuestionRef;
}

export interface FrozenForm {
  v: typeof FROZEN_FORM_VERSION;
  identity: BlueprintIdentity;
  blueprintKey: string;
  pool: LogicalPool;
  fidelity: Extract<ExamFormFidelity, 'FULL' | 'REDUCED'>;
  attemptType: 'FULL_MOCK' | 'REDUCED_MOCK';
  /** In slot order. */
  positions: FrozenFormPosition[];
  /** Digest of identity, pool, fidelity and the ordered item keys: any change is a different form. */
  formHash: string;
}

export type FrozenFormViolation =
  | 'PURPOSE_HAS_NO_FIXED_FORM'
  | 'BLUEPRINT_NOT_PUBLISHED'
  | 'NO_POOL_FOR_BLUEPRINT'
  | 'SELECTION_NOT_COMPLETE'
  | 'NOT_A_SLOT_SELECTION'
  | 'NON_REVIEWED_CONTENT'
  | 'ITEM_OUTSIDE_POOL'
  | 'DUPLICATE_ITEM'
  | PurposeFidelityViolation;

const hashOf = (identity: BlueprintIdentity, pool: LogicalPool, fidelity: string, keys: readonly string[]): string =>
  createHash('sha256').update(JSON.stringify([FROZEN_FORM_VERSION, blueprintKey(identity), pool, fidelity, keys])).digest('hex');

export interface FreezeInput {
  identity: BlueprintIdentity;
  outcome: SolveOutcome;
  fidelity: FormFidelity | null;
  decision: InstanceAttemptDecision | { startable: false; reason: string };
  poolAssignments: PoolAssignments;
  poolPolicy?: PoolPolicy;
}

/** Freezes a complete, verified selection. Anything short of that is refused with every reason. */
export function freezeForm(input: FreezeInput): { ok: true; form: FrozenForm } | { ok: false; violations: FrozenFormViolation[] } {
  const violations: FrozenFormViolation[] = [];
  const { identity, outcome } = input;
  if (identity.purpose === 'DIAGNOSTIC') return { ok: false, violations: ['PURPOSE_HAS_NO_FIXED_FORM'] };
  if (identity.status !== 'PUBLISHED') violations.push('BLUEPRINT_NOT_PUBLISHED');
  const pool = poolForBlueprint(identity);
  if (!pool) violations.push('NO_POOL_FOR_BLUEPRINT');
  if (outcome.diagnostics.mode !== 'SLOTS') violations.push('NOT_A_SLOT_SELECTION');
  if (outcome.status !== 'READY' || outcome.selected.length === 0) violations.push('SELECTION_NOT_COMPLETE');
  violations.push(...purposeFidelityViolations(identity.purpose, input.fidelity, input.decision));
  const ordered = [...outcome.selected].sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
  if (new Set(ordered.map((s) => s.key)).size !== ordered.length) violations.push('DUPLICATE_ITEM');
  if (ordered.some((s) => s.question.store !== 'REVIEWED_EXAM_BANK')) violations.push('NON_REVIEWED_CONTENT');
  if (pool && ordered.some((s) => !poolVerdict(s.key, pool, input.poolAssignments, input.poolPolicy ?? PILOT_POOL_POLICY).allowed)) violations.push('ITEM_OUTSIDE_POOL');
  if (violations.length > 0 || !pool || !input.fidelity) return { ok: false, violations: [...new Set(violations)] };
  const fidelity = input.fidelity.fidelity as 'FULL' | 'REDUCED';
  const positions = ordered.map((s) => ({ slotIndex: s.slotIndex as number, key: s.key, question: s.question }));
  return {
    ok: true,
    form: { v: FROZEN_FORM_VERSION, identity, blueprintKey: blueprintKey(identity), pool, fidelity, attemptType: ATTEMPT_TYPE_OF_PURPOSE[identity.purpose] as 'FULL_MOCK' | 'REDUCED_MOCK', positions, formHash: hashOf(identity, pool, fidelity, positions.map((p) => p.key)) },
  };
}

/** Has a frozen form been altered since it was frozen (items, order, blueprint, pool or fidelity)? */
export function frozenFormIntact(form: FrozenForm): boolean {
  const inOrder = form.positions.every((p, i) => i === 0 || form.positions[i - 1].slotIndex < p.slotIndex);
  return inOrder && form.blueprintKey === blueprintKey(form.identity) && form.formHash === hashOf(form.identity, form.pool, form.fidelity, form.positions.map((p) => p.key));
}

/** Items two frozen forms share. Under the pilot policy this must be empty for any two protected forms. */
export function sharedItems(a: FrozenForm, b: FrozenForm): string[] {
  const inA = new Set(a.positions.map((p) => p.key));
  return b.positions.map((p) => p.key).filter((k) => inA.has(k)).sort();
}

/**
 * May this Student be given this fixed form? Not when any of its items has already been exposed to them
 * and the pool's rule is a hard exclusion: the form is not repaired item by item -- another form is offered.
 */
export function frozenFormEligibility(form: FrozenForm, exposure: ReadonlyMap<string, ProtectedExposureFacts>, rule: ExposureRule): { eligible: true } | { eligible: false; reason: 'FORM_CONTAINS_EXPOSED_ITEMS'; exposedItems: string[] } {
  const exposedItems = form.positions.map((p) => p.key).filter((k) => !exposureVerdict(exposure.get(k), rule).allowed).sort();
  return exposedItems.length === 0 ? { eligible: true } : { eligible: false, reason: 'FORM_CONTAINS_EXPOSED_ITEMS', exposedItems };
}
