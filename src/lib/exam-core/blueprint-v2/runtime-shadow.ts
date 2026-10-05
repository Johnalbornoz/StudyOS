/**
 * Blueprint Engine V2 / BP-3 -- runtime resolution context + SHADOW adapter.
 *
 * The legacy runtime stays authoritative: every flow keeps using
 * `getBlueprintForVersion(versionId)` (rows[0], safe only while
 * assessment_blueprints.exam_version_id is UNIQUE). This module only
 * OBSERVES: it states the explicit context a flow WOULD resolve with,
 * resolves it with the BP-2 resolver, and compares the result with the
 * legacy blueprint. It never feeds anything back into a Student path.
 *
 * Flag (env, like QUESTION_BANK_READINESS_MODE): EXAM_BLUEPRINT_V2 =
 *   OFF    (default; any other value)  nothing is computed
 *   SHADOW                             compute + compare + emit a record
 * There is no cutover mode in BP-3, and the flag is not set in any hosted env.
 *
 * No silent V2 selection: AMBIGUOUS / MISSING_CONTEXT / NO_MATCH are
 * recorded as such -- no first candidate, no fallback to GENERAL, no route,
 * session or specification chosen on the flow's behalf.
 */
import { hashCanonical } from '../scoring/scoring-policy';
import { deriveBlueprintCells, type BlueprintTargetInput, type ComponentInput } from '../question-bank/cells';
import { runtimeShapeOf } from './parity';
import { resolveBlueprint, type BlueprintCatalog, type BlueprintResolution, type ResolveBlueprintRequest } from './resolver';
import { scopeKey, type BlueprintPurpose, type BlueprintScope, type BlueprintVariantV2 } from './variant';
import type { BlueprintV2 } from './schema';

// ---------------------------------------------------------------------------
// 1. Runtime resolution context
// ---------------------------------------------------------------------------

export const SOURCE_FLOWS = [
  'STUDENT_EXAM_INSTANCE',
  'STUDENT_FULL_MOCK_REQUEST',
  'STUDENT_DIAGNOSTIC',
  'SIMULATION_PLAN',
  'EXAM_ATTEMPT',
  'READINESS',
  'ELIGIBILITY',
  'FULL_MOCK_GUARD',
  'ADMIN_QB_HEALTH',
  'FACTORY',
  'QB_CERTIFICATION',
] as const;
export type SourceFlow = (typeof SOURCE_FLOWS)[number];

/**
 * Everything needed to resolve ONE blueprint, nothing more (no labels, no
 * student). `examVersionId` anchors the legacy comparison only.
 */
export interface RuntimeBlueprintContext {
  examVersionId: string;
  examDefinitionKey: string;
  /** Explicit, or derived with authority (e.g. from a session). null = MISSING_CONTEXT. */
  specificationKey: string | null;
  purpose: BlueprintPurpose;
  scope?: BlueprintScope;
  route?: { routeKey: string; componentSet?: string[] };
  sessionKey?: string;
  variantKey?: string;
  /** The components the flow actually uses, when it records them but not a route key. */
  componentKeys?: string[];
  sourceFlow: SourceFlow;
}

export function toResolveRequest(ctx: RuntimeBlueprintContext): ResolveBlueprintRequest {
  return { examDefinitionKey: ctx.examDefinitionKey, specificationKey: ctx.specificationKey, purpose: ctx.purpose, scope: ctx.scope, route: ctx.route, sessionKey: ctx.sessionKey, variantKey: ctx.variantKey, componentKeys: ctx.componentKeys };
}

/**
 * Student exam instance (exam_instances): the explicit purpose / scope for the
 * runtime's own mode, purpose and component selection. Never infers a route
 * or a session the runtime did not record.
 *
 *  - purpose DIAGNOSTIC          -> DIAGNOSTIC
 *  - PRACTICE, one component     -> COMPONENT_TRAINING / COMPONENT(k)
 *  - PRACTICE, all components    -> PRACTICE / ENTIRE_ASSESSMENT
 *  - PRACTICE, several (not all) -> PRACTICE / CUSTOM_SUBSET (rationale: runtime selection)
 *  - MOCK / CHALLENGE            -> the runtime's own `use` (FULL_MOCK only when the runtime
 *                                   itself classified the form as full length, else REDUCED_MOCK)
 */
export function contextForStudentInstance(p: {
  examVersionId: string;
  examDefinitionKey: string;
  specificationKey: string | null;
  mode: 'PRACTICE' | 'MOCK' | 'CHALLENGE';
  instancePurpose: 'DIAGNOSTIC' | null;
  componentKeys: string[];
  allComponentKeys: string[];
  runtimeUse?: 'FULL_MOCK' | 'REDUCED_MOCK';
  /** The version declares official routes: a mock is then route-scoped and the whole-exam scope does not apply. */
  examHasRoutes?: boolean;
  route?: { routeKey: string; componentSet?: string[] };
  sessionKey?: string;
}): RuntimeBlueprintContext {
  const all = p.componentKeys.length === p.allComponentKeys.length && p.allComponentKeys.every((k) => p.componentKeys.includes(k));
  const base = { examVersionId: p.examVersionId, examDefinitionKey: p.examDefinitionKey, specificationKey: p.specificationKey, sessionKey: p.sessionKey };
  const subset: BlueprintScope = p.componentKeys.length === 1 ? { type: 'COMPONENT', componentKey: p.componentKeys[0] } : { type: 'CUSTOM_SUBSET', componentKeys: [...p.componentKeys].sort(), rationale: 'component selection recorded by the runtime instance' };
  if (p.instancePurpose === 'DIAGNOSTIC') return { ...base, purpose: 'DIAGNOSTIC', scope: all ? { type: 'ENTIRE_ASSESSMENT' } : subset, sourceFlow: 'STUDENT_DIAGNOSTIC' };
  if (p.mode === 'PRACTICE') {
    if (all) return { ...base, purpose: 'PRACTICE', scope: { type: 'ENTIRE_ASSESSMENT' }, sourceFlow: 'STUDENT_EXAM_INSTANCE' };
    return { ...base, purpose: p.componentKeys.length === 1 ? 'COMPONENT_TRAINING' : 'PRACTICE', scope: subset, sourceFlow: 'STUDENT_EXAM_INSTANCE' };
  }
  const purpose: BlueprintPurpose = p.runtimeUse === 'FULL_MOCK' ? 'FULL_MOCK' : 'REDUCED_MOCK';
  if (p.route) return { ...base, purpose, route: p.route, sourceFlow: 'STUDENT_EXAM_INSTANCE' };
  // The runtime records component_ids, never a route key: for a routed exam the scope stays open and the component
  // set is passed as a constraint (the resolver reports MISSING_CONTEXT when that set belongs to several routes).
  if (p.examHasRoutes) return { ...base, purpose, componentKeys: [...p.componentKeys].sort(), sourceFlow: 'STUDENT_EXAM_INSTANCE' };
  return { ...base, purpose, ...(all ? { scope: { type: 'ENTIRE_ASSESSMENT' as const } } : {}), sourceFlow: 'STUDENT_EXAM_INSTANCE' };
}

/** A Student explicitly asking for the complete exam. Never satisfied by a reduced form. */
export function contextForFullMockRequest(p: { examVersionId: string; examDefinitionKey: string; specificationKey: string | null; route?: { routeKey: string; componentSet?: string[] }; sessionKey?: string }): RuntimeBlueprintContext {
  return { examVersionId: p.examVersionId, examDefinitionKey: p.examDefinitionKey, specificationKey: p.specificationKey, purpose: 'FULL_MOCK', route: p.route, sessionKey: p.sessionKey, sourceFlow: 'STUDENT_FULL_MOCK_REQUEST' };
}

/** Admin / factory / QB health: the purpose is REQUIRED -- no "first blueprint of the version". */
export function contextForOperations(p: { sourceFlow: 'ADMIN_QB_HEALTH' | 'FACTORY'; examVersionId: string; examDefinitionKey: string; specificationKey: string | null; purpose: BlueprintPurpose; scope: BlueprintScope; variantKey?: string }): RuntimeBlueprintContext {
  return { ...p };
}

/** Question Bank certification targets ONE exact blueprint identity. */
export function contextForQbCertification(p: { examVersionId: string; examDefinitionKey: string; specificationKey: string; purpose: BlueprintPurpose; scope: BlueprintScope; variantKey: string; route?: { routeKey: string; componentSet: string[] } }): RuntimeBlueprintContext {
  return { ...p, sourceFlow: 'QB_CERTIFICATION' };
}

// ---------------------------------------------------------------------------
// 2. Flag
// ---------------------------------------------------------------------------

export type BlueprintV2Mode = 'OFF' | 'SHADOW';
export function blueprintV2Mode(env: Record<string, string | undefined> = process.env): BlueprintV2Mode {
  return env.EXAM_BLUEPRINT_V2 === 'SHADOW' ? 'SHADOW' : 'OFF';
}

// ---------------------------------------------------------------------------
// 3. Legacy snapshot + a structure fingerprint both sides can compute
// ---------------------------------------------------------------------------

/** The blueprint the legacy runtime actually used, reduced to what can be compared. */
export interface LegacyBlueprintSnapshot {
  examVersionId: string;
  blueprintId: string;
  /** exam_definitions.config_key of the version. */
  configKey: string;
  /** Components the flow used (exam_instances.component_ids); all when the flow uses the whole version. */
  componentKeys: string[];
  /** cellStructureFingerprint of the legacy targets restricted to componentKeys. */
  cellStructureFingerprint: string;
}

/**
 * Hash of (cellKey, positions) for the given components -- computable from
 * legacy rows (blueprint_objective_targets via deriveBlueprintCells) and from
 * a Blueprint V2 document alike.
 */
export function cellStructureFingerprint(cells: ReadonlyArray<{ cellKey: string; positions: number }>, componentKeys: readonly string[]): string {
  const keep = cells.filter((c) => componentKeys.includes(c.cellKey.split('|')[0])).map((c) => [c.cellKey, c.positions] as const);
  return hashCanonical([...keep].sort((a, b) => a[0].localeCompare(b[0])));
}

export function v2CellStructureFingerprint(bp: BlueprintV2, componentKeys: readonly string[]): string {
  return cellStructureFingerprint(bp.components.flatMap((c) => c.cells.map((x) => ({ cellKey: x.cellKey, positions: x.positions }))), componentKeys);
}

/** From the rows the runtime reads (future hook): targets + components of the legacy blueprint. */
export function legacySnapshotFromRows(p: { examVersionId: string; blueprintId: string; configKey: string; targets: BlueprintTargetInput[]; components: ComponentInput[]; componentKeys?: string[] }): LegacyBlueprintSnapshot {
  const keys = p.componentKeys ?? p.components.map((c) => c.sectionKey);
  const cells = deriveBlueprintCells(p.targets, p.components).map((c) => ({ cellKey: c.cellKey, positions: c.reducedPositions }));
  return { examVersionId: p.examVersionId, blueprintId: p.blueprintId, configKey: p.configKey, componentKeys: keys, cellStructureFingerprint: cellStructureFingerprint(cells, keys) };
}

/** From a configuration (what the apply service writes) -- for the DB-less parity runner. */
export function legacySnapshotFromConfig(config: unknown, p: { examVersionId: string; blueprintId: string; componentKeys?: string[] }): LegacyBlueprintSnapshot {
  const shape = runtimeShapeOf(config);
  const keys = p.componentKeys ?? shape.components.map((c) => c.sectionKey);
  const configKey = (config as { key: string }).key;
  return { examVersionId: p.examVersionId, blueprintId: p.blueprintId, configKey, componentKeys: keys, cellStructureFingerprint: cellStructureFingerprint(shape.cells.map((c) => ({ cellKey: c.cellKey, positions: c.reducedPositions })), keys) };
}

// ---------------------------------------------------------------------------
// 4. Comparison
// ---------------------------------------------------------------------------

export const PARITY_STATUSES = [
  'MATCH',
  'MATCH_STRUCTURE_DIFFERENT_IDENTITY',
  'STRUCTURAL_MISMATCH',
  'LEGACY_ONLY',
  'V2_ONLY',
  'AMBIGUOUS_V2',
  'MISSING_CONTEXT',
  'NO_BLUEPRINT',
] as const;
export type ParityStatus = (typeof PARITY_STATUSES)[number];

export interface ShadowComparison {
  legacyBlueprint: LegacyBlueprintSnapshot | null;
  v2Resolution: BlueprintResolution;
  v2Selected: { identityKey: string; structureFingerprint: string; cellStructureFingerprint: string } | null;
  parityStatus: ParityStatus;
  reasons: string[];
  ambiguity: { identityKeys: string[] } | null;
  missingContext: string[];
}

export function compareLegacyAndV2BlueprintResolution(ctx: RuntimeBlueprintContext, legacy: LegacyBlueprintSnapshot | null, catalog: BlueprintCatalog): ShadowComparison {
  const v2 = resolveBlueprint(catalog, toResolveRequest(ctx));
  const base = { legacyBlueprint: legacy, v2Resolution: v2, missingContext: v2.missingInformation, ambiguity: v2.status === 'AMBIGUOUS' ? { identityKeys: v2.conflicts.flatMap((c) => c.identityKeys) } : null };
  if (v2.status === 'MISSING_CONTEXT') return { ...base, v2Selected: null, parityStatus: 'MISSING_CONTEXT', reasons: v2.reasons };
  if (v2.status === 'AMBIGUOUS') return { ...base, v2Selected: null, parityStatus: 'AMBIGUOUS_V2', reasons: v2.reasons };
  if (!v2.selected) return { ...base, v2Selected: null, parityStatus: legacy ? 'LEGACY_ONLY' : 'NO_BLUEPRINT', reasons: v2.reasons };
  const sel: BlueprintVariantV2 = v2.selected;
  const v2Cells = v2CellStructureFingerprint(sel.blueprint, sel.componentKeys);
  const v2Selected = { identityKey: sel.identityKey, structureFingerprint: sel.structureFingerprint, cellStructureFingerprint: v2Cells };
  if (!legacy) return { ...base, v2Selected, parityStatus: 'V2_ONLY', reasons: ['no legacy blueprint for this version'] };
  const sameCells = legacy.cellStructureFingerprint === v2Cells && [...legacy.componentKeys].sort().join('+') === [...sel.componentKeys].sort().join('+');
  if (!sameCells) return { ...base, v2Selected, parityStatus: 'STRUCTURAL_MISMATCH', reasons: [`legacy components ${legacy.componentKeys.join('+')} vs V2 ${scopeKey(sel.identity.scope)}`] };
  if (sel.identity.examDefinitionKey !== legacy.configKey) return { ...base, v2Selected, parityStatus: 'MATCH_STRUCTURE_DIFFERENT_IDENTITY', reasons: [`same structure, V2 identity from ${sel.identity.examDefinitionKey}`] };
  return { ...base, v2Selected, parityStatus: 'MATCH', reasons: [] };
}

// ---------------------------------------------------------------------------
// 5. Shadow record (debug-safe: no student, no instance id, no free text from the request)
// ---------------------------------------------------------------------------

export interface ShadowRecord {
  exam_version_id: string;
  canonical_exam_identity: string | null;
  source_flow: SourceFlow;
  purpose: BlueprintPurpose;
  scope: string | null;
  legacy_blueprint_id: string | null;
  v2_resolution_status: BlueprintResolution['status'];
  v2_blueprint_identity: string | null;
  legacy_structure_fingerprint: string | null;
  v2_structure_fingerprint: string | null;
  parity_status: ParityStatus;
  reasons: string[];
}

export const SHADOW_RECORD_KEYS: ReadonlyArray<keyof ShadowRecord> = ['exam_version_id', 'canonical_exam_identity', 'source_flow', 'purpose', 'scope', 'legacy_blueprint_id', 'v2_resolution_status', 'v2_blueprint_identity', 'legacy_structure_fingerprint', 'v2_structure_fingerprint', 'parity_status', 'reasons'];

export function toShadowRecord(ctx: RuntimeBlueprintContext, cmp: ShadowComparison, canonicalExamIdentity: string | null): ShadowRecord {
  return {
    exam_version_id: ctx.examVersionId,
    canonical_exam_identity: canonicalExamIdentity,
    source_flow: ctx.sourceFlow,
    purpose: ctx.purpose,
    scope: ctx.scope ? scopeKey(ctx.scope) : null,
    legacy_blueprint_id: cmp.legacyBlueprint?.blueprintId ?? null,
    v2_resolution_status: cmp.v2Resolution.status,
    v2_blueprint_identity: cmp.v2Selected?.identityKey ?? null,
    legacy_structure_fingerprint: cmp.legacyBlueprint?.cellStructureFingerprint ?? null,
    v2_structure_fingerprint: cmp.v2Selected?.cellStructureFingerprint ?? null,
    parity_status: cmp.parityStatus,
    // Only resolver reason codes (no user-entered text reaches them).
    reasons: [...cmp.reasons].slice(0, 10),
  };
}

/**
 * The hook a flow will call (BP-4 Phase A). OFF: returns immediately, nothing
 * computed. SHADOW: compares and hands one record to `sink`. It returns
 * nothing the caller could use, never throws, and never changes the legacy
 * selection.
 */
export function observeBlueprintSelection(
  ctx: RuntimeBlueprintContext,
  legacy: LegacyBlueprintSnapshot | null,
  deps: { catalog: () => BlueprintCatalog; canonicalExamIdentity?: (examDefinitionKey: string) => string | null; sink: (r: ShadowRecord) => void; env?: Record<string, string | undefined> }
): void {
  if (blueprintV2Mode(deps.env) !== 'SHADOW') return;
  try {
    const cmp = compareLegacyAndV2BlueprintResolution(ctx, legacy, deps.catalog());
    deps.sink(toShadowRecord(ctx, cmp, deps.canonicalExamIdentity?.(ctx.examDefinitionKey) ?? null));
  } catch {
    // Shadow must never affect the flow.
  }
}

// ---------------------------------------------------------------------------
// 6. Frozen assessment context (proposal; nothing persists it yet)
// ---------------------------------------------------------------------------

export interface FrozenBlueprintContext {
  resolverVersion: 'blueprint-v2-bp3';
  sourceFlow: SourceFlow;
  examDefinitionKey: string;
  specificationKey: string;
  purpose: BlueprintPurpose;
  scope: string;
  route: { routeKey: string; componentSet: string[] } | null;
  sessionKey: string | null;
  variantIdentityKey: string;
  structureFingerprint: string;
  cellStructureFingerprint: string;
  /** The BP-0 document itself: the assessment is executed from this, never re-resolved. */
  blueprintFingerprint: string;
  frozenFingerprint: string;
}

/** Freezes ONE resolved blueprint for an assessment. Only a single, selected resolution can be frozen. */
export function freezeBlueprintResolution(ctx: RuntimeBlueprintContext, resolution: BlueprintResolution): { frozen: FrozenBlueprintContext } | { error: string } {
  if (!resolution.selected) return { error: `cannot freeze a ${resolution.status} resolution` };
  const v = resolution.selected;
  const body: Omit<FrozenBlueprintContext, 'frozenFingerprint'> = {
    resolverVersion: 'blueprint-v2-bp3',
    sourceFlow: ctx.sourceFlow,
    examDefinitionKey: v.identity.examDefinitionKey,
    specificationKey: v.identity.specificationKey!,
    purpose: v.identity.purpose,
    scope: scopeKey(v.identity.scope),
    route: v.identity.scope.type === 'ROUTE' ? { routeKey: v.identity.scope.routeKey, componentSet: [...v.identity.scope.componentSet].sort() } : null,
    sessionKey: ctx.sessionKey ?? null,
    variantIdentityKey: v.identityKey,
    structureFingerprint: v.structureFingerprint,
    cellStructureFingerprint: v2CellStructureFingerprint(v.blueprint, v.componentKeys),
    blueprintFingerprint: v.blueprint.fingerprint,
  };
  return { frozen: { ...body, frozenFingerprint: hashCanonical(body) } };
}

/**
 * After the attempt starts the frozen context is authoritative. Catalog drift
 * is REPORTED, never applied.
 */
export function checkFrozenContext(frozen: FrozenBlueprintContext, catalog: BlueprintCatalog): { frozenRemainsAuthoritative: true; intact: boolean; catalogStatus: 'UNCHANGED' | 'VARIANT_STRUCTURE_CHANGED' | 'VARIANT_REMOVED' } {
  const { frozenFingerprint, ...body } = frozen;
  const intact = hashCanonical(body) === frozenFingerprint;
  const now = catalog.variants.find((v) => v.identityKey === frozen.variantIdentityKey);
  const catalogStatus = !now ? 'VARIANT_REMOVED' : now.structureFingerprint !== frozen.structureFingerprint ? 'VARIANT_STRUCTURE_CHANGED' : 'UNCHANGED';
  return { frozenRemainsAuthoritative: true, intact, catalogStatus };
}
