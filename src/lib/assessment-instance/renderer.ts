/**
 * QF V5.1 -- the AssessmentInstanceRenderer: certified core + certified adapter + supported applicability +
 * blueprint bucket + controlled seed -> a complete learner-facing item instance (pure, deterministic, no IO).
 *
 * NO PROVIDER. This module and every strategy it dispatches to import no model client, read no environment and
 * no clock, and use no randomness other than a generator seeded from the request. The same input gives the same
 * instance on any machine at any time.
 *
 * STRATEGIES. A strategy is registered for a construct and is itself a certified, versioned artefact:
 *   PARAMETRIC_DETERMINISTIC          the family's relationships, parameter ranges and solution rules fully
 *                                     determine a valid item; the strategy draws a parameter set and computes it.
 *   CERTIFIED_TEMPLATE_COMPOSITION    the construct needs richer language or a stimulus; the strategy composes
 *                                     only certified components (stems, stimuli, data blocks, error models).
 * A construct with no registered strategy cannot be rendered: nothing falls back to generation.
 */
import { createHash } from 'node:crypto';
import type { AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { adapterMayFeedStudentDelivery, type AssessmentAdapter } from './assessment-adapter';
import { systemGate, type AssessmentSystemRegistry } from './assessment-system-registry';
import { blueprintGate } from './blueprint-classification';
import type { BlueprintBucketRef, SpecificationUse } from './assessment-specification';
import { violatedConstraints, type CoreApplicabilityRecord } from './core-applicability';
import { coreContentIntact, coreMayFeedStudentDelivery, type ConstructCoreRecord } from './construct-core';
import { ItemInstanceLineageSchema, type ItemInstanceLineage } from './item-instance-lineage';
import type { DistractorLineage } from './instance-validators';
import type { ResponseEvaluationPolicy } from './response-evaluation';

export const RENDERING_STRATEGIES = ['PARAMETRIC_DETERMINISTIC', 'CERTIFIED_TEMPLATE_COMPOSITION'] as const;
export type RenderingStrategyKind = (typeof RENDERING_STRATEGIES)[number];

export interface LearnerInstance {
  language: string;
  itemType: string;
  stimulus: string | null;
  /** The complete learner-facing question. */
  prompt: string;
  parts: { label: string; prompt: string; marks: number }[];
  options: { label: string; text: string }[];
  marks: number;
  /** What the learner is told about the conditions: tool policy and whether working is assessed. */
  conditions: { calculator: string; workingShown: boolean };
}
export interface InstanceKey {
  /** The value(s) a correct response gives, canonical form. */
  answers: string[];
  /** For a selected response: the correct option label. */
  correctOption: string | null;
  /** Per wrong option: the modelled error that produces it. */
  distractorRationales: Record<string, string>;
  /** Per wrong option: the misconception of the core it comes from, the reasoning error and the answer that error gives. */
  distractorLineage: Record<string, DistractorLineage>;
}
export interface RubricPoint { code: string; kind: string; marks: number; criterion: string }
export interface RenderedInstance {
  strategy: RenderingStrategyKind;
  learner: LearnerInstance;
  key: InstanceKey;
  rubric: RubricPoint[];
  /** How a response to THIS instance is judged: forms, separators, units, rounding, tolerance, partial credit. */
  responsePolicy: ResponseEvaluationPolicy;
  /** The parameter set the seed resolved to; `lineage.parameterSetId` is its hash. */
  parameterSet: Record<string, number | string>;
  lineage: ItemInstanceLineage;
}

/** Deterministic integer source: sha256 counter mode over the seed material. */
export interface SeededSource { int(minInclusive: number, maxInclusive: number): number; pick<T>(items: readonly T[]): T }
export function seededSource(material: string): SeededSource {
  let counter = 0;
  const next = (): number => createHash('sha256').update(`${material}#${(counter += 1)}`).digest().readUInt32BE(0);
  const int = (lo: number, hi: number): number => lo + (next() % (hi - lo + 1));
  return { int, pick: (items) => items[int(0, items.length - 1)] };
}

export interface StrategyContext {
  core: ConstructCoreRecord;
  adapter: AssessmentAdapter;
  specification: AdaptationSpecification;
  source: SeededSource;
}
export interface StrategyOutput { learner: LearnerInstance; key: InstanceKey; rubric: RubricPoint[]; responsePolicy: ResponseEvaluationPolicy; parameterSet: Record<string, number | string> }
export type StrategyResult = { ok: true; output: StrategyOutput } | { ok: false; code: string; detail: string };
export interface RenderingStrategy {
  /** The construct name of the family specialisation this strategy renders. */
  construct: string;
  kind: RenderingStrategyKind;
  rendererVersion: string;
  /** A strategy is certified like a core: an uncertified one renders dev-test instances only. */
  status: 'PROVISIONAL' | 'CERTIFIED';
  /**
   * Stimulus kinds this strategy can actually draw (GRAPH, FIGURE, ...). Absent = none: text and tables only.
   * No strategy draws a diagram yet, so a construct that requires one is refused, never rendered in words.
   */
  renderableStimulusKinds?: readonly string[];
  render(ctx: StrategyContext): StrategyResult;
}

/** Stimulus kinds that are drawings: a strategy must declare it draws them. */
export const DRAWN_STIMULUS_KINDS: readonly string[] = ['GRAPH', 'FIGURE', 'COMPOSITE'];
/** The drawn stimulus kinds a core REQUIRES (not merely allows) and a strategy does not draw. */
export function unrenderableRepresentations(core: Pick<ConstructCoreRecord, 'family'>, strategy: Pick<RenderingStrategy, 'renderableStimulusKinds'>): string[] {
  const c = core.family.responseConstraints;
  if (c.stimulusNeed !== 'REQUIRED') return [];
  // a required stimulus is unrenderable when every kind it may take is a drawing the strategy cannot draw
  const drawable = new Set(strategy.renderableStimulusKinds ?? []);
  const usable = c.stimulusKinds.filter((k) => !DRAWN_STIMULUS_KINDS.includes(k) || drawable.has(k));
  return usable.length > 0 ? [] : c.stimulusKinds.filter((k) => DRAWN_STIMULUS_KINDS.includes(k));
}

export type RenderRefusalCode =
  | 'ASSESSMENT_SYSTEM_NOT_REGISTERED' | 'ASSESSMENT_SYSTEM_VERSION_NOT_REGISTERED' | 'ADAPTER_IS_NOT_THE_REGISTERED_ONE' | 'ASSESSMENT_SYSTEM_NOT_ACTIVE'
  | 'CORE_NOT_CERTIFIED' | 'CORE_CONTENT_CHANGED' | 'ADAPTER_NOT_CERTIFIED' | 'APPLICABILITY_NOT_SUPPORTED' | 'APPLICABILITY_CONSTRAINT_VIOLATED' | 'SPECIFICATION_IS_NOT_OF_THIS_CORE'
  | 'SPECIFICATION_IS_NOT_OF_THIS_ADAPTER' | 'NO_RENDERING_STRATEGY' | 'REPRESENTATION_NOT_RENDERABLE' | 'BLUEPRINT_NOT_CLASSIFIED' | 'BLUEPRINT_NOT_APPLICABLE' | 'BLUEPRINT_IS_A_DEMO' | 'BLUEPRINT_CLASS_DOES_NOT_SATISFY_THE_USE' | 'RENDERER_NOT_CERTIFIED' | 'SHORTCUT_FORMAT_EXCLUDED' | 'STRATEGY_REFUSED' | 'LINEAGE_INCOMPLETE';
export type RenderResult = { ok: true; instance: RenderedInstance } | { ok: false; code: RenderRefusalCode; detail: string };

export interface RenderInput {
  use: SpecificationUse;
  /** The registry the adapter must be registered in. */
  registry: AssessmentSystemRegistry;
  core: ConstructCoreRecord;
  adapter: AssessmentAdapter;
  applicability: CoreApplicabilityRecord;
  specification: AdaptationSpecification;
  bucket: BlueprintBucketRef;
  /** Controlled input. The same seed gives the same instance. */
  seed: string;
}

export interface AssessmentInstanceRenderer { strategies(): readonly RenderingStrategy[]; render(input: RenderInput): RenderResult }

const constructOf = (core: ConstructCoreRecord): string | null => (core.family.specialization as { mathematicalStructure?: { construct?: string }; construct?: string } | null)?.mathematicalStructure?.construct ?? (core.family.specialization as { construct?: string } | null)?.construct ?? null;

export function createAssessmentInstanceRenderer(strategies: readonly RenderingStrategy[]): AssessmentInstanceRenderer {
  const byConstruct = new Map<string, RenderingStrategy>();
  for (const s of strategies) {
    if (byConstruct.has(s.construct)) throw new Error(`STRATEGY_ALREADY_REGISTERED: ${s.construct}`);
    byConstruct.set(s.construct, s);
  }
  return {
    strategies: () => [...byConstruct.values()],
    render(input) {
      const { core, adapter, applicability, specification, bucket, use } = input;
      const refuse = (code: RenderRefusalCode, detail: string): RenderResult => ({ ok: false, code, detail });
      const registered = systemGate(input.registry, adapter, use);
      if (!registered.ok) return refuse(registered.code, registered.detail);
      if (!coreContentIntact(core)) return refuse('CORE_CONTENT_CHANGED', core.constructFamilyId);
      if (specification.taskFamily.familyId !== core.constructFamilyId || specification.taskFamily.version !== core.familyVersion) return refuse('SPECIFICATION_IS_NOT_OF_THIS_CORE', specification.taskFamily.familyId);
      if (specification.componentProfile?.componentId !== adapter.adapterId) return refuse('SPECIFICATION_IS_NOT_OF_THIS_ADAPTER', `${specification.componentProfile?.componentId ?? 'no component'} vs ${adapter.adapterId}`);
      if (applicability.status === 'NOT_APPLICABLE' || applicability.constructFamilyId !== core.constructFamilyId || applicability.componentId !== adapter.adapterId) return refuse('APPLICABILITY_NOT_SUPPORTED', applicability.reason ?? applicability.status);
      const v = specification.variable;
      const violated = violatedConstraints(applicability, { format: v.responseFormat.format, contextKind: v.context.kind, band: v.difficulty.band, calculator: v.toolPolicy.calculator });
      if (violated.length > 0) return refuse('APPLICABILITY_CONSTRAINT_VIOLATED', violated.join(', '));
      const excluded = core.shortcutConstraints.find((s) => (s.excludedFormats as readonly string[]).includes(v.responseFormat.format));
      if (excluded) return refuse('SHORTCUT_FORMAT_EXCLUDED', `${excluded.id}: ${v.responseFormat.format}`);
      const construct = constructOf(core);
      const strategy = construct ? byConstruct.get(construct) : undefined;
      if (!strategy) return refuse('NO_RENDERING_STRATEGY', construct ?? 'the core names no construct');
      const blueprint = blueprintGate(use === 'STUDENT_DELIVERY' ? 'PRACTICE' : 'DEV_TEST', bucket.blueprintClass);
      if (!blueprint.ok) return refuse(blueprint.code, `${bucket.bucketId}: ${blueprint.detail}`);
      // fail closed: a construct that needs a diagram is not rendered until a strategy can draw one
      const undrawn = unrenderableRepresentations(core, strategy);
      if (undrawn.length > 0) return refuse('REPRESENTATION_NOT_RENDERABLE', `${core.constructFamilyId} requires ${undrawn.join(' / ')}; ${strategy.rendererVersion} draws ${(strategy.renderableStimulusKinds ?? []).join(', ') || 'no diagram'}`);
      if (use === 'STUDENT_DELIVERY') {
        if (!coreMayFeedStudentDelivery(core)) return refuse('CORE_NOT_CERTIFIED', core.lifecycle);
        if (!adapterMayFeedStudentDelivery(adapter)) return refuse('ADAPTER_NOT_CERTIFIED', `${adapter.status} / ${adapter.source}`);
        if (strategy.status !== 'CERTIFIED') return refuse('RENDERER_NOT_CERTIFIED', `${strategy.rendererVersion} is ${strategy.status}`);
      }
      // the parameter set depends on the seed, the core and the band -- NOT on the system: one seed is one piece of
      // mathematics, asked the way each adapter asks
      const source = seededSource([input.seed, core.constructFamilyId, core.familyVersion, v.difficulty.band, strategy.rendererVersion].join('|'));
      const rendered = strategy.render({ core, adapter, specification, source });
      if (!rendered.ok) return refuse('STRATEGY_REFUSED', `${rendered.code}: ${rendered.detail}`);
      const lineage = ItemInstanceLineageSchema.safeParse({
        constructFamilyId: core.constructFamilyId, constructFamilyVersion: core.familyVersion, primaryConceptId: core.primaryConceptStableId,
        adaptationSpecificationId: specification.specificationId, assessmentSystemId: registered.system.systemId, assessmentSystemVersionId: registered.version.versionId, assessmentAdapterId: adapter.adapterId, assessmentAdapterVersion: adapter.version, blueprintBucketId: bucket.bucketId,
        seed: input.seed, parameterSetId: sha256OfCanonicalJson(rendered.output.parameterSet), rendererVersion: strategy.rendererVersion,
        certificationVersion: core.certification?.certificationVersion ?? 'UNCERTIFIED-DEV-TEST',
      });
      if (!lineage.success) return refuse('LINEAGE_INCOMPLETE', lineage.error.issues.map((i) => i.path.join('.')).join(', '));
      return { ok: true, instance: { strategy: strategy.kind, ...rendered.output, lineage: lineage.data } };
    },
  };
}
