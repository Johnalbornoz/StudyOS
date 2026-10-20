/**
 * Blueprint Engine V2 / BP-1 -- Outcome Specification and result completeness.
 *
 * What an exam REPORTS, per layer, never assuming that every exam ends in a
 * grade:
 *
 *   COMPONENT      Paper 1 -> raw marks -> (weighted contribution)
 *   SUBJECT        weighted total -> grade | scaled score | composite | pass/fail | proficiency level
 *   QUALIFICATION  subject grades -> qualification points / award
 *
 * An outcome is DECLARED only with an authoritative provenance; otherwise it
 * stays UNKNOWN with the reason. Declared outcomes are translated into the
 * BP-0 pipeline (OutcomeDeclaration stages) -- there is one scoring
 * representation, not two.
 *
 * Result completeness says how far the exam can HONESTLY be resolved:
 * RAW_ONLY < WEIGHTED_AVAILABLE < SCALED_AVAILABLE < GRADE_AVAILABLE <
 * QUALIFICATION_RESULT_AVAILABLE, plus whether that reaches the declared
 * final outcome (FULLY_RESOLVED / PARTIALLY_RESOLVED / FINAL_OUTCOME_UNKNOWN).
 */
import { z } from 'zod';
import { isAuthoritative, UNKNOWN_PROVENANCE, type Provenance } from './provenance';
import { ProvenanceSchema, STAGE_KINDS, type BlueprintV2, type StageKind } from './schema';
import type { OutcomeDeclaration } from './compiler';
import type { ScoreUnit } from './units';
import { sessionHasRule, type ExamSessionV2, type SessionRule } from './session';

export const OUTCOME_LAYERS = ['COMPONENT', 'SUBJECT', 'QUALIFICATION'] as const;
export type OutcomeLayer = (typeof OUTCOME_LAYERS)[number];

export const OUTCOME_KINDS = [
  'RAW_MARKS',
  'COMPONENT_SCORE',
  'WEIGHTED_SCORE',
  'SCALED_SCORE',
  /** A combination of several scaled results (e.g. a global score over tests). */
  'COMPOSITE_SCORE',
  'GRADE',
  'PASS_FAIL',
  'PROFICIENCY_LEVEL',
  'QUALIFICATION_POINTS',
  'QUALIFICATION_AWARD',
] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

/** Which typed unit carries each outcome kind, which stage produces it, and on which layers it is legitimate. */
export const OUTCOME_CONTRACTS: Record<OutcomeKind, { unit: ScoreUnit; stage: StageKind; layers: readonly OutcomeLayer[] }> = {
  RAW_MARKS: { unit: 'RAW_MARKS', stage: 'ITEM_MARKS', layers: ['COMPONENT', 'SUBJECT'] },
  COMPONENT_SCORE: { unit: 'COMPONENT_SCORE', stage: 'COMPONENT_TOTAL', layers: ['COMPONENT'] },
  WEIGHTED_SCORE: { unit: 'WEIGHTED_SCORE', stage: 'COMPONENT_WEIGHTING', layers: ['COMPONENT', 'SUBJECT'] },
  SCALED_SCORE: { unit: 'SCALED_SCORE', stage: 'SCALE_CONVERSION', layers: ['SUBJECT'] },
  COMPOSITE_SCORE: { unit: 'SCALED_SCORE', stage: 'GLOBAL_COMBINATION', layers: ['SUBJECT'] },
  GRADE: { unit: 'GRADE', stage: 'GRADE_BOUNDARIES', layers: ['SUBJECT'] },
  PASS_FAIL: { unit: 'GRADE', stage: 'GRADE_BOUNDARIES', layers: ['SUBJECT', 'QUALIFICATION'] },
  PROFICIENCY_LEVEL: { unit: 'GRADE', stage: 'GRADE_BOUNDARIES', layers: ['SUBJECT'] },
  QUALIFICATION_POINTS: { unit: 'QUALIFICATION_POINTS', stage: 'QUALIFICATION_AGGREGATION', layers: ['QUALIFICATION'] },
  QUALIFICATION_AWARD: { unit: 'QUALIFICATION_POINTS', stage: 'QUALIFICATION_AGGREGATION', layers: ['QUALIFICATION'] },
};

/** Stages whose data is a session-dependent rule, and which rule. */
export const STAGE_SESSION_RULE: Partial<Record<StageKind, SessionRule>> = {
  GRADE_BOUNDARIES: 'GRADE_BOUNDARIES',
  SCALE_CONVERSION: 'SCALING_TABLE',
};

// ---------------------------------------------------------------------------
// Input: what the caller (an operator, later a governed source) declares.
// ---------------------------------------------------------------------------

export interface OutcomeSpecificationInput {
  provenance: Provenance;
  outcomes: Array<{
    layer: OutcomeLayer;
    kind: OutcomeKind;
    /** Scale / grade scale / rule identifier (opaque; never the scale's values). */
    scaleKey?: string;
    /** Whether the conversion data varies per session (boundaries usually do) or per specification. */
    resolvedPer?: 'SESSION' | 'VERSION';
    /** For SUBJECT-layer outcomes reported per area (e.g. a scale per tested area). */
    areas?: Array<{ key: string; label: string; componentKeys: string[] }>;
    /** The final outcome of the exam (at most one per layer). */
    final?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Output: the specification attached to an Exam Definition.
// ---------------------------------------------------------------------------

export const ReportedOutcomeSchema = z.object({
  layer: z.enum(OUTCOME_LAYERS),
  kind: z.enum(OUTCOME_KINDS),
  unit: z.string(),
  producedByStage: z.enum(STAGE_KINDS),
  scaleKey: z.string().nullable(),
  /** DECLARED = authoritative; UNKNOWN = asked for but not authoritative / not supported. */
  status: z.enum(['DECLARED', 'UNKNOWN']),
  reason: z.string().max(300).nullable(),
  sessionDependent: z.enum(['YES', 'NO', 'UNKNOWN']),
  provenance: ProvenanceSchema,
  final: z.boolean(),
});
export type ReportedOutcome = z.infer<typeof ReportedOutcomeSchema>;

export const OutcomeSpecificationSchema = z.object({
  /** Outcomes the structure yields without any declaration (marks, component scores, weighted score). */
  structural: z.array(ReportedOutcomeSchema),
  /** Outcomes an authority says the exam reports. */
  reported: z.array(ReportedOutcomeSchema),
  finalOutcome: z.discriminatedUnion('status', [
    z.object({ status: z.literal('DECLARED'), layer: z.enum(OUTCOME_LAYERS), kind: z.enum(OUTCOME_KINDS), provenance: ProvenanceSchema }),
    z.object({ status: z.literal('UNKNOWN'), reason: z.string().min(1).max(300) }),
  ]),
});
export type OutcomeSpecificationV2 = z.infer<typeof OutcomeSpecificationSchema>;

export interface OutcomeIssue {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  path: string;
  message: string;
}

/**
 * Turns an OutcomeSpecificationInput into BP-0 pipeline stages. Unsupported or
 * contradictory requests are issues, never silently dropped or "fixed".
 */
export function outcomeToDeclaration(input: OutcomeSpecificationInput | undefined, componentKeys: readonly string[]): { declaration: OutcomeDeclaration | undefined; issues: OutcomeIssue[] } {
  if (!input) return { declaration: undefined, issues: [] };
  const issues: OutcomeIssue[] = [];
  const err = (code: string, path: string, message: string) => issues.push({ code, severity: 'ERROR', path, message });
  const stages: OutcomeDeclaration['stages'] = [];
  const has = (k: StageKind) => stages.some((s) => s.kind === k);
  const finals = new Map<OutcomeLayer, number>();

  input.outcomes.forEach((o, i) => {
    const path = `outcome.${i}.${o.layer}.${o.kind}`;
    const contract = OUTCOME_CONTRACTS[o.kind];
    if (!contract.layers.includes(o.layer)) return err('INCOMPATIBLE_OUTCOME_LAYER', path, `${o.kind} is not a ${o.layer} outcome`);
    if (o.final) finals.set(o.layer, (finals.get(o.layer) ?? 0) + 1);
    for (const a of o.areas ?? []) for (const k of a.componentKeys) if (!componentKeys.includes(k)) err('UNRESOLVED_REFERENCE', path, `area ${a.key} references unknown component ${k}`);
    if (o.areas?.length && !has('AREA_GROUPING')) stages.push({ kind: 'AREA_GROUPING', groups: o.areas });
    const per = o.resolvedPer ?? 'SESSION';
    switch (contract.stage) {
      case 'ITEM_MARKS':
      case 'COMPONENT_TOTAL':
      case 'COMPONENT_WEIGHTING':
        return; // structural: produced (or not) by the configuration's own facts
      case 'SCALE_CONVERSION':
        if (has('SCALE_CONVERSION')) return err('DUPLICATE_OUTCOME_STAGE', path, 'one scale conversion per exam in BP-1');
        stages.push({ kind: 'SCALE_CONVERSION', scope: o.areas?.length ? 'AREA' : 'SUBJECT', scaleKey: o.scaleKey ?? `${o.kind.toLowerCase()}`, resolvedPer: per });
        return;
      case 'GLOBAL_COMBINATION':
        if (!input.outcomes.some((x) => x.kind === 'SCALED_SCORE')) return err('IMPOSSIBLE_OUTCOME_TRANSITION', path, 'a composite score combines scaled results: declare the SCALED_SCORE it combines');
        stages.push({ kind: 'GLOBAL_COMBINATION', formulaKey: o.scaleKey ?? 'composite' });
        return;
      case 'GRADE_BOUNDARIES':
        if (has('GRADE_BOUNDARIES')) return err('DUPLICATE_OUTCOME_STAGE', path, 'one grade-producing outcome per exam (grade, pass/fail or proficiency level)');
        stages.push({ kind: 'GRADE_BOUNDARIES', scope: 'SUBJECT', scaleKey: o.scaleKey ?? `${o.kind.toLowerCase()}`, resolvedPer: per });
        return;
      case 'QUALIFICATION_AGGREGATION':
        if (!input.outcomes.some((x) => OUTCOME_CONTRACTS[x.kind].unit === 'GRADE' && x.layer === 'SUBJECT')) return err('IMPOSSIBLE_OUTCOME_TRANSITION', path, 'qualification points aggregate subject grades: declare the subject grade first');
        if (!has('QUALIFICATION_AGGREGATION')) stages.push({ kind: 'QUALIFICATION_AGGREGATION', ruleKey: o.scaleKey ?? 'qualification-rule' });
        return;
    }
  });
  for (const [layer, n] of finals) if (n > 1) err('MULTIPLE_FINAL_OUTCOMES', `outcome.${layer}`, `${n} outcomes are marked final on the ${layer} layer`);
  return { declaration: { provenance: input.provenance, stages }, issues };
}

/** Builds the specification from the compiled pipeline (single source of truth) and the declaration. */
export function buildOutcomeSpecification(bp: BlueprintV2, input: OutcomeSpecificationInput | undefined, translationIssues: OutcomeIssue[]): OutcomeSpecificationV2 {
  const stages = new Set(bp.scoring.pipeline.map((s) => s.kind));
  const structural: ReportedOutcome[] = [];
  const add = (layer: OutcomeLayer, kind: OutcomeKind) =>
    structural.push({ layer, kind, unit: OUTCOME_CONTRACTS[kind].unit, producedByStage: OUTCOME_CONTRACTS[kind].stage, scaleKey: null, status: 'DECLARED', reason: 'structural: follows from the configured components', sessionDependent: 'NO', provenance: UNKNOWN_PROVENANCE, final: false });
  add('COMPONENT', 'RAW_MARKS');
  add('COMPONENT', 'COMPONENT_SCORE');
  if (stages.has('COMPONENT_WEIGHTING')) add('SUBJECT', 'WEIGHTED_SCORE');

  const authoritative = input ? isAuthoritative(input.provenance) : false;
  const failed = new Set(translationIssues.filter((i) => i.severity === 'ERROR').map((i) => i.path));
  const reported: ReportedOutcome[] = (input?.outcomes ?? []).map((o, i) => {
    const contract = OUTCOME_CONTRACTS[o.kind];
    const stage = bp.scoring.pipeline.find((s) => s.kind === contract.stage);
    const rejected = [...failed].some((p) => p.startsWith(`outcome.${i}.`));
    const reason = rejected
      ? 'rejected: see issues'
      : !authoritative
        ? `no authoritative source: provenance ${input!.provenance.kind}`
        : !stage
          ? `the pipeline has no ${contract.stage} stage`
          : null;
    return {
      layer: o.layer,
      kind: o.kind,
      unit: contract.unit,
      producedByStage: contract.stage,
      scaleKey: o.scaleKey ?? null,
      status: reason ? 'UNKNOWN' : 'DECLARED',
      reason,
      sessionDependent: stage ? (stage.dependency.resolvedPer === 'SESSION' ? 'YES' : 'NO') : 'UNKNOWN',
      provenance: input!.provenance,
      final: o.final ?? false,
    };
  });
  const finals = reported.filter((r) => r.final && r.status === 'DECLARED');
  const top = finals.sort((a, b) => OUTCOME_LAYERS.indexOf(b.layer) - OUTCOME_LAYERS.indexOf(a.layer))[0];
  const finalOutcome: OutcomeSpecificationV2['finalOutcome'] = top
    ? { status: 'DECLARED', layer: top.layer, kind: top.kind, provenance: top.provenance }
    : { status: 'UNKNOWN', reason: input ? 'No authoritative final outcome declared' : 'No authoritative source currently loaded' };
  return { structural, reported, finalOutcome };
}

// ---------------------------------------------------------------------------
// Result completeness
// ---------------------------------------------------------------------------

export const COMPLETENESS_LEVELS = ['RAW_ONLY', 'WEIGHTED_AVAILABLE', 'SCALED_AVAILABLE', 'GRADE_AVAILABLE', 'QUALIFICATION_RESULT_AVAILABLE'] as const;
export type CompletenessLevel = (typeof COMPLETENESS_LEVELS)[number];

const LEVEL_OF_STAGE: Record<StageKind, CompletenessLevel> = {
  ITEM_MARKS: 'RAW_ONLY',
  COMPONENT_TOTAL: 'RAW_ONLY',
  AREA_GROUPING: 'RAW_ONLY',
  COMPONENT_WEIGHTING: 'WEIGHTED_AVAILABLE',
  SCALE_CONVERSION: 'SCALED_AVAILABLE',
  GLOBAL_COMBINATION: 'SCALED_AVAILABLE',
  GRADE_BOUNDARIES: 'GRADE_AVAILABLE',
  QUALIFICATION_AGGREGATION: 'QUALIFICATION_RESULT_AVAILABLE',
};

export const ResultCompletenessSchema = z.object({
  /** The session the resolution was computed for (null = no session context). */
  sessionKey: z.string().nullable(),
  resolvableThrough: z.enum(STAGE_KINDS).nullable(),
  level: z.enum(COMPLETENESS_LEVELS),
  state: z.enum(['FULLY_RESOLVED', 'PARTIALLY_RESOLVED', 'FINAL_OUTCOME_UNKNOWN']),
  finalOutcome: z.string(),
  blockedBy: z.object({ stage: z.enum(STAGE_KINDS), reason: z.string() }).nullable(),
  requiresSession: z.boolean(),
});
export type ResultCompleteness = z.infer<typeof ResultCompletenessSchema>;

/**
 * How far the exam can be resolved, statically (no student data):
 * without a session, every session-dependent stage blocks; with a session,
 * a stage resolves only if that session has the rule LOADED with authority.
 * A stage whose data is not session-bound (formula, qualification rule)
 * stays as the compiled blueprint says.
 */
export function resultCompleteness(bp: BlueprintV2, spec: OutcomeSpecificationV2, session: ExamSessionV2 | null = null): ResultCompleteness {
  let through: StageKind | null = null;
  let blockedBy: ResultCompleteness['blockedBy'] = null;
  for (const stage of bp.scoring.pipeline) {
    let resolved = stage.dependency.status === 'RESOLVED';
    let reason = stage.dependency.reason ?? `${stage.dependency.kind} unresolved`;
    const rule = STAGE_SESSION_RULE[stage.kind];
    if (stage.dependency.resolvedPer === 'SESSION' && rule) {
      if (!isAuthoritative(stage.dependency.provenance)) {
        resolved = false;
        reason = 'OUTCOME_DECLARATION_NOT_AUTHORITATIVE';
      } else if (!session) {
        resolved = false;
        reason = `SESSION_NOT_RESOLVED: ${rule} depends on the session`;
      } else {
        resolved = sessionHasRule(session, rule);
        reason = resolved ? '' : `${rule}_NOT_LOADED_FOR_SESSION: ${session.sessionKey}`;
      }
    }
    if (!resolved) {
      blockedBy = { stage: stage.kind, reason };
      break;
    }
    through = stage.kind;
  }
  const level = through ? LEVEL_OF_STAGE[through] : 'RAW_ONLY';
  const finalKind = spec.finalOutcome.status === 'DECLARED' ? spec.finalOutcome.kind : 'UNKNOWN';
  const finalStage = spec.finalOutcome.status === 'DECLARED' ? OUTCOME_CONTRACTS[spec.finalOutcome.kind].stage : null;
  const reachedFinal = finalStage !== null && through !== null && bp.scoring.pipeline.findIndex((s) => s.kind === through) >= bp.scoring.pipeline.findIndex((s) => s.kind === finalStage) && bp.scoring.pipeline.some((s) => s.kind === finalStage);
  return {
    sessionKey: session?.sessionKey ?? null,
    resolvableThrough: through,
    level,
    state: spec.finalOutcome.status === 'UNKNOWN' ? 'FINAL_OUTCOME_UNKNOWN' : reachedFinal ? 'FULLY_RESOLVED' : 'PARTIALLY_RESOLVED',
    finalOutcome: finalKind,
    blockedBy,
    requiresSession: bp.scoring.pipeline.some((s) => s.dependency.resolvedPer === 'SESSION'),
  };
}
