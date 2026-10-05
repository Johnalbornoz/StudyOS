/**
 * Blueprint Engine V2 / BP-0 -- the scoring pipeline: stage contracts,
 * static resolution, and a pure evaluator.
 *
 *   ITEM_MARKS -> COMPONENT_TOTAL -> [AREA_GROUPING] -> [COMPONENT_WEIGHTING]
 *     -> [SCALE_CONVERSION] -> [GLOBAL_COMBINATION] -> [GRADE_BOUNDARIES]
 *     -> [QUALIFICATION_AGGREGATION]
 *
 * Every stage declares the unit it consumes and produces; a pipeline whose
 * units do not chain is invalid. A stage resolves only when its dependency
 * is RESOLVED with an authoritative provenance (K-05). The pipeline STOPS at
 * the last resolvable stage and says why -- it never applies a default,
 * a guessed boundary or a renormalized weight.
 *
 * The evaluator is not wired into any runtime path in BP-0.
 */
import type { BlueprintV2, PipelineStage, StageInput, StageKind } from './schema';
import type { ScoreUnit, RawMarks, ComponentScore, WeightedScore, ScaledScore, Grade } from './units';
import { componentScore, sumRawMarks, weightedScore, authoritativeWeight, grade, ScoreUnitError } from './units';
import { isAuthoritative, isAuthoritativeFact, type Provenance } from './provenance';

/** The only legal input -> output units per stage kind. */
export const STAGE_CONTRACTS: Record<StageKind, { inputs: readonly StageInput[]; output: ScoreUnit; requiresAuthority: boolean }> = {
  ITEM_MARKS: { inputs: ['ITEM_RESPONSE'], output: 'RAW_MARKS', requiresAuthority: false },
  COMPONENT_TOTAL: { inputs: ['RAW_MARKS'], output: 'COMPONENT_SCORE', requiresAuthority: false },
  AREA_GROUPING: { inputs: ['COMPONENT_SCORE'], output: 'COMPONENT_SCORE', requiresAuthority: true },
  COMPONENT_WEIGHTING: { inputs: ['COMPONENT_SCORE'], output: 'WEIGHTED_SCORE', requiresAuthority: true },
  SCALE_CONVERSION: { inputs: ['COMPONENT_SCORE', 'WEIGHTED_SCORE'], output: 'SCALED_SCORE', requiresAuthority: true },
  GLOBAL_COMBINATION: { inputs: ['SCALED_SCORE'], output: 'SCALED_SCORE', requiresAuthority: true },
  GRADE_BOUNDARIES: { inputs: ['COMPONENT_SCORE', 'WEIGHTED_SCORE', 'SCALED_SCORE'], output: 'GRADE', requiresAuthority: true },
  QUALIFICATION_AGGREGATION: { inputs: ['GRADE'], output: 'QUALIFICATION_POINTS', requiresAuthority: true },
};

/** Canonical order; a stage may be absent, never reordered. */
export const STAGE_ORDER: readonly StageKind[] = ['ITEM_MARKS', 'COMPONENT_TOTAL', 'AREA_GROUPING', 'COMPONENT_WEIGHTING', 'SCALE_CONVERSION', 'GLOBAL_COMBINATION', 'GRADE_BOUNDARIES', 'QUALIFICATION_AGGREGATION'];

export interface PipelineProblem {
  code: 'PIPELINE_EMPTY' | 'PIPELINE_MUST_START_WITH_ITEM_MARKS' | 'DUPLICATE_STAGE' | 'INVALID_STAGE_ORDER' | 'INVALID_STAGE_UNITS' | 'IMPOSSIBLE_STAGE_TRANSITION' | 'STAGE_RESOLVED_WITHOUT_AUTHORITY';
  index: number;
  message: string;
}

/** Structural checks: start, order, uniqueness, unit contracts and unit chaining. */
export function checkPipelineStructure(pipeline: readonly PipelineStage[]): PipelineProblem[] {
  const out: PipelineProblem[] = [];
  if (pipeline.length === 0) return [{ code: 'PIPELINE_EMPTY', index: 0, message: 'a scoring pipeline needs at least ITEM_MARKS' }];
  if (pipeline[0].kind !== 'ITEM_MARKS') out.push({ code: 'PIPELINE_MUST_START_WITH_ITEM_MARKS', index: 0, message: `first stage is ${pipeline[0].kind}` });
  const seen = new Set<StageKind>();
  let lastOrder = -1;
  pipeline.forEach((stage, i) => {
    if (seen.has(stage.kind)) out.push({ code: 'DUPLICATE_STAGE', index: i, message: `${stage.kind} appears more than once` });
    seen.add(stage.kind);
    const order = STAGE_ORDER.indexOf(stage.kind);
    if (order < lastOrder) out.push({ code: 'INVALID_STAGE_ORDER', index: i, message: `${stage.kind} cannot come after ${STAGE_ORDER[lastOrder]}` });
    lastOrder = Math.max(lastOrder, order);
    const contract = STAGE_CONTRACTS[stage.kind];
    if (!contract.inputs.includes(stage.input) || stage.output !== contract.output) {
      out.push({ code: 'INVALID_STAGE_UNITS', index: i, message: `${stage.kind} must consume ${contract.inputs.join(' | ')} and produce ${contract.output} (declared ${stage.input} -> ${stage.output})` });
    }
    if (i > 0 && stage.input !== pipeline[i - 1].output) {
      out.push({ code: 'IMPOSSIBLE_STAGE_TRANSITION', index: i, message: `${pipeline[i - 1].kind} produces ${pipeline[i - 1].output}; ${stage.kind} declares input ${stage.input}` });
    }
    if (stage.dependency.status === 'RESOLVED' && contract.requiresAuthority && !isAuthoritative(stage.dependency.provenance)) {
      out.push({ code: 'STAGE_RESOLVED_WITHOUT_AUTHORITY', index: i, message: `${stage.kind} is marked RESOLVED but its ${stage.dependency.kind} has provenance ${stage.dependency.provenance.kind}` });
    }
  });
  return out;
}

/** Static resolution of a compiled pipeline: the last consecutive RESOLVED stage and the first that is not. */
export function resolvePipeline(pipeline: readonly PipelineStage[], outcomeDeclared: boolean): BlueprintV2['scoring']['resolution'] {
  let last: StageKind | null = null;
  for (const stage of pipeline) {
    if (stage.dependency.status !== 'RESOLVED') return { lastResolvableStage: last, stoppedAt: stage.kind, stopReason: stage.dependency.reason ?? `${stage.dependency.kind} unresolved`, outcomeDeclared };
    last = stage.kind;
  }
  return { lastResolvableStage: last, stoppedAt: null, stopReason: outcomeDeclared ? null : 'REPORTED_OUTCOME_NOT_DECLARED', outcomeDeclared };
}

// ---------------------------------------------------------------------------
// Evaluation (pure). Dependencies a compiled blueprint cannot hold yet --
// session boundaries, conversion tables -- are passed in, and are rejected
// unless authoritative.
// ---------------------------------------------------------------------------

export interface BoundarySet {
  scaleKey: string;
  /** The unit the boundaries are expressed in; must equal the stage input. */
  inputUnit: 'COMPONENT_SCORE' | 'WEIGHTED_SCORE' | 'SCALED_SCORE';
  provenance: Provenance;
  /** Lowest first; a grade applies from its `min` (inclusive) up to the next one. */
  boundaries: ReadonlyArray<{ label: string; min: number }>;
}

export interface PipelineDependencies {
  gradeBoundaries?: BoundarySet;
}

export type StageOutput =
  | { stage: 'ITEM_MARKS'; value: RawMarks }
  | { stage: 'COMPONENT_TOTAL'; value: ComponentScore[] }
  | { stage: 'COMPONENT_WEIGHTING'; value: WeightedScore }
  | { stage: 'SCALE_CONVERSION' | 'GLOBAL_COMBINATION'; value: ScaledScore }
  | { stage: 'GRADE_BOUNDARIES'; value: Grade };

export interface PipelineEvaluation {
  outputs: StageOutput[];
  lastResolvedStage: StageKind | null;
  stoppedAt: StageKind | null;
  stopReason: string | null;
}

/**
 * Runs the blueprint's pipeline on per-component raw marks. Stops (with a
 * reason) at the first stage that cannot be resolved from authoritative
 * data; outputs up to that stage remain valid and typed.
 */
export function evaluatePipeline(bp: BlueprintV2, componentRaw: Readonly<Record<string, RawMarks>>, deps: PipelineDependencies = {}): PipelineEvaluation {
  const outputs: StageOutput[] = [];
  let last: StageKind | null = null;
  const stop = (stage: StageKind, reason: string): PipelineEvaluation => ({ outputs, lastResolvedStage: last, stoppedAt: stage, stopReason: reason });

  const structural = checkPipelineStructure(bp.scoring.pipeline);
  if (structural.length) return stop(bp.scoring.pipeline[0]?.kind ?? 'ITEM_MARKS', `INVALID_PIPELINE: ${structural[0].message}`);

  const scope = bp.identity.route?.componentSet ?? bp.components.map((c) => c.key);
  let componentScores: ComponentScore[] = [];
  let current: ComponentScore[] | WeightedScore | ScaledScore | Grade | RawMarks | null = null;

  for (const stage of bp.scoring.pipeline) {
    try {
      switch (stage.kind) {
        case 'ITEM_MARKS': {
          const missing = scope.filter((k) => !componentRaw[k]);
          if (missing.length) return stop(stage.kind, `NO_MARKS_FOR_COMPONENTS: ${missing.join(', ')}`);
          const total = sumRawMarks(scope.map((k) => componentRaw[k]));
          outputs.push({ stage: 'ITEM_MARKS', value: total });
          current = total;
          break;
        }
        case 'COMPONENT_TOTAL': {
          componentScores = scope.map((k) => {
            const comp = bp.components.find((c) => c.key === k)!;
            const max = isAuthoritativeFact(comp.official.maxMarks) ? comp.official.maxMarks.value : null;
            return componentScore(k, componentRaw[k], max);
          });
          outputs.push({ stage: 'COMPONENT_TOTAL', value: componentScores });
          current = componentScores;
          break;
        }
        case 'COMPONENT_WEIGHTING': {
          if (stage.dependency.status !== 'RESOLVED') return stop(stage.kind, stage.dependency.reason ?? 'COMPONENT_WEIGHTS_UNRESOLVED');
          const reduced = componentScores.filter((s) => s.maxBasis !== 'OFFICIAL_MAX').map((s) => s.componentKey);
          if (reduced.length) return stop(stage.kind, `REDUCED_FORM_NOT_WEIGHTABLE: ${reduced.join(', ')}`);
          const parts = componentScores.map((score) => {
            const comp = bp.components.find((c) => c.key === score.componentKey)!;
            if (!isAuthoritativeFact(comp.official.weightPercent)) throw new ScoreUnitError(`weight of ${score.componentKey} is not authoritative`);
            return { score, weight: authoritativeWeight(score.componentKey, comp.official.weightPercent.value) };
          });
          const w = weightedScore(parts);
          outputs.push({ stage: 'COMPONENT_WEIGHTING', value: w });
          current = w;
          break;
        }
        case 'GRADE_BOUNDARIES': {
          // Boundaries are per sitting: a compiled blueprint cannot hold them, the caller supplies them.
          // The claim that this exam reports a grade must itself be authoritative.
          if (!isAuthoritative(stage.dependency.provenance)) return stop(stage.kind, `OUTCOME_DECLARATION_NOT_AUTHORITATIVE: ${stage.dependency.provenance.kind}`);
          if (stage.dependency.status !== 'RESOLVED' && stage.dependency.resolvedPer !== 'SESSION') return stop(stage.kind, stage.dependency.reason ?? 'GRADE_BOUNDARIES_UNRESOLVED');
          const set = deps.gradeBoundaries;
          if (!set) return stop(stage.kind, stage.dependency.reason ?? 'GRADE_BOUNDARIES_UNAVAILABLE');
          if (!isAuthoritative(set.provenance)) return stop(stage.kind, `NON_AUTHORITATIVE_BOUNDARIES: ${set.provenance.kind}`);
          if (set.inputUnit !== stage.input) return stop(stage.kind, `BOUNDARY_UNIT_MISMATCH: boundaries in ${set.inputUnit}, stage consumes ${stage.input}`);
          const value = boundaryInput(current, stage.input);
          if (value === null) return stop(stage.kind, `NO_${stage.input}_TO_GRADE`);
          if (stage.input === 'WEIGHTED_SCORE' && (current as WeightedScore).coveredWeightPercent < 100) {
            return stop(stage.kind, `INCOMPLETE_WEIGHT_COVERAGE: ${(current as WeightedScore).coveredWeightPercent}% of the subject`);
          }
          const label = gradeFor(value, set.boundaries);
          if (label === null) return stop(stage.kind, 'INVALID_BOUNDARY_SET');
          const g = grade(label, set.scaleKey);
          outputs.push({ stage: 'GRADE_BOUNDARIES', value: g });
          current = g;
          break;
        }
        default:
          // AREA_GROUPING, SCALE_CONVERSION, GLOBAL_COMBINATION, QUALIFICATION_AGGREGATION:
          // their data (conversion tables, formulas, award rules) has no
          // authoritative source in BP-0. Stop rather than approximate.
          return stop(stage.kind, stage.dependency.status === 'RESOLVED' ? 'NOT_EVALUATED_IN_BP0' : stage.dependency.reason ?? `${stage.dependency.kind} unresolved`);
      }
    } catch (err) {
      if (err instanceof ScoreUnitError) return stop(stage.kind, `UNIT_ERROR: ${err.message}`);
      throw err;
    }
    last = stage.kind;
  }
  return { outputs, lastResolvedStage: last, stoppedAt: null, stopReason: null };
}

function boundaryInput(current: unknown, input: StageInput): number | null {
  if (!current || typeof current !== 'object') return null;
  if (input === 'WEIGHTED_SCORE' && (current as WeightedScore).unit === 'WEIGHTED_SCORE') return (current as WeightedScore).value;
  if (input === 'SCALED_SCORE' && (current as ScaledScore).unit === 'SCALED_SCORE') return (current as ScaledScore).value;
  if (input === 'COMPONENT_SCORE' && Array.isArray(current) && current.length === 1) return (current[0] as ComponentScore).earned;
  return null;
}

/** Boundaries must be strictly increasing; a value below the lowest boundary has no grade (null). */
export function gradeFor(value: number, boundaries: ReadonlyArray<{ label: string; min: number }>): string | null {
  if (boundaries.length === 0) return null;
  for (let i = 1; i < boundaries.length; i++) if (!(boundaries[i].min > boundaries[i - 1].min)) return null;
  let label: string | null = null;
  for (const b of boundaries) if (value >= b.min) label = b.label;
  return label;
}
