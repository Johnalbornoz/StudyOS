import type { ReactNode } from 'react';
import { QUANTITY_FILL_CLASS } from '@/lib/experience/progress-tone';

/**
 * UX-2 -- a summary indicator: label, the value the server already
 * computed (0-100) and a quantity bar. A null value renders the pending
 * copy the caller passes (e.g. "Por validar") -- never 0%, never an
 * implied validation. No thresholds, no colour judgement.
 */
export function Indicator({ label, value, pendingLabel, children }: { label: string; value: number | null; pendingLabel: string; children?: ReactNode }) {
  const pct = value === null ? null : Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="card ui-indicator">
      <span className="ui-indicator-label">{label}</span>
      {pct === null ? (
        <span className="ui-indicator-value ui-indicator-value--pending">{pendingLabel}</span>
      ) : (
        <>
          <span className="ui-indicator-value">{pct}%</span>
          <span className="ui-bar" aria-hidden>
            <span className={QUANTITY_FILL_CLASS} style={{ width: `${pct}%` }} />
          </span>
        </>
      )}
      {children}
    </div>
  );
}
