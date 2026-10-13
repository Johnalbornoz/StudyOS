/**
 * QF V5.1 -- who certifies what, and how an item instance comes to be certified (pure, no IO).
 *
 * CERTIFICATION IS A DECISION OF A PERSON, ON THE RECORD. A certification record names the reviewer, the scope
 * the reviewer holds, the object (type, id, version), the decision, when, and the hash of exactly what was
 * reviewed. A record whose hash is not the object's current hash certifies nothing: the object changed.
 *
 * TWO LEGITIMATE WAYS for an item instance to be certified, and no third:
 *   INDIVIDUAL_ITEM_REVIEW                 a qualified reviewer approved this instance (the existing rule, kept).
 *   INHERITED_DETERMINISTIC_CERTIFICATION  nobody reviewed this instance; it inherits from a certified core, a
 *                                          certified adapter, a certified renderer envelope and a governed
 *                                          blueprint, because the renderer is deterministic and the instance is
 *                                          inside the envelope. Every condition is checked; one that fails names
 *                                          itself and the instance falls back to needing an individual review.
 * Neither valid = not certified. Nothing here grants a certification: it only reads records.
 *
 * AUTHORITY. `INTERNAL_PILOT_REVIEWER` is an internal StudyUs certification authority for the pilot. It is not,
 * and is never presented as, an external academic accreditation.
 */
import { z } from 'zod';
import { blueprintGate } from './blueprint-classification';
import type { CoreApplicabilityStatus } from './core-applicability';
import type { RenderingStrategyKind } from './renderer';
import { ITEM_DIFFICULTY_MAX, ITEM_DIFFICULTY_MIN } from './renderer-envelope';

export const CERTIFICATION_RECORD_CONTRACT_VERSION = 1 as const;
export const CERTIFIABLE_OBJECT_TYPES = ['CONSTRUCT_CORE', 'ASSESSMENT_ADAPTER', 'RENDERER_ENVELOPE', 'BLUEPRINT_CLASSIFICATION', 'CORE_APPLICABILITY', 'ITEM_INSTANCE'] as const;
export type CertifiableObjectType = (typeof CERTIFIABLE_OBJECT_TYPES)[number];
export const CERTIFICATION_DECISIONS = ['APPROVE', 'APPROVE_WITH_CHANGES', 'REJECT'] as const;
export type CertificationRecordDecision = (typeof CERTIFICATION_DECISIONS)[number];
/** Kinds of certification authority. Internal ones are StudyUs's own; none of them is an external accreditation. */
export const CERTIFICATION_AUTHORITIES = ['INTERNAL_PILOT_REVIEWER'] as const;
export type CertificationAuthority = (typeof CERTIFICATION_AUTHORITIES)[number];
export const authorityIsExternalAccreditation = (_authority: CertificationAuthority): false => false;

const ID = z.string().trim().min(1).max(200);
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
/** What a reviewer may certify: a canonical subject within one registered assessment system. No wildcard. */
export const ReviewerScopeSchema = z.strictObject({ canonicalSubject: ID, systemId: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/) });
export type ReviewerScope = z.infer<typeof ReviewerScopeSchema>;

export const ReviewerQualificationSchema = z.strictObject({
  v: z.literal(CERTIFICATION_RECORD_CONTRACT_VERSION),
  reviewerId: ID,
  authority: z.enum(CERTIFICATION_AUTHORITIES),
  scopes: z.array(ReviewerScopeSchema).min(1).max(40),
  grantedBy: ID,
  grantedAt: z.string().datetime({ offset: true }),
  revokedAt: z.string().datetime({ offset: true }).nullable(),
});
export type ReviewerQualification = z.infer<typeof ReviewerQualificationSchema>;

export const CertificationRecordSchema = z
  .strictObject({
    v: z.literal(CERTIFICATION_RECORD_CONTRACT_VERSION),
    reviewerId: ID,
    authority: z.enum(CERTIFICATION_AUTHORITIES),
    scope: ReviewerScopeSchema,
    objectType: z.enum(CERTIFIABLE_OBJECT_TYPES),
    objectId: ID,
    objectVersion: ID,
    decision: z.enum(CERTIFICATION_DECISIONS),
    decidedAt: z.string().datetime({ offset: true }),
    /** sha256 of exactly what was reviewed. */
    evidenceHash: SHA256,
    notes: z.string().trim().max(4000).nullable(),
  })
  // a decision other than a plain approval says why
  .superRefine((r, ctx) => { if (r.decision !== 'APPROVE' && (r.notes === null || r.notes.length < 10)) ctx.addIssue({ code: 'custom', path: ['notes'], message: 'DECISION_NEEDS_A_REASON' }); });
export type CertificationRecord = z.infer<typeof CertificationRecordSchema>;

export const scopeCovers = (q: Pick<ReviewerQualification, 'scopes'>, scope: ReviewerScope): boolean => q.scopes.some((s) => s.canonicalSubject === scope.canonicalSubject && s.systemId === scope.systemId);

/** The object a certification is claimed for, as it is NOW. */
export interface CertifiableObject { objectType: CertifiableObjectType; objectId: string; objectVersion: string; contentHash: string; scope: ReviewerScope }
export type CertificationRefusal =
  | 'NO_CERTIFICATION_RECORD' | 'RECORD_INVALID' | 'RECORD_IS_OF_ANOTHER_OBJECT' | 'OBJECT_CHANGED_SINCE_REVIEW' | 'DECISION_IS_NOT_AN_APPROVAL' | 'SCOPE_IS_NOT_THE_OBJECTS'
  | 'REVIEWER_NOT_QUALIFIED' | 'REVIEWER_SCOPE_DOES_NOT_COVER' | 'QUALIFICATION_REVOKED' | 'DECIDED_BEFORE_THE_QUALIFICATION';
export type CertificationState = { certified: true; record: CertificationRecord } | { certified: false; reason: CertificationRefusal; detail: string };

/**
 * Is this object certified? Only by an APPROVE of exactly this object at exactly this content, by a reviewer whose
 * qualification covered the scope when the decision was made. APPROVE_WITH_CHANGES certifies nothing: the changed
 * object is a new version with a new hash, and it needs its own APPROVE.
 */
export function certificationStateOf(object: CertifiableObject, record: unknown, qualifications: readonly ReviewerQualification[]): CertificationState {
  const no = (reason: CertificationRefusal, detail = ''): CertificationState => ({ certified: false, reason, detail });
  if (record === null || record === undefined) return no('NO_CERTIFICATION_RECORD', `${object.objectType} ${object.objectId}@${object.objectVersion}`);
  const parsed = CertificationRecordSchema.safeParse(record);
  if (!parsed.success) return no('RECORD_INVALID', parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const r = parsed.data;
  if (r.objectType !== object.objectType || r.objectId !== object.objectId || r.objectVersion !== object.objectVersion) return no('RECORD_IS_OF_ANOTHER_OBJECT', `${r.objectType} ${r.objectId}@${r.objectVersion}`);
  if (r.evidenceHash !== object.contentHash) return no('OBJECT_CHANGED_SINCE_REVIEW', `${object.objectId}@${object.objectVersion}`);
  if (r.decision !== 'APPROVE') return no('DECISION_IS_NOT_AN_APPROVAL', r.decision);
  if (r.scope.canonicalSubject !== object.scope.canonicalSubject || r.scope.systemId !== object.scope.systemId) return no('SCOPE_IS_NOT_THE_OBJECTS', `${r.scope.canonicalSubject} x ${r.scope.systemId}`);
  const held = qualifications.filter((q) => q.reviewerId === r.reviewerId && q.authority === r.authority);
  if (held.length === 0) return no('REVIEWER_NOT_QUALIFIED', r.reviewerId);
  const covering = held.filter((q) => scopeCovers(q, r.scope));
  if (covering.length === 0) return no('REVIEWER_SCOPE_DOES_NOT_COVER', `${r.scope.canonicalSubject} x ${r.scope.systemId}`);
  const inForce = covering.filter((q) => q.grantedAt <= r.decidedAt);
  if (inForce.length === 0) return no('DECIDED_BEFORE_THE_QUALIFICATION', r.decidedAt);
  if (!inForce.some((q) => q.revokedAt === null || r.decidedAt < q.revokedAt)) return no('QUALIFICATION_REVOKED', r.reviewerId);
  return { certified: true, record: r };
}

// ------------------------------------------------------------------------------------------ item instances
export const INSTANCE_CERTIFICATION_MODES = ['INDIVIDUAL_ITEM_REVIEW', 'INHERITED_DETERMINISTIC_CERTIFICATION'] as const;
export type InstanceCertificationMode = (typeof INSTANCE_CERTIFICATION_MODES)[number];
/** Rights under which content may be delivered. Anything else, and no record, does not deliver. */
export const DELIVERABLE_RIGHTS = ['STUDYUS_OWNED', 'LICENSED_FOR_USE', 'OFFICIALLY_AUTHORIZED'] as const;

export const INHERITANCE_REFUSALS = [
  'CORE_NOT_CERTIFIED', 'ADAPTER_NOT_CERTIFIED', 'RENDERER_ENVELOPE_NOT_CERTIFIED', 'BLUEPRINT_CLASSIFICATION_NOT_CERTIFIED', 'BLUEPRINT_CLASS_NOT_ELIGIBLE', 'APPLICABILITY_NOT_SUPPORTED',
  'CONDITIONAL_APPLICABILITY_NOT_APPROVED', 'RENDERER_NOT_DETERMINISTIC', 'OUTSIDE_THE_CERTIFIED_ENVELOPE', 'KEY_OR_RUBRIC_NOT_FROM_THE_RENDERER', 'RIGHTS_NOT_VALID', 'LINEAGE_INCOMPLETE',
  'LINEAGE_ALTERED', 'DIFFICULTY_NOT_RECORDED', 'UNSUPPORTED_REPRESENTATION', 'STIMULUS_OR_TEMPLATE_CONTENT_NEEDS_ITS_OWN_ENVELOPE', 'MANUALLY_EDITED', 'RENDERER_VERSION_CHANGED',
] as const;
export type InheritanceRefusal = (typeof INHERITANCE_REFUSALS)[number];

/** Everything inheritance depends on, each stated. Nothing is defaulted to "fine": an absent fact is a refusal. */
export interface InheritanceFacts {
  core: CertificationState;
  adapter: CertificationState;
  rendererEnvelope: CertificationState;
  blueprintClassification: CertificationState;
  blueprintClass: unknown;
  applicability: { status: CoreApplicabilityStatus | null; conditionalApproval: CertificationState | null };
  strategy: RenderingStrategyKind;
  /** The template envelope that explicitly covers composed / stimulus-bearing content, when one is certified. */
  templateEnvelope: CertificationState | null;
  hasStimulus: boolean;
  /** `instanceEnvelopeIssues(...)`: empty = inside the certified envelope. */
  envelopeIssues: readonly { code: string; detail: string }[];
  /** The renderer version of the instance is the version the certified envelope names. */
  rendererVersionIsTheCertifiedOne: boolean;
  /** Key, rubric and response policy are exactly what the renderer produced (content hash unchanged). */
  contentIsTheRenderers: boolean;
  manuallyEdited: boolean;
  rights: { status: string | null; inForce: boolean };
  lineageComplete: boolean;
  lineageIntact: boolean;
  itemDifficulty: number | null;
  /** Representations the instance needs and nothing certified draws (a diagram). Empty = none. */
  unsupportedRepresentations: readonly string[];
}

/** May this instance be certified by inheritance? Every unmet condition is returned. */
export function inheritanceRefusals(f: InheritanceFacts): InheritanceRefusal[] {
  const out: InheritanceRefusal[] = [];
  if (!f.core.certified) out.push('CORE_NOT_CERTIFIED');
  if (!f.adapter.certified) out.push('ADAPTER_NOT_CERTIFIED');
  if (!f.rendererEnvelope.certified) out.push('RENDERER_ENVELOPE_NOT_CERTIFIED');
  if (!f.blueprintClassification.certified) out.push('BLUEPRINT_CLASSIFICATION_NOT_CERTIFIED');
  if (!blueprintGate('PRACTICE', f.blueprintClass).ok) out.push('BLUEPRINT_CLASS_NOT_ELIGIBLE');
  if (f.applicability.status !== 'SUPPORTED' && f.applicability.status !== 'CONDITIONAL') out.push('APPLICABILITY_NOT_SUPPORTED');
  if (f.applicability.status === 'CONDITIONAL' && !f.applicability.conditionalApproval?.certified) out.push('CONDITIONAL_APPLICABILITY_NOT_APPROVED');
  // composed or stimulus-bearing content inherits only inside a template envelope certified for exactly that
  const composed = f.strategy !== 'PARAMETRIC_DETERMINISTIC' || f.hasStimulus;
  if (composed && !f.templateEnvelope?.certified) out.push('STIMULUS_OR_TEMPLATE_CONTENT_NEEDS_ITS_OWN_ENVELOPE');
  if (f.strategy !== 'PARAMETRIC_DETERMINISTIC' && f.strategy !== 'CERTIFIED_TEMPLATE_COMPOSITION') out.push('RENDERER_NOT_DETERMINISTIC');
  if (f.envelopeIssues.length > 0) out.push('OUTSIDE_THE_CERTIFIED_ENVELOPE');
  if (!f.rendererVersionIsTheCertifiedOne) out.push('RENDERER_VERSION_CHANGED');
  if (!f.contentIsTheRenderers) out.push('KEY_OR_RUBRIC_NOT_FROM_THE_RENDERER');
  if (f.manuallyEdited) out.push('MANUALLY_EDITED');
  if (!f.rights.inForce || !(DELIVERABLE_RIGHTS as readonly string[]).includes(f.rights.status ?? '')) out.push('RIGHTS_NOT_VALID');
  if (!f.lineageComplete) out.push('LINEAGE_INCOMPLETE');
  if (!f.lineageIntact) out.push('LINEAGE_ALTERED');
  if (f.itemDifficulty === null || !Number.isInteger(f.itemDifficulty) || f.itemDifficulty < ITEM_DIFFICULTY_MIN || f.itemDifficulty > ITEM_DIFFICULTY_MAX) out.push('DIFFICULTY_NOT_RECORDED');
  if (f.unsupportedRepresentations.length > 0) out.push('UNSUPPORTED_REPRESENTATION');
  return out;
}

export type InstanceCertification =
  | { certified: true; mode: InstanceCertificationMode; itemDifficulty: number }
  | { certified: false; mode: null; inheritance: InheritanceRefusal[]; individualReview: CertificationRefusal | 'CONDITION_AN_INDIVIDUAL_REVIEW_CANNOT_REPLACE' };

/**
 * What an individual review of the instance stands in for: the review of the envelope the instance is not inside
 * of. Everything else -- a certified core and adapter, a governed blueprint, applicability, rights, lineage, a
 * recorded difficulty, a renderable representation -- is a condition of delivery that no review of one item lifts.
 */
export const REPLACEABLE_BY_INDIVIDUAL_REVIEW: readonly InheritanceRefusal[] = [
  'RENDERER_ENVELOPE_NOT_CERTIFIED', 'OUTSIDE_THE_CERTIFIED_ENVELOPE', 'RENDERER_VERSION_CHANGED', 'STIMULUS_OR_TEMPLATE_CONTENT_NEEDS_ITS_OWN_ENVELOPE', 'RENDERER_NOT_DETERMINISTIC', 'KEY_OR_RUBRIC_NOT_FROM_THE_RENDERER', 'MANUALLY_EDITED',
];

/**
 * The certification of one item instance. Inheritance first; where the only unmet conditions are those an
 * individual review replaces, an approval of this instance by a qualified reviewer; otherwise not certified,
 * with both reasons. Fail closed: neither mode valid = not certified.
 */
export function instanceCertificationOf(facts: InheritanceFacts, individualReview: CertificationState): InstanceCertification {
  const inheritance = inheritanceRefusals(facts);
  if (inheritance.length === 0) return { certified: true, mode: 'INHERITED_DETERMINISTIC_CERTIFICATION', itemDifficulty: facts.itemDifficulty as number };
  const replaceable = inheritance.every((r) => REPLACEABLE_BY_INDIVIDUAL_REVIEW.includes(r));
  if (individualReview.certified && replaceable) return { certified: true, mode: 'INDIVIDUAL_ITEM_REVIEW', itemDifficulty: facts.itemDifficulty as number };
  return { certified: false, mode: null, inheritance, individualReview: individualReview.certified ? 'CONDITION_AN_INDIVIDUAL_REVIEW_CANNOT_REPLACE' : individualReview.reason };
}
