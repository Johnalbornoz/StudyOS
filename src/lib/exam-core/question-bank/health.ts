/**
 * Question Bank Factory -- BANK HEALTH and READINESS (pure, deterministic).
 *
 * Bank health is NOT Student readiness. For every blueprint cell it counts the
 * current item versions by lifecycle, compares the eligible ones with the
 * configurable targets and the form requirement, and gives one state:
 *
 *   EMPTY         no usable content at all                         -> P0
 *   INSUFFICIENT  cannot fill its positions of one full form        -> P1 (form blocker)
 *   FORM_READY    fills one full form, no second disjoint one       -> P2
 *   VARIETY_LOW   more than one form, below the variety target      -> P2
 *   HEALTHY       variety target met, too little field evidence     -> P3 (no generation: calibration)
 *   CALIBRATED    variety met with enough calibrated items          -> P4
 *
 * READINESS is proved by ASSEMBLING forms with the existing engine
 * (`assembleForm`), never by counting a total: 200 mathematics items cannot
 * compensate for zero reading items, a retired item cannot enter, a PILOT item
 * never enters a mock. FULL_MOCK_READY additionally needs the full-length form
 * to be DELIVERABLE by the engine (a governed full-length blueprint) and the
 * minimum diversity policy; FULL_MOCK_CALIBRATED uses only items with enough
 * field evidence.
 */
import { assembleForm, type FormPosition, type PoolItem } from '../form-assembly';
import { DEFAULT_ELIGIBILITY, isEligible, type CalibrationConfidence, type DeliveryUse, type EligibilityPolicy, type LifecycleState, effectiveLifecycle } from './lifecycle';
import { cellTargets, DEFAULT_REUSE_POLICY, countsAsOfficial, type CellTargetOverride, type CellTargets, type Provenance, type ReusePolicy } from './policy';
import type { BlueprintCell, ComponentInput, LengthBasis } from './cells';
import type { UnitPolicy } from './adapters';

export const HEALTH_ENGINE_VERSION = 'qb-health-v1';

export type CellHealthState = 'EMPTY' | 'INSUFFICIENT' | 'FORM_READY' | 'VARIETY_LOW' | 'HEALTHY' | 'CALIBRATED';
export type GapPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';

/** One CURRENT item version, as the health engine sees it (no content, no key). */
export interface BankItemFact {
  versionId: string;
  bankItemId: string;
  learningObjectiveId: string;
  questionType: string | null;
  difficulty: number;
  difficultyIndex: number | null;
  marks: number;
  templateFingerprint: string | null;
  semanticFingerprint: string | null;
  stimulusKey: string | null;
  provenance: Provenance;
  lifecycle: LifecycleState | null;
  status: string;
  isCurrentVersion: boolean;
  retired: boolean;
  calibrationConfidence: CalibrationConfidence | null;
  /** V2 quality metadata (NULL / absent = legacy row = every use). */
  usage?: readonly string[] | null;
  alignment?: string | null;
  validatedDifficulty?: number | null;
}

export interface QueueFact {
  cellKey: string;
  status: 'PENDING' | 'RUNNING';
  requestedCount: number;
}

export interface CellCounts {
  total: number;
  validating: number;
  validated: number;
  pilot: number;
  active: number;
  calibrated: number;
  reviewRequired: number;
  suspended: number;
  rejected: number;
  retired: number;
  /** PILOT + CALIBRATED + ACTIVE usable in practice. */
  practiceEligible: number;
  /** ACTIVE + CALIBRATED usable in a mock (after the unit policy). */
  mockEligible: number;
  /** Mock-eligible with enough field evidence. */
  calibratedEligible: number;
  /** Distinct stimulus units among the mock-eligible items (items without a stimulus count as their own unit). */
  distinctUnits: number;
  official: number;
}

export interface CellHealth {
  cellKey: string;
  sectionKey: string;
  componentName: string;
  objectiveCode: string;
  objectiveDescription: string | null;
  questionType: string | null;
  difficultyRange: { min: number; max: number } | null;
  reducedPositions: number;
  fullPositions: number;
  lengthBasis: LengthBasis;
  counts: CellCounts;
  queued: number;
  targets: CellTargets;
  state: CellHealthState;
  priority: GapPriority;
  /** Cannot fill even the governed (reduced) form. */
  reducedBlocker: boolean;
  /** Items still missing to reach the variety target (eligible items only). */
  deficit: number;
  /** Items to generate now: deficit minus what is already piloting / validating / queued (0 for P3/P4 or above the cap). */
  generationNeed: number;
  calibrationConfidence: CalibrationConfidence;
}

export interface ComponentAssembly {
  componentId: string;
  sectionKey: string;
  simulationCapable: boolean;
  lengthBasis: LengthBasis;
  practice: boolean;
  reducedAssembles: boolean;
  fullAssembles: boolean;
  fullCalibratedAssembles: boolean;
  /** Distinct full forms under the reuse policy (0..maxFormsProbed). */
  fullFormCapacity: number;
  reducedFormCapacity: number;
  officialItemCount: number | null;
  reducedPositions: number;
  fullPositions: number;
}

export interface ReadinessGate {
  ready: boolean;
  reasons: string[];
}

export interface BankReadiness {
  structure: boolean;
  practice: ReadinessGate;
  reducedMock: ReadinessGate;
  /** Technical: the bank can assemble a complete valid full-length form AND the engine can deliver it. */
  fullMock: ReadinessGate & { bankAssembles: boolean; deliverable: boolean };
  fullMockCalibrated: ReadinessGate;
  formCapacity: { reduced: number; full: number };
}

export interface BankHealth {
  engineVersion: string;
  totals: {
    items: number;
    active: number;
    pilot: number;
    calibrated: number;
    validated: number;
    validating: number;
    reviewRequired: number;
    suspended: number;
    rejected: number;
    retired: number;
    byProvenance: Record<Provenance, number>;
    cells: number;
    cellsEmpty: number;
    cellsFormBlocking: number;
    queued: number;
  };
  /** Share of mock-eligible items that are OFFICIAL / LICENSED (0 unless such content was really added). */
  officialContentCoverage: number;
  cells: CellHealth[];
  components: ComponentAssembly[];
  readiness: BankReadiness;
}

export interface BankHealthInput {
  cells: BlueprintCell[];
  components: ComponentInput[];
  items: BankItemFact[];
  queue: QueueFact[];
  targetOverrides?: { versionDefault: CellTargetOverride | null; byCell: Record<string, CellTargetOverride> };
  unitPolicy: UnitPolicy;
  eligibility?: EligibilityPolicy;
  reuse?: ReusePolicy;
  /** Minimum distinct full forms before FULL_MOCK_READY (diversity policy). */
  minDistinctFullForms?: number;
}

const ZERO_PROVENANCE = (): Record<Provenance, number> => ({ OFFICIAL: 0, LICENSED: 0, STUDYUS_GENERATED: 0, FIXTURE: 0 });

export function itemMatchesCell(item: Pick<BankItemFact, 'learningObjectiveId' | 'questionType' | 'difficulty'>, cell: Pick<BlueprintCell, 'learningObjectiveId' | 'questionType' | 'difficultyRange'>): boolean {
  if (item.learningObjectiveId !== cell.learningObjectiveId) return false;
  if (cell.questionType && item.questionType !== cell.questionType) return false;
  if (cell.difficultyRange && (item.difficulty < cell.difficultyRange.min || item.difficulty > cell.difficultyRange.max)) return false;
  return true;
}

/** Items eligible for a use, after the family's unit policy (a unit with too few eligible items cannot be delivered as a unit). */
export function eligiblePool(items: BankItemFact[], use: DeliveryUse, unitPolicy: UnitPolicy, policy: EligibilityPolicy = DEFAULT_ELIGIBILITY): BankItemFact[] {
  const eligible = items.filter((i) => isEligible(i, use, policy));
  if (unitPolicy.mode !== 'UNIT') return eligible;
  const perUnit = new Map<string, number>();
  for (const i of eligible) if (i.stimulusKey) perUnit.set(i.stimulusKey, (perUnit.get(i.stimulusKey) ?? 0) + 1);
  return eligible.filter((i) => !i.stimulusKey || (perUnit.get(i.stimulusKey) ?? 0) >= unitPolicy.minItemsPerUnit);
}

function toPool(items: BankItemFact[]): PoolItem[] {
  return items.map((i) => ({
    id: i.versionId,
    learningObjectiveId: i.learningObjectiveId,
    questionType: i.questionType,
    difficulty: i.difficulty,
    difficultyIndex: i.difficultyIndex,
    marks: i.marks,
    templateFingerprint: i.templateFingerprint,
    semanticFingerprint: i.semanticFingerprint,
    stimulusKey: i.stimulusKey,
    contentOrigin: i.provenance,
  }));
}

function positionsFor(cells: BlueprintCell[], length: 'REDUCED' | 'FULL'): FormPosition[] {
  const out: FormPosition[] = [];
  for (const c of cells) {
    const n = length === 'FULL' ? c.fullPositions : c.reducedPositions;
    for (let k = 0; k < n; k++) {
      out.push({ index: out.length, blueprintObjectiveTargetId: `${c.cellKey}#${k}`, assessmentComponentId: c.componentId, learningObjectiveId: c.learningObjectiveId, questionType: c.questionType, difficultyRange: c.difficultyRange });
    }
  }
  return out;
}

/** Can the engine assemble a complete form of these cells from this pool? `requireOfficialSize` also checks the published size. */
export function canAssemble(cells: BlueprintCell[], components: ComponentInput[], pool: BankItemFact[], length: 'REDUCED' | 'FULL', seed: string, exclude: Set<string> = new Set()): { complete: boolean; unfilled: number; usedIds: string[]; sizeMet: boolean } {
  const positions = positionsFor(cells, length);
  if (positions.length === 0) return { complete: false, unfilled: 0, usedIds: [], sizeMet: false };
  const form = assembleForm({
    seed,
    mode: 'MOCK',
    practiceLevel: null,
    positions,
    pool: toPool(pool.filter((p) => !exclude.has(p.versionId))),
    usage: { approvedItemIds: new Set(), templateFingerprints: new Set() },
    officialMarksByComponent: Object.fromEntries(components.map((c) => [c.id, c.maxMarks])),
    officialItemsByComponent: Object.fromEntries(components.map((c) => [c.id, c.officialItemCount])),
  });
  const unfilled = form.slots.filter((s) => !s.approvedItemId).length;
  return { complete: unfilled === 0, unfilled, usedIds: form.slots.map((s) => s.approvedItemId).filter((x): x is string => !!x), sizeMet: form.fidelity === 'FULL' };
}

/** Distinct forms the pool supports, each sharing at most `maxOverlap` of its positions with earlier forms. */
export function formCapacity(cells: BlueprintCell[], components: ComponentInput[], pool: BankItemFact[], length: 'REDUCED' | 'FULL', reuse: ReusePolicy): number {
  const positions = positionsFor(cells, length).length;
  if (positions === 0) return 0;
  const allowance = Math.floor(reuse.maxOverlapBetweenFullForms * positions);
  const used = new Set<string>();
  let forms = 0;
  for (let k = 0; k < reuse.maxFormsProbed; k++) {
    const fresh = canAssemble(cells, components, pool, length, `capacity:${k}`, used);
    if (fresh.complete) {
      fresh.usedIds.forEach((id) => used.add(id));
      forms += 1;
      continue;
    }
    if (fresh.unfilled > allowance) break;
    // Fill the few missing positions with already-used items (allowed overlap).
    const withReuse = canAssemble(cells, components, pool, length, `capacity:${k}:reuse`);
    if (!withReuse.complete) break;
    withReuse.usedIds.forEach((id) => used.add(id));
    forms += 1;
  }
  return forms;
}

function cellState(c: { practiceEligible: number; mockEligible: number; calibratedEligible: number; distinctUnits: number }, fullPositions: number, t: CellTargets, unitMode: boolean): CellHealthState {
  if (c.practiceEligible === 0) return 'EMPTY';
  if (c.mockEligible < fullPositions) return 'INSUFFICIENT';
  if (c.mockEligible < 2 * fullPositions || (unitMode && c.distinctUnits < 2)) return 'FORM_READY';
  if (c.mockEligible < t.desired) return 'VARIETY_LOW';
  if (c.calibratedEligible < t.minCalibrated) return 'HEALTHY';
  return 'CALIBRATED';
}

const PRIORITY: Record<CellHealthState, GapPriority> = { EMPTY: 'P0', INSUFFICIENT: 'P1', FORM_READY: 'P2', VARIETY_LOW: 'P2', HEALTHY: 'P3', CALIBRATED: 'P4' };
const PRIORITY_ORDER: GapPriority[] = ['P0', 'P1', 'P2', 'P3', 'P4'];

export function computeBankHealth(input: BankHealthInput): BankHealth {
  const eligibility = input.eligibility ?? DEFAULT_ELIGIBILITY;
  const reuse = input.reuse ?? DEFAULT_REUSE_POLICY;
  const unitMode = input.unitPolicy.mode === 'UNIT';
  const current = input.items.filter((i) => i.isCurrentVersion);
  const practicePool = eligiblePool(current, 'PRACTICE', input.unitPolicy, eligibility);
  const reducedPool = eligiblePool(current, 'REDUCED_MOCK', input.unitPolicy, eligibility);
  const fullPool = eligiblePool(current, 'FULL_MOCK', input.unitPolicy, eligibility);
  const calibratedPool = eligiblePool(current, 'FULL_MOCK_CALIBRATED', input.unitPolicy, eligibility);
  const inSet = (pool: BankItemFact[]) => new Set(pool.map((p) => p.versionId));
  const practiceIds = inSet(practicePool);
  const mockIds = inSet(fullPool);
  const calibratedIds = inSet(calibratedPool);
  const queuedByCell = new Map<string, number>();
  for (const q of input.queue) queuedByCell.set(q.cellKey, (queuedByCell.get(q.cellKey) ?? 0) + q.requestedCount);

  const cells: CellHealth[] = input.cells.map((cell) => {
    const mine = current.filter((i) => itemMatchesCell(i, cell));
    const lc = (i: BankItemFact) => (i.retired ? 'RETIRED' : effectiveLifecycle(i));
    const counts: CellCounts = {
      total: mine.length,
      validating: mine.filter((i) => ['DRAFT_AI', 'VALIDATING'].includes(lc(i) ?? '')).length,
      validated: mine.filter((i) => lc(i) === 'VALIDATED').length,
      pilot: mine.filter((i) => lc(i) === 'PILOT').length,
      active: mine.filter((i) => lc(i) === 'ACTIVE').length,
      calibrated: mine.filter((i) => lc(i) === 'CALIBRATED').length,
      reviewRequired: mine.filter((i) => ['REVIEW_REQUIRED', 'REPAIR_REQUIRED'].includes(lc(i) ?? '')).length,
      suspended: mine.filter((i) => lc(i) === 'SUSPENDED').length,
      rejected: mine.filter((i) => lc(i) === 'REJECTED').length,
      retired: mine.filter((i) => lc(i) === 'RETIRED').length,
      practiceEligible: mine.filter((i) => practiceIds.has(i.versionId)).length,
      mockEligible: mine.filter((i) => mockIds.has(i.versionId)).length,
      calibratedEligible: mine.filter((i) => calibratedIds.has(i.versionId)).length,
      distinctUnits: new Set(mine.filter((i) => mockIds.has(i.versionId)).map((i) => i.stimulusKey ?? i.versionId)).size,
      official: mine.filter((i) => mockIds.has(i.versionId) && countsAsOfficial(i.provenance)).length,
    };
    const targets = cellTargets(cell.fullPositions, input.targetOverrides?.versionDefault ?? null, input.targetOverrides?.byCell[cell.cellKey] ?? null);
    const state = cellState(counts, cell.fullPositions, targets, unitMode);
    const priority = PRIORITY[state];
    const queued = queuedByCell.get(cell.cellKey) ?? 0;
    const deficit = Math.max(0, targets.desired - counts.mockEligible);
    const inPipeline = counts.pilot + counts.validating + counts.validated + queued;
    const allowed = PRIORITY_ORDER.indexOf(priority) <= PRIORITY_ORDER.indexOf(targets.maxGenerationPriority) && priority !== 'P3' && priority !== 'P4';
    const confidence: CalibrationConfidence = counts.calibratedEligible >= targets.minCalibrated && counts.mockEligible > 0 ? 'MODERATE_CONFIDENCE' : counts.calibratedEligible > 0 ? 'EARLY_SIGNAL' : 'INSUFFICIENT_DATA';
    return {
      cellKey: cell.cellKey,
      sectionKey: cell.sectionKey,
      componentName: cell.componentName,
      objectiveCode: cell.objectiveCode,
      objectiveDescription: cell.objectiveDescription,
      questionType: cell.questionType,
      difficultyRange: cell.difficultyRange,
      reducedPositions: cell.reducedPositions,
      fullPositions: cell.fullPositions,
      lengthBasis: cell.lengthBasis,
      counts,
      queued,
      targets,
      state,
      priority,
      reducedBlocker: counts.mockEligible < cell.reducedPositions,
      deficit,
      generationNeed: allowed ? Math.max(0, deficit - inPipeline) : 0,
      calibrationConfidence: confidence,
    };
  });

  // ---- assembly per component (sections are independent: their objectives never overlap) ----
  const components: ComponentAssembly[] = input.components
    .filter((comp) => input.cells.some((c) => c.componentId === comp.id))
    .map((comp) => {
      const cc = input.cells.filter((c) => c.componentId === comp.id);
      const healthOf = cells.filter((h) => cc.some((c) => c.cellKey === h.cellKey));
      const basis = cc[0].lengthBasis;
      const reduced = comp.simulationCapable && canAssemble(cc, [comp], reducedPool, 'REDUCED', `reduced:${comp.id}`).complete;
      const full = comp.simulationCapable && basis !== 'UNKNOWN' && (() => {
        const r = canAssemble(cc, [comp], fullPool, 'FULL', `full:${comp.id}`);
        return r.complete && r.sizeMet;
      })();
      const fullCal = comp.simulationCapable && basis !== 'UNKNOWN' && (() => {
        const r = canAssemble(cc, [comp], calibratedPool, 'FULL', `fullcal:${comp.id}`);
        return r.complete && r.sizeMet;
      })();
      return {
        componentId: comp.id,
        sectionKey: comp.sectionKey,
        simulationCapable: comp.simulationCapable,
        lengthBasis: basis,
        practice: comp.simulationCapable && healthOf.every((h) => h.counts.practiceEligible >= 1),
        reducedAssembles: reduced,
        fullAssembles: full,
        fullCalibratedAssembles: fullCal,
        fullFormCapacity: full ? formCapacity(cc, [comp], fullPool, 'FULL', reuse) : 0,
        reducedFormCapacity: reduced ? formCapacity(cc, [comp], reducedPool, 'REDUCED', reuse) : 0,
        officialItemCount: comp.officialItemCount,
        reducedPositions: cc.reduce((n, c) => n + c.reducedPositions, 0),
        fullPositions: cc.reduce((n, c) => n + c.fullPositions, 0),
      };
    });

  const readiness = readinessFrom(cells, components, input.minDistinctFullForms ?? 1);
  const byProvenance = ZERO_PROVENANCE();
  for (const i of current) byProvenance[i.provenance] += 1;
  const lcAll = (s: string) => current.filter((i) => !i.retired && effectiveLifecycle(i) === s).length;
  const mockEligibleTotal = fullPool.length;
  return {
    engineVersion: HEALTH_ENGINE_VERSION,
    totals: {
      items: current.length,
      active: lcAll('ACTIVE'),
      pilot: lcAll('PILOT'),
      calibrated: lcAll('CALIBRATED'),
      validated: lcAll('VALIDATED'),
      validating: lcAll('DRAFT_AI') + lcAll('VALIDATING'),
      reviewRequired: lcAll('REVIEW_REQUIRED') + lcAll('REPAIR_REQUIRED'),
      suspended: lcAll('SUSPENDED'),
      rejected: lcAll('REJECTED'),
      retired: current.filter((i) => i.retired || effectiveLifecycle(i) === 'RETIRED').length,
      byProvenance,
      cells: cells.length,
      cellsEmpty: cells.filter((c) => c.state === 'EMPTY').length,
      cellsFormBlocking: cells.filter((c) => c.state === 'EMPTY' || c.state === 'INSUFFICIENT').length,
      queued: [...queuedByCell.values()].reduce((a, b) => a + b, 0),
    },
    officialContentCoverage: mockEligibleTotal > 0 ? fullPool.filter((i) => countsAsOfficial(i.provenance)).length / mockEligibleTotal : 0,
    cells,
    components,
    readiness,
  };
}

function cellReason(c: CellHealth, need: number, have: number): string {
  return `${c.componentName} · ${c.objectiveCode}: ${have}/${need} (faltan ${need - have})`;
}

/** Readiness of a set of components (a full test, an area, a paper). The weakest component decides. */
export function readinessFrom(cells: CellHealth[], components: ComponentAssembly[], minDistinctFullForms = 1): BankReadiness {
  const structure = components.length > 0;
  const notCapable = components.filter((c) => !c.simulationCapable).map((c) => `${c.sectionKey}: componente no simulable`);
  const practiceReasons = [...notCapable, ...cells.filter((c) => c.counts.practiceEligible === 0).map((c) => cellReason(c, 1, 0))];
  const reducedReasons = [...notCapable, ...cells.filter((c) => c.counts.mockEligible < c.reducedPositions).map((c) => cellReason(c, c.reducedPositions, c.counts.mockEligible))];
  const reducedOk = structure && components.every((c) => c.reducedAssembles);
  if (structure && !reducedOk && reducedReasons.length === 0) reducedReasons.push('ensamblaje del formulario reducido imposible (restricciones de plantilla / unidad)');

  const unknown = components.filter((c) => c.lengthBasis === 'UNKNOWN').map((c) => `${c.sectionKey}: longitud oficial no publicada`);
  const fullCellReasons = cells.filter((c) => c.counts.mockEligible < c.fullPositions).map((c) => cellReason(c, c.fullPositions, c.counts.mockEligible));
  const bankAssembles = structure && components.every((c) => c.fullAssembles);
  const deliverable = structure && components.every((c) => c.lengthBasis === 'BLUEPRINT_IS_FULL');
  const capacity = components.length ? Math.min(...components.map((c) => c.fullFormCapacity)) : 0;
  const diversityOk = capacity >= minDistinctFullForms;
  const fullReasons = [...notCapable, ...unknown, ...fullCellReasons];
  if (structure && !bankAssembles && fullReasons.length === 0) fullReasons.push('ensamblaje del formulario completo imposible (restricciones de plantilla / unidad)');
  if (bankAssembles && !deliverable) fullReasons.push('el blueprint gobernado es reducido: falta una versión de blueprint de longitud completa para entregarlo');
  if (bankAssembles && !diversityOk) fullReasons.push(`diversidad mínima no alcanzada (${capacity}/${minDistinctFullForms} formularios distintos)`);
  const fullOk = bankAssembles && deliverable && diversityOk;

  const calReasons = cells.filter((c) => c.counts.calibratedEligible < c.fullPositions).map((c) => cellReason(c, c.fullPositions, c.counts.calibratedEligible));
  const calOk = fullOk && components.every((c) => c.fullCalibratedAssembles);
  if (!fullOk) calReasons.unshift('FULL_MOCK_READY = NO');
  return {
    structure,
    practice: { ready: structure && components.every((c) => c.practice), reasons: practiceReasons },
    reducedMock: { ready: reducedOk, reasons: reducedOk ? [] : reducedReasons },
    fullMock: { ready: fullOk, bankAssembles, deliverable, reasons: fullOk ? [] : fullReasons },
    fullMockCalibrated: { ready: calOk, reasons: calOk ? [] : calReasons },
    formCapacity: { reduced: components.length ? Math.min(...components.map((c) => c.reducedFormCapacity)) : 0, full: capacity },
  };
}

/** Readiness for a catalogue binding (a subset of sections / objectives) from a stored snapshot. Skill subsets are practice only. */
export function readinessForBinding(health: Pick<BankHealth, 'cells' | 'components'>, sectionKeys: string[] | null, objectiveCodes: string[] | null): BankReadiness {
  const comps = health.components.filter((c) => !sectionKeys || sectionKeys.includes(c.sectionKey));
  const cells = health.cells.filter((c) => (!sectionKeys || sectionKeys.includes(c.sectionKey)) && (!objectiveCodes || objectiveCodes.includes(c.objectiveCode)));
  const r = readinessFrom(cells, comps);
  if (objectiveCodes) {
    const practiceOnly = { ready: false, reasons: ['práctica por habilidad: nunca es un simulacro'] };
    const practice = { ready: comps.length > 0 && comps.every((c) => c.simulationCapable) && cells.length > 0 && cells.every((c) => c.counts.practiceEligible >= 1), reasons: r.practice.reasons };
    return { ...r, practice, reducedMock: practiceOnly, fullMock: { ...practiceOnly, bankAssembles: false, deliverable: false }, fullMockCalibrated: practiceOnly };
  }
  return r;
}

/** Highest-value gaps first: priority, then form blockers of the governed form, then the largest deficit. */
export function prioritizeGaps(cells: CellHealth[]): CellHealth[] {
  return cells
    .filter((c) => c.generationNeed > 0)
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || Number(b.reducedBlocker) - Number(a.reducedBlocker) || b.deficit - a.deficit || a.cellKey.localeCompare(b.cellKey));
}
