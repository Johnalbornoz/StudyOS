/**
 * Blueprint Engine V2 / BP-0 -- the configuration -> Blueprint V2 compiler.
 *
 *   compileBlueprint(examVerticalConfig, options?) -> { blueprint, status, issues, unresolvedFields, provenance }
 *
 * Pure and deterministic (same input -> byte-identical output and
 * fingerprint). It consumes the existing Exam Core configuration exactly as
 * `applyExamVerticalConfig` does -- same components, same positions, same
 * cell keys (`cellKeyOf`), same fingerprint input -- and re-expresses it as a
 * Blueprint V2 document. It never fabricates data:
 *
 *  - a value the configuration does not state is UNKNOWN (with a reason);
 *    a zod schema default (e.g. component `assessment: EXTERNAL`) is not
 *    adopted as a fact;
 *  - official values take the provenance of their registered sources;
 *    StudyUs delivery choices (reduced forms, pacing) are STUDYUS_POLICY;
 *  - weights are never renormalized and a reduced form is never weighted;
 *  - what an exam REPORTS (scale, grade, qualification points) is not in the
 *    configuration: without an explicit, authoritative OutcomeDeclaration the
 *    pipeline ends at the last structural stage and says so;
 *  - session-dependent stages (boundaries, conversions) stay UNRESOLVED:
 *    sessions are not modelled until BP-1.
 *
 * BP-0: the result is a shadow representation. Nothing persists it and no
 * Student-facing decision reads it.
 */
import { parseExamVerticalConfig, type ExamVerticalConfig } from '../vertical-config';
import { EXAM_FAMILY_DESCRIPTORS } from '../taxonomy';
import { hashCanonical } from '../scoring/scoring-policy';
import { cellKeyOf } from '../question-bank/cells';
import { normalizeConstraints } from '../slot-constraints';
import {
  combineProvenance,
  defaultSourceRegistry,
  isAuthoritative,
  isAuthoritativeFact,
  provenanceOfSources,
  stated,
  unknown,
  UNKNOWN_PROVENANCE,
  type Fact,
  type Provenance,
  type SourceRegistry,
} from './provenance';
import { resolvePipeline, STAGE_CONTRACTS, STAGE_ORDER } from './pipeline';
import { BLUEPRINT_SCHEMA_ID, type BlueprintComponent, type BlueprintKind, type BlueprintV2, type PipelineStage, type StageDependency, type StageKind } from './schema';
import { validateBlueprint, type BlueprintIssue } from './validate';

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/**
 * What an exam reports beyond component marks -- a scale, a grade, qualification
 * points. It is an assessment FACT and must be supplied explicitly with its
 * provenance; the compiler never infers it from the exam family.
 */
export interface OutcomeDeclaration {
  provenance: Provenance;
  stages: Array<
    | { kind: 'AREA_GROUPING'; groups: Array<{ key: string; label: string; componentKeys: string[] }> }
    | { kind: 'SCALE_CONVERSION'; scope: 'COMPONENT' | 'AREA' | 'SUBJECT'; scaleKey: string; resolvedPer: 'SESSION' | 'VERSION' }
    | { kind: 'GLOBAL_COMBINATION'; formulaKey: string }
    | { kind: 'GRADE_BOUNDARIES'; scope: 'COMPONENT' | 'AREA' | 'SUBJECT'; scaleKey: string; resolvedPer: 'SESSION' | 'VERSION' }
    | { kind: 'QUALIFICATION_AGGREGATION'; ruleKey: string }
  >;
}

export interface CompileOptions {
  /** Default GENERAL: the configuration's blueprint as the runtime uses it today. */
  blueprintKind?: BlueprintKind;
  /** Restrict to these components (paper / component practice). Order follows the configuration. */
  componentKeys?: string[];
  /** Select one official route and one of its component sets. */
  route?: { routeKey: string; setIndex: number };
  outcome?: OutcomeDeclaration;
  registry?: SourceRegistry;
}

export type CompileStatus = 'COMPLETE' | 'INCOMPLETE' | 'INVALID';

export interface ProvenanceRecord {
  path: string;
  provenance: Provenance;
}

export interface CompileResult {
  blueprint: BlueprintV2 | null;
  /** INVALID: errors; INCOMPLETE: valid but some facts / stages unresolved; COMPLETE: nothing unresolved. */
  status: CompileStatus;
  issues: BlueprintIssue[];
  /** Paths of every value that is UNKNOWN or unresolved (never defaulted). */
  unresolvedFields: string[];
  provenance: ProvenanceRecord[];
}

// ---------------------------------------------------------------------------

type Section = ExamVerticalConfig['sections'][number];
type RawSection = { key?: unknown; definition?: { assessment?: unknown } };

export function compileBlueprint(input: unknown, options: CompileOptions = {}): CompileResult {
  const parsed = parseExamVerticalConfig(input);
  if (!parsed.ok) {
    return {
      blueprint: null,
      status: 'INVALID',
      issues: parsed.issues.map((m) => ({ code: 'CONFIG_INVALID', severity: 'ERROR', path: 'config', message: m })),
      unresolvedFields: [],
      provenance: [],
    };
  }
  const cfg = parsed.config;
  const registry = options.registry ?? defaultSourceRegistry();
  const kind: BlueprintKind = options.blueprintKind ?? 'GENERAL';
  const issues: BlueprintIssue[] = [];
  const unresolved: string[] = [];
  const records: ProvenanceRecord[] = [];
  const issue = (code: string, severity: BlueprintIssue['severity'], path: string, message: string) => issues.push({ code, severity, path, message });

  const sourced = (keys: readonly string[], path: string): Provenance => {
    const { provenance, unregistered } = provenanceOfSources(keys, registry);
    for (const k of unregistered) issue('UNREGISTERED_SOURCE', 'WARNING', path, `source "${k}" is not in the assessment source registry`);
    if (provenance.kind === 'UNKNOWN') issue('NO_AUTHORITATIVE_SOURCE', 'WARNING', path, 'none of the cited sources is registered as an assessment authority');
    records.push({ path, provenance });
    return provenance;
  };
  const fact = <T>(value: T | null | undefined, p: Provenance, path: string, reason: string): Fact<T> => {
    if (value === null || value === undefined) {
      unresolved.push(path);
      return unknown<T>(reason);
    }
    return stated(value, p);
  };

  // ---- framework / version ------------------------------------------------
  const fw = cfg.framework;
  const fwProv = fw ? sourced(fw.sourceKeys, 'framework') : UNKNOWN_PROVENANCE;
  if (!fw) issue('FRAMEWORK_VERSIONING_MISSING', 'WARNING', 'framework', 'the configuration declares no framework versioning or sources (V1 configuration)');
  const fwFact = <T>(v: T | null | undefined, field: string, reason: string) => fact<T>(fw ? v : null, fwProv, `framework.${field}`, fw ? reason : 'no framework versioning in the configuration');
  const framework: BlueprintV2['framework'] = {
    frameworkKey: fwFact(fw?.frameworkKey, 'frameworkKey', 'not stated'),
    curriculumVersion: fwFact(fw?.curriculumVersion, 'curriculumVersion', 'not stated'),
    frameworkVersion: fwFact(fw?.frameworkVersion, 'frameworkVersion', 'not stated'),
    syllabusCode: fwFact(fw?.syllabusCode, 'syllabusCode', 'no syllabus code stated'),
    firstAssessment: fwFact(fw?.firstAssessment, 'firstAssessment', 'not stated'),
    lastAssessment: fwFact(fw?.lastAssessment, 'lastAssessment', 'no last assessment stated'),
  };

  // ---- routes and component selection --------------------------------------
  const routes: BlueprintV2['routes'] = (cfg.assessmentRoutes ?? []).map((r) => {
    if (fw) issue('ROUTE_PROVENANCE_INHERITED', 'INFO', `routes.${r.key}`, 'routes carry no own source keys; they inherit the framework sources');
    return { key: r.key, label: r.label, componentSets: r.componentSets, stages: r.stages ?? null, provenance: fwProv };
  });
  let route: BlueprintV2['identity']['route'] = null;
  let scope: Section[] = cfg.sections;
  if (options.route) {
    const r = routes.find((x) => x.key === options.route!.routeKey);
    const set = r?.componentSets[options.route.setIndex];
    if (!r) issue('ROUTE_UNKNOWN', 'ERROR', 'identity.route', `route ${options.route.routeKey} is not declared by this version`);
    else if (!set) issue('ROUTE_SET_UNKNOWN', 'ERROR', 'identity.route', `route ${r.key} has no component set #${options.route.setIndex}`);
    else {
      route = { routeKey: r.key, componentSet: set };
      scope = cfg.sections.filter((s) => set.includes(s.key));
    }
  }
  if (options.componentKeys) {
    const unknownKeys = options.componentKeys.filter((k) => !cfg.sections.some((s) => s.key === k));
    for (const k of unknownKeys) issue('UNKNOWN_COMPONENT_SELECTION', 'ERROR', 'options.componentKeys', `component ${k} is not in the configuration`);
    scope = scope.filter((s) => options.componentKeys!.includes(s.key));
    if (scope.length === 0) issue('EMPTY_COMPONENT_SELECTION', 'ERROR', 'options.componentKeys', 'the selection leaves no component');
  }
  if (routes.length > 0 && !route) unresolved.push('identity.route');

  // ---- components --------------------------------------------------------
  const rawSections = (((input as { sections?: unknown[] }) ?? {}).sections ?? []) as RawSection[];
  const components: BlueprintComponent[] = scope.map((section) => compileComponent(section, cfg.sections.indexOf(section), rawSections.find((r) => r.key === section.key), { fact, sourced, issue, unresolved }));
  if (components.length === 0) {
    return { blueprint: null, status: 'INVALID', issues, unresolvedFields: [], provenance: records };
  }

  // ---- scoring pipeline --------------------------------------------------
  const pipeline: PipelineStage[] = [];
  const push = (k: StageKind, dependency: StageDependency, params: PipelineStage['params'] = {}) => {
    const input = pipeline.length === 0 ? 'ITEM_RESPONSE' : pipeline[pipeline.length - 1].output;
    pipeline.push({ kind: k, input, output: STAGE_CONTRACTS[k].output, dependency, params });
  };
  const dep = (k: StageDependency['kind'], resolvedPer: StageDependency['resolvedPer'], status: StageDependency['status'], provenance: Provenance, reason: string | null): StageDependency => ({ kind: k, resolvedPer, status, provenance, reason });

  push('ITEM_MARKS', dep('ITEM_MARKSCHEME', 'ITEM', 'RESOLVED', UNKNOWN_PROVENANCE, null));
  const maxFacts = components.map((c) => c.official.maxMarks);
  push('COMPONENT_TOTAL', dep('COMPONENT_MAX_MARKS', 'VERSION', 'RESOLVED', maxFacts.every(isAuthoritativeFact) ? combineProvenance(maxFacts.map((f) => (f as { provenance: Provenance }).provenance)) : UNKNOWN_PROVENANCE, null));

  const outcome = options.outcome;
  const outcomeAuthoritative = outcome ? isAuthoritative(outcome.provenance) : false;
  if (outcome && !outcomeAuthoritative) issue('OUTCOME_DECLARATION_NOT_AUTHORITATIVE', 'WARNING', 'scoring.outcome', `the outcome declaration has provenance ${outcome.provenance.kind}; its stages cannot resolve`);
  const declared = new Map((outcome?.stages ?? []).map((s) => [s.kind, s] as const));
  if (outcome && declared.size !== outcome.stages.length) issue('DUPLICATE_STAGE', 'ERROR', 'scoring.outcome', 'the outcome declaration repeats a stage');

  for (const k of STAGE_ORDER.slice(2)) {
    if (k === 'COMPONENT_WEIGHTING') {
      if (components.some((c) => c.official.weightPercent.status === 'STATED')) push(k, weightingDependency(components, routes, route, issue));
      continue;
    }
    const d = declared.get(k as never) as OutcomeDeclaration['stages'][number] | undefined;
    if (!d) continue;
    const prov = outcome!.provenance;
    if (d.kind === 'AREA_GROUPING') {
      for (const g of d.groups) for (const ck of g.componentKeys) if (!components.some((c) => c.key === ck)) issue('UNRESOLVED_REFERENCE', 'ERROR', `scoring.outcome.AREA_GROUPING.${g.key}`, `group references unknown component ${ck}`);
      push(k, dep('REPORTING_GROUPS', 'VERSION', outcomeAuthoritative ? 'RESOLVED' : 'UNRESOLVED', prov, outcomeAuthoritative ? null : 'OUTCOME_DECLARATION_NOT_AUTHORITATIVE'), { groups: d.groups });
    } else if (d.kind === 'SCALE_CONVERSION') {
      push(k, dep('SCALE_CONVERSION', d.resolvedPer, 'UNRESOLVED', prov, unresolvedReason(outcomeAuthoritative, d.resolvedPer, 'SCALE_CONVERSION_TABLE_NOT_AVAILABLE')), { scope: d.scope, scaleKey: d.scaleKey });
    } else if (d.kind === 'GLOBAL_COMBINATION') {
      push(k, dep('GLOBAL_FORMULA', 'VERSION', 'UNRESOLVED', prov, unresolvedReason(outcomeAuthoritative, 'VERSION', 'GLOBAL_FORMULA_NOT_AVAILABLE')), { formulaKey: d.formulaKey });
    } else if (d.kind === 'GRADE_BOUNDARIES') {
      push(k, dep('GRADE_BOUNDARIES', d.resolvedPer, 'UNRESOLVED', prov, unresolvedReason(outcomeAuthoritative, d.resolvedPer, 'GRADE_BOUNDARIES_NOT_AVAILABLE')), { scope: d.scope, scaleKey: d.scaleKey });
    } else if (d.kind === 'QUALIFICATION_AGGREGATION') {
      push(k, dep('QUALIFICATION_RULE', 'QUALIFICATION', 'UNRESOLVED', prov, unresolvedReason(outcomeAuthoritative, 'QUALIFICATION', 'QUALIFICATION_RULE_NOT_AVAILABLE')), { ruleKey: d.ruleKey });
    }
  }
  if (!outcome) {
    unresolved.push('scoring.reportedOutcome');
    issue('OUTCOME_NOT_DECLARED', 'INFO', 'scoring', 'the configuration does not declare what the exam reports (scale / grade / points); the pipeline ends at the last structural stage');
  }
  for (const s of pipeline) if (s.dependency.status === 'UNRESOLVED') unresolved.push(`scoring.pipeline.${s.kind}`);
  const resolution = resolvePipeline(pipeline, Boolean(outcome));

  // ---- runtime V1 parity reference --------------------------------------
  const policy = cfg.scoring.policy;
  if (policy.transform.type !== 'NONE' && !policy.provenance.official) issue('LEGACY_TRANSFORM_NOT_OFFICIAL', 'INFO', 'scoring.runtimeV1', `the V1 runtime applies a non-official ${policy.transform.type} transform; it is not part of the V2 pipeline`);
  if (policy.strategy === 'SECTION_WEIGHTED' && !policy.provenance.official) issue('LEGACY_SECTION_WEIGHTS_NOT_OFFICIAL', 'INFO', 'scoring.runtimeV1', 'V1 section weights are a fixture policy, not official component weights');
  if ((policy.transform.type === 'NONE' || policy.transform.type === 'BANDS') && policy.unit !== undefined && policy.unit !== '%') {
    issue('LEGACY_UNIT_MISMATCH', 'WARNING', 'scoring.runtimeV1', `the V1 result is a percentage, but the policy labels its unit "${policy.unit}"`);
  }

  // ---- session ------------------------------------------------------------
  const requiredByPipeline = pipeline.some((s) => s.dependency.resolvedPer === 'SESSION');
  if (requiredByPipeline) unresolved.push('session');

  // ---- kind constraints ---------------------------------------------------
  if ((kind === 'FULL_MOCK' || kind === 'REDUCED_MOCK') && cfg.structureOnly) issue('STRUCTURE_ONLY_NOT_DELIVERABLE', 'ERROR', 'identity.blueprintKind', `${kind} cannot be built from a structure-only configuration (no bank)`);
  if (kind === 'FULL_MOCK') {
    for (const c of components) if (c.lengthFidelity !== 'OFFICIAL_LENGTH') issue('FULL_MOCK_NOT_OFFICIAL_LENGTH', 'ERROR', `components.${c.key}`, `a FULL_MOCK needs the official length; this component is ${c.lengthFidelity}`);
    if (routes.length > 0 && !route) issue('ROUTE_REQUIRED', 'ERROR', 'identity.route', 'a FULL_MOCK of a version with official routes must select one complete component set');
  }

  const fingerprintInput = hashCanonical(cfg);
  const descriptor = EXAM_FAMILY_DESCRIPTORS[cfg.family];
  const body: Omit<BlueprintV2, 'fingerprint'> = {
    schema: BLUEPRINT_SCHEMA_ID,
    identity: {
      examFamily: cfg.family,
      ecosystem: descriptor.ecosystem,
      examDefinitionKey: cfg.key,
      examDefinitionName: cfg.definition.name,
      purpose: cfg.definition.purpose,
      versionLabel: cfg.version.label,
      blueprintKind: kind,
      blueprintVersion: `config:${fingerprintInput.slice(0, 12)}`,
      route,
      componentScope: options.componentKeys && components.length < (route ? route.componentSet.length : cfg.sections.length) ? 'SUBSET' : route ? 'ROUTE_SET' : 'ALL',
      sourceConfigFingerprint: fingerprintInput,
    },
    context: {
      organization: cfg.organization.name,
      programme: { name: cfg.programme.name, type: cfg.programme.type, stage: cfg.programme.stage ?? null },
      qualification: cfg.qualification?.name ?? null,
      subject: cfg.subject?.name ?? null,
      level: cfg.subject?.level ?? null,
      domains: cfg.definition.domains ?? [],
      contentStatus: cfg.contentStatus,
      structureOnly: cfg.structureOnly ?? false,
    },
    framework,
    session: {
      requiredByPipeline,
      status: 'UNKNOWN',
      reason: 'Exam sessions are not modelled yet (BP-1); the configured label is a hint, not a session.',
      configuredSessionLabel: cfg.version.examSession ?? null,
      configuredExamYear: cfg.version.examYear ?? null,
    },
    components,
    routes,
    reportingGroups: (cfg.reporting?.groups ?? [])
      .filter((g) => g.sectionKeys.every((k) => components.some((c) => c.key === k)))
      .map((g) => ({ key: g.key, label: g.label, componentKeys: g.sectionKeys, institutionDefined: g.institutionDefined ?? false })),
    commandTerms: cfg.commandTerms.map((t) => ({ term: t.term, expectedReasoningType: t.expectedReasoningType ?? null })),
    scoring: {
      pipeline,
      resolution,
      runtimeV1: {
        engine: policy.engine,
        strategy: policy.strategy,
        transform: policy.transform.type,
        unit: policy.unit ?? null,
        official: policy.provenance.official,
        policyHash: hashCanonical(policy),
      },
    },
    qualificationAggregation: cfg.aggregation ? { groupKey: cfg.aggregation.qualificationGroupKey, groupName: cfg.aggregation.groupName, subjectGroup: cfg.aggregation.subjectGroup } : null,
  };
  const blueprint: BlueprintV2 = { ...body, fingerprint: blueprintFingerprint(body) };

  // ---- validation (the same validator hand-written blueprints go through) --
  const validation = validateBlueprint(blueprint);
  for (const v of validation.issues) if (!issues.some((i) => i.code === v.code && i.path === v.path && i.message === v.message)) issues.push(v);

  const unresolvedFields = [...new Set(unresolved)].sort();
  const status: CompileStatus = issues.some((i) => i.severity === 'ERROR') ? 'INVALID' : unresolvedFields.length ? 'INCOMPLETE' : 'COMPLETE';
  return { blueprint, status, issues, unresolvedFields, provenance: records };
}

/** sha256 of the canonical document without its own fingerprint. */
export function blueprintFingerprint(body: Omit<BlueprintV2, 'fingerprint'> | BlueprintV2): string {
  const { fingerprint: _omit, ...rest } = body as BlueprintV2;
  void _omit;
  return hashCanonical(rest);
}

function unresolvedReason(authoritative: boolean, per: 'SESSION' | 'VERSION' | 'QUALIFICATION', dataReason: string): string {
  if (!authoritative) return 'OUTCOME_DECLARATION_NOT_AUTHORITATIVE';
  return per === 'SESSION' ? `SESSION_NOT_RESOLVED: ${dataReason}` : dataReason;
}

interface Ctx {
  fact: <T>(value: T | null | undefined, p: Provenance, path: string, reason: string) => Fact<T>;
  sourced: (keys: readonly string[], path: string) => Provenance;
  issue: (code: string, severity: BlueprintIssue['severity'], path: string, message: string) => void;
  unresolved: string[];
}

function compileComponent(section: Section, order: number, raw: RawSection | undefined, ctx: Ctx): BlueprintComponent {
  const path = `components.${section.key}`;
  const d = section.definition;
  const noDef = 'no component definition in the configuration';
  let official: BlueprintComponent['official'];
  let prov: Provenance = UNKNOWN_PROVENANCE;
  if (d) {
    prov = ctx.sourced(d.sourceKeys, `${path}.official`);
    const f = <T>(v: T | null | undefined, field: string, reason: string) => ctx.fact<T>(v, prov, `${path}.official.${field}`, reason);
    // `assessment` has a schema default (EXTERNAL); only an explicitly configured value is a fact.
    const assessmentStated = raw?.definition?.assessment !== undefined;
    official = {
      name: f(d.officialName, 'name', 'not stated'),
      code: f(d.componentCode, 'code', 'no official component code stated'),
      kind: f(d.kind, 'kind', 'not stated'),
      assessment: f(assessmentStated ? d.assessment : null, 'assessment', 'not stated in the configuration (the schema default is not adopted as a fact)'),
      durationMinutes: f(d.officialDurationMinutes, 'durationMinutes', 'no official duration stated'),
      maxMarks: f(d.maxMarks, 'maxMarks', 'no official maximum marks stated'),
      weightPercent: f(d.weightingPercent, 'weightPercent', 'no official weighting stated'),
      itemCount: f(d.officialItemCount, 'itemCount', 'no official item count stated'),
      calculatorPolicy: f(d.calculatorPolicy, 'calculatorPolicy', 'no calculator rule stated'),
      responseFormats: f(d.responseFormats, 'responseFormats', 'not stated'),
      resources: d.resources ?? [],
      limitations: d.limitations,
    };
  } else {
    ctx.issue('COMPONENT_DEFINITION_MISSING', 'WARNING', path, 'no official component definition: every structural fact is UNKNOWN');
    const u = <T>(field: string) => ctx.fact<T>(null, prov, `${path}.official.${field}`, noDef);
    official = {
      name: u('name'), code: u('code'), kind: u('kind'), assessment: u('assessment'), durationMinutes: u('durationMinutes'), maxMarks: u('maxMarks'),
      weightPercent: u('weightPercent'), itemCount: u('itemCount'), calculatorPolicy: u('calculatorPolicy'), responseFormats: u('responseFormats'),
      resources: [], limitations: [],
    };
  }

  // Cells: exactly the grouping `deriveBlueprintCells` applies to the target rows the apply service writes.
  const cells = new Map<string, BlueprintComponent['cells'][number]>();
  const reasoningByCell = new Map<string, string | null>();
  for (const o of section.objectives) {
    for (const t of o.targets) {
      // Slot requirements are part of the cell identity exactly as the runtime keys them (apply writes them normalized).
      const constraints = normalizeConstraints(t.constraints);
      const key = cellKeyOf(section.key, o.code, t.questionType ?? null, t.difficultyMin ?? null, t.difficultyMax ?? null, t.commandTerm ?? null, constraints);
      const existing = cells.get(key);
      if (existing) {
        existing.positions += t.count;
        if ((t.reasoningRequirement ?? null) !== reasoningByCell.get(key)) ctx.issue('CELL_MERGED_DIFFERENT_REASONING', 'WARNING', `${path}.cells.${key}`, 'targets with different reasoning requirements share one cell (as in the runtime cell model)');
        continue;
      }
      reasoningByCell.set(key, t.reasoningRequirement ?? null);
      cells.set(key, {
        cellKey: key,
        objectiveCode: o.code,
        objectiveDescription: o.description,
        positions: t.count,
        eligibility: {
          learningObjectiveCodes: [o.code],
          questionType: t.questionType ?? null,
          difficulty: t.difficultyMin !== undefined || t.difficultyMax !== undefined ? { scale: 'DECLARED_1_5', min: t.difficultyMin ?? null, max: t.difficultyMax ?? null } : null,
          commandTerm: t.commandTerm ?? null,
          reasoningRequirement: t.reasoningRequirement ?? null,
          ...(constraints.length ? { constraints } : {}),
        },
        marks: { source: 'ITEM_MARKSCHEME' },
      });
    }
  }
  const cellList = [...cells.values()];
  const plannedPositions = cellList.reduce((n, c) => n + c.positions, 0);
  const itemCount = official.itemCount.status === 'STATED' ? official.itemCount.value : null;
  const lengthFidelity: BlueprintComponent['lengthFidelity'] =
    itemCount !== null ? (plannedPositions >= itemCount ? 'OFFICIAL_LENGTH' : 'REDUCED') : official.maxMarks.status === 'STATED' ? 'DEPENDS_ON_ITEM_MARKS' : 'UNKNOWN';

  const policy = <T>(value: T | undefined, note: string) => (value === undefined ? null : { origin: 'STUDYUS_POLICY' as const, value, note });
  return {
    key: section.key,
    order,
    name: section.name,
    componentType: section.componentType,
    simulationCapable: section.simulationCapable,
    official,
    sections: (d?.sections ?? []).map((s) => ({
      key: s.key,
      label: s.label,
      marksApprox: ctx.fact<number>(s.marksApprox, prov, `${path}.sections.${s.key}.marksApprox`, 'no approximate marks stated'),
      responseKind: s.responseKind ?? null,
    })),
    assessmentObjectives: (d?.assessmentObjectives ?? []).map((a) => ({
      code: a.code,
      label: a.label,
      weightPercent: ctx.fact<string>(a.weightPercent, prov, `${path}.assessmentObjectives.${a.code}.weightPercent`, 'no weighting stated'),
    })),
    distributions: (d?.distributions ?? []).map((x) => ({ dimension: x.dimension, values: x.values, provenance: prov })),
    commandTerms: d?.commandTerms ?? [],
    delivery: {
      durationMinutes: policy(section.durationMinutes, 'StudyUs form timing (proportional / reduced), not the official duration'),
      toolRules: section.toolRules ?? null,
      targetDifficultyIndex: policy(section.targetDifficultyIndex, 'StudyUs form difficulty target'),
      blueprintWeight: policy(section.weight, 'StudyUs blueprint allocation weight, not an official component weight'),
    },
    cells: cellList,
    ...(allocationOf(d, ctx) ? { allocation: allocationOf(d, ctx)! } : {}),
    plannedPositions,
    lengthFidelity,
  };
}

/** definition.blueprintSpecification -> the blueprint's allocation, with provenance per origin (never laundered). */
function allocationOf(d: Section['definition'], ctx: Ctx): BlueprintComponent['allocation'] | null {
  const spec = d?.blueprintSpecification;
  if (!spec || (!spec.margins?.length && !spec.cells && !spec.policies?.length)) return null;
  const prov = (origin: 'OFFICIAL' | 'OFFICIAL_DERIVED' | 'STUDYUS_POLICY', keys: readonly string[], path: string) =>
    origin === 'STUDYUS_POLICY' ? UNKNOWN_PROVENANCE : ctx.sourced(keys, path);
  return {
    status: spec.status,
    margins: (spec.margins ?? []).map((m) => ({ dimension: m.dimension, totals: m.totals, origin: m.provenance, provenance: prov(m.provenance, m.sourceKeys, `allocation.margins.${m.dimension}`), note: m.note ?? null })),
    cells: spec.cells ? { counts: spec.cells.counts.map((c) => ({ constraints: normalizeConstraints(c.constraints), count: c.count })), origin: spec.cells.provenance, provenance: prov(spec.cells.provenance, spec.cells.sourceKeys, 'allocation.cells'), note: spec.cells.note ?? null } : null,
    policies: (spec.policies ?? []).map((x) => ({ key: x.key, origin: x.provenance, provenance: prov(x.provenance, x.sourceKeys, `allocation.policies.${x.key}`), note: x.note ?? null })),
  };
}

function weightingDependency(components: BlueprintComponent[], routes: BlueprintV2['routes'], route: BlueprintV2['identity']['route'], issue: Ctx['issue']): StageDependency {
  const base = { kind: 'COMPONENT_WEIGHTS' as const, resolvedPer: 'VERSION' as const };
  if (routes.length > 0 && !route) return { ...base, status: 'UNRESOLVED', provenance: UNKNOWN_PROVENANCE, reason: 'ROUTE_NOT_SELECTED: component weights apply to one official component set' };
  // A weight shared by several components (e.g. one published weight for a paper delivered as two parts) is
  // not split here: each weighted component needs its own stated weight.
  const notStated = components.filter((c) => c.official.weightPercent.status !== 'STATED').map((c) => c.key);
  if (notStated.length) return { ...base, status: 'UNRESOLVED', provenance: UNKNOWN_PROVENANCE, reason: `WEIGHT_NOT_STATED: ${notStated.join(', ')}` };
  const noAuthority = components.filter((c) => !isAuthoritativeFact(c.official.weightPercent)).map((c) => c.key);
  if (noAuthority.length) return { ...base, status: 'UNRESOLVED', provenance: UNKNOWN_PROVENANCE, reason: `WEIGHT_NOT_AUTHORITATIVE: ${noAuthority.join(', ')}` };
  const noMax = components.filter((c) => !isAuthoritativeFact(c.official.maxMarks)).map((c) => c.key);
  if (noMax.length) {
    for (const k of noMax) issue('MISSING_MAX_MARKS', 'WARNING', `components.${k}.official.maxMarks`, 'a weighted component needs its official maximum marks');
    return { ...base, status: 'UNRESOLVED', provenance: UNKNOWN_PROVENANCE, reason: `MAX_MARKS_REQUIRED_FOR_WEIGHTING: ${noMax.join(', ')}` };
  }
  const total = components.reduce((n, c) => n + (c.official.weightPercent as { value: number }).value, 0);
  if (total < 100 - 1e-9) issue('WEIGHTS_PARTIAL_COVERAGE', 'INFO', 'scoring.pipeline.COMPONENT_WEIGHTING', `the configured components carry ${round(total)}% of the subject; a weighted score covers only that share (never renormalized)`);
  return { ...base, status: 'RESOLVED', provenance: combineProvenance(components.map((c) => (c.official.weightPercent as { provenance: Provenance }).provenance)), reason: null };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
