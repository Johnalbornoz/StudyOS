/**
 * UX/CANON-R1 PART A/B -- the ONE presentation authority for canonical
 * difficulty. StudyUs already determines difficulty canonically
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

/** "Dificultad: nivel 2 de 5, Básico" -- the accessible (screen-reader) text (PART C/S). Never relies on color/glyph alone. */
export function formatDifficultyAccessible(presentation: DifficultyPresentation, t: T): string {
  return `${t['difficulty.label']}: ${t['difficulty.levelWord']} ${presentation.value} ${t['difficulty.of']} ${presentation.max}, ${presentation.label}`;
}

export type DifficultyTrend = 'up' | 'down';

/**
 * Model for the visual DifficultyIndicator (5 horizontal segments + tier
 * label). Presentation only: renders the canonical value/range it is
 * given; never computes difficulty. `trend` is reserved for surfacing an
 * adaptive change later (↑/↓) -- callers pass nothing today.
 */
export interface DifficultyIndicatorModel {
  min: number;
  max: number;
  /** One entry per segment (5): 'filled' up to `min`, 'range' from min+1 to max, else 'empty'. */
  segments: Array<'filled' | 'range' | 'empty'>;
  /** Visible tier label ("Básico", or "Intermedio – Avanzado" for a range) -- never "X/5". */
  label: string;
  /** Screen-reader text ("Dificultad: nivel 2 de 5, Básico"). */
  accessible: string;
  trend: DifficultyTrend | null;
  /** Screen-reader description of the trend, when present. */
  trendAccessible: string | null;
}

export function getDifficultyIndicatorModel(
  input: { value: number } | { range: { min: number; max: number } },
  t: T,
  trend: DifficultyTrend | null = null,
): DifficultyIndicatorModel {
  const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
  const lo = 'value' in input ? clamp(input.value) : clamp(Math.min(input.range.min, input.range.max));
  const hi = 'value' in input ? lo : clamp(Math.max(input.range.min, input.range.max));
  const segments = Array.from({ length: 5 }, (_, i) => (i < lo ? 'filled' : i < hi ? 'range' : 'empty') as 'filled' | 'range' | 'empty');
  const tier = (n: number) => t[LEVEL_KEYS[n - 1]];
  const label = lo === hi ? tier(lo) : `${tier(lo)} – ${tier(hi)}`;
  const accessible =
    lo === hi
      ? formatDifficultyAccessible({ value: lo, max: 5, label: tier(lo) }, t)
      : `${t['difficulty.label']}: ${t['difficulty.levelWord']} ${lo} ${t['difficulty.to']} ${hi} ${t['difficulty.of']} 5, ${tier(lo)} ${t['difficulty.to']} ${tier(hi)}`;
  const trendAccessible = trend === 'up' ? t['difficulty.trendUp'] : trend === 'down' ? t['difficulty.trendDown'] : null;
  return { min: lo, max: hi, segments, label, accessible, trend, trendAccessible };
}
