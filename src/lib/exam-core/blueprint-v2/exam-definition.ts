/**
 * Blueprint Engine V2 / BP-1 -- the canonical Exam Definition.
 *
 *   ExamDefinitionV2
 *     identity        WHAT exam (family, qualification/test, subject or domain, level)
 *     specification   WHICH specification / syllabus version (validity window, code)
 *     sessionPolicy   HOW it is administered + which rules depend on the session
 *     components      what it is made of, each with its role (timed test,
 *                     coursework, performance...) and derived capabilities
 *     outcome         what it reports (outcome.ts)
 *
 * Exam identity, specification version and session are three separate
 * fields -- the configuration's `version.label` is a StudyUs configuration
 * label, recorded as such, never used as the specification version.
 *
 * Official component facts are the SAME Fact objects the BP-0 compiler
 * produced (one derivation, no second representation). Capabilities are
 * derived from those facts, never from the exam family, and say nothing
 * about content: supportsMock = YES is not MOCK_READY (the Question Bank
 * decides readiness).
 */
import { z } from 'zod';
import { ComponentSchema, factSchema, ProvenanceSchema, type BlueprintComponent, type BlueprintV2 } from './schema';
import { OutcomeSpecificationSchema, ResultCompletenessSchema, type OutcomeSpecificationV2 } from './outcome';
import { SessionDependencySchema, type SessionDependency } from './session';
import { isAuthoritativeFact, type Fact } from './provenance';
import { hashCanonical } from '../scoring/scoring-policy';

export const TriStateSchema = z.enum(['YES', 'NO', 'UNKNOWN']);
export type TriState = z.infer<typeof TriStateSchema>;

export const COMPONENT_CLASSES = ['TIMED_TEST', 'COURSEWORK', 'PERFORMANCE', 'PRACTICAL', 'OTHER', 'UNKNOWN'] as const;
export type ComponentClass = (typeof COMPONENT_CLASSES)[number];

/** Component-KIND vocabulary (not exam family) -> class. */
const CLASS_OF_KIND: Record<string, ComponentClass> = {
  WRITTEN_PAPER: 'TIMED_TEST',
  MULTIPLE_CHOICE_TEST: 'TIMED_TEST',
  ADAPTIVE_TEST: 'TIMED_TEST',
  PORTFOLIO: 'COURSEWORK',
  PROJECT: 'COURSEWORK',
  COURSEWORK: 'COURSEWORK',
  INTERNAL_ASSESSMENT: 'COURSEWORK',
  RESEARCH_REPORT: 'COURSEWORK',
  ORAL: 'PERFORMANCE',
  PRESENTATION: 'PERFORMANCE',
  PERFORMANCE: 'PERFORMANCE',
  PRACTICAL: 'PRACTICAL',
  OTHER_GOVERNED_COMPONENT: 'OTHER',
};

export const DefinitionComponentSchema = z.object({
  key: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  official: ComponentSchema.shape.official,
  componentClass: z.enum(COMPONENT_CLASSES),
  /** Counts towards the reported outcome: a stated, positive official weight. */
  contributesToOutcome: TriStateSchema,
  /** Can be sat as a timed paper under exam conditions (structure only; not content availability). */
  mockable: TriStateSchema,
  /** Can feed a projection, and from what: an attempt, or a teacher-supplied estimate (coursework). */
  predictionInput: z.object({ capability: TriStateSchema, source: z.enum(['ATTEMPT', 'TEACHER_ESTIMATE', 'UNKNOWN']) }),
  /** StudyUs practice is configured for it today (the configuration's simulationCapable flag). */
  studyusPracticeConfigured: z.boolean(),
});
export type DefinitionComponent = z.infer<typeof DefinitionComponentSchema>;

export const CapabilitySchema = z.object({ value: TriStateSchema, basis: z.string().max(300) });

export const ExamDefinitionV2Schema = z.object({
  schema: z.literal('studyus.exam-definition/v2'),
  identity: z.object({
    definitionKey: z.string().min(1).max(80),
    family: z.string().min(1).max(40),
    ecosystem: z.string().min(1).max(40),
    name: z.string().min(1).max(200),
    organization: z.string().min(1).max(200),
    programme: z.object({ name: z.string(), type: z.string() }),
    /** Configuration labels (StudyUs catalogue names), not sourced facts. */
    qualification: z.string().nullable(),
    subjectOrDomain: z.object({ kind: z.enum(['SUBJECT', 'DOMAIN_SET', 'TEST']), name: z.string().nullable(), domains: z.array(z.string()) }),
    level: z.string().nullable(),
  }),
  specification: z.object({
    /** `frameworkKey@frameworkVersion` when both are stated; UNKNOWN otherwise. */
    key: factSchema(z.string()),
    syllabusCode: factSchema(z.string()),
    curriculumVersion: factSchema(z.string()),
    firstAssessment: factSchema(z.number().int()),
    lastAssessment: factSchema(z.number().int()),
    /** The StudyUs configuration label (e.g. "V2 2021-2028") -- recorded, never treated as the specification version. */
    configurationLabel: z.string(),
    sourceConfigFingerprint: z.string().nullable(),
  }),
  assessmentModel: z.object({
    structure: z.enum(['SINGLE_FORM', 'MULTI_COMPONENT', 'ROUTED']),
    routeKeys: z.array(z.string()),
    /** Do the configured components carry the whole subject? From stated weights only. */
    componentCoverage: z.object({ status: TriStateSchema, weightPercent: z.number().nullable(), reason: z.string() }),
  }),
  components: z.array(DefinitionComponentSchema).min(1),
  sessionPolicy: z.object({
    administration: z.literal('UNKNOWN').or(z.string()),
    /** Free-text session hint in the configuration (e.g. "May / November"); NOT a modelled session. */
    configuredHint: z.string().nullable(),
    configuredExamYear: z.number().int().nullable(),
    dependencies: z.array(SessionDependencySchema),
    sessionsKnown: z.array(z.string()),
  }),
  outcome: OutcomeSpecificationSchema,
  capabilities: z.object({
    supportsPractice: CapabilitySchema,
    supportsMock: CapabilitySchema,
    supportsPrediction: CapabilitySchema,
    supportsCoursework: CapabilitySchema,
    supportsSessionBasedScoring: CapabilitySchema,
    supportsQualificationAggregation: CapabilitySchema,
  }),
  completeness: ResultCompletenessSchema,
  /** How the V1 runtime's stored result must be read (AICE unit conflict etc.). */
  legacyRuntime: z.object({
    finalScore: z.object({ declaredUnit: z.string().nullable(), meaning: z.enum(['PERCENT_OF_DELIVERED_MARKS', 'LINEAR_SCALE', 'PIECEWISE_SCALE', 'BAND_PERCENT']), v2Unit: z.null(), status: z.enum(['CONSISTENT', 'UNIT_LABEL_CONFLICT']) }),
    rawScore: z.object({ v2Unit: z.literal('RAW_MARKS') }),
  }),
  lifecycle: z.object({ configuration: z.enum(['CONFIGURED', 'STRUCTURE_ONLY', 'RETIRED']), provenance: ProvenanceSchema }),
  fingerprint: z.string().length(64),
});
export type ExamDefinitionV2 = z.infer<typeof ExamDefinitionV2Schema>;

// ---------------------------------------------------------------------------
// Derivations (pure, from compiled facts)
// ---------------------------------------------------------------------------

export function definitionComponent(c: BlueprintComponent): DefinitionComponent {
  const kind = c.official.kind.status === 'STATED' ? c.official.kind.value : null;
  const componentClass: ComponentClass = kind ? CLASS_OF_KIND[kind] ?? 'OTHER' : 'UNKNOWN';
  const weight = c.official.weightPercent;
  const contributes: TriState = isAuthoritativeFact(weight) ? (weight.value > 0 ? 'YES' : 'NO') : 'UNKNOWN';
  // A timed paper can be mocked when it has an official duration; coursework / performance / practical cannot be sat as a paper.
  const mockable: TriState =
    componentClass === 'TIMED_TEST' ? (isAuthoritativeFact(c.official.durationMinutes) ? 'YES' : 'UNKNOWN') : componentClass === 'UNKNOWN' || componentClass === 'OTHER' ? 'UNKNOWN' : 'NO';
  const predictionInput: DefinitionComponent['predictionInput'] =
    contributes !== 'YES'
      ? { capability: contributes === 'NO' ? 'NO' : 'UNKNOWN', source: 'UNKNOWN' }
      : mockable === 'YES'
        ? { capability: 'YES', source: 'ATTEMPT' }
        : mockable === 'NO'
          ? { capability: 'YES', source: 'TEACHER_ESTIMATE' }
          : { capability: 'UNKNOWN', source: 'UNKNOWN' };
  return { key: c.key, name: c.name, official: c.official, componentClass, contributesToOutcome: contributes, mockable, predictionInput, studyusPracticeConfigured: c.simulationCapable && c.cells.length > 0 };
}

export function componentCoverage(components: readonly DefinitionComponent[], routed: boolean): ExamDefinitionV2['assessmentModel']['componentCoverage'] {
  if (routed) return { status: 'UNKNOWN', weightPercent: null, reason: 'weights apply per official route / component set' };
  const facts = components.map((c) => c.official.weightPercent);
  if (facts.length === 0 || !facts.every((f) => isAuthoritativeFact(f))) return { status: 'UNKNOWN', weightPercent: null, reason: 'not every component states an authoritative weight' };
  const total = Math.round(facts.reduce((n, f) => n + (f as { value: number }).value, 0) * 1000) / 1000;
  if (total === 100) return { status: 'YES', weightPercent: 100, reason: 'stated weights sum to 100%' };
  return { status: 'NO', weightPercent: total, reason: `stated weights sum to ${total}%: components outside this configuration carry the rest` };
}

export function deriveCapabilities(
  components: readonly DefinitionComponent[],
  bp: BlueprintV2,
  spec: OutcomeSpecificationV2,
  dependencies: readonly SessionDependency[]
): ExamDefinitionV2['capabilities'] {
  const any = (p: (c: DefinitionComponent) => boolean) => components.some(p);
  const all = (p: (c: DefinitionComponent) => boolean) => components.every(p);
  const cap = (value: TriState, basis: string) => ({ value, basis });
  const declared = spec.reported.filter((r) => r.status === 'DECLARED');
  const contributing = components.filter((c) => c.contributesToOutcome === 'YES');
  return {
    supportsPractice: any((c) => c.studyusPracticeConfigured)
      ? cap('YES', 'at least one component has a configured blueprint with item cells (content availability is the Question Bank\'s readiness)')
      : cap('UNKNOWN', 'no component has a configured item blueprint'),
    supportsMock: any((c) => c.mockable === 'YES')
      ? cap('YES', 'at least one timed component with an official duration (not MOCK_READY)')
      : all((c) => c.mockable === 'NO')
        ? cap('NO', 'no component can be sat as a timed paper')
        : cap('UNKNOWN', 'no timed component with an official duration is stated'),
    supportsPrediction:
      spec.finalOutcome.status !== 'DECLARED'
        ? cap('UNKNOWN', 'no authoritative final outcome is declared')
        : contributing.length > 0 && contributing.every((c) => c.predictionInput.capability === 'YES')
          ? cap('YES', 'a declared final outcome and a prediction input for every contributing component')
          : cap('UNKNOWN', 'some contributing component has no known prediction input'),
    supportsCoursework: any((c) => c.componentClass === 'COURSEWORK' || c.componentClass === 'PERFORMANCE' || c.componentClass === 'PRACTICAL')
      ? cap('YES', 'a coursework / performance / practical component is stated')
      : all((c) => c.componentClass === 'TIMED_TEST')
        ? cap('NO', 'every stated component is a timed test')
        : cap('UNKNOWN', 'some component kind is unknown'),
    supportsSessionBasedScoring: bp.scoring.pipeline.some((s) => s.dependency.resolvedPer === 'SESSION')
      ? cap('YES', 'a declared outcome stage depends on the session')
      : declared.length > 0
        ? cap('NO', 'the declared outcomes do not depend on the session')
        : cap('UNKNOWN', dependencies.length ? 'only administration rules (timetable / routes) are known to be session-bound' : 'no outcome declared'),
    supportsQualificationAggregation: declared.some((r) => r.layer === 'QUALIFICATION')
      ? cap('YES', 'a qualification outcome is declared')
      : bp.qualificationAggregation
        ? cap('UNKNOWN', `the configuration belongs to ${bp.qualificationAggregation.groupName}, but no authoritative qualification rule is loaded`)
        : cap('UNKNOWN', 'no qualification outcome declared'),
  };
}

/**
 * The V1 runtime stores `final_score` as the strategy fraction x 100 when the
 * transform is NONE or BANDS, and labels it with `policy.unit`. That value is
 * a percentage, never marks: it maps to NO V2 unit. Raw marks live in
 * `raw_score` / `max_score`.
 */
export function legacyRuntimeReading(runtime: BlueprintV2['scoring']['runtimeV1']): ExamDefinitionV2['legacyRuntime'] {
  const meaning = runtime.transform === 'LINEAR' ? 'LINEAR_SCALE' : runtime.transform === 'PIECEWISE' ? 'PIECEWISE_SCALE' : runtime.transform === 'BANDS' ? 'BAND_PERCENT' : 'PERCENT_OF_DELIVERED_MARKS';
  const percent = meaning === 'PERCENT_OF_DELIVERED_MARKS' || meaning === 'BAND_PERCENT';
  const conflict = percent && runtime.unit !== null && runtime.unit !== '%';
  return { finalScore: { declaredUnit: runtime.unit, meaning, v2Unit: null, status: conflict ? 'UNIT_LABEL_CONFLICT' : 'CONSISTENT' }, rawScore: { v2Unit: 'RAW_MARKS' } };
}

export function definitionFingerprint(def: Omit<ExamDefinitionV2, 'fingerprint'> | ExamDefinitionV2): string {
  const { fingerprint: _f, ...rest } = def as ExamDefinitionV2;
  void _f;
  return hashCanonical(rest);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface DefinitionIssue {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  path: string;
  message: string;
}

/**
 * Exam Definition checks (shape + semantics), optionally against the
 * blueprint it was compiled with.
 */
export function validateExamDefinition(input: unknown, blueprint?: BlueprintV2): { ok: boolean; definition: ExamDefinitionV2 | null; issues: DefinitionIssue[] } {
  const parsed = ExamDefinitionV2Schema.safeParse(input);
  if (!parsed.success) return { ok: false, definition: null, issues: parsed.error.issues.map((i) => ({ code: 'INVALID_DEFINITION_SHAPE', severity: 'ERROR', path: `examDefinition.${i.path.join('.')}`, message: i.message })) };
  const d = parsed.data;
  const issues: DefinitionIssue[] = [];
  const err = (code: string, path: string, message: string) => issues.push({ code, severity: 'ERROR', path, message });
  const keys = d.components.map((c) => c.key);

  // identity
  if (blueprint) {
    if (blueprint.identity.examDefinitionKey !== d.identity.definitionKey) err('IDENTITY_INCONSISTENT', 'identity.definitionKey', `blueprint is for ${blueprint.identity.examDefinitionKey}`);
    if (blueprint.identity.examFamily !== d.identity.family) err('IDENTITY_INCONSISTENT', 'identity.family', `blueprint family is ${blueprint.identity.examFamily}`);
    if (blueprint.identity.sourceConfigFingerprint !== d.specification.sourceConfigFingerprint) err('IDENTITY_INCONSISTENT', 'specification.sourceConfigFingerprint', 'blueprint and definition were compiled from different configurations');
    for (const c of blueprint.components) if (!keys.includes(c.key)) err('IMPOSSIBLE_COMPONENT_REFERENCE', `components.${c.key}`, 'blueprint component is not part of the exam definition');
  }
  const so = d.identity.subjectOrDomain;
  if (so.kind === 'SUBJECT' && !so.name) err('INCOMPATIBLE_SUBJECT_DOMAIN', 'identity.subjectOrDomain', 'a SUBJECT exam needs a subject');
  if (so.kind === 'DOMAIN_SET' && so.domains.length === 0) err('INCOMPATIBLE_SUBJECT_DOMAIN', 'identity.subjectOrDomain', 'a DOMAIN_SET test needs its domains');
  if (d.identity.level && so.kind !== 'SUBJECT') err('INCOMPATIBLE_SUBJECT_DOMAIN', 'identity.level', 'a level qualifies a subject; this exam has no subject');
  for (const k of new Set(keys.filter((k, i) => keys.indexOf(k) !== i))) err('DUPLICATE_COMPONENT', `components.${k}`, 'component listed twice');

  // specification
  const sp = d.specification;
  if (sp.firstAssessment.status === 'STATED' && sp.lastAssessment.status === 'STATED' && sp.firstAssessment.value > sp.lastAssessment.value) err('INVALID_SPECIFICATION_VERSION', 'specification', `first assessment ${sp.firstAssessment.value} is after last assessment ${sp.lastAssessment.value}`);
  if (sp.key.status === 'STATED' && !/^.+@.+$/.test(sp.key.value)) err('INVALID_SPECIFICATION_VERSION', 'specification.key', 'expected frameworkKey@frameworkVersion');
  if (sp.key.status === 'STATED' && sp.key.value === sp.configurationLabel) err('INVALID_SPECIFICATION_VERSION', 'specification.key', 'the configuration label is not a specification version');

  // outcome
  const pipelineStages = new Set((blueprint?.scoring.pipeline ?? []).map((s) => s.kind));
  for (const [i, r] of [...d.outcome.structural, ...d.outcome.reported].entries()) {
    const path = `outcome.${i}.${r.layer}.${r.kind}`;
    if (r.status === 'DECLARED' && d.outcome.reported.includes(r) && r.provenance.kind !== 'UNKNOWN' && !(r.provenance.authority !== 'NONE' && r.provenance.sourceKeys.length > 0)) err('OUTCOME_WITHOUT_AUTHORITY', path, `declared on provenance ${r.provenance.kind}`);
    if (r.status === 'DECLARED' && d.outcome.reported.includes(r) && r.provenance.kind === 'UNKNOWN') err('OUTCOME_WITHOUT_AUTHORITY', path, 'declared without any provenance');
    if (blueprint && r.status === 'DECLARED' && !pipelineStages.has(r.producedByStage)) {
      const code = r.unit === 'GRADE' ? 'GRADE_WITHOUT_GRADE_STAGE' : r.unit === 'QUALIFICATION_POINTS' ? 'QUALIFICATION_POINTS_WITHOUT_AGGREGATION' : 'IMPOSSIBLE_OUTCOME_TRANSITION';
      err(code, path, `${r.kind} needs a ${r.producedByStage} stage the pipeline does not have`);
    }
    const expectedUnit = { ITEM_MARKS: 'RAW_MARKS', COMPONENT_TOTAL: 'COMPONENT_SCORE', COMPONENT_WEIGHTING: 'WEIGHTED_SCORE', SCALE_CONVERSION: 'SCALED_SCORE', GLOBAL_COMBINATION: 'SCALED_SCORE', GRADE_BOUNDARIES: 'GRADE', QUALIFICATION_AGGREGATION: 'QUALIFICATION_POINTS', AREA_GROUPING: 'COMPONENT_SCORE' }[r.producedByStage];
    if (r.unit !== expectedUnit) err('INCOMPATIBLE_OUTCOME_UNIT', path, `${r.producedByStage} produces ${expectedUnit}, not ${r.unit}`);
  }
  if (d.outcome.finalOutcome.status === 'DECLARED') {
    const f = d.outcome.finalOutcome;
    if (!d.outcome.reported.some((r) => r.final && r.kind === f.kind && r.layer === f.layer && r.status === 'DECLARED')) err('IMPOSSIBLE_OUTCOME_TRANSITION', 'outcome.finalOutcome', 'the final outcome is not one of the declared outcomes');
  }

  // session dependencies & completeness
  const c = d.completeness;
  if (c.level === 'GRADE_AVAILABLE' || c.level === 'QUALIFICATION_RESULT_AVAILABLE') {
    if (!c.sessionKey && c.requiresSession) err('SESSION_FACT_RESOLVED_WITHOUT_SESSION', 'completeness', `${c.level} on a session-dependent pipeline without a session`);
    const boundaries = d.sessionPolicy.dependencies.find((x) => x.rule === 'GRADE_BOUNDARIES');
    if (boundaries && c.sessionKey && !boundaries.loadedInSessions.includes(c.sessionKey)) err('BOUNDARY_OUTCOME_WITHOUT_SOURCE', 'completeness', `grade resolved for ${c.sessionKey}, which has no authoritative boundaries loaded`);
  }
  for (const dep of d.sessionPolicy.dependencies) {
    if (dep.loadedInSessions.some((s) => !d.sessionPolicy.sessionsKnown.includes(s))) err('UNRESOLVED_REFERENCE', `sessionPolicy.dependencies.${dep.rule}`, 'loaded in a session the definition does not know');
    for (const k of dep.scope?.componentKeys ?? []) if (!keys.includes(k)) err('IMPOSSIBLE_COMPONENT_REFERENCE', `sessionPolicy.dependencies.${dep.rule}`, `unknown component ${k}`);
  }

  // provenance of component facts (same rule as the blueprint validator)
  for (const comp of d.components) for (const [k, f] of Object.entries(comp.official)) {
    const fact = f as Fact<unknown>;
    if (fact && typeof fact === 'object' && 'status' in fact && fact.status === 'STATED' && fact.provenance.kind !== 'UNKNOWN' && fact.provenance.kind !== 'THIRD_PARTY_REFERENCE' && fact.provenance.sourceKeys.length === 0) {
      err('MISSING_PROVENANCE', `components.${comp.key}.official.${k}`, `${fact.provenance.kind} value without any source`);
    }
  }
  if (definitionFingerprint(d) !== d.fingerprint) err('FINGERPRINT_MISMATCH', 'fingerprint', 'the fingerprint does not match the definition');
  return { ok: !issues.some((i) => i.severity === 'ERROR'), definition: d, issues };
}

