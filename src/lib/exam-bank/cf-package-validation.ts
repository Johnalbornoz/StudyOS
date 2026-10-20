/**
 * Content Factory package INGESTION DRY RUN (pure, no IO, no database). Every candidate of a package is checked against
 * the governed state of the repository; nothing is written. A candidate is ACCEPTED only when every check passes:
 *
 *   PACKAGE_HASH            the bytes are the pinned package
 *   IDENTITY                candidateId, contentDigest, recognitionId and seed are unique in the package
 *   CONCEPT_GOVERNED        the concept is a governed stable id established as assessed by the candidate's component
 *   BUCKET_CERTIFIED        a governed (eligible) blueprint classification of the component places the concept in the bucket
 *   ADAPTER_GOVERNED        the adapter is registered and its governance is eligible
 *   FORMAT_OFFERED          the adapter offers the candidate's response format
 *   SCORING_POLICY          the canonical contract is coherent; the key is accepted in its written forms; every modelled
 *                           wrong answer is refused -- by the Question Factory evaluator AND the canonical contract alike
 *   LINEAGE_COMPLETE        system, version, adapter, blueprint, bucket, objective, core, renderer and concept are named
 *   RIGHTS_PROVENANCE       StudyUs-original deterministic content, no provider call, no copied protected expression
 *   NOT_A_DUPLICATE         the wording is not already certified supply and appears once in the package
 *   PROJECTION              the bank projection that would publish it accepts it (projection 3 for IB)
 * CERTIFICATION_ELIGIBLE = all governance checks above. A dry run ingests nothing; running it twice gives the same report.
 */
import { createHash } from 'crypto';
import { PUBLICATION_APPLICABILITY, PUBLICATION_BLUEPRINTS, PUBLICATION_LIBRARY } from '@/lib/assessment-instance/library/catalogue';
import { STUDYUS_ASSESSMENT_REGISTRY } from '@/lib/assessment-instance/registered-systems';
import { evaluateResponse, type ResponseEvaluationPolicy } from '@/lib/assessment-instance/response-evaluation';
import { governLibrary } from '@/lib/assessment-instance/v52/library-batch';
import { governanceEligible } from '@/lib/assessment-instance/v52/object-governance';
import type { CertifiedInstance } from '@/lib/assessment-instance/v52';
import { resolveApplicability, EA1_APPLICABILITY_THRESHOLD } from '@/lib/assessment-adaptation/assessment-applicability';
import { evaluateCanonicalNumeric, policyIssues } from '@/lib/assessment-scoring/canonical-response';
import { PAA_CERTIFIED_CONCEPTS } from '@/lib/curriculum/paa/paa-certified-concepts';
import { IB_AA_HL_CONCEPT_IDENTITIES, IB_AA_HL_CORRESPONDENCES } from '@/lib/curriculum/ib/ib-aa-hl-concept-correspondence';
import { bankProjectionFor } from './scoring-projection';

export const CF_DRY_RUN_VERSION = 'cf-package-dry-run-2';
export type DryRunCheck = 'PACKAGE_HASH' | 'IDENTITY' | 'CONCEPT_GOVERNED' | 'BUCKET_CERTIFIED' | 'ADAPTER_GOVERNED' | 'FORMAT_OFFERED' | 'SCORING_POLICY' | 'LINEAGE_COMPLETE' | 'RIGHTS_PROVENANCE' | 'NOT_A_DUPLICATE' | 'PROJECTION';
export const GOVERNANCE_CHECKS: readonly DryRunCheck[] = ['CONCEPT_GOVERNED', 'BUCKET_CERTIFIED', 'ADAPTER_GOVERNED', 'FORMAT_OFFERED'];
export interface CandidateVerdict { candidateId: string; construct: string; bucketId: string; failed: { check: DryRunCheck; detail: string }[]; certificationEligible: boolean; accepted: boolean }
/** The package's standing: content valid or not; what governance still needs; whether its format must be re-delivered. */
export interface PackageStatus { content: 'CONTENT_VALID' | 'CONTENT_INVALID'; governance: 'GOVERNANCE_PASSED' | 'GOVERNANCE_PENDING'; format: 'FORMAT_COMPATIBLE' | 'FORMAT_REPROJECTION_REQUIRED' }
export interface DryRunReport {
  status: PackageStatus;
  version: string; batchId: string; packageSha256: string; expectedSha256: string; candidates: number; constructs: number;
  accepted: number; certificationEligible: number; failuresByCheck: Partial<Record<DryRunCheck, number>>;
  byConstruct: Array<{ construct: string; coreId: string; bucketId: string; conceptStableId: string; declaredConcept: string; candidates: number; accepted: number; failedChecks: DryRunCheck[]; firstDetail: Partial<Record<DryRunCheck, string>> }>;
  verdicts: CandidateVerdict[]; reportDigest: string;
}

const LINEAGE_FIELDS = ['systemId', 'systemVersionId', 'adapterId', 'blueprintId', 'bucketId', 'objectiveCode', 'coreId', 'coreVersion', 'rendererVersion', 'construct'] as const;
const GOVERNED_STABLE_IDS = new Set([...PAA_CERTIFIED_CONCEPTS.map((c) => c.stableId), ...IB_AA_HL_CONCEPT_IDENTITIES.filter((x) => x.status !== 'PROPOSED_PENDING_DECISION').map((x) => x.stableId)]);
/**
 * The concept a candidate is governed under: the GOVERNED correspondence of its core (Track B owns concept identity),
 * else the id the package declares. A package-declared id that differs is reported (`declaredConcept`), never adopted.
 */
const governedConceptOf = (coreId: string, declared: string): string => IB_AA_HL_CORRESPONDENCES.find((c) => c.constructId === coreId)?.studyusCanonicalConceptId ?? declared;
const decimalOf = (k: string): string | null => { const m = /^(-?\d+)\/(\d+)$/.exec(k); if (!m) return null; let d = Number(m[2]); while (d % 2 === 0) d /= 2; while (d % 5 === 0) d /= 5; if (d !== 1) return null; const v = Number(m[1]) / Number(m[2]); const s = String(v); return s.length <= 12 ? s : null; };

export function dryRunCfPackage(bytes: Buffer | string, expectedSha256: string, existingWordings: ReadonlySet<string>): DryRunReport {
  const sha = createHash('sha256').update(bytes).digest('hex');
  const pkg = JSON.parse(bytes.toString()) as { batchId: string; constructs: any[]; candidates: any[] };
  const registry = STUDYUS_ASSESSMENT_REGISTRY;
  const g = governLibrary(undefined, PUBLICATION_LIBRARY, PUBLICATION_BLUEPRINTS, PUBLICATION_APPLICABILITY);
  const count = (key: (c: any) => string) => { const m = new Map<string, number>(); for (const c of pkg.candidates) m.set(key(c), (m.get(key(c)) ?? 0) + 1); return m; };
  const ids = count((c) => c.candidateId), digests = count((c) => c.contentDigest), recog = count((c) => c.recognitionId), seeds = count((c) => c.seed), wordings = count((c) => `${c.lineage.adapterId}|${c.learner.prompt}`);
  const verdicts: CandidateVerdict[] = pkg.candidates.map((c) => {
    const failed: CandidateVerdict['failed'] = [];
    const fail = (check: DryRunCheck, detail: string) => failed.push({ check, detail });
    const l = c.lineage;
    if (sha !== expectedSha256) fail('PACKAGE_HASH', `${sha} != ${expectedSha256}`);
    if ([ids.get(c.candidateId), digests.get(c.contentDigest), recog.get(c.recognitionId), seeds.get(c.seed)].some((n) => n !== 1)) fail('IDENTITY', 'an identity is not unique in the package');
    // concept: a governed stable id, established as assessed by THIS component
    const stableId: string = governedConceptOf(l.coreId, l.concept?.stableId ?? '');
    const established = GOVERNED_STABLE_IDS.has(stableId) && PUBLICATION_APPLICABILITY.some((r) => r.concept.stableId === stableId && r.scope.componentId === l.adapterId && resolveApplicability(PUBLICATION_APPLICABILITY, r.concept, r.scope, EA1_APPLICABILITY_THRESHOLD).status === 'ESTABLISHED');
    if (!established) fail('CONCEPT_GOVERNED', `${stableId} (${l.concept?.stableIdStatus ?? 'no status'}): ${GOVERNED_STABLE_IDS.has(stableId) ? 'not established for' : 'no governed stable id for'} ${l.adapterId}`);
    // bucket: a governed classification of the component places the concept there
    const bp = PUBLICATION_BLUEPRINTS.find((b) => b.adapterId === l.adapterId && b.buckets.some((x) => x.bucket.bucketId === l.bucketId));
    const bpDecision = bp ? g.blueprints.find((d) => d.objectId === bp.blueprintId && d.objectVersion === bp.classificationVersion) : undefined;
    const bucket = bp?.buckets.find((x) => x.bucket.bucketId === l.bucketId);
    if (!bp || !bpDecision || !governanceEligible(bpDecision) || !bucket?.bucket.primaryConceptStableIds.includes(stableId)) fail('BUCKET_CERTIFIED', bp ? `${l.bucketId} does not place ${stableId}` : `${l.bucketId}: no governed classification of ${l.adapterId} holds this bucket`);
    const adapter = registry.adapter(l.adapterId);
    const adDecision = g.adapters.find((d) => d.objectId === l.adapterId);
    if (!adapter || !adDecision || !governanceEligible(adDecision)) fail('ADAPTER_GOVERNED', `${l.adapterId}: ${adapter ? adDecision?.state ?? 'not governed' : 'not registered'}`);
    if (adapter && !adapter.responseFormats.includes(c.learner.itemType)) fail('FORMAT_OFFERED', `${c.learner.itemType} not in ${adapter.responseFormats.join('/')}`);
    // scoring: both evaluators, same verdicts, on the key forms and every modelled wrong answer
    const policy = c.responsePolicy as ResponseEvaluationPolicy;
    const key: string = c.key.answers[0];
    const issues = policyIssues(policy);
    const forms = [key, ...(decimalOf(key) ? [decimalOf(key)!, decimalOf(key)!.replace('.', ',')] : [])];
    const wrong = (c.misconceptions ?? []).map((m: any) => String(m.value)).filter((v: string) => v !== key);
    const qf = (r: string) => evaluateResponse(policy, c.key.answers, r).correct;
    const canon = (r: string) => evaluateCanonicalNumeric(policy, key, r).correct;
    const bad = [...forms.filter((f) => !qf(f) || !canon(f)).map((f) => `key form ${f} refused`), ...wrong.filter((w: string) => qf(w) || canon(w)).map((w: string) => `wrong answer ${w} accepted`), ...[...forms, ...wrong].filter((r) => qf(r) !== canon(r)).map((r) => `evaluators disagree on ${r}`)];
    if (issues.length || bad.length) fail('SCORING_POLICY', [...issues, ...bad].join('; '));
    const missing = LINEAGE_FIELDS.filter((f) => !l[f]);
    if (missing.length || !stableId) fail('LINEAGE_COMPLETE', `missing ${[...missing, ...(stableId ? [] : ['concept.stableId'])].join(', ')}`);
    if (c.rights?.rightsStatus !== 'STUDYUS_ORIGINAL_DETERMINISTIC' || c.rights?.containsCopiedProtectedExpression !== false || c.provenance?.providerCalls !== 0) fail('RIGHTS_PROVENANCE', JSON.stringify({ rights: c.rights?.rightsStatus, copied: c.rights?.containsCopiedProtectedExpression, providerCalls: c.provenance?.providerCalls }));
    const wording = `${l.adapterId}|${c.learner.prompt}`;
    if (existingWordings.has(wording) || wordings.get(wording) !== 1) fail('NOT_A_DUPLICATE', c.learner.prompt);
    // projection: what WOULD publish it, if it were certified
    const asInstance = { systemId: l.systemId, format: c.learner.itemType, certificationState: 'AUTOMATED_CERTIFIED_PILOT', learner: c.learner, key: c.key, rubric: c.rubric, responsePolicy: policy, marks: c.learner.marks, markedOnWorking: false } as unknown as CertifiedInstance;
    const proj = bankProjectionFor(asInstance);
    if (proj.refusal) fail('PROJECTION', `${proj.version}: ${proj.refusal}`);
    const certificationEligible = !failed.some((f) => GOVERNANCE_CHECKS.includes(f.check));
    return { candidateId: c.candidateId, construct: l.construct, bucketId: l.bucketId, failed, certificationEligible, accepted: failed.length === 0 };
  });
  const failuresByCheck: DryRunReport['failuresByCheck'] = {};
  for (const v of verdicts) for (const f of new Set(v.failed.map((x) => x.check))) failuresByCheck[f] = (failuresByCheck[f] ?? 0) + 1;
  const byConstruct = pkg.constructs.map((k: any) => {
    const vs = verdicts.filter((v) => v.construct === k.construct);
    const cand = pkg.candidates.find((c) => c.lineage.construct === k.construct);
    const firstDetail: Partial<Record<DryRunCheck, string>> = {};
    for (const v of vs) for (const f of v.failed) if (!(f.check in firstDetail)) firstDetail[f.check] = f.detail;
    return { construct: k.construct, coreId: k.proposedCoreId, bucketId: cand?.lineage.bucketId ?? '', conceptStableId: governedConceptOf(cand?.lineage.coreId ?? '', k.concept?.stableId ?? ''), declaredConcept: k.concept?.stableId ?? '', candidates: vs.length, accepted: vs.filter((v) => v.accepted).length, failedChecks: [...new Set(vs.flatMap((v) => v.failed.map((f) => f.check)))].sort() as DryRunCheck[], firstDetail };
  });
  const contentChecks: DryRunCheck[] = ['PACKAGE_HASH', 'IDENTITY', 'SCORING_POLICY', 'LINEAGE_COMPLETE', 'RIGHTS_PROVENANCE', 'NOT_A_DUPLICATE', 'PROJECTION'];
  const status: PackageStatus = {
    content: contentChecks.some((k) => failuresByCheck[k]) ? 'CONTENT_INVALID' : 'CONTENT_VALID',
    governance: failuresByCheck.CONCEPT_GOVERNED || failuresByCheck.BUCKET_CERTIFIED || failuresByCheck.ADAPTER_GOVERNED ? 'GOVERNANCE_PENDING' : 'GOVERNANCE_PASSED',
    format: failuresByCheck.FORMAT_OFFERED ? 'FORMAT_REPROJECTION_REQUIRED' : 'FORMAT_COMPATIBLE',
  };
  const body = { status, version: CF_DRY_RUN_VERSION, batchId: pkg.batchId, packageSha256: sha, expectedSha256, candidates: verdicts.length, constructs: pkg.constructs.length, accepted: verdicts.filter((v) => v.accepted).length, certificationEligible: verdicts.filter((v) => v.certificationEligible).length, failuresByCheck, byConstruct, verdicts };
  return { ...body, reportDigest: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}

/**
 * ACCEPTANCE of a Content Factory format revision: a revised candidate is accepted only if it is EXACTLY what the
 * governed Track B renderer certifies from the same parameter set -- same wording, key, response policy, marks,
 * rubric shape and format. Any difference is named; nothing is reconciled.
 */
export function revisionAcceptance(revised: any, certified: CertifiedInstance): { accepted: boolean; differences: string[] } {
  const want = { prompt: certified.learner.prompt, key: certified.key.answers, policy: certified.responsePolicy, marks: certified.marks, format: certified.format, rubric: certified.rubric.map((r) => [r.kind, r.marks]) };
  const got = { prompt: revised?.learner?.prompt, key: revised?.key?.answers, policy: revised?.responsePolicy, marks: revised?.learner?.marks, format: revised?.learner?.itemType, rubric: (revised?.rubric ?? []).map((r: any) => [r.kind, r.marks]) };
  const differences = (Object.keys(want) as (keyof typeof want)[]).filter((k) => JSON.stringify(want[k]) !== JSON.stringify(got[k]));
  return { accepted: differences.length === 0, differences };
}
