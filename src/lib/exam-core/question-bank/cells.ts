/**
 * Question Bank Factory -- BLUEPRINT CELLS (pure).
 *
 * A cell is one combination of requirements a valid form needs, derived from
 * the governed, versioned blueprint -- never invented: the blueprint targets
 * of one exam version that share component (paper / section / domain),
 * learning objective (content / skill / AO / competency node), question type,
 * difficulty band and command term collapse into one cell whose REDUCED
 * positions are the blueprint's own count.
 *
 * FULL-LENGTH positions: when the blueprint already reaches the component's
 * published length, full = reduced (BLUEPRINT_IS_FULL). When it is shorter
 * (e.g. PAA: 36 of 175 items), the published item count of each component is
 * apportioned over its cells in proportion to the governed blueprint weights
 * (largest remainder, deterministic) -- a StudyUs assembly policy derived from
 * the blueprint, NOT an official per-skill distribution, and labelled so.
 * Without a published length, the full form is UNKNOWN and is never claimed.
 */
import { constraintSignature, normalizeConstraints, type SlotConstraint } from '../slot-constraints';

export interface BlueprintTargetInput {
  id: string;
  learningObjectiveId: string;
  objectiveCode: string;
  objectiveDescription?: string | null;
  assessmentComponentId: string;
  questionType: string | null;
  difficultyMin: number | null;
  difficultyMax: number | null;
  commandTerm: string | null;
  /** Structured slot constraints (competence, content category, ...): a separate cell per combination. */
  constraints?: SlotConstraint[];
}

export interface ComponentInput {
  id: string;
  sectionKey: string;
  name: string;
  order: number;
  officialItemCount: number | null;
  maxMarks: number | null;
  simulationCapable: boolean;
}

export type LengthBasis = 'BLUEPRINT_IS_FULL' | 'ITEMS_PROPORTIONAL' | 'MARKS_ESTIMATED' | 'UNKNOWN';

export interface BlueprintCell {
  cellKey: string;
  componentId: string;
  sectionKey: string;
  componentName: string;
  componentOrder: number;
  learningObjectiveId: string;
  objectiveCode: string;
  objectiveDescription: string | null;
  questionType: string | null;
  difficultyRange: { min: number; max: number } | null;
  commandTerm: string | null;
  /** Structured slot constraints shared by the cell's slots (absent = none). */
  constraints?: SlotConstraint[];
  /** Positions of one form of the governed (possibly reduced) blueprint. */
  reducedPositions: number;
  /** Positions of one full-length form (see header). */
  fullPositions: number;
  lengthBasis: LengthBasis;
  targetIds: string[];
}

export function cellKeyOf(sectionKey: string, objectiveCode: string, questionType: string | null, dmin: number | null, dmax: number | null, commandTerm: string | null, constraints?: SlotConstraint[] | null): string {
  // Slots with structured constraints form their own cells; a key without constraints is unchanged (existing cells keep their keys).
  const sig = constraintSignature(constraints);
  return [sectionKey, objectiveCode, questionType ?? '*', `${dmin ?? '*'}-${dmax ?? '*'}`, commandTerm ?? '*', ...(sig ? [sig] : [])].join('|');
}

/** Largest-remainder apportionment of `total` over `weights` (ties broken by order). Sum is exactly `total`. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1;
  return out;
}

/**
 * @param marksByCell marks per position of the cell (its largest item, as the catalogue readiness counts them); only used when a component publishes marks but no item count.
 */
export function deriveBlueprintCells(targets: BlueprintTargetInput[], components: ComponentInput[], marksByCell: Record<string, number> = {}): BlueprintCell[] {
  const compById = new Map(components.map((c) => [c.id, c]));
  const cells = new Map<string, BlueprintCell>();
  for (const t of targets) {
    const comp = compById.get(t.assessmentComponentId);
    if (!comp) continue;
    const key = cellKeyOf(comp.sectionKey, t.objectiveCode, t.questionType, t.difficultyMin, t.difficultyMax, t.commandTerm, t.constraints);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        cellKey: key,
        componentId: comp.id,
        sectionKey: comp.sectionKey,
        componentName: comp.name,
        componentOrder: comp.order,
        learningObjectiveId: t.learningObjectiveId,
        objectiveCode: t.objectiveCode,
        objectiveDescription: t.objectiveDescription ?? null,
        questionType: t.questionType,
        difficultyRange: t.difficultyMin !== null && t.difficultyMax !== null ? { min: t.difficultyMin, max: t.difficultyMax } : null,
        commandTerm: t.commandTerm,
        ...(t.constraints?.length ? { constraints: normalizeConstraints(t.constraints) } : {}),
        reducedPositions: 0,
        fullPositions: 0,
        lengthBasis: 'UNKNOWN',
        targetIds: [],
      };
      cells.set(key, cell);
    }
    cell.reducedPositions += 1;
    cell.targetIds.push(t.id);
  }

  const out = [...cells.values()];
  for (const comp of components) {
    const mine = out.filter((c) => c.componentId === comp.id);
    if (mine.length === 0) continue;
    const reducedTotal = mine.reduce((n, c) => n + c.reducedPositions, 0);
    let basis: LengthBasis = 'UNKNOWN';
    let fullTotal = reducedTotal;
    if (comp.officialItemCount) {
      basis = reducedTotal >= comp.officialItemCount ? 'BLUEPRINT_IS_FULL' : 'ITEMS_PROPORTIONAL';
      fullTotal = Math.max(reducedTotal, comp.officialItemCount);
    } else if (comp.maxMarks) {
      const plannedMarks = mine.reduce((n, c) => n + c.reducedPositions * (marksByCell[c.cellKey] ?? 1), 0);
      if (plannedMarks >= comp.maxMarks) basis = 'BLUEPRINT_IS_FULL';
      else {
        basis = 'MARKS_ESTIMATED';
        fullTotal = Math.ceil(reducedTotal * (comp.maxMarks / Math.max(plannedMarks, 1e-9)));
      }
    }
    const full = basis === 'BLUEPRINT_IS_FULL' || basis === 'UNKNOWN' ? mine.map((c) => c.reducedPositions) : apportion(fullTotal, mine.map((c) => c.reducedPositions));
    mine.forEach((c, i) => {
      // Never fewer than the governed blueprint itself asks for.
      c.fullPositions = Math.max(c.reducedPositions, full[i]);
      c.lengthBasis = basis;
    });
  }
  return out.sort((a, b) => a.componentOrder - b.componentOrder || a.objectiveCode.localeCompare(b.objectiveCode) || a.cellKey.localeCompare(b.cellKey));
}

/** The full-length form can be DELIVERED by the current engine only when the governed blueprint is itself full length. */
export function fullLengthDeliverable(cells: BlueprintCell[]): boolean {
  return cells.length > 0 && cells.every((c) => c.lengthBasis === 'BLUEPRINT_IS_FULL');
}
