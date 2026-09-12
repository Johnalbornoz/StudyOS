import type { ConceptJourney, JourneyStage } from '@/lib/lx/concept-journey';
import type { getMessages } from '@/lib/i18n/messages';
import { journeyStageLabel, journeyStageStateLabel, journeyReinforceLabel } from './journeyStageLabel';

/**
 * LX-7 R7/R8/R23-R25 -- the one reusable journey visualization, shared
 * by the current-position hero and every concept row in a subject's
 * path. Presentation only: it renders exactly the `ConceptJourney`
 * it's given (concept-journey.ts), it never computes one.
 *
 * Accessibility (R25): a semantic ordered list, `aria-current="step"`
 * on the current stage, and a visible text label + status per stage --
 * never color alone. Mobile (R24): flex-wrap, so five stages reflow
 * onto multiple lines rather than forcing horizontal scroll.
 */
export default function JourneyStrip({ journey, t }: { journey: ConceptJourney; t: ReturnType<typeof getMessages> }) {
  const line: JourneyStage[] = journey.consolidated
    ? journey.completedStages
    : [...journey.completedStages, journey.currentStage, ...journey.pendingStages];
  const completedSet = new Set<JourneyStage>(journey.completedStages);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <ol
        aria-label={t['myPath.journeyLabel']}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', listStyle: 'none', margin: 0, padding: 0, alignItems: 'center' }}
      >
        {line.map((stage) => {
          const state: 'COMPLETED' | 'CURRENT' | 'PENDING' = journey.consolidated
            ? 'COMPLETED'
            : stage === journey.currentStage
              ? 'CURRENT'
              : completedSet.has(stage)
                ? 'COMPLETED'
                : 'PENDING';
          const glyph = state === 'COMPLETED' ? '✓' : state === 'CURRENT' ? '●' : '○';
          const color = state === 'COMPLETED' ? 'var(--success, #1a7f4b)' : state === 'CURRENT' ? 'var(--brand-ink)' : 'var(--text-muted)';
          return (
            <li
              key={stage}
              aria-current={state === 'CURRENT' ? 'step' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <span aria-hidden style={{ color, fontSize: 13, fontWeight: 700, lineHeight: 1 }}>{glyph}</span>
              <span style={{ fontSize: 12.5, fontWeight: state === 'CURRENT' ? 650 : 500, color: state === 'PENDING' ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                {journeyStageLabel(stage, t)}
                <span className="sr-only"> — {journeyStageStateLabel(state, t)}</span>
              </span>
            </li>
          );
        })}
        {journey.consolidated && (
          <li style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span aria-hidden style={{ color: 'var(--success, #1a7f4b)', fontSize: 13, fontWeight: 700 }}>{'✓'}</span>
            <span style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--success, #1a7f4b)' }}>{journeyStageLabel('CONSOLIDATED', t)}</span>
          </li>
        )}
      </ol>
      {journey.intervention && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 11, fontWeight: 650, color: 'var(--warning)', background: 'var(--warning-subtle)',
              borderRadius: 'var(--radius-full)', padding: '2px 9px', textTransform: 'uppercase', letterSpacing: '0.02em',
            }}
          >
            {journeyReinforceLabel(t)}
          </span>
        </div>
      )}
    </div>
  );
}
