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
 */
import { ESTABLISHED_REUSE_RIGHTS, type ReuseRights } from '@/lib/assessment-foundation/question-coverage';
import type { OriginalityOutcome } from './originality-gate';

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
}

export type RightsGateBlocker =
  | 'AUTHORSHIP_TERMS_MISSING'
  | 'SOURCE_ADAPTED_OR_REPRODUCED_WITHOUT_LICENCE'
  | 'ORIGINALITY_NOT_CHECKED'
  | 'ORIGINALITY_NOT_ACCEPTED'
  | 'LICENCE_REFERENCE_MISSING'
  | 'RIGHTS_HOLDER_MISSING'
  | 'PERMITTED_USE_MISSING'
  | 'DEPENDENCY_RIGHTS_NOT_ESTABLISHED';

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
    if (!e.authorshipTermsReference?.trim()) blockers.push('AUTHORSHIP_TERMS_MISSING');
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
