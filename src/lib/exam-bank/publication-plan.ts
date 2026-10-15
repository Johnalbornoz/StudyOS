/**
 * TRACK B -- Exam Bank publication plan (pure, no IO).
 *
 * The controlled boundary between the QF V5.2 certification artefacts and the runtime Exam Bank starts here:
 * everything that will be written is DERIVED in this module from
 *   - the certified library (construct cores, renderer envelopes, governed blueprints, applicability),
 *   - the registered assessment systems and adapters,
 *   - the certification policy in force (HUMAN50_POLICY_V1),
 *   - the recorded Step 4B human decisions, exactly as they were recorded.
 * Nothing is decided here that the artefacts do not already state. In particular:
 *   - a human decision is a row of the recorded file, copied field by field. This module creates none;
 *   - an object is HUMAN_CERTIFIED only where the governance of the library says so, which it does only where a
 *     recorded approval of exactly that content exists. Every other eligible object is AUTOMATED_CERTIFIED_PILOT
 *     and is attributed to the policy, never to a person;
 *   - an item instance is certified by INHERITED_DETERMINISTIC_CERTIFICATION: no person reviewed the instance.
 *
 * The plan is deterministic: the same artefacts give the same plan, byte for byte (`planHash`).
 */
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import type { AssessmentAdapter } from '@/lib/assessment-instance/assessment-adapter';
import type { CertificationRecord, ReviewerQualification } from '@/lib/assessment-instance/certification';
import type { ConstructCoreRecord } from '@/lib/assessment-instance/construct-core';
import type { CoreApplicabilityRecord } from '@/lib/assessment-instance/core-applicability';
import { LIBRARY, LIBRARY_APPLICABILITY, LIBRARY_BLUEPRINTS, LIBRARY_EXTENSION_BATCHES, libraryApplicability, PUBLICATION_APPLICABILITY, PUBLICATION_APPLICABILITY_2026_10_14, PUBLICATION_APPLICABILITY_2026_10_15_IB, PUBLICATION_APPLICABILITY_2026_10_15_ALL, PUBLICATION_BLUEPRINTS, PUBLICATION_BLUEPRINTS_2026_10_15_ALL, PUBLICATION_BLUEPRINTS_2026_10_14, PUBLICATION_BLUEPRINTS_2026_10_15_IB, type LibraryBlueprint, type LibraryEntry } from '@/lib/assessment-instance/library/catalogue';
import { pilotApplicabilityHash } from '@/lib/assessment-instance/pilot/step4b-pilot-slice';
import { STUDYUS_ASSESSMENT_REGISTRY, STUDYUS_ASSESSMENT_REGISTRY_2026_10_15, V52_ASSESSMENT_REGISTRY } from '@/lib/assessment-instance/registered-systems';
import type { AssessmentSystemRegistry } from '@/lib/assessment-instance/assessment-system-registry';
import { envelopeHashOf, instanceContentHashOf, type RendererEnvelope } from '@/lib/assessment-instance/renderer-envelope';
import {
  capacitySummary, certifyCell, eligibilityRefusals, envelopeCapacity, EXAM_BANK_ITEM, governanceEligible, governLibrary, HUMAN50_POLICY_HASH, HUMAN50_POLICY_V1, HUMAN50_POLICY_VERSION, libraryCells, liveGovernanceOf,
  materialize, policyIssues, type CellResult, type CertifiedInstance, type EligibilityScope, type GovernanceDecision, type LibraryGovernance, type LiveGovernance, type MaterializedItem,
} from '@/lib/assessment-instance/v52';

/** The batch the certified supply was produced as (QF V5.2 run). Part of every seed, so part of every identity. */
export const PUBLICATION_BATCH_ID = 'qf52-batch-1';
export const PUBLICATION_PER_CELL = 10;
/** Who an automated decision is attributed to: the policy. Never a person. */
export const AUTOMATED_DECIDER = `policy:${HUMAN50_POLICY_VERSION}`;
/** Where a certification comes from. Every persisted decision is exactly one of these. */
export const CERTIFICATION_PROVENANCES = ['HUMAN', 'AUTOMATED', 'INHERITED_DETERMINISTIC'] as const;
export type CertificationProvenance = (typeof CERTIFICATION_PROVENANCES)[number];

/** The recorded Step 4B decisions file (docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json). */
export interface HumanDecisionsFile {
  kind: string;
  pilot: string;
  authority: { reviewerId: string; reviewerName: string; authority: string };
  qualification: ReviewerQualification;
  records: { decisionId: string; packetSection: string; record: CertificationRecord }[];
}

export interface PlannedQualification { reviewerId: string; authority: string; canonicalSubject: string; systemId: string; grantedBy: string; grantedAt: string }
export interface PlannedHumanDecision {
  decisionId: string; reviewerId: string; authority: string; canonicalSubject: string; systemId: string; objectType: string; objectId: string; objectVersion: string;
  decision: string; decidedAt: string; evidenceHash: string; notes: string | null;
}
export interface PlannedObjectCertification {
  objectType: 'CONSTRUCT_CORE' | 'ASSESSMENT_ADAPTER' | 'RENDERER_ENVELOPE' | 'BLUEPRINT_CLASSIFICATION';
  objectId: string; objectVersion: string; contentHash: string;
  state: 'AUTOMATED_CERTIFIED_PILOT' | 'HUMAN_CERTIFIED';
  provenance: Extract<CertificationProvenance, 'HUMAN' | 'AUTOMATED'>;
  /** HUMAN: the recorded decision this state rests on. AUTOMATED: null. */
  humanDecisionId: string | null;
  decidedBy: string;
  evidence: { code: string; passed: boolean; detail: string }[];
}
export interface PlannedCore { core: ConstructCoreRecord; certificationVersion: string; certifiedBy: string; certification: PlannedObjectCertification }
export interface PlannedAdapter { adapter: AssessmentAdapter; contentHash: string; definition: unknown; certification: PlannedObjectCertification }
export interface PlannedRenderer { rendererVersion: string; construct: string; strategy: string; envelope: RendererEnvelope; envelopeHash: string; certification: PlannedObjectCertification }
export interface PlannedBlueprint { blueprint: LibraryBlueprint; systemId: string; systemVersionId: string; contentHash: string; certification: PlannedObjectCertification; buckets: { bucketId: string; objectiveCode: string; primaryConceptStableIds: string[] }[] }
export interface PlannedApplicability { coreId: string; coreVersion: string; record: CoreApplicabilityRecord; contentHash: string; /** CONDITIONAL only: the recorded human decision that approved exactly this content. */ humanDecisionId: string | null }
export interface PlannedInstance {
  instance: CertifiedInstance;
  contentHash: string;
  certificationVersion: string;
  provenance: Extract<CertificationProvenance, 'INHERITED_DETERMINISTIC'>;
  rightsStatus: 'STUDYUS_OWNED';
  rightsBasis: string;
  materialized: MaterializedItem;
  /** Set when a plan and its extensions are merged for publication: the batch the instance comes from. */
  batchId?: string;
}
export interface BlockedRow { kind: string; identity: string; reason: string; detail: string }

export interface PublicationPlan {
  v: 1;
  /** Entries adopted after the V5.2 run: each a plan of its own (own batch, inputs and hash), published after this one. */
  extensions?: PublicationPlan[];
  batchId: string;
  scope: EligibilityScope;
  policy: { policyHash: string; policyId: string; version: string; mayGrantScopes: string[]; policy: unknown };
  inputsHash: string;
  systems: string[];
  qualifications: PlannedQualification[];
  humanDecisions: PlannedHumanDecision[];
  cores: PlannedCore[];
  adapters: PlannedAdapter[];
  renderers: PlannedRenderer[];
  blueprints: PlannedBlueprint[];
  applicability: PlannedApplicability[];
  cells: { cellId: string; attempted: number; certified: number }[];
  instances: PlannedInstance[];
  capacity: { rawVariantCapacity: number; distinctDeliverableVariants: number; recognitionClasses: number; certifiedDeliveryCapacity: number; effectiveRepeatabilityDepth: number };
  blocked: BlockedRow[];
  /** Pre-flight failures of the artefacts themselves. Any entry: nothing is written. */
  preflight: string[];
  planHash: string;
}

const RIGHTS_BASIS = 'Rendered deterministically from a StudyUs-authored construct core; no external or copied material.';
const decisionIdentity = (r: Pick<CertificationRecord, 'objectType' | 'objectId' | 'objectVersion' | 'scope'>): string => `${r.objectType}|${r.objectId}|${r.objectVersion}|${r.scope.systemId}|${r.scope.canonicalSubject}`;

/** The certification version a core carries in the database: the policy and how the core was certified under it. */
export const coreCertificationVersionOf = (state: PlannedObjectCertification['state']): string => `${HUMAN50_POLICY_VERSION}:${state}`;

/**
 * Extension batches already published, with the inputs they were certified from: a later classification, register
 * entry or re-governed adapter is not an input of theirs (their stored inputs hash stays theirs). Every later batch
 * is planned against the live publication state.
 */
const ARCHIVED_BATCH_INPUTS: Readonly<Record<string, { blueprints: readonly LibraryBlueprint[]; register: typeof LIBRARY_APPLICABILITY; registry: AssessmentSystemRegistry; coreRegister?: typeof LIBRARY_APPLICABILITY }>> = {
  // the first IB delivery (DEV, 2026-10-14): V5.2 classifications and register, the registry before the Cambridge rebinding
  'CF-IB-AAHL-01': { blueprints: LIBRARY_BLUEPRINTS, register: LIBRARY_APPLICABILITY, registry: V52_ASSESSMENT_REGISTRY },
  // published 2026-10-14 against the classifications and the register of that day; later classifications (IB extended,
  // trigonometry, 2026-10-15) and register records are not inputs of theirs
  'CF-IB-AAHL-01-A2': { blueprints: PUBLICATION_BLUEPRINTS_2026_10_14, register: PUBLICATION_APPLICABILITY_2026_10_14, registry: STUDYUS_ASSESSMENT_REGISTRY_2026_10_15, coreRegister: PUBLICATION_APPLICABILITY_2026_10_14 },
  'CIE-9709-P1-A1': { blueprints: PUBLICATION_BLUEPRINTS_2026_10_14, register: PUBLICATION_APPLICABILITY_2026_10_14, registry: STUDYUS_ASSESSMENT_REGISTRY_2026_10_15, coreRegister: PUBLICATION_APPLICABILITY_2026_10_14 },
  // published on DEV 2026-10-15 before the PISA and AICE classifications and register records existed
  'TB-IB-AAHL-EXT-A1': { blueprints: PUBLICATION_BLUEPRINTS_2026_10_15_IB, register: PUBLICATION_APPLICABILITY_2026_10_15_IB, registry: STUDYUS_ASSESSMENT_REGISTRY_2026_10_15, coreRegister: PUBLICATION_APPLICABILITY_2026_10_15_IB },
  // published on DEV 2026-10-15 before IB Paper 3 (its component, classification and register records)
  'TB-PISA-MATH-A1': { blueprints: PUBLICATION_BLUEPRINTS_2026_10_15_ALL, register: PUBLICATION_APPLICABILITY_2026_10_15_ALL, registry: STUDYUS_ASSESSMENT_REGISTRY_2026_10_15, coreRegister: PUBLICATION_APPLICABILITY_2026_10_15_ALL },
  'AICE-9709-P1-EQ-A1': { blueprints: PUBLICATION_BLUEPRINTS_2026_10_15_ALL, register: PUBLICATION_APPLICABILITY_2026_10_15_ALL, registry: STUDYUS_ASSESSMENT_REGISTRY_2026_10_15, coreRegister: PUBLICATION_APPLICABILITY_2026_10_15_ALL },
  'TB-SABER-MATH-A1': { blueprints: PUBLICATION_BLUEPRINTS_2026_10_15_ALL, register: PUBLICATION_APPLICABILITY_2026_10_15_ALL, registry: STUDYUS_ASSESSMENT_REGISTRY_2026_10_15, coreRegister: PUBLICATION_APPLICABILITY_2026_10_15_ALL },
  'TB-SABER-MATH-A2': { blueprints: PUBLICATION_BLUEPRINTS_2026_10_15_ALL, register: PUBLICATION_APPLICABILITY_2026_10_15_ALL, registry: STUDYUS_ASSESSMENT_REGISTRY_2026_10_15, coreRegister: PUBLICATION_APPLICABILITY_2026_10_15_ALL },
};

/**
 * Everything the loader will write, derived from the artefacts. `human` is the recorded decisions file, parsed.
 * A plan with a non-empty `preflight` must not be applied.
 */
export function buildPublicationPlan(human: HumanDecisionsFile, scope: EligibilityScope = 'PILOT_PREVIEW'): PublicationPlan {
  // The V5.2 plan is computed exactly as it always was (its hash and its counts are the ones its artefacts name);
  // entries adopted later are an additive extension with a batch, inputs and hash of their own.
  // It is governed against the registry as the V5.2 run certified against it (V52_ASSESSMENT_REGISTRY): adapters
  // re-governed later (Cambridge 9709 P1, 2026-10-14) are not inputs of this archived batch.
  const base = planOfLibrary(human, scope, LIBRARY, PUBLICATION_BATCH_ID, LIBRARY_BLUEPRINTS, LIBRARY_APPLICABILITY, V52_ASSESSMENT_REGISTRY);
  // the extension carries every classification (the V5.2 ones it places items in, and the pilot ones it adds) and the
  // register of the pilot-governed identities
  return LIBRARY_EXTENSION_BATCHES.length ? { ...base, extensions: LIBRARY_EXTENSION_BATCHES.map((b) => { const archived = ARCHIVED_BATCH_INPUTS[b.batchId]; return archived ? planOfLibrary(human, scope, b.entries, b.batchId, archived.blueprints, archived.register, archived.registry, archived.coreRegister) : planOfLibrary(human, scope, b.entries, b.batchId, PUBLICATION_BLUEPRINTS, PUBLICATION_APPLICABILITY); }) } : base;
}

function planOfLibrary(human: HumanDecisionsFile, scope: EligibilityScope, library: readonly LibraryEntry[], batchId: string, blueprintsIn: readonly LibraryBlueprint[], register: typeof LIBRARY_APPLICABILITY, registry: AssessmentSystemRegistry = STUDYUS_ASSESSMENT_REGISTRY, /** The register a core's applicability is read from: the live one, or the one an archived batch was published against. */ coreRegister: typeof LIBRARY_APPLICABILITY = PUBLICATION_APPLICABILITY): PublicationPlan {
  const preflight: string[] = [];
  const blocked: BlockedRow[] = [];
  // the registry the batch is governed against (live, or the V5.2 one for the archived batch)
  for (const issue of policyIssues(HUMAN50_POLICY_V1)) preflight.push(`POLICY_INVALID:${issue}`);
  if (sha256OfCanonicalJson(HUMAN50_POLICY_V1) !== HUMAN50_POLICY_HASH) preflight.push('POLICY_HASH_IS_NOT_THE_HASH_OF_THE_POLICY');
  if (!(HUMAN50_POLICY_V1.mayGrantScopes as readonly string[]).includes(scope)) preflight.push(`POLICY_DOES_NOT_GRANT_SCOPE:${scope}`);

  // ---- the recorded human decisions, copied: never created, never completed
  const records = human.records.map((r) => ({ decisionId: r.decisionId, record: r.record }));
  const qualifications: PlannedQualification[] = human.qualification.scopes.map((s) => ({ reviewerId: human.qualification.reviewerId, authority: human.qualification.authority, canonicalSubject: s.canonicalSubject, systemId: s.systemId, grantedBy: human.qualification.grantedBy, grantedAt: human.qualification.grantedAt }));
  const humanDecisions: PlannedHumanDecision[] = records.map(({ decisionId, record: r }) => ({
    decisionId, reviewerId: r.reviewerId, authority: r.authority, canonicalSubject: r.scope.canonicalSubject, systemId: r.scope.systemId, objectType: r.objectType, objectId: r.objectId, objectVersion: r.objectVersion,
    decision: r.decision, decidedAt: r.decidedAt, evidenceHash: r.evidenceHash, notes: r.notes ?? null,
  }));
  if (new Set(humanDecisions.map((d) => d.decisionId)).size !== humanDecisions.length) preflight.push('HUMAN_DECISION_IDS_NOT_UNIQUE');
  if (new Set(records.map((r) => decisionIdentity(r.record))).size !== records.length) preflight.push('HUMAN_DECISION_RECORDED_TWICE');
  for (const d of humanDecisions) {
    if (d.reviewerId !== human.qualification.reviewerId || d.authority !== human.qualification.authority) preflight.push(`HUMAN_DECISION_BY_ANOTHER_REVIEWER:${d.decisionId}`);
    if (!qualifications.some((q) => q.canonicalSubject === d.canonicalSubject && q.systemId === d.systemId)) preflight.push(`HUMAN_DECISION_OUTSIDE_THE_RECORDED_SCOPES:${d.decisionId}`);
    if (!/^[a-f0-9]{64}$/.test(d.evidenceHash)) preflight.push(`HUMAN_DECISION_WITHOUT_AN_EVIDENCE_HASH:${d.decisionId}`);
  }
  const humanRecords = { records: records.map((r) => r.record), qualifications: [human.qualification] };

  // ---- governance of every object, as the library decides it
  const governance: LibraryGovernance = governLibrary(humanRecords, library, blueprintsIn, register, registry);
  const live: LiveGovernance = liveGovernanceOf(governance);
  /** The recorded decision a HUMAN_CERTIFIED object rests on: an approval of exactly this object at exactly this content. */
  const humanDecisionFor = (d: Pick<GovernanceDecision, 'objectType' | 'objectId' | 'objectVersion' | 'contentHash'>): PlannedHumanDecision | null =>
    [...humanDecisions].sort((a, b) => a.decisionId.localeCompare(b.decisionId)).find((h) => h.objectType === d.objectType && h.objectId === d.objectId && h.objectVersion === d.objectVersion && h.evidenceHash === d.contentHash && h.decision === 'APPROVE') ?? null;
  const certificationOf = (d: GovernanceDecision): PlannedObjectCertification | null => {
    if (!governanceEligible(d)) return null;
    if (d.state === 'HUMAN_CERTIFIED') {
      const h = humanDecisionFor(d);
      // the library says a person approved this content: the recorded decision must be there, or nothing is published as human
      if (!h) { preflight.push(`HUMAN_CERTIFIED_WITHOUT_A_RECORDED_DECISION:${d.objectType}|${d.objectId}|${d.objectVersion}`); return null; }
      return { objectType: d.objectType, objectId: d.objectId, objectVersion: d.objectVersion, contentHash: d.contentHash, state: 'HUMAN_CERTIFIED', provenance: 'HUMAN', humanDecisionId: h.decisionId, decidedBy: h.reviewerId, evidence: d.checks };
    }
    return { objectType: d.objectType, objectId: d.objectId, objectVersion: d.objectVersion, contentHash: d.contentHash, state: 'AUTOMATED_CERTIFIED_PILOT', provenance: 'AUTOMATED', humanDecisionId: null, decidedBy: AUTOMATED_DECIDER, evidence: d.checks };
  };
  const decisionOf = (list: readonly GovernanceDecision[], objectId: string, objectVersion: string): GovernanceDecision | undefined => list.find((d) => d.objectId === objectId && d.objectVersion === objectVersion);
  const refuse = (kind: string, identity: string, d: GovernanceDecision | undefined): void => { blocked.push({ kind, identity, reason: d ? d.state : 'NOT_GOVERNED', detail: d ? d.failed.join(', ') : 'no governance decision' }); };

  const usedAdapterIds = [...new Set(blueprintsIn.map((b) => b.adapterId))].sort();
  const systems = [...new Set(usedAdapterIds.map((id) => registry.adapter(id)?.systemId).filter((x): x is string => !!x))].sort();

  const cores: PlannedCore[] = [];
  const renderers: PlannedRenderer[] = [];
  for (const e of library) {
    const coreIdentity = `${e.core.constructFamilyId}@${e.core.familyVersion}`;
    const cd = decisionOf(governance.cores, e.core.constructFamilyId, e.core.familyVersion);
    const cc = cd ? certificationOf(cd) : null;
    if (!cd || !cc) refuse('CONSTRUCT_CORE', coreIdentity, cd);
    else if (cd.contentHash !== e.core.contentHash) preflight.push(`CORE_HASH_IS_NOT_THE_GOVERNED_HASH:${coreIdentity}`);
    else cores.push({ core: e.core, certificationVersion: coreCertificationVersionOf(cc.state), certifiedBy: cc.decidedBy, certification: cc });
    const ed = decisionOf(governance.envelopes, e.envelope.rendererVersion, e.envelope.constructFamilyVersion);
    const ec = ed ? certificationOf(ed) : null;
    if (!ed || !ec) refuse('RENDERER_ENVELOPE', `${e.envelope.rendererVersion}@${e.envelope.constructFamilyVersion}`, ed);
    else if (ed.contentHash !== envelopeHashOf(e.envelope)) preflight.push(`ENVELOPE_HASH_IS_NOT_THE_GOVERNED_HASH:${e.envelope.rendererVersion}`);
    else renderers.push({ rendererVersion: e.envelope.rendererVersion, construct: e.envelope.construct, strategy: e.strategy.kind, envelope: e.envelope, envelopeHash: ed.contentHash, certification: ec });
  }

  const adapters: PlannedAdapter[] = [];
  for (const adapterId of usedAdapterIds) {
    const adapter = registry.adapter(adapterId);
    const pair = registry.profilePairOf(adapterId);
    const d = governance.adapters.find((x) => x.objectId === adapterId);
    const c = d ? certificationOf(d) : null;
    if (!adapter || !d || !c) { refuse('ASSESSMENT_ADAPTER', adapterId, d); continue; }
    if (!adapter.systemVersionId || registry.system(adapter.systemId)?.lifecycle !== 'ACTIVE' || registry.version(adapter.systemId, adapter.systemVersionId)?.lifecycle !== 'ACTIVE') { blocked.push({ kind: 'ASSESSMENT_ADAPTER', identity: adapterId, reason: 'SYSTEM_VERSION_NOT_ACTIVE', detail: `${adapter.systemId}/${adapter.systemVersionId ?? 'none'}` }); continue; }
    if (d.objectVersion !== adapter.version) { preflight.push(`ADAPTER_VERSION_IS_NOT_THE_GOVERNED_VERSION:${adapterId}`); continue; }
    adapters.push({ adapter, contentHash: d.contentHash, definition: pair ?? adapter, certification: c });
  }

  const blueprints: PlannedBlueprint[] = [];
  for (const b of blueprintsIn) {
    const adapter = registry.adapter(b.adapterId);
    const d = decisionOf(governance.blueprints, b.blueprintId, b.classificationVersion);
    const c = d ? certificationOf(d) : null;
    if (!adapter?.systemVersionId || !d || !c) { refuse('BLUEPRINT_CLASSIFICATION', `${b.blueprintId}@${b.classificationVersion}`, d); continue; }
    blueprints.push({ blueprint: b, systemId: adapter.systemId, systemVersionId: adapter.systemVersionId, contentHash: d.contentHash, certification: c, buckets: b.buckets.map((x) => ({ bucketId: x.bucket.bucketId, objectiveCode: x.bucket.objectiveCode, primaryConceptStableIds: [...x.bucket.primaryConceptStableIds] })) });
  }

  const applicability: PlannedApplicability[] = [];
  for (const e of library) for (const t of e.targets) {
    const record = libraryApplicability(e.core, t.adapterId, coreRegister);
    const contentHash = pilotApplicabilityHash(record);
    const identity = `${e.core.constructFamilyId} x ${t.adapterId}`;
    if (record.status === 'NOT_APPLICABLE') { blocked.push({ kind: 'CORE_APPLICABILITY', identity, reason: 'NOT_APPLICABLE', detail: record.reason ?? '' }); continue; }
    // a CONDITIONAL applicability is delivered only on a recorded approval of exactly its content: there is no automated route to it
    const approval = record.status === 'CONDITIONAL' ? humanDecisions.find((h) => h.objectType === 'CORE_APPLICABILITY' && h.objectId === identity && h.objectVersion === e.core.familyVersion && h.evidenceHash === contentHash && h.decision === 'APPROVE') ?? null : null;
    if (record.status === 'CONDITIONAL' && !approval) { blocked.push({ kind: 'CORE_APPLICABILITY', identity, reason: 'CONDITIONAL_APPLICABILITY_NOT_APPROVED', detail: 'no recorded human approval of this content' }); continue; }
    applicability.push({ coreId: e.core.constructFamilyId, coreVersion: e.core.familyVersion, record, contentHash, humanDecisionId: approval?.decisionId ?? null });
  }

  // ---- the certified instances: rendered and judged exactly as the QF V5.2 run does
  const cellResults: CellResult[] = libraryCells(library).map((c) => certifyCell(c.entry, c.target, c.planningBand, PUBLICATION_PER_CELL, governance, batchId, coreRegister));
  const instances: PlannedInstance[] = [];
  for (const cell of cellResults) {
    for (const n of cell.notCertified) blocked.push({ kind: 'ITEM_INSTANCE', identity: n.seed, reason: n.outcome, detail: n.reasons.join(', ') });
    for (const r of cell.refusals) blocked.push({ kind: 'ITEM_INSTANCE', identity: r.seed, reason: r.code, detail: r.detail });
    for (const i of cell.certified) {
      const core = cores.find((c) => c.core.constructFamilyId === i.coreId && c.core.familyVersion === i.coreVersion);
      const block = (reason: string, detail: string): void => { blocked.push({ kind: 'ITEM_INSTANCE', identity: i.instanceId, reason, detail }); };
      const refusals = eligibilityRefusals(i, scope, live);
      if (refusals.length > 0) { block(refusals[0], refusals.join(', ')); continue; }
      if (i.itemType !== EXAM_BANK_ITEM) { block('NOT_AN_EXAM_BANK_ITEM', i.itemType); continue; }
      if (!core) { block('CORE_NOT_PUBLISHED', `${i.coreId}@${i.coreVersion}`); continue; }
      if (!adapters.some((a) => a.adapter.adapterId === i.adapterId && a.adapter.version === i.adapterVersion)) { block('ADAPTER_NOT_PUBLISHED', i.adapterId); continue; }
      if (!renderers.some((r) => r.rendererVersion === i.rendererVersion && r.envelopeHash === i.envelopeHash)) { block('RENDERER_ENVELOPE_NOT_PUBLISHED', i.rendererVersion); continue; }
      if (!blueprints.some((b) => b.blueprint.blueprintId === i.blueprintId && b.blueprint.classificationVersion === i.blueprintVersion && b.buckets.some((x) => x.bucketId === i.bucketId && x.primaryConceptStableIds.includes(i.conceptId)))) { block('BLUEPRINT_BUCKET_NOT_PUBLISHED', i.bucketId); continue; }
      if (!applicability.some((a) => a.coreId === i.coreId && a.record.componentId === i.adapterId)) { block('APPLICABILITY_NOT_PUBLISHED', `${i.coreId} x ${i.adapterId}`); continue; }
      if (i.certificationState !== 'AUTOMATED_CERTIFIED_PILOT' || i.certificationMode !== 'INHERITED_DETERMINISTIC_CERTIFICATION') { block('NOT_AN_INHERITED_DETERMINISTIC_CERTIFICATION', `${i.certificationState}/${i.certificationMode}`); continue; }
      if (i.rightsCategory !== 'STUDYUS_ORIGINAL_DETERMINISTIC') { block('RIGHTS_NOT_ESTABLISHED', i.rightsCategory); continue; }
      if (i.policyHash !== HUMAN50_POLICY_HASH) { block('CERTIFIED_UNDER_ANOTHER_POLICY', i.policyHash); continue; }
      const l = i.lineage;
      if (!l.adaptationSpecificationId || !l.parameterSetId || !l.seed || !l.blueprintBucketId || !l.rendererVersion) { block('LINEAGE_INCOMPLETE', i.instanceId); continue; }
      instances.push({ instance: i, contentHash: instanceContentHashOf(i), certificationVersion: core.certificationVersion, provenance: 'INHERITED_DETERMINISTIC', rightsStatus: 'STUDYUS_OWNED', rightsBasis: RIGHTS_BASIS, materialized: materialize(i) });
    }
  }
  if (new Set(instances.map((x) => x.instance.lineageHash)).size !== instances.length) preflight.push('INSTANCE_LINEAGE_DIGESTS_NOT_UNIQUE');

  const capacity = capacitySummary(library.filter((e) => cores.some((c) => c.core.constructFamilyId === e.core.constructFamilyId)).flatMap((e) => envelopeCapacity(e)));
  const inputsHash = sha256OfCanonicalJson({ policy: HUMAN50_POLICY_HASH, per: PUBLICATION_PER_CELL, batch: batchId, governance: [...governance.cores, ...governance.adapters, ...governance.envelopes, ...governance.blueprints].map((d) => [d.objectId, d.objectVersion, d.contentHash, d.state]) });
  const body = {
    v: 1 as const, batchId, scope,
    policy: { policyHash: HUMAN50_POLICY_HASH, policyId: HUMAN50_POLICY_V1.policyId, version: HUMAN50_POLICY_V1.version, mayGrantScopes: [...HUMAN50_POLICY_V1.mayGrantScopes], policy: HUMAN50_POLICY_V1 },
    inputsHash, systems, qualifications, humanDecisions, cores, adapters, renderers, blueprints, applicability,
    cells: cellResults.map((c) => ({ cellId: c.cell, attempted: c.attempted, certified: c.certified.length })),
    instances,
    capacity: { rawVariantCapacity: capacity.rawVariantCapacity, distinctDeliverableVariants: capacity.distinctDeliverableVariants, recognitionClasses: capacity.recognitionClasses, certifiedDeliveryCapacity: capacity.certifiedDeliveryCapacity, effectiveRepeatabilityDepth: capacity.effectiveRepeatabilityDepth },
    blocked, preflight,
  };
  return { ...body, planHash: sha256OfCanonicalJson({ ...body, instances: instances.map((x) => [x.instance.lineageHash, x.contentHash, x.certificationVersion]) }) };
}

/** What a plan would write, in counts. The dry run prints this against what the database already holds. */
export function planCounts(plan: PublicationPlan): Record<string, number> {
  const objects = [...plan.cores.map((c) => c.certification), ...plan.adapters.map((a) => a.certification), ...plan.renderers.map((r) => r.certification), ...plan.blueprints.map((b) => b.certification)];
  return {
    policies: 1, systems: plan.systems.length, reviewerQualifications: plan.qualifications.length, humanDecisions: plan.humanDecisions.length,
    humanCertifiedObjects: objects.filter((o) => o.provenance === 'HUMAN').length, automatedCertifiedObjects: objects.filter((o) => o.provenance === 'AUTOMATED').length,
    cores: plan.cores.length, adapters: plan.adapters.length, renderers: plan.renderers.length, envelopes: plan.renderers.length, blueprints: plan.blueprints.length, blueprintBuckets: plan.blueprints.reduce((n, b) => n + b.buckets.length, 0),
    applicability: plan.applicability.length, batchCells: plan.cells.length, certifiedInstances: plan.instances.length, blocked: plan.blocked.length,
  };
}

/**
 * The plan and its extensions as ONE publication (one transaction): shared objects (systems, decisions, adapters,
 * blueprints) once, each extension's own objects and instances added, every instance tagged with its batch.
 */
export function mergedForPublication(plan: PublicationPlan): PublicationPlan & { batches: { batchId: string; inputsHash: string; cells: PublicationPlan['cells'] }[] } {
  const all = [plan, ...(plan.extensions ?? [])];
  const uniq = <T>(xs: T[], key: (x: T) => string): T[] => { const seen = new Set<string>(); return xs.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
  return {
    ...plan,
    systems: uniq(all.flatMap((p) => p.systems), (x) => x),
    qualifications: uniq(all.flatMap((p) => p.qualifications), (x) => JSON.stringify(x)),
    humanDecisions: uniq(all.flatMap((p) => p.humanDecisions), (x) => x.decisionId),
    adapters: uniq(all.flatMap((p) => p.adapters), (x) => `${x.adapter.adapterId}@${x.adapter.version}`),
    cores: uniq(all.flatMap((p) => p.cores), (x) => `${x.core.constructFamilyId}@${x.core.familyVersion}`),
    renderers: uniq(all.flatMap((p) => p.renderers), (x) => `${x.rendererVersion}|${x.envelopeHash}`),
    blueprints: uniq(all.flatMap((p) => p.blueprints), (x) => `${x.blueprint.blueprintId}@${x.blueprint.classificationVersion}`),
    applicability: uniq(all.flatMap((p) => p.applicability), (x) => `${x.coreId}@${x.coreVersion}|${x.record.componentId}`),
    instances: all.flatMap((p) => p.instances.map((i) => ({ ...i, batchId: p.batchId }))),
    blocked: all.flatMap((p) => p.blocked),
    preflight: all.flatMap((p) => p.preflight),
    batches: all.map((p) => ({ batchId: p.batchId, inputsHash: p.inputsHash, cells: p.cells })),
  };
}
