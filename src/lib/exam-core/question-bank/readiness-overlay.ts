/**
 * Question Bank Factory -- DYNAMIC READINESS (pure overlay).
 *
 * The catalogue persists a readiness per node computed from the static vertical
 * configuration at apply time. Bank health computes readiness from the LIVE
 * bank by assembling forms. This overlay decides what a node offers:
 *
 *   SHADOW  (default) -- the persisted readiness stands; bank readiness is only
 *                        computed and compared (CLI / admin), never applied;
 *   ENFORCE           -- the node's state comes from the latest bank-health
 *                        snapshot: retired / suspended content downgrades it,
 *                        validated content can upgrade it, filtered by the
 *                        modes the catalogue node DECLARES (an area-practice
 *                        node never becomes a mock because its bank grew).
 *
 * Never upgrades a node with no configured structure (CATALOG_ONLY), and with
 * no snapshot for the version the persisted readiness stands. The UI only
 * reads the result; the instance API applies the same overlay before launch.
 */
import { modesFor, isMockReady, type ReadinessState } from '../catalog/readiness';
import { readinessForBinding, type BankHealth, type BankReadiness } from './health';

export type Mode = 'PRACTICE' | 'MOCK' | 'CHALLENGE';

export interface PersistedNodeReadiness {
  state: ReadinessState;
  modes: Mode[];
  components: Array<{ sectionKey: string; state: ReadinessState }>;
  selectable: boolean;
}

export interface NodeBinding {
  sectionKey?: string | null;
  sectionKeys?: string[] | null;
  objectiveCodes?: string[] | null;
}

export function bankStateOf(r: BankReadiness): ReadinessState {
  if (!r.structure) return 'CATALOG_ONLY';
  if (r.fullMock.ready) return 'FULL_MOCK_READY';
  if (r.reducedMock.ready) return 'REDUCED_MOCK_READY';
  if (r.practice.ready) return 'PRACTICE_READY';
  return 'STRUCTURE_READY';
}

export interface OverlayResult extends PersistedNodeReadiness {
  changed: boolean;
  bankState: ReadinessState | null;
}

export function overlayNodeReadiness(p: {
  persisted: PersistedNodeReadiness;
  declaredModes: Mode[] | undefined;
  /** The node is bound to a published version (and component, when section-bound). */
  bound: boolean;
  bind: NodeBinding | null;
  snapshot: Pick<BankHealth, 'cells' | 'components'> | null;
  mode: 'SHADOW' | 'ENFORCE';
}): OverlayResult {
  const same = { ...p.persisted, changed: false, bankState: null };
  if (!p.bind || !p.snapshot || p.snapshot.components.length === 0) return same;
  const sectionKeys = p.bind.sectionKey ? [p.bind.sectionKey] : p.bind.sectionKeys ?? null;
  const objectiveCodes = p.bind.objectiveCodes?.length ? p.bind.objectiveCodes : null;
  const r = readinessForBinding(p.snapshot, sectionKeys, objectiveCodes);
  const bankState = bankStateOf(r);
  if (p.mode === 'SHADOW' || p.persisted.state === 'CATALOG_ONLY') return { ...same, bankState };

  const modes = modesFor(bankState, p.declaredModes) as Mode[];
  // What the entry OFFERS (same rule as the catalogue): a node that cannot run a mock is never shown as mock-ready.
  const state: ReadinessState = isMockReady(bankState) && !modes.includes('MOCK') ? (modes.includes('PRACTICE') ? 'PRACTICE_READY' : 'STRUCTURE_READY') : bankState;
  const components = p.snapshot.components
    .filter((c) => !sectionKeys || sectionKeys.includes(c.sectionKey))
    .map((c) => ({ sectionKey: c.sectionKey, state: bankStateOf(readinessForBinding(p.snapshot!, [c.sectionKey], objectiveCodes)) }));
  const selectable = p.bound && modes.length > 0;
  const changed = state !== p.persisted.state || selectable !== p.persisted.selectable || modes.join() !== p.persisted.modes.join();
  return { state, modes, components, selectable, changed, bankState };
}

/** Shadow comparison row (old vs calculated), for the readiness report. */
export interface ShadowDiff {
  nodeKey: string;
  persisted: ReadinessState;
  calculated: ReadinessState | null;
  direction: 'SAME' | 'UPGRADE' | 'DOWNGRADE' | 'NO_SNAPSHOT';
}

const ORDER: ReadinessState[] = ['CATALOG_ONLY', 'STRUCTURE_READY', 'PRACTICE_READY', 'REDUCED_MOCK_READY', 'FULL_MOCK_READY'];
export function shadowDirection(persisted: ReadinessState, calculated: ReadinessState | null): ShadowDiff['direction'] {
  if (calculated === null) return 'NO_SNAPSHOT';
  const d = ORDER.indexOf(calculated) - ORDER.indexOf(persisted);
  return d === 0 ? 'SAME' : d > 0 ? 'UPGRADE' : 'DOWNGRADE';
}
