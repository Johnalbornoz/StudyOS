/**
 * QF V5.2 -- the batch that turns the library into certified EXAM BANK supply (pure, deterministic, no IO).
 *
 *   govern every object -> render deterministic instances cell by cell -> judge each against the policy
 *     -> keep the certified ones as the supply inventory
 * A cell is one (core, adapter, band). The batch is restartable by construction: a cell's result depends only on
 * the library, the policy and the cell, so a cell computed once is the cell computed again.
 */
import { sha256OfCanonicalJson } from '@/lib/assessment-adaptation/canonical-hash';
import { bandOf } from '@/lib/exam-core/question-bank/quality';
import { adapterConflicts, STUDYUS_ASSESSMENT_REGISTRY } from '../registered-systems';
import { LIBRARY, LIBRARY_APPLICABILITY, LIBRARY_BLUEPRINTS, renderLibraryInstance, type LibraryBlueprint, type LibraryEntry, type LibraryRender, type LibraryTarget } from '../library/catalogue';
import { PLANNING_BANDS, type PlanningBand } from '../library/parametric';
import { pilotBlueprintHash, PILOT_BLUEPRINTS } from '../pilot/step4b-pilot-slice';
import type { CertificationDecisionV52 } from './certification-engine';
import { HUMAN50_POLICY_HASH, HUMAN50_POLICY_V1, HUMAN50_POLICY_VERSION } from './certification-policy';
import { certifyInstance, recognitionIdOf, wordingIdOf, type Governance } from './instance-certification';
import { governAdapter, governBlueprint, governCore, governEnvelope, governanceEligible, type GovernanceDecision, type HumanRecords } from './object-governance';
import { rightsGate } from './rights-provenance';
import { EXAM_BANK_ITEM, isMarkedOnWorking, lineageHashOf, type BlueprintDemand, type CertifiedInstance, type LiveGovernance } from './supply-authority';

export interface LibraryGovernance { cores: GovernanceDecision[]; adapters: GovernanceDecision[]; envelopes: GovernanceDecision[]; blueprints: GovernanceDecision[] }
const NO_HUMAN: HumanRecords = { records: [], qualifications: [] };

/** Is the renderer deterministic? Shown, not assumed: the same seeds are rendered twice and the bytes compared. */
function determinismOf(entry: LibraryEntry): boolean {
  return entry.targets.every((t) => PLANNING_BANDS.every((band) => ['d-1', 'd-2', 'd-3'].every((seed) => { const a = renderLibraryInstance(entry, t, band, seed); const b = renderLibraryInstance(entry, t, band, seed); return a.ok && b.ok && sha256OfCanonicalJson(a.value.rendered) === sha256OfCanonicalJson(b.value.rendered); })));
}
const humanHashOf = (b: LibraryBlueprint): string | undefined => { const pilot = PILOT_BLUEPRINTS.find((p) => p.blueprintId === b.blueprintId); return pilot && b.classificationVersion === 'step4b-pilot-1' ? pilotBlueprintHash(pilot) : undefined; };

/** Every governed object of the library and every registered adapter, decided. `human` is the recorded approvals, when there are any. */
export function governLibrary(human: HumanRecords = NO_HUMAN, library: readonly LibraryEntry[] = LIBRARY): LibraryGovernance {
  const registry = STUDYUS_ASSESSMENT_REGISTRY;
  const conflicts = adapterConflicts();
  return {
    cores: library.map((e) => governCore(e, LIBRARY_APPLICABILITY, human)),
    adapters: registry.adapters().map((a) => governAdapter(a.adapterId, registry, conflicts, human)),
    envelopes: library.map((e) => governEnvelope(e, determinismOf(e), human)),
    blueprints: LIBRARY_BLUEPRINTS.map((b) => governBlueprint(b, LIBRARY_APPLICABILITY, human, humanHashOf(b))),
  };
}

const find = (list: readonly GovernanceDecision[], objectId: string, objectVersion?: string): GovernanceDecision | undefined => list.find((d) => d.objectId === objectId && (objectVersion === undefined || d.objectVersion === objectVersion));
/** The live view the supply authority reads: the governance decisions as they are now, the registry, the policy in force. */
export function liveGovernanceOf(g: LibraryGovernance, quarantinedEnvelopes: ReadonlySet<string> = new Set()): LiveGovernance {
  const registry = STUDYUS_ASSESSMENT_REGISTRY;
  const lists = { CONSTRUCT_CORE: g.cores, ASSESSMENT_ADAPTER: g.adapters, RENDERER_ENVELOPE: g.envelopes, BLUEPRINT_CLASSIFICATION: g.blueprints } as const;
  return {
    objectEligible: (type, id, version) => { const d = find(lists[type], id, version); return d !== undefined && governanceEligible(d); },
    systemVersionActive: (systemId, versionId) => registry.system(systemId)?.lifecycle === 'ACTIVE' && registry.version(systemId, versionId)?.lifecycle === 'ACTIVE',
    quarantinedEnvelopes,
    rightsDeliverable: (category, scope) => rightsGate(HUMAN50_POLICY_V1, { category, established: true, basis: '' }, scope).deliverable,
    policyHashInForce: HUMAN50_POLICY_HASH,
  };
}

export interface CellResult { cell: string; coreId: string; adapterId: string; planningBand: PlanningBand; attempted: number; certified: CertifiedInstance[]; notCertified: { seed: string; outcome: string; reasons: string[] }[]; refusals: { seed: string; code: string; detail: string }[] }
export const cellIdOf = (e: LibraryEntry, t: LibraryTarget, band: PlanningBand): string => `${e.core.constructFamilyId}@${e.core.familyVersion}|${t.adapterId}|${band}`;

function toCertified(r: LibraryRender, decision: CertificationDecisionV52, state: CertifiedInstance['certificationState']): CertifiedInstance {
  const adapter = STUDYUS_ASSESSMENT_REGISTRY.adapter(r.target.adapterId)!;
  const band = bandOf(r.certifiedLineage.itemDifficulty)!;
  const head = {
    itemType: EXAM_BANK_ITEM, instanceId: r.certifiedLineage.digest, coreId: r.entry.core.constructFamilyId, coreVersion: r.entry.core.familyVersion, conceptId: r.entry.core.primaryConceptStableId, canonicalSubject: r.entry.core.canonicalSubject, systemId: adapter.systemId, systemVersionId: adapter.systemVersionId ?? '',
    adapterId: adapter.adapterId, adapterVersion: adapter.version, blueprintId: r.blueprint.blueprintId, blueprintVersion: r.blueprint.classificationVersion, blueprintClass: r.blueprint.blueprintClass, bucketId: r.bucket.bucketId, rendererVersion: r.entry.envelope.rendererVersion,
    envelopeHash: r.certifiedLineage.envelopeHash, seed: r.seed, recognitionId: recognitionIdOf(r), format: r.rendered.learner.itemType, language: r.rendered.learner.language, marks: r.rendered.learner.marks, itemDifficulty: r.certifiedLineage.itemDifficulty, difficultyBand: band,
    learner: r.rendered.learner, key: r.rendered.key, rubric: r.rendered.rubric, responsePolicy: r.rendered.responsePolicy, rightsCategory: 'STUDYUS_ORIGINAL_DETERMINISTIC' as const, certificationState: state, certificationMode: 'INHERITED_DETERMINISTIC_CERTIFICATION' as const,
    policyVersion: decision.policyVersion, policyHash: decision.policyHash, lineage: r.certifiedLineage.lineage, eligibilityScopes: decision.scopes,
  };
  const item = { ...head, markedOnWorking: isMarkedOnWorking(head) };
  return { ...item, lineageHash: lineageHashOf(item) };
}

/**
 * One cell: up to `wanted` certified instances, each of a different recognition class, from the first seeds that
 * give them. The certification state is AUTOMATED: an instance is never called human-certified because the objects
 * above it were approved by a person -- no person reviewed the instance.
 */
export function certifyCell(entry: LibraryEntry, target: LibraryTarget, planningBand: PlanningBand, wanted: number, g: LibraryGovernance, batchId: string): CellResult {
  const adapter = STUDYUS_ASSESSMENT_REGISTRY.adapter(target.adapterId)!;
  const placed = LIBRARY_BLUEPRINTS.find((b) => b.adapterId === target.adapterId);
  const governance: Governance | null = (() => {
    const core = find(g.cores, entry.core.constructFamilyId, entry.core.familyVersion); const ad = find(g.adapters, target.adapterId); const env = find(g.envelopes, entry.envelope.rendererVersion, entry.envelope.constructFamilyVersion);
    const bp = placed ? find(g.blueprints, placed.blueprintId, placed.classificationVersion) : undefined;
    return core && ad && env && bp ? { core, adapter: ad, envelope: env, blueprint: bp } : null;
  })();
  const out: CellResult = { cell: cellIdOf(entry, target, planningBand), coreId: entry.core.constructFamilyId, adapterId: target.adapterId, planningBand, attempted: 0, certified: [], notCertified: [], refusals: [] };
  if (!governance) { out.refusals.push({ seed: '-', code: 'NO_GOVERNANCE_DECISION', detail: 'an object the cell depends on was not governed' }); return out; }
  const wordings = new Set<string>(); const recognition = new Set<string>();
  const short = entry.core.constructFamilyId.split('.').slice(2).join('.');
  for (let n = 1; out.certified.length < wanted && n <= wanted * 40; n += 1) {
    const seed = `${batchId}/${short}/${target.adapterId}/${planningBand.toLowerCase()}/${String(n).padStart(4, '0')}`;
    const r = renderLibraryInstance(entry, target, planningBand, seed);
    out.attempted += 1;
    if (!r.ok) { out.refusals.push({ seed, code: r.code, detail: r.detail }); if (out.refusals.length >= 3) break; continue; }
    const id = recognitionIdOf(r.value);
    // a variant a learner would take for one already held is not rendered into supply at all
    if (recognition.has(id)) continue;
    const c = certifyInstance(r.value, adapter, governance, { wordings, recognition }, HUMAN50_POLICY_V1);
    if (c.decision.outcome !== 'AUTOMATED_CERTIFIED_PILOT') { out.notCertified.push({ seed, outcome: c.decision.outcome, reasons: c.decision.reasons.map((x) => `${x.ruleId}:${x.reasonCode}`) }); if (out.notCertified.length >= 5) break; continue; }
    recognition.add(id); wordings.add(wordingIdOf(r.value));
    out.certified.push(toCertified(r.value, c.decision, 'AUTOMATED_CERTIFIED_PILOT'));
  }
  return out;
}

export const libraryCells = (library: readonly LibraryEntry[] = LIBRARY): { entry: LibraryEntry; target: LibraryTarget; planningBand: PlanningBand }[] => library.flatMap((entry) => entry.targets.flatMap((target) => PLANNING_BANDS.map((planningBand) => ({ entry, target, planningBand }))));
export const blueprintDemandOf = (b: LibraryBlueprint): BlueprintDemand => ({ blueprintId: b.blueprintId, blueprintVersion: b.classificationVersion, blueprintClass: b.blueprintClass, adapterId: b.adapterId, buckets: b.buckets.map((x) => ({ bucketId: x.bucket.bucketId, positions: x.governedPositions })) });
export const V52_BATCH = { policyVersion: HUMAN50_POLICY_VERSION, policyHash: HUMAN50_POLICY_HASH } as const;
