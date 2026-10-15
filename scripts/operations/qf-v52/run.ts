/**
 * QF V5.2 -- the EXAM BANK offline batch: govern, certify, recover, freeze the holdout, measure exam coverage, report.
 *
 * Scope: standardized exam content only. Ordinary Learning and Internal Assessment have their own dynamic supply;
 * nothing here supplies them, counts them or can block them.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/operations/qf-v52/run.ts            runs (resuming from checkpoints) and writes the artefacts
 *   npx tsx --tsconfig tsconfig.json scripts/operations/qf-v52/run.ts --fresh    ignores checkpoints
 *   npx tsx --tsconfig tsconfig.json scripts/operations/qf-v52/run.ts --check    fails if the artefacts on disk are not what the sources produce
 *
 * No provider, no database, no network, no clock. It reads the repository and, for one recovery source, the
 * Canary files of a sibling worktree when they are there (QF52_CANARY_DIR). It certifies by policy; it records no
 * human decision and changes no human record. Every file it writes is under docs/exams/question-factory/v52/.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyBlueprintSection, adapterForGenerationProfile, STUDYUS_ASSESSMENT_REGISTRY, type CertificationRecord, type ReviewerQualification, type Tier, type ValidatableItem } from '@/lib/assessment-instance';
import { LIBRARY, LIBRARY_BLUEPRINTS } from '@/lib/assessment-instance/library/catalogue';
import {
  auditSample, blueprintDemand, blueprintDemandOf, capacitySummary, CAPACITY_POLICY, certifyCell, coverageMatrix, DEMAND_POLICY, envelopeCapacity, EXAM_BANK_ITEM, gapPlan, governanceEligible, governLibrary, HUMAN50_POLICY_HASH, HUMAN50_POLICY_V1,
  HUMAN50_POLICY_VERSION, libraryCells, liveGovernanceOf, materialize, policyIssues, PROVISIONAL_AUDIT_POLICY, qualityOfRecordedCandidate, recoveryOutcomeOf, recoveryTotals, supplyForBlueprint, supplyForExamPractice, systemCoverage,
  type CellResult, type CertifiedInstance, type DemandUnit, type NormalizedCandidate, type QualityVerdict, type RecordedSignals, type SystemBlueprintSection,
} from '@/lib/assessment-instance/v52';
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
// the archived run reads the registry as it certified against it (no rebinding made after V5.2)
import { V52_ASSESSMENT_REGISTRY } from '@/lib/assessment-instance/registered-systems';

const ROOT = process.cwd();
const OUT = join(ROOT, 'docs/exams/question-factory/v52');
const STATE = join(OUT, 'run/STATE.json');
const BATCH_ID = 'qf52-batch-1';
const PER_CELL = 10;
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

// ------------------------------------------------------------------------------------ human records (read only)
const recordsFile = join(ROOT, 'docs/exams/question-factory/step4b/STEP4B_CERTIFICATION_RECORDS.json');
const human = existsSync(recordsFile) ? (() => { const f = readJson<{ qualification: ReviewerQualification; records: { record: CertificationRecord }[] }>(recordsFile); return { records: f.records.map((r) => r.record), qualifications: [f.qualification] }; })() : { records: [], qualifications: [] };

// ------------------------------------------------------------------------------------------ 1. governance
if (policyIssues(HUMAN50_POLICY_V1).length > 0) throw new Error(`POLICY_INVALID: ${policyIssues(HUMAN50_POLICY_V1).join(', ')}`);
const governance = governLibrary(human, undefined, undefined, undefined, V52_ASSESSMENT_REGISTRY);
const live = liveGovernanceOf(governance);
const eligibleCount = (list: readonly { state: string }[]) => list.filter(governanceEligible as (d: { state: string }) => boolean).length;

// --------------------------------------------------------------------------------- 2. batch certification
// Restartable: a cell's result depends only on the library, the policy and the cell. A checkpoint is kept per cell
// and reused when the inputs it was computed from are unchanged.
const inputsHash = sha(JSON.stringify({ policy: HUMAN50_POLICY_HASH, per: PER_CELL, batch: BATCH_ID, governance: [...governance.cores, ...governance.adapters, ...governance.envelopes, ...governance.blueprints].map((d) => [d.objectId, d.objectVersion, d.contentHash, d.state]) }));
type Checkpoints = { inputsHash: string; cells: Record<string, CellResult> };
const fresh = process.argv.includes('--fresh') || process.argv.includes('--check');
const checkpoints: Checkpoints = !fresh && existsSync(STATE) && readJson<Checkpoints>(STATE).inputsHash === inputsHash ? readJson<Checkpoints>(STATE) : { inputsHash, cells: {} };
let resumed = 0; let computed = 0;
const cells: CellResult[] = libraryCells().map((c) => {
  const id = `${c.entry.core.constructFamilyId}@${c.entry.core.familyVersion}|${c.target.adapterId}|${c.planningBand}`;
  if (checkpoints.cells[id]) { resumed += 1; return checkpoints.cells[id]; }
  const r = certifyCell(c.entry, c.target, c.planningBand, PER_CELL, governance, BATCH_ID);
  checkpoints.cells[id] = r; computed += 1;
  return r;
});
const supply: CertifiedInstance[] = cells.flatMap((c) => c.certified);
const reviewRequiredInstances = cells.reduce((n, c) => n + c.notCertified.filter((x) => x.outcome === 'REVIEW_REQUIRED').length, 0);
const rejectedInstances = cells.reduce((n, c) => n + c.notCertified.filter((x) => x.outcome === 'REJECTED').length, 0);

// ---------------------------------------------------------------------------------- 3. inventory recovery
const RUNS = join(ROOT, 'docs/audits/qb_review/run');
interface RunItem { itemId: string; itemType: string; language: string; stimulus: string | null; fullLearnerPrompt: string; parts: { prompt: string }[]; options: { label: string; text: string }[]; proposedAnswer: string; distractorRationales: Record<string, string>; commandTerm: string | null }
interface RunRecord { itemId: string; profileId: string; family: string; subject: string; component: string; itemType: string; intendedDifficulty: string; actualDifficulty: string | null; tierFit: 'YES' | 'BORDERLINE' | 'NO' | null; answerMatch: string; answerConfidence: string; ambiguity: boolean; constructFit: 'PASS' | 'WEAK' | 'FAIL' | null; authenticity: 'HIGH' | 'MEDIUM' | 'LOW' | null; provenance: string }
const runState = new Map<string, { items: Record<string, RunItem>; records: RunRecord[] }>();
const run = (id: string) => { if (!runState.has(id)) runState.set(id, readJson(join(RUNS, id, 'state.json'))); return runState.get(id)!; };
const validatable = (item: RunItem): ValidatableItem => ({ language: item.language, itemType: item.itemType, stimulus: item.stimulus, prompt: [item.fullLearnerPrompt, ...item.parts.map((p) => p.prompt)].join('\n'), options: item.options, correctOption: item.options.length ? item.proposedAnswer : null, distractorLineage: Object.fromEntries(Object.entries(item.distractorRationales).map(([k, v]) => [k, { misconceptionId: null, reasoningError: v, derivedAnswer: null }])), assets: [] });
const signalsOf = (item: RunItem, r: RunRecord): RecordedSignals => ({
  machine: { answerConfirmed: r.answerMatch === 'CONFIRMED' || (r.answerMatch === 'JUDGED_EQUIVALENT' && r.answerConfidence === 'HIGH'), ambiguity: r.ambiguity, constructFit: r.constructFit, tierFit: r.tierFit, provenanceClear: r.provenance === 'ORIGINAL_STUDYUS' },
  judgeAuthenticity: r.authenticity, intendedTier: r.intendedDifficulty as Tier, calibratedTier: r.actualDifficulty as Tier | null, commandTerm: item.commandTerm,
});
const contentHashOf = (item: Pick<RunItem, 'stimulus' | 'fullLearnerPrompt' | 'options'>): string => sha(JSON.stringify([item.stimulus, item.fullLearnerPrompt, item.options.map((o) => o.text)]));
interface RunCandidate { runId: string; item: RunItem; record: RunRecord; quality: QualityVerdict; reasons: string[] }
function runCandidate(runId: string, itemId: string): RunCandidate {
  const s = run(runId);
  const item = s.items[itemId];
  const record = s.records.filter((r) => r.itemId === itemId).pop()!;
  const q = qualityOfRecordedCandidate(validatable(item), signalsOf(item, record), adapterForGenerationProfile(record.profileId));
  return { runId, item, record, quality: q.verdict, reasons: q.reasons };
}
const systemOfRecord = (r: RunRecord): { systemId: string | null; componentId: string | null } => { const a = adapterForGenerationProfile(r.profileId); return { systemId: a?.systemId ?? null, componentId: a?.adapterId ?? null }; };
const generatedByRun = (record: RunRecord) => ({ origin: 'PROVIDER_GENERATION_RUN' as const, coreAuthoredByStudyUs: false, containsCopiedProtectedExpression: null, runRecordPresent: record.provenance === 'ORIGINAL_STUDYUS', basisRecorded: false });

const crosswalk = readJson<{ items: { REVIEW_ID: string; ORIGINAL_ITEM_ID: string; SOURCE_RUN: string }[] }>(join(ROOT, 'docs/audits/qb_review/human_calibration/private/QB_HUMAN_CALIBRATION_50.crosswalk.json')).items;
const labels = new Map(readJson<{ labels: { reviewId: string; countedAs: 'READY' | 'DEFECT' }[] }>(join(ROOT, 'docs/audits/qb_review/human_calibration/HUMAN50_LABELS.json')).labels.map((l) => [l.reviewId, l.countedAs]));
const candidates: NormalizedCandidate[] = [];
const seenHashes = new Map<string, string>();
const dedupe = (id: string, hash: string): string | null => { const first = seenHashes.get(hash); if (first) return first; seenHashes.set(hash, id); return null; };
const fromRun = (source: 'HUMAN_50' | 'V5_UNSEEN', candidateId: string, c: RunCandidate, humanJudgement: 'READY' | 'DEFECT' | null): NormalizedCandidate => {
  const hash = contentHashOf(c.item);
  const sys = systemOfRecord(c.record);
  return {
    source, candidateId, contentHash: hash, systemId: sys.systemId, systemVersionId: sys.systemId ? V52_ASSESSMENT_REGISTRY.adapter(sys.componentId ?? '')?.systemVersionId ?? null : null, subject: c.record.subject ?? null, componentId: sys.componentId,
    // the runs recorded an objective, not a concept: nothing is mapped to a concept here
    conceptId: null, format: c.record.itemType, intendedTier: c.record.intendedDifficulty, itemDifficulty: null, provenance: generatedByRun(c.record), lineage: null, quality: c.quality, humanJudgement, possibleCoreIds: [], duplicateOf: dedupe(candidateId, hash),
  };
};
// A. the fifty reviewed items
const human50 = crosswalk.map((x) => ({ x, c: runCandidate(x.SOURCE_RUN, x.ORIGINAL_ITEM_ID) }));
for (const { x, c } of human50) candidates.push(fromRun('HUMAN_50', x.REVIEW_ID, c, labels.get(x.REVIEW_ID) ?? null));
// B. candidates of the recorded runs that were never shown to the reviewer
const shown = new Set(crosswalk.map((x) => x.ORIGINAL_ITEM_ID));
const unseen: { id: string; c: RunCandidate }[] = [];
for (const runId of ['qf5-live-001', 'qf5-live-002', 'qf5-live-006']) for (const itemId of Object.keys(run(runId).items).sort()) {
  if (shown.has(itemId)) continue;
  // run 002 was re-validated as 005: the latest record of an item is the one that counts
  const latest = runId === 'qf5-live-002' && run('qf5-live-005').items[itemId] ? 'qf5-live-005' : runId;
  unseen.push({ id: `${runId}:${itemId}`, c: runCandidate(latest, itemId) });
}
for (const u of unseen) candidates.push(fromRun('V5_UNSEEN', u.id, u.c, null));
// C. the Canary candidates, when the sibling worktree that holds them is present
const CANARY_DIR = process.env.QF52_CANARY_DIR ?? join(ROOT, '..', 'studyos-qb-r1a/docs/exams/question-bank/pilots/qb-canary-250');
const canaryFile = join(CANARY_DIR, 'generated-candidates.json');
let canaryState: 'PROCESSED' | 'SOURCE_NOT_PRESENT' = 'SOURCE_NOT_PRESENT';
let canarySlots = 0;
if (existsSync(canaryFile)) {
  canaryState = 'PROCESSED';
  const canary = readJson<{ label: string; slots: { slotId: string; state: string; candidate: { primaryConceptStableId: string; responseFormat: string; difficultyBand: string; content: { stem: string; selected?: { options: { text: string }[] } } } | null; stimulus: unknown }[] }>(canaryFile);
  // the run labelled its own output: that label is the record, and it is not improved on here
  const declaresNoRights = /RIGHTS_NOT_ESTABLISHED/.test(canary.label);
  canarySlots = canary.slots.length;
  for (const s of canary.slots) {
    if (!s.candidate) continue;
    const hash = sha(JSON.stringify([s.stimulus ?? null, s.candidate.content.stem, (s.candidate.content.selected?.options ?? []).map((o) => o.text)]));
    const cores = LIBRARY.filter((e) => e.core.primaryConceptStableId === s.candidate!.primaryConceptStableId).map((e) => e.core.constructFamilyId);
    candidates.push({
      source: 'CANARY', candidateId: `canary:${s.slotId}`, contentHash: hash, systemId: null, systemVersionId: null, subject: null, componentId: null, conceptId: s.candidate.primaryConceptStableId, format: s.candidate.responseFormat, intendedTier: s.candidate.difficultyBand, itemDifficulty: null,
      provenance: { origin: 'PROVIDER_GENERATION_RUN', coreAuthoredByStudyUs: false, containsCopiedProtectedExpression: null, runRecordPresent: true, basisRecorded: false, sourceDeclaresRightsNotEstablished: declaresNoRights },
      lineage: null, quality: null, humanJudgement: null, possibleCoreIds: cores, duplicateOf: dedupe(`canary:${s.slotId}`, hash),
    });
  }
}
// E. the fixtures the configurations ship
const fixtures = allV2Configs().flatMap((cfg) => ((cfg as { items?: { content: { key: string; contentStatus?: string } }[] }).items ?? []).map((it) => ({ key: `${(cfg as { key: string }).key}:${it.content.key}`, status: it.content.contentStatus ?? (cfg as { contentStatus?: string }).contentStatus ?? null })));
for (const f of fixtures) candidates.push({ source: 'FIXTURE', candidateId: `fixture:${f.key}`, contentHash: sha(f.key), systemId: null, systemVersionId: null, subject: null, componentId: null, conceptId: null, format: null, intendedTier: null, itemDifficulty: null, provenance: { origin: 'FIXTURE', coreAuthoredByStudyUs: false, containsCopiedProtectedExpression: null, runRecordPresent: false, basisRecorded: false }, lineage: null, quality: null, humanJudgement: null, possibleCoreIds: [], duplicateOf: null });
const decisions = candidates.map(recoveryOutcomeOf);
const inputItems = human50.length + unseen.length + canarySlots + fixtures.length;
const totals = recoveryTotals(decisions, inputItems);
const bySource = Object.fromEntries(['HUMAN_50', 'V5_UNSEEN', 'CANARY', 'FIXTURE'].map((s) => [s, Object.fromEntries(Object.entries(decisions.filter((d) => d.source === s).reduce<Record<string, number>>((m, d) => { m[d.outcome] = (m[d.outcome] ?? 0) + 1; return m; }, {})).sort())]));

// ------------------------------------------------------------------------------ 4. Human-50 regression (in-sample)
const cert = (v: QualityVerdict) => v === 'QUALITY_PASS';
const h50 = human50.map(({ x, c }) => ({ human: labels.get(x.REVIEW_ID)!, quality: c.quality }));
const pct = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
const human50Regression = {
  label: 'IN_SAMPLE_HUMAN_CALIBRATION', items: h50.length, humanReady: h50.filter((r) => r.human === 'READY').length, humanDefect: h50.filter((r) => r.human === 'DEFECT').length,
  qualityPass: h50.filter((r) => cert(r.quality)).length, qualityReview: h50.filter((r) => r.quality === 'QUALITY_REVIEW').length, qualityReject: h50.filter((r) => r.quality === 'QUALITY_REJECT').length,
  HUMAN_READY_PRECISION: pct(h50.filter((r) => cert(r.quality) && r.human === 'READY').length, h50.filter((r) => cert(r.quality)).length),
  HUMAN_DEFECT_RECALL: pct(h50.filter((r) => !cert(r.quality) && r.human === 'DEFECT').length, h50.filter((r) => r.human === 'DEFECT').length),
  HUMAN_REVIEW_QUEUE_PRECISION: pct(h50.filter((r) => !cert(r.quality) && r.human === 'DEFECT').length, h50.filter((r) => !cert(r.quality)).length),
  HUMAN_FALSE_REVIEW_RATE: pct(h50.filter((r) => !cert(r.quality) && r.human === 'READY').length, h50.filter((r) => r.human === 'READY').length),
  HUMAN_FALSE_CERTIFICATION_RATE: pct(h50.filter((r) => cert(r.quality) && r.human === 'DEFECT').length, h50.filter((r) => cert(r.quality)).length),
};

// ------------------------------------------------------------------------------------ 5. holdout (shadow set)
const holdoutItems = unseen.map((u) => ({ candidateId: u.id, contentHash: contentHashOf(u.c.item), profileId: u.c.record.profileId, format: u.c.record.itemType, intendedTier: u.c.record.intendedDifficulty, machineQuality: u.c.quality, machineReasons: u.c.reasons }));
const holdout = {
  kind: 'QF52_OUT_OF_SAMPLE_SHADOW_SET', status: 'FROZEN_BEFORE_ANY_HUMAN_REVIEW', policyVersion: HUMAN50_POLICY_VERSION, policyHash: HUMAN50_POLICY_HASH,
  rules: ['No item of this set is in Human-50.', 'No human label of this set exists; none may be used to change the policy.', 'It is an audit stream: Pilot supply does not wait for it.', 'A human review of it is recorded in a separate file and compared only with this frozen file.'],
  items: holdoutItems.length, machine: { QUALITY_PASS: holdoutItems.filter((h) => h.machineQuality === 'QUALITY_PASS').length, QUALITY_REVIEW: holdoutItems.filter((h) => h.machineQuality === 'QUALITY_REVIEW').length, QUALITY_REJECT: holdoutItems.filter((h) => h.machineQuality === 'QUALITY_REJECT').length },
  setHash: sha(JSON.stringify(holdoutItems)), candidates: holdoutItems,
};

// ------------------------------------------------------------------------------------ 6. coverage and demand
const SCOPE = 'PILOT_PREVIEW' as const;
const certifiedEntries = LIBRARY.filter((e) => governanceEligible(governance.cores.find((d) => d.objectId === e.core.constructFamilyId)!) && governanceEligible(governance.envelopes.find((d) => d.objectId === e.envelope.rendererVersion)!));
const capacityCells = certifiedEntries.flatMap((e) => envelopeCapacity(e));
const capacity = capacitySummary(capacityCells);
const demands = LIBRARY_BLUEPRINTS.map((b) => ({ systemId: b.adapterId.split('.')[0], demand: blueprintDemandOf(b) }));
const blueprintUnits = demands.flatMap((d) => blueprintDemand(supply, d.demand, d.systemId, SCOPE, live));
// the pilot exam flow is that of the first blueprint of the library: its component, its buckets, its concepts
const pilot = demands[0];
const pilotUnits = blueprintUnits.filter((u) => u.blueprintId === pilot.demand.blueprintId);
const pilotConcepts = [...new Set(LIBRARY_BLUEPRINTS[0].buckets.flatMap((b) => b.bucket.primaryConceptStableIds))];
// each exam flow is EXERCISED through the authority, not only counted
const formState = (use: 'EXAM_PRACTICE' | 'REDUCED_MOCK' | 'FULL_MOCK' | 'EXAM_SIMULATION') => { const r = supplyForBlueprint(supply, pilot.demand, use, SCOPE, live, 'report'); return r.state === 'READY' ? 'READY' : `NOT_READY (${r.reason})`; };
const practiceByConcept = pilotConcepts.map((conceptId) => supplyForExamPractice(supply, { supplyFamily: 'STANDARDIZED_EXAM', adapterId: pilot.demand.adapterId, scope: SCOPE, conceptIds: [conceptId], perConcept: 3, difficultyBand: null, selectionSeed: 'report' }, live).state);
const flows = {
  PILOT_BLUEPRINT: pilot.demand.blueprintId,
  EXAM_PRACTICE: formState('EXAM_PRACTICE'), EXAM_PRACTICE_BY_CONCEPT: practiceByConcept.every((x) => x === 'READY') ? 'READY' : 'NOT_READY', REDUCED_MOCK: formState('REDUCED_MOCK'), FULL_MOCK: formState('FULL_MOCK'), EXAM_SIMULATION: formState('EXAM_SIMULATION'),
  CHALLENGE: pilotUnits.find((u) => u.kind === 'CHALLENGE')?.ready ? 'READY' : 'NOT_READY',
};
// the boundary, shown: a consumer that is not a standardized exam is refused by the Exam Bank, and an empty Exam Bank only makes an exam NOT_READY
const boundary = {
  LEARNING_SERVED_FROM_EXAM_BANK: supplyForExamPractice(supply, { supplyFamily: 'LEARNING', adapterId: pilot.demand.adapterId, scope: SCOPE, conceptIds: pilotConcepts.slice(0, 1), perConcept: 1, difficultyBand: null, selectionSeed: 'b' }, live).state,
  INTERNAL_ASSESSMENT_SERVED_FROM_EXAM_BANK: supplyForExamPractice(supply, { supplyFamily: 'INTERNAL_ASSESSMENT', adapterId: pilot.demand.adapterId, scope: SCOPE, conceptIds: pilotConcepts.slice(0, 1), perConcept: 1, difficultyBand: null, selectionSeed: 'b' }, live).state,
  STANDARDIZED_EXAM_WITH_AN_EMPTY_EXAM_BANK: supplyForBlueprint([], pilot.demand, 'REDUCED_MOCK', SCOPE, live, 'b').state,
  EXAM_BANK_DEPENDS_ON_A_STUDENTS_LEARNING_HISTORY: 'NO: eligibility takes no Student input',
};
const pilotCriticalUnits = pilotUnits.filter((u) => ['BLUEPRINT_BUCKET', 'EXAM_PRACTICE', 'REDUCED_MOCK'].includes(u.kind));
const pilotCriticalGaps = pilotCriticalUnits.filter((u) => !u.ready);

// every registered system, from the registry and the governed blueprint inventory
const csv = readFileSync(join(ROOT, 'docs/audits/BLUEPRINT_GOVERNANCE_INVENTORY.csv'), 'utf8').trim().split('\n');
const head = csv[0].split(',');
const col = (row: string[], name: string) => row[head.indexOf(name)];
const sections: (SystemBlueprintSection & { profile: string })[] = csv.slice(1).map((line) => line.split(',')).map((row) => {
  const itemBankable = !['NOT_ITEM_BANKABLE', 'NO_PROFILE'].includes(col(row, 'governance'));
  const facts = { itemBankable, declaredFixture: false, fullFormDocumented: col(row, 'blueprint_specification') === 'DOCUMENTED', distributionPartlyDocumented: false, officialItemCount: col(row, 'official_item_count') ? Number(col(row, 'official_item_count')) : null, governedSlots: Number(col(row, 'slots_governed') || 0) };
  // the class is of the structure; the content status column of the inventory is not read
  return { systemId: col(row, 'family'), configKey: col(row, 'config'), sectionKey: col(row, 'section'), itemBankable, governedSlots: facts.governedSlots, officialItemCount: facts.officialItemCount, blueprintClass: classifyBlueprintSection(facts), classBasis: 'structural facts of BLUEPRINT_GOVERNANCE_INVENTORY.csv', profile: col(row, 'generation_profile') };
});
const certifiedAdapters = new Set(governance.adapters.filter(governanceEligible).map((d) => d.objectId));
const systems = systemCoverage(V52_ASSESSMENT_REGISTRY, sections, supply, certifiedAdapters, demands, SCOPE, live);
const linked = new Set(LIBRARY_BLUEPRINTS.map((b) => b.blueprintId));
const sectionGaps = sections.filter((s) => s.itemBankable).map((s) => {
  const id = `${s.configKey}/${s.sectionKey}`;
  const covered = demands.filter((d) => d.demand.blueprintId === id).reduce((n, d) => n + d.demand.buckets.reduce((m, b) => m + Math.min(b.positions, new Set(supply.filter((i) => i.bucketId === b.bucketId).map((i) => i.recognitionId)).size), 0), 0);
  // a section whose paper is mathematics can be met by parametric cores; anything else needs a passage, a stimulus or a drawing
  // by the paper's own name or syllabus code: mathematics papers (0580 and 9709 are the Cambridge mathematics syllabuses)
  const mathematical = /MAT|MATH|\.0580\.|\.9709\./.test(s.profile);
  return { systemId: s.systemId, blueprintId: id, blueprintClass: s.blueprintClass, governedSlots: s.governedSlots, officialItemCount: s.officialItemCount, slotsWithCertifiedSupply: covered, missing: s.governedSlots - covered, bucketsLinkedToConcepts: linked.has(id), fill: s.governedSlots - covered === 0 ? 'NONE' : mathematical ? 'NEW_CORE_AND_RENDERER_NEEDED' : 'PROVIDER_GENERATION_PROPOSAL' };
});
const plan = gapPlan(blueprintUnits.filter((u) => !u.ready && u.kind === 'BLUEPRINT_BUCKET'), { unrenderedCapacityOf: (u) => capacityCells.filter((c) => (u.conceptId === null || c.conceptId === u.conceptId) && (u.difficultyBand === 'ANY' || c.difficultyBand === u.difficultyBand)).reduce((n, c) => n + c.effectiveDepth, 0) - u.certifiedCapacity, recoverableFor: () => 0, deterministicallyRenderable: () => true });

// ONE consolidated provider proposal for the whole Exam Bank: an ESTIMATE from what the recorded runs cost and
// yielded. Nothing is executed. The order is EXECUTION PRIORITY only -- a sort key of this report, not architecture:
// a system that is not in the list is measured the same way and listed after the ones that are.
const EXECUTION_PRIORITY = ['PAA', 'IB', 'CAMBRIDGE', 'PISA', 'ICFES', 'AICE'];
const priorityOf = (systemId: string): number => { const at = EXECUTION_PRIORITY.indexOf(systemId); return at === -1 ? EXECUTION_PRIORITY.length : at; };
const HISTORY = { candidates: 126, spentUsd: 17.47, evaluated: 83, machineCertified: 27, basis: 'qf5-live-001..006 (assumed prices), docs/audits/QUESTION_BANK_2K_EXECUTION.md' };
const yieldRate = HISTORY.machineCertified / HISTORY.evaluated;
const usdPerCandidate = HISTORY.spentUsd / HISTORY.candidates;
const bySystem = [...new Set(sectionGaps.map((g) => g.systemId))].sort((x, y) => priorityOf(x) - priorityOf(y) || x.localeCompare(y)).map((systemId, i) => {
  const mine = sectionGaps.filter((g) => g.systemId === systemId);
  const providerSlots = mine.filter((g) => g.fill === 'PROVIDER_GENERATION_PROPOSAL').reduce((n, g) => n + g.missing, 0);
  const candidates = Math.ceil((providerSlots * DEMAND_POLICY.repeatabilityTarget) / yieldRate);
  return { priority: i + 1, systemId, governedSlots: mine.reduce((n, g) => n + g.governedSlots, 0), slotsWithCertifiedSupply: mine.reduce((n, g) => n + g.slotsWithCertifiedSupply, 0), slotsForNewDeterministicCores: mine.filter((g) => g.fill === 'NEW_CORE_AND_RENDERER_NEEDED').reduce((n, g) => n + g.missing, 0), slotsThatNeedAProvider: providerSlots, estimatedCandidates: candidates, estimatedCostUsd: Math.round(candidates * usdPerCandidate * 100) / 100 };
});
const provider = {
  GENERATION_AUTHORIZATION: 'NOT_GRANTED', executed: false, plan: 'ONE_CONSOLIDATED_PROPOSAL', slotsThatNeedAProvider: bySystem.reduce((n, x) => n + x.slotsThatNeedAProvider, 0), slotsThatNeedNewDeterministicCores: bySystem.reduce((n, x) => n + x.slotsForNewDeterministicCores, 0),
  estimatedCertificationYield: Math.round(yieldRate * 1000) / 10, estimatedCandidates: bySystem.reduce((n, x) => n + x.estimatedCandidates, 0), estimatedCostUsd: Math.round(bySystem.reduce((n, x) => n + x.estimatedCostUsd, 0) * 100) / 100, bySystemInExecutionPriority: bySystem, basis: HISTORY,
  order: ['1. deterministic cores and renderer envelopes for every slot a parametric construct can fill', '2. recovery of existing inventory once its rights are legitimately established', '3. provider generation, once, for what remains: passages, stimuli, drawn representations'],
  caveats: ['An estimate from six small runs on assumed prices.', 'Generated material is not a deliverable rights state under HUMAN50_POLICY_V1: provider terms and an originality result must be on record first.', 'Generated text is an instance of no core: it must be governed (core, template envelope) before it can be Exam Bank supply.', 'This budget is the Exam Factory budget. Learning and Internal Assessment runtime generation is a different budget and is not in this figure.'],
};

// --------------------------------------------------------------------------------------------- 7. audit stream
const audit = auditSample(supply, {}, PROVISIONAL_AUDIT_POLICY, BATCH_ID);

// ------------------------------------------------------------------------------------------------ artefacts
const slim = (d: { objectType: string; objectId: string; objectVersion: string; contentHash: string; automated: string; humanApproval: unknown; state: string; failed: string[]; checks: { code: string; passed: boolean; detail: string }[] }) => ({ objectType: d.objectType, objectId: d.objectId, objectVersion: d.objectVersion, contentHash: d.contentHash, automated: d.automated, humanApproval: d.humanApproval, state: d.state, failed: d.failed, checks: d.checks });
const governanceOut = {
  kind: 'QF52_GOVERNANCE', policyVersion: HUMAN50_POLICY_VERSION, policyHash: HUMAN50_POLICY_HASH,
  note: 'state = HUMAN_CERTIFIED only where a recorded approval of exactly this content exists and every automated condition also holds. Everything else that passes is AUTOMATED_CERTIFIED_PILOT: no person reviewed it.',
  cores: governance.cores.map(slim), envelopes: governance.envelopes.map(slim), blueprints: governance.blueprints.map(slim),
  adapters: governance.adapters.filter((d) => d.failed[0] !== 'GOVERNED_RULE_PROFILE').map(slim), adaptersWithoutAGovernedRuleProfile: governance.adapters.filter((d) => d.failed[0] === 'GOVERNED_RULE_PROFILE').map((d) => d.objectId),
};
const supplyOut = { kind: 'QF52_CERTIFIED_EXAM_BANK_SUPPLY', itemType: EXAM_BANK_ITEM, scopeOfUse: 'STANDARDIZED_EXAM_CONTENT_ONLY', storage: 'OFFLINE_FILE_ONLY', persistedInAnyDatabase: false, batch: BATCH_ID, policyVersion: HUMAN50_POLICY_VERSION, policyHash: HUMAN50_POLICY_HASH, eligibilityScope: SCOPE, productionEligible: 0, instances: supply.length, rows: supply.map(materialize) };
const final = {
  SCOPE_OF_THIS_BANK: 'STANDARDIZED_EXAM_CONTENT_ONLY (EXAM_BANK_ITEM). Learning and Internal Assessment are supplied elsewhere and are never blocked by it.',
  HUMAN50_POLICY_VERSION, HUMAN50_POLICY_HASH, HUMAN50_REGRESSION: human50Regression,
  GOVERNANCE: { CERTIFIED_CORES: eligibleCount(governance.cores), CERTIFIED_ADAPTERS: eligibleCount(governance.adapters), CERTIFIED_RENDERER_ENVELOPES: eligibleCount(governance.envelopes), GOVERNED_BLUEPRINTS: eligibleCount(governance.blueprints), HUMAN_CERTIFIED_OBJECTS: [...governance.cores, ...governance.adapters, ...governance.envelopes, ...governance.blueprints].filter((d) => d.state === 'HUMAN_CERTIFIED').length, ADAPTERS_REVIEW_REQUIRED: governance.adapters.filter((d) => !governanceEligible(d)).length },
  BATCH: { cells: cells.length, resumedFromCheckpoint: resumed, computed, AUTOMATED_CERTIFIED_PILOT_INSTANCES: supply.length, REVIEW_REQUIRED_INSTANCES: reviewRequiredInstances, REJECTED_INSTANCES: rejectedInstances, PILOT_ELIGIBLE: supply.filter((i) => i.eligibilityScopes.includes('PILOT_PREVIEW')).length, PRODUCTION_ELIGIBLE: supply.filter((i) => (i.eligibilityScopes as string[]).includes('PRODUCTION')).length, byMarking: { answerOnly: supply.filter((i) => !i.markedOnWorking).length, markedOnWorking: supply.filter((i) => i.markedOnWorking).length } },
  RECOVERY: { sources: { HUMAN_50: human50.length, V5_UNSEEN: unseen.length, CANARY: canaryState === 'PROCESSED' ? `${canarySlots} slots (${candidates.filter((c) => c.source === 'CANARY').length} candidates)` : canaryState, DB_LEGACY: 'NOT_PROCESSED: no shared database is read by this run', FIXTURE: fixtures.length }, totals, bySource },
  HOLDOUT: { status: holdout.status, items: holdout.items, setHash: holdout.setHash, machine: holdout.machine },
  CAPACITY: { policy: CAPACITY_POLICY, RAW_VARIANT_CAPACITY: capacity.rawVariantCapacity, DISTINCT_DELIVERABLE_VARIANTS: capacity.distinctDeliverableVariants, RECOGNITION_CLASSES: capacity.recognitionClasses, EFFECTIVE_REPEATABILITY_DEPTH: capacity.effectiveRepeatabilityDepth, CERTIFIED_EXAM_DELIVERY_CAPACITY: capacity.certifiedDeliveryCapacity, TARGET: 2000, TARGET_BLOCKS_LEARNING_OR_INTERNAL_ASSESSMENT: false, SHORTFALL_TO_TARGET: Math.max(0, 2000 - capacity.certifiedDeliveryCapacity), byConcept: capacity.byConcept, byBand: capacity.byBand, largestShareOfOneCorePercent: Math.round(capacity.largestShareOfOneCore * 1000) / 10 },
  EXAM_FLOWS: flows, SUPPLY_BOUNDARY: boundary, PILOT_CRITICAL_GAPS: pilotCriticalGaps.length,
  SYSTEMS: Object.fromEntries(systems.map((s) => [s.systemId, s.readiness])),
  PROVIDER: provider, AUDIT: { policy: PROVISIONAL_AUDIT_POLICY, sampled: audit.length, byStream: audit.reduce<Record<string, number>>((m, a) => { m[a.stream] = (m[a.stream] ?? 0) + 1; return m; }, {}) },
};
const coverageOut = { kind: 'QF52_COVERAGE', scope: SCOPE, demandPolicy: DEMAND_POLICY, capacityPolicy: CAPACITY_POLICY, summary: final, capacityByEnvelope: capacityCells, matrix: coverageMatrix(supply, V52_ASSESSMENT_REGISTRY, SCOPE, live), blueprintDemand: blueprintUnits, systems, sectionGaps, pilotGapPlan: plan };
const recoveryOut = { kind: 'QF52_INVENTORY_RECOVERY', policyVersion: HUMAN50_POLICY_VERSION, sources: final.RECOVERY.sources, totals, bySource, decisions };

const t = (headRow: string[], rows: unknown[][]): string => [`| ${headRow.join(' | ')} |`, `|${headRow.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n');
const report = [
  '# QF V5.2 — Exam Bank: certification, coverage and supply report', '', 'Scope: standardized exam content (`EXAM_BANK_ITEM`). Ordinary Learning and Internal Assessment are supplied dynamically elsewhere; this bank neither supplies nor blocks them.', '',
  `Generated by \`scripts/operations/qf-v52/run.ts\`. Offline: no provider, no database. Policy \`${HUMAN50_POLICY_VERSION}\` (\`${HUMAN50_POLICY_HASH.slice(0, 16)}…\`). Scope: ${SCOPE}. Production-eligible: ${final.BATCH.PRODUCTION_ELIGIBLE}.`, '',
  '## Governed objects', '', t(['Type', 'Object', 'Version', 'Automated', 'Human approval on record', 'State', 'Unmet'], [...governance.cores, ...governance.envelopes, ...governance.blueprints, ...governance.adapters.filter((d) => d.failed[0] !== 'GOVERNED_RULE_PROFILE')].map((d) => [d.objectType, d.objectId, d.objectVersion, d.automated, d.humanApproval ? 'yes' : 'no', d.state, d.failed.join(', ') || '—'])), '',
  `${governanceOut.adaptersWithoutAGovernedRuleProfile.length} further adapters are REVIEW_REQUIRED: they are derived from a generation profile and have no governed rule profile.`, '',
  '## Certified instances (this batch)', '', t(['Cell', 'Attempted', 'Certified', 'Not certified', 'Refused'], cells.map((c) => [c.cell, c.attempted, c.certified.length, c.notCertified.length, c.refusals.length])), '',
  '## Capacity', '', t(['Core', 'Band', 'Item difficulty', 'Raw parameter sets', 'Distinct wordings', 'Recognition classes', `Effective depth (cap ${CAPACITY_POLICY.usefulDepthPerCoreBand})`], capacityCells.map((c) => [c.coreId, c.difficultyBand, c.itemDifficulty, c.rawVariants, c.distinctDeliverable, c.recognitionClasses, c.effectiveDepth])), '',
  `RAW ${capacity.rawVariantCapacity} · DISTINCT ${capacity.distinctDeliverableVariants} · RECOGNITION CLASSES ${capacity.recognitionClasses} · **CERTIFIED EXAM DELIVERY CAPACITY ${capacity.certifiedDeliveryCapacity}** of a 2,000 target (the target blocks neither Learning nor Internal Assessment) · weakest concept × band depth ${capacity.effectiveRepeatabilityDepth} · largest share of one core ${final.CAPACITY.largestShareOfOneCorePercent} %.`, '',
  '## Exam flows, exercised through the Exam Bank authority', '', t(['Flow', 'State'], Object.entries(flows)), '', `Pilot-critical exam demand units not met: ${pilotCriticalGaps.length} of ${pilotCriticalUnits.length}.`, '',
  '## Supply boundary', '', t(['Question', 'Answer'], Object.entries(boundary)), '',
  '## Registered systems', '', t(['System', 'Type', 'Components', 'Certified adapters', 'Bankable sections', 'Governed slots', 'Slots with certified supply', 'Certified cores', 'Readiness', 'Gaps'], [...systems].sort((x, y) => priorityOf(x.systemId) - priorityOf(y.systemId)).map((s) => [s.systemId, s.systemType, s.components, s.componentsWithCertifiedAdapter, s.bankableSections, s.governedSlots, s.slotsWithCertifiedSupply, s.certifiedCores, s.readiness, s.gaps.join('; ')])), '',
  '## Inventory recovery', '', t(['Source', 'Outcomes'], Object.entries(bySource).map(([s, o]) => [s, Object.entries(o as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(', ') || '—'])), '', `Input ${totals.INPUT_ITEMS} · normalised ${totals.NORMALIZED} · DB legacy items were not read (no shared database is opened by this run).`, '',
  '## Human-50 regression (in-sample)', '', t(['Metric', 'Value'], Object.entries(human50Regression)), '',
  '## Holdout', '', `${holdout.items} items frozen (\`${holdout.setHash.slice(0, 16)}…\`): ${JSON.stringify(holdout.machine)}. No human label exists for it.`, '',
  '## One consolidated provider proposal (not authorised, not executed)', '', t(['Priority', 'System', 'Governed slots', 'With certified supply', 'For new deterministic cores', 'Need a provider', 'Estimated candidates', 'Estimated USD'], bySystem.map((x) => [x.priority, x.systemId, x.governedSlots, x.slotsWithCertifiedSupply, x.slotsForNewDeterministicCores, x.slotsThatNeedAProvider, x.estimatedCandidates, x.estimatedCostUsd])), '',
  `Total: ${provider.slotsThatNeedAProvider} slots, about ${provider.estimatedCandidates} candidates, about ${provider.estimatedCostUsd} USD at a ${provider.estimatedCertificationYield} % yield.`, '', ...provider.order.map((c) => `- ${c}`), '', ...provider.caveats.map((c) => `- ${c}`), '',
].join('\n');

const outputs: [string, string][] = [['QF52_GOVERNANCE.json', json(governanceOut)], ['QF52_CERTIFIED_SUPPLY.json', json(supplyOut)], ['QF52_COVERAGE.json', json(coverageOut)], ['QF52_INVENTORY_RECOVERY.json', json(recoveryOut)], ['QF52_HOLDOUT_SHADOW_SET.json', json(holdout)], ['QF52_AUDIT_SAMPLE.json', json({ kind: 'QF52_AUDIT_SAMPLE', policy: PROVISIONAL_AUDIT_POLICY, blind: true, items: audit })], ['QF52_REPORT.md', `${report}\n`]];
if (process.argv.includes('--check')) {
  // resumption counters are a property of the run, not of the result: they are left out of the comparison
  const stable = (name: string, s: string) => (name.endsWith('.json') || name.endsWith('.md') ? s.replace(/"resumedFromCheckpoint": \d+,\s*"computed": \d+,/g, '') : s);
  const stale = outputs.filter(([name, content]) => { try { return stable(name, readFileSync(join(OUT, name), 'utf8')) !== stable(name, content); } catch { return true; } }).map(([name]) => name);
  if (stale.length > 0) { console.error(`QF52_ARTEFACTS_STALE: ${stale.join(', ')}`); process.exit(1); }
  console.log('QF52_ARTEFACTS = CURRENT');
} else {
  mkdirSync(join(OUT, 'run'), { recursive: true });
  writeFileSync(STATE, json(checkpoints));
  for (const [name, content] of outputs) writeFileSync(join(OUT, name), content);
  console.log(JSON.stringify(final, null, 1));
}
