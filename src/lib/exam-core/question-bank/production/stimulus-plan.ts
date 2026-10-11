/**
 * QB-R2C -- the Stimulus Plan and the Generation Unit: WHICH planned items are written together (pure contract, no IO).
 *
 *   RequirementCell (what is wanted) -> GenerationUnit (what is written in one go) -> GenerationRequest -> ...
 *
 * QB-R2B found the defect this module closes: a cell is one (pool, Topic, concept), a shared stimulus spans several
 * cells, and nothing said which cells share one -- so the pilot planned the questions of one text into four pools.
 * Pool membership of a stimulus-bound item is on the STIMULUS, so a stimulus group is in one pool as a whole.
 *
 * HARD INVARIANT  ONE_STIMULUS_PLAN = ONE_POOL
 *   A stimulus plan names exactly one pool and every member slot restates the pool of its cell. The schema refuses
 *   a plan with a slot of another pool; `generationPlanViolations` refuses a slot whose restated pool is not its
 *   cell's. A cell never chooses its stimulus: the cells sharing a stimulus inherit the plan's pool, which is theirs.
 *
 * NAMING. `requirement-cell.ts` already exports a `StimulusPlan`: that one is the CELL's stimulus requirement
 * (class + kind). This module's `StimulusPlan` is the planning primitive (one stimulus, its questions, its pool).
 * They are different things with one name for historical reasons; the cell's shape is left untouched so that the
 * resolved cells and the QB-R2B artifacts stay byte-identical.
 *
 * An ITEM SLOT is one of the `count` items a cell needs: (cell key, index 1..count). A GENERATION UNIT is either
 *   STANDALONE  one item slot of a cell that needs no shared stimulus, or
 *   STIMULUS    one StimulusPlan: one stimulus and all of its questions.
 * A generation plan is exact when every item slot of every cell is in exactly one unit.
 */
import { z } from 'zod';
import { DIFFICULTY_BANDS, PRODUCTION_POOLS, RESPONSE_FORMATS, STIMULUS_KINDS, type RequirementCell } from './requirement-cell';

export const STIMULUS_PLAN_VERSION = 1 as const;
export const GENERATION_PLAN_VERSION = 1 as const;
/** The invariant, by name, so that reports and tests can cite it. */
export const ONE_STIMULUS_PLAN_ONE_POOL = 'ONE_STIMULUS_PLAN = ONE_POOL' as const;

const ID = z.string().trim().min(1).max(200);

export const slotKeyOf = (cellKey: string, index: number): string => `${cellKey}#${index}`;

/** One of the items a cell needs. `intendedPool` restates the cell's pool so that the plan can be checked on its own. */
export const ItemSlotSchema = z
  .strictObject({ slotKey: ID, cellKey: ID, index: z.number().int().min(1), intendedPool: z.enum(PRODUCTION_POOLS) })
  .superRefine((s, ctx) => {
    if (s.slotKey !== slotKeyOf(s.cellKey, s.index)) ctx.addIssue({ code: 'custom', path: ['slotKey'], message: 'SLOT_KEY_IS_NOT_CELL_AND_INDEX' });
  });
export type ItemSlot = z.infer<typeof ItemSlotSchema>;

/** WHOLE: the stimulus is delivered with all its questions. SUBSET: with between min and max of them. */
export const StimulusIntegrityRuleSchema = z.discriminatedUnion('rule', [
  z.strictObject({ rule: z.literal('WHOLE') }),
  z.strictObject({ rule: z.literal('SUBSET'), min: z.number().int().min(1), max: z.number().int().min(1) }),
]);

const countsOf = <T extends readonly [string, ...string[]]>(keys: T) => z.strictObject(Object.fromEntries(keys.map((k) => [k, z.number().int().min(0)])) as { [K in T[number]]: z.ZodNumber });

export const StimulusPlanSchema = z
  .strictObject({
    v: z.literal(STIMULUS_PLAN_VERSION),
    /** Stable and deterministic: the same cells and the same policy version give the same id. */
    stimulusPlanId: ID,
    examFamily: ID,
    sectionCode: ID,
    domainCodes: z.array(ID).min(1),
    topicCodes: z.array(ID).min(1),
    /** Stable ids of the PRIMARY concepts of the member cells. */
    targetConceptStableIds: z.array(ID).min(1),
    stimulusKind: z.enum(STIMULUS_KINDS),
    language: ID,
    /** Exactly ONE pool. */
    intendedPool: z.enum(PRODUCTION_POOLS),
    questionCount: z.number().int().min(1),
    integrity: StimulusIntegrityRuleSchema,
    difficultyMix: countsOf(DIFFICULTY_BANDS),
    responseFormatMix: countsOf(RESPONSE_FORMATS),
    memberSlots: z.array(ItemSlotSchema).min(1),
  })
  .superRefine((p, ctx) => {
    const sum = (m: Record<string, number>) => Object.values(m).reduce((n, x) => n + x, 0);
    // ONE_STIMULUS_PLAN = ONE_POOL
    p.memberSlots.forEach((s, i) => {
      if (s.intendedPool !== p.intendedPool) ctx.addIssue({ code: 'custom', path: ['memberSlots', i, 'intendedPool'], message: 'STIMULUS_PLAN_CROSSES_POOLS' });
    });
    if (new Set(p.memberSlots.map((s) => s.slotKey)).size !== p.memberSlots.length) ctx.addIssue({ code: 'custom', path: ['memberSlots'], message: 'DUPLICATE_SLOT' });
    if (p.questionCount !== p.memberSlots.length) ctx.addIssue({ code: 'custom', path: ['questionCount'], message: 'QUESTION_COUNT_IS_NOT_THE_SLOTS' });
    if (sum(p.difficultyMix) !== p.questionCount) ctx.addIssue({ code: 'custom', path: ['difficultyMix'], message: 'MIX_DOES_NOT_SUM_TO_QUESTIONS' });
    if (sum(p.responseFormatMix) !== p.questionCount) ctx.addIssue({ code: 'custom', path: ['responseFormatMix'], message: 'MIX_DOES_NOT_SUM_TO_QUESTIONS' });
    if (p.integrity.rule === 'SUBSET' && (p.integrity.min > p.integrity.max || p.integrity.max > p.questionCount)) ctx.addIssue({ code: 'custom', path: ['integrity'], message: 'SUBSET_BOUNDS_INVALID' });
    for (const k of ['domainCodes', 'topicCodes', 'targetConceptStableIds'] as const) if (new Set(p[k]).size !== p[k].length) ctx.addIssue({ code: 'custom', path: [k], message: 'LISTED_TWICE' });
  });
export type StimulusPlan = z.infer<typeof StimulusPlanSchema>;

export const GenerationUnitSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('STANDALONE'), unitKey: ID, slot: ItemSlotSchema }),
  z.strictObject({ type: z.literal('STIMULUS'), unitKey: ID, plan: StimulusPlanSchema }),
]);
export type GenerationUnit = z.infer<typeof GenerationUnitSchema>;

export const GenerationPlanSchema = z.strictObject({
  v: z.literal(GENERATION_PLAN_VERSION),
  examFamily: ID,
  /** The grouping policy that produced the units, and the cell policy the cells came from. */
  policy: z.strictObject({ id: ID, version: ID, authority: z.literal('STUDYUS_POLICY') }),
  cellPolicy: z.strictObject({ id: ID, version: ID }),
  units: z.array(GenerationUnitSchema),
});
export type GenerationPlan = z.infer<typeof GenerationPlanSchema>;

export const slotsOfUnit = (u: GenerationUnit): readonly ItemSlot[] => (u.type === 'STANDALONE' ? [u.slot] : u.plan.memberSlots);
export const stimulusPlansOf = (plan: GenerationPlan): StimulusPlan[] => plan.units.flatMap((u) => (u.type === 'STIMULUS' ? [u.plan] : []));

/** What a stimulus plan says about its cells, computed from the cells: the plan must state exactly this. */
export function stimulusPlanFactsOf(slots: readonly ItemSlot[], cellOf: (cellKey: string) => RequirementCell): Pick<StimulusPlan, 'domainCodes' | 'topicCodes' | 'targetConceptStableIds' | 'questionCount' | 'difficultyMix' | 'responseFormatMix'> {
  const cells = slots.map((s) => cellOf(s.cellKey));
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const mix = <K extends string>(keys: readonly K[], f: (c: RequirementCell) => K) => Object.fromEntries(keys.map((k) => [k, cells.filter((c) => f(c) === k).length])) as Record<K, number>;
  return {
    domainCodes: uniq(cells.map((c) => c.domainNodeCode)), topicCodes: uniq(cells.map((c) => c.topicNodeCode)), targetConceptStableIds: uniq(cells.map((c) => c.primaryConcept.stableId)), questionCount: slots.length,
    difficultyMix: mix(DIFFICULTY_BANDS, (c) => c.difficultyBand), responseFormatMix: mix(RESPONSE_FORMATS, (c) => c.responseFormat),
  };
}

export type GenerationPlanViolation =
  | 'PLAN_SCHEMA_INVALID' | 'DUPLICATE_UNIT_KEY' | 'DUPLICATE_STIMULUS_PLAN_ID' | 'UNKNOWN_CELL' | 'SLOT_INDEX_OUT_OF_RANGE' | 'SLOT_POOL_IS_NOT_THE_CELLS' | 'SLOT_IN_NO_UNIT' | 'SLOT_IN_TWO_UNITS'
  | 'STIMULUS_PLAN_CROSSES_POOLS' | 'STIMULUS_PLAN_CROSSES_SECTIONS' | 'STIMULUS_PLAN_CROSSES_EXAM_FAMILIES' | 'STIMULUS_PLAN_KIND_IS_NOT_THE_CELLS' | 'STIMULUS_PLAN_FACTS_DO_NOT_MATCH_CELLS'
  | 'STANDALONE_UNIT_ON_A_STIMULUS_REQUIRED_CELL' | 'STIMULUS_UNIT_ON_A_CELL_THAT_REQUIRES_NONE';

/**
 * The plan against the cells it was made from. Empty = every item slot of every cell is in exactly one unit, and
 * no stimulus plan crosses a pool, a Section or a stimulus kind. The check reads the CELLS for the pool, never
 * only what the plan restates.
 */
export function generationPlanViolations(plan: unknown, cells: readonly RequirementCell[]): GenerationPlanViolation[] {
  const out = new Set<GenerationPlanViolation>();
  const parsed = GenerationPlanSchema.safeParse(plan);
  if (!parsed.success) {
    // A cross-pool plan is refused by the schema; say so by name instead of only "schema invalid".
    if (parsed.error.issues.some((i) => i.message === 'STIMULUS_PLAN_CROSSES_POOLS')) out.add('STIMULUS_PLAN_CROSSES_POOLS');
    out.add('PLAN_SCHEMA_INVALID');
    return [...out];
  }
  const byKey = new Map(cells.map((c) => [c.cellKey, c]));
  const seen = new Map<string, number>();
  if (new Set(parsed.data.units.map((u) => u.unitKey)).size !== parsed.data.units.length) out.add('DUPLICATE_UNIT_KEY');
  const planIds = stimulusPlansOf(parsed.data).map((p) => p.stimulusPlanId);
  if (new Set(planIds).size !== planIds.length) out.add('DUPLICATE_STIMULUS_PLAN_ID');
  for (const u of parsed.data.units) {
    const slots = slotsOfUnit(u);
    let known = true;
    for (const s of slots) {
      const cell = byKey.get(s.cellKey);
      if (!cell) {
        out.add('UNKNOWN_CELL');
        known = false;
        continue;
      }
      if (s.index > cell.count) out.add('SLOT_INDEX_OUT_OF_RANGE');
      if (s.intendedPool !== cell.intendedPool) out.add('SLOT_POOL_IS_NOT_THE_CELLS');
      seen.set(s.slotKey, (seen.get(s.slotKey) ?? 0) + 1);
    }
    if (!known) continue;
    const unitCells = slots.map((s) => byKey.get(s.cellKey)!);
    if (u.type === 'STANDALONE') {
      if (unitCells[0].stimulus.class === 'STIMULUS_REQUIRED') out.add('STANDALONE_UNIT_ON_A_STIMULUS_REQUIRED_CELL');
      continue;
    }
    const p = u.plan;
    if (unitCells.some((c) => c.intendedPool !== p.intendedPool)) out.add('STIMULUS_PLAN_CROSSES_POOLS');
    if (unitCells.some((c) => c.sectionCode !== p.sectionCode)) out.add('STIMULUS_PLAN_CROSSES_SECTIONS');
    if (unitCells.some((c) => c.examFamily !== p.examFamily)) out.add('STIMULUS_PLAN_CROSSES_EXAM_FAMILIES');
    if (unitCells.some((c) => c.stimulus.class === 'STANDALONE')) out.add('STIMULUS_UNIT_ON_A_CELL_THAT_REQUIRES_NONE');
    if (unitCells.some((c) => c.stimulus.class !== 'STANDALONE' && c.stimulus.kind !== p.stimulusKind)) out.add('STIMULUS_PLAN_KIND_IS_NOT_THE_CELLS');
    const facts = stimulusPlanFactsOf(p.memberSlots, (k) => byKey.get(k)!);
    if (JSON.stringify(facts) !== JSON.stringify({ domainCodes: p.domainCodes, topicCodes: p.topicCodes, targetConceptStableIds: p.targetConceptStableIds, questionCount: p.questionCount, difficultyMix: p.difficultyMix, responseFormatMix: p.responseFormatMix })) out.add('STIMULUS_PLAN_FACTS_DO_NOT_MATCH_CELLS');
  }
  for (const c of cells) {
    for (let i = 1; i <= c.count; i += 1) {
      const n = seen.get(slotKeyOf(c.cellKey, i)) ?? 0;
      if (n === 0) out.add('SLOT_IN_NO_UNIT');
      if (n > 1) out.add('SLOT_IN_TWO_UNITS');
    }
  }
  return [...out];
}
