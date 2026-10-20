/**
 * B2-A / B2-B2 -- the selection unit B2 selects (pure).
 *
 * B2 selects single ITEMS, and stimulus-bound content as a STIMULUS_GROUP: a stimulus set with its
 * questions. The Question Bank owns stimulus sets and assets; B2 only needs these FACTS about a unit and
 * never how the stimulus is stored. They arrive through B1 coverage (`QuestionCoverage.stimulus`) and the
 * Question Bank's pool membership -- B2 reads no stimulus table of its own.
 *
 * B2-B2: units are derived from coverage at runtime (`deriveSelectionUnits`). A question bound to a
 * stimulus is selectable ONLY through its group: it is never offered as a loose item, so a group cannot be
 * approximated, split or reordered by the item solver.
 */
import { questionRefKey, type QuestionCoverage } from '@/lib/assessment-foundation/question-coverage';
import { NO_EXPOSURE, type ExposureFacts, type SolverCandidate } from '../solver/candidate';
import type { LogicalPool, PoolAssignments } from './pools';

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
  /** The stimulus VERSION the members are asked about (what a frozen form records). null / absent for an ITEM. */
  stimulusVersionId?: string | null;
  /** The Question Bank's position of each member inside its group, parallel to `memberKeys`. Absent for an ITEM. */
  memberPositions?: number[];
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
  /** The section the units belong to, when the requirement is about one. Absent / null = any section. */
  assessmentComponentId?: string | null;
}

/** Stimulus groups are derived from Question Bank facts and selected as units (B2-B2). */
export const STIMULUS_GROUP_RUNTIME_SELECTION = 'UNITS_FROM_QB_COVERAGE' as const;

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

/**
 * Unit requirements B2 cannot serve: the malformed ones (no unit asked for, an empty or inverted range, an
 * ITEM that is not exactly one question). A well-formed STIMULUS_GROUP requirement is served from derived
 * units since B2-B2; when the bank cannot satisfy it the form is not available -- it is never approximated.
 */
export function unservableUnitRequirements(requirements: readonly SelectionUnitRequirement[]): SelectionUnitRequirement[] {
  const count = (n: number) => Number.isInteger(n) && n >= 1;
  return requirements.filter((r) => !(SELECTION_UNIT_TYPES as readonly string[]).includes(r.type) || !count(r.units) || !count(r.minItems) || !count(r.maxItems) || r.minItems > r.maxItems || (r.type === 'ITEM' && (r.maxItems !== 1 || r.setKind !== null)));
}

/* ------------------------------------------------------------------ */
/* B2-B2: units from Question Bank coverage                             */
/* ------------------------------------------------------------------ */

export const stimulusUnitId = (stimulusId: string): string => `STIMULUS:${stimulusId}`;

export type UnusableGroupReason =
  /** A WHOLE group with a member that is not a candidate: the group cannot be delivered complete. */
  | 'MEMBER_NOT_USABLE'
  /** A SUBSET group with fewer usable members than its declared minimum. */
  | 'BELOW_SUBSET_MINIMUM'
  /** The stored facts do not describe a valid unit (members on two versions, a duplicate position, an inverted range). */
  | 'INVALID_UNIT';

export interface UnusableGroup {
  unitId: string;
  stimulusSetId: string;
  reason: UnusableGroupReason;
  /** Members that are not usable, in stimulus order. */
  unusableMembers: string[];
}

export interface UnitDerivationInput {
  /** Coverage of EVERY current item version that could belong to a unit (the whole exam version, not a filtered list). */
  coverages: readonly QuestionCoverage[];
  /** Questions that passed every hard item rule the caller applies (B1 eligibility at least). */
  usableKeys: ReadonlySet<string>;
  poolAssignments: PoolAssignments;
  /** Per-Student exposure by `<store>:<id>`. Absent = never seen. */
  exposure?: ReadonlyMap<string, ExposureFacts>;
  /** Stimuli the Student has met through ANY version of ANY of their questions, current member or not. */
  exposedStimulusIds?: ReadonlySet<string>;
}

export interface DerivedUnits {
  /** Usable units, by unit id. */
  units: SelectionUnit[];
  unusableGroups: UnusableGroup[];
}

const onePool = (key: string, assignments: PoolAssignments): LogicalPool | null => {
  const pools = assignments.get(key) ?? [];
  return pools.length === 1 ? pools[0] : null;
};

/**
 * Units of a candidate set.
 *   - a usable question with no stimulus                                        -> an ITEM unit
 *   - the current item versions asked about the CURRENT version of one stimulus -> one STIMULUS_GROUP unit,
 *     members in the Question Bank's `position` order, pool = the stimulus's pool (every member inherits it)
 *
 * Integrity comes from the stimulus version (`selection`): none = WHOLE, a range = SUBSET.
 *   WHOLE    every member must be usable, or the group is unusable.
 *   SUBSET   the unit holds the usable members only (still in position order) and is usable when at least
 *            `minItems` of them remain; `maxItems` is capped at what remains.
 *
 * A question whose stimulus version is not the stimulus's current one belongs to no unit (B1 already
 * refuses it); it is never turned into an ITEM.
 */
export function deriveSelectionUnits(input: UnitDerivationInput): DerivedUnits {
  const exposure = input.exposure ?? new Map<string, ExposureFacts>();
  const exposedStimuli = input.exposedStimulusIds ?? new Set<string>();
  const units: SelectionUnit[] = [];
  const unusableGroups: UnusableGroup[] = [];
  const groups = new Map<string, QuestionCoverage[]>();
  for (const c of input.coverages) {
    const key = questionRefKey(c.ref);
    if (!c.stimulus) {
      if (input.usableKeys.has(key)) units.push(itemUnit({ key, exposure: exposure.get(key) ?? NO_EXPOSURE }, onePool(key, input.poolAssignments)));
      continue;
    }
    // Membership is a fact about current versions on both sides; usability is judged per member below.
    if (!c.stimulus.isCurrentVersion || c.bankFacts?.isCurrentVersion === false) continue;
    groups.set(c.stimulus.stimulusId, [...(groups.get(c.stimulus.stimulusId) ?? []), c]);
  }
  for (const [stimulusId, raw] of groups) {
    const members = [...raw].sort((a, b) => a.stimulus!.position - b.stimulus!.position || (questionRefKey(a.ref) < questionRefKey(b.ref) ? -1 : 1));
    const first = members[0].stimulus!;
    const unitId = stimulusUnitId(stimulusId);
    const keys = members.map((m) => questionRefKey(m.ref));
    const unusableMembers = keys.filter((k) => !input.usableKeys.has(k));
    const consistent = members.every((m) => m.stimulus!.stimulusVersionId === first.stimulusVersionId) && new Set(members.map((m) => m.stimulus!.position)).size === members.length;
    const rule = first.selection;
    if (!consistent || (rule !== null && !(Number.isInteger(rule.minItems) && Number.isInteger(rule.maxItems) && rule.minItems >= 1 && rule.minItems <= rule.maxItems))) {
      unusableGroups.push({ unitId, stimulusSetId: stimulusId, reason: 'INVALID_UNIT', unusableMembers });
      continue;
    }
    if (rule === null && unusableMembers.length > 0) {
      unusableGroups.push({ unitId, stimulusSetId: stimulusId, reason: 'MEMBER_NOT_USABLE', unusableMembers });
      continue;
    }
    const kept = rule === null ? members : members.filter((m) => input.usableKeys.has(questionRefKey(m.ref)));
    if (rule !== null && kept.length < rule.minItems) {
      unusableGroups.push({ unitId, stimulusSetId: stimulusId, reason: 'BELOW_SUBSET_MINIMUM', unusableMembers });
      continue;
    }
    const memberKeys = kept.map((m) => questionRefKey(m.ref));
    // Exposure is the GROUP's: any current member seen (usable or not), or the stimulus met through a question that is no longer one.
    const seen = groupExposure(keys.map((k) => exposure.get(k) ?? NO_EXPOSURE));
    units.push({
      unitId, type: 'STIMULUS_GROUP', itemCount: memberKeys.length, memberKeys, stimulusSetId: stimulusId,
      integrity: rule === null ? { kind: 'WHOLE' } : { kind: 'SUBSET', minItems: rule.minItems, maxItems: Math.min(rule.maxItems, memberKeys.length) },
      contiguous: true, setKind: first.kind, pool: onePool(keys[0], input.poolAssignments),
      exposure: exposedStimuli.has(stimulusId) ? { seen: true, recent: seen.recent } : seen,
      stimulusVersionId: first.stimulusVersionId, memberPositions: kept.map((m) => m.stimulus!.position),
    });
  }
  const byId = <T extends { unitId: string }>(a: T, b: T) => (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0);
  return { units: units.sort(byId), unusableGroups: unusableGroups.sort(byId) };
}

/**
 * The questions taken from a unit when `count` are wanted: the FIRST `count` members in stimulus order.
 * Deterministic and order-preserving: a subset is always a prefix of the usable members, never a choice
 * among them. null when the unit's integrity rule does not allow that count.
 */
export function unitPick(u: SelectionUnit, count: number): { memberKeys: string[]; memberPositions: number[] } | null {
  const { min, max } = selectableItemRange(u);
  if (!Number.isInteger(count) || count < min || count > max) return null;
  return { memberKeys: u.memberKeys.slice(0, count), memberPositions: (u.memberPositions ?? []).slice(0, count) };
}
