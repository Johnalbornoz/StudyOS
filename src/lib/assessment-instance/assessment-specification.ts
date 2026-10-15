/**
 * QF V5.1 -- core + applicability + adapter + blueprint bucket -> a valid assessment specification (pure).
 *
 * The blueprint does NOT define the construct. It says WHERE an applicable construct instance may appear: a
 * bucket of one component, for objectives that are linked to canonical concepts. The specification itself is the
 * EA-1 AdaptationSpecification: this module only decides whether the four parts may be combined, and then calls
 * the existing `adapt()`. It adds no rule of adaptation.
 *
 * A bucket with no primary-concept lineage is never scalable: nothing can be planned into it from a core.
 */
import { adapt } from '@/lib/assessment-adaptation/adapt';
import type { AdaptationRefusal, AdaptationSpecification } from '@/lib/assessment-adaptation/adaptation-specification';
import type { AssessmentApplicabilityRecord } from '@/lib/assessment-adaptation/assessment-applicability';
import type { AssessmentComponentProfile, AssessmentSystemProfile } from '@/lib/assessment-adaptation/assessment-system-profile';
import type { AssessmentAdapter } from './assessment-adapter';
import { isExaminedSystemType, systemGate, type AssessmentSystemRegistry } from './assessment-system-registry';
import { blueprintGate, type BlueprintClass } from './blueprint-classification';
import { applicabilityGate, familyForAdaptation, type CoreApplicabilityRecord } from './core-applicability';
import { coreContentIntact, coreMayFeedStudentDelivery, type ConstructCoreRecord } from './construct-core';

export const SPECIFICATION_USES = ['STUDENT_DELIVERY', 'DEV_TEST'] as const;
export type SpecificationUse = (typeof SPECIFICATION_USES)[number];

/** A bucket of a governed blueprint, with the canonical concepts its objective is linked to. */
export interface BlueprintBucketRef {
  /** Stable id: `<configKey>/<sectionKey>/<objectiveCode>#<targetIndex>`. */
  bucketId: string;
  configKey: string;
  sectionKey: string;
  /** The adapter (component) the section belongs to. */
  adapterId: string;
  objectiveCode: string;
  /** Stable ids of the canonical concepts the objective is linked to. Empty = no primary-concept lineage. */
  primaryConceptStableIds: readonly string[];
  /** The response format the bucket fixes, when it fixes one. */
  responseFormat: string | null;
  /** What the blueprint this bucket belongs to IS. Absent = unclassified, which satisfies nothing. */
  blueprintClass?: BlueprintClass;
}

export const bucketIsScalable = (b: Pick<BlueprintBucketRef, 'primaryConceptStableIds'>): boolean => b.primaryConceptStableIds.length > 0;

export type CompositionRefusalCode =
  | 'ASSESSMENT_SYSTEM_NOT_REGISTERED' | 'ASSESSMENT_SYSTEM_VERSION_NOT_REGISTERED' | 'ADAPTER_IS_NOT_THE_REGISTERED_ONE' | 'ASSESSMENT_SYSTEM_NOT_ACTIVE'
  | 'CORE_NOT_CERTIFIED' | 'CORE_CONTENT_CHANGED' | 'ADAPTER_NOT_CERTIFIED' | 'ADAPTER_IS_NOT_THE_COMPONENT' | 'NO_EXPLICIT_APPLICABILITY' | 'NOT_APPLICABLE'
  | 'EXAMINED_SYSTEM_IS_SAT_INDIVIDUALLY' | 'BLUEPRINT_NOT_CLASSIFIED' | 'BLUEPRINT_NOT_APPLICABLE' | 'BLUEPRINT_IS_A_DEMO' | 'BLUEPRINT_CLASS_DOES_NOT_SATISFY_THE_USE'
  | 'BUCKET_HAS_NO_PRIMARY_CONCEPT_LINEAGE' | 'BUCKET_IS_OF_ANOTHER_COMPONENT' | 'BUCKET_DOES_NOT_ASSESS_THE_CONCEPT' | 'BUCKET_FORMAT_EXCLUDED_BY_THE_CORE' | 'BUCKET_FORMAT_NOT_OFFERED_BY_THE_ADAPTER' | 'ADAPTATION_REFUSED';
export type CompositionResult =
  | { ok: true; specification: AdaptationSpecification; applicability: CoreApplicabilityRecord; bucket: BlueprintBucketRef; /** Set when a learning-approach requirement yielded to an examined system: what was not met, on the record. */ approachYielded: string | null }
  | { ok: false; code: CompositionRefusalCode; detail: string; adaptationRefusal?: AdaptationRefusal };

export interface CompositionInput {
  use: SpecificationUse;
  /** The registry the adapter must be registered in. There is no default: a system exists only where it is registered. */
  registry: AssessmentSystemRegistry;
  core: ConstructCoreRecord;
  adapter: AssessmentAdapter;
  system: AssessmentSystemProfile;
  component: AssessmentComponentProfile;
  coreApplicability: readonly CoreApplicabilityRecord[];
  /** The concept applicability register `adapt()` reads. */
  applicabilityRegister: readonly AssessmentApplicabilityRecord[];
  /** The threshold `adapt()` reads the register under. Absent = EA-1 (as before). */
  applicabilityPolicy?: unknown;
  bucket: BlueprintBucketRef;
  disciplinePolicy: unknown;
  request: { purpose: string; difficultyBand: string; language: string; contentUseClass: string; responseFormat?: string; participationMode?: string };
  /** The learning approach in force, when the institution has one. Against an examined system its requirements yield. */
  learningApproach?: unknown;
}

export function composeAssessmentSpecification(input: CompositionInput): CompositionResult {
  const { core, adapter, bucket } = input;
  const refuse = (code: CompositionRefusalCode, detail: string): CompositionResult => ({ ok: false, code, detail });
  // the adapter must be the registered adapter of a registered system version, whatever the system is
  const registered = systemGate(input.registry, adapter, input.use);
  if (!registered.ok) return refuse(registered.code, registered.detail);
  if (!coreContentIntact(core)) return refuse('CORE_CONTENT_CHANGED', `${core.constructFamilyId}@${core.familyVersion} no longer matches its content hash.`);
  if (input.use === 'STUDENT_DELIVERY') {
    if (!coreMayFeedStudentDelivery(core)) return refuse('CORE_NOT_CERTIFIED', `${core.constructFamilyId}@${core.familyVersion} is ${core.lifecycle}.`);
    if (adapter.status !== 'CERTIFIED') return refuse('ADAPTER_NOT_CERTIFIED', `${adapter.adapterId}@${adapter.version} is ${adapter.status}.`);
  }
  if (adapter.adapterId !== input.component.componentId) return refuse('ADAPTER_IS_NOT_THE_COMPONENT', `${adapter.adapterId} is not ${input.component.componentId}.`);
  const gate = applicabilityGate(input.coreApplicability, core, adapter.adapterId);
  if (!gate.ok) return refuse(gate.code, gate.detail);
  // the blueprint must be classified, and its class must admit this use: a demonstration blueprint feeds no Student
  const blueprint = blueprintGate(input.use === 'STUDENT_DELIVERY' ? 'PRACTICE' : 'DEV_TEST', bucket.blueprintClass);
  if (!blueprint.ok) return refuse(blueprint.code, `${bucket.bucketId}: ${blueprint.detail}`);
  if (!bucketIsScalable(bucket)) return refuse('BUCKET_HAS_NO_PRIMARY_CONCEPT_LINEAGE', `${bucket.bucketId} links no canonical concept.`);
  if (bucket.adapterId !== adapter.adapterId) return refuse('BUCKET_IS_OF_ANOTHER_COMPONENT', `${bucket.bucketId} belongs to ${bucket.adapterId}.`);
  if (!bucket.primaryConceptStableIds.includes(core.primaryConceptStableId)) return refuse('BUCKET_DOES_NOT_ASSESS_THE_CONCEPT', `${bucket.bucketId} does not link ${core.primaryConceptStableId}.`);
  if (bucket.responseFormat) {
    if (core.shortcutConstraints.some((s) => (s.excludedFormats as readonly string[]).includes(bucket.responseFormat!)) || !(core.family.responseConstraints.allowedFormats as readonly string[]).includes(bucket.responseFormat)) {
      return refuse('BUCKET_FORMAT_EXCLUDED_BY_THE_CORE', `${bucket.responseFormat} does not show the evidence target of ${core.constructFamilyId}.`);
    }
    if (!adapter.responseFormats.includes(bucket.responseFormat)) return refuse('BUCKET_FORMAT_NOT_OFFERED_BY_THE_ADAPTER', `${adapter.adapterId} offers ${adapter.responseFormats.join(', ')}.`);
  }
  // WHETHER THE SYSTEM IS EXAMINED IS THE REGISTRY'S FACT. The legacy exam-family code of the rule profile decides
  // nothing here: a system registered after that taxonomy has no code in it and is no less an examination.
  // (The two rules are enforced in this composer and not inside `adapt()`, whose source earlier recorded runs hash.)
  const examined = isExaminedSystemType(registered.system.systemType);
  if (examined && input.request.participationMode === 'COLLABORATIVE') return refuse('EXAMINED_SYSTEM_IS_SAT_INDIVIDUALLY', `${registered.system.systemId} is registered as ${registered.system.systemType}: its assessments are sat individually`);
  const run = (withApproach: boolean) => adapt({
    family: familyForAdaptation(core, gate.record), profile: input.system, component: input.component, applicability: input.applicabilityRegister, disciplinePolicy: input.disciplinePolicy, ...(input.applicabilityPolicy !== undefined ? { applicabilityPolicy: input.applicabilityPolicy } : {}),
    ...(withApproach && input.learningApproach !== undefined ? { learningApproach: input.learningApproach } : {}),
    // the specification records the bucket it is for: the blueprint places the instance, it does not define it
    request: { ...input.request, requirementCellKey: bucket.bucketId, ...(bucket.responseFormat ? { responseFormat: bucket.responseFormat } : {}) },
  });
  let result = run(true);
  let approachYielded: string | null = null;
  // an approach requirement "outside exams" yields to an examined system, and the yield is kept on the record
  if (!result.ok && examined && result.refusal.code === 'LEARNING_APPROACH_REQUIREMENT_UNMET') { approachYielded = result.refusal.detail; result = run(false); }
  if (!result.ok) return { ok: false, code: 'ADAPTATION_REFUSED', detail: `${result.refusal.code}`, adaptationRefusal: result.refusal };
  return { ok: true, specification: result.specification, applicability: gate.record, bucket, approachYielded };
}
