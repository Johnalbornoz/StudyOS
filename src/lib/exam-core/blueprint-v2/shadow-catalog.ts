/**
 * Blueprint Engine V2 / BP-4A -- the in-memory catalogue the runtime shadow
 * resolves against, and an end-to-end parity runner that drives the REAL
 * hooks (shadowObserveFormInputs / shadowObserveSimulationPlan) with an
 * in-memory store reproducing exactly the rows the apply service writes.
 * DB-less, deterministic, no student data.
 */
import { compileExam } from './exam-compiler';
import { compileBlueprintVariants, type BlueprintVariantV2 } from './variant';
import { canonicalExamIdentityOf } from './canonical-identity';
import { structuralFullMockDiagnostic } from './structural-diagnostics';
import { runtimeTargetsOf } from './parity';
import { shadowObserveFormInputs, shadowObserveSimulationPlan, type RuntimeShadowRecord, type ShadowCatalog, type ShadowStore } from './runtime-hook';

export function buildShadowCatalog(configs: readonly unknown[]): ShadowCatalog {
  const variants: BlueprintVariantV2[] = [];
  const exams: ShadowCatalog['exams'] = new Map();
  for (const cfg of configs) {
    const e = compileExam(cfg);
    if (!e.examDefinition || !e.blueprint) continue;
    const vs = compileBlueprintVariants(cfg).variants;
    variants.push(...vs);
    const canonical = canonicalExamIdentityOf(e.examDefinition, e.blueprint);
    const spec = e.examDefinition.specification.key;
    exams.set(e.examDefinition.identity.definitionKey, {
      definition: e.examDefinition,
      general: e.blueprint,
      specificationKey: spec.status === 'STATED' ? spec.value : null,
      configFingerprint: e.blueprint.identity.sourceConfigFingerprint,
      canonicalKey: canonical.status === 'RESOLVED' ? canonical.key : null,
      structuralFullMock: structuralFullMockDiagnostic(e.examDefinition, e.blueprint, vs).status,
    });
  }
  return { variants, exams };
}

export interface RuntimeShadowParityReport {
  records: RuntimeShadowRecord[];
  byFlow: Record<string, Record<string, number>>;
  byFamily: Record<string, Record<string, number>>;
  byPurpose: Record<string, Record<string, number>>;
  byResolutionStatus: Record<string, number>;
  /** One record per (flow, parity status): representative, PII-free. */
  examples: RuntimeShadowRecord[];
  notOfferedByRuntime: string[];
}

/**
 * Replays, per configuration the runtime offers, the flows that reach the
 * wired hooks: practice (whole exam), diagnostic, component practice,
 * mock / challenge per official route option (incl. stages of staged routes)
 * and the legacy F9 FULL_MOCK -- with the runtime's own `use` rule.
 */
export async function runRuntimeShadowParity(configs: readonly unknown[]): Promise<RuntimeShadowParityReport> {
  const catalog = buildShadowCatalog(configs);
  const records: RuntimeShadowRecord[] = [];
  const notOfferedByRuntime: string[] = [];
  const env = { EXAM_BLUEPRINT_V2: 'SHADOW' };
  for (const cfg of configs) {
    const key = (cfg as { key: string }).key;
    const exam = catalog.exams.get(key);
    if (!exam) continue;
    if (exam.definition.lifecycle.configuration === 'STRUCTURE_ONLY') {
      notOfferedByRuntime.push(key);
      continue;
    }
    const { targets, components } = runtimeTargetsOf(cfg);
    const purposes = new Map<string, string | null>();
    const store: ShadowStore = {
      versionIdentity: async () => ({ configKey: key, configFingerprint: exam.configFingerprint }),
      objectiveCodes: async (ids) => new Map(ids.map((id) => [id, id.replace(/^objective:/, '')])),
      commandTerms: async (ids) => new Map(ids.map((id) => [id, id])),
      instancePurpose: async (id) => purposes.get(id) ?? null,
    };
    const deps = { env, store, catalog: async () => catalog, sink: (r: RuntimeShadowRecord) => records.push(r) };
    const all = components.map((c) => c.id);
    const legacyBlueprintId = `blueprint:${key}`;
    const examVersionId = `version:${key}`;
    const base = { examVersionId, legacyBlueprintId, focusObjectiveIds: [], components, allTargets: targets };
    const idOf = (sectionKey: string) => components.find((c) => c.sectionKey === sectionKey)!.id;
    const comps = exam.general.components;

    await shadowObserveFormInputs({ ...base, mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: all, instanceId: null }, deps);
    purposes.set(`diag:${key}`, 'DIAGNOSTIC');
    await shadowObserveFormInputs({ ...base, mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: all, instanceId: `diag:${key}` }, deps);
    if (comps.length > 1) for (const c of exam.definition.components.filter((x) => x.studyusPracticeConfigured)) await shadowObserveFormInputs({ ...base, mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: [idOf(c.key)], instanceId: null }, deps);
    const options = exam.general.routes.length
      ? exam.general.routes.flatMap((r) => [...r.componentSets, ...(r.stages ?? []).flat()])
      : [comps.map((c) => c.key)];
    const seen = new Set<string>();
    for (const set of options) {
      const sig = [...set].sort().join('+');
      if (seen.has(sig)) continue; // the same selection is one runtime request
      seen.add(sig);
      const selected = comps.filter((c) => set.includes(c.key));
      const use = selected.every((c) => c.official.itemCount.status === 'STATED' && c.plannedPositions >= c.official.itemCount.value) ? 'FULL_MOCK' : 'REDUCED_MOCK';
      await shadowObserveFormInputs({ ...base, mode: 'MOCK', runtimeUse: use, selectedComponentIds: set.map(idOf), instanceId: null }, deps);
    }
    await shadowObserveSimulationPlan({ examVersionId, legacyBlueprintId, simulationType: 'FULL_MOCK', components, allTargets: targets }, deps);
  }
  const familyOf = (r: RuntimeShadowRecord) => r.canonical_exam_identity?.split('|')[0] ?? catalog.exams.get(r.exam_version_id.replace(/^version:/, ''))?.definition.identity.family ?? 'UNKNOWN';
  const tally = (key: (r: RuntimeShadowRecord) => string) => {
    const out: Record<string, Record<string, number>> = {};
    for (const r of records) {
      const k = key(r);
      out[k] ??= {};
      out[k][r.parity_status] = (out[k][r.parity_status] ?? 0) + 1;
    }
    return out;
  };
  const byResolutionStatus: Record<string, number> = {};
  for (const r of records) byResolutionStatus[r.v2_resolution_status] = (byResolutionStatus[r.v2_resolution_status] ?? 0) + 1;
  const examples: RuntimeShadowRecord[] = [];
  for (const r of records) if (!examples.some((x) => x.flow === r.flow && x.parity_status === r.parity_status)) examples.push(r);
  return { records, byFlow: tally((r) => `${r.flow}:${r.purpose}`), byFamily: tally(familyOf), byPurpose: tally((r) => r.purpose), byResolutionStatus, examples, notOfferedByRuntime };
}

// ---------------------------------------------------------------------------
// Explaining every shadow record (integration gate: 0 UNEXPLAINED)
// ---------------------------------------------------------------------------

export const SHADOW_EXPLANATIONS = [
  'MATCH',
  /** Legacy runs a mock the structure cannot support (coursework / practical / non-timed components). */
  'LEGACY_ONLY:STRUCTURAL_FULL_MOCK_UNSUPPORTED',
  /** A reduced form answering a Full Mock request: V2 refuses it by design. */
  'LEGACY_ONLY:REDUCED_FORM_NOT_FULL_MOCK',
  /** A mock of ONE stage of a staged route: V2 has no stage-scoped variant (product decision pending). */
  'LEGACY_ONLY:STAGE_MOCK_UNMODELLED',
  /** Legacy F9 full mock over every component of a routed exam: not an official combination. */
  'LEGACY_DEFECT:ROUTED_FULL_MOCK_ALL_COMPONENTS',
  /** The configuration declares no specification (V1 DEV-cert): nothing can be resolved without guessing. */
  'MISSING_CONTEXT:SPECIFICATION_UNDECLARED',
  /** The runtime never stored the route and the selection fits several official routes. */
  'MISSING_CONTEXT:ROUTE_NOT_STORED',
  /** The flow selects by objective / subject, which no V2 purpose expresses. */
  'MISSING_CONTEXT:FLOW_PURPOSE_NOT_MODELLED',
  'UNEXPLAINED',
] as const;
export type ShadowExplanation = (typeof SHADOW_EXPLANATIONS)[number];

/** Deterministic classification of one record from its own codes; anything not covered is UNEXPLAINED. */
export function explainShadowRecord(r: RuntimeShadowRecord): ShadowExplanation {
  const has = (code: string) => r.reasons.some((x) => x === code || x.startsWith(`${code}:`) || x.startsWith(code));
  if (r.parity_status === 'MATCH') return 'MATCH';
  if (r.parity_status === 'LEGACY_ONLY') {
    if (has('STRUCTURAL_FULL_MOCK_UNSUPPORTED')) return 'LEGACY_ONLY:STRUCTURAL_FULL_MOCK_UNSUPPORTED';
    if (has('ALL_COMPONENTS_OF_A_ROUTED_EXAM')) return 'LEGACY_DEFECT:ROUTED_FULL_MOCK_ALL_COMPONENTS';
    if (has('STAGE_OF_STAGED_ROUTE')) return 'LEGACY_ONLY:STAGE_MOCK_UNMODELLED';
    if (r.purpose === 'FULL_MOCK' && has('REDUCED_FORM_CANNOT_SATISFY_FULL_MOCK')) return 'LEGACY_ONLY:REDUCED_FORM_NOT_FULL_MOCK';
  }
  if (r.parity_status === 'MISSING_CONTEXT') {
    if (r.specification === null && has('a blueprint is resolved against an explicit specification')) return 'MISSING_CONTEXT:SPECIFICATION_UNDECLARED';
    if (r.route_presence === 'ROUTE_NOT_STORED' && r.reasons.some((x) => /^SET_BELONGS_TO_\d+_ROUTES$/.test(x))) return 'MISSING_CONTEXT:ROUTE_NOT_STORED';
    if (has('FLOW_PURPOSE_NOT_MODELLED')) return 'MISSING_CONTEXT:FLOW_PURPOSE_NOT_MODELLED';
  }
  return 'UNEXPLAINED';
}
