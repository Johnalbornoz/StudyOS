/**
 * QB-R2A -- the authoring-side rights gate (pure, no IO).
 *
 * Delivery needs an ESTABLISHED reuse right on the item version, its stimulus and every asset:
 * STUDYUS_OWNED, LICENSED_FOR_USE or OFFICIALLY_AUTHORIZED. That a source can be read (PUBLICLY_ACCESSIBLE)
 * is not a right to reuse it. This gate decides, from evidence, which right may be RECORDED -- it records
 * nothing. The rights record is written at ingestion, by a person, on the ingested content.
 *
 * Evidence for STUDYUS_OWNED on StudyUs's own content (written or generated):
 *   1. provenance is STUDYUS_AUTHORED or STUDYUS_GENERATED;
 *   2. authorship terms: for a person, the agreement under which their work belongs to StudyUs; for a model,
 *      the provider terms under which the output may be owned and used commercially -- each a citable reference;
 *   3. no source was adapted or reproduced (references were consulted only);
 *   4. the originality gate did not find it textually similar to anything (accepted, by the gate or a person);
 *   5. the same holds for the stimulus and for every asset the item uses.
 *
 * QB-R2C -- MODEL OUTPUT. For STUDYUS_GENERATED content a bare reference string is no longer evidence. The gate
 * needs a `ModelOutputRightsEvidence`: which provider and model, under which agreement or terms, in which
 * organisational account or licence context, which version or date of those terms, whether commercial use is
 * permitted, which restrictions apply, and WHO verified all of it and when. Every field must be present and the
 * record must be marked verified by a person. Nothing is defaulted or filled in by code, and this module decides
 * no legal question: it only refuses to call a right established while a person has not stated and verified
 * the facts. Until then the verdict stays `supportedReuseRights: 'UNKNOWN'` with a named blocker.
 */
import { ESTABLISHED_REUSE_RIGHTS, type ReuseRights } from '@/lib/assessment-foundation/question-coverage';
import type { OriginalityOutcome } from './originality-gate';

/**
 * What a person must have established about a model's output before StudyUs can record it as its own.
 * Every field is nullable ON PURPOSE: an absent fact is stated as absent and blocks, it is never assumed.
 */
export interface ModelOutputRightsEvidence {
  provider: string | null;
  model: string | null;
  /** The agreement or terms that govern the output (a citable reference: document, clause, URL as recorded by the verifier). */
  termsReference: string | null;
  /** The organisational account or licence under which the output was produced (e.g. which contract, which workspace). */
  accountContext: string | null;
  /** The version or the date of those terms that was read. */
  termsVersionOrDate: string | null;
  commercialUse: { permitted: boolean | null; note: string | null };
  /** Restrictions the terms place on the output. An empty list must be STATED (`[]`), not left null. */
  restrictions: string[] | null;
  verification: { verifiedByPerson: boolean; verifiedBy: string | null; verifiedAt: string | null };
}

export type ModelOutputRightsBlocker = 'MODEL_OUTPUT_RIGHTS_EVIDENCE_MISSING' | 'MODEL_OUTPUT_RIGHTS_EVIDENCE_INCOMPLETE' | 'MODEL_OUTPUT_RIGHTS_NOT_VERIFIED_BY_A_PERSON' | 'MODEL_OUTPUT_COMMERCIAL_USE_NOT_PERMITTED';
export const MODEL_OUTPUT_RIGHTS_FIELDS = ['provider', 'model', 'termsReference', 'accountContext', 'termsVersionOrDate', 'commercialUse.permitted', 'commercialUse.note', 'restrictions', 'verification.verifiedBy', 'verification.verifiedAt'] as const;

/** Which facts are missing, and whether a person verified them. Empty blockers = the evidence is complete and verified. */
export function evaluateModelOutputRights(e: ModelOutputRightsEvidence | null | undefined): { blockers: ModelOutputRightsBlocker[]; missingFields: string[] } {
  if (!e) return { blockers: ['MODEL_OUTPUT_RIGHTS_EVIDENCE_MISSING'], missingFields: [...MODEL_OUTPUT_RIGHTS_FIELDS] };
  const has = (v: string | null | undefined): boolean => typeof v === 'string' && v.trim().length > 0;
  const missing: string[] = [];
  if (!has(e.provider)) missing.push('provider');
  if (!has(e.model)) missing.push('model');
  if (!has(e.termsReference)) missing.push('termsReference');
  if (!has(e.accountContext)) missing.push('accountContext');
  if (!has(e.termsVersionOrDate)) missing.push('termsVersionOrDate');
  if (typeof e.commercialUse?.permitted !== 'boolean') missing.push('commercialUse.permitted');
  if (!has(e.commercialUse?.note)) missing.push('commercialUse.note');
  if (!Array.isArray(e.restrictions) || e.restrictions.some((r) => !has(r))) missing.push('restrictions');
  if (!has(e.verification?.verifiedBy)) missing.push('verification.verifiedBy');
  if (!has(e.verification?.verifiedAt) || Number.isNaN(Date.parse(e.verification.verifiedAt!))) missing.push('verification.verifiedAt');
  const blockers: ModelOutputRightsBlocker[] = [];
  if (missing.length > 0) blockers.push('MODEL_OUTPUT_RIGHTS_EVIDENCE_INCOMPLETE');
  if (e.verification?.verifiedByPerson !== true || !has(e.verification?.verifiedBy)) blockers.push('MODEL_OUTPUT_RIGHTS_NOT_VERIFIED_BY_A_PERSON');
  if (e.commercialUse?.permitted === false) blockers.push('MODEL_OUTPUT_COMMERCIAL_USE_NOT_PERMITTED');
  return { blockers, missingFields: missing };
}

export interface RightsEvidence {
  provenance: 'STUDYUS_AUTHORED' | 'STUDYUS_GENERATED' | 'LICENSED' | 'OFFICIAL';
  /** Reference to the author agreement (person) or the model provider's terms (model). */
  authorshipTermsReference: string | null;
  /** How each cited source was used. */
  sourceUsages: Array<{ sourceKey: string; sourceAccess: string; usage: 'REFERENCE_ONLY' | 'ADAPTED' | 'REPRODUCED' }>;
  originality: { outcome: OriginalityOutcome; acceptedByHuman: boolean } | null;
  /** Licence or authorisation document, for third-party content. */
  licenceReference: string | null;
  rightsHolder: string | null;
  permittedUse: string | null;
  /** Rights already established for what the item depends on. */
  dependencies: Array<{ kind: 'STIMULUS_VERSION' | 'ASSET'; key: string; reuseRights: ReuseRights | null }>;
  /** STUDYUS_GENERATED only: the verified facts about the model's output. Absent or null = not established. */
  modelOutputRights?: ModelOutputRightsEvidence | null;
}

export type RightsGateBlocker =
  | 'AUTHORSHIP_TERMS_MISSING'
  | 'SOURCE_ADAPTED_OR_REPRODUCED_WITHOUT_LICENCE'
  | 'ORIGINALITY_NOT_CHECKED'
  | 'ORIGINALITY_NOT_ACCEPTED'
  | 'LICENCE_REFERENCE_MISSING'
  | 'RIGHTS_HOLDER_MISSING'
  | 'PERMITTED_USE_MISSING'
  | 'DEPENDENCY_RIGHTS_NOT_ESTABLISHED'
  | ModelOutputRightsBlocker;

export interface RightsGateVerdict {
  /** The reuse right the evidence supports. UNKNOWN when it supports none. */
  supportedReuseRights: ReuseRights;
  deliverable: boolean;
  blockers: RightsGateBlocker[];
  /** What a person would record at ingestion. null when nothing may be recorded as established. */
  proposedRecord: { reuseRights: ReuseRights; sourceAccess: string; rightsHolder: string; permittedUse: string; licenceReference: string | null } | null;
}

export const STUDYUS_RIGHTS_HOLDER = 'StudyUs' as const;
export const STUDYUS_PERMITTED_USE = 'Delivery to StudyUs learners in practice, diagnostic, verification and mock assessments' as const;

export function evaluateRightsGate(e: RightsEvidence): RightsGateVerdict {
  const blockers: RightsGateBlocker[] = [];
  const own = e.provenance === 'STUDYUS_AUTHORED' || e.provenance === 'STUDYUS_GENERATED';
  const copied = e.sourceUsages.some((s) => s.usage !== 'REFERENCE_ONLY');
  if (!e.originality) blockers.push('ORIGINALITY_NOT_CHECKED');
  else if (e.originality.outcome === 'REJECT_TEXTUAL_SIMILARITY' || (e.originality.outcome === 'REVIEW_STRUCTURAL_SIMILARITY' && !e.originality.acceptedByHuman)) blockers.push('ORIGINALITY_NOT_ACCEPTED');
  if (e.dependencies.some((d) => d.reuseRights === null || !ESTABLISHED_REUSE_RIGHTS.has(d.reuseRights))) blockers.push('DEPENDENCY_RIGHTS_NOT_ESTABLISHED');

  let target: ReuseRights;
  if (own) {
    target = 'STUDYUS_OWNED';
    // A person's work: the agreement under which it belongs to StudyUs. A model's output: the structured, person-verified
    // evidence -- a reference string alone establishes nothing about a model's output.
    if (e.provenance === 'STUDYUS_GENERATED') blockers.push(...evaluateModelOutputRights(e.modelOutputRights).blockers);
    else if (!e.authorshipTermsReference?.trim()) blockers.push('AUTHORSHIP_TERMS_MISSING');
    // StudyUs cannot own what it adapted or reproduced from someone else: that is licensed content, with a licence.
    if (copied) blockers.push('SOURCE_ADAPTED_OR_REPRODUCED_WITHOUT_LICENCE');
  } else {
    target = e.provenance === 'OFFICIAL' ? 'OFFICIALLY_AUTHORIZED' : 'LICENSED_FOR_USE';
    if (!e.licenceReference?.trim()) blockers.push('LICENCE_REFERENCE_MISSING');
    if (!e.rightsHolder?.trim()) blockers.push('RIGHTS_HOLDER_MISSING');
    if (!e.permittedUse?.trim()) blockers.push('PERMITTED_USE_MISSING');
  }
  const unique = [...new Set(blockers)];
  if (unique.length > 0) return { supportedReuseRights: 'UNKNOWN', deliverable: false, blockers: unique, proposedRecord: null };
  const sourceAccess = own ? 'NOT_APPLICABLE' : e.sourceUsages[0]?.sourceAccess ?? 'LICENSED_SOURCE';
  return {
    supportedReuseRights: target, deliverable: true, blockers: [],
    proposedRecord: { reuseRights: target, sourceAccess, rightsHolder: own ? STUDYUS_RIGHTS_HOLDER : e.rightsHolder!.trim(), permittedUse: own ? STUDYUS_PERMITTED_USE : e.permittedUse!.trim(), licenceReference: own ? null : e.licenceReference!.trim() },
  };
}
