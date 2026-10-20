/**
 * EA-1 (D1) -- ASSESSMENT APPLICABILITY: may this canonical concept legitimately be assessed by this assessment
 * system, subject or component? (pure contract, no IO)
 *
 * TWO NOTIONS, NEVER ONE.
 *   CANONICAL CONCEPT CERTIFICATION   owned by the Curriculum; exam-independent. A concept exists once, under its
 *                                     own canonical subject, whatever exams assess it.
 *   ASSESSMENT APPLICABILITY          this module. A statement ABOUT a certified concept and an assessment scope.
 *                                     It does not re-certify the concept, does not re-key it, does not copy it and
 *                                     does not move it to another subject.
 * Consequences the code relies on:
 *   - The canonical subject of a concept need NOT carry the same label as an exam's local subject. A concept owned
 *     by `Mathematics` may be assessed under PAA, IB, Cambridge, PISA or ICFES where applicability exists.
 *   - Applicability is NEVER inferred: not from a behaviour fit, not from another exam, and not from two subjects
 *     having similar names. Where the repository records nothing for a concept and a scope, the basis is NONE.
 *
 * A RECORD states the basis and the evidence it rests on -- the repository's actual mapping, with the review
 * state of that mapping:
 *   OFFICIAL_EXAM_STRUCTURE    an official node of the exam's certified structure carries the concept
 *   REVIEWED_CATALOGUE_LINK    a reviewed objective -> concept link of the exam's catalogue names the concept.
 *                              Evidence of APPLICABILITY only; it is never certification of the concept.
 *   NONE                       nothing is recorded
 * A THRESHOLD POLICY (StudyUs policy, versioned) says which bases, at which review state, ESTABLISH applicability.
 * Evidence-bearing content requires it to be established; the engine refuses by name otherwise.
 *
 * SCOPE. A record is for one assessment system and, optionally, one subject label and one component of it. A
 * record of a component does not speak for another component of the same system.
 *
 * REVIEWER QUALIFICATION is a different thing again and is not decided here: it follows the item's actual PRIMARY
 * concept subject x exam family, and stays a human grant.
 */
import { z } from 'zod';

export const ASSESSMENT_APPLICABILITY_CONTRACT_VERSION = 1 as const;

const ID = z.string().trim().min(1).max(200);
const SHORT = z.string().trim().min(3).max(400);
const STATEMENT = z.string().trim().min(10).max(700);

export const APPLICABILITY_BASES = ['OFFICIAL_EXAM_STRUCTURE', 'REVIEWED_CATALOGUE_LINK', 'NONE'] as const;
export type ApplicabilityBasis = (typeof APPLICABILITY_BASES)[number];
/** What the evidence is: an official node of a certified exam structure that carries the concept, or a catalogue link. */
export const APPLICABILITY_EVIDENCE_KINDS = ['OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT', 'OBJECTIVE_CONCEPT_LINK'] as const;
/**
 * The review state of the EVIDENCE (of the mapping, not of the concept), weakest first.
 *   UNREVIEWED          nobody is recorded as having reviewed the mapping
 *   DECLARED_REVIEWED   the module that holds the mapping declares it reviewed; no review record names a reviewer
 *   CERTIFIED           the mapping is part of a certified artefact that a test compares with its source
 */
export const EVIDENCE_REVIEW_STATES = ['UNREVIEWED', 'DECLARED_REVIEWED', 'CERTIFIED'] as const;
export type EvidenceReviewState = (typeof EVIDENCE_REVIEW_STATES)[number];
export const APPLICABILITY_STATUSES = ['ESTABLISHED', 'NOT_ESTABLISHED'] as const;
export type ApplicabilityStatus = (typeof APPLICABILITY_STATUSES)[number];

export const ApplicabilityEvidenceSchema = z.strictObject({
  kind: z.enum(APPLICABILITY_EVIDENCE_KINDS),
  /** The repository's own identifier of the mapping: a structure-node code, or an objective code. */
  reference: ID,
  /** Where the repository records it. */
  recordedIn: SHORT,
  /** The official source the node cites, when it cites one (e.g. a guide page). null for a catalogue link. */
  sourceReference: z.string().trim().max(200).nullable(),
  reviewState: z.enum(EVIDENCE_REVIEW_STATES),
});
export type ApplicabilityEvidence = z.infer<typeof ApplicabilityEvidenceSchema>;

export const ApplicabilityScopeSchema = z.strictObject({
  /** The assessment-system profile id. */
  systemProfileId: ID,
  /** The exam's LOCAL subject label, when the evidence is for one. Never compared with the concept's canonical subject. */
  subject: ID.nullable(),
  /** The component-profile id, when the evidence is for one component. null = the system as a whole. */
  componentId: ID.nullable(),
});

export const AssessmentApplicabilityRecordSchema = z
  .strictObject({
    v: z.literal(ASSESSMENT_APPLICABILITY_CONTRACT_VERSION),
    /** The certified concept, by reference: stable id and its OWN canonical subject. Nothing of the concept is restated. */
    concept: z.strictObject({ stableId: ID, canonicalSubject: ID }),
    scope: ApplicabilityScopeSchema,
    basis: z.enum(APPLICABILITY_BASES),
    evidence: z.array(ApplicabilityEvidenceSchema),
  })
  .superRefine((r, ctx) => {
    const kinds = new Set(r.evidence.map((e) => e.kind));
    if (r.basis === 'NONE' && r.evidence.length > 0) ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'NO_BASIS_HAS_NO_EVIDENCE' });
    // a basis is what its evidence is: it can never be claimed above it
    if (r.basis === 'OFFICIAL_EXAM_STRUCTURE' && !kinds.has('OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT')) ctx.addIssue({ code: 'custom', path: ['basis'], message: 'OFFICIAL_BASIS_NEEDS_AN_OFFICIAL_STRUCTURE_NODE' });
    if (r.basis === 'REVIEWED_CATALOGUE_LINK' && (r.evidence.length === 0 || kinds.has('OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT'))) ctx.addIssue({ code: 'custom', path: ['basis'], message: r.evidence.length === 0 ? 'CATALOGUE_BASIS_NEEDS_A_LINK' : 'OFFICIAL_EVIDENCE_IS_NOT_A_CATALOGUE_BASIS' });
    if (r.evidence.some((e) => e.kind === 'OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT' && !e.sourceReference)) ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'OFFICIAL_NODE_NEEDS_ITS_SOURCE_REFERENCE' });
    if (new Set(r.evidence.map((e) => `${e.kind}|${e.reference}`)).size !== r.evidence.length) ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'EVIDENCE_LISTED_TWICE' });
  });
export type AssessmentApplicabilityRecord = z.infer<typeof AssessmentApplicabilityRecordSchema>;

/** Which bases, at which review state of their evidence, establish applicability. StudyUs policy; versioned. */
export const ApplicabilityThresholdPolicySchema = z.strictObject({
  policyId: ID,
  version: ID,
  authority: z.literal('STUDYUS_POLICY'),
  /** For each basis that can establish applicability: the least review state its evidence must have. A basis that is not listed never does. */
  satisfiedBy: z.array(z.strictObject({ basis: z.enum(['OFFICIAL_EXAM_STRUCTURE', 'REVIEWED_CATALOGUE_LINK']), minimumReviewState: z.enum(EVIDENCE_REVIEW_STATES) })).min(1),
  note: STATEMENT,
});
export type ApplicabilityThresholdPolicy = z.infer<typeof ApplicabilityThresholdPolicySchema>;

/**
 * The threshold EA-1 is decided under (2026-10-11): an official structure node establishes applicability when its
 * mapping is certified; a catalogue link establishes it when the link is at least declared reviewed. NONE never does.
 */
export const EA1_APPLICABILITY_THRESHOLD: ApplicabilityThresholdPolicy = {
  policyId: 'studyus.assessment-applicability-threshold', version: '1', authority: 'STUDYUS_POLICY',
  satisfiedBy: [{ basis: 'OFFICIAL_EXAM_STRUCTURE', minimumReviewState: 'CERTIFIED' }, { basis: 'REVIEWED_CATALOGUE_LINK', minimumReviewState: 'DECLARED_REVIEWED' }],
  note: 'A reviewed catalogue link counts as evidence of applicability; it is never certification of the concept. Whether a link that is only DECLARED reviewed stays enough once review records are persisted is an open question of the persistence design.',
};

const rank = (s: EvidenceReviewState): number => EVIDENCE_REVIEW_STATES.indexOf(s);

/** Does the record establish applicability under the policy? Only through evidence of the record's own basis at the required review state. */
export function applicabilityStatusOf(record: Pick<AssessmentApplicabilityRecord, 'basis' | 'evidence'>, policy: ApplicabilityThresholdPolicy): ApplicabilityStatus {
  const rule = policy.satisfiedBy.find((s) => s.basis === record.basis);
  if (!rule) return 'NOT_ESTABLISHED';
  const kind = record.basis === 'OFFICIAL_EXAM_STRUCTURE' ? 'OFFICIAL_STRUCTURE_NODE_WITH_CERTIFIED_CONCEPT' : 'OBJECTIVE_CONCEPT_LINK';
  return record.evidence.some((e) => e.kind === kind && rank(e.reviewState) >= rank(rule.minimumReviewState)) ? 'ESTABLISHED' : 'NOT_ESTABLISHED';
}

export interface ResolvedApplicability {
  status: ApplicabilityStatus;
  basis: ApplicabilityBasis;
  scope: { systemProfileId: string; subject: string | null; componentId: string | null };
  evidence: ApplicabilityEvidence[];
  thresholdPolicy: { policyId: string; version: string };
}

const basisRank: Record<ApplicabilityBasis, number> = { OFFICIAL_EXAM_STRUCTURE: 2, REVIEWED_CATALOGUE_LINK: 1, NONE: 0 };

/**
 * The applicability of ONE concept for ONE target, read from a register of records.
 *   - The concept is matched by stable id AND canonical subject: the same id under another subject is another concept.
 *   - A target COMPONENT is answered by a record of that component or of the system as a whole -- never by a record
 *     of another component.
 *   - A target SYSTEM with no component is answered by any record of the system: the concept is assessed by it somewhere.
 *   - No record => basis NONE, NOT_ESTABLISHED. Nothing is inferred.
 * Among several records the one that establishes applicability wins, then the stronger basis, then the narrower scope.
 */
export function resolveApplicability(register: readonly AssessmentApplicabilityRecord[], concept: { stableId: string; canonicalSubject: string }, target: { systemProfileId: string; componentId: string | null }, policy: ApplicabilityThresholdPolicy = EA1_APPLICABILITY_THRESHOLD): ResolvedApplicability {
  const thresholdPolicy = { policyId: policy.policyId, version: policy.version };
  const matching = register.filter((r) => r.concept.stableId === concept.stableId && r.concept.canonicalSubject === concept.canonicalSubject && r.scope.systemProfileId === target.systemProfileId && (target.componentId === null || r.scope.componentId === null || r.scope.componentId === target.componentId));
  if (matching.length === 0) return { status: 'NOT_ESTABLISHED', basis: 'NONE', scope: { systemProfileId: target.systemProfileId, subject: null, componentId: target.componentId }, evidence: [], thresholdPolicy };
  const scored = matching.map((r) => ({ r, established: applicabilityStatusOf(r, policy) === 'ESTABLISHED' }));
  scored.sort((a, b) => Number(b.established) - Number(a.established) || basisRank[b.r.basis] - basisRank[a.r.basis] || Number(b.r.scope.componentId !== null) - Number(a.r.scope.componentId !== null) || (JSON.stringify(a.r.scope) < JSON.stringify(b.r.scope) ? -1 : 1));
  const best = scored[0];
  return { status: best.established ? 'ESTABLISHED' : 'NOT_ESTABLISHED', basis: best.r.basis, scope: { ...best.r.scope }, evidence: best.r.evidence.map((e) => ({ ...e })), thresholdPolicy };
}

export function applicabilityRegisterIssues(register: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  register.forEach((r, i) => {
    const parsed = AssessmentApplicabilityRecordSchema.safeParse(r);
    if (!parsed.success) { out.push(...parsed.error.issues.map((x) => `${i}: ${x.path.join('.')}: ${x.message}`)); return; }
    const key = `${parsed.data.concept.stableId}|${parsed.data.concept.canonicalSubject}|${parsed.data.scope.systemProfileId}|${parsed.data.scope.componentId ?? ''}`;
    if (seen.has(key)) out.push(`${i}: RECORD_LISTED_TWICE: ${key}`);
    seen.add(key);
  });
  return out;
}
