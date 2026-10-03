/**
 * Question Bank Factory V1 -- bank health and readiness by real form assembly
 * (pure): sections 35-37, 65-67, 73, 76-79.
 */
import { describe, it, expect } from 'vitest';
import { computeBankHealth, prioritizeGaps, readinessForBinding, itemMatchesCell, type BankItemFact } from '@/lib/exam-core/question-bank/health';
import { deriveBlueprintCells, type ComponentInput, type BlueprintTargetInput } from '@/lib/exam-core/question-bank/cells';
import { configHealthInput } from '@/lib/exam-core/question-bank/config-health';
import { adapterFor } from '@/lib/exam-core/question-bank/adapters';
import { overlayNodeReadiness, bankStateOf, shadowDirection } from '@/lib/exam-core/question-bank/readiness-overlay';
import { packageReadiness } from '@/lib/exam-core/catalog/readiness';
import { parseExamVerticalConfig } from '@/lib/exam-core/vertical-config';
import { PAA_V2, PISA_2022_V2, AICE_9709_AS, AICE_9702_AS } from '@/lib/exam-core/verticals/v2';
import type { LifecycleState } from '@/lib/exam-core/question-bank/lifecycle';

// ------------------------------------------------------------------ synthetic exam: two sections
const comps: ComponentInput[] = [
  { id: 'cm', sectionKey: 'math', name: 'Math', order: 0, officialItemCount: 4, maxMarks: null, simulationCapable: true },
  { id: 'cr', sectionKey: 'reading', name: 'Reading', order: 1, officialItemCount: 4, maxMarks: null, simulationCapable: true },
];
const target = (id: string, lo: string, comp: string): BlueprintTargetInput => ({ id, learningObjectiveId: lo, objectiveCode: lo, assessmentComponentId: comp, questionType: null, difficultyMin: null, difficultyMax: null, commandTerm: null });
// Reduced blueprint: 2 + 2 positions; official length 4 + 4.
const targets = [target('t1', 'lo.alg', 'cm'), target('t2', 'lo.geo', 'cm'), target('t3', 'lo.inf', 'cr'), target('t4', 'lo.voc', 'cr')];
let n = 0;
const item = (lo: string, over: Partial<BankItemFact> = {}): BankItemFact => {
  n += 1;
  return {
    versionId: `v${n}`, bankItemId: `b${n}`, learningObjectiveId: lo, questionType: 'multiple_choice', difficulty: 3, difficultyIndex: 1, marks: 1,
    templateFingerprint: `tpl${n}`, semanticFingerprint: `sem${n}`, stimulusKey: null, provenance: 'STUDYUS_GENERATED', lifecycle: 'ACTIVE', status: 'PUBLISHED',
    isCurrentVersion: true, retired: false, calibrationConfidence: 'INSUFFICIENT_DATA', ...over,
  };
};
const many = (lo: string, k: number, over: Partial<BankItemFact> = {}) => Array.from({ length: k }, () => item(lo, over));
const health = (items: BankItemFact[], opts: { comps?: ComponentInput[]; queue?: any[] } = {}) =>
  computeBankHealth({ cells: deriveBlueprintCells(targets, opts.comps ?? comps), components: opts.comps ?? comps, items, queue: opts.queue ?? [], unitPolicy: { mode: 'ITEM' } });

describe('section 73 -- readiness is proved by assembly, never by a total count', () => {
  it('1. sufficient TOTAL count but a missing blueprint cell -> Full Mock false (and reduced false)', () => {
    const h = health([...many('lo.alg', 200), ...many('lo.geo', 10), ...many('lo.inf', 10)]); // zero vocabulary items
    expect(h.totals.items).toBe(220);
    expect(h.readiness.fullMock.ready).toBe(false);
    expect(h.readiness.reducedMock.ready).toBe(false);
    expect(h.readiness.practice.ready).toBe(false);
    expect(h.cells.find((c) => c.objectiveCode === 'lo.voc')?.state).toBe('EMPTY');
    expect(h.readiness.fullMock.reasons.join(' ')).toMatch(/lo\.voc: 0\/2/);
  });
  it('2. every cell filled -> the full form assembles (full-length blueprint deliverable)', () => {
    const fullComps = comps.map((c) => ({ ...c, officialItemCount: 2 }));
    const h = health([...many('lo.alg', 2), ...many('lo.geo', 2), ...many('lo.inf', 2), ...many('lo.voc', 2)], { comps: fullComps });
    expect(h.components.every((c) => c.lengthBasis === 'BLUEPRINT_IS_FULL')).toBe(true);
    expect(h.readiness.fullMock).toMatchObject({ ready: true, bankAssembles: true, deliverable: true });
  });
  it('3. reduced form ready while the full form is not', () => {
    const h = health([...many('lo.alg', 1), ...many('lo.geo', 1), ...many('lo.inf', 1), ...many('lo.voc', 1)]);
    expect(h.readiness.reducedMock.ready).toBe(true);
    expect(h.readiness.fullMock.ready).toBe(false);
    expect(h.readiness.fullMock.bankAssembles).toBe(false);
  });
  it('4. technical full readiness and calibrated full readiness differ', () => {
    const fullComps = comps.map((c) => ({ ...c, officialItemCount: 2 }));
    const items = [...many('lo.alg', 2), ...many('lo.geo', 2), ...many('lo.inf', 2), ...many('lo.voc', 2)];
    const h = health(items, { comps: fullComps });
    expect(h.readiness.fullMock.ready).toBe(true);
    expect(h.readiness.fullMockCalibrated.ready).toBe(false);
    const cal = health(items.map((i) => ({ ...i, calibrationConfidence: 'MODERATE_CONFIDENCE' as const })), { comps: fullComps });
    expect(cal.readiness.fullMockCalibrated.ready).toBe(true);
  });
  it('5. a retired item cannot enter a new form', () => {
    const items = [...many('lo.alg', 1), ...many('lo.geo', 1), ...many('lo.inf', 1), item('lo.voc', { retired: true, lifecycle: 'RETIRED', status: 'RETIRED' })];
    const h = health(items);
    expect(h.readiness.reducedMock.ready).toBe(false);
    expect(h.cells.find((c) => c.objectiveCode === 'lo.voc')?.counts.retired).toBe(1);
  });
  it('6. a PILOT item follows the eligibility policy: practice yes, mock no', () => {
    const items = [...many('lo.alg', 1), ...many('lo.geo', 1), ...many('lo.inf', 1), item('lo.voc', { lifecycle: 'PILOT' })];
    const h = health(items);
    expect(h.readiness.practice.ready).toBe(true);
    expect(h.readiness.reducedMock.ready).toBe(false);
    const voc = h.cells.find((c) => c.objectiveCode === 'lo.voc')!;
    expect(voc.counts).toMatchObject({ pilot: 1, practiceEligible: 1, mockEligible: 0 });
  });
  it('7. readiness changes after valid content enters the bank', () => {
    const items = [...many('lo.alg', 1), ...many('lo.geo', 1), ...many('lo.inf', 1)];
    expect(health(items).readiness.practice.ready).toBe(false);
    const withPilot = [...items, item('lo.voc', { lifecycle: 'PILOT' })];
    expect(health(withPilot).readiness.practice.ready).toBe(true);
    const promoted = withPilot.map((i) => (i.learningObjectiveId === 'lo.voc' ? { ...i, lifecycle: 'ACTIVE' as LifecycleState } : i));
    expect(health(promoted).readiness.reducedMock.ready).toBe(true);
  });
  it('invalid (rejected / validating) content never improves readiness', () => {
    const items = [...many('lo.alg', 1), ...many('lo.geo', 1), ...many('lo.inf', 1)];
    const rejected = [...items, item('lo.voc', { lifecycle: 'REJECTED', status: 'REJECTED' }), item('lo.voc', { lifecycle: 'VALIDATING', status: 'DRAFT' })];
    const h = health(rejected);
    expect(h.readiness.practice.ready).toBe(false);
    expect(h.cells.find((c) => c.objectiveCode === 'lo.voc')).toMatchObject({ state: 'EMPTY', counts: expect.objectContaining({ rejected: 1, validating: 1 }) });
  });
  it('template fingerprints are respected by assembly (two variants of one template never fill one form)', () => {
    const c: ComponentInput[] = [{ id: 'cm', sectionKey: 'math', name: 'Math', order: 0, officialItemCount: 2, maxMarks: null, simulationCapable: true }];
    const cells = deriveBlueprintCells([target('t1', 'lo.a', 'cm'), target('t2', 'lo.a', 'cm')], c);
    const clones = many('lo.a', 2, { templateFingerprint: 'same' });
    expect(computeBankHealth({ cells, components: c, items: clones, queue: [], unitPolicy: { mode: 'ITEM' } }).readiness.fullMock.ready).toBe(false);
    expect(computeBankHealth({ cells, components: c, items: [...clones, item('lo.a')], queue: [], unitPolicy: { mode: 'ITEM' } }).readiness.fullMock.ready).toBe(true);
  });
});

describe('cell health states and deterministic gap priority', () => {
  it('EMPTY P0 -> INSUFFICIENT P1 -> FORM_READY / VARIETY_LOW P2 -> HEALTHY P3 (no generation) -> CALIBRATED P4', () => {
    // Official length 4 per section over 2 cells -> 2 full-length positions per cell, variety target 6.
    const h = health([...many('lo.alg', 1), ...many('lo.geo', 2), ...many('lo.inf', 5), ...many('lo.voc', 3)]);
    const by = (lo: string) => h.cells.find((c) => c.objectiveCode === lo)!;
    expect(by('lo.alg')).toMatchObject({ state: 'INSUFFICIENT', priority: 'P1' });
    expect(by('lo.geo')).toMatchObject({ state: 'FORM_READY', priority: 'P2' });
    expect(by('lo.voc')).toMatchObject({ state: 'FORM_READY', priority: 'P2' });
    expect(by('lo.inf')).toMatchObject({ state: 'VARIETY_LOW', priority: 'P2' });
    const healthy = health([...many('lo.alg', 6), ...many('lo.geo', 6), ...many('lo.inf', 6), ...many('lo.voc', 6)]);
    expect(healthy.cells.every((c) => c.state === 'HEALTHY' && c.priority === 'P3' && c.generationNeed === 0)).toBe(true);
    const empty = health([]);
    const calibrated = health([...many('lo.alg', 6), ...many('lo.geo', 6), ...many('lo.inf', 6), ...many('lo.voc', 6)].map((i) => ({ ...i, calibrationConfidence: 'MODERATE_CONFIDENCE' as const })));
    expect(calibrated.cells.every((c) => c.state === 'CALIBRATED' && c.priority === 'P4')).toBe(true);
    expect(empty.cells.every((c) => c.priority === 'P0')).toBe(true);
  });
  it('deficit = target - eligible; generation need subtracts pilot, validating and queued work', () => {
    const h = health([...many('lo.alg', 1), item('lo.alg', { lifecycle: 'PILOT' })], { queue: [{ cellKey: 'math|lo.alg|*|*-*|*', status: 'PENDING', requestedCount: 3 }] });
    const alg = h.cells.find((c) => c.objectiveCode === 'lo.alg')!;
    expect(alg.fullPositions).toBe(2);
    expect(alg.targets.desired).toBe(6);
    expect(alg.deficit).toBe(5);
    expect(alg.queued).toBe(3);
    expect(alg.generationNeed).toBe(1);
  });
  it('prioritization is deterministic: P0 first, reduced-form blockers before others, then largest deficit', () => {
    const h = health([...many('lo.alg', 1), ...many('lo.inf', 1)]);
    const order = prioritizeGaps(h.cells).map((c) => c.objectiveCode);
    expect(order.slice(0, 2).sort()).toEqual(['lo.geo', 'lo.voc']);
    expect(prioritizeGaps(h.cells)).toEqual(prioritizeGaps(h.cells));
  });
});

describe('section 76 -- PAA onboarded into bank health (governed blueprint, current fixture bank)', () => {
  const input = configHealthInput(PAA_V2);
  const h = computeBankHealth({ cells: input.cells, components: input.components, items: input.items, queue: [], unitPolicy: adapterFor('PAA').unitPolicy });
  it('ingests the current PAA bank: 47 fixture items, 20 cells, no official content', () => {
    expect(h.totals.items).toBe(47);
    expect(h.totals.byProvenance.FIXTURE).toBe(47);
    expect(h.officialContentCoverage).toBe(0);
    expect(h.totals.cells).toBe(20);
  });
  it('the reduced mock remains assemblable (non-regression of the governed 36-position form)', () => {
    expect(h.readiness.practice.ready).toBe(true);
    expect(h.readiness.reducedMock.ready).toBe(true);
    // Same verdict as the catalogue readiness computed from the configuration.
    const parsed = parseExamVerticalConfig(PAA_V2);
    if (!parsed.ok) throw new Error('config');
    expect(packageReadiness(parsed.config).state).toBe('REDUCED_MOCK_READY');
  });
  it('Full Mock stays false for real reasons: every cell is below its full-length requirement, and the governed blueprint is reduced', () => {
    expect(h.readiness.fullMock.ready).toBe(false);
    expect(h.readiness.fullMock.bankAssembles).toBe(false);
    expect(h.readiness.fullMock.deliverable).toBe(false);
    expect(h.readiness.fullMockCalibrated.ready).toBe(false);
    const missing = h.cells.reduce((s, c) => s + Math.max(0, c.fullPositions - c.counts.mockEligible), 0);
    expect(missing).toBe(175 - 47);
    expect(h.cells.every((c) => c.state === 'INSUFFICIENT' && c.priority === 'P1')).toBe(true);
    const alg = h.cells.find((c) => c.objectiveCode === 'paa.mat.algebra')!;
    expect(alg).toMatchObject({ fullPositions: 14, reducedPositions: 3, deficit: 42 - 4 });
  });
  it('a small validated batch increases the correct cell only (pilot -> practice coverage), never mock readiness', () => {
    const loAlg = input.objectiveIdByCode['paa.mat.algebra'];
    const batch = [1, 2, 3].map((k) => item(loAlg, { lifecycle: 'PILOT', provenance: 'STUDYUS_GENERATED', versionId: `gen${k}`, bankItemId: `genb${k}` }));
    const after = computeBankHealth({ cells: input.cells, components: input.components, items: [...input.items, ...batch], queue: [], unitPolicy: { mode: 'ITEM' } });
    const before = h.cells.find((c) => c.objectiveCode === 'paa.mat.algebra')!;
    const now = after.cells.find((c) => c.objectiveCode === 'paa.mat.algebra')!;
    expect(now.counts.practiceEligible - before.counts.practiceEligible).toBe(3);
    expect(now.counts.pilot).toBe(3);
    expect(now.counts.mockEligible).toBe(before.counts.mockEligible);
    for (const c of after.cells.filter((x) => x.objectiveCode !== 'paa.mat.algebra')) expect(c.counts).toEqual(h.cells.find((x) => x.cellKey === c.cellKey)!.counts);
    expect(after.readiness.fullMock.ready).toBe(false);
    expect(after.officialContentCoverage).toBe(0);
  });
  it('invalid generated content (rejected) does not improve any cell', () => {
    const loAlg = input.objectiveIdByCode['paa.mat.algebra'];
    const after = computeBankHealth({ cells: input.cells, components: input.components, items: [...input.items, item(loAlg, { lifecycle: 'REJECTED', status: 'REJECTED' })], queue: [], unitPolicy: { mode: 'ITEM' } });
    expect(after.cells.map((c) => c.counts.practiceEligible)).toEqual(h.cells.map((c) => c.counts.practiceEligible));
  });
});

describe('section 77 -- PISA: the factory understands units (shared stimulus), not independent questions', () => {
  it('an item whose unit has too few eligible items does not count for a mock; variety is counted in units', () => {
    const c: ComponentInput[] = [{ id: 'cm', sectionKey: 'math', name: 'Math', order: 0, officialItemCount: 2, maxMarks: null, simulationCapable: true }];
    const cells = deriveBlueprintCells([target('t1', 'lo.a', 'cm'), target('t2', 'lo.a', 'cm')], c);
    const lone = [item('lo.a', { stimulusKey: 'unit1' }), item('lo.a', { stimulusKey: 'unit2' })];
    const asItems = computeBankHealth({ cells, components: c, items: lone, queue: [], unitPolicy: { mode: 'ITEM' } });
    const asUnits = computeBankHealth({ cells, components: c, items: lone, queue: [], unitPolicy: adapterFor('PISA').unitPolicy });
    expect(asItems.readiness.reducedMock.ready).toBe(true);
    expect(asUnits.readiness.reducedMock.ready).toBe(false);
    const units = [item('lo.a', { stimulusKey: 'u1' }), item('lo.a', { stimulusKey: 'u1' }), item('lo.a', { stimulusKey: 'u1' }), item('lo.a', { stimulusKey: 'u1' })];
    const one = computeBankHealth({ cells, components: c, items: units, queue: [], unitPolicy: adapterFor('PISA').unitPolicy });
    expect(one.cells[0].counts.mockEligible).toBe(4);
    expect(one.cells[0].counts.distinctUnits).toBe(1);
    expect(one.cells[0].state).toBe('FORM_READY'); // 4 items but a single unit: repetition risk
  });
  it('PISA 2022 configuration: health computed with the unit policy; the reduced mock still assembles', () => {
    const input = configHealthInput(PISA_2022_V2);
    const h = computeBankHealth({ cells: input.cells, components: input.components, items: input.items, queue: [], unitPolicy: adapterFor('PISA').unitPolicy });
    expect(input.items.some((i) => i.stimulusKey)).toBe(true);
    expect(h.cells.length).toBeGreaterThan(0);
    expect(h.readiness.fullMock.ready).toBe(false);
  });
});

describe('section 78 -- AICE: 9709 content never satisfies 9702', () => {
  it('cells are per exam version + learning objective: a 9709 item matches no 9702 cell', () => {
    const math = configHealthInput(AICE_9709_AS);
    const phys = configHealthInput(AICE_9702_AS);
    for (const it of math.items) for (const cell of phys.cells) expect(itemMatchesCell(it, cell)).toBe(false);
    const h = computeBankHealth({ cells: phys.cells, components: phys.components, items: [...math.items], queue: [], unitPolicy: { mode: 'ITEM' } });
    expect(h.cells.every((c) => c.counts.total === 0)).toBe(true);
    expect(h.readiness.practice.ready).toBe(false);
  });
});

describe('section 79 -- one canonical concept, different exams: different items, exam-specific calibration', () => {
  it('a PAA algebra item never counts in a PISA cell even if both map to the same canonical concept', () => {
    const paa = configHealthInput(PAA_V2);
    const pisa = configHealthInput(PISA_2022_V2);
    const paaAlg = paa.items.filter((i) => i.learningObjectiveId === paa.objectiveIdByCode['paa.mat.algebra']);
    const h = computeBankHealth({ cells: pisa.cells, components: pisa.components, items: [...pisa.items, ...paaAlg.map((i) => ({ ...i, calibrationConfidence: 'HIGH_CONFIDENCE' as const }))], queue: [], unitPolicy: adapterFor('PISA').unitPolicy });
    const base = computeBankHealth({ cells: pisa.cells, components: pisa.components, items: pisa.items, queue: [], unitPolicy: adapterFor('PISA').unitPolicy });
    expect(h.cells.map((c) => c.counts)).toEqual(base.cells.map((c) => c.counts));
  });
});

describe('dynamic capability overlay (server-authoritative)', () => {
  const snapshot = (() => {
    const input = configHealthInput(PAA_V2);
    return computeBankHealth({ cells: input.cells, components: input.components, items: input.items, queue: [], unitPolicy: { mode: 'ITEM' } });
  })();
  const persisted = { state: 'REDUCED_MOCK_READY' as const, modes: ['MOCK', 'CHALLENGE'] as Array<'MOCK' | 'CHALLENGE'>, components: [], selectable: true };
  it('SHADOW never changes what a node offers (only reports the calculated state)', () => {
    const r = overlayNodeReadiness({ persisted, declaredModes: ['MOCK', 'CHALLENGE'], bound: true, bind: {}, snapshot, mode: 'SHADOW' });
    expect(r.changed).toBe(false);
    expect(r.state).toBe('REDUCED_MOCK_READY');
    expect(r.bankState).toBe('REDUCED_MOCK_READY');
    expect(shadowDirection('REDUCED_MOCK_READY', r.bankState)).toBe('SAME');
  });
  it('ENFORCE on the current PAA bank: PAA full test stays a reduced mock (no fake Full Mock)', () => {
    const r = overlayNodeReadiness({ persisted, declaredModes: ['MOCK', 'CHALLENGE'], bound: true, bind: {}, snapshot, mode: 'ENFORCE' });
    expect(r.state).toBe('REDUCED_MOCK_READY');
    expect(r.changed).toBe(false);
  });
  it('ENFORCE downgrades when content is retired, and an area-practice node never becomes a mock', () => {
    const input = configHealthInput(PAA_V2);
    const retiredVoc = input.items.map((i) => (i.learningObjectiveId === input.objectiveIdByCode['paa.lect.vocabulario'] ? { ...i, retired: true } : i));
    const hurt = computeBankHealth({ cells: input.cells, components: input.components, items: retiredVoc, queue: [], unitPolicy: { mode: 'ITEM' } });
    const full = overlayNodeReadiness({ persisted, declaredModes: ['MOCK', 'CHALLENGE'], bound: true, bind: {}, snapshot: hurt, mode: 'ENFORCE' });
    expect(full.state).toBe('STRUCTURE_READY');
    expect(full.selectable).toBe(false);
    const area = overlayNodeReadiness({ persisted: { state: 'PRACTICE_READY', modes: ['PRACTICE'], components: [], selectable: true }, declaredModes: ['PRACTICE'], bound: true, bind: { sectionKey: 'matematicas' }, snapshot, mode: 'ENFORCE' });
    expect(area.state).toBe('PRACTICE_READY');
    expect(area.modes).toEqual(['PRACTICE']);
  });
  it('a catalogue-only node is never upgraded; skill subsets are practice only', () => {
    const r = overlayNodeReadiness({ persisted: { state: 'CATALOG_ONLY', modes: [], components: [], selectable: false }, declaredModes: ['MOCK'], bound: false, bind: {}, snapshot, mode: 'ENFORCE' });
    expect(r.state).toBe('CATALOG_ONLY');
    const skill = readinessForBinding(snapshot, ['matematicas'], ['paa.mat.algebra']);
    expect(skill.practice.ready).toBe(true);
    expect(skill.reducedMock.ready).toBe(false);
    expect(bankStateOf(skill)).toBe('PRACTICE_READY');
  });
});
