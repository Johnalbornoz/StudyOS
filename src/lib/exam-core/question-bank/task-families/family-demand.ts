/**
 * EA-1 -- planned demand read as REQUIRED EVIDENCE INSTANCES per concept, and the task families it implies
 * (pure analysis, no IO, no content).
 *
 * A requirement cell says "n items for this pool on this concept". Read through task families, the same number
 * means "n INSTANCES of evidence of this concept in this pool" -- and the question the count alone cannot answer
 * is how many DIFFERENT ways of asking those instances come from. Ten instances of one family are ten
 * parameterisations of one task; whether they are ten independent pieces of evidence is decided later, by B3,
 * and is not decided here.
 *
 * This module only counts, under an assumption that is passed in and printed with every result:
 *   maxInstancesPerFamilyPerPool   how many instances of ONE family ONE pool may hold
 *   familyMayServeSeveralPools     whether a family that supplies one pool may also supply another
 *                                  (with different instances: pools never share an instance)
 * Both are STUDYUS_POLICY and PROVISIONAL. No independence rule exists yet; the numbers are a planning estimate
 * of how many families would have to be authored, not a commitment and not a property of the demand. The demand
 * is read and never changed: this module takes the cells' own fields and returns counts.
 *
 * It takes a structural view of a cell so that this directory imports nothing of the Production OS.
 */

/** The fields of a requirement cell this analysis reads. A `RequirementCell` satisfies it as it is. */
export interface DemandCell {
  primaryConcept: { stableId: string; canonicalSubject: string; canonicalName: string };
  sectionCode: string;
  intendedPool: string;
  count: number;
}

export interface FamilyIndependenceAssumption {
  maxInstancesPerFamilyPerPool: number;
  familyMayServeSeveralPools: boolean;
}

export const FAMILY_DEMAND_ASSUMPTION_AUTHORITY = { authority: 'STUDYUS_POLICY', status: 'PROVISIONAL', note: 'No independence rule is defined yet (B3). These parameters are placeholders for one.' } as const;
/** The assumption the EA-1 report is written under. Stated, not hidden: change it and every number changes. */
export const EA1_DEFAULT_FAMILY_ASSUMPTION: FamilyIndependenceAssumption = { maxInstancesPerFamilyPerPool: 2, familyMayServeSeveralPools: true };
/** Pools whose instances must be frozen and certified before use (the mock pools of the requirement cell). */
export const FROZEN_INSTANCE_POOLS: ReadonlySet<string> = new Set(['REDUCED_MOCK', 'FULL_MOCK_1', 'FULL_MOCK_2']);

export interface ConceptEvidenceDemand {
  conceptStableId: string;
  canonicalSubject: string;
  canonicalName: string;
  sectionCodes: string[];
  requiredInstances: number;
  pools: number;
  instancesByPool: Record<string, number>;
  /** Of the required instances, those that must be frozen certified instances. */
  frozenInstances: number;
  /** The fewest distinct task families that can supply the instances under the assumption. */
  minimumFamilies: number;
}

export interface EvidenceDemandReport {
  kind: 'PLANNING_ESTIMATE';
  assumption: FamilyIndependenceAssumption & typeof FAMILY_DEMAND_ASSUMPTION_AUTHORITY;
  totals: { concepts: number; requiredInstances: number; frozenInstances: number; minimumFamilies: number; instancesByPool: Record<string, number> };
  bySection: Record<string, { concepts: number; requiredInstances: number; frozenInstances: number; minimumFamilies: number }>;
  byConcept: ConceptEvidenceDemand[];
}

const sortedRecord = <T>(m: Map<string, T>): Record<string, T> => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** The fewest families that supply `byPool` instances: per pool ceil(n / max); across pools the largest need, or their sum. */
export function minimumFamiliesFor(instancesByPool: Readonly<Record<string, number>>, a: FamilyIndependenceAssumption): number {
  if (!Number.isInteger(a.maxInstancesPerFamilyPerPool) || a.maxInstancesPerFamilyPerPool < 1) throw new Error('ASSUMPTION_INVALID: maxInstancesPerFamilyPerPool must be a positive integer');
  const perPool = Object.values(instancesByPool).map((n) => Math.ceil(n / a.maxInstancesPerFamilyPerPool));
  return perPool.length === 0 ? 0 : a.familyMayServeSeveralPools ? Math.max(...perPool) : perPool.reduce((s, n) => s + n, 0);
}

/** Planned demand grouped by PRIMARY concept and pool, with the family count the assumption implies. Order-independent. */
export function evidenceDemandByConcept(cells: readonly DemandCell[], assumption: FamilyIndependenceAssumption = EA1_DEFAULT_FAMILY_ASSUMPTION): EvidenceDemandReport {
  const byConcept = new Map<string, { ref: DemandCell['primaryConcept']; sections: Set<string>; pools: Map<string, number> }>();
  for (const c of cells) {
    const e = byConcept.get(c.primaryConcept.stableId) ?? { ref: c.primaryConcept, sections: new Set<string>(), pools: new Map<string, number>() };
    e.sections.add(c.sectionCode);
    e.pools.set(c.intendedPool, (e.pools.get(c.intendedPool) ?? 0) + c.count);
    byConcept.set(c.primaryConcept.stableId, e);
  }
  const rows: ConceptEvidenceDemand[] = [...byConcept.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([stableId, e]) => {
    const instancesByPool = sortedRecord(e.pools);
    const requiredInstances = Object.values(instancesByPool).reduce((s, n) => s + n, 0);
    return {
      conceptStableId: stableId, canonicalSubject: e.ref.canonicalSubject, canonicalName: e.ref.canonicalName, sectionCodes: [...e.sections].sort(), requiredInstances, pools: e.pools.size, instancesByPool,
      frozenInstances: Object.entries(instancesByPool).filter(([p]) => FROZEN_INSTANCE_POOLS.has(p)).reduce((s, [, n]) => s + n, 0),
      minimumFamilies: minimumFamiliesFor(instancesByPool, assumption),
    };
  });
  const sum = (list: ConceptEvidenceDemand[]) => ({ concepts: list.length, requiredInstances: list.reduce((s, r) => s + r.requiredInstances, 0), frozenInstances: list.reduce((s, r) => s + r.frozenInstances, 0), minimumFamilies: list.reduce((s, r) => s + r.minimumFamilies, 0) });
  const pools = new Map<string, number>();
  for (const r of rows) for (const [p, n] of Object.entries(r.instancesByPool)) pools.set(p, (pools.get(p) ?? 0) + n);
  const sections = new Map<string, ConceptEvidenceDemand[]>();
  // a concept is counted under each Section that plans it; no certified PAA concept is planned in two
  for (const r of rows) for (const s of r.sectionCodes) sections.set(s, [...(sections.get(s) ?? []), r]);
  return {
    kind: 'PLANNING_ESTIMATE',
    assumption: { ...assumption, ...FAMILY_DEMAND_ASSUMPTION_AUTHORITY },
    totals: { ...sum(rows), instancesByPool: sortedRecord(pools) },
    bySection: sortedRecord(new Map([...sections.entries()].map(([s, list]) => [s, sum(list)]))),
    byConcept: rows,
  };
}
