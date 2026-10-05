/**
 * Blueprint Engine V2 / BP-2 -- blueprint resolution and catalog validation.
 *
 *   resolveBlueprint(catalog, { examDefinitionKey, specificationKey, purpose, scope?, route?, sessionKey?, variantKey? })
 *     -> { status, selected, candidates[], reasons[], conflicts[], missingInformation[], contentReadiness }
 *
 * Pure and deterministic: candidates are evaluated in identity-key order and
 * the outcome never depends on the order of the catalog. It never picks "the
 * first" of several valid candidates:
 *
 *   EXACT_MATCH              the request names a full identity and exactly one variant has it
 *   SINGLE_COMPATIBLE_MATCH  a partial request with exactly one compatible variant
 *   MISSING_CONTEXT          several compatible variants that differ by information the
 *                            request did not give (specification, route, scope, session)
 *   AMBIGUOUS                several variants equally valid for everything the request gave
 *   NO_MATCH                 nothing compatible (with the reason of every exclusion)
 *
 * Never crosses specifications, never substitutes a purpose (a REDUCED_MOCK
 * never answers a FULL_MOCK request), never chooses a route.
 */
import { isAuthoritative } from './provenance';
import type { BlueprintV2 } from './schema';
import type { ExamDefinitionV2 } from './exam-definition';
import type { ExamSessionV2 } from './session';
import type { BlueprintIssue } from './validate';
import {
  BlueprintVariantV2Schema,
  identityKeyOf,
  MOCK_ORDINAL_PATTERN,
  scopeComponents,
  scopeKey,
  structureFingerprint,
  type BlueprintPurpose,
  type BlueprintScope,
  type BlueprintVariantV2,
} from './variant';

export interface ResolveBlueprintRequest {
  examDefinitionKey: string;
  /** Explicit, or derived with authority by the caller (e.g. from a session). Never guessed here. */
  specificationKey?: string | null;
  purpose: BlueprintPurpose;
  scope?: BlueprintScope;
  route?: { routeKey: string; componentSet?: string[] };
  sessionKey?: string;
  variantKey?: string;
}

export interface BlueprintCatalog {
  variants: readonly BlueprintVariantV2[];
  sessions?: readonly ExamSessionV2[];
}

export type ResolutionStatus = 'EXACT_MATCH' | 'SINGLE_COMPATIBLE_MATCH' | 'AMBIGUOUS' | 'NO_MATCH' | 'MISSING_CONTEXT';
export type MissingContext = 'specification' | 'route' | 'scope' | 'session' | 'variant';

export interface BlueprintResolution {
  status: ResolutionStatus;
  selected: BlueprintVariantV2 | null;
  candidates: Array<{ identityKey: string; compatible: boolean; reasons: string[] }>;
  reasons: string[];
  conflicts: Array<{ identityKeys: string[]; reason: string }>;
  missingInformation: MissingContext[];
  /** The blueprint layer never says whether the Question Bank can fill the structure. */
  contentReadiness: { status: 'NOT_EVALUATED'; owner: 'QUESTION_BANK' };
}

const NOT_EVALUATED = { status: 'NOT_EVALUATED', owner: 'QUESTION_BANK' } as const;
const sortedSet = (xs: readonly string[]) => [...xs].sort().join('+');

export function resolveBlueprint(catalog: BlueprintCatalog, req: ResolveBlueprintRequest): BlueprintResolution {
  const out = (status: ResolutionStatus, extra: Partial<BlueprintResolution> = {}): BlueprintResolution => ({ status, selected: null, candidates: [], reasons: [], conflicts: [], missingInformation: [], contentReadiness: NOT_EVALUATED, ...extra });
  const sameExam = [...catalog.variants].filter((v) => v.identity.examDefinitionKey === req.examDefinitionKey).sort((a, b) => a.identityKey.localeCompare(b.identityKey) || a.structureFingerprint.localeCompare(b.structureFingerprint));
  if (sameExam.length === 0) return out('NO_MATCH', { reasons: ['EXAM_DEFINITION_NOT_IN_CATALOG'] });
  if (!req.specificationKey) return out('MISSING_CONTEXT', { missingInformation: ['specification'], reasons: ['a blueprint is resolved against an explicit specification'], candidates: sameExam.map((v) => ({ identityKey: v.identityKey, compatible: false, reasons: ['SPECIFICATION_NOT_GIVEN'] })) });

  if (req.sessionKey && catalog.sessions) {
    const s = catalog.sessions.find((x) => x.sessionKey === req.sessionKey && x.examDefinitionKey === req.examDefinitionKey);
    if (!s) return out('NO_MATCH', { reasons: [`SESSION_NOT_IN_CATALOG: ${req.sessionKey}`] });
    if (s.specificationKey !== req.specificationKey) return out('NO_MATCH', { reasons: [`SESSION_SPECIFICATION_MISMATCH: ${req.sessionKey} examines ${s.specificationKey}`] });
  }

  const candidates = sameExam.map((v) => {
    const reasons: string[] = [];
    const id = v.identity;
    if (id.specificationKey === null) reasons.push('SPECIFICATION_UNRESOLVED');
    else if (id.specificationKey !== req.specificationKey) reasons.push(`OTHER_SPECIFICATION: ${id.specificationKey}`);
    if (req.purpose === 'FULL_MOCK' && (id.purpose === 'REDUCED_MOCK' || (id.purpose === 'FULL_MOCK' && v.structure.lengthClass !== 'FULL_LENGTH' && !(v.structure.lengthClass === 'FULL_LENGTH_BY_EVIDENCE' && v.structure.lengthEvidence && isAuthoritative(v.structure.lengthEvidence))))) {
      reasons.push('REDUCED_FORM_CANNOT_SATISFY_FULL_MOCK');
    } else if (id.purpose !== req.purpose) reasons.push(`PURPOSE_MISMATCH: ${id.purpose}`);
    if (req.scope && scopeKey(req.scope) !== scopeKey(id.scope)) reasons.push(`SCOPE_MISMATCH: ${scopeKey(id.scope)}`);
    if (req.route) {
      if (id.scope.type !== 'ROUTE') reasons.push('ROUTE_REQUESTED: variant is not route-scoped');
      else if (id.scope.routeKey !== req.route.routeKey) reasons.push(`ROUTE_MISMATCH: ${id.scope.routeKey}`);
      else if (req.route.componentSet && sortedSet(req.route.componentSet) !== sortedSet(id.scope.componentSet)) reasons.push(`ROUTE_SET_MISMATCH: ${sortedSet(id.scope.componentSet)}`);
    }
    if (req.sessionKey && v.sessionApplicability.type === 'SESSIONS' && !v.sessionApplicability.sessionKeys.includes(req.sessionKey)) reasons.push(`SESSION_NOT_APPLICABLE: ${v.sessionApplicability.sessionKeys.join(', ')}`);
    if (req.variantKey && id.variant.key !== req.variantKey) reasons.push(`VARIANT_MISMATCH: ${id.variant.key}`);
    return { variant: v, reasons };
  });
  const listed = candidates.map((c) => ({ identityKey: c.variant.identityKey, compatible: c.reasons.length === 0, reasons: c.reasons }));
  const ok = candidates.filter((c) => c.reasons.length === 0).map((c) => c.variant);

  if (ok.length === 0) {
    const sameSpec = candidates.filter((c) => c.variant.identity.specificationKey === req.specificationKey);
    const reasons = sameSpec.length === 0 ? [`NO_BLUEPRINT_FOR_SPECIFICATION: ${req.specificationKey}`] : [...new Set(sameSpec.flatMap((c) => c.reasons.map((r) => r.split(':')[0])))].sort();
    return out('NO_MATCH', { candidates: listed, reasons });
  }
  if (ok.length === 1) {
    const exact = (!!req.scope || (!!req.route && !!req.route.componentSet)) && !!req.variantKey;
    return out(exact ? 'EXACT_MATCH' : 'SINGLE_COMPATIBLE_MATCH', { selected: ok[0], candidates: listed, reasons: [exact ? 'the request names the full identity' : 'exactly one compatible blueprint'] });
  }

  // Several compatible variants: what tells them apart that the request did not give?
  const missing: MissingContext[] = [];
  const scopes = new Set(ok.map((v) => scopeKey(v.identity.scope)));
  if (scopes.size > 1 && !req.scope) {
    const routeScoped = ok.filter((v) => v.identity.scope.type === 'ROUTE');
    missing.push(routeScoped.length > 0 && (!req.route || !req.route.componentSet) ? 'route' : 'scope');
  }
  const applicability = new Set(ok.map((v) => (v.sessionApplicability.type === 'SESSIONS' ? sortedSet(v.sessionApplicability.sessionKeys) : '*')));
  if (applicability.size > 1 && !req.sessionKey) missing.push('session');
  if (missing.length) return out('MISSING_CONTEXT', { candidates: listed, missingInformation: missing, reasons: missing.map((m) => `${m} required to choose between ${ok.length} compatible blueprints`) });

  const byIdentity = new Map<string, string[]>();
  for (const v of ok) byIdentity.set(v.identityKey, [...(byIdentity.get(v.identityKey) ?? []), v.identityKey]);
  const conflicts = [...byIdentity.values()].some((xs) => xs.length > 1)
    ? [{ identityKeys: ok.map((v) => v.identityKey), reason: 'DUPLICATE_IDENTITY' }]
    : [{ identityKeys: ok.map((v) => v.identityKey), reason: 'EQUALLY_VALID_VARIANTS' }];
  const variantsDiffer = new Set(ok.map((v) => v.identity.variant.key)).size > 1;
  return out('AMBIGUOUS', { candidates: listed, conflicts, missingInformation: variantsDiffer && !req.variantKey ? ['variant'] : [], reasons: ['several blueprints are equally valid; none is chosen'] });
}

// ---------------------------------------------------------------------------
// Catalog validation
// ---------------------------------------------------------------------------

export interface CatalogExam {
  definition: ExamDefinitionV2;
  /** The GENERAL (all-component) blueprint of the definition. */
  blueprint: BlueprintV2;
}

export function validateBlueprintCatalog(variants: readonly unknown[], context: { exams?: ReadonlyMap<string, CatalogExam>; sessions?: readonly ExamSessionV2[] } = {}): { ok: boolean; issues: BlueprintIssue[] } {
  const issues: BlueprintIssue[] = [];
  const err = (code: string, path: string, message: string) => issues.push({ code, severity: 'ERROR', path, message });
  const warn = (code: string, path: string, message: string) => issues.push({ code, severity: 'WARNING', path, message });
  const parsed: BlueprintVariantV2[] = [];

  variants.forEach((raw, i) => {
    const r = BlueprintVariantV2Schema.safeParse(raw);
    if (!r.success) {
      for (const e of r.error.issues) {
        const onVariantKey = e.path.join('.') === 'identity.variant.key';
        err(onVariantKey ? 'VARIANT_KEY_IS_DISPLAY_LABEL' : 'INVALID_VARIANT_SHAPE', `variants.${i}.${e.path.join('.')}`, e.message);
      }
      return;
    }
    parsed.push(r.data);
  });

  const keys = new Map<string, number>();
  for (const v of parsed) {
    const at = `variants.${v.identityKey}`;
    keys.set(v.identityKey, (keys.get(v.identityKey) ?? 0) + 1);
    if (identityKeyOf(v.identity) !== v.identityKey) err('IDENTITY_KEY_MISMATCH', at, 'identityKey does not follow from the identity');
    if (structureFingerprint(v.blueprint, v.identity.scope) !== v.structureFingerprint) err('STRUCTURE_FINGERPRINT_MISMATCH', at, 'structure fingerprint does not match the blueprint');
    if (v.identity.specificationKey === null) warn('SPECIFICATION_UNRESOLVED', at, 'no stated specification: this variant never resolves');
    if (MOCK_ORDINAL_PATTERN.test(v.identity.variant.key) || MOCK_ORDINAL_PATTERN.test(scopeKey(v.identity.scope)) || (v.identity.variant.reason && MOCK_ORDINAL_PATTERN.test(v.identity.variant.reason))) {
      err('MOCK_ORDINAL_IN_IDENTITY', at, 'a Mock ordinal belongs to the Assessment Instance series, never to the blueprint identity');
    }
    if (v.identity.variant.dimension !== 'STANDARD' && !v.identity.variant.reason) err('OVERLAPPING_VARIANTS_WITHOUT_DISAMBIGUATOR', at, `a ${v.identity.variant.dimension} variant must state why it exists`);
    if (v.identity.purpose === 'FULL_MOCK') {
      const lc = v.structure.lengthClass;
      const evidenced = lc === 'FULL_LENGTH_BY_EVIDENCE' && v.structure.lengthEvidence && isAuthoritative(v.structure.lengthEvidence);
      if (lc !== 'FULL_LENGTH' && !evidenced) err('FULL_MOCK_ON_REDUCED_FORM', at, `a FULL_MOCK blueprint over a ${lc} structure`);
    }
    if ((v.identity.purpose === 'FULL_MOCK' || v.identity.purpose === 'REDUCED_MOCK') && v.structuralCapability.mockable === 'NO') err('MOCK_SCOPE_INCLUDES_NON_MOCKABLE', at, 'a mock over a component that is not sat as a timed paper');

    const exam = context.exams?.get(v.identity.examDefinitionKey);
    if (exam) {
      const label = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const labels = new Set([label(exam.definition.identity.name), ...exam.definition.components.map((c) => label(c.name))]);
      if (labels.has(v.identity.variant.key)) err('VARIANT_KEY_IS_DISPLAY_LABEL', at, `variant key "${v.identity.variant.key}" is a display label`);
      const spec = exam.definition.specification.key;
      if ((spec.status === 'STATED' ? spec.value : null) !== v.identity.specificationKey) err('IDENTITY_INCONSISTENT', at, 'specification does not match the exam definition');
      const covered = scopeComponents(v.identity.scope, exam.definition, exam.blueprint);
      if ('error' in covered) err(covered.code, at, covered.error);
      else if (sortedSet(covered.keys) !== sortedSet(v.componentKeys)) err('IMPOSSIBLE_SCOPE', at, 'the variant\'s components are not those of its scope');
      for (const k of v.componentKeys) if (!exam.definition.components.some((c) => c.key === k)) err('COMPONENT_NOT_IN_DEFINITION', at, `component ${k}`);
    }
    if (v.sessionApplicability.type === 'SESSIONS' && context.sessions) {
      for (const k of v.sessionApplicability.sessionKeys) {
        const s = context.sessions.find((x) => x.sessionKey === k && x.examDefinitionKey === v.identity.examDefinitionKey);
        if (!s) err('SESSION_RESTRICTION_INCONSISTENT', at, `session ${k} is not a session of this exam`);
        else if (s.specificationKey !== v.identity.specificationKey) err('SESSION_RESTRICTION_INCONSISTENT', at, `session ${k} examines ${s.specificationKey}, not ${v.identity.specificationKey}`);
      }
    }
  }
  for (const [k, n] of keys) if (n > 1) err('DUPLICATE_BLUEPRINT_IDENTITY', `variants.${k}`, `${n} variants share this identity`);

  // Groups: same exam, specification, purpose and scope.
  const groups = new Map<string, BlueprintVariantV2[]>();
  for (const v of parsed) {
    const g = [v.identity.examDefinitionKey, v.identity.specificationKey, v.identity.purpose, scopeKey(v.identity.scope)].join('|');
    groups.set(g, [...(groups.get(g) ?? []), v]);
  }
  for (const [g, vs] of groups) {
    if (vs.length < 2) continue;
    const distinct = vs.filter((v, i) => vs.findIndex((x) => x.identityKey === v.identityKey) === i);
    if (distinct.filter((v) => v.identity.variant.dimension === 'STANDARD').length > 1) err('OVERLAPPING_VARIANTS_WITHOUT_DISAMBIGUATOR', `groups.${g}`, 'more than one STANDARD variant');
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        const a = distinct[i];
        const b = distinct[j];
        const overlap = sessionsOverlap(a, b);
        if (a.structureFingerprint === b.structureFingerprint) {
          if (a.sessionApplicability.type === 'SESSIONS' || b.sessionApplicability.type === 'SESSIONS') {
            err('STRUCTURE_UNCHANGED_SESSION_VARIANT', `groups.${g}`, `${a.identity.variant.key} / ${b.identity.variant.key}: same structure, different sessions -- session differences (boundaries, conversions) belong to the session layer`);
          } else if (overlap) {
            err('OVERLAPPING_VARIANTS_WITHOUT_DISAMBIGUATOR', `groups.${g}`, `${a.identity.variant.key} / ${b.identity.variant.key}: identical structure for the same sessions`);
          }
        } else if (overlap) {
          warn('AMBIGUOUS_CANDIDATE_SET', `groups.${g}`, `${a.identity.variant.key} / ${b.identity.variant.key} apply to the same sessions: resolution needs a variant key`);
        }
      }
    }
  }
  return { ok: !issues.some((i) => i.severity === 'ERROR'), issues };
}

function sessionsOverlap(a: BlueprintVariantV2, b: BlueprintVariantV2): boolean {
  if (a.sessionApplicability.type === 'ALL_SESSIONS_OF_SPECIFICATION' || b.sessionApplicability.type === 'ALL_SESSIONS_OF_SPECIFICATION') return true;
  const bk = b.sessionApplicability.sessionKeys;
  return a.sessionApplicability.sessionKeys.some((k) => bk.includes(k));
}
