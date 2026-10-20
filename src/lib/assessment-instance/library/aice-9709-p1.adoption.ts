/**
 * AICE 9709 Paper 1 -- the governed CAMBRIDGE.9709.P1 entries placed in the AICE P1 buckets, under the PILOT
 * equivalence AICE-9709-P1-EQUIVALENCE-2026-10-15 (aice-9709-p1-equivalence.ts). The SAME constructs, cores,
 * envelopes, adapter and certification as batch CIE-9709-P1-A1; only the bucket differs. No AICE content is created.
 */
import type { LibraryEntry } from './catalogue';
import { CIE_9709_P1_ENTRIES } from './cie-9709-p1.adoption';
import { AICE_9709_P1_EQUIVALENCES } from '@/lib/curriculum/cambridge/aice-9709-p1-equivalence';

export const AICE_9709_P1_ENTRIES: readonly LibraryEntry[] = AICE_9709_P1_EQUIVALENCES.map((eq) => {
  const e = CIE_9709_P1_ENTRIES.find((x) => x.core.primaryConceptStableId === eq.conceptStableId);
  if (!e) throw new Error(`AICE_9709_P1_NO_GOVERNED_ENTRY ${eq.conceptStableId}`);
  return { ...e, targets: e.targets.map((t) => ({ ...t, objectiveCode: eq.aiceObjectiveCode })) };
});
