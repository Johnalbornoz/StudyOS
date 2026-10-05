/**
 * Blueprint Engine V2 / BP-3 -- structural diagnostics owned by the
 * Blueprint track and consumable by the Question Bank / catalogue track.
 *
 *  - routeStructures: an official route as DISTINCT component sets, each with
 *    the session sequencings (stagings) under which it can be sat. A staged
 *    route that lists the same set twice (e.g. 9709 A: {p1,p3,p4,p5} with
 *    P1+P4 or P1+P5 first) is ONE structure with two sequencings, not two
 *    blueprints.
 *  - structuralFullMockDiagnostics: whether the STRUCTURE can be a full mock.
 *    Structure only: this never says whether content exists (content
 *    readiness belongs to the Question Bank and is not computed here).
 */
import type { BlueprintV2 } from './schema';
import type { ExamDefinitionV2, TriState } from './exam-definition';
import type { BlueprintVariantV2 } from './variant';

export interface RouteStructure {
  routeKey: string;
  /** Sorted component keys. */
  componentSet: string[];
  /** How many times the source lists this set for the route. */
  listedTimes: number;
  /** Per listing, the session-by-session stages (empty when the route is not staged). */
  sessionSequencings: string[][][];
}

export function routeStructures(bp: BlueprintV2): RouteStructure[] {
  const out: RouteStructure[] = [];
  for (const r of bp.routes) {
    r.componentSets.forEach((set, i) => {
      const componentSet = [...set].sort();
      const key = componentSet.join('+');
      let entry = out.find((x) => x.routeKey === r.key && x.componentSet.join('+') === key);
      if (!entry) {
        entry = { routeKey: r.key, componentSet, listedTimes: 0, sessionSequencings: [] };
        out.push(entry);
      }
      entry.listedTimes += 1;
      const stages = r.stages?.[i];
      if (stages) entry.sessionSequencings.push(stages.map((s) => [...s].sort()));
    });
  }
  return out.sort((a, b) => a.routeKey.localeCompare(b.routeKey) || a.componentSet.join('+').localeCompare(b.componentSet.join('+')));
}

export type StructuralFullMockStatus =
  /** A FULL_MOCK structure exists (all components at official length and mockable). */
  | 'STRUCTURAL_FULL_MOCK_SUPPORTED'
  /** Mockable, but no structure at official length: only a disclosed REDUCED_MOCK. */
  | 'STRUCTURAL_FULL_MOCK_NOT_AT_OFFICIAL_LENGTH'
  /** Every candidate scope contains a component that cannot be sat as a mock. */
  | 'STRUCTURAL_FULL_MOCK_UNSUPPORTED'
  /** Structure-only configuration (no item blueprint). */
  | 'NOT_ASSEMBLABLE';

export interface StructuralFullMockDiagnostic {
  examDefinitionKey: string;
  status: StructuralFullMockStatus;
  reasons: Array<{ code: 'NON_MOCKABLE_COMPONENT' | 'ALL_ROUTE_SETS_INCLUDE_NON_MOCKABLE' | 'NOT_AT_OFFICIAL_LENGTH' | 'MOCKABILITY_UNKNOWN' | 'NO_ITEM_BLUEPRINT'; componentKey?: string; componentClass?: string; detail?: string }>;
  /** Structure only. There is deliberately no content-readiness field. */
  structuralCapabilities: { supportsMock: TriState; supportsCoursework: TriState; fullLengthStructure: TriState };
}

export function structuralFullMockDiagnostic(def: ExamDefinitionV2, general: BlueprintV2, variants: readonly BlueprintVariantV2[]): StructuralFullMockDiagnostic {
  const key = def.identity.definitionKey;
  const mine = variants.filter((v) => v.identity.examDefinitionKey === key);
  const caps = {
    supportsMock: def.capabilities.supportsMock.value,
    supportsCoursework: def.capabilities.supportsCoursework.value,
    fullLengthStructure: (mine.some((v) => v.identity.purpose === 'FULL_MOCK') ? 'YES' : mine.some((v) => v.identity.purpose === 'REDUCED_MOCK') ? 'NO' : 'UNKNOWN') as TriState,
  };
  if (def.lifecycle.configuration === 'STRUCTURE_ONLY') return { examDefinitionKey: key, status: 'NOT_ASSEMBLABLE', reasons: [{ code: 'NO_ITEM_BLUEPRINT' }], structuralCapabilities: caps };
  if (mine.some((v) => v.identity.purpose === 'FULL_MOCK')) return { examDefinitionKey: key, status: 'STRUCTURAL_FULL_MOCK_SUPPORTED', reasons: [], structuralCapabilities: caps };
  const nonMockable = def.components.filter((c) => c.mockable === 'NO').map((c) => ({ code: 'NON_MOCKABLE_COMPONENT' as const, componentKey: c.key, componentClass: c.componentClass }));
  if (mine.some((v) => v.identity.purpose === 'REDUCED_MOCK')) {
    return { examDefinitionKey: key, status: 'STRUCTURAL_FULL_MOCK_NOT_AT_OFFICIAL_LENGTH', reasons: [{ code: 'NOT_AT_OFFICIAL_LENGTH', detail: 'only a disclosed reduced form' }, ...def.components.filter((c) => c.mockable === 'UNKNOWN').map((c) => ({ code: 'MOCKABILITY_UNKNOWN' as const, componentKey: c.key }))], structuralCapabilities: caps };
  }
  const reasons: StructuralFullMockDiagnostic['reasons'] = [...nonMockable];
  if (general.routes.length) reasons.push({ code: 'ALL_ROUTE_SETS_INCLUDE_NON_MOCKABLE', detail: general.routes.map((r) => r.key).join(', ') });
  return { examDefinitionKey: key, status: 'STRUCTURAL_FULL_MOCK_UNSUPPORTED', reasons, structuralCapabilities: caps };
}
