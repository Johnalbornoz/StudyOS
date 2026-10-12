/**
 * QF V5.1 -- the planning unit: CERTIFIED CORE x APPLICABLE ADAPTER x REQUIRED DELIVERY DEPTH (pure).
 *
 * V5 planned ITEM TEXTS: one authored text per blueprint slot. That count is not an architecture metric -- two
 * texts of one construct are one asset written twice. The plan is read here as five separate coverages, and the
 * number of Student-deliverable instances is DERIVED from them, never planned directly.
 *
 *   CORE_COVERAGE        blueprint concepts that have at least one certified core
 *   ADAPTER_COVERAGE     components in scope whose adapter is certified
 *   BLUEPRINT_COVERAGE   scalable buckets with at least one plannable (core, adapter) pair
 *   INSTANCE_CAPACITY    distinct valid parameter sets / template compositions each pair can render
 *   REPEATABILITY_DEPTH  how many full, non-repeating forms the capacity sustains for a bucket
 */
import type { AssessmentAdapter } from './assessment-adapter';
import { bucketIsScalable, type BlueprintBucketRef } from './assessment-specification';
import { blueprintGate } from './blueprint-classification';
import { applicabilityGate, type CoreApplicabilityRecord } from './core-applicability';
import { coreMayFeedStudentDelivery, type ConstructCoreRecord } from './construct-core';

export const LEGACY_PLAN_UNIT = 'ITEM_TEXT' as const;
export const PLAN_UNIT = 'CERTIFIED_CORE_X_APPLICABLE_ADAPTER_X_DELIVERY_DEPTH' as const;

export interface PlanUnit {
  constructFamilyId: string;
  familyVersion: string;
  adapterId: string;
  bucketId: string;
  /** Slots of this bucket in ONE form. */
  requiredPerForm: number;
  /** Non-repeating forms the unit must sustain. */
  requiredDepth: number;
  instanceCapacity: number;
  /** floor(capacity / requiredPerForm): full forms the unit can supply without repeating an instance. */
  repeatabilityDepth: number;
  meetsDepth: boolean;
}
export interface PlanRefusal { bucketId: string; constructFamilyId: string | null; adapterId: string; code: string }
export interface CorePlan {
  planUnit: typeof PLAN_UNIT;
  units: PlanUnit[];
  refusals: PlanRefusal[];
  coverage: {
    CORE_COVERAGE: { conceptsRequired: number; conceptsWithCertifiedCore: number };
    ADAPTER_COVERAGE: { adaptersRequired: number; adaptersCertified: number };
    BLUEPRINT_COVERAGE: { buckets: number; scalableBuckets: number; bucketsWithAPlannableUnit: number; bucketsMeetingDepth: number };
    INSTANCE_CAPACITY: number;
    REPEATABILITY_DEPTH: number | null;
  };
  /** Derived, never planned: instances Student delivery can actually be given at the required depth. */
  studentDeliverableInstances: number;
}

export interface PlanInput {
  cores: readonly ConstructCoreRecord[];
  adapters: readonly AssessmentAdapter[];
  applicability: readonly CoreApplicabilityRecord[];
  buckets: readonly (BlueprintBucketRef & { requiredPerForm: number })[];
  requiredDepth: number;
  /** Distinct instances a (core, adapter) pair can render. 0 when no strategy is registered for the core. */
  capacityOf(core: ConstructCoreRecord, adapter: AssessmentAdapter): number;
}

export function planByCore(input: PlanInput): CorePlan {
  const units: PlanUnit[] = [];
  const refusals: PlanRefusal[] = [];
  const certified = input.cores.filter(coreMayFeedStudentDelivery);
  for (const bucket of input.buckets) {
    const adapter = input.adapters.find((a) => a.adapterId === bucket.adapterId);
    // an unclassified, demonstration or not-applicable blueprint plans nothing for Students
    const blueprint = blueprintGate('PRACTICE', bucket.blueprintClass);
    if (!blueprint.ok) { refusals.push({ bucketId: bucket.bucketId, constructFamilyId: null, adapterId: bucket.adapterId, code: blueprint.code }); continue; }
    if (!bucketIsScalable(bucket)) { refusals.push({ bucketId: bucket.bucketId, constructFamilyId: null, adapterId: bucket.adapterId, code: 'BUCKET_HAS_NO_PRIMARY_CONCEPT_LINEAGE' }); continue; }
    if (!adapter || adapter.status !== 'CERTIFIED') { refusals.push({ bucketId: bucket.bucketId, constructFamilyId: null, adapterId: bucket.adapterId, code: 'ADAPTER_NOT_CERTIFIED' }); continue; }
    const cores = certified.filter((c) => bucket.primaryConceptStableIds.includes(c.primaryConceptStableId));
    if (cores.length === 0) { refusals.push({ bucketId: bucket.bucketId, constructFamilyId: null, adapterId: bucket.adapterId, code: 'NO_CERTIFIED_CORE_FOR_THE_BUCKET' }); continue; }
    for (const core of cores) {
      const gate = applicabilityGate(input.applicability, core, adapter.adapterId);
      if (!gate.ok) { refusals.push({ bucketId: bucket.bucketId, constructFamilyId: core.constructFamilyId, adapterId: adapter.adapterId, code: gate.code }); continue; }
      const instanceCapacity = input.capacityOf(core, adapter);
      const repeatabilityDepth = Math.floor(instanceCapacity / Math.max(1, bucket.requiredPerForm));
      units.push({ constructFamilyId: core.constructFamilyId, familyVersion: core.familyVersion, adapterId: adapter.adapterId, bucketId: bucket.bucketId, requiredPerForm: bucket.requiredPerForm, requiredDepth: input.requiredDepth, instanceCapacity, repeatabilityDepth, meetsDepth: repeatabilityDepth >= input.requiredDepth });
    }
  }
  const concepts = new Set(input.buckets.flatMap((b) => b.primaryConceptStableIds));
  const adaptersRequired = new Set(input.buckets.map((b) => b.adapterId));
  const depthOfBucket = (bucketId: string, perForm: number): number => Math.floor(units.filter((u) => u.bucketId === bucketId).reduce((n, u) => n + u.instanceCapacity, 0) / Math.max(1, perForm));
  const planned = input.buckets.filter((b) => units.some((u) => u.bucketId === b.bucketId));
  const depths = planned.map((b) => depthOfBucket(b.bucketId, b.requiredPerForm));
  return {
    planUnit: PLAN_UNIT, units, refusals,
    coverage: {
      CORE_COVERAGE: { conceptsRequired: concepts.size, conceptsWithCertifiedCore: [...concepts].filter((id) => certified.some((c) => c.primaryConceptStableId === id)).length },
      ADAPTER_COVERAGE: { adaptersRequired: adaptersRequired.size, adaptersCertified: [...adaptersRequired].filter((id) => input.adapters.find((a) => a.adapterId === id)?.status === 'CERTIFIED').length },
      BLUEPRINT_COVERAGE: { buckets: input.buckets.length, scalableBuckets: input.buckets.filter(bucketIsScalable).length, bucketsWithAPlannableUnit: planned.length, bucketsMeetingDepth: depths.filter((d) => d >= input.requiredDepth).length },
      INSTANCE_CAPACITY: units.reduce((n, u) => n + u.instanceCapacity, 0),
      REPEATABILITY_DEPTH: depths.length > 0 ? Math.min(...depths) : null,
    },
    studentDeliverableInstances: planned.reduce((n, b) => n + Math.min(depthOfBucket(b.bucketId, b.requiredPerForm), input.requiredDepth) * b.requiredPerForm, 0),
  };
}

/** A V5 generation specification is scalable only with concept lineage. V5's planner emits `conceptIds: []`. */
export const itemTextSpecificationIsScalable = (spec: { conceptIds: readonly string[] }): boolean => spec.conceptIds.length > 0;
