/**
 * Blueprint Engine V2 / BP-4A -- runtime SHADOW wiring. T1-T17.
 *
 * The real formInputs (exam-instance.service.ts) runs against a mocked
 * database (SQL-routed, order-independent) with the flag OFF and SHADOW: the
 * legacy inputs must be byte-identical and the shadow must only observe.
 * The hooks themselves are also driven directly with injected, in-memory
 * dependencies built from the applied configurations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const sqlLog: string[] = [];
const dbRows: { route: (sql: string, params: unknown[]) => unknown[] } = { route: () => [] };
vi.mock('@/lib/db', () => ({ db: { query: vi.fn(async (sql: string, params: unknown[]) => { sqlLog.push(sql); return { rows: dbRows.route(sql, params) }; }) } }));
const legacy = { blueprint: { id: 'bp-legacy-1', examVersionId: 'ev-1', status: 'PUBLISHED' }, targets: [] as any[], components: [] as any[] };
vi.mock('@/lib/assessment/blueprint.service', () => ({ getBlueprintForVersion: vi.fn(async () => legacy.blueprint), listObjectiveTargets: vi.fn(async () => legacy.targets) }));
vi.mock('@/lib/assessment/component.service', () => ({ listComponentsForVersion: vi.fn(async () => legacy.components), getComponent: vi.fn() }));

import { formInputs } from '@/lib/exam-core/exam-instance.service';
import {
  buildShadowCatalog,
  shadowObserveFormInputs,
  shadowObserveSimulationPlan,
  runtimeTargetsOf,
  compileBlueprint,
  compileBlueprintVariants,
  runRuntimeShadowParity,
  RUNTIME_SHADOW_RECORD_KEYS,
  shadowCatalogBuilt,
  provenance,
  type RuntimeShadowRecord,
  type ShadowCatalog,
  type ShadowStore,
  type DeclaredVariantInput,
} from '@/lib/exam-core/blueprint-v2';
import { blueprintV2Mode } from '@/lib/exam-core/blueprint-v2/flag';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { DEV_CERT_VERTICALS } from '@/lib/exam-core/verticals';
import { IB_MATH_AA_HL_V2, IB_VISUAL_ARTS_HL_V2, PAA_V2, AICE_9709_A, AICE_9709_AS } from '@/lib/exam-core/verticals/v2';

const SHADOW = { EXAM_BLUEPRINT_V2: 'SHADOW' };
const CATALOG = buildShadowCatalog([IB_MATH_AA_HL_V2, IB_VISUAL_ARTS_HL_V2, PAA_V2, AICE_9709_A, AICE_9709_AS]);

function harness(cfg: { key: string }, opts: { purposes?: Record<string, string>; catalog?: ShadowCatalog } = {}) {
  const { targets, components } = runtimeTargetsOf(cfg);
  const records: RuntimeShadowRecord[] = [];
  const calls: string[] = [];
  const catalog = opts.catalog ?? CATALOG;
  const exam = catalog.exams.get(cfg.key)!;
  const store: ShadowStore = {
    versionIdentity: async () => (calls.push('versionIdentity'), { configKey: cfg.key, configFingerprint: exam.configFingerprint }),
    objectiveCodes: async (ids) => (calls.push('objectiveCodes'), new Map(ids.map((id) => [id, id.replace(/^objective:/, '')]))),
    commandTerms: async (ids) => (calls.push('commandTerms'), new Map(ids.map((id) => [id, id]))),
    instancePurpose: async (id) => (calls.push('instancePurpose'), opts.purposes?.[id] ?? null),
  };
  const catalogFn = vi.fn(async () => catalog);
  const deps = (env: Record<string, string> = SHADOW) => ({ env, store, catalog: catalogFn, sink: (r: RuntimeShadowRecord) => records.push(r) });
  const idOf = (k: string) => components.find((c) => c.sectionKey === k)!.id;
  const base = { examVersionId: 'ev-1', legacyBlueprintId: 'bp-legacy-1', focusObjectiveIds: [] as string[], components, allTargets: targets, instanceId: null as string | null };
  return { records, calls, catalogFn, deps, idOf, base, components, targets };
}

// ---------------------------------------------------------------------------
describe('T1 -- OFF computes nothing', () => {
  it('no catalogue, no store read, no record', async () => {
    const h = harness(PAA_V2);
    await shadowObserveFormInputs({ ...h.base, mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: h.components.map((c) => c.id) }, h.deps({}));
    await shadowObserveSimulationPlan({ ...h.base, simulationType: 'FULL_MOCK' }, h.deps({ EXAM_BLUEPRINT_V2: 'ON' }));
    expect(h.catalogFn).not.toHaveBeenCalled();
    expect(h.calls).toEqual([]);
    expect(h.records).toEqual([]);
    expect(blueprintV2Mode({ EXAM_BLUEPRINT_V2: 'CUTOVER' })).toBe('OFF');
    expect(blueprintV2Mode({ EXAM_BLUEPRINT_V2: 'V2' })).toBe('OFF');
  });
});

// ---------------------------------------------------------------------------
describe('T2 / T15 / T12 -- the real formInputs: OFF and SHADOW return identical legacy inputs', () => {
  const fp = compileBlueprint(PAA_V2).blueprint!.identity.sourceConfigFingerprint;
  const { targets, components } = runtimeTargetsOf(PAA_V2);
  beforeEach(() => {
    sqlLog.length = 0;
    legacy.components = components.map((c) => ({ id: c.id, sectionKey: c.sectionKey, name: c.sectionKey }));
    legacy.targets = Object.freeze(targets.map((t) => Object.freeze({ ...t, blueprintId: 'bp-legacy-1', targetItemCount: 1, reasoningRequirement: null, skillId: null }))) as unknown as any[];
    dbRows.route = (sql) => {
      if (sql.includes('officialItemCount') && sql.includes('max_marks')) return components.map((c) => ({ id: c.id, max_marks: null, item_count: null }));
      if (sql.includes('officialItemCount')) return components.map((c) => ({ id: c.id, n: null }));
      if (sql.includes('FROM exam_versions ev JOIN exam_definitions')) return [{ config_key: 'v2.paa', fp }];
      if (sql.includes('FROM learning_objectives')) return [...new Set(targets.map((t) => t.learningObjectiveId))].map((id) => ({ id, code: id.replace(/^objective:/, '') }));
      if (sql.includes('FROM exam_instances')) return [{ purpose: null }];
      return [];
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  it('byte-identical inputs; the shadow emits one record and only reads catalogue tables', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('EXAM_BLUEPRINT_V2', 'OFF');
    const before = JSON.stringify(legacy.targets);
    const off = await formInputs('ev-1', components.map((c) => c.id), 'student-1', [], 'MOCK', 'STUDENT', { instanceId: 'inst-1' });
    const offSql = [...sqlLog];
    expect(log.mock.calls.filter((c) => c[0] === '[blueprint_v2_shadow]')).toEqual([]);
    expect(shadowCatalogBuilt()).toBe(false); // OFF never loads the Blueprint V2 catalogue
    sqlLog.length = 0;
    vi.stubEnv('EXAM_BLUEPRINT_V2', 'SHADOW');
    const shadow = await formInputs('ev-1', components.map((c) => c.id), 'student-1', [], 'MOCK', 'STUDENT', { instanceId: 'inst-1' });
    expect(JSON.stringify(shadow, (_k, v) => (v instanceof Set ? [...v] : v instanceof Map ? [...v] : v))).toBe(JSON.stringify(off, (_k, v) => (v instanceof Set ? [...v] : v instanceof Map ? [...v] : v)));
    expect(JSON.stringify(legacy.targets)).toBe(before);
    const lines = log.mock.calls.filter((c) => c[0] === '[blueprint_v2_shadow]');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0][1] as string);
    expect(rec).toMatchObject({ flow: 'STUDENT_EXAM_INSTANCE', purpose: 'REDUCED_MOCK', parity_status: 'MATCH', legacy_blueprint_id: 'bp-legacy-1', canonical_exam_identity: 'PAA|paa-revisada|no-level', specification: 'paa-revisada@2021' });
    // T12: the shadow adds only catalogue reads -- never Question Bank readiness, items, usage or results.
    const added = sqlLog.filter((s) => !offSql.includes(s));
    expect(added.length).toBeGreaterThan(0);
    for (const s of added) {
      expect(s).toMatch(/exam_versions|exam_definitions|learning_objectives|command_terms|exam_instances/);
      expect(s).not.toMatch(/readiness|question_bank|approved_items|exam_item_usage|simulation_attempts|responses|INSERT|UPDATE|DELETE/i);
    }
    log.mockRestore();
  });
});

// ---------------------------------------------------------------------------
describe('T3 / T9 -- Student Full Mock requests are explicit and never matched by a reduced form', () => {
  it('legacy F9 FULL_MOCK on PAA: purpose FULL_MOCK, LEGACY_ONLY with the reason', async () => {
    const h = harness(PAA_V2);
    await shadowObserveSimulationPlan({ ...h.base, simulationType: 'FULL_MOCK' }, h.deps());
    expect(h.records).toHaveLength(1);
    expect(h.records[0]).toMatchObject({ flow: 'SIMULATION_PLAN:FULL_MOCK', purpose: 'FULL_MOCK', scope: 'ENTIRE_ASSESSMENT', parity_status: 'LEGACY_ONLY', v2_resolution_status: 'NO_MATCH' });
    expect(h.records[0].reasons).toContain('REDUCED_FORM_CANNOT_SATISFY_FULL_MOCK');
  });
  it('the runtime reduced mock matches REDUCED_MOCK, never FULL_MOCK', async () => {
    const h = harness(PAA_V2);
    await shadowObserveFormInputs({ ...h.base, mode: 'MOCK', runtimeUse: 'REDUCED_MOCK', selectedComponentIds: h.components.map((c) => c.id) }, h.deps());
    expect(h.records[0]).toMatchObject({ purpose: 'REDUCED_MOCK', parity_status: 'MATCH' });
    expect(h.records[0].v2_blueprint_identity).toMatch(/\|REDUCED_MOCK\|/);
  });
  it('TOPIC / DOMAIN / MINI simulations are recorded as unmodelled, never resolved', async () => {
    const h = harness(PAA_V2);
    await shadowObserveSimulationPlan({ ...h.base, simulationType: 'MINI_MOCK' }, h.deps());
    expect(h.records[0]).toMatchObject({ purpose: 'UNMODELLED:MINI_MOCK', parity_status: 'MISSING_CONTEXT', v2_blueprint_identity: null });
  });
});

// ---------------------------------------------------------------------------
describe('T4 / T5 / T6 -- purposes do not leak', () => {
  it('component practice -> COMPONENT_TRAINING(COMPONENT p1)', async () => {
    const h = harness(IB_MATH_AA_HL_V2);
    await shadowObserveFormInputs({ ...h.base, mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: [h.idOf('p1')] }, h.deps());
    expect(h.records[0]).toMatchObject({ purpose: 'COMPONENT_TRAINING', scope: 'COMPONENT(p1)', parity_status: 'MATCH' });
    expect(h.records[0].v2_blueprint_identity).toMatch(/\|COMPONENT_TRAINING\|COMPONENT\(p1\)\|/);
  });
  it('diagnostic (purpose read from the instance) resolves DIAGNOSTIC, not a mock', async () => {
    const h = harness(IB_MATH_AA_HL_V2, { purposes: { 'inst-d': 'DIAGNOSTIC' } });
    await shadowObserveFormInputs({ ...h.base, instanceId: 'inst-d', mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: h.components.map((c) => c.id) }, h.deps());
    expect(h.records[0]).toMatchObject({ flow: 'STUDENT_DIAGNOSTIC', purpose: 'DIAGNOSTIC', parity_status: 'MATCH' });
    expect(h.records[0].reasons).toContain('PURPOSE_FROM_INSTANCE_STORAGE');
    expect(h.records[0].v2_blueprint_identity).not.toMatch(/MOCK/);
  });
  it('practice resolves PRACTICE, not a mock', async () => {
    const h = harness(IB_MATH_AA_HL_V2);
    await shadowObserveFormInputs({ ...h.base, mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: h.components.map((c) => c.id) }, h.deps());
    expect(h.records[0].v2_blueprint_identity).toMatch(/\|PRACTICE\|ENTIRE_ASSESSMENT\|/);
  });
});

// ---------------------------------------------------------------------------
describe('T7 -- an AICE route is never invented', () => {
  it('9709 A {p1,p3,p4,p5}: staged and linear -> MISSING_CONTEXT, ROUTE_NOT_STORED', async () => {
    const h = harness(AICE_9709_A);
    await shadowObserveFormInputs({ ...h.base, mode: 'MOCK', runtimeUse: 'REDUCED_MOCK', selectedComponentIds: ['p1', 'p3', 'p4', 'p5'].map(h.idOf) }, h.deps());
    expect(h.records[0]).toMatchObject({ parity_status: 'MISSING_CONTEXT', route_presence: 'ROUTE_NOT_STORED', v2_blueprint_identity: null });
    expect(h.records[0].reasons).toContain('SET_BELONGS_TO_2_ROUTES');
  });
  it('9709 AS {p1,p4}: one official option -> route derivable but not persisted; matches without choosing', async () => {
    const h = harness(AICE_9709_AS);
    await shadowObserveFormInputs({ ...h.base, mode: 'MOCK', runtimeUse: 'REDUCED_MOCK', selectedComponentIds: ['p1', 'p4'].map(h.idOf) }, h.deps());
    expect(h.records[0]).toMatchObject({ parity_status: 'MATCH', route_presence: 'ROUTE_AVAILABLE_NOT_PROPAGATED' });
  });
  it('a stage of a staged route has no V2 variant: LEGACY_ONLY, flagged STAGE_OF_STAGED_ROUTE', async () => {
    const h = harness(AICE_9709_A);
    await shadowObserveFormInputs({ ...h.base, mode: 'MOCK', runtimeUse: 'REDUCED_MOCK', selectedComponentIds: ['p1', 'p4'].map(h.idOf) }, h.deps());
    expect(h.records[0]).toMatchObject({ parity_status: 'LEGACY_ONLY', route_presence: 'ROUTE_AVAILABLE_NOT_PROPAGATED' });
    expect(h.records[0].reasons).toContain('STAGE_OF_STAGED_ROUTE');
  });
});

// ---------------------------------------------------------------------------
describe('T8 -- Visual Arts: legacy mock, structurally unsupported', () => {
  it('LEGACY_ONLY + STRUCTURAL_FULL_MOCK_UNSUPPORTED', async () => {
    const h = harness(IB_VISUAL_ARTS_HL_V2);
    await shadowObserveFormInputs({ ...h.base, mode: 'MOCK', runtimeUse: 'REDUCED_MOCK', selectedComponentIds: h.components.map((c) => c.id) }, h.deps());
    expect(h.records[0].parity_status).toBe('LEGACY_ONLY');
    expect(h.records[0].reasons).toContain('STRUCTURAL_FULL_MOCK_UNSUPPORTED');
  });
});

// ---------------------------------------------------------------------------
describe('T10 -- canonical aliases are not merged', () => {
  it('the applied IB config resolves on its own structure (no IA borrowed from the generated alias)', async () => {
    const h = harness(IB_MATH_AA_HL_V2);
    await shadowObserveFormInputs({ ...h.base, mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: h.components.map((c) => c.id) }, h.deps());
    expect(h.records[0]).toMatchObject({ canonical_exam_identity: 'IB|ib-dp-math-aa|hl', parity_status: 'MATCH' });
    expect(h.records[0].v2_blueprint_identity!.startsWith('v2.ib.math-aa-hl|')).toBe(true);
    expect(CATALOG.variants.some((v) => v.identity.examDefinitionKey === 'v2.ib.s.math-aa-hl')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('T11 -- no PII in a record', () => {
  it('exact whitelist; instance and student ids never appear', async () => {
    const h = harness(IB_MATH_AA_HL_V2, { purposes: { 'inst-secret-42': 'DIAGNOSTIC' } });
    await shadowObserveFormInputs({ ...h.base, instanceId: 'inst-secret-42', mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: h.components.map((c) => c.id) }, h.deps());
    expect(Object.keys(h.records[0]).sort()).toEqual([...RUNTIME_SHADOW_RECORD_KEYS].sort());
    expect(JSON.stringify(h.records[0])).not.toMatch(/inst-secret-42|studentId|student-\d|email|[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}|"name"|"score"|"responses?"/i);
  });
});

// ---------------------------------------------------------------------------
const CALC: DeclaredVariantInput[] = [
  { purpose: 'COMPONENT_TRAINING', scope: { type: 'COMPONENT', componentKey: 'p1' }, variant: { key: 'no-calculator', dimension: 'CALCULATOR', reason: 'practice without technology' }, provenance: provenance('INSTITUTION_SUPPLIED', ['test-fixture-institution']) },
  { purpose: 'COMPONENT_TRAINING', scope: { type: 'COMPONENT', componentKey: 'p1' }, variant: { key: 'with-gdc', dimension: 'CALCULATOR', reason: 'same content with a GDC' }, provenance: provenance('INSTITUTION_SUPPLIED', ['test-fixture-institution']), config: { ...IB_MATH_AA_HL_V2, sections: IB_MATH_AA_HL_V2.sections.map((s) => (s.key === 'p1' ? { ...s, definition: { ...s.definition!, calculatorPolicy: 'GDC_REQUIRED' as const } } : s)) } },
];

describe('T13 / T14 -- frozen-context dry run in memory', () => {
  it('a unique resolution freezes (integrity OK) and is discarded', async () => {
    const h = harness(IB_MATH_AA_HL_V2);
    await shadowObserveFormInputs({ ...h.base, mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: [h.idOf('p2')] }, h.deps());
    expect(h.records[0].reasons).toContain('FROZEN_DRY_RUN_OK');
  });
  it('an ambiguous resolution is not frozen', async () => {
    const ambiguous: ShadowCatalog = { ...CATALOG, variants: [...CATALOG.variants.filter((v) => !(v.identity.examDefinitionKey === IB_MATH_AA_HL_V2.key && v.identity.purpose === 'COMPONENT_TRAINING')), ...compileBlueprintVariants(IB_MATH_AA_HL_V2, { declared: CALC, deriveFromConfig: false }).variants] };
    const h = harness(IB_MATH_AA_HL_V2, { catalog: ambiguous });
    await shadowObserveFormInputs({ ...h.base, mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: [h.idOf('p1')] }, h.deps());
    expect(h.records[0]).toMatchObject({ parity_status: 'AMBIGUOUS_V2', v2_blueprint_identity: null });
    expect(h.records[0].reasons).toContain('FROZEN_DRY_RUN_SKIPPED: AMBIGUOUS');
  });
});

// ---------------------------------------------------------------------------
describe('T16 -- candidate order does not change the record', () => {
  it('reversed / rotated catalogue -> identical records', async () => {
    const run = async (variants: ShadowCatalog['variants']) => {
      const h = harness(AICE_9709_AS, { catalog: { ...CATALOG, variants } });
      await shadowObserveFormInputs({ ...h.base, mode: 'MOCK', runtimeUse: 'REDUCED_MOCK', selectedComponentIds: ['p1', 'p5'].map(h.idOf) }, h.deps());
      return h.records[0];
    };
    const a = await run(CATALOG.variants);
    expect(await run([...CATALOG.variants].reverse())).toEqual(a);
    expect(await run([...CATALOG.variants.slice(7), ...CATALOG.variants.slice(0, 7)])).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
describe('T17 -- no Student runtime consumes a shadow selection', () => {
  const root = path.resolve(__dirname, '../../src');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') || e.name.endsWith('.tsx') ? [path.join(dir, e.name)] : []));
  const outside = walk(root).filter((f) => !f.includes(`${path.sep}blueprint-v2${path.sep}`));
  it('only two runtime files reach the hooks, and they discard the (void) result', () => {
    const users = outside.filter((f) => /blueprint-v2/.test(readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(root, f)).sort()).toEqual(['lib/exam-core/exam-instance.service.ts', 'lib/simulation/plan.service.ts']);
    for (const f of users) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/=\s*await\s+shadowObserve/);
      expect(src).not.toMatch(/resolveBlueprint|selectedBlueprint|v2Resolution|compareLegacyAndV2/);
      expect(src).toMatch(/blueprintV2Mode\(\) === 'SHADOW'/);
    }
  });
  it('the hooks resolve to void', async () => {
    const h = harness(PAA_V2);
    await expect(shadowObserveFormInputs({ ...h.base, mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: [] }, h.deps())).resolves.toBeUndefined();
    await expect(shadowObserveFormInputs({ ...h.base, mode: 'PRACTICE', runtimeUse: 'PRACTICE', selectedComponentIds: [] }, { ...h.deps(), catalog: async () => { throw new Error('boom'); } })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('runtime parity over the applied catalogue (through the real hooks)', () => {
  it('counts are reported truthfully', async () => {
    const r = await runRuntimeShadowParity([...allV2Configs(), ...DEV_CERT_VERTICALS]);
    expect(r.records).toHaveLength(282);
    expect(r.notOfferedByRuntime).toHaveLength(50);
    // Saber 11 V2.1 (QB 802d9be): its F9 Full Mock now resolves (174 -> 175).
    expect(r.byResolutionStatus).toEqual({ SINGLE_COMPATIBLE_MATCH: 175, NO_MATCH: 56, MISSING_CONTEXT: 51 });
    expect(r.records.filter((x) => x.parity_status === 'MATCH').every((x) => x.reasons.includes('FROZEN_DRY_RUN_OK') && x.v2_structure_fingerprint === x.legacy_structure_fingerprint)).toBe(true);
    for (const x of r.records) expect(Object.keys(x).sort()).toEqual([...RUNTIME_SHADOW_RECORD_KEYS].sort());
  });
});
