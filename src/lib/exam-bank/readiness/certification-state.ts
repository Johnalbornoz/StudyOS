/**
 * Governed CERTIFICATION and DELIVERABILITY of one Exam Bank supply row (pure, no IO). One vocabulary for every exam
 * system: nothing here names one.
 *
 *   certified  !=  runtime deliverable.
 *
 * A row is RUNTIME_DELIVERABLE for a blueprint position only when ALL hold:
 *   certification   it carries a certification that is valid in the delivery scope;
 *   lineage         its lineage is complete (system -> version -> blueprint -> core -> adapter -> renderer -> instance);
 *   rights          its rights are cleared for Student delivery;
 *   capability      the runtime can RENDER and SCORE its response format, and present its stimulus;
 *   blueprint       it is mapped to a bucket of the blueprint being assembled, and is not retired.
 * A certified row that fails any non-certification condition is CERTIFIED_NOT_DELIVERABLE, with the reasons.
 *
 * Authoritative meaning of the certification states (docs/audits/exam-bank/EXAM_BANK_READINESS_ENGINE.md):
 *   HUMAN_CERTIFIED            a named human reviewer certified exactly this content under a recorded policy.
 *   AUTOMATED_CERTIFIED_PILOT  a versioned automated policy certified exactly this content, rule by rule; valid ONLY
 *                              in the PILOT_PREVIEW delivery scope (e.g. PAA_PILOT_CERT_POLICY_V1).
 *   INHERITED_DETERMINISTIC    a deterministic derivation (core -> adapter -> renderer) of certified content; it inherits
 *                              the parent certification only while every digest in the chain still matches. In SQL this
 *                              is the certification MODE `INHERITED_DETERMINISTIC_CERTIFICATION` over a certified state.
 *   REVIEW_REQUIRED            produced, not certified. Never deliverable.
 *   REJECTED                   failed certification. Never deliverable; never silently retried into the bank.
 *   DRAFT / VALIDATING         not yet decided. QUARANTINED / RETIRED: withdrawn. None is deliverable.
 *   LEGACY_UNGOVERNED          a bank row with no governed certification record at all (lineage class LEGACY: older
 *                              reviewed rows, AI-era rows, fixtures). Not certified, whatever the runtime does with it.
 * An AUTOMATED_CERTIFIED_PILOT row reaches PRODUCTION only through an explicit production release
 * (`assessment_production_releases`, mirrored here by `productionReleased`).
 *   CERTIFIED_NOT_DELIVERABLE  is NOT a stored certification state: it is the DERIVED verdict for a certified row that
 *                              the runtime may not deliver (capability, rights, lineage, blueprint or scope).
 */

export type CertificationState =
  | 'HUMAN_CERTIFIED' | 'AUTOMATED_CERTIFIED_PILOT' | 'INHERITED_DETERMINISTIC' | 'REVIEW_REQUIRED' | 'REJECTED'
  | 'DRAFT' | 'VALIDATING' | 'QUARANTINED' | 'RETIRED' | 'LEGACY_UNGOVERNED';
export type DeliveryScope = 'PILOT_PREVIEW' | 'PRODUCTION';
export type RightsStatus = 'CLEARED' | 'RESTRICTED' | 'UNKNOWN';

/** Response formats are opaque strings: the runtime declares which ones it can render and score. */
export type ResponseFormat = string;

export interface RuntimeCapabilities {
  /** Formats the Student UI can render and collect an answer for. */
  renderableFormats: readonly ResponseFormat[];
  /** Formats Exam Core can score deterministically, with provenance, for this mode. */
  scorableFormats: readonly ResponseFormat[];
  /** Stimulus kinds the runtime can present (passage, table, figure, audio...). */
  stimulusKinds: readonly string[];
}

export interface SupplyRow {
  itemId: string;
  /** Stable content identity of exactly what would be delivered (e.g. bank version digest). */
  contentDigest: string;
  /** The item's TEMPLATE (its wording with every number masked): a form never carries two items of one template. Absent = every item is its own template. */
  templateKey?: string | null;
  bucketIds: readonly string[];
  certification: CertificationState;
  /** INHERITED_DETERMINISTIC only: whether every parent digest still matches. */
  inheritanceIntact?: boolean;
  /** AUTOMATED_CERTIFIED_PILOT only: an explicit production release exists for exactly this content. */
  productionReleased?: boolean;
  lineageComplete: boolean;
  rights: RightsStatus;
  responseFormat: ResponseFormat;
  stimulusKind: string | null;
  /** Rows sharing a stimulus are presented together (a stimulus set). null = self-contained. */
  stimulusId: string | null;
  retired: boolean;
  /** The Question Bank lifecycle / usage axis (a usage gate, not a certification). Absent = deliverable. */
  lifecycleDeliverable?: boolean;
  difficulty: import('./difficulty').DifficultyProfile | null;
}

export type CertificationVerdict = 'CERTIFIED' | 'NOT_CERTIFIED' | 'CERTIFIED_OUT_OF_SCOPE';
export type DeliverabilityReason =
  | 'NOT_CERTIFIED' | 'REJECTED' | 'CERTIFICATION_OUT_OF_SCOPE' | 'INHERITANCE_BROKEN' | 'LINEAGE_INCOMPLETE' | 'RIGHTS_NOT_CLEARED'
  | 'FORMAT_NOT_RENDERABLE' | 'FORMAT_NOT_SCORABLE' | 'STIMULUS_NOT_SUPPORTED' | 'RETIRED' | 'LIFECYCLE_NOT_DELIVERABLE' | 'NOT_IN_BLUEPRINT';
export type Deliverability = 'RUNTIME_DELIVERABLE' | 'CERTIFIED_NOT_DELIVERABLE' | 'NOT_CERTIFIED';

/** Is the row certified, and is its certification valid in this delivery scope? */
export function certificationVerdict(row: Pick<SupplyRow, 'certification' | 'inheritanceIntact' | 'productionReleased'>, scope: DeliveryScope): CertificationVerdict {
  switch (row.certification) {
    case 'HUMAN_CERTIFIED': return 'CERTIFIED';
    case 'AUTOMATED_CERTIFIED_PILOT': return scope === 'PILOT_PREVIEW' || row.productionReleased === true ? 'CERTIFIED' : 'CERTIFIED_OUT_OF_SCOPE';
    case 'INHERITED_DETERMINISTIC': return row.inheritanceIntact === true ? 'CERTIFIED' : 'NOT_CERTIFIED';
    default: return 'NOT_CERTIFIED';
  }
}

/**
 * The deliverability of one row for one blueprint (by bucket ids) in one scope, with every reason. Fail closed:
 * anything unknown is a reason, never a pass.
 */
export function deliverabilityOf(row: SupplyRow, ctx: { scope: DeliveryScope; capabilities: RuntimeCapabilities; blueprintBucketIds: ReadonlySet<string> }): { verdict: Deliverability; reasons: DeliverabilityReason[] } {
  const reasons: DeliverabilityReason[] = [];
  const cert = certificationVerdict(row, ctx.scope);
  if (row.certification === 'REJECTED') reasons.push('REJECTED');
  else if (row.certification === 'INHERITED_DETERMINISTIC' && cert === 'NOT_CERTIFIED') reasons.push('INHERITANCE_BROKEN');
  else if (cert === 'NOT_CERTIFIED') reasons.push('NOT_CERTIFIED');
  else if (cert === 'CERTIFIED_OUT_OF_SCOPE') reasons.push('CERTIFICATION_OUT_OF_SCOPE');
  if (!row.lineageComplete) reasons.push('LINEAGE_INCOMPLETE');
  if (row.rights !== 'CLEARED') reasons.push('RIGHTS_NOT_CLEARED');
  if (!ctx.capabilities.renderableFormats.includes(row.responseFormat)) reasons.push('FORMAT_NOT_RENDERABLE');
  if (!ctx.capabilities.scorableFormats.includes(row.responseFormat)) reasons.push('FORMAT_NOT_SCORABLE');
  if (row.stimulusKind !== null && !ctx.capabilities.stimulusKinds.includes(row.stimulusKind)) reasons.push('STIMULUS_NOT_SUPPORTED');
  if (row.retired) reasons.push('RETIRED');
  if (row.lifecycleDeliverable === false) reasons.push('LIFECYCLE_NOT_DELIVERABLE');
  if (!row.bucketIds.some((b) => ctx.blueprintBucketIds.has(b))) reasons.push('NOT_IN_BLUEPRINT');
  if (reasons.length === 0) return { verdict: 'RUNTIME_DELIVERABLE', reasons };
  // A pilot certification outside the pilot scope is still a certification: certified, not deliverable HERE.
  return { verdict: cert === 'NOT_CERTIFIED' ? 'NOT_CERTIFIED' : 'CERTIFIED_NOT_DELIVERABLE', reasons };
}
