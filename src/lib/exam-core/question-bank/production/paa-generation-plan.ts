/**
 * QB-R2C -- the PAA generation plan: the 865 planned items grouped into generation units (pure, no IO).
 *
 * `resolvePaaRequirementCells()` says what each cell needs. This module says which item slots are written
 * together: a standalone question on its own, or one stimulus with all of its questions (a StimulusPlan).
 * Every one of the 865 item slots belongs to exactly one unit. The cells are read, never changed.
 *
 * GROUPING POLICY `q1-paa-stimulus-plan` v1 -- a StudyUs policy (STUDYUS_POLICY), deterministic, no randomness.
 * Nothing here is the exam's own allocation: the official guide fixes no number of questions per text.
 *   1. STANDALONE cell           -> one standalone unit per item slot.
 *   2. STIMULUS_OPTIONAL cell    -> one standalone unit per item slot too. Optional stimuli are NOT planned as
 *      shared stimuli (`OPTIONAL_STIMULI_ARE_PLANNED_AS_SHARED = false`): a question may get a stimulus of its
 *      own at generation (one question, one stimulus, the item's own pool), which needs no plan.
 *   3. STIMULUS_REQUIRED cells   -> grouped into stimulus plans inside ONE bucket = (pool, Section, stimulus kind).
 *      A plan never crosses pools, Sections or kinds. A mock pool is one form, so a plan never crosses forms.
 *   4. ORDER inside a bucket (so that a stimulus mixes the Section's Topics instead of asking five questions on
 *      one concept): the slots of each Domain are queued by taking one slot per Topic in turn, Topics in code
 *      order, a Topic's slots in (cell key, index) order; then the bucket takes one slot per Domain in turn,
 *      Domains in the order of their first Topic code.
 *   5. CHUNK the ordered slots by the kind's target size (`PAA_STIMULUS_TARGET_SIZE`, StudyUs policy). The last
 *      chunk of a bucket may be smaller. A trailing chunk of ONE question for a multi-question kind is avoided
 *      by moving the last slot of the previous chunk into it (target 5: 5,1 -> 4,2). A bucket that holds a single
 *      slot yields a one-question plan: there is nothing to rebalance with, and the summary reports it.
 *   6. INTEGRITY: a mock plan is WHOLE (a form's section totals count every planned question); a one-question plan
 *      is WHOLE; a per-concept pool's plan is SUBSET{1..n}: those pools are consumed concept by concept, so the
 *      stimulus may be shown with the questions of the concept being practised. Still one pool, on the stimulus.
 *   7. LANGUAGE: the Section's (Spanish for Lectura, Redacción and Matemáticas; English for Inglés).
 * FIGURE has target 1: a geometry figure belongs to one question.
 */
import { PAA_TOPICS } from '@/lib/curriculum/paa/paa-hierarchy';
import { PAA_EXAM_FAMILY } from './paa-backlog';
import { PAA_CELL_POLICY, resolvePaaRequirementCells } from './paa-cells';
import { MOCK_POOLS, PRODUCTION_POOLS, STIMULUS_KINDS, type ProductionPool, type RequirementCell, type StimulusKind } from './requirement-cell';
import { GENERATION_PLAN_VERSION, generationPlanViolations, slotKeyOf, slotsOfUnit, STIMULUS_PLAN_VERSION, stimulusPlanFactsOf, stimulusPlansOf, type GenerationPlan, type GenerationPlanViolation, type GenerationUnit, type ItemSlot, type StimulusPlan } from './stimulus-plan';

export const PAA_STIMULUS_PLAN_POLICY = { id: 'q1-paa-stimulus-plan', version: '1', authority: 'STUDYUS_POLICY' } as const;
/** Policy decision 2: an optional stimulus is never a shared one. */
export const OPTIONAL_STIMULI_ARE_PLANNED_AS_SHARED = false as const;
/** Questions per stimulus, by kind. STUDYUS_POLICY: an editorial target, not an official figure. */
export const PAA_STIMULUS_TARGET_SIZE: Record<StimulusKind, number> = { PASSAGE: 5, PAIRED_PASSAGE: 4, POEM: 3, NUMBERED_TEXT: 5, DRAFT_PARAGRAPH: 5, COMPOSITE: 3, TABLE: 3, GRAPH: 3, DATA_SET: 3, FIGURE: 1 };
export const PAA_STIMULUS_TARGET_SIZE_AUTHORITY = 'STUDYUS_POLICY' as const;
/** The language items of a Section are written in. A fact about the PAA, kept in this PAA module. */
export const PAA_SECTION_LANGUAGE: Record<string, 'es' | 'en'> = { 'paa.sec.lectura': 'es', 'paa.sec.redaccion': 'es', 'paa.sec.matematicas': 'es', 'paa.sec.ingles': 'en' };
export const PAA_PLANNED_ITEMS = 865 as const;
export const PAA_POOL_TOTALS: Record<ProductionPool, number> = { PRACTICE: 183, DIAGNOSTIC: 122, VERIFICATION: 122, REDUCED_MOCK: 88, FULL_MOCK_1: 175, FULL_MOCK_2: 175 };

export const paaLanguageOf = (sectionCode: string): 'es' | 'en' => {
  const language = PAA_SECTION_LANGUAGE[sectionCode];
  if (!language) throw new Error(`PAA_SECTION_HAS_NO_LANGUAGE: ${sectionCode}`);
  return language;
};
const sectionShort = (code: string): string => code.replace('paa.sec.', '');
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const slotOf = (c: RequirementCell, index: number): ItemSlot => ({ slotKey: slotKeyOf(c.cellKey, index), cellKey: c.cellKey, index, intendedPool: c.intendedPool });

/** Round-robin: one element of each queue in turn, queues in the given order, until all are empty. */
function interleave<T>(queues: T[][]): T[] {
  const out: T[] = [];
  for (let round = 0; queues.some((q) => round < q.length); round += 1) for (const q of queues) if (round < q.length) out.push(q[round]);
  return out;
}

/** Rule 4: Topics in turn inside a Domain, Domains in turn inside the bucket. */
function orderBucket(slots: Array<{ slot: ItemSlot; cell: RequirementCell }>): Array<{ slot: ItemSlot; cell: RequirementCell }> {
  const sorted = [...slots].sort((a, b) => cmp(a.cell.topicNodeCode, b.cell.topicNodeCode) || cmp(a.slot.cellKey, b.slot.cellKey) || a.slot.index - b.slot.index);
  const domains = [...new Set(sorted.map((x) => x.cell.domainNodeCode))];
  return interleave(domains.map((d) => {
    const ofDomain = sorted.filter((x) => x.cell.domainNodeCode === d);
    return interleave([...new Set(ofDomain.map((x) => x.cell.topicNodeCode))].map((t) => ofDomain.filter((x) => x.cell.topicNodeCode === t)));
  }));
}

/** Rule 5: chunks of the target size; a trailing chunk of one is rebalanced with the chunk before it. */
export function chunkByTarget<T>(items: readonly T[], target: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += target) chunks.push(items.slice(i, i + target));
  const last = chunks[chunks.length - 1];
  const prev = chunks[chunks.length - 2];
  if (target > 1 && last && prev && last.length === 1 && prev.length > 2) last.unshift(prev.pop()!);
  return chunks;
}

/** Every generation unit, in a stable order: stimulus plans by (pool, Section, kind, number), then standalone units by slot. */
export function buildPaaGenerationPlan(cells: readonly RequirementCell[] = resolvePaaRequirementCells()): GenerationPlan {
  const byKey = new Map(cells.map((c) => [c.cellKey, c]));
  const standalone: GenerationUnit[] = [];
  const buckets = new Map<string, Array<{ slot: ItemSlot; cell: RequirementCell }>>();
  for (const cell of cells) {
    for (let i = 1; i <= cell.count; i += 1) {
      const slot = slotOf(cell, i);
      if (cell.stimulus.class !== 'STIMULUS_REQUIRED') {
        standalone.push({ type: 'STANDALONE', unitKey: `SU|${slot.slotKey}`, slot });
        continue;
      }
      const key = `${cell.intendedPool}|${cell.sectionCode}|${cell.stimulus.kind}`;
      buckets.set(key, [...(buckets.get(key) ?? []), { slot, cell }]);
    }
  }
  const stimulus: GenerationUnit[] = [];
  const bucketKeys = [...buckets.keys()].sort((a, b) => {
    const [pa, sa, ka] = a.split('|');
    const [pb, sb, kb] = b.split('|');
    return PRODUCTION_POOLS.indexOf(pa as ProductionPool) - PRODUCTION_POOLS.indexOf(pb as ProductionPool) || cmp(sa, sb) || STIMULUS_KINDS.indexOf(ka as StimulusKind) - STIMULUS_KINDS.indexOf(kb as StimulusKind);
  });
  for (const key of bucketKeys) {
    const [pool, sectionCode, kind] = key.split('|') as [ProductionPool, string, StimulusKind];
    chunkByTarget(orderBucket(buckets.get(key)!), PAA_STIMULUS_TARGET_SIZE[kind]).forEach((chunk, n) => {
      const memberSlots = chunk.map((x) => x.slot);
      const stimulusPlanId = `SP|${pool}|${sectionShort(sectionCode)}|${kind}|${String(n + 1).padStart(2, '0')}`;
      const plan: StimulusPlan = {
        v: STIMULUS_PLAN_VERSION, stimulusPlanId, examFamily: PAA_EXAM_FAMILY, sectionCode, ...stimulusPlanFactsOf(memberSlots, (k) => byKey.get(k)!), stimulusKind: kind, language: paaLanguageOf(sectionCode), intendedPool: pool,
        integrity: MOCK_POOLS.has(pool) || memberSlots.length === 1 ? { rule: 'WHOLE' } : { rule: 'SUBSET', min: 1, max: memberSlots.length }, memberSlots,
      };
      stimulus.push({ type: 'STIMULUS', unitKey: stimulusPlanId, plan });
    });
  }
  standalone.sort((a, b) => cmp(a.unitKey, b.unitKey));
  return { v: GENERATION_PLAN_VERSION, examFamily: PAA_EXAM_FAMILY, policy: { ...PAA_STIMULUS_PLAN_POLICY }, cellPolicy: { ...PAA_CELL_POLICY }, units: [...stimulus, ...standalone] };
}

export type PaaGenerationPlanViolation = GenerationPlanViolation | 'TOTAL_IS_NOT_865' | 'POOL_TOTAL_MISMATCH' | 'OPTIONAL_STIMULUS_PLANNED_AS_SHARED' | 'LANGUAGE_IS_NOT_THE_SECTIONS' | 'NOT_A_PAA_PLAN';

/** The generic plan checks plus what is specific to the PAA plan: 865 items, the six pool totals, the Section's language. */
export function paaGenerationPlanViolations(plan: GenerationPlan, cells: readonly RequirementCell[] = resolvePaaRequirementCells()): PaaGenerationPlanViolation[] {
  const out = new Set<PaaGenerationPlanViolation>(generationPlanViolations(plan, cells));
  if (out.has('PLAN_SCHEMA_INVALID')) return [...out];
  if (plan.examFamily !== PAA_EXAM_FAMILY) out.add('NOT_A_PAA_PLAN');
  const slots = plan.units.flatMap((u) => slotsOfUnit(u));
  if (slots.length !== PAA_PLANNED_ITEMS) out.add('TOTAL_IS_NOT_865');
  for (const pool of PRODUCTION_POOLS) if (slots.filter((s) => s.intendedPool === pool).length !== PAA_POOL_TOTALS[pool]) out.add('POOL_TOTAL_MISMATCH');
  const byKey = new Map(cells.map((c) => [c.cellKey, c]));
  for (const p of stimulusPlansOf(plan)) {
    if (p.memberSlots.some((s) => byKey.get(s.cellKey)?.stimulus.class === 'STIMULUS_OPTIONAL')) out.add('OPTIONAL_STIMULUS_PLANNED_AS_SHARED');
    if (PAA_SECTION_LANGUAGE[p.sectionCode] !== p.language) out.add('LANGUAGE_IS_NOT_THE_SECTIONS');
  }
  return [...out];
}

export interface PaaGenerationPlanSummary {
  policy: typeof PAA_STIMULUS_PLAN_POLICY;
  items: number;
  units: number;
  standaloneUnits: number;
  standaloneByStimulusClass: Record<string, number>;
  stimulusPlans: number;
  stimulusPlanQuestions: number;
  stimulusPlansByKind: Record<string, number>;
  stimulusPlansByPool: Record<string, number>;
  stimulusPlansByPoolAndKind: Record<string, number>;
  /** How many plans have 1, 2, 3 ... questions, by kind. */
  questionsPerPlan: Record<string, Record<string, number>>;
  itemsByPool: Record<string, number>;
  itemsBySection: Record<string, number>;
  mockSectionTotals: Record<string, number[]>;
  /** One-question plans of a kind whose target is larger: a bucket that held one slot. */
  singleQuestionPlansOfMultiQuestionKinds: string[];
  stimulusPlansCrossingPools: number;
  violations: PaaGenerationPlanViolation[];
}

export function summarizePaaGenerationPlan(plan: GenerationPlan = buildPaaGenerationPlan(), cells: readonly RequirementCell[] = resolvePaaRequirementCells()): PaaGenerationPlanSummary {
  const byKey = new Map(cells.map((c) => [c.cellKey, c]));
  const count = <T>(xs: readonly T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  const plans = stimulusPlansOf(plan);
  const standalone = plan.units.filter((u) => u.type === 'STANDALONE');
  const slots = plan.units.flatMap((u) => slotsOfUnit(u));
  const sections = [...new Set(PAA_TOPICS.map((t) => t.domainCode.split('.')[2]))].map((s) => `paa.sec.${s}`);
  const questionsPerPlan: Record<string, Record<string, number>> = {};
  for (const p of plans) (questionsPerPlan[p.stimulusKind] ??= {})[String(p.questionCount)] = (questionsPerPlan[p.stimulusKind][String(p.questionCount)] ?? 0) + 1;
  return {
    policy: PAA_STIMULUS_PLAN_POLICY, items: slots.length, units: plan.units.length, standaloneUnits: standalone.length,
    standaloneByStimulusClass: count(standalone.flatMap((u) => slotsOfUnit(u)), (s) => byKey.get(s.cellKey)!.stimulus.class),
    stimulusPlans: plans.length, stimulusPlanQuestions: plans.reduce((n, p) => n + p.questionCount, 0), stimulusPlansByKind: count(plans, (p) => p.stimulusKind), stimulusPlansByPool: count(plans, (p) => p.intendedPool),
    stimulusPlansByPoolAndKind: count(plans, (p) => `${p.intendedPool}|${p.stimulusKind}`), questionsPerPlan, itemsByPool: count(slots, (s) => s.intendedPool), itemsBySection: count(slots, (s) => byKey.get(s.cellKey)!.sectionCode),
    mockSectionTotals: Object.fromEntries([...MOCK_POOLS].sort().map((pool) => [pool, sections.map((sec) => slots.filter((s) => s.intendedPool === pool && byKey.get(s.cellKey)!.sectionCode === sec).length)])),
    singleQuestionPlansOfMultiQuestionKinds: plans.filter((p) => p.questionCount === 1 && PAA_STIMULUS_TARGET_SIZE[p.stimulusKind] > 1).map((p) => p.stimulusPlanId),
    stimulusPlansCrossingPools: plans.filter((p) => new Set(p.memberSlots.map((s) => byKey.get(s.cellKey)!.intendedPool)).size > 1).length,
    violations: paaGenerationPlanViolations(plan, cells),
  };
}
