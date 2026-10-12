/**
 * A difficulty the Student asks for -- a constraint on what is SELECTED, never a reason to produce content.
 *
 * The vocabulary is the Question Bank's own item band (`DifficultyBand` in quality.ts: LOW / MEDIUM / HIGH),
 * the one inventory, review and demand already use. An item's difficulty is recorded on the 1-5 scale, and
 * `bandOf` is the one place that groups that scale into bands (1-2, 3, 4-5). Nothing here restates those cut
 * points: whether an item is of a band, and the levels a band holds, are both read from `bandOf`.
 *
 * An item of UNKNOWN difficulty is of no band: it is never assumed to be the one asked for.
 *
 * Pure.
 */
import { bandOf, type DifficultyBand } from './quality';

export const REQUESTED_DIFFICULTY_BANDS = ['LOW', 'MEDIUM', 'HIGH'] as const satisfies readonly DifficultyBand[];
export type RequestedDifficultyBand = (typeof REQUESTED_DIFFICULTY_BANDS)[number];

export const isRequestedDifficultyBand = (v: unknown): v is RequestedDifficultyBand => typeof v === 'string' && (REQUESTED_DIFFICULTY_BANDS as readonly string[]).includes(v);

const ITEM_DIFFICULTY_LEVELS = [1, 2, 3, 4, 5] as const;

/** The levels of the 1-5 item scale a band holds, as `bandOf` groups them. */
export function requestedDifficultyRange(band: RequestedDifficultyBand): { min: number; max: number } {
  const levels = ITEM_DIFFICULTY_LEVELS.filter((level) => bandOf(level) === band);
  return { min: levels[0], max: levels[levels.length - 1] };
}

/** Is an item of this recorded difficulty of the requested band? Unknown => no. */
export function meetsRequestedDifficulty(band: RequestedDifficultyBand, difficulty: number | null | undefined): boolean {
  return bandOf(difficulty) === band;
}
