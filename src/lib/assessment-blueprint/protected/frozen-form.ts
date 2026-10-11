/**
 * B2-A -- the frozen form of a protected blueprint variant (pure representation).
 *
 * Full Mock 1, Full Mock 2 and Reduced Mock 1 are fixed forms: assembled once, frozen, and the same for
 * every Student who takes them. A frozen form keeps what must never drift afterwards: the item identities
 * and their order, the blueprint revision, the purpose, the pool and the verified fidelity.
 *
 * Nothing is stored here and no real form exists yet: this is the shape and its invariants.
 *
 * B2-B2: a position also records the stimulus VERSION its question is asked about and the question's place
 * inside that group. Questions of one stimulus sit in adjacent slots, in group order -- a form that does
 * not is refused. The digest covers those facts too, so the form version is 2.
 *
 * Persistence (`assessment_frozen_forms.form_hash`): the column stores `formHash` VERBATIM. It is a SHA-256
 * in lowercase hex (64 characters), which is exactly what the column's check accepts; no second hash and no
 * re-encoding exists, so a form read back from the database is verified by `frozenFormIntact` unchanged.
 */
import { createHash } from 'crypto';
import type { ExamFormFidelity, FormFidelity, InstanceAttemptDecision } from '@/lib/exam-core/form-fidelity';
import type { QuestionRef } from '@/lib/assessment-foundation/question-coverage';
import type { SolveOutcome } from '../solver/plan';
import { ATTEMPT_TYPE_OF_PURPOSE, blueprintKey, purposeFidelityViolations, type BlueprintIdentity, type PurposeFidelityViolation } from './blueprint-identity';
import { poolForBlueprint, poolVerdict, PILOT_POOL_POLICY, type LogicalPool, type PoolAssignments, type PoolPolicy } from './pools';
import { exposureVerdict, type ExposureRule, type ProtectedExposureFacts } from './exposure-policy';

export const FROZEN_FORM_VERSION = 2 as const;

export interface FrozenFormPosition {
  slotIndex: number;
  key: string;
  question: QuestionRef;
  /** The stimulus version the question is asked about. null for a standalone question. */
  stimulusVersionId: string | null;
  /** The question's place inside its stimulus group (the Question Bank's `position`, from 1). null for a standalone question. */
  unitPosition: number | null;
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
  /** Digest of identity, pool, fidelity and the ordered positions (slot, item, stimulus version, place in group): any change is a different form. SHA-256, lowercase hex. */
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
  /** Questions of one stimulus version are not in adjacent slots: the group was split. */
  | 'STIMULUS_GROUP_NOT_ADJACENT'
  /** Questions of one stimulus version are not in the group's own order. */
  | 'STIMULUS_GROUP_OUT_OF_ORDER'
  | PurposeFidelityViolation;

type HashedPosition = Pick<FrozenFormPosition, 'slotIndex' | 'key' | 'stimulusVersionId' | 'unitPosition'>;

const hashOf = (identity: BlueprintIdentity, pool: LogicalPool, fidelity: string, positions: readonly HashedPosition[]): string =>
  createHash('sha256').update(JSON.stringify([FROZEN_FORM_VERSION, blueprintKey(identity), pool, fidelity, positions.map((p) => [p.slotIndex, p.key, p.stimulusVersionId, p.unitPosition])])).digest('hex');

/** The digest a form with these facts must carry. The persistence adapter uses it to check what it stores and what it reads back. */
export const frozenFormHash = (form: Pick<FrozenForm, 'identity' | 'pool' | 'fidelity' | 'positions'>): string => hashOf(form.identity, form.pool, form.fidelity, form.positions);

/** Group integrity of ordered positions: one stimulus version = one run of adjacent slots, in ascending group order. */
export function groupPositionViolations(positions: readonly HashedPosition[]): Array<'STIMULUS_GROUP_NOT_ADJACENT' | 'STIMULUS_GROUP_OUT_OF_ORDER'> {
  const out = new Set<'STIMULUS_GROUP_NOT_ADJACENT' | 'STIMULUS_GROUP_OUT_OF_ORDER'>();
  const closed = new Set<string>();
  let open: string | null = null;
  let last = 0;
  for (const p of positions) {
    const sv = p.stimulusVersionId;
    if (sv !== open) {
      if (open !== null) closed.add(open);
      if (sv !== null && closed.has(sv)) out.add('STIMULUS_GROUP_NOT_ADJACENT');
      open = sv;
      last = 0;
    }
    if (sv !== null) {
      if (p.unitPosition === null || p.unitPosition <= last) out.add('STIMULUS_GROUP_OUT_OF_ORDER');
      last = p.unitPosition ?? last;
    }
  }
  return [...out].sort();
}

export interface FreezeInput {
  identity: BlueprintIdentity;
  outcome: SolveOutcome;
  fidelity: FormFidelity | null;
  decision: InstanceAttemptDecision | { startable: false; reason: string };
  poolAssignments: PoolAssignments;
  poolPolicy?: PoolPolicy;
  /** The stimulus version and group place of every selected question that has one, by `<store>:<id>` (from B1 coverage). */
  stimulusOf?: ReadonlyMap<string, { stimulusVersionId: string; unitPosition: number }>;
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
  const positions: FrozenFormPosition[] = ordered.map((s) => ({ slotIndex: s.slotIndex as number, key: s.key, question: s.question, stimulusVersionId: input.stimulusOf?.get(s.key)?.stimulusVersionId ?? null, unitPosition: input.stimulusOf?.get(s.key)?.unitPosition ?? null }));
  violations.push(...groupPositionViolations(positions));
  if (violations.length > 0 || !pool || !input.fidelity) return { ok: false, violations: [...new Set(violations)] };
  const fidelity = input.fidelity.fidelity as 'FULL' | 'REDUCED';
  return {
    ok: true,
    form: { v: FROZEN_FORM_VERSION, identity, blueprintKey: blueprintKey(identity), pool, fidelity, attemptType: ATTEMPT_TYPE_OF_PURPOSE[identity.purpose] as 'FULL_MOCK' | 'REDUCED_MOCK', positions, formHash: hashOf(identity, pool, fidelity, positions) },
  };
}

/** Has a frozen form been altered since it was frozen (items, order, stimulus versions, blueprint, pool or fidelity)? */
export function frozenFormIntact(form: FrozenForm): boolean {
  const inOrder = form.positions.every((p, i) => i === 0 || form.positions[i - 1].slotIndex < p.slotIndex);
  return inOrder && form.v === FROZEN_FORM_VERSION && form.blueprintKey === blueprintKey(form.identity) && groupPositionViolations(form.positions).length === 0 && form.formHash === hashOf(form.identity, form.pool, form.fidelity, form.positions);
}

/** Stimulus versions two frozen forms share. A group belongs to one pool as a whole, so this must be empty for two protected forms. */
export function sharedStimulusVersions(a: FrozenForm, b: FrozenForm): string[] {
  const inA = new Set(a.positions.map((p) => p.stimulusVersionId).filter((x): x is string => x !== null));
  return [...new Set(b.positions.map((p) => p.stimulusVersionId).filter((x): x is string => x !== null && inA.has(x)))].sort();
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
export function frozenFormEligibility(
  form: FrozenForm,
  exposure: ReadonlyMap<string, ProtectedExposureFacts>,
  rule: ExposureRule,
  /** Stimulus versions of stimuli the Student has met through any question (B2-B2): the whole group counts as exposed. */
  exposedStimulusVersionIds: ReadonlySet<string> = new Set()
): { eligible: true } | { eligible: false; reason: 'FORM_CONTAINS_EXPOSED_ITEMS'; exposedItems: string[]; exposedStimulusVersionIds?: string[] } {
  const hard = rule === 'HARD_EXCLUDE_IF_EXPOSED';
  const stimuli = hard ? [...new Set(form.positions.map((p) => p.stimulusVersionId).filter((x): x is string => x !== null && exposedStimulusVersionIds.has(x)))].sort() : [];
  const exposedItems = form.positions.filter((p) => !exposureVerdict(exposure.get(p.key), rule).allowed || (p.stimulusVersionId !== null && stimuli.includes(p.stimulusVersionId))).map((p) => p.key).sort();
  return exposedItems.length === 0 ? { eligible: true } : { eligible: false, reason: 'FORM_CONTAINS_EXPOSED_ITEMS', exposedItems, ...(stimuli.length > 0 ? { exposedStimulusVersionIds: stimuli } : {}) };
}
