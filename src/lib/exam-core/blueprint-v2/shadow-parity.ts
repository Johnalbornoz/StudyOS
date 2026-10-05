/**
 * Blueprint Engine V2 / BP-3 -- DB-less shadow parity runner.
 *
 * For every configuration, replays the flows the runtime runs today against
 * a legacy snapshot built from exactly what the apply service writes (the
 * one blueprint of the version), resolves the same flow with the BP-2
 * resolver, and tallies the parity status. Truth over green: AMBIGUOUS /
 * MISSING_CONTEXT / LEGACY_ONLY are reported as they are.
 *
 * Runtime rules mirrored (not changed):
 *  - MOCK `use` = FULL_MOCK when the blueprint reaches every component's
 *    official item count, else REDUCED_MOCK (exam-instance.service.ts:136-140);
 *  - the runtime records component_ids, never a route key.
 */
import { compileBlueprintVariants, type BlueprintVariantV2 } from './variant';
import { compileExam } from './exam-compiler';
import { canonicalExamIdentityOf } from './canonical-identity';
import {
  compareLegacyAndV2BlueprintResolution,
  contextForFullMockRequest,
  contextForStudentInstance,
  legacySnapshotFromConfig,
  toShadowRecord,
  type ParityStatus,
  type RuntimeBlueprintContext,
  type ShadowRecord,
} from './runtime-shadow';

export interface ShadowParityReport {
  configs: number;
  /** Structure-only configurations: the runtime never offers them to a Student, so no flow is replayed. */
  notOfferedByRuntime: string[];
  variants: number;
  records: ShadowRecord[];
  byFlow: Record<string, Partial<Record<ParityStatus, number>>>;
  totals: Partial<Record<ParityStatus, number>>;
}

export function runShadowParity(configs: readonly unknown[]): ShadowParityReport {
  const compiled = configs.map((cfg) => ({ cfg, exam: compileExam(cfg), variants: compileBlueprintVariants(cfg).variants }));
  const catalog = { variants: compiled.flatMap((c) => c.variants) as BlueprintVariantV2[] };
  const records: ShadowRecord[] = [];
  const notOfferedByRuntime: string[] = [];
  for (const { cfg, exam } of compiled) {
    const def = exam.examDefinition;
    const bp = exam.blueprint;
    if (!def || !bp) continue;
    if (def.lifecycle.configuration === 'STRUCTURE_ONLY') {
      notOfferedByRuntime.push(def.identity.definitionKey);
      continue;
    }
    const key = def.identity.definitionKey;
    const versionId = `version:${key}`;
    const blueprintId = `blueprint:${key}`;
    const spec = def.specification.key.status === 'STATED' ? def.specification.key.value : null;
    const canonical = canonicalExamIdentityOf(def, bp);
    const canonicalKey = canonical.status === 'RESOLVED' ? canonical.key : null;
    const all = bp.components.map((c) => c.key);
    const run = (ctx: RuntimeBlueprintContext, componentKeys: string[]) => {
      const legacy = legacySnapshotFromConfig(cfg, { examVersionId: versionId, blueprintId, componentKeys });
      records.push(toShadowRecord(ctx, compareLegacyAndV2BlueprintResolution(ctx, legacy, catalog), canonicalKey));
    };
    const base = { examVersionId: versionId, examDefinitionKey: key, specificationKey: spec, allComponentKeys: all };
    run(contextForStudentInstance({ ...base, mode: 'PRACTICE', instancePurpose: null, componentKeys: all }), all);
    run(contextForStudentInstance({ ...base, mode: 'PRACTICE', instancePurpose: 'DIAGNOSTIC', componentKeys: all }), all);
    // Component practice only where the runtime offers it (simulation-capable component with item cells).
    if (all.length > 1) for (const k of def.components.filter((c) => c.studyusPracticeConfigured).map((c) => c.key)) run(contextForStudentInstance({ ...base, mode: 'PRACTICE', instancePurpose: null, componentKeys: [k] }), [k]);
    const mockSets = bp.routes.length ? bp.routes.flatMap((r) => r.componentSets) : [all];
    for (const set of mockSets) {
      const comps = bp.components.filter((c) => set.includes(c.key));
      const runtimeUse = comps.every((c) => c.official.itemCount.status === 'STATED' && c.plannedPositions >= c.official.itemCount.value) ? 'FULL_MOCK' : 'REDUCED_MOCK';
      run(contextForStudentInstance({ ...base, mode: 'MOCK', instancePurpose: null, componentKeys: [...set], runtimeUse, examHasRoutes: bp.routes.length > 0 }), [...set]);
    }
    run(contextForFullMockRequest({ examVersionId: versionId, examDefinitionKey: key, specificationKey: spec }), all);
  }
  const byFlow: ShadowParityReport['byFlow'] = {};
  const totals: ShadowParityReport['totals'] = {};
  for (const r of records) {
    const flow = `${r.source_flow}:${r.purpose}`;
    byFlow[flow] ??= {};
    byFlow[flow][r.parity_status] = (byFlow[flow][r.parity_status] ?? 0) + 1;
    totals[r.parity_status] = (totals[r.parity_status] ?? 0) + 1;
  }
  return { configs: configs.length, notOfferedByRuntime, variants: catalog.variants.length, records, byFlow, totals };
}
