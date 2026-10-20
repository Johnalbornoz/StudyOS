/**
 * Blueprint Engine V2 / BP-2 -- Blueprint Variants: identity, purpose, scope,
 * variant, session applicability.
 *
 *   Exam Definition -> Specification -> (Session) -> Blueprint Variant -> Assessment Instance
 *
 * One specification has MANY blueprint variants. A variant is a reusable
 * academic STRUCTURE identified by
 *
 *   examDefinitionKey | specificationKey | purpose | scope | variantKey
 *
 * -- never by a display label, never by exam_version_id alone, never by a
 * Mock ordinal. Mock 1 and Mock 2 are two Assessment Instances (different
 * seed / items) of the SAME variant.
 *
 * Structural capability (can this structure be a full mock?) is separate
 * from content readiness (can the Question Bank fill it today?): the latter
 * is never evaluated here.
 */
import { z } from 'zod';
import { compileBlueprint } from './compiler';
import { compileExam } from './exam-compiler';
import { hashCanonical } from '../scoring/scoring-policy';
import { isAuthoritative, type Provenance, type SourceRegistry } from './provenance';
import { ProvenanceSchema, type BlueprintKind, type BlueprintV2 } from './schema';
import type { ExamDefinitionV2, TriState } from './exam-definition';
import type { BlueprintIssue } from './validate';

// ---------------------------------------------------------------------------
// Taxonomies
// ---------------------------------------------------------------------------

export const BLUEPRINT_PURPOSES = [
  /** The official structure as published; describes, never assembles. */
  'OFFICIAL_STRUCTURE_REFERENCE',
  'DIAGNOSTIC',
  'PRACTICE',
  /** Training on one component / section / domain. */
  'COMPONENT_TRAINING',
  /** A timed simulation explicitly smaller than the real assessment (always disclosed). */
  'REDUCED_MOCK',
  /** The complete structure required for the assessment target. */
  'FULL_MOCK',
  /** A competency / framework benchmark (not a simulation of a sitting). */
  'BENCHMARK',
] as const;
export type BlueprintPurpose = (typeof BLUEPRINT_PURPOSES)[number];

const SLUG = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/, 'lowercase slug');
const KEY = z.string().min(1).max(80);

export const ScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ENTIRE_ASSESSMENT') }),
  z.object({ type: z.literal('ROUTE'), routeKey: KEY, componentSet: z.array(KEY).min(1) }),
  z.object({ type: z.literal('COMPONENT'), componentKey: KEY }),
  z.object({ type: z.literal('SECTION'), componentKey: KEY, sectionKey: KEY }),
  /** A reporting domain / area of the exam (its configured key, not its label). */
  z.object({ type: z.literal('DOMAIN'), domainKey: KEY }),
  z.object({ type: z.literal('CUSTOM_SUBSET'), componentKeys: z.array(KEY).min(1), rationale: z.string().min(10).max(300) }),
]);
export type BlueprintScope = z.infer<typeof ScopeSchema>;

export const VARIANT_DIMENSIONS = ['STANDARD', 'CALCULATOR', 'REGIONAL', 'ROUTE_SPECIFIC', 'ACCOMMODATIONS', 'HISTORICAL_STRUCTURE', 'SESSION_STRUCTURE', 'OTHER'] as const;

export const VariantSchema = z.object({
  /** Stable machine key -- never a display label. */
  key: SLUG,
  dimension: z.enum(VARIANT_DIMENSIONS),
  /** Why this variant exists. Required for anything but STANDARD. */
  reason: z.string().min(1).max(300).nullable(),
});
export type BlueprintVariantSpec = z.infer<typeof VariantSchema>;
export const STANDARD_VARIANT: BlueprintVariantSpec = Object.freeze({ key: 'standard', dimension: 'STANDARD', reason: null }) as BlueprintVariantSpec;

export const SessionApplicabilitySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ALL_SESSIONS_OF_SPECIFICATION') }),
  z.object({ type: z.literal('SESSIONS'), sessionKeys: z.array(KEY).min(1) }),
]);
export type SessionApplicability = z.infer<typeof SessionApplicabilitySchema>;

export const LENGTH_CLASSES = ['FULL_LENGTH', 'FULL_LENGTH_BY_EVIDENCE', 'REDUCED', 'UNDETERMINED', 'NOT_ASSEMBLABLE'] as const;

export const BlueprintIdentitySchema = z.object({
  examDefinitionKey: KEY,
  /** null when the definition has no stated specification: such a variant never resolves. */
  specificationKey: z.string().min(1).max(160).nullable(),
  purpose: z.enum(BLUEPRINT_PURPOSES),
  scope: ScopeSchema,
  variant: VariantSchema,
});
export type BlueprintIdentity = z.infer<typeof BlueprintIdentitySchema>;

export const BlueprintVariantV2Schema = z.object({
  schema: z.literal('studyus.blueprint-variant/v2'),
  identity: BlueprintIdentitySchema,
  identityKey: z.string().min(1),
  sessionApplicability: SessionApplicabilitySchema,
  origin: z.discriminatedUnion('type', [
    z.object({ type: z.literal('COMPILED_FROM_CONFIG'), basis: z.string().min(1).max(300) }),
    z.object({ type: z.literal('DECLARED'), provenance: ProvenanceSchema }),
  ]),
  componentKeys: z.array(KEY).min(1),
  /** hash of the academic structure only (components, cells, route) -- equal structures, equal hash. */
  structureFingerprint: z.string().length(64),
  structure: z.object({ lengthClass: z.enum(LENGTH_CLASSES), lengthEvidence: ProvenanceSchema.nullable() }),
  structuralCapability: z.object({
    assemblable: z.enum(['YES', 'NO', 'UNKNOWN']),
    fullLength: z.enum(['YES', 'NO', 'UNKNOWN']),
    mockable: z.enum(['YES', 'NO', 'UNKNOWN']),
  }),
  /** Never evaluated by the blueprint layer: the Question Bank owns it. */
  contentReadiness: z.object({ status: z.literal('NOT_EVALUATED'), owner: z.literal('QUESTION_BANK') }),
  /** The BP-0 document of this structure. */
  blueprint: z.custom<BlueprintV2>((v) => !!v && typeof v === 'object' && (v as BlueprintV2).schema === 'studyus.blueprint/v2'),
});
export type BlueprintVariantV2 = z.infer<typeof BlueprintVariantV2Schema>;

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function scopeKey(s: BlueprintScope): string {
  switch (s.type) {
    case 'ENTIRE_ASSESSMENT':
      return 'ENTIRE_ASSESSMENT';
    case 'ROUTE':
      return `ROUTE(${s.routeKey}:${[...s.componentSet].sort().join('+')})`;
    case 'COMPONENT':
      return `COMPONENT(${s.componentKey})`;
    case 'SECTION':
      return `SECTION(${s.componentKey}/${s.sectionKey})`;
    case 'DOMAIN':
      return `DOMAIN(${s.domainKey})`;
    case 'CUSTOM_SUBSET':
      return `CUSTOM_SUBSET(${[...s.componentKeys].sort().join('+')})`;
  }
}

export function identityKeyOf(id: BlueprintIdentity): string {
  return [id.examDefinitionKey, id.specificationKey ?? '<UNKNOWN_SPECIFICATION>', id.purpose, scopeKey(id.scope), id.variant.key].join('|');
}

/** The academic structure only: what an instance is assembled from. Identity, scoring and session data excluded. */
export function structureFingerprint(bp: BlueprintV2, scope: BlueprintScope): string {
  return hashCanonical({
    components: bp.components.map((c) => ({ key: c.key, official: c.official, sections: c.sections, cells: c.cells, plannedPositions: c.plannedPositions, lengthFidelity: c.lengthFidelity })),
    route: bp.identity.route,
    section: scope.type === 'SECTION' ? scope.sectionKey : null,
  });
}

// ---------------------------------------------------------------------------
// Assessment instances: the series lives HERE, never in the blueprint identity.
// ---------------------------------------------------------------------------

export interface AssessmentInstanceRef {
  /** The variant the instance is assembled from. */
  variantIdentityKey: string;
  /** e.g. a student's or a class's mock series. */
  seriesKey: string;
  /** 1 = Mock 1, 2 = Mock 2 ... */
  ordinal: number;
  /** Assembly seed (the runtime uses the instance id). */
  seed: string;
}

export function assessmentInstanceKey(ref: AssessmentInstanceRef): string {
  if (!Number.isInteger(ref.ordinal) || ref.ordinal < 1) throw new Error('ordinal must be a positive integer');
  return `${ref.variantIdentityKey}#${ref.seriesKey}:${ref.ordinal}@${ref.seed}`;
}

/** Ordinals / mock numbering must never reach a blueprint identity. */
export const MOCK_ORDINAL_PATTERN = /(^|[^a-z])(mock|simulacro|attempt|intento)[-_. ]?\d+|(^|[^a-z])(first|second|third|1st|2nd|3rd)[-_. ]?(mock|attempt)/i;

// ---------------------------------------------------------------------------
// Declared variants (an operator / governed source states a variant explicitly)
// ---------------------------------------------------------------------------

export interface DeclaredVariantInput {
  purpose: BlueprintPurpose;
  scope: BlueprintScope;
  variant: BlueprintVariantSpec;
  sessionApplicability?: SessionApplicability;
  provenance: Provenance;
  /** Explicit, authoritative evidence that a reduced form IS the complete assessment (FULL_MOCK only). */
  lengthEvidence?: Provenance;
  /** A different structural source of the SAME exam + specification (e.g. a session-specific structure). */
  config?: unknown;
}

export interface CompileVariantsOptions {
  declared?: DeclaredVariantInput[];
  /** false: only declared variants (no variants derived from the configuration). */
  deriveFromConfig?: boolean;
  registry?: SourceRegistry;
}

export interface CompileVariantsResult {
  examDefinition: ExamDefinitionV2 | null;
  variants: BlueprintVariantV2[];
  issues: BlueprintIssue[];
}

const kindFor = (purpose: BlueprintPurpose, scope: BlueprintScope): BlueprintKind => {
  if (purpose === 'FULL_MOCK') return 'FULL_MOCK';
  if (purpose === 'REDUCED_MOCK') return 'REDUCED_MOCK';
  if (purpose === 'DIAGNOSTIC') return scope.type === 'ENTIRE_ASSESSMENT' ? 'GENERAL' : 'DIAGNOSTIC';
  if (scope.type === 'ENTIRE_ASSESSMENT') return 'GENERAL';
  return 'COMPONENT_PRACTICE';
};

/** Components a scope covers, from the definition / blueprint -- null when the scope names something that does not exist. */
export function scopeComponents(scope: BlueprintScope, def: ExamDefinitionV2, general: BlueprintV2): { keys: string[] } | { error: string; code: string } {
  const all = def.components.map((c) => c.key);
  switch (scope.type) {
    case 'ENTIRE_ASSESSMENT':
      return { keys: all };
    case 'ROUTE': {
      const r = general.routes.find((x) => x.key === scope.routeKey);
      if (!r) return { code: 'ROUTE_NOT_APPLICABLE', error: `route ${scope.routeKey} is not declared by this specification` };
      if (!r.componentSets.some((s) => s.length === scope.componentSet.length && s.every((k) => scope.componentSet.includes(k)))) return { code: 'ROUTE_NOT_APPLICABLE', error: `[${scope.componentSet.join(', ')}] is not an official component set of route ${r.key}` };
      return { keys: all.filter((k) => scope.componentSet.includes(k)) };
    }
    case 'COMPONENT':
      return all.includes(scope.componentKey) ? { keys: [scope.componentKey] } : { code: 'COMPONENT_NOT_IN_DEFINITION', error: `component ${scope.componentKey} is not part of the exam definition` };
    case 'SECTION': {
      const c = def.components.find((x) => x.key === scope.componentKey);
      if (!c) return { code: 'COMPONENT_NOT_IN_DEFINITION', error: `component ${scope.componentKey} is not part of the exam definition` };
      const sections = general.components.find((x) => x.key === scope.componentKey)!.sections.map((s) => s.key);
      return sections.includes(scope.sectionKey) ? { keys: [scope.componentKey] } : { code: 'IMPOSSIBLE_SCOPE', error: `component ${scope.componentKey} has no official section ${scope.sectionKey}` };
    }
    case 'DOMAIN': {
      const g = general.reportingGroups.find((x) => x.key === scope.domainKey);
      return g ? { keys: g.componentKeys } : { code: 'IMPOSSIBLE_SCOPE', error: `no configured domain ${scope.domainKey}` };
    }
    case 'CUSTOM_SUBSET': {
      const missing = scope.componentKeys.filter((k) => !all.includes(k));
      return missing.length ? { code: 'COMPONENT_NOT_IN_DEFINITION', error: `unknown components ${missing.join(', ')}` } : { keys: all.filter((k) => scope.componentKeys.includes(k)) };
    }
  }
}

function lengthClassOf(bp: BlueprintV2, structureOnly: boolean): (typeof LENGTH_CLASSES)[number] {
  if (structureOnly || bp.components.every((c) => c.cells.length === 0)) return 'NOT_ASSEMBLABLE';
  if (bp.components.every((c) => c.lengthFidelity === 'OFFICIAL_LENGTH')) return 'FULL_LENGTH';
  if (bp.components.some((c) => c.lengthFidelity === 'REDUCED')) return 'REDUCED';
  return 'UNDETERMINED';
}

function triAll(values: TriState[]): TriState {
  if (values.length === 0) return 'UNKNOWN';
  if (values.every((v) => v === 'YES')) return 'YES';
  if (values.some((v) => v === 'NO')) return 'NO';
  return 'UNKNOWN';
}

/**
 * Builds one variant from a configuration + identity. Returns issues instead
 * of a variant when the identity is impossible for this exam.
 */
function buildVariant(
  config: unknown,
  def: ExamDefinitionV2,
  general: BlueprintV2,
  input: Omit<DeclaredVariantInput, 'config'> & { origin: BlueprintVariantV2['origin'] },
  registry: SourceRegistry | undefined
): { variant: BlueprintVariantV2 | null; issues: BlueprintIssue[] } {
  const identity: BlueprintIdentity = {
    examDefinitionKey: def.identity.definitionKey,
    specificationKey: def.specification.key.status === 'STATED' ? def.specification.key.value : null,
    purpose: input.purpose,
    scope: input.scope,
    variant: input.variant,
  };
  const key = identityKeyOf(identity);
  const issues: BlueprintIssue[] = [];
  const err = (code: string, message: string) => issues.push({ code, severity: 'ERROR', path: `variants.${key}`, message });

  const covered = scopeComponents(input.scope, def, general);
  if ('error' in covered) {
    err(covered.code, covered.error);
    return { variant: null, issues };
  }
  if ((input.purpose === 'FULL_MOCK' || input.purpose === 'REDUCED_MOCK') && def.components.some((c) => covered.keys.includes(c.key) && c.mockable === 'NO')) {
    err('MOCK_SCOPE_INCLUDES_NON_MOCKABLE', 'a mock cannot include a component that is not sat as a timed paper (coursework / performance / practical)');
    return { variant: null, issues };
  }
  const opts: Parameters<typeof compileBlueprint>[1] = { registry, blueprintKind: kindFor(input.purpose, input.scope) };
  if (input.scope.type === 'ROUTE') {
    const r = general.routes.find((x) => x.key === (input.scope as { routeKey: string }).routeKey)!;
    opts.route = { routeKey: r.key, setIndex: r.componentSets.findIndex((s) => s.length === covered.keys.length && s.every((k) => covered.keys.includes(k))) };
  } else if (input.scope.type !== 'ENTIRE_ASSESSMENT') {
    opts.componentKeys = covered.keys;
  }
  // FULL_MOCK by authoritative evidence: the structure itself is reduced, so it is compiled as GENERAL and labelled by evidence.
  const byEvidence = input.purpose === 'FULL_MOCK' && !!input.lengthEvidence && isAuthoritative(input.lengthEvidence);
  if (byEvidence) opts.blueprintKind = 'GENERAL';
  const compiled = compileBlueprint(config, opts);
  for (const i of compiled.issues) if (i.severity === 'ERROR') issues.push({ ...i, path: `variants.${key}.${i.path}` });
  if (!compiled.blueprint || compiled.status === 'INVALID') {
    if (!issues.length) err('VARIANT_NOT_COMPILABLE', 'the blueprint for this variant does not compile');
    return { variant: null, issues };
  }
  const bp = compiled.blueprint;
  const comps = def.components.filter((c) => covered.keys.includes(c.key));
  let lengthClass = lengthClassOf(bp, def.lifecycle.configuration === 'STRUCTURE_ONLY');
  if (byEvidence && lengthClass !== 'FULL_LENGTH') lengthClass = 'FULL_LENGTH_BY_EVIDENCE';
  const variant: BlueprintVariantV2 = {
    schema: 'studyus.blueprint-variant/v2',
    identity,
    identityKey: key,
    sessionApplicability: input.sessionApplicability ?? { type: 'ALL_SESSIONS_OF_SPECIFICATION' },
    origin: input.origin,
    componentKeys: covered.keys,
    structureFingerprint: structureFingerprint(bp, input.scope),
    structure: { lengthClass, lengthEvidence: input.lengthEvidence ?? null },
    structuralCapability: {
      assemblable: lengthClass === 'NOT_ASSEMBLABLE' ? 'NO' : 'YES',
      fullLength: lengthClass === 'FULL_LENGTH' || lengthClass === 'FULL_LENGTH_BY_EVIDENCE' ? 'YES' : lengthClass === 'REDUCED' ? 'NO' : 'UNKNOWN',
      mockable: triAll(comps.map((c) => c.mockable)),
    },
    contentReadiness: { status: 'NOT_EVALUATED', owner: 'QUESTION_BANK' },
    blueprint: bp,
  };
  return { variant, issues };
}

/**
 * Variants of one configuration: the ones its structure supports (derived,
 * never invented) plus any declared ones.
 *
 * Derived (all STANDARD, all sessions of the specification):
 *  - OFFICIAL_STRUCTURE_REFERENCE for the whole exam, and per component for
 *    multi-component exams -- when official component definitions exist;
 *  - with a bank (not structure-only): PRACTICE and DIAGNOSTIC for the whole
 *    exam (the runtime already practises / diagnoses on this structure);
 *    COMPONENT_TRAINING per practisable component of a multi-component exam;
 *  - a mock per scope (whole exam, or each official route set): FULL_MOCK
 *    only when every component is at official length and mockable,
 *    otherwise REDUCED_MOCK when no component is non-mockable. A reduced
 *    form never becomes a FULL_MOCK.
 */
export function compileBlueprintVariants(config: unknown, options: CompileVariantsOptions = {}): CompileVariantsResult {
  const exam = compileExam(config, { registry: options.registry });
  const def = exam.examDefinition;
  const general = exam.blueprint;
  if (!def || !general) return { examDefinition: null, variants: [], issues: exam.issues };
  const issues: BlueprintIssue[] = [];
  const variants: BlueprintVariantV2[] = [];
  const add = (r: { variant: BlueprintVariantV2 | null; issues: BlueprintIssue[] }) => {
    issues.push(...r.issues);
    if (!r.variant) return;
    // Two official route sets with the same components (e.g. a staged route listing {p1,p3,p4,p5} twice, differing only in
    // which pair is sat first) are ONE structure: the staging is session sequencing, not a blueprint difference.
    const same = variants.find((v) => v.identityKey === r.variant!.identityKey);
    if (same && same.structureFingerprint === r.variant.structureFingerprint && r.variant.origin.type === 'COMPILED_FROM_CONFIG') {
      issues.push({ code: 'EQUIVALENT_ROUTE_SETS_COLLAPSED', severity: 'INFO', path: `variants.${r.variant.identityKey}`, message: 'the source lists the same component set more than once (different staging only); one structural variant is kept' });
      return;
    }
    variants.push(r.variant);
  };
  const derived = (purpose: BlueprintPurpose, scope: BlueprintScope, basis: string) =>
    add(buildVariant(config, def, general, { purpose, scope, variant: STANDARD_VARIANT, provenance: { kind: 'UNKNOWN', authority: 'NONE', sourceKeys: [] }, origin: { type: 'COMPILED_FROM_CONFIG', basis } }, options.registry));

  if (options.deriveFromConfig !== false) {
    const structureOnly = def.lifecycle.configuration === 'STRUCTURE_ONLY';
    const hasDefinitions = def.components.some((c) => c.official.kind.status === 'STATED');
    const multi = def.components.length > 1;
    if (hasDefinitions) {
      derived('OFFICIAL_STRUCTURE_REFERENCE', { type: 'ENTIRE_ASSESSMENT' }, 'official component definitions in the configuration');
      if (multi) for (const c of def.components) derived('OFFICIAL_STRUCTURE_REFERENCE', { type: 'COMPONENT', componentKey: c.key }, 'official component definition');
    }
    if (!structureOnly) {
      derived('PRACTICE', { type: 'ENTIRE_ASSESSMENT' }, 'the runtime practises on this configuration\'s blueprint');
      derived('DIAGNOSTIC', { type: 'ENTIRE_ASSESSMENT' }, 'the runtime runs diagnostics as practice on this blueprint (exam_instances.purpose = DIAGNOSTIC)');
      if (multi) for (const c of def.components) if (c.studyusPracticeConfigured) derived('COMPONENT_TRAINING', { type: 'COMPONENT', componentKey: c.key }, 'a practisable component of a multi-component exam');
      const mockScopes: BlueprintScope[] = general.routes.length
        ? general.routes.flatMap((r) => r.componentSets.map((set) => ({ type: 'ROUTE' as const, routeKey: r.key, componentSet: set })))
        : [{ type: 'ENTIRE_ASSESSMENT' }];
      for (const scope of mockScopes) {
        const covered = scopeComponents(scope, def, general);
        if ('error' in covered) continue;
        const comps = def.components.filter((c) => covered.keys.includes(c.key));
        if (comps.some((c) => c.mockable === 'NO')) continue; // coursework cannot be sat as a mock
        // Full length is a structural fact; a full-length form is never labelled reduced. When an official duration is not
        // published (mockable UNKNOWN, e.g. Saber 11), the variant is FULL_MOCK with structuralCapability.mockable UNKNOWN.
        const full = general.components.filter((c) => covered.keys.includes(c.key)).every((c) => c.lengthFidelity === 'OFFICIAL_LENGTH');
        derived(full ? 'FULL_MOCK' : 'REDUCED_MOCK', scope, full ? (comps.every((c) => c.mockable === 'YES') ? 'every component at official length and mockable' : 'every component at official length; official timing not published (mockability UNKNOWN)') : 'a timed simulation of a reduced form (disclosed as reduced)');
      }
    }
  }

  for (const d of options.declared ?? []) {
    const source = d.config ?? config;
    let sourceDef = def;
    let sourceGeneral = general;
    if (d.config) {
      const other = compileExam(d.config, { registry: options.registry });
      if (!other.examDefinition || !other.blueprint) {
        issues.push(...other.issues);
        continue;
      }
      const sameExam = other.examDefinition.identity.definitionKey === def.identity.definitionKey && hashCanonical(other.examDefinition.specification.key) === hashCanonical(def.specification.key);
      if (!sameExam) {
        issues.push({ code: 'IDENTITY_INCONSISTENT', severity: 'ERROR', path: `declared.${d.variant.key}`, message: 'a declared variant\'s structural source must be the same exam and specification' });
        continue;
      }
      sourceDef = other.examDefinition;
      sourceGeneral = other.blueprint;
    }
    add(buildVariant(source, sourceDef, sourceGeneral, { ...d, origin: { type: 'DECLARED', provenance: d.provenance } }, options.registry));
  }
  return { examDefinition: def, variants: variants.sort((a, b) => a.identityKey.localeCompare(b.identityKey)), issues };
}
