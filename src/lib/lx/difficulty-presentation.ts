/**
 * UX/CANON-R1 PART A/B -- the ONE presentation authority for canonical
 * difficulty. StudyUS already determines difficulty canonically
 * (`resolveTargetDifficulty` / a question's own `difficulty` field,
 * 1-5) -- this module NEVER re-derives, re-computes, or overrides that
 * number. It only maps an ALREADY-canonical value to a localized,
 * learner-facing label. Difficulty is SYSTEM-DEFINED, LEARNER-VISIBLE,
 * and NOT LEARNER-EDITABLE: this file introduces no selector, slider,
 * preference, or "make easier/harder" affordance, and never will --
 * that would require a second difficulty algorithm, which this
 * engagement's own principle forbids introducing.
 */
import type { getMessages } from '@/lib/i18n/messages';

type T = ReturnType<typeof getMessages>;

export interface DifficultyPresentation {
  /** The canonical difficulty, clamped to [1,5] -- never invented, only defensively bounded against a malformed upstream value. */
  value: number;
  max: 5;
  /** Localized tier label ("Alta"/"High"/...), read from ACTIVITY_LANGUAGE messages (PART F) -- the caller passes the activity-language `t`, never the shell/interface one. */
  label: string;
}

const LEVEL_KEYS = ['difficulty.level1', 'difficulty.level2', 'difficulty.level3', 'difficulty.level4', 'difficulty.level5'] as const;

/** Pure. `t` must be the ACTIVITY-language message set (PART F) -- never GLOBAL_INTERFACE_LANGUAGE's. */
export function getDifficultyPresentation(difficulty: number, t: T): DifficultyPresentation {
  const value = Math.max(1, Math.min(5, Math.round(difficulty)));
  return { value, max: 5, label: t[LEVEL_KEYS[value - 1]] };
}

/** "Dificultad 4/5 · Alta" -- the compact visible text for the active-question surface (PART C). */
export function formatDifficultyCompact(presentation: DifficultyPresentation, t: T): string {
  return `${t['difficulty.label']} ${presentation.value}/${presentation.max} · ${presentation.label}`;
}

/** "Dificultad trabajada: 4/5 · Alta" (or a "3–4/5" range) -- Results (PART D). `range` is [min,max] canonical difficulty across the activity's questions; a single value when they agree. */
export function formatDifficultyWorked(t: T, range: { min: number; max: number }): string {
  const lo = Math.max(1, Math.min(5, Math.round(range.min)));
  const hi = Math.max(1, Math.min(5, Math.round(range.max)));
  const scale = lo === hi ? `${lo}/5` : `${lo}–${hi}/5`;
  const suffix = lo === hi ? ` · ${t[LEVEL_KEYS[lo - 1]]}` : '';
  return `${t['difficulty.workedLabel']}: ${scale}${suffix}`;
}

/** "Dificultad 4 de 5, Alta" -- the accessible (screen-reader) text (PART C/S). Never relies on color/glyph alone. */
export function formatDifficultyAccessible(presentation: DifficultyPresentation, t: T): string {
  return `${t['difficulty.label']} ${presentation.value} ${t['difficulty.of']} ${presentation.max}, ${presentation.label}`;
}
