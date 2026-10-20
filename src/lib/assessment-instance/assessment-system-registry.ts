/**
 * QF V5.1 -- the Assessment System Registry: which assessment and curriculum systems exist, as REGISTERED DATA
 * (pure, no IO).
 *
 * The Question Factory knows no list of systems. A system -- an examination, a curriculum, a qualification, a
 * national standard, an institution's own model -- is a record someone registers, with its versions and the
 * contexts inside each version:
 *
 *   AssessmentSystem -> AssessmentSystemVersion -> Programme / Qualification -> Subject -> Level -> Component
 *
 * Nothing here names PAA, IB or any other system: the systems StudyUs knows today are registered as data in
 * `registered-systems.ts`, through exactly the calls a system added tomorrow would use. Adding a system is a
 * registration; it is never a change to this module, to the adapter contract, to the planner or to the renderer.
 *
 * A system is not its version. "IB first assessment 2027" or "SEP Plan 2022" is a VERSION of one system, with its
 * own effective dates; a rule belongs to a version, and an adapter is always the adapter of one version.
 *
 * The EA-1 pair AssessmentSystemProfile + AssessmentComponentProfile stays the one definition of an adapter's
 * rules. The registry does not restate them: it says which registered system and version a profile pair belongs
 * to, and refuses a pair that belongs to none.
 */
import { z } from 'zod';
import type { AssessmentComponentProfile, AssessmentSystemProfile } from '@/lib/assessment-adaptation/assessment-system-profile';
import { adapterOfComponent, type AssessmentAdapter } from './assessment-adapter';

export const ASSESSMENT_SYSTEM_REGISTRY_CONTRACT_VERSION = 1 as const;

/** What kind of thing a system is. Open to combination: a qualification that is also examined is HYBRID. */
export const ASSESSMENT_SYSTEM_TYPES = ['EXAM', 'CURRICULUM', 'QUALIFICATION', 'NATIONAL_STANDARD', 'INSTITUTIONAL', 'HYBRID'] as const;
export type AssessmentSystemType = (typeof ASSESSMENT_SYSTEM_TYPES)[number];
/**
 * Kinds of system whose assessments are EXAMINED: sat individually, under the system's own conditions. This, read
 * from the registered system, is what makes a system "an exam" for V5.1 -- never the presence of a code in the
 * legacy exam-family taxonomy. A curriculum, a national standard or an institution's model is not examined in
 * this sense: its tasks may be collaborative and follow the institution's learning approach.
 */
export const EXAMINED_SYSTEM_TYPES: readonly AssessmentSystemType[] = ['EXAM', 'QUALIFICATION', 'HYBRID'];
export const isExaminedSystemType = (t: AssessmentSystemType): boolean => EXAMINED_SYSTEM_TYPES.includes(t);
export const SYSTEM_LIFECYCLES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type SystemLifecycle = (typeof SYSTEM_LIFECYCLES)[number];
/** The levels of context inside a version. A system uses the ones it has; none is mandatory except COMPONENT for an adapter. */
export const CONTEXT_KINDS = ['PROGRAMME', 'QUALIFICATION', 'SUBJECT', 'LEVEL', 'COMPONENT'] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

const TEXT = z.string().trim().min(1).max(300);
/** Same shape as an EA-1 system profile id, so that a registered system and its rule profile share one id. */
const SYSTEM_ID = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'SYSTEM_ID_FORMAT');
const VERSION_ID = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'VERSION_ID_FORMAT').max(80);
const NODE_ID = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}(\.[A-Z0-9_]{1,40}){1,4}$/, 'NODE_ID_FORMAT');
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO_DATE');
const ProvenanceSchema = z.strictObject({
  /** Who says this system / version is what the record says. */
  basis: z.enum(['OFFICIAL_SOURCE', 'STUDYUS_POLICY', 'INSTITUTION_POLICY', 'TEST_FIXTURE']),
  sources: z.array(TEXT).max(12),
  recordedBy: TEXT,
});

export const AssessmentSystemSchema = z.strictObject({
  v: z.literal(ASSESSMENT_SYSTEM_REGISTRY_CONTRACT_VERSION),
  systemId: SYSTEM_ID,
  displayName: TEXT,
  /** The body that owns the system: an examination board, a ministry, an institution. */
  organization: TEXT,
  /** ISO 3166 code, a region name, or null for an international system. */
  region: TEXT.nullable(),
  systemType: z.enum(ASSESSMENT_SYSTEM_TYPES),
  lifecycle: z.enum(SYSTEM_LIFECYCLES),
  /** Free, system-specific facts (legacy codes, aliases). Never read by the Factory to branch on a system. */
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
  provenance: ProvenanceSchema,
});
export type AssessmentSystem = z.infer<typeof AssessmentSystemSchema>;

export const AssessmentSystemVersionSchema = z
  .strictObject({
    v: z.literal(ASSESSMENT_SYSTEM_REGISTRY_CONTRACT_VERSION),
    systemId: SYSTEM_ID,
    versionId: VERSION_ID,
    label: TEXT,
    lifecycle: z.enum(SYSTEM_LIFECYCLES),
    /** First and last day the version is in force. null = not recorded / open-ended. */
    effectiveFrom: DATE.nullable(),
    effectiveTo: DATE.nullable(),
    provenance: ProvenanceSchema,
  })
  .superRefine((x, ctx) => { if (x.effectiveFrom && x.effectiveTo && x.effectiveTo < x.effectiveFrom) ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'VERSION_ENDS_BEFORE_IT_STARTS' }); });
export type AssessmentSystemVersion = z.infer<typeof AssessmentSystemVersionSchema>;

export const AssessmentContextNodeSchema = z.strictObject({
  v: z.literal(ASSESSMENT_SYSTEM_REGISTRY_CONTRACT_VERSION),
  /** `<SYSTEM>.<...>`. For a COMPONENT this is the adapter id. */
  nodeId: NODE_ID,
  systemId: SYSTEM_ID,
  versionId: VERSION_ID,
  kind: z.enum(CONTEXT_KINDS),
  parentNodeId: NODE_ID.nullable(),
  code: TEXT,
  displayName: TEXT,
});
export type AssessmentContextNode = z.infer<typeof AssessmentContextNodeSchema>;

export type RegistryRefusalCode =
  | 'RECORD_INVALID' | 'SYSTEM_ALREADY_REGISTERED' | 'SYSTEM_NOT_REGISTERED' | 'VERSION_ALREADY_REGISTERED' | 'VERSION_NOT_REGISTERED' | 'NODE_ALREADY_REGISTERED' | 'NODE_IS_NOT_UNDER_ITS_SYSTEM'
  | 'PARENT_NODE_NOT_REGISTERED' | 'PARENT_IS_OF_ANOTHER_VERSION' | 'COMPONENT_CANNOT_HAVE_CHILDREN' | 'ADAPTER_ALREADY_REGISTERED' | 'COMPONENT_NODE_NOT_REGISTERED' | 'PROFILE_IS_OF_ANOTHER_SYSTEM' | 'PROFILE_PAIR_DOES_NOT_RESOLVE' | 'ADAPTER_BINDS_A_RETIRED_CONFIGURATION';
export type Registered<T> = { ok: true; value: T } | { ok: false; code: RegistryRefusalCode; detail: string };

/** The rule definition behind an adapter: the EA-1 pair, or a provisional adapter that has no EA-1 pair yet. */
export type AdapterDefinition =
  | { kind: 'EA1_PROFILE_PAIR'; system: AssessmentSystemProfile; component: AssessmentComponentProfile }
  | { kind: 'PROVISIONAL_ADAPTER'; adapter: AssessmentAdapter };
export interface AdapterRegistration { versionId: string; definition: AdapterDefinition }

export interface AssessmentSystemRegistry {
  registerSystem(input: unknown): Registered<AssessmentSystem>;
  registerVersion(input: unknown): Registered<AssessmentSystemVersion>;
  registerNode(input: unknown): Registered<AssessmentContextNode>;
  /** Binds a rule definition to a registered COMPONENT node. The adapter of a system that is not registered does not exist. */
  registerAdapter(input: AdapterRegistration): Registered<AssessmentAdapter>;
  systems(): readonly AssessmentSystem[];
  system(systemId: string): AssessmentSystem | null;
  versions(systemId: string): readonly AssessmentSystemVersion[];
  version(systemId: string, versionId: string): AssessmentSystemVersion | null;
  /** The ACTIVE version in force on a day; null when none, or when more than one claims the day. */
  versionInForce(systemId: string, isoDate: string): AssessmentSystemVersion | null;
  nodes(systemId: string, versionId: string): readonly AssessmentContextNode[];
  node(nodeId: string, versionId?: string): AssessmentContextNode | null;
  /** From a node up to the top of its version: component, level, subject, qualification, programme. */
  lineageOf(nodeId: string, versionId?: string): readonly AssessmentContextNode[];
  adapters(): readonly AssessmentAdapter[];
  adapter(adapterId: string): AssessmentAdapter | null;
  /** The EA-1 pair behind an adapter, for `adapt()`. null for a provisional adapter and for an unknown id. */
  profilePairOf(adapterId: string): { system: AssessmentSystemProfile; component: AssessmentComponentProfile } | null;
}

const key = (...parts: string[]): string => parts.join('|');
const refuse = <T>(code: RegistryRefusalCode, detail: string): Registered<T> => ({ ok: false, code, detail });
const issues = (e: z.ZodError): string => e.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');

export interface RegistryOptions {
  /**
   * Says which retired configurations a profile pair still cites. A registry given one refuses to register an
   * adapter bound to a retired configuration: a stale binding fails at registration instead of going unnoticed.
   */
  retiredConfigurationsOf?: (pair: { system: AssessmentSystemProfile; component: AssessmentComponentProfile }) => string[];
}

/** A new, empty registry. Registration is the only way anything enters it. */
export function createAssessmentSystemRegistry(options: RegistryOptions = {}): AssessmentSystemRegistry {
  const systems = new Map<string, AssessmentSystem>();
  const versions = new Map<string, AssessmentSystemVersion>();
  const nodes = new Map<string, AssessmentContextNode>();
  const adapters = new Map<string, { adapter: AssessmentAdapter; definition: AdapterDefinition }>();
  const nodeOf = (nodeId: string, versionId?: string): AssessmentContextNode | null => (versionId ? nodes.get(key(nodeId, versionId)) ?? null : [...nodes.values()].find((n) => n.nodeId === nodeId) ?? null);

  const registry: AssessmentSystemRegistry = {
    registerSystem(input) {
      const p = AssessmentSystemSchema.safeParse(input);
      if (!p.success) return refuse('RECORD_INVALID', issues(p.error));
      if (systems.has(p.data.systemId)) return refuse('SYSTEM_ALREADY_REGISTERED', p.data.systemId);
      systems.set(p.data.systemId, Object.freeze(p.data));
      return { ok: true, value: p.data };
    },
    registerVersion(input) {
      const p = AssessmentSystemVersionSchema.safeParse(input);
      if (!p.success) return refuse('RECORD_INVALID', issues(p.error));
      if (!systems.has(p.data.systemId)) return refuse('SYSTEM_NOT_REGISTERED', p.data.systemId);
      if (versions.has(key(p.data.systemId, p.data.versionId))) return refuse('VERSION_ALREADY_REGISTERED', `${p.data.systemId}@${p.data.versionId}`);
      versions.set(key(p.data.systemId, p.data.versionId), Object.freeze(p.data));
      return { ok: true, value: p.data };
    },
    registerNode(input) {
      const p = AssessmentContextNodeSchema.safeParse(input);
      if (!p.success) return refuse('RECORD_INVALID', issues(p.error));
      const n = p.data;
      if (!systems.has(n.systemId)) return refuse('SYSTEM_NOT_REGISTERED', n.systemId);
      if (!versions.has(key(n.systemId, n.versionId))) return refuse('VERSION_NOT_REGISTERED', `${n.systemId}@${n.versionId}`);
      if (!n.nodeId.startsWith(`${n.systemId}.`)) return refuse('NODE_IS_NOT_UNDER_ITS_SYSTEM', `${n.nodeId} / ${n.systemId}`);
      if (nodes.has(key(n.nodeId, n.versionId))) return refuse('NODE_ALREADY_REGISTERED', `${n.nodeId}@${n.versionId}`);
      if (n.parentNodeId) {
        const parent = nodes.get(key(n.parentNodeId, n.versionId));
        if (!parent) return refuse([...nodes.values()].some((x) => x.nodeId === n.parentNodeId) ? 'PARENT_IS_OF_ANOTHER_VERSION' : 'PARENT_NODE_NOT_REGISTERED', n.parentNodeId);
        if (parent.kind === 'COMPONENT') return refuse('COMPONENT_CANNOT_HAVE_CHILDREN', n.parentNodeId);
      }
      nodes.set(key(n.nodeId, n.versionId), Object.freeze(n));
      return { ok: true, value: n };
    },
    registerAdapter({ versionId, definition }) {
      const view = definition.kind === 'EA1_PROFILE_PAIR' ? adapterOfComponent(definition.system, definition.component) : definition.adapter;
      if (!view) return refuse('PROFILE_PAIR_DOES_NOT_RESOLVE', definition.kind === 'EA1_PROFILE_PAIR' ? definition.component.componentId : 'provisional');
      const systemId = view.adapterId.split('.')[0];
      if (!systems.has(systemId)) return refuse('SYSTEM_NOT_REGISTERED', systemId);
      if (definition.kind === 'EA1_PROFILE_PAIR' && definition.system.profileId !== systemId) return refuse('PROFILE_IS_OF_ANOTHER_SYSTEM', `${definition.system.profileId} / ${systemId}`);
      const retired = definition.kind === 'EA1_PROFILE_PAIR' && options.retiredConfigurationsOf ? options.retiredConfigurationsOf(definition) : [];
      if (retired.length > 0) return refuse('ADAPTER_BINDS_A_RETIRED_CONFIGURATION', `${view.adapterId} cites ${retired.join(', ')}`);
      if (!versions.has(key(systemId, versionId))) return refuse('VERSION_NOT_REGISTERED', `${systemId}@${versionId}`);
      const node = nodes.get(key(view.adapterId, versionId));
      if (!node || node.kind !== 'COMPONENT') return refuse('COMPONENT_NODE_NOT_REGISTERED', `${view.adapterId}@${versionId}`);
      if (adapters.has(view.adapterId)) return refuse('ADAPTER_ALREADY_REGISTERED', view.adapterId);
      // the adapter says which registered system and version it is the adapter OF: read from the registry, never from a list
      const adapter: AssessmentAdapter = Object.freeze({ ...view, systemId, systemVersionId: versionId });
      adapters.set(view.adapterId, { adapter, definition });
      return { ok: true, value: adapter };
    },
    systems: () => [...systems.values()],
    system: (id) => systems.get(id) ?? null,
    versions: (id) => [...versions.values()].filter((v) => v.systemId === id),
    version: (id, versionId) => versions.get(key(id, versionId)) ?? null,
    versionInForce(id, isoDate) {
      const inForce = registry.versions(id).filter((v) => v.lifecycle === 'ACTIVE' && (!v.effectiveFrom || v.effectiveFrom <= isoDate) && (!v.effectiveTo || isoDate <= v.effectiveTo));
      return inForce.length === 1 ? inForce[0] : null;
    },
    nodes: (id, versionId) => [...nodes.values()].filter((n) => n.systemId === id && n.versionId === versionId),
    node: nodeOf,
    lineageOf(nodeId, versionId) {
      const out: AssessmentContextNode[] = [];
      for (let n = nodeOf(nodeId, versionId); n; n = n.parentNodeId ? nodes.get(key(n.parentNodeId, n.versionId)) ?? null : null) out.push(n);
      return out;
    },
    adapters: () => [...adapters.values()].map((a) => a.adapter),
    adapter: (id) => adapters.get(id)?.adapter ?? null,
    profilePairOf(id) {
      const d = adapters.get(id)?.definition;
      return d && d.kind === 'EA1_PROFILE_PAIR' ? { system: d.system, component: d.component } : null;
    },
  };
  return registry;
}

export type SystemGate = { ok: true; system: AssessmentSystem; version: AssessmentSystemVersion } | { ok: false; code: 'ASSESSMENT_SYSTEM_NOT_REGISTERED' | 'ASSESSMENT_SYSTEM_VERSION_NOT_REGISTERED' | 'ADAPTER_IS_NOT_THE_REGISTERED_ONE' | 'ASSESSMENT_SYSTEM_NOT_ACTIVE'; detail: string };

/**
 * Is this adapter the registered adapter of a registered system version? The planner, the composer and the
 * renderer all ask this before using an adapter. A retired system or version supplies nothing new to a Student.
 */
export function systemGate(registry: AssessmentSystemRegistry, adapter: Pick<AssessmentAdapter, 'adapterId' | 'version' | 'systemId' | 'systemVersionId'>, use: 'STUDENT_DELIVERY' | 'DEV_TEST'): SystemGate {
  const system = adapter.systemId ? registry.system(adapter.systemId) : null;
  if (!system) return { ok: false, code: 'ASSESSMENT_SYSTEM_NOT_REGISTERED', detail: adapter.systemId ?? `${adapter.adapterId} names no system` };
  const version = adapter.systemVersionId ? registry.version(system.systemId, adapter.systemVersionId) : null;
  if (!version) return { ok: false, code: 'ASSESSMENT_SYSTEM_VERSION_NOT_REGISTERED', detail: `${system.systemId}@${adapter.systemVersionId ?? 'no version'}` };
  const registered = registry.adapter(adapter.adapterId);
  if (!registered || registered.version !== adapter.version || registered.systemVersionId !== adapter.systemVersionId) return { ok: false, code: 'ADAPTER_IS_NOT_THE_REGISTERED_ONE', detail: adapter.adapterId };
  if (use === 'STUDENT_DELIVERY' && (system.lifecycle !== 'ACTIVE' || version.lifecycle !== 'ACTIVE')) return { ok: false, code: 'ASSESSMENT_SYSTEM_NOT_ACTIVE', detail: `${system.systemId} is ${system.lifecycle}, ${version.versionId} is ${version.lifecycle}` };
  return { ok: true, system, version };
}
