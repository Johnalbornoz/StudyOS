/**
 * QB-R2C -- the Stimulus Plan as a planning primitive and the PAA generation plan.
 * ONE_STIMULUS_PLAN = ONE_POOL; every one of the 865 planned items is in exactly one generation unit.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PAA_SECTIONS, PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';
import { resolvePaaRequirementCells } from '@/lib/exam-core/question-bank/production/paa-cells';
import { buildPaaGenerationPlan, chunkByTarget, OPTIONAL_STIMULI_ARE_PLANNED_AS_SHARED, paaGenerationPlanViolations, paaLanguageOf, PAA_SECTION_LANGUAGE, PAA_STIMULUS_PLAN_POLICY, PAA_STIMULUS_TARGET_SIZE, summarizePaaGenerationPlan } from '@/lib/exam-core/question-bank/production/paa-generation-plan';
import { MOCK_POOLS, STIMULUS_KINDS, validateRequirementCell, type RequirementCell } from '@/lib/exam-core/question-bank/production/requirement-cell';
import { generationPlanViolations, GenerationPlanSchema, ONE_STIMULUS_PLAN_ONE_POOL, slotKeyOf, slotsOfUnit, StimulusPlanSchema, stimulusPlansOf, type GenerationPlan, type StimulusPlan } from '@/lib/exam-core/question-bank/production/stimulus-plan';

const ROOT = join(__dirname, '..', '..');
const CELLS = resolvePaaRequirementCells();
const cellOf = new Map(CELLS.map((c) => [c.cellKey, c]));
const PLAN = buildPaaGenerationPlan();
const PLANS = stimulusPlansOf(PLAN);
const SLOTS = PLAN.units.flatMap((u) => slotsOfUnit(u));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const count = <T>(xs: readonly T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});

describe('the cells are untouched: QB-R2C plans on top of them', () => {
  it('the resolved cells are still version 2, 789 cells for 865 items, with no stimulus-set field', () => {
    expect(CELLS).toHaveLength(789);
    expect(CELLS.reduce((n, c) => n + c.count, 0)).toBe(865);
    expect(CELLS.every((c) => c.v === 2 && validateRequirementCell(c).ok)).toBe(true);
    expect(Object.keys(CELLS[0]).sort()).toEqual(['assets', 'authority', 'binding', 'blueprint', 'cellKey', 'count', 'curriculumCurrentness', 'difficultyBand', 'difficultyBasis', 'domainNodeCode', 'examConfigKey', 'examFamily', 'examSkill', 'intendedPool', 'primaryConcept', 'responseFormat', 'responseFormatAuthority', 'sectionCode', 'stimulus', 'topicNodeCode', 'v']);
  });
});

describe('PAA generation plan -- 865 items, each in exactly one unit', () => {
  it('total 865 and the six pool totals are the cells\'', () => {
    expect(SLOTS).toHaveLength(865);
    expect(count(SLOTS, (s) => s.intendedPool)).toEqual({ PRACTICE: 183, DIAGNOSTIC: 122, VERIFICATION: 122, REDUCED_MOCK: 88, FULL_MOCK_1: 175, FULL_MOCK_2: 175 });
    expect(count(SLOTS, (s) => cellOf.get(s.cellKey)!.sectionCode)).toEqual({ 'paa.sec.lectura': 197, 'paa.sec.redaccion': 97, 'paa.sec.matematicas': 383, 'paa.sec.ingles': 188 });
    expect(paaGenerationPlanViolations(PLAN)).toEqual([]);
    expect(GenerationPlanSchema.safeParse(PLAN).success).toBe(true);
  });

  it('each Full Mock keeps 45 / 25 / 55 / 50 by section and the Reduced Mock 23 / 12 / 28 / 25', () => {
    const per = (pool: string) => PAA_SECTIONS.map((s) => SLOTS.filter((x) => x.intendedPool === pool && cellOf.get(x.cellKey)!.sectionCode === s.code).length);
    expect(per('FULL_MOCK_1')).toEqual([45, 25, 55, 50]);
    expect(per('FULL_MOCK_2')).toEqual([45, 25, 55, 50]);
    expect(per('REDUCED_MOCK')).toEqual([23, 12, 28, 25]);
  });

  it('every item slot of every cell is in exactly one unit, and no unit holds a slot that no cell has', () => {
    const seen = count(SLOTS, (s) => s.slotKey);
    const expected = CELLS.flatMap((c) => Array.from({ length: c.count }, (_, i) => slotKeyOf(c.cellKey, i + 1)));
    expect(Object.keys(seen).sort()).toEqual([...expected].sort());
    expect(Object.values(seen).every((n) => n === 1)).toBe(true);
    expect(new Set(PLAN.units.map((u) => u.unitKey)).size).toBe(PLAN.units.length);
  });

  it('every item has exactly one PRIMARY target, one Topic and one Domain, inherited from its cell', () => {
    for (const s of SLOTS) {
      const cell = cellOf.get(s.cellKey)!;
      const topic = PAA_TOPICS.find((t) => t.code === cell.topicNodeCode)!;
      expect(typeof cell.primaryConcept.stableId, s.slotKey).toBe('string');
      expect(topic.certifiedConceptId).toBe(cell.primaryConcept.stableId);
      expect(topic.domainCode).toBe(cell.domainNodeCode);
      expect(s.intendedPool).toBe(cell.intendedPool);
    }
  });

  it('zero intentional pool overlap: a slot names one pool, its cell\'s, and no slot key appears under two pools', () => {
    const poolsOfSlot = new Map<string, Set<string>>();
    for (const s of SLOTS) poolsOfSlot.set(s.slotKey, (poolsOfSlot.get(s.slotKey) ?? new Set()).add(s.intendedPool));
    expect([...poolsOfSlot.values()].every((p) => p.size === 1)).toBe(true);
    expect(SLOTS.every((s) => s.cellKey.startsWith(`${s.intendedPool}|`))).toBe(true);
  });

  it('is deterministic: building it twice gives the same plan, and the plan does not depend on the order of the cells', () => {
    expect(buildPaaGenerationPlan()).toEqual(PLAN);
    expect(buildPaaGenerationPlan([...CELLS].reverse())).toEqual(PLAN);
  });
});

describe('ONE_STIMULUS_PLAN = ONE_POOL', () => {
  it('no stimulus plan crosses pools, Sections, kinds or forms', () => {
    expect(ONE_STIMULUS_PLAN_ONE_POOL).toBe('ONE_STIMULUS_PLAN = ONE_POOL');
    for (const p of PLANS) {
      const cells = p.memberSlots.map((s) => cellOf.get(s.cellKey)!);
      expect(new Set(cells.map((c) => c.intendedPool)), p.stimulusPlanId).toEqual(new Set([p.intendedPool]));
      expect(new Set(cells.map((c) => c.sectionCode))).toEqual(new Set([p.sectionCode]));
      expect(cells.every((c) => c.stimulus.class === 'STIMULUS_REQUIRED' && c.stimulus.kind === p.stimulusKind)).toBe(true);
      expect(new Set(cells.map((c) => JSON.stringify(c.blueprint))).size).toBe(1);
      expect(StimulusPlanSchema.safeParse(p).success).toBe(true);
    }
    expect(summarizePaaGenerationPlan(PLAN).stimulusPlansCrossingPools).toBe(0);
  });

  it('NEGATIVE: a plan with a member slot of another pool is refused by the schema and named by the validator', () => {
    const practice = PLANS.find((p) => p.intendedPool === 'PRACTICE' && p.stimulusKind === 'PASSAGE' && p.sectionCode === 'paa.sec.lectura')!;
    const diagnostic = PLANS.find((p) => p.intendedPool === 'DIAGNOSTIC' && p.stimulusKind === 'PASSAGE' && p.sectionCode === 'paa.sec.lectura')!;
    const crossing: StimulusPlan = { ...clone(practice), memberSlots: [...clone(practice).memberSlots.slice(0, -1), clone(diagnostic).memberSlots[0]] };
    const parsed = StimulusPlanSchema.safeParse(crossing);
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues.map((i) => i.message)).toContain('STIMULUS_PLAN_CROSSES_POOLS');
    const bad: GenerationPlan = { ...clone(PLAN), units: clone(PLAN).units.map((u) => (u.unitKey === practice.stimulusPlanId ? { ...u, plan: crossing } : u)) as GenerationPlan['units'] };
    expect(generationPlanViolations(bad, CELLS)).toEqual(expect.arrayContaining(['STIMULUS_PLAN_CROSSES_POOLS']));
  });

  it('NEGATIVE: a slot that lies about its pool is caught against the CELL, not believed', () => {
    const p = PLANS.find((x) => x.intendedPool === 'PRACTICE' && x.questionCount > 1)!;
    // the whole plan claims DIAGNOSTIC consistently, so the schema is satisfied -- only the cells give it away
    const lying: StimulusPlan = { ...clone(p), intendedPool: 'DIAGNOSTIC', memberSlots: clone(p).memberSlots.map((s) => ({ ...s, intendedPool: 'DIAGNOSTIC' as const })) };
    expect(StimulusPlanSchema.safeParse(lying).success).toBe(true);
    const bad = { ...clone(PLAN), units: clone(PLAN).units.map((u) => (u.unitKey === p.stimulusPlanId ? { ...u, plan: lying } : u)) };
    expect(generationPlanViolations(bad, CELLS)).toEqual(expect.arrayContaining(['SLOT_POOL_IS_NOT_THE_CELLS', 'STIMULUS_PLAN_CROSSES_POOLS']));
  });

  it('NEGATIVE: a missing slot, a slot planned twice, an unknown cell and wrong plan facts are each named', () => {
    const drop = { ...clone(PLAN), units: clone(PLAN).units.slice(1) };
    expect(generationPlanViolations(drop, CELLS)).toContain('SLOT_IN_NO_UNIT');
    const first = clone(PLAN).units.find((u) => u.type === 'STANDALONE')!;
    expect(generationPlanViolations({ ...clone(PLAN), units: [...clone(PLAN).units, { ...first, unitKey: `${first.unitKey}-again` }] }, CELLS)).toContain('SLOT_IN_TWO_UNITS');
    expect(generationPlanViolations(PLAN, CELLS.slice(1))).toContain('UNKNOWN_CELL');
    const wrongFacts = { ...clone(PLAN), units: clone(PLAN).units.map((u) => (u.type === 'STIMULUS' && u.plan.questionCount > 1 && u.plan.difficultyMix.STANDARD > 0 ? { ...u, plan: { ...u.plan, difficultyMix: { ...u.plan.difficultyMix, STANDARD: u.plan.difficultyMix.STANDARD - 1, CHALLENGE: u.plan.difficultyMix.CHALLENGE + 1 } } } : u)) };
    expect(generationPlanViolations(wrongFacts, CELLS)).toContain('STIMULUS_PLAN_FACTS_DO_NOT_MATCH_CELLS');
    // a stimulus-required slot may not be planned as a standalone unit
    const required = PLANS[0].memberSlots[0];
    const asStandalone = { ...clone(PLAN), units: [...clone(PLAN).units.filter((u) => u.unitKey !== PLANS[0].stimulusPlanId), { type: 'STANDALONE', unitKey: `SU|${required.slotKey}`, slot: required }] };
    expect(generationPlanViolations(asStandalone, CELLS)).toContain('STANDALONE_UNIT_ON_A_STIMULUS_REQUIRED_CELL');
  });
});

describe('grouping policy q1-paa-stimulus-plan v1 (STUDYUS_POLICY)', () => {
  const S = summarizePaaGenerationPlan(PLAN);

  it('standalone and optional cells give one standalone unit per item; optional stimuli are not planned as shared', () => {
    expect(PAA_STIMULUS_PLAN_POLICY).toEqual({ id: 'q1-paa-stimulus-plan', version: '1', authority: 'STUDYUS_POLICY' });
    expect(OPTIONAL_STIMULI_ARE_PLANNED_AS_SHARED).toBe(false);
    expect(S.standaloneUnits).toBe(378);
    expect(S.standaloneByStimulusClass).toEqual({ STANDALONE: 297, STIMULUS_OPTIONAL: 81 });
    expect(PLANS.every((p) => p.memberSlots.every((s) => cellOf.get(s.cellKey)!.stimulus.class === 'STIMULUS_REQUIRED'))).toBe(true);
  });

  it('the reported counts: 198 stimulus plans for 487 questions, by kind and by pool', () => {
    expect(S).toMatchObject({ items: 865, units: 576, stimulusPlans: 198, stimulusPlanQuestions: 487, violations: [] });
    expect(S.stimulusPlansByKind).toEqual({ PASSAGE: 45, PAIRED_PASSAGE: 6, POEM: 9, NUMBERED_TEXT: 20, DRAFT_PARAGRAPH: 8, COMPOSITE: 6, TABLE: 6, GRAPH: 7, DATA_SET: 5, FIGURE: 86 });
    expect(S.stimulusPlansByPool).toEqual({ PRACTICE: 42, DIAGNOSTIC: 31, VERIFICATION: 31, REDUCED_MOCK: 22, FULL_MOCK_1: 36, FULL_MOCK_2: 36 });
    expect(S.questionsPerPlan).toEqual({
      PASSAGE: { '2': 6, '4': 9, '5': 30 }, PAIRED_PASSAGE: { '1': 1, '2': 4, '3': 1 }, POEM: { '1': 1, '2': 6, '3': 2 }, NUMBERED_TEXT: { '2': 1, '5': 19 }, DRAFT_PARAGRAPH: { '2': 3, '3': 3, '5': 2 },
      COMPOSITE: { '1': 1, '2': 4, '3': 1 }, TABLE: { '1': 1, '2': 4, '3': 1 }, GRAPH: { '1': 1, '2': 4, '3': 2 }, DATA_SET: { '2': 4, '3': 1 }, FIGURE: { '1': 86 },
    });
  });

  it('no plan is larger than its kind\'s target; a figure belongs to one question; a one-question plan of another kind is a bucket of one', () => {
    expect(Object.keys(PAA_STIMULUS_TARGET_SIZE).sort()).toEqual([...STIMULUS_KINDS].sort());
    for (const p of PLANS) expect(p.questionCount, p.stimulusPlanId).toBeLessThanOrEqual(PAA_STIMULUS_TARGET_SIZE[p.stimulusKind]);
    expect(PLANS.filter((p) => p.stimulusKind === 'FIGURE').every((p) => p.questionCount === 1)).toBe(true);
    // the five one-question plans of multi-question kinds are all in the Reduced Mock, whose buckets hold one slot
    expect(S.singleQuestionPlansOfMultiQuestionKinds).toEqual(['SP|REDUCED_MOCK|lectura|PAIRED_PASSAGE|01', 'SP|REDUCED_MOCK|lectura|POEM|01', 'SP|REDUCED_MOCK|lectura|COMPOSITE|01', 'SP|REDUCED_MOCK|matematicas|TABLE|01', 'SP|REDUCED_MOCK|matematicas|GRAPH|01']);
    for (const id of S.singleQuestionPlansOfMultiQuestionKinds) {
      const p = PLANS.find((x) => x.stimulusPlanId === id)!;
      expect(PLANS.filter((x) => x.intendedPool === p.intendedPool && x.sectionCode === p.sectionCode && x.stimulusKind === p.stimulusKind)).toHaveLength(1);
    }
  });

  it('chunking: target size, a smaller last chunk, and a trailing chunk of one rebalanced with the one before', () => {
    const sizes = (n: number, target: number) => chunkByTarget(Array.from({ length: n }, (_, i) => i), target).map((c) => c.length);
    expect(sizes(10, 5)).toEqual([5, 5]);
    expect(sizes(12, 5)).toEqual([5, 5, 2]);
    expect(sizes(11, 5)).toEqual([5, 4, 2]);
    expect(sizes(4, 3)).toEqual([2, 2]);
    expect(sizes(7, 3)).toEqual([3, 2, 2]);
    expect(sizes(1, 5)).toEqual([1]);
    expect(sizes(3, 1)).toEqual([1, 1, 1]);
    expect(chunkByTarget([1, 2, 3, 4, 5, 6], 5).flat()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('a stimulus mixes the Section\'s Domains and Topics instead of repeating one concept', () => {
    // Redacción has five Domains with one concept each: every five-question text takes one question from each
    const redaccion = PLANS.filter((p) => p.sectionCode === 'paa.sec.redaccion' && p.questionCount === 5 && p.intendedPool !== 'FULL_MOCK_1' && p.intendedPool !== 'FULL_MOCK_2');
    expect(redaccion.length).toBeGreaterThan(0);
    for (const p of redaccion) expect(p.domainCodes, p.stimulusPlanId).toHaveLength(5);
    // a Lectura passage of five questions never asks all five on one concept
    for (const p of PLANS.filter((x) => x.sectionCode === 'paa.sec.lectura' && x.stimulusKind === 'PASSAGE' && x.questionCount === 5)) expect(p.targetConceptStableIds.length, p.stimulusPlanId).toBeGreaterThanOrEqual(2);
  });

  it('integrity: a mock plan and a one-question plan are WHOLE; a per-concept pool\'s plan is SUBSET{1..n}', () => {
    for (const p of PLANS) {
      if (MOCK_POOLS.has(p.intendedPool) || p.questionCount === 1) expect(p.integrity, p.stimulusPlanId).toEqual({ rule: 'WHOLE' });
      else expect(p.integrity, p.stimulusPlanId).toEqual({ rule: 'SUBSET', min: 1, max: p.questionCount });
    }
    expect(StimulusPlanSchema.safeParse({ ...clone(PLANS[0]), integrity: { rule: 'SUBSET', min: 3, max: 2 } }).success).toBe(false);
    expect(StimulusPlanSchema.safeParse({ ...clone(PLANS[0]), integrity: { rule: 'SUBSET', min: 1, max: 99 } }).success).toBe(false);
  });

  it('language comes from the Section: Spanish for Lectura, Redacción and Matemáticas, English for Inglés', () => {
    expect(PAA_SECTION_LANGUAGE).toEqual({ 'paa.sec.lectura': 'es', 'paa.sec.redaccion': 'es', 'paa.sec.matematicas': 'es', 'paa.sec.ingles': 'en' });
    for (const p of PLANS) expect(p.language).toBe(p.sectionCode === 'paa.sec.ingles' ? 'en' : 'es');
    expect(() => paaLanguageOf('paa.sec.unknown')).toThrow(/PAA_SECTION_HAS_NO_LANGUAGE/);
  });

  it('a stimulus plan states its facts: mixes sum to its questions and equal its cells\'', () => {
    for (const p of PLANS) {
      const cells: RequirementCell[] = p.memberSlots.map((s) => cellOf.get(s.cellKey)!);
      expect(p.difficultyMix.FOUNDATIONAL + p.difficultyMix.STANDARD + p.difficultyMix.CHALLENGE).toBe(p.questionCount);
      expect(p.responseFormatMix.STUDENT_PRODUCED).toBe(cells.filter((c) => c.responseFormat === 'STUDENT_PRODUCED').length);
      expect(p.targetConceptStableIds).toEqual([...new Set(cells.map((c) => c.primaryConcept.stableId))].sort());
    }
    expect(StimulusPlanSchema.safeParse({ ...clone(PLANS[0]), questionCount: PLANS[0].questionCount + 1 }).success).toBe(false);
  });
});

describe('the planning artifact', () => {
  it('QB_R2C_paa_generation_plan.json is exactly what the function returns, and is unbound', () => {
    const raw = readFileSync(join(ROOT, 'docs/exams/question-bank/audits/q1-paa/QB_R2C_paa_generation_plan.json'), 'utf8');
    const artifact = JSON.parse(raw);
    expect(artifact.plan).toEqual(PLAN);
    expect(artifact.summary).toEqual(JSON.parse(JSON.stringify(summarizePaaGenerationPlan(PLAN))));
    expect(raw).toBe(`${JSON.stringify({ summary: summarizePaaGenerationPlan(PLAN), plan: PLAN }, null, 1)}\n`);
    // codes and stable ids only: no row id of any environment
    expect(raw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(raw).not.toMatch(/environmentFingerprint|NodeId|primaryConceptId/);
  });
});
