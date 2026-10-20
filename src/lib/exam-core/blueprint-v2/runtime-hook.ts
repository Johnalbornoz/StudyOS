/**
 * Blueprint Engine V2 / BP-4A -- runtime SHADOW hooks wired into real flows.
 *
 * LEGACY REMAINS AUTHORITATIVE. The flows keep `getBlueprintForVersion` and
 * every existing selection. These hooks only observe:
 *
 *   flag OFF (default)  -> return immediately: no import of the catalogue, no DB read, no computation;
 *   flag SHADOW         -> build the explicit RuntimeBlueprintContext, resolve with V2, compare with the
 *                          legacy blueprint, dry-run a frozen context in memory (then discard it) and emit
 *                          ONE whitelisted record.
 *
 * Hooks return Promise<void>: nothing a flow could consume. They never throw
 * and never touch the objects the flow passes downstream (they read copies of
 * ids only). Extra reads happen only in SHADOW and are read-only.
 *
 * Context is never invented: no route is chosen, no session assumed, no
 * purpose derived from labels. When the runtime does not hold a piece of
 * context the record says why (ROUTE_NOT_STORED vs ROUTE_AVAILABLE_NOT_PROPAGATED,
 * SESSION_NOT_STORED, PURPOSE_FROM_INSTANCE_STORAGE, ...).
 *
 * Content readiness is not read here: structural capability only.
 */
import type { BlueprintTargetInput, ComponentInput } from '../question-bank/cells';
import type { BlueprintCatalog } from './resolver';
import type { BlueprintVariantV2 } from './variant';
import type { BlueprintV2 } from './schema';
import type { ExamDefinitionV2 } from './exam-definition';
import {
  blueprintV2Mode,
  checkFrozenContext,
  compareLegacyAndV2BlueprintResolution,
  contextForFullMockRequest,
  contextForStudentInstance,
  freezeBlueprintResolution,
  legacySnapshotFromRows,
  type RuntimeBlueprintContext,
  type ShadowComparison,
} from './runtime-shadow';
import { scopeKey } from './variant';
import type { StructuralFullMockStatus } from './structural-diagnostics';
import type { SlotConstraint } from '../slot-constraints';

// ---------------------------------------------------------------------------
// The record (BP-4A whitelist)
// ---------------------------------------------------------------------------

export type RoutePresence = 'NOT_APPLICABLE' | 'PROVIDED' | 'ROUTE_AVAILABLE_NOT_PROPAGATED' | 'ROUTE_NOT_STORED';
export type SessionPresence = 'NOT_REQUIRED' | 'SESSION_NOT_STORED';

export interface RuntimeShadowRecord {
  flow: string;
  exam_version_id: string;
  canonical_exam_identity: string | null;
  specification: string | null;
  purpose: string;
  scope: string | null;
  route_presence: RoutePresence;
  session_presence: SessionPresence;
  legacy_blueprint_id: string | null;
  legacy_structure_fingerprint: string | null;
  v2_resolution_status: string;
  v2_blueprint_identity: string | null;
  v2_structure_fingerprint: string | null;
  parity_status: string;
  reasons: string[];
}

export const RUNTIME_SHADOW_RECORD_KEYS: ReadonlyArray<keyof RuntimeShadowRecord> = [
  'flow', 'exam_version_id', 'canonical_exam_identity', 'specification', 'purpose', 'scope', 'route_presence', 'session_presence',
  'legacy_blueprint_id', 'legacy_structure_fingerprint', 'v2_resolution_status', 'v2_blueprint_identity', 'v2_structure_fingerprint', 'parity_status', 'reasons',
];

// ---------------------------------------------------------------------------
// Dependencies (injectable; production defaults below)
// ---------------------------------------------------------------------------

/** Read-only lookups the hooks need in SHADOW. Never student data, never content readiness. */
export interface ShadowStore {
  /** exam_definitions.config_key + the configFingerprint the version was applied with. */
  versionIdentity(examVersionId: string): Promise<{ configKey: string | null; configFingerprint: string | null } | null>;
  objectiveCodes(ids: string[]): Promise<Map<string, string>>;
  commandTerms(ids: string[]): Promise<Map<string, string>>;
  /** exam_instances.purpose (e.g. DIAGNOSTIC) -- persisted, but not loaded into ExamInstance. */
  instancePurpose(instanceId: string): Promise<string | null>;
}

export interface ShadowCatalogExam {
  definition: ExamDefinitionV2;
  general: BlueprintV2;
  specificationKey: string | null;
  configFingerprint: string | null;
  canonicalKey: string | null;
  structuralFullMock: StructuralFullMockStatus;
}

export interface ShadowCatalog extends BlueprintCatalog {
  variants: BlueprintVariantV2[];
  exams: Map<string, ShadowCatalogExam>;
}

export interface ShadowDeps {
  env?: Record<string, string | undefined>;
  store?: ShadowStore;
  catalog?: () => Promise<ShadowCatalog>;
  sink?: (r: RuntimeShadowRecord) => void;
}

let catalogPromise: Promise<ShadowCatalog> | null = null;
/** Built once per process, only when SHADOW actually runs (dynamic import: OFF never loads the catalogue). */
export function defaultShadowCatalog(): Promise<ShadowCatalog> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [{ allV2Configs }, { DEV_CERT_VERTICALS }, bp] = await Promise.all([import('../verticals/v2/all'), import('../verticals'), import('./index')]);
      return bp.buildShadowCatalog([...allV2Configs(), ...DEV_CERT_VERTICALS]);
    })();
  }
  return catalogPromise;
}
export function shadowCatalogBuilt(): boolean {
  return catalogPromise !== null;
}

/** Read-only queries against the live tables (SHADOW only). */
export function dbShadowStore(): ShadowStore {
  const q = async (sql: string, params: unknown[]) => (await (await import('@/lib/db')).db.query(sql, params)).rows as any[];
  return {
    async versionIdentity(id) {
      const r = await q(`SELECT ed.config_key, ev.navigation_rules->>'configFingerprint' AS fp FROM exam_versions ev JOIN exam_definitions ed ON ed.id = ev.exam_definition_id WHERE ev.id = $1`, [id]);
      return r[0] ? { configKey: r[0].config_key ?? null, configFingerprint: r[0].fp ?? null } : null;
    },
    async objectiveCodes(ids) {
      const r = ids.length ? await q(`SELECT id, code FROM learning_objectives WHERE id = ANY($1::uuid[])`, [ids]) : [];
      return new Map(r.map((x) => [x.id, x.code]));
    },
    async commandTerms(ids) {
      const r = ids.length ? await q(`SELECT id, term FROM command_terms WHERE id = ANY($1::uuid[])`, [ids]) : [];
      return new Map(r.map((x) => [x.id, x.term]));
    },
    async instancePurpose(id) {
      const r = await q(`SELECT purpose FROM exam_instances WHERE id = $1`, [id]);
      return r[0]?.purpose ?? null;
    },
  };
}

export const consoleShadowSink = (r: RuntimeShadowRecord): void => {
  console.log('[blueprint_v2_shadow]', JSON.stringify({ at: 'blueprint_v2_shadow', ...r }));
};

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

export interface LegacyTargetRow {
  id: string;
  learningObjectiveId: string;
  assessmentComponentId: string;
  questionType: string | null;
  difficultyMin: number | null;
  difficultyMax: number | null;
  commandTermId: string | null;
  /** Structured slot requirements of the legacy row (blueprint_objective_targets.constraints, 20261102). */
  constraints?: SlotConstraint[];
}

async function legacyRows(store: ShadowStore, components: Array<{ id: string; sectionKey: string | null }>, targets: LegacyTargetRow[]) {
  const codes = await store.objectiveCodes([...new Set(targets.map((t) => t.learningObjectiveId))]);
  const terms = await store.commandTerms([...new Set(targets.map((t) => t.commandTermId).filter((x): x is string => !!x))]);
  const comps: ComponentInput[] = components.filter((c) => c.sectionKey).map((c, order) => ({ id: c.id, sectionKey: c.sectionKey!, name: c.sectionKey!, order, officialItemCount: null, maxMarks: null, simulationCapable: true }));
  const rows: BlueprintTargetInput[] = targets.map((t) => ({
    id: t.id,
    learningObjectiveId: t.learningObjectiveId,
    objectiveCode: codes.get(t.learningObjectiveId) ?? `unknown:${t.learningObjectiveId}`,
    assessmentComponentId: t.assessmentComponentId,
    questionType: t.questionType,
    difficultyMin: t.difficultyMin,
    difficultyMax: t.difficultyMax,
    commandTerm: t.commandTermId ? terms.get(t.commandTermId) ?? null : null,
    ...(t.constraints?.length ? { constraints: t.constraints } : {}),
  }));
  return { comps, rows };
}

function examFor(catalog: ShadowCatalog, identity: { configKey: string | null; configFingerprint: string | null } | null): { exam: ShadowCatalogExam | null; reasons: string[] } {
  if (!identity) return { exam: null, reasons: ['VERSION_NOT_FOUND'] };
  if (!identity.configKey) return { exam: null, reasons: ['NO_CONFIG_KEY'] };
  const exam = catalog.exams.get(identity.configKey) ?? null;
  if (!exam) return { exam: null, reasons: ['CONFIG_NOT_IN_CATALOG'] };
  // The DB version must be the one the catalogue configuration describes; otherwise its specification is not provable.
  if (identity.configFingerprint && exam.configFingerprint && identity.configFingerprint !== exam.configFingerprint) return { exam, reasons: ['VERSION_FINGERPRINT_NOT_IN_CATALOG'] };
  return { exam, reasons: [] };
}

function routePresence(exam: ShadowCatalogExam | null, mode: string, componentKeys: string[]): { presence: RoutePresence; reasons: string[] } {
  if (!exam || exam.general.routes.length === 0 || mode === 'PRACTICE') return { presence: 'NOT_APPLICABLE', reasons: [] };
  const key = [...componentKeys].sort().join('+');
  const options = exam.general.routes.flatMap((r) => [...r.componentSets.map((s) => ({ route: r.key, set: s, stage: false })), ...(r.stages ?? []).flat().map((s) => ({ route: r.key, set: s, stage: true }))]);
  const hits = options.filter((o) => [...o.set].sort().join('+') === key);
  const routes = new Set(hits.map((h) => h.route));
  const reasons: string[] = [];
  if (hits.some((h) => h.stage) && !hits.some((h) => !h.stage)) reasons.push('STAGE_OF_STAGED_ROUTE');
  if (routes.size === 1) return { presence: 'ROUTE_AVAILABLE_NOT_PROPAGATED', reasons: [...reasons, 'ROUTE_DERIVABLE_FROM_SELECTION_NOT_PERSISTED'] };
  if (routes.size > 1) return { presence: 'ROUTE_NOT_STORED', reasons: [...reasons, `SET_BELONGS_TO_${routes.size}_ROUTES`] };
  return { presence: 'ROUTE_NOT_STORED', reasons: [...reasons, 'SET_IS_NOT_AN_OFFICIAL_ROUTE_OPTION'] };
}

function sessionPresence(catalog: ShadowCatalog, examDefinitionKey: string): SessionPresence {
  return catalog.variants.some((v) => v.identity.examDefinitionKey === examDefinitionKey && v.sessionApplicability.type === 'SESSIONS') ? 'SESSION_NOT_STORED' : 'NOT_REQUIRED';
}

function emit(
  ctx: RuntimeBlueprintContext,
  cmp: ShadowComparison | null,
  extra: { flow: string; purposeLabel?: string; canonical: string | null; route: RoutePresence; session: SessionPresence; reasons: string[]; legacyBlueprintId: string | null; legacyFingerprint: string | null; exam: ShadowCatalogExam | null },
  sink: (r: RuntimeShadowRecord) => void
): void {
  const reasons = [...extra.reasons];
  if (cmp) {
    reasons.push(...cmp.reasons);
    if ((ctx.purpose === 'FULL_MOCK' || ctx.purpose === 'REDUCED_MOCK') && cmp.v2Resolution.status === 'NO_MATCH' && extra.exam?.structuralFullMock === 'STRUCTURAL_FULL_MOCK_UNSUPPORTED') reasons.push('STRUCTURAL_FULL_MOCK_UNSUPPORTED');
    // Frozen-context dry run: built in memory from a unique resolution, integrity-checked, discarded.
    const frozen = freezeBlueprintResolution(ctx, cmp.v2Resolution);
    if ('frozen' in frozen) reasons.push(checkFrozenContext(frozen.frozen, { variants: [cmp.v2Resolution.selected!] }).intact ? 'FROZEN_DRY_RUN_OK' : 'FROZEN_DRY_RUN_INTEGRITY_FAILED');
    else reasons.push(`FROZEN_DRY_RUN_SKIPPED: ${cmp.v2Resolution.status}`);
  }
  sink({
    flow: extra.flow,
    exam_version_id: ctx.examVersionId,
    canonical_exam_identity: extra.canonical,
    specification: ctx.specificationKey,
    purpose: extra.purposeLabel ?? ctx.purpose,
    scope: ctx.scope ? scopeKey(ctx.scope) : ctx.componentKeys ? `COMPONENTS(${[...ctx.componentKeys].sort().join('+')})` : null,
    route_presence: extra.route,
    session_presence: extra.session,
    legacy_blueprint_id: extra.legacyBlueprintId,
    legacy_structure_fingerprint: cmp?.legacyBlueprint?.cellStructureFingerprint ?? extra.legacyFingerprint,
    v2_resolution_status: cmp?.v2Resolution.status ?? 'MISSING_CONTEXT',
    v2_blueprint_identity: cmp?.v2Selected?.identityKey ?? null,
    v2_structure_fingerprint: cmp?.v2Selected?.cellStructureFingerprint ?? null,
    parity_status: cmp?.parityStatus ?? 'MISSING_CONTEXT',
    reasons: [...new Set(reasons)].slice(0, 12),
  });
}

// ---------------------------------------------------------------------------
// Hook 1: exam instance form inputs (exam-instance.service.ts formInputs)
// ---------------------------------------------------------------------------

export interface FormInputsShadowInput {
  examVersionId: string;
  legacyBlueprintId: string;
  mode: 'PRACTICE' | 'MOCK' | 'CHALLENGE';
  /** The runtime's own `use` (PRACTICE | FULL_MOCK | REDUCED_MOCK). */
  runtimeUse: string;
  selectedComponentIds: readonly string[];
  focusObjectiveIds: readonly string[];
  instanceId: string | null;
  components: ReadonlyArray<{ id: string; sectionKey?: string | null }>;
  /** All targets of the legacy blueprint (before the flow's own filtering). */
  allTargets: readonly LegacyTargetRow[];
}

export async function shadowObserveFormInputs(input: FormInputsShadowInput, deps: ShadowDeps = {}): Promise<void> {
  if (blueprintV2Mode(deps.env) !== 'SHADOW') return;
  try {
    const store = deps.store ?? dbShadowStore();
    const sink = deps.sink ?? consoleShadowSink;
    const catalog = await (deps.catalog ?? defaultShadowCatalog)();
    const { exam, reasons } = examFor(catalog, await store.versionIdentity(input.examVersionId));
    const comps = input.components.map((c) => ({ id: c.id, sectionKey: c.sectionKey ?? null }));
    const keyOf = new Map(comps.map((c) => [c.id, c.sectionKey]));
    const componentKeys = input.selectedComponentIds.map((id) => keyOf.get(id)).filter((k): k is string => !!k);
    const allComponentKeys = comps.map((c) => c.sectionKey).filter((k): k is string => !!k);
    const purposeStored = input.instanceId ? await store.instancePurpose(input.instanceId) : null;
    if (purposeStored === 'DIAGNOSTIC') reasons.push('PURPOSE_FROM_INSTANCE_STORAGE');
    if (input.focusObjectiveIds.length) reasons.push('FOCUS_OBJECTIVES_NOT_MODELLED');
    const examDefinitionKey = exam?.definition.identity.definitionKey ?? 'unknown';
    const specificationKey = exam && !reasons.includes('VERSION_FINGERPRINT_NOT_IN_CATALOG') ? exam.specificationKey : null;
    const route = routePresence(exam, input.mode, componentKeys);
    const ctx = contextForStudentInstance({
      examVersionId: input.examVersionId,
      examDefinitionKey,
      specificationKey,
      mode: input.mode,
      instancePurpose: purposeStored === 'DIAGNOSTIC' ? 'DIAGNOSTIC' : null,
      componentKeys,
      allComponentKeys,
      runtimeUse: input.runtimeUse === 'FULL_MOCK' ? 'FULL_MOCK' : 'REDUCED_MOCK',
      examHasRoutes: (exam?.general.routes.length ?? 0) > 0,
    });
    const { comps: legacyComps, rows } = await legacyRows(store, comps, [...input.allTargets]);
    const legacy = legacySnapshotFromRows({ examVersionId: input.examVersionId, blueprintId: input.legacyBlueprintId, configKey: examDefinitionKey, targets: rows, components: legacyComps, componentKeys });
    const cmp = compareLegacyAndV2BlueprintResolution(ctx, legacy, catalog);
    emit(ctx, cmp, { flow: ctx.sourceFlow, canonical: exam?.canonicalKey ?? null, route: route.presence, session: sessionPresence(catalog, examDefinitionKey), reasons: [...reasons, ...route.reasons], legacyBlueprintId: input.legacyBlueprintId, legacyFingerprint: legacy.cellStructureFingerprint, exam }, sink);
  } catch {
    // Shadow never affects the flow.
  }
}

// ---------------------------------------------------------------------------
// Hook 2: legacy F9 simulation plan (simulation/plan.service.ts), NOT instance-driven
// ---------------------------------------------------------------------------

export interface SimulationPlanShadowInput {
  examVersionId: string;
  legacyBlueprintId: string;
  simulationType: 'TOPIC_EXAM' | 'DOMAIN_EXAM' | 'MINI_MOCK' | 'FULL_MOCK';
  components: ReadonlyArray<{ id: string; sectionKey?: string | null }>;
  allTargets: readonly LegacyTargetRow[];
}

/**
 * The legacy F9 path (/api/simulation/attempts). FULL_MOCK is an explicit
 * Student request for the complete exam -> purpose FULL_MOCK over every
 * component the version has. TOPIC / DOMAIN / MINI_MOCK select by objective
 * or subject: no V2 purpose expresses them, so they are recorded as
 * MISSING_CONTEXT (FLOW_PURPOSE_NOT_MODELLED) without resolving anything.
 */
export async function shadowObserveSimulationPlan(input: SimulationPlanShadowInput, deps: ShadowDeps = {}): Promise<void> {
  if (blueprintV2Mode(deps.env) !== 'SHADOW') return;
  try {
    const store = deps.store ?? dbShadowStore();
    const sink = deps.sink ?? consoleShadowSink;
    const catalog = await (deps.catalog ?? defaultShadowCatalog)();
    const { exam, reasons } = examFor(catalog, await store.versionIdentity(input.examVersionId));
    const examDefinitionKey = exam?.definition.identity.definitionKey ?? 'unknown';
    const specificationKey = exam && !reasons.includes('VERSION_FINGERPRINT_NOT_IN_CATALOG') ? exam.specificationKey : null;
    const comps = input.components.map((c) => ({ id: c.id, sectionKey: c.sectionKey ?? null }));
    const allKeys = comps.map((c) => c.sectionKey).filter((k): k is string => !!k);
    const { comps: legacyComps, rows } = await legacyRows(store, comps, [...input.allTargets]);
    const legacy = legacySnapshotFromRows({ examVersionId: input.examVersionId, blueprintId: input.legacyBlueprintId, configKey: examDefinitionKey, targets: rows, components: legacyComps, componentKeys: allKeys });
    const routed = (exam?.general.routes.length ?? 0) > 0;
    if (input.simulationType !== 'FULL_MOCK') {
      // No V2 purpose expresses an objective / subject selection: nothing is resolved, and the record says so
      // (the context object only carries ids; its purpose field is never reported -- purposeLabel is).
      const ctx: RuntimeBlueprintContext = { examVersionId: input.examVersionId, examDefinitionKey, specificationKey, purpose: 'PRACTICE', sourceFlow: 'SIMULATION_PLAN' };
      emit(ctx, null, { flow: `SIMULATION_PLAN:${input.simulationType}`, purposeLabel: `UNMODELLED:${input.simulationType}`, canonical: exam?.canonicalKey ?? null, route: routed ? 'ROUTE_NOT_STORED' : 'NOT_APPLICABLE', session: sessionPresence(catalog, examDefinitionKey), reasons: [...reasons, `FLOW_PURPOSE_NOT_MODELLED: ${input.simulationType}`], legacyBlueprintId: input.legacyBlueprintId, legacyFingerprint: legacy.cellStructureFingerprint, exam }, sink);
      return;
    }
    // Every component of the version: a routed exam's "full mock" over ALL papers is not an official combination.
    const ctx = { ...contextForFullMockRequest({ examVersionId: input.examVersionId, examDefinitionKey, specificationKey }), ...(routed ? { componentKeys: allKeys } : { scope: { type: 'ENTIRE_ASSESSMENT' as const } }) };
    const cmp = compareLegacyAndV2BlueprintResolution(ctx, legacy, catalog);
    emit(ctx, cmp, { flow: 'SIMULATION_PLAN:FULL_MOCK', canonical: exam?.canonicalKey ?? null, route: routed ? 'ROUTE_NOT_STORED' : 'NOT_APPLICABLE', session: sessionPresence(catalog, examDefinitionKey), reasons: [...reasons, ...(routed ? ['ALL_COMPONENTS_OF_A_ROUTED_EXAM'] : [])], legacyBlueprintId: input.legacyBlueprintId, legacyFingerprint: legacy.cellStructureFingerprint, exam }, sink);
  } catch {
    // Shadow never affects the flow.
  }
}
