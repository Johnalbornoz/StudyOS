/**
 * AICE 9709 AS Papers 2, 4 and 5 -- the governed Cambridge 9709 P2 / P4 / P5 entries (cie-9709-p2p4p5.adoption.ts)
 * placed in the AICE buckets, under the PILOT equivalence AICE-9709-P2P4P5-EQUIVALENCE-2026-10-15
 * (aice-9709-p2p4p5-equivalence.ts): the same syllabus record defines both. One entry per AICE objective, matched by
 * its paper's adapter and the concept the objective's reviewed link names; only the bucket is AICE's.
 */
import type { LibraryEntry } from './catalogue';
import { CIE_9709_P2P4P5_ENTRIES, CIE_9709_P5_CANONICAL_ENTRIES } from './cie-9709-p2p4p5.adoption';
import { AICE_9709_P2P4P5_EQUIVALENCES, AICE_9709_P2P4P5_EQUIVALENCES_2026_10_15, CIE_9709_PAPER_ADAPTER, type AiceTopicEquivalence } from '@/lib/curriculum/cambridge/aice-9709-p2p4p5-equivalence';
import type { LibraryEntry as Entry } from './catalogue';

const place = (eqs: readonly AiceTopicEquivalence[], pool: readonly Entry[]): LibraryEntry[] => eqs.map((eq) => {
  const adapterId = CIE_9709_PAPER_ADAPTER[eq.paper];
  const found = pool.filter((x) => x.core.primaryConceptStableId === eq.conceptStableId && x.targets.some((t) => t.adapterId === adapterId));
  if (found.length !== 1) throw new Error(`AICE_9709_P2P4P5_ENTRY_NOT_UNIQUE ${eq.aiceObjectiveCode}: ${found.length}`);
  const e = found[0];
  return { ...e, targets: e.targets.map((t) => ({ ...t, objectiveCode: eq.aiceObjectiveCode })) };
});
/** AICE-9709-P2P4P5-A1 AS PUBLISHED (2026-10-15): its own equivalences and entries, history. */
export const AICE_9709_P2P4P5_ENTRIES: readonly LibraryEntry[] = place(AICE_9709_P2P4P5_EQUIVALENCES_2026_10_15, CIE_9709_P2P4P5_ENTRIES);
/** AICE-9709-P5-CANON-A2 (2026-10-16): P5 permutations / probability on the existing canonical identities. */
export const AICE_9709_P5_CANONICAL_ENTRIES: readonly LibraryEntry[] = place(AICE_9709_P2P4P5_EQUIVALENCES.filter((e) => e.correspondence === 'CROSS_CURRICULUM_CANONICAL_IDENTITY'), CIE_9709_P5_CANONICAL_ENTRIES);
