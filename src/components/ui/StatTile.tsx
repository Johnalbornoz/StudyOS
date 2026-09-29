import type { ReactNode } from 'react';

/**
 * UX-2 -- a compact figure tile. It renders a value the caller already
 * holds from an authoritative source; it never computes or judges one
 * (no colour thresholds, no derived percentages).
 */
export function StatTile({ label, value, hint, children }: { label: string; value: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card ui-stat">
      <span className="ui-stat-label">{label}</span>
      <span className="ui-stat-value">{value}</span>
      {children}
      {hint && <span className="ui-stat-hint">{hint}</span>}
    </div>
  );
}
