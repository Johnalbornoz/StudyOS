import type { getMessages } from '@/lib/i18n/messages';
import { getDifficultyIndicatorModel, type DifficultyTrend } from '@/lib/lx/difficulty-presentation';

/** The messages type the indicator renders with (the caller's activity-language `at`). */
export type DifficultyMessages = ReturnType<typeof getMessages>;

/**
 * Visual difficulty indicator for every Learning Engine activity:
 * "Dificultad" + 5 horizontal segments + tier label (Inicial, Básico,
 * Intermedio, Avanzado, Reto). Never shows "X/5" visually; screen readers
 * get "Dificultad: nivel 2 de 5, Básico". Presentation only -- it renders
 * the canonical difficulty (or range) it is given and never computes one.
 *
 * `t` follows the page's language rule: inside an activity, the
 * activity-language messages (`at`, LX-4P-R3), which are the interface
 * language unless the activity itself is in another language.
 *
 * `trend` (↑/↓) is ready for surfacing an adaptive change; nothing passes
 * it yet. Color is never the only signal (label + sr text carry it all).
 */
export default function DifficultyIndicator({
  t,
  value,
  range,
  trend = null,
  size = 'sm',
}: {
  t: ReturnType<typeof getMessages>;
  value?: number;
  range?: { min: number; max: number };
  trend?: DifficultyTrend | null;
  size?: 'sm' | 'xs';
}) {
  const model = getDifficultyIndicatorModel(range ? { range } : { value: value ?? 1 }, t, trend);
  const segW = size === 'xs' ? 10 : 14;
  const segH = size === 'xs' ? 4 : 5;
  return (
    <span
      data-testid="difficulty-indicator"
      title={t['difficulty.autoAdjustExplanation']}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: size === 'xs' ? 11.5 : 12, color: 'var(--text-muted)', fontWeight: 500 }}
    >
      <span aria-hidden="true">{t['difficulty.label']}</span>
      <span aria-hidden="true" style={{ display: 'inline-flex', gap: 2 }}>
        {model.segments.map((state, i) => (
          <span
            key={i}
            data-segment={state}
            style={{
              width: segW,
              height: segH,
              borderRadius: 2,
              background:
                state === 'filled' ? 'var(--brand)' : state === 'range' ? 'var(--brand-subtle, rgba(59,130,246,0.35))' : 'var(--border-default)',
            }}
          />
        ))}
      </span>
      <span aria-hidden="true" style={{ color: 'var(--text-secondary)' }}>{model.label}</span>
      {model.trend && (
        <span aria-hidden="true" data-trend={model.trend} style={{ fontWeight: 700 }}>
          {model.trend === 'up' ? '↑' : '↓'}
        </span>
      )}
      <span className="sr-only">
        {model.accessible}
        {model.trendAccessible ? `. ${model.trendAccessible}` : ''}
      </span>
    </span>
  );
}
