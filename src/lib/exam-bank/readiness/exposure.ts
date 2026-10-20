/**
 * Generic EXPOSURE-aware form selection contract (pure, no IO). One contract for every exam system.
 *
 *   eligible certified supply  ->  remove / de-prioritise previously exposed supply  ->  satisfy the blueprint
 *   ->  minimise repetition  ->  freeze the form.
 *
 * The caller passes only RUNTIME_DELIVERABLE rows (see `deliverabilityOf`); this module never widens supply.
 * Order inside a bucket: never-exposed first (seeded, stable order), then least-recently exposed. An item fills at
 * most one position per form. Every repeat is reported, never hidden.
 *
 * This is the reference contract. The running PAA assembler (src/lib/exam-core/form-assembly.ts) is frozen with the
 * pilot baseline and is NOT rewired to this module.
 */
import { createHash } from 'crypto';

export interface ExposureBucket { bucketId: string; requiredPositions: number }
export interface ExposureCandidate { itemId: string; bucketIds: readonly string[] }
/** itemId -> ISO time the Student last saw it. Absent = never exposed. */
export type ExposureHistory = ReadonlyMap<string, string>;

export interface AssembledForm {
  positions: Array<{ bucketId: string; itemId: string; repeat: boolean }>;
  repeatedItemIds: string[];
  unfilled: Array<{ bucketId: string; missing: number }>;
}

const rank = (seed: string, id: string): string => createHash('sha256').update(`${seed}\u0000${id}`).digest('hex');

export function assembleForm(buckets: readonly ExposureBucket[], eligible: readonly ExposureCandidate[], exposure: ExposureHistory, seed: string): AssembledForm {
  const used = new Set<string>();
  const positions: AssembledForm['positions'] = [];
  const unfilled: AssembledForm['unfilled'] = [];
  for (const b of buckets) {
    const pool = eligible.filter((c) => c.bucketIds.includes(b.bucketId) && !used.has(c.itemId));
    const fresh = pool.filter((c) => !exposure.has(c.itemId)).sort((x, y) => rank(seed, x.itemId).localeCompare(rank(seed, y.itemId)));
    const seen = pool.filter((c) => exposure.has(c.itemId)).sort((x, y) => (exposure.get(x.itemId)! < exposure.get(y.itemId)! ? -1 : exposure.get(x.itemId)! > exposure.get(y.itemId)! ? 1 : x.itemId.localeCompare(y.itemId)));
    const take = [...fresh, ...seen].slice(0, b.requiredPositions);
    for (const c of take) { used.add(c.itemId); positions.push({ bucketId: b.bucketId, itemId: c.itemId, repeat: exposure.has(c.itemId) }); }
    if (take.length < b.requiredPositions) unfilled.push({ bucketId: b.bucketId, missing: b.requiredPositions - take.length });
  }
  return { positions, repeatedItemIds: positions.filter((p) => p.repeat).map((p) => p.itemId), unfilled };
}
