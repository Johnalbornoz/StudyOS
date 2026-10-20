/**
 * QF V5.1 -- explicit applicability of a construct core to an assessment system / component (pure, no IO).
 *
 * One persisted record per core version x component. It joins the two facts EA-1 already keeps apart and never
 * infers either:
 *   BEHAVIOUR FIT   the family's own `profileSupport` for the system (can this way of asking be hosted?)
 *   CONCEPT SCOPE   the assessment-applicability register (may this concept be assessed by this component?)
 *
 *   SUPPORTED        the family supports the system with no constraint AND applicability is established
 *   CONDITIONAL      as above, but the family's support carries constraints an instance must satisfy
 *   NOT_APPLICABLE   the family does not support the system, OR nothing establishes that the concept is assessed
 *                    there. Stated with its reason; never silently absent.
 *
 * A combination with NO record is not "probably fine": the planner refuses it (NO_EXPLICIT_APPLICABILITY). No
 * construct is assumed to belong in every model.
 */
import { EA1_APPLICABILITY_THRESHOLD, resolveApplicability, type ApplicabilityThresholdPolicy, type AssessmentApplicabilityRecord } from '@/lib/assessment-adaptation/assessment-applicability';
import type { SupportConstraint, TaskFamily } from '@/lib/exam-core/question-bank/task-families/task-family';
import type { ConstructCoreRecord } from './construct-core';

export const CORE_APPLICABILITY_STATUSES = ['SUPPORTED', 'CONDITIONAL', 'NOT_APPLICABLE'] as const;
export type CoreApplicabilityStatus = (typeof CORE_APPLICABILITY_STATUSES)[number];

export interface CoreApplicabilityRecord {
  constructFamilyId: string;
  familyVersion: string;
  systemProfileId: string;
  componentId: string;
  status: CoreApplicabilityStatus;
  /** Why, in words. Required for CONDITIONAL and NOT_APPLICABLE. */
  reason: string | null;
  /** The family's own constraints for this system. An instance outside one is refused, never bent to fit. */
  constraints: SupportConstraint[];
  basis: {
    behaviourSupport: 'SUPPORTED' | 'SUPPORTED_WITH_CONSTRAINTS' | 'UNSUPPORTED' | 'NOT_DECLARED';
    /**
     * Who declared the behaviour fit. FAMILY: the core's own `profileSupport`. APPLICABILITY_RECORD: the core was
     * written before this system existed and is silent about it, so the fit is declared here, by whoever records
     * the applicability -- the core is not edited to learn about a new system. Absent = FAMILY.
     */
    behaviourSupportDeclaredBy?: 'FAMILY' | 'APPLICABILITY_RECORD';
    conceptApplicability: { status: 'ESTABLISHED' | 'NOT_ESTABLISHED'; basis: string };
    thresholdPolicy: { policyId: string; version: string };
  };
}

/** The record for one core and one component, from what the family declares and what the register records. */
export function deriveCoreApplicability(
  core: ConstructCoreRecord,
  target: { systemProfileId: string; componentId: string },
  register: readonly AssessmentApplicabilityRecord[],
  policy: ApplicabilityThresholdPolicy = EA1_APPLICABILITY_THRESHOLD,
  /**
   * The behaviour fit for a system the core does not mention. Used ONLY when the family declares nothing for the
   * system: what the family itself says -- including UNSUPPORTED -- is never overridden from outside.
   */
  declared?: DeclaredSupport,
): CoreApplicabilityRecord {
  const own = core.family.profileSupport[target.systemProfileId];
  const support = own ?? (declared ? (declared.constraints.length > 0 ? { status: 'SUPPORTED_WITH_CONSTRAINTS' as const, constraints: declared.constraints } : { status: 'SUPPORTED' as const }) : undefined);
  const concept = resolveApplicability(register, core.family.primaryConcepts[0], target, policy);
  const basis: CoreApplicabilityRecord['basis'] = {
    behaviourSupport: support?.status ?? 'NOT_DECLARED',
    conceptApplicability: { status: concept.status, basis: concept.basis },
    thresholdPolicy: { policyId: policy.policyId, version: policy.version },
    ...(!own && declared ? { behaviourSupportDeclaredBy: 'APPLICABILITY_RECORD' as const } : {}),
  };
  const head = { constructFamilyId: core.constructFamilyId, familyVersion: core.familyVersion, systemProfileId: target.systemProfileId, componentId: target.componentId, basis };
  if (!support) return { ...head, status: 'NOT_APPLICABLE', reason: `The family declares no support for ${target.systemProfileId}.`, constraints: [] };
  if (support.status === 'UNSUPPORTED') return { ...head, status: 'NOT_APPLICABLE', reason: support.reason, constraints: [] };
  if (concept.status !== 'ESTABLISHED') return { ...head, status: 'NOT_APPLICABLE', reason: `Nothing recorded establishes that ${core.primaryConceptStableId} is assessed by ${target.componentId}.`, constraints: [] };
  if (support.status === 'SUPPORTED_WITH_CONSTRAINTS') return { ...head, status: 'CONDITIONAL', reason: support.constraints.map((c) => c.reason).join(' '), constraints: support.constraints };
  return { ...head, status: 'SUPPORTED', reason: null, constraints: [] };
}

/** A behaviour fit declared with the applicability record, for a system the core is silent about. */
export interface DeclaredSupport { constraints: SupportConstraint[]; declaredBy: string; reason: string }

/**
 * The family as `adapt()` must read it for one applicability record. Where the record itself declares the
 * behaviour fit, the family is read WITH that declaration; the stored core is not changed and keeps its hash.
 */
export function familyForAdaptation(core: ConstructCoreRecord, record: CoreApplicabilityRecord): TaskFamily {
  if (record.basis.behaviourSupportDeclaredBy !== 'APPLICABILITY_RECORD' || core.family.profileSupport[record.systemProfileId]) return core.family;
  const support = record.constraints.length > 0 ? { status: 'SUPPORTED_WITH_CONSTRAINTS' as const, constraints: record.constraints } : { status: 'SUPPORTED' as const };
  return { ...core.family, profileSupport: { ...core.family.profileSupport, [record.systemProfileId]: support } } as TaskFamily;
}

export type ApplicabilityGate = { ok: true; record: CoreApplicabilityRecord } | { ok: false; code: 'NO_EXPLICIT_APPLICABILITY' | 'NOT_APPLICABLE'; detail: string };

/** The planner's gate: a combination is plannable only with an explicit SUPPORTED or CONDITIONAL record. */
export function applicabilityGate(records: readonly CoreApplicabilityRecord[], core: Pick<ConstructCoreRecord, 'constructFamilyId' | 'familyVersion'>, componentId: string): ApplicabilityGate {
  const record = records.find((r) => r.constructFamilyId === core.constructFamilyId && r.familyVersion === core.familyVersion && r.componentId === componentId);
  if (!record) return { ok: false, code: 'NO_EXPLICIT_APPLICABILITY', detail: `No applicability is recorded for ${core.constructFamilyId}@${core.familyVersion} x ${componentId}.` };
  if (record.status === 'NOT_APPLICABLE') return { ok: false, code: 'NOT_APPLICABLE', detail: record.reason ?? 'Not applicable.' };
  return { ok: true, record };
}

/** Does a rendered decision respect the record's constraints? Each violated constraint is returned by kind. */
export function violatedConstraints(record: CoreApplicabilityRecord, decided: { format: string; contextKind: string; band: string; calculator: string }): string[] {
  return record.constraints.flatMap((c) => {
    const ok =
      c.kind === 'RESPONSE_FORMAT_ONLY' ? (c.formats as readonly string[]).includes(decided.format)
      : c.kind === 'CONTEXT_ONLY' ? (c.contexts as readonly string[]).includes(decided.contextKind)
      : c.kind === 'DIFFICULTY_ONLY' ? (c.bands as readonly string[]).includes(decided.band)
      : (c.policies as readonly string[]).includes(decided.calculator);
    return ok ? [] : [c.kind];
  });
}
