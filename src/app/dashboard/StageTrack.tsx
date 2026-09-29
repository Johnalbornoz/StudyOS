import type { ConceptJourney } from '@/lib/lx/concept-journey';
import { RUNG_ORDER } from '@/lib/lx/concept-mission';
import type { getMessages } from '@/lib/i18n/messages';
import { stageLabel } from '@/lib/experience/vocabulary';

/**
 * UX-2 -- a concept's canonical position as a five-segment track
 * (Aprender · Practicar · Demostrar · Recordar · Aplicar).
 *
 * Renders exactly the `ConceptJourney` it is given; it never decides a
 * stage. Semantic ordered list with `aria-current="step"` and a visible
 * text label per segment plus a screen-reader state, so position is
 * never conveyed by colour alone.
 */
export default function StageTrack({ journey, t, variant = 'hero' }: { journey: ConceptJourney; t: ReturnType<typeof getMessages>; variant?: 'hero' | 'light' }) {
  const completed = new Set(journey.completedStages);
  const track = (
    <ol className={`xp-track${variant === 'light' ? ' xp-track--light' : ''}`} aria-label={t['myPath.journeyLabel']}>
      {RUNG_ORDER.map((rung) => {
        const state: 'COMPLETED' | 'CURRENT' | 'PENDING' = journey.consolidated || completed.has(rung)
          ? 'COMPLETED'
          : rung === journey.currentStage
            ? 'CURRENT'
            : 'PENDING';
        return (
          <li
            key={rung}
            className={state === 'COMPLETED' ? 'done' : state === 'CURRENT' ? 'current' : undefined}
            aria-current={state === 'CURRENT' ? 'step' : undefined}
          >
            <span className="xp-track-bar" aria-hidden />
            <span className="xp-track-label">
              {stageLabel(rung, t)}
              <span className="sr-only"> — {t[`myPathStageState.${state}`]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
  if (variant !== 'light') return track;
  // Compact (card) variant: bars only -- the segment labels stay in the
  // accessible list (visually hidden by CSS) and one visible caption names
  // the current stage, so narrow cards never hyphenate stage names.
  return (
    <div className="xp-track-compact">
      {track}
      <p className="xp-track-caption" aria-hidden>{stageLabel(journey.currentStage, t)}</p>
    </div>
  );
}
