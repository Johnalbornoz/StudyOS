/**
 * QF V5.2 -- EXAM BANK coverage, demand, readiness and capacity (pure, no IO).
 *
 * Coverage is measured against EXAM demand: what a governed blueprint asks for -- exam practice, a reduced mock, a
 * full mock, an exam simulation, the challenge mode. A practice set of ordinary Learning and an Internal Assessment
 * are NOT demand on the Exam Bank: they have their own supply, and nothing here counts them or can block them.
 *
 * Every demand unit says what it requires, what certified capacity exists for it, how many times it can be met
 * without repeating, and exactly what is missing and why.
 *
 * Nothing here lists assessment systems. The systems, their versions and their components are read from the
 * Assessment System Registry; a system registered tomorrow appears in the matrix without a line of this file changing.
 *
 * CAPACITY IS NOT A ROW COUNT. Raw parameter sets, distinct wordings and recognition classes are three numbers, and
 * only the last, capped at a useful depth, is CERTIFIED EXAM DELIVERY CAPACITY.
 */
import type { DifficultyBand } from '@/lib/exam-core/question-bank/quality';
import { bandOf } from '@/lib/exam-core/question-bank/quality';
import type { AssessmentSystemRegistry } from '../assessment-system-registry';
import type { BlueprintClass } from '../blueprint-classification';
import type { LibraryEntry } from '../library/catalogue';
import { bandCapacity, PLANNING_BANDS } from '../library/parametric';
import type { EligibilityScope } from './certification-policy';
import type { BlueprintDemand, CertifiedInstance, LiveGovernance } from './supply-authority';
import { eligibleInstances } from './supply-authority';

export const STUDENT_BANDS: readonly DifficultyBand[] = ['LOW', 'MEDIUM', 'HIGH'];

// ------------------------------------------------------------------------------------------------- the matrix
export interface CoverageCell {
  systemId: string; systemVersionId: string; systemType: string; adapterId: string; subject: string | null; level: string | null; blueprintId: string; blueprintClass: BlueprintClass; bucketId: string; conceptId: string; coreId: string;
  format: string; language: string; itemDifficulty: number; difficultyBand: DifficultyBand; rendererVersion: string; marks: number; calculator: string; eligibilityScope: EligibilityScope; rightsCategory: string; certificationState: string;
  instances: number; recognitionClasses: number;
}
/** One cell per combination that has certified instances, in a scope. The dimensions are the instance's own; the system facts are the registry's. */
export function coverageMatrix(all: readonly CertifiedInstance[], registry: AssessmentSystemRegistry, scope: EligibilityScope, live: LiveGovernance): CoverageCell[] {
  const cells = new Map<string, CoverageCell & { classes: Set<string> }>();
  for (const i of eligibleInstances(all, scope, live)) {
    const adapter = registry.adapter(i.adapterId);
    const key = [i.adapterId, i.bucketId, i.conceptId, i.coreId, i.format, i.language, i.itemDifficulty, i.rendererVersion, i.marks, i.certificationState].join('|');
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        systemId: i.systemId, systemVersionId: i.systemVersionId, systemType: registry.system(i.systemId)?.systemType ?? 'NOT_REGISTERED', adapterId: i.adapterId, subject: adapter?.subject ?? null, level: adapter?.level ?? null, blueprintId: i.blueprintId, blueprintClass: i.blueprintClass,
        bucketId: i.bucketId, conceptId: i.conceptId, coreId: i.coreId, format: i.format, language: i.language, itemDifficulty: i.itemDifficulty, difficultyBand: i.difficultyBand, rendererVersion: i.rendererVersion, marks: i.marks, calculator: i.learner.conditions.calculator,
        eligibilityScope: scope, rightsCategory: i.rightsCategory, certificationState: i.certificationState, instances: 0, recognitionClasses: 0, classes: new Set(),
      };
      cells.set(key, cell);
    }
    cell.instances += 1; cell.classes.add(i.recognitionId); cell.recognitionClasses = cell.classes.size;
  }
  return [...cells.values()].map(({ classes: _c, ...cell }) => cell).sort((x, y) => `${x.adapterId}|${x.bucketId}|${x.coreId}|${x.itemDifficulty}`.localeCompare(`${y.adapterId}|${y.bucketId}|${y.coreId}|${y.itemDifficulty}`));
}

// ------------------------------------------------------------------------------------------------- capacity
/** StudyUs policy, not a fact about any examination: beyond this many distinct instances of one core in one band, more of the same adds no delivery value. */
export const CAPACITY_POLICY = { policyId: 'qf52-capacity', version: '1', usefulDepthPerCoreBand: 30 } as const;
export interface EnvelopeCapacity { coreId: string; conceptId: string; rendererVersion: string; adapterIds: readonly string[]; planningBand: string; itemDifficulty: number; difficultyBand: DifficultyBand; rawVariants: number; distinctDeliverable: number; recognitionClasses: number; effectiveDepth: number }
/** What a certified envelope can supply, band by band, counted once per core however many adapters host it. */
export function envelopeCapacity(entry: LibraryEntry, usefulDepth: number = CAPACITY_POLICY.usefulDepthPerCoreBand): EnvelopeCapacity[] {
  return PLANNING_BANDS.flatMap((band) => {
    const b = entry.envelope.bands.find((x) => x.planningBand === band);
    const studentBand = b ? bandOf(b.itemDifficulty) : null;
    if (!b || !studentBand) return [];
    const c = bandCapacity(entry.construct, band, entry.construct.languages[0]);
    return [{ coreId: entry.core.constructFamilyId, conceptId: entry.core.primaryConceptStableId, rendererVersion: entry.envelope.rendererVersion, adapterIds: entry.envelope.adapterIds, planningBand: band, itemDifficulty: b.itemDifficulty, difficultyBand: studentBand, rawVariants: c.rawVariants, distinctDeliverable: c.distinctDeliverable, recognitionClasses: c.recognitionClasses, effectiveDepth: Math.min(c.recognitionClasses, usefulDepth) }];
  });
}
export interface CapacitySummary { rawVariantCapacity: number; distinctDeliverableVariants: number; recognitionClasses: number; certifiedDeliveryCapacity: number; effectiveRepeatabilityDepth: number; byConcept: Record<string, number>; byBand: Record<DifficultyBand, number>; largestShareOfOneCore: number }
/** The capacity of a set of CERTIFIED envelopes. `effectiveRepeatabilityDepth` is that of the weakest concept x band: a bank is as deep as its shallowest cell. */
export function capacitySummary(cells: readonly EnvelopeCapacity[]): CapacitySummary {
  const sum = (f: (c: EnvelopeCapacity) => number) => cells.reduce((n, c) => n + f(c), 0);
  const byConcept: Record<string, number> = {};
  const byBand: Record<DifficultyBand, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  const byCore: Record<string, number> = {};
  const byCell: Record<string, number> = {};
  for (const c of cells) { byConcept[c.conceptId] = (byConcept[c.conceptId] ?? 0) + c.effectiveDepth; byBand[c.difficultyBand] += c.effectiveDepth; byCore[c.coreId] = (byCore[c.coreId] ?? 0) + c.effectiveDepth; byCell[`${c.conceptId}|${c.difficultyBand}`] = (byCell[`${c.conceptId}|${c.difficultyBand}`] ?? 0) + c.effectiveDepth; }
  const total = sum((c) => c.effectiveDepth);
  return { rawVariantCapacity: sum((c) => c.rawVariants), distinctDeliverableVariants: sum((c) => c.distinctDeliverable), recognitionClasses: sum((c) => c.recognitionClasses), certifiedDeliveryCapacity: total, effectiveRepeatabilityDepth: cells.length ? Math.min(...Object.values(byCell)) : 0, byConcept, byBand, largestShareOfOneCore: total ? Math.max(...Object.values(byCore)) / total : 0 };
}

// --------------------------------------------------------------------------------------------------- demand
/** What exam delivery asks for. StudyUs policy; every number is here and nowhere else. */
export const DEMAND_POLICY = { policyId: 'qf52-exam-demand', version: '2', challengeMinimumHigh: 5, repeatabilityTarget: 3 } as const;
/** Exam demand only. PRACTICE and AD_HOC are not kinds of demand on the Exam Bank. */
export const DEMAND_KINDS = ['EXAM_PRACTICE', 'REDUCED_MOCK', 'FULL_MOCK', 'EXAM_SIMULATION', 'CHALLENGE', 'BLUEPRINT_BUCKET'] as const;
export type DemandKind = (typeof DEMAND_KINDS)[number];
export interface DemandUnit {
  kind: DemandKind; systemId: string | null; adapterId: string | null; blueprintId: string | null; bucketId: string | null; conceptId: string | null; difficultyBand: DifficultyBand | 'ANY';
  required: number; certifiedCapacity: number; repeatabilityDepth: number; coverageRatio: number; missing: number; ready: boolean; blockingReason: string | null;
}
const unit = (u: Omit<DemandUnit, 'repeatabilityDepth' | 'coverageRatio' | 'missing' | 'ready' | 'blockingReason'>, blockingWhenShort: string, hardBlock: string | null = null): DemandUnit => {
  const ready = hardBlock === null && u.certifiedCapacity >= u.required;
  return { ...u, repeatabilityDepth: u.required > 0 ? Math.floor(u.certifiedCapacity / u.required) : 0, coverageRatio: u.required > 0 ? Math.min(1, u.certifiedCapacity / u.required) : 0, missing: Math.max(0, u.required - u.certifiedCapacity), ready, blockingReason: ready ? null : hardBlock ?? blockingWhenShort };
};
const classes = (list: readonly CertifiedInstance[]): number => new Set(list.map((i) => i.recognitionId)).size;

/** The demand of a governed blueprint: each bucket, exam practice, a reduced mock, a full mock, an exam simulation and the challenge mode. */
export function blueprintDemand(all: readonly CertifiedInstance[], demand: BlueprintDemand, systemId: string, scope: EligibilityScope, live: LiveGovernance): DemandUnit[] {
  const eligible = eligibleInstances(all, scope, live).filter((i) => i.blueprintId === demand.blueprintId && i.blueprintVersion === demand.blueprintVersion && i.adapterId === demand.adapterId);
  const head = { systemId, adapterId: demand.adapterId, blueprintId: demand.blueprintId, conceptId: null, difficultyBand: 'ANY' as const };
  const perBucket = demand.buckets.map((b) => ({ b, capacity: classes(eligible.filter((i) => i.bucketId === b.bucketId)) }));
  const out = perBucket.map(({ b, capacity }) => unit({ ...head, kind: 'BLUEPRINT_BUCKET', bucketId: b.bucketId, required: b.positions, certifiedCapacity: capacity }, capacity === 0 ? 'BUCKET_EMPTY' : 'BUCKET_BELOW_BLUEPRINT'));
  const positions = demand.buckets.reduce((n, b) => n + b.positions, 0);
  const filled = perBucket.reduce((n, x) => n + Math.min(x.capacity, x.b.positions), 0);
  const emptyBuckets = perBucket.filter((x) => x.capacity === 0).length;
  const classOk = (allowed: readonly BlueprintClass[]) => (allowed.includes(demand.blueprintClass) ? null : `BLUEPRINT_IS_${demand.blueprintClass}`);
  out.push(unit({ ...head, kind: 'EXAM_PRACTICE', bucketId: null, required: demand.buckets.length, certifiedCapacity: demand.buckets.length - emptyBuckets }, 'PRACTICE_BUCKET_EMPTY', classOk(['FULL', 'ALIGNED', 'REDUCED'])));
  out.push(unit({ ...head, kind: 'REDUCED_MOCK', bucketId: null, required: positions, certifiedCapacity: filled }, 'BUCKET_BELOW_BLUEPRINT', classOk(['FULL', 'REDUCED'])));
  // a full mock needs the full official form governed: no depth of supply makes a reduced blueprint a full one
  for (const kind of ['FULL_MOCK', 'EXAM_SIMULATION'] as const) out.push(unit({ ...head, kind, bucketId: null, required: positions, certifiedCapacity: filled }, 'BUCKET_BELOW_BLUEPRINT', demand.blueprintClass === 'FULL' ? null : 'FULL_FORM_BLUEPRINT_NOT_GOVERNED'));
  const high = eligible.filter((i) => i.difficultyBand === 'HIGH');
  const bucketsWithHigh = demand.buckets.filter((b) => high.some((i) => i.bucketId === b.bucketId)).length;
  out.push(unit({ ...head, kind: 'CHALLENGE', bucketId: null, difficultyBand: 'HIGH', required: DEMAND_POLICY.challengeMinimumHigh, certifiedCapacity: classes(high) }, 'CHALLENGE_POOL_TOO_SMALL', bucketsWithHigh === demand.buckets.length ? null : 'BUCKET_WITHOUT_A_HIGH_ITEM'));
  return out;
}

// ------------------------------------------------------------------------------------------------- readiness
export type Readiness = 'READY' | 'PARTIAL' | 'NOT_READY';
/** READY: every unit is met. NOT_READY: none is. PARTIAL: some are. NOT_READY is never reported as anything else. */
export const readinessOfUnits = (units: readonly DemandUnit[]): Readiness => (units.length === 0 ? 'NOT_READY' : units.every((u) => u.ready) ? 'READY' : units.some((u) => u.ready) ? 'PARTIAL' : 'NOT_READY');

export interface SystemBlueprintSection { systemId: string; configKey: string; sectionKey: string; itemBankable: boolean; governedSlots: number; officialItemCount: number | null; blueprintClass: BlueprintClass | null; classBasis: string }
export interface SystemCoverage {
  systemId: string; systemType: string; versions: string[]; components: number; componentsWithCertifiedAdapter: number; bankableSections: number; governedSlots: number; classifiedSections: Record<string, number>; certifiedCores: number; certifiedInstances: number;
  certifiedCapacity: number; byBand: Record<DifficultyBand, number>; formats: string[]; rightsCategories: string[]; slotsWithCertifiedSupply: number; readiness: Readiness; gaps: string[];
}
/**
 * Readiness of every REGISTERED system, from the registry, its blueprint sections and the certified inventory.
 * A system is READY when every governed slot of its bankable sections has certified supply; PARTIAL when some has.
 */
export function systemCoverage(registry: AssessmentSystemRegistry, sections: readonly SystemBlueprintSection[], all: readonly CertifiedInstance[], certifiedAdapterIds: ReadonlySet<string>, demands: readonly { systemId: string; demand: BlueprintDemand }[], scope: EligibilityScope, live: LiveGovernance): SystemCoverage[] {
  const eligible = eligibleInstances(all, scope, live);
  return registry.systems().map((system) => {
    const versions = registry.versions(system.systemId);
    const adapters = registry.adapters().filter((a) => a.systemId === system.systemId);
    const mine = eligible.filter((i) => i.systemId === system.systemId);
    const secs = sections.filter((s) => s.systemId === system.systemId);
    const bankable = secs.filter((s) => s.itemBankable);
    const slots = bankable.reduce((n, s) => n + s.governedSlots, 0);
    const covered = demands.filter((d) => d.systemId === system.systemId).reduce((n, d) => n + d.demand.buckets.reduce((m, b) => m + Math.min(b.positions, classes(mine.filter((i) => i.bucketId === b.bucketId && i.blueprintId === d.demand.blueprintId))), 0), 0);
    const byBand: Record<DifficultyBand, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    for (const band of STUDENT_BANDS) byBand[band] = classes(mine.filter((i) => i.difficultyBand === band));
    const classified: Record<string, number> = {};
    for (const s of secs) classified[s.blueprintClass ?? 'UNCLASSIFIED'] = (classified[s.blueprintClass ?? 'UNCLASSIFIED'] ?? 0) + 1;
    const gaps: string[] = [];
    if (adapters.length === 0) gaps.push('NO_ADAPTER_REGISTERED');
    if (!adapters.some((a) => certifiedAdapterIds.has(a.adapterId))) gaps.push(`NO_CERTIFIED_ADAPTER (${adapters.length} registered)`);
    if (new Set(mine.map((i) => i.coreId)).size === 0) gaps.push('NO_CERTIFIED_CORE_WITH_APPLICABILITY');
    if (slots - covered > 0) gaps.push(`${slots - covered} of ${slots} governed slots have no certified supply`);
    if (bankable.some((s) => s.blueprintClass === null)) gaps.push(`${bankable.filter((s) => s.blueprintClass === null).length} bankable sections are not classified with bucket links`);
    return {
      systemId: system.systemId, systemType: system.systemType, versions: versions.map((v) => `${v.versionId} (${v.lifecycle})`), components: adapters.length, componentsWithCertifiedAdapter: adapters.filter((a) => certifiedAdapterIds.has(a.adapterId)).length, bankableSections: bankable.length,
      governedSlots: slots, classifiedSections: classified, certifiedCores: new Set(mine.map((i) => i.coreId)).size, certifiedInstances: mine.length, certifiedCapacity: classes(mine), byBand, formats: [...new Set(mine.map((i) => i.format))].sort(), rightsCategories: [...new Set(mine.map((i) => i.rightsCategory))].sort(),
      slotsWithCertifiedSupply: covered, readiness: mine.length === 0 ? 'NOT_READY' : slots > 0 && covered >= slots ? 'READY' : 'PARTIAL', gaps,
    };
  });
}

// ------------------------------------------------------------------------------------------------ gap filling
export type GapFill = 'RENDER_DETERMINISTIC_CAPACITY' | 'RECOVER_EXISTING_INVENTORY' | 'NEW_CORE_AND_RENDERER_NEEDED' | 'PROVIDER_GENERATION_PROPOSAL';
export interface GapPlanLine { unit: DemandUnit; fill: GapFill; detail: string }
/**
 * How a gap is filled, in the only permitted order: certified deterministic capacity first, recoverable existing
 * inventory second, a new core and renderer third, and a provider only for what none of those can supply.
 * A provider is never proposed because "more questions" are wanted: only against a named, governed gap.
 */
export function gapPlan(units: readonly DemandUnit[], facts: { unrenderedCapacityOf(u: DemandUnit): number; recoverableFor(u: DemandUnit): number; deterministicallyRenderable(u: DemandUnit): boolean }): GapPlanLine[] {
  return units.filter((u) => !u.ready && u.missing > 0).map((u) => {
    if (facts.unrenderedCapacityOf(u) >= u.missing) return { unit: u, fill: 'RENDER_DETERMINISTIC_CAPACITY', detail: `${facts.unrenderedCapacityOf(u)} certified deterministic instances are available and not yet rendered` };
    if (facts.recoverableFor(u) >= u.missing) return { unit: u, fill: 'RECOVER_EXISTING_INVENTORY', detail: `${facts.recoverableFor(u)} recoverable existing items` };
    if (facts.deterministicallyRenderable(u)) return { unit: u, fill: 'NEW_CORE_AND_RENDERER_NEEDED', detail: 'the construct needs no drawing and no free text: a parametric core can be written' };
    return { unit: u, fill: 'PROVIDER_GENERATION_PROPOSAL', detail: 'needs a stimulus, a passage or a drawn representation no deterministic renderer supplies' };
  });
}
