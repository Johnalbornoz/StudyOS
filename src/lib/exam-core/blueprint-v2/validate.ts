/**
 * Blueprint Engine V2 / BP-0 -- the Blueprint validator.
 *
 * Shape (zod) first, then semantics. It never requires a field that is
 * legitimately optional for some exam families (max marks, weights, item
 * counts, sessions, boundaries, routes): it requires them only where a
 * RESOLVED stage depends on them. Findings:
 *
 *  - duplicate component / section / cell / route identifiers;
 *  - invalid weights (out of range; a component set over 100%);
 *  - missing maximum marks where weighting is resolved;
 *  - invalid scoring stages, impossible unit transitions, wrong order;
 *  - stages resolved without an authoritative provenance;
 *  - unresolved references (routes, reporting groups, stage groups, route selection);
 *  - authoritative-looking values without sources;
 *  - resolution / fingerprint inconsistent with the document.
 */
import { BlueprintV2Schema, type BlueprintV2 } from './schema';
import { checkPipelineStructure, resolvePipeline } from './pipeline';
import { isAuthoritativeFact, type Fact } from './provenance';
import { hashCanonical } from '../scoring/scoring-policy';

export interface BlueprintIssue {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  path: string;
  message: string;
}

export interface BlueprintValidation {
  ok: boolean;
  blueprint: BlueprintV2 | null;
  issues: BlueprintIssue[];
}

const EPS = 1e-9;

export function validateBlueprint(input: unknown): BlueprintValidation {
  const parsed = BlueprintV2Schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      blueprint: null,
      issues: parsed.error.issues.map((i) => ({
        code: i.path.some((p) => p === 'output' || p === 'input') ? 'UNSUPPORTED_UNIT' : 'INVALID_SHAPE',
        severity: 'ERROR' as const,
        path: i.path.join('.'),
        message: i.message,
      })),
    };
  }
  const bp = parsed.data;
  const issues: BlueprintIssue[] = [];
  const err = (code: string, path: string, message: string) => issues.push({ code, severity: 'ERROR', path, message });

  // ---- identifiers -------------------------------------------------------
  const compKeys = bp.components.map((c) => c.key);
  for (const k of dupes(compKeys)) err('DUPLICATE_COMPONENT', `components.${k}`, `component key ${k} is used more than once`);
  for (const c of bp.components) for (const k of dupes(c.sections.map((s) => s.key))) err('DUPLICATE_SECTION', `components.${c.key}.sections.${k}`, `section key ${k} repeats within ${c.key}`);
  for (const k of dupes(bp.components.flatMap((c) => c.cells.map((x) => x.cellKey)))) err('DUPLICATE_CELL', `cells.${k}`, `cell ${k} appears more than once`);
  for (const k of dupes(bp.routes.map((r) => r.key))) err('DUPLICATE_ROUTE', `routes.${k}`, `route ${k} is declared more than once`);
  for (const c of bp.components) {
    const planned = c.cells.reduce((n, x) => n + x.positions, 0);
    if (planned !== c.plannedPositions) err('PLANNED_POSITIONS_MISMATCH', `components.${c.key}.plannedPositions`, `cells add up to ${planned}, the component states ${c.plannedPositions}`);
  }

  // ---- references --------------------------------------------------------
  const known = new Set(compKeys);
  for (const r of bp.routes) for (const set of [...r.componentSets, ...(r.stages ?? []).flat()]) for (const k of set) {
    // A blueprint compiled for a subset only carries its own components; routes may name the others.
    if (!known.has(k) && bp.identity.componentScope === 'ALL') err('UNRESOLVED_REFERENCE', `routes.${r.key}`, `route references unknown component ${k}`);
  }
  if (bp.identity.route) {
    const r = bp.routes.find((x) => x.key === bp.identity.route!.routeKey);
    if (!r) err('UNRESOLVED_REFERENCE', 'identity.route', `selected route ${bp.identity.route.routeKey} is not declared`);
    else if (!r.componentSets.some((s) => sameSet(s, bp.identity.route!.componentSet))) err('UNRESOLVED_REFERENCE', 'identity.route', 'the selected component set is not one of the route\'s official sets');
    if (bp.identity.componentScope !== 'SUBSET') for (const k of bp.identity.route.componentSet) if (!known.has(k)) err('UNRESOLVED_REFERENCE', 'identity.route', `selected component ${k} is not in the blueprint`);
  }
  for (const g of bp.reportingGroups) for (const k of g.componentKeys) if (!known.has(k)) err('UNRESOLVED_REFERENCE', `reportingGroups.${g.key}`, `group references unknown component ${k}`);
  for (const s of bp.scoring.pipeline) for (const g of s.params.groups ?? []) for (const k of g.componentKeys) if (!known.has(k)) err('UNRESOLVED_REFERENCE', `scoring.pipeline.${s.kind}`, `group ${g.key} references unknown component ${k}`);

  // ---- weights -----------------------------------------------------------
  for (const c of bp.components) {
    const w = c.official.weightPercent;
    if (w.status === 'STATED' && (!(w.value > 0) || w.value > 100)) err('INVALID_WEIGHT', `components.${c.key}.official.weightPercent`, `weight ${w.value}% is outside (0, 100]`);
  }
  const weightOf = (k: string) => {
    const c = bp.components.find((x) => x.key === k);
    return c && c.official.weightPercent.status === 'STATED' ? c.official.weightPercent.value : null;
  };
  const sets: Array<{ path: string; keys: string[] }> = bp.identity.route
    ? [{ path: 'identity.route', keys: bp.identity.route.componentSet }]
    : bp.routes.length
      ? bp.routes.flatMap((r) => r.componentSets.map((s, i) => ({ path: `routes.${r.key}.componentSets.${i}`, keys: s })))
      : [{ path: 'components', keys: compKeys }];
  for (const set of sets) {
    const ws = set.keys.map(weightOf).filter((x): x is number => x !== null);
    const sum = ws.reduce((a, b) => a + b, 0);
    if (sum > 100 + EPS) err('WEIGHTS_EXCEED_100', set.path, `component weights sum to ${Math.round(sum * 1000) / 1000}% (> 100%)`);
  }

  // ---- pipeline ----------------------------------------------------------
  for (const p of checkPipelineStructure(bp.scoring.pipeline)) err(p.code, `scoring.pipeline.${p.index}`, p.message);
  const weighting = bp.scoring.pipeline.find((s) => s.kind === 'COMPONENT_WEIGHTING');
  if (weighting?.dependency.status === 'RESOLVED') {
    const scope = bp.identity.route?.componentSet ?? compKeys;
    for (const k of scope) {
      const c = bp.components.find((x) => x.key === k);
      if (!c) continue;
      if (!isAuthoritativeFact(c.official.maxMarks)) err('MISSING_MAX_MARKS', `components.${k}.official.maxMarks`, 'COMPONENT_WEIGHTING is RESOLVED but this component has no authoritative maximum marks');
      if (!isAuthoritativeFact(c.official.weightPercent)) err('STAGE_RESOLVED_WITHOUT_AUTHORITY', `components.${k}.official.weightPercent`, 'COMPONENT_WEIGHTING is RESOLVED but this component weight is not authoritative');
    }
    if (bp.routes.length > 0 && !bp.identity.route) err('ROUTE_REQUIRED', 'identity.route', 'COMPONENT_WEIGHTING is RESOLVED but no official component set is selected');
  }
  const expected = resolvePipeline(bp.scoring.pipeline, bp.scoring.resolution.outcomeDeclared);
  if (hashCanonical(expected) !== hashCanonical(bp.scoring.resolution)) err('RESOLUTION_MISMATCH', 'scoring.resolution', `the stated resolution does not follow from the pipeline (expected stop at ${expected.stoppedAt ?? 'end'})`);
  if (bp.session.status === 'RESOLVED') err('SESSION_RESOLUTION_UNSUPPORTED', 'session', 'sessions are not modelled in BP-0; a blueprint cannot claim a resolved session');

  // ---- provenance --------------------------------------------------------
  forEachFact(bp, (path, f) => {
    if (f.status !== 'STATED') return;
    const p = f.provenance;
    if (p.kind !== 'UNKNOWN' && p.kind !== 'THIRD_PARTY_REFERENCE' && p.sourceKeys.length === 0) err('MISSING_PROVENANCE', path, `${p.kind} value without any source`);
    if (p.kind === 'UNKNOWN' && p.authority !== 'NONE') err('MISSING_PROVENANCE', path, 'UNKNOWN provenance cannot carry an authority');
  });

  // ---- integrity ---------------------------------------------------------
  const { fingerprint, ...rest } = bp;
  if (hashCanonical(rest) !== fingerprint) err('FINGERPRINT_MISMATCH', 'fingerprint', 'the fingerprint does not match the document');

  return { ok: !issues.some((i) => i.severity === 'ERROR'), blueprint: bp, issues };
}

function dupes(keys: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const k of keys) (seen.has(k) ? out : seen).add(k);
  return [...out];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k) => b.includes(k));
}

function forEachFact(bp: BlueprintV2, fn: (path: string, f: Fact<unknown>) => void): void {
  for (const [k, f] of Object.entries(bp.framework)) fn(`framework.${k}`, f as Fact<unknown>);
  for (const c of bp.components) {
    for (const [k, f] of Object.entries(c.official)) if (f && typeof f === 'object' && 'status' in f) fn(`components.${c.key}.official.${k}`, f as Fact<unknown>);
    for (const s of c.sections) fn(`components.${c.key}.sections.${s.key}.marksApprox`, s.marksApprox as Fact<unknown>);
    for (const a of c.assessmentObjectives) fn(`components.${c.key}.assessmentObjectives.${a.code}`, a.weightPercent as Fact<unknown>);
    for (const x of c.cells) if (x.marks.source === 'STATED') fn(`cells.${x.cellKey}.marks`, x.marks.value as Fact<unknown>);
  }
}
