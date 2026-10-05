/**
 * Blueprint Engine V2 / BP-1 -- compileExam: Exam Definition + Sessions +
 * Outcome Specification on top of the BP-0 compiler.
 *
 *   compileExam(config, { outcome?, sessions?, blueprint?, asOf? }) ->
 *     { blueprint, examDefinition, sessions, sessionRequirements,
 *       outcomeSpecification, completeness, status, issues, unresolvedFields, provenance }
 *
 * - The blueprint is exactly `compileBlueprint` (same document, same
 *   fingerprint when no outcome is declared): BP-1 adds layers, it does not
 *   fork the representation.
 * - The Exam Definition is derived from the GENERAL blueprint (all
 *   components) even when the requested blueprint is a candidate subset;
 *   `completeness` is the requested candidate's, `examDefinition.completeness`
 *   the whole exam's.
 * - Outcomes become BP-0 pipeline stages through `outcomeToDeclaration`.
 * - Sessions are an INPUT catalogue (BP-1 loads none from any source);
 *   each is checked against the definition and its specification.
 * - Pure and deterministic: no clock (dates are checked only against `asOf`).
 */
import { compileBlueprint, type CompileOptions, type CompileResult, type ProvenanceRecord } from './compiler';
import type { BlueprintIssue } from './validate';
import { stated, unknown, UNKNOWN_PROVENANCE, type Fact } from './provenance';
import type { BlueprintV2 } from './schema';
import { buildOutcomeSpecification, outcomeToDeclaration, resultCompleteness, STAGE_SESSION_RULE, type OutcomeSpecificationInput, type OutcomeSpecificationV2, type ResultCompleteness } from './outcome';
import { checkSession, sessionHasRule, type ExamSessionInput, type ExamSessionV2, type SessionDependency } from './session';
import { componentCoverage, definitionComponent, definitionFingerprint, deriveCapabilities, legacyRuntimeReading, validateExamDefinition, type ExamDefinitionV2 } from './exam-definition';
import { RETIRED_V2_CONFIG_KEYS } from '../verticals/v2';

export interface CompileExamOptions {
  /** Candidate blueprint selection (kind / route / components), as in BP-0. */
  blueprint?: Omit<CompileOptions, 'outcome' | 'registry'>;
  outcome?: OutcomeSpecificationInput;
  sessions?: ExamSessionInput[];
  /** Reference date for session status checks (never the wall clock). */
  asOf?: string;
  /** Compute completeness for this session (must be in `sessions`). */
  forSessionKey?: string;
  registry?: CompileOptions['registry'];
}

export interface CompileExamResult {
  blueprint: BlueprintV2 | null;
  examDefinition: ExamDefinitionV2 | null;
  sessions: ExamSessionV2[];
  sessionRequirements: SessionDependency[];
  outcomeSpecification: OutcomeSpecificationV2 | null;
  completeness: ResultCompleteness | null;
  status: CompileResult['status'];
  issues: BlueprintIssue[];
  unresolvedFields: string[];
  provenance: ProvenanceRecord[];
}

export function compileExam(input: unknown, options: CompileExamOptions = {}): CompileExamResult {
  const empty = (base: CompileResult): CompileExamResult => ({ blueprint: base.blueprint, examDefinition: null, sessions: [], sessionRequirements: [], outcomeSpecification: null, completeness: null, status: 'INVALID', issues: base.issues, unresolvedFields: base.unresolvedFields, provenance: base.provenance });

  // 1. The GENERAL compile (all components) carries the definition; parse failures stop here.
  const probe = compileBlueprint(input, { registry: options.registry });
  if (!probe.blueprint) return empty(probe);
  const allKeys = probe.blueprint.components.map((c) => c.key);

  // 2. Outcomes -> BP-0 stages (one representation).
  const { declaration, issues: outcomeIssues } = outcomeToDeclaration(options.outcome, allKeys);
  const general = compileBlueprint(input, { registry: options.registry, outcome: declaration });
  const requested = options.blueprint && Object.keys(options.blueprint).length ? compileBlueprint(input, { ...options.blueprint, registry: options.registry, outcome: declaration }) : general;
  if (!general.blueprint || !requested.blueprint) return empty(requested.blueprint ? general : requested);
  const bp = general.blueprint;

  const issues: BlueprintIssue[] = [...requested.issues];
  const unresolved = new Set(requested.unresolvedFields);
  const push = (i: BlueprintIssue) => {
    if (!issues.some((x) => x.code === i.code && x.path === i.path && x.message === i.message)) issues.push(i);
  };
  outcomeIssues.forEach(push);

  // 3. Sessions (input catalogue).
  const sessions: ExamSessionV2[] = [];
  const definitionKey = bp.identity.examDefinitionKey;
  const fw = bp.framework;
  const specKey: Fact<string> =
    fw.frameworkKey.status === 'STATED' && fw.frameworkVersion.status === 'STATED'
      ? stated(`${fw.frameworkKey.value}@${fw.frameworkVersion.value}`, fw.frameworkKey.provenance)
      : unknown('the configuration states no framework key + version');
  for (const raw of options.sessions ?? []) {
    const { session, issues: si } = checkSession(raw, { asOf: options.asOf });
    si.forEach(push);
    if (!session) continue;
    const at = `sessions.${session.sessionKey}`;
    if (sessions.some((s) => s.sessionKey === session.sessionKey)) push({ code: 'DUPLICATE_SESSION', severity: 'ERROR', path: at, message: 'session key used twice' });
    if (session.examDefinitionKey !== definitionKey) push({ code: 'SESSION_DEFINITION_MISMATCH', severity: 'ERROR', path: at, message: `session belongs to ${session.examDefinitionKey}, not ${definitionKey}` });
    if (specKey.status !== 'STATED') push({ code: 'SESSION_SPECIFICATION_UNRESOLVED', severity: 'WARNING', path: at, message: 'the definition has no stated specification version to bind the session to' });
    else if (session.specificationKey !== specKey.value) push({ code: 'SESSION_SPECIFICATION_MISMATCH', severity: 'ERROR', path: at, message: `session examines ${session.specificationKey}, the definition's specification is ${specKey.value}` });
    const year = session.administration.year.status === 'STATED' ? session.administration.year.value : null;
    const first = fw.firstAssessment.status === 'STATED' ? fw.firstAssessment.value : null;
    const last = fw.lastAssessment.status === 'STATED' ? fw.lastAssessment.value : null;
    if (year !== null && ((first !== null && year < first) || (last !== null && year > last))) push({ code: 'SESSION_OUTSIDE_SPECIFICATION', severity: 'ERROR', path: at, message: `year ${year} is outside the specification's assessment window ${first ?? '?'}–${last ?? 'open'}` });
    sessions.push(session);
  }

  // 4. Outcome specification + session dependencies (derived from the same pipeline).
  const outcome = buildOutcomeSpecification(bp, options.outcome, outcomeIssues);
  const components = bp.components.map(definitionComponent);
  const dependencies: SessionDependency[] = [];
  for (const s of bp.scoring.pipeline) {
    const rule = STAGE_SESSION_RULE[s.kind];
    if (!rule || s.dependency.resolvedPer === 'ITEM') continue;
    dependencies.push({
      rule,
      dependence: s.dependency.resolvedPer === 'SESSION' ? 'SESSION_DEPENDENT' : 'SESSION_INDEPENDENT',
      basis: 'DECLARED',
      requiredFor: s.kind,
      scope: null,
      provenance: s.dependency.provenance,
      loadedInSessions: s.dependency.resolvedPer === 'SESSION' ? sessions.filter((x) => sessionHasRule(x, rule)).map((x) => x.sessionKey) : [],
    });
  }
  const timed = components.filter((c) => c.componentClass === 'TIMED_TEST').map((c) => c.key);
  if (timed.length) dependencies.push({ rule: 'TIMETABLE', dependence: 'SESSION_DEPENDENT', basis: 'DEFINITIONAL', requiredFor: 'DELIVERY', scope: { componentKeys: timed }, provenance: UNKNOWN_PROVENANCE, loadedInSessions: sessions.filter((x) => sessionHasRule(x, 'TIMETABLE')).map((x) => x.sessionKey) });
  if (bp.routes.length) {
    for (const rule of ['ROUTE_AVAILABILITY', 'PERMITTED_COMPONENT_COMBINATIONS'] as const) {
      dependencies.push({ rule, dependence: 'POSSIBLY_SESSION_DEPENDENT', basis: 'POSSIBLE', requiredFor: 'COMPONENT_WEIGHTING', scope: null, provenance: bp.routes[0].provenance, loadedInSessions: sessions.filter((x) => sessionHasRule(x, rule)).map((x) => x.sessionKey) });
    }
  }

  // 5. Completeness (optionally for one session).
  let forSession: ExamSessionV2 | null = null;
  if (options.forSessionKey) {
    forSession = sessions.find((s) => s.sessionKey === options.forSessionKey) ?? null;
    if (!forSession) push({ code: 'UNRESOLVED_REFERENCE', severity: 'ERROR', path: 'options.forSessionKey', message: `session ${options.forSessionKey} is not in the supplied catalogue` });
  }
  // The definition's completeness is the exam's (all components); the result's is the requested candidate's
  // (e.g. one official route set can reach weighting even when the exam as a whole cannot).
  const definitionCompleteness = resultCompleteness(bp, outcome, forSession);
  const completeness = requested === general ? definitionCompleteness : resultCompleteness(requested.blueprint, outcome, forSession);

  // 6. Definition.
  const so: ExamDefinitionV2['identity']['subjectOrDomain'] = bp.context.subject
    ? { kind: 'SUBJECT', name: bp.context.subject, domains: bp.context.domains }
    : bp.context.domains.length
      ? { kind: 'DOMAIN_SET', name: null, domains: bp.context.domains }
      : { kind: 'TEST', name: null, domains: [] };
  const legacy = legacyRuntimeReading(bp.scoring.runtimeV1);
  if (legacy.finalScore.status === 'UNIT_LABEL_CONFLICT') {
    push({ code: 'LEGACY_FINAL_SCORE_NOT_RAW_MARKS', severity: 'WARNING', path: 'legacyRuntime.finalScore', message: `the V1 result is labelled "${legacy.finalScore.declaredUnit}" but is a percentage of delivered marks; it is never read as RawMarks (raw marks come from raw_score / max_score)` });
    unresolved.add('legacyRuntime.finalScore.unit');
  }
  const body: Omit<ExamDefinitionV2, 'fingerprint'> = {
    schema: 'studyus.exam-definition/v2',
    identity: {
      definitionKey,
      family: bp.identity.examFamily,
      ecosystem: bp.identity.ecosystem,
      name: bp.identity.examDefinitionName,
      organization: bp.context.organization,
      programme: { name: bp.context.programme.name, type: bp.context.programme.type },
      qualification: bp.context.qualification,
      subjectOrDomain: so,
      level: bp.context.level,
    },
    specification: {
      key: specKey,
      syllabusCode: fw.syllabusCode,
      curriculumVersion: fw.curriculumVersion,
      firstAssessment: fw.firstAssessment,
      lastAssessment: fw.lastAssessment,
      configurationLabel: bp.identity.versionLabel,
      sourceConfigFingerprint: bp.identity.sourceConfigFingerprint,
    },
    assessmentModel: {
      structure: bp.routes.length ? 'ROUTED' : components.length > 1 ? 'MULTI_COMPONENT' : 'SINGLE_FORM',
      routeKeys: bp.routes.map((r) => r.key),
      componentCoverage: componentCoverage(components, bp.routes.length > 0),
    },
    components,
    sessionPolicy: {
      administration: 'UNKNOWN',
      configuredHint: bp.session.configuredSessionLabel,
      configuredExamYear: bp.session.configuredExamYear,
      dependencies,
      sessionsKnown: sessions.map((s) => s.sessionKey),
    },
    outcome,
    capabilities: deriveCapabilities(components, bp, outcome, dependencies),
    completeness: definitionCompleteness,
    legacyRuntime: legacy,
    lifecycle: { configuration: RETIRED_V2_CONFIG_KEYS.includes(definitionKey) ? 'RETIRED' : bp.context.structureOnly ? 'STRUCTURE_ONLY' : 'CONFIGURED', provenance: UNKNOWN_PROVENANCE },
  };
  const examDefinition: ExamDefinitionV2 = { ...body, fingerprint: definitionFingerprint(body) };

  if (specKey.status !== 'STATED') unresolved.add('examDefinition.specification.key');
  if (outcome.finalOutcome.status === 'UNKNOWN') unresolved.add('examDefinition.outcome.finalOutcome');
  if (sessions.length === 0) unresolved.add('examDefinition.sessions');
  for (const [k, cap] of Object.entries(examDefinition.capabilities)) if (cap.value === 'UNKNOWN') unresolved.add(`examDefinition.capabilities.${k}`);

  validateExamDefinition(examDefinition, bp).issues.forEach(push);

  const status = issues.some((i) => i.severity === 'ERROR') ? 'INVALID' : unresolved.size ? 'INCOMPLETE' : 'COMPLETE';
  return {
    blueprint: requested.blueprint,
    examDefinition,
    sessions,
    sessionRequirements: dependencies,
    outcomeSpecification: outcome,
    completeness,
    status,
    issues,
    unresolvedFields: [...unresolved].sort(),
    provenance: requested.provenance,
  };
}
