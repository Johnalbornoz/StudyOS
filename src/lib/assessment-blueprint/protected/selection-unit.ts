/**
 * B2-A -- the selection unit B2 will select (interface only; pure).
 *
 * Today B2 selects single ITEMS. Stimulus-bound content must travel as a STIMULUS_GROUP: a stimulus set
 * with its questions. The Question Bank owns stimulus sets and assets; B2 only needs these FACTS about a
 * unit and never how the stimulus is stored.
 *
 * This file is the contract and its validation. Selecting groups at runtime is NOT implemented: no source
 * provides the facts yet, so a blueprint that requires a group is reported as unservable -- it is never
 * approximated with loose items.
 */
import type { ExposureFacts, SolverCandidate } from '../solver/candidate';
import type { LogicalPool } from './pools';

export const SELECTION_UNIT_TYPES = ['ITEM', 'STIMULUS_GROUP'] as const;
export type SelectionUnitType = (typeof SELECTION_UNIT_TYPES)[number];

/** How a group may be taken: all of it, or a declared subset of its questions. */
export type GroupIntegrityRule = { kind: 'WHOLE' } | { kind: 'SUBSET'; minItems: number; maxItems: number };

export interface SelectionUnit {
  unitId: string;
  type: SelectionUnitType;
  /** Number of member questions. 1 for an ITEM. */
  itemCount: number;
  /** `<store>:<question id>` of every member, in stimulus order. */
  memberKeys: string[];
  /** The Question Bank's stimulus set identity. null for an ITEM. */
  stimulusSetId: string | null;
  integrity: GroupIntegrityRule;
  /** Members must stay together and in order in a form. */
  contiguous: boolean;
  /** The kind of set (passage, paired passage, poem, table ...), as the Question Bank names it. null for an ITEM. */
  setKind: string | null;
  /** A unit belongs to one pool as a whole. null = not assigned. */
  pool: LogicalPool | null;
  /** Exposure of the unit for one Student: a group is exposed when any member is. */
  exposure: ExposureFacts;
}

/** What a blueprint may ask of units, beyond counting questions. */
export interface SelectionUnitRequirement {
  type: SelectionUnitType;
  /** Required set kind (e.g. a paired passage), when the form needs one. */
  setKind: string | null;
  /** How many such units. */
  units: number;
  /** Questions to take from each unit. */
  minItems: number;
  maxItems: number;
}

export const STIMULUS_GROUP_RUNTIME_SELECTION = 'DEFERRED_TO_QB_SCHEMA' as const;

export function itemUnit(candidate: Pick<SolverCandidate, 'key' | 'exposure'>, pool: LogicalPool | null): SelectionUnit {
  return { unitId: candidate.key, type: 'ITEM', itemCount: 1, memberKeys: [candidate.key], stimulusSetId: null, integrity: { kind: 'WHOLE' }, contiguous: true, setKind: null, pool, exposure: candidate.exposure };
}

/** Exposure of a group from its members: seen when any member was seen, recent when any was recent. */
export function groupExposure(members: readonly ExposureFacts[]): ExposureFacts {
  return { seen: members.some((m) => m.seen), recent: members.some((m) => m.recent) };
}

export type SelectionUnitViolation =
  | 'EMPTY_UNIT'
  | 'ITEM_COUNT_MISMATCH'
  | 'DUPLICATE_MEMBER'
  | 'ITEM_WITH_SEVERAL_MEMBERS'
  | 'ITEM_WITH_STIMULUS'
  | 'GROUP_WITHOUT_STIMULUS'
  | 'GROUP_NOT_CONTIGUOUS'
  | 'INVALID_SUBSET_RANGE';

export function selectionUnitViolations(u: SelectionUnit): SelectionUnitViolation[] {
  const out: SelectionUnitViolation[] = [];
  if (u.memberKeys.length === 0) out.push('EMPTY_UNIT');
  if (u.itemCount !== u.memberKeys.length) out.push('ITEM_COUNT_MISMATCH');
  if (new Set(u.memberKeys).size !== u.memberKeys.length) out.push('DUPLICATE_MEMBER');
  if (u.type === 'ITEM') {
    if (u.memberKeys.length > 1) out.push('ITEM_WITH_SEVERAL_MEMBERS');
    if (u.stimulusSetId !== null) out.push('ITEM_WITH_STIMULUS');
  } else {
    if (!u.stimulusSetId) out.push('GROUP_WITHOUT_STIMULUS');
    if (!u.contiguous) out.push('GROUP_NOT_CONTIGUOUS');
  }
  if (u.integrity.kind === 'SUBSET' && !(Number.isInteger(u.integrity.minItems) && Number.isInteger(u.integrity.maxItems) && u.integrity.minItems >= 1 && u.integrity.minItems <= u.integrity.maxItems && u.integrity.maxItems <= u.memberKeys.length)) out.push('INVALID_SUBSET_RANGE');
  return out;
}

/** How many questions a unit may contribute under its integrity rule. */
export function selectableItemRange(u: SelectionUnit): { min: number; max: number } {
  return u.integrity.kind === 'WHOLE' ? { min: u.itemCount, max: u.itemCount } : { min: u.integrity.minItems, max: u.integrity.maxItems };
}

/** Which unit requirements B2 can serve today. A group requirement is reported, never approximated. */
export function unservableUnitRequirements(requirements: readonly SelectionUnitRequirement[]): SelectionUnitRequirement[] {
  return requirements.filter((r) => r.type === 'STIMULUS_GROUP');
}
