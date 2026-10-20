/**
 * Blueprint SLOT CONSTRAINTS -- structured assembly requirements of one required slot (pure).
 *
 * OWNERSHIP (architecture decision, 2026-10-05): this is the Exam Core structural contract owned by the
 * Blueprint Engine -- it DEFINES what a slot requires (quantity, competence, content category, marks, ...,
 * with the allocation provenance in ComponentDefinition.blueprintSpecification). The Question Bank CONSUMES
 * it to evaluate fulfillment (eligibility, coverage, readiness, certification). There is no second model:
 * Blueprint V2 (the exam-core Blueprint V2 compiler) compiles cells and eligibility predicates from this module.
 *
 * A competence x content combination (e.g. "Formulación y ejecución x Geometría") is NOT a learning
 * objective: it is an Exam Blueprint assembly constraint. A slot keeps its learning objective (what it
 * measures, linked to the canonical curriculum) and its dedicated columns (question type, difficulty band,
 * command term), and MAY add structured dimensions:
 *
 *   constraints: [{ dimension: 'COMPETENCE', value: 'FORMULACION_Y_EJECUCION' },
 *                 { dimension: 'CONTENT_CATEGORY', value: 'GEOMETRIA' }]
 *
 * An item satisfies a slot only if EVERY declared dimension matches (no fallback: right competence +
 * wrong content is not eligible). Item values come from the item's own structured tags
 * (`content.tags.*`, `content.marks`), normalized to the same deterministic key.
 *
 * Values are keys of the framework's own labels (`dimensionKey`): accents removed, upper snake case, so
 * "Álgebra y cálculo" -> ALGEBRA_Y_CALCULO. No vocabulary is invented here.
 */
import { z } from 'zod';

export const SLOT_DIMENSIONS = ['COMPETENCE', 'CONTENT_CATEGORY', 'ASSESSMENT_OBJECTIVE', 'PROCESS', 'CONTEXT', 'MARKS'] as const;
export type SlotDimension = (typeof SLOT_DIMENSIONS)[number];

export interface SlotConstraint {
  dimension: SlotDimension;
  value: string;
}

/** Deterministic key of a framework label: "Formulación y ejecución" -> FORMULACION_Y_EJECUCION. */
export function dimensionKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const SlotConstraintSchema = z.object({
  dimension: z.enum(SLOT_DIMENSIONS),
  value: z.string().min(1).max(80).regex(/^[A-Z0-9][A-Z0-9_]*$/, 'value must be a dimension key (dimensionKey(label))'),
});

/** Canonical form: sorted by dimension, one value per dimension (throws on a contradiction). */
export function normalizeConstraints(cs: readonly SlotConstraint[] | null | undefined): SlotConstraint[] {
  const byDim = new Map<SlotDimension, string>();
  for (const c of cs ?? []) {
    const prev = byDim.get(c.dimension);
    if (prev !== undefined && prev !== c.value) throw new Error(`CONTRADICTORY_SLOT_CONSTRAINT:${c.dimension}`);
    byDim.set(c.dimension, c.value);
  }
  return SLOT_DIMENSIONS.filter((d) => byDim.has(d)).map((d) => ({ dimension: d, value: byDim.get(d)! }));
}

/** Stable signature of a slot's constraints ('' when none): COMPETENCE=X;CONTENT_CATEGORY=Y. */
export function constraintSignature(cs: readonly SlotConstraint[] | null | undefined): string {
  return normalizeConstraints(cs).map((c) => `${c.dimension}=${c.value}`).join(';');
}

/** Reads constraints persisted as jsonb (absent / malformed -> none, never a guess). */
export function constraintsFromJson(raw: unknown): SlotConstraint[] {
  const parsed = z.array(SlotConstraintSchema).safeParse(raw);
  return parsed.success ? normalizeConstraints(parsed.data) : [];
}

export type ItemDimensionValues = Partial<Record<SlotDimension, string>>;

/**
 * The structured dimension values an item declares (from its tags and marks). Pass `marks` when known
 * (examItemMarks: a multi-part item's marks are the sum of its parts, not `content.marks`).
 */
export function itemDimensionValues(content: { tags?: Record<string, unknown> | null; marks?: number | null } | null | undefined, marks?: number | null): ItemDimensionValues {
  const t = (content?.tags ?? {}) as Record<string, unknown>;
  const out: ItemDimensionValues = {};
  const put = (d: SlotDimension, v: unknown) => {
    if (typeof v === 'string' && v.trim()) out[d] = dimensionKey(v);
  };
  put('COMPETENCE', t.competency);
  put('CONTENT_CATEGORY', t.contentCategory);
  put('ASSESSMENT_OBJECTIVE', t.assessmentObjective);
  put('PROCESS', t.process);
  put('CONTEXT', t.context);
  const m = marks ?? content?.marks;
  if (typeof m === 'number' && m > 0) out.MARKS = String(m);
  return out;
}

/** Dimensions of the slot the item does NOT satisfy (empty = satisfies every declared dimension). */
export function constraintMismatches(cs: readonly SlotConstraint[] | null | undefined, item: ItemDimensionValues | null | undefined): SlotDimension[] {
  return normalizeConstraints(cs)
    .filter((c) => item?.[c.dimension] !== c.value)
    .map((c) => c.dimension);
}

/**
 * A declared blueprint allocation vs the slots that realise it (signature -> slot count). Pure, shared by the
 * configuration validator and the certification gate. Empty = the slots realise every declared total exactly.
 */
export function blueprintAllocationProblems(
  spec: { margins?: Array<{ dimension: string; totals: Record<string, number> }>; cells?: { counts: Array<{ constraints: Array<{ dimension: string; value: string }>; count: number }> } } | null | undefined,
  signatures: Map<string, number>
): string[] {
  const out: string[] = [];
  if (!spec) return out;
  if (spec.cells) {
    const expected = new Map(spec.cells.counts.map((c) => [constraintSignature(c.constraints as never), c.count]));
    for (const [sig, n] of expected) if ((signatures.get(sig) ?? 0) !== n) out.push(`BLUEPRINT_CELL_MISMATCH ${sig}: declared ${n}, slots ${signatures.get(sig) ?? 0}`);
    for (const [sig, n] of signatures) if (!expected.has(sig)) out.push(`BLUEPRINT_UNDECLARED_CELL ${sig || '(no constraints)'}: ${n} slots`);
  }
  for (const m of spec.margins ?? []) {
    const actual = new Map<string, number>();
    for (const [sig, n] of signatures) {
      const v = sig.split(';').find((kv) => kv.startsWith(`${m.dimension}=`))?.slice(m.dimension.length + 1) ?? null;
      if (v) actual.set(v, (actual.get(v) ?? 0) + n);
    }
    for (const [v, n] of Object.entries(m.totals)) if ((actual.get(v) ?? 0) !== n) out.push(`BLUEPRINT_MARGIN_MISMATCH ${m.dimension}=${v}: declared ${n}, slots ${actual.get(v) ?? 0}`);
    for (const [v, n] of actual) if (!(v in m.totals)) out.push(`BLUEPRINT_UNDECLARED_MARGIN ${m.dimension}=${v}: ${n} slots`);
  }
  return out;
}
