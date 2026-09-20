/**
 * F13 -- Design System Consolidation (task section 33/25). One
 * component maps every domain status this product surfaces to the
 * SAME small, named visual vocabulary -- never a generic "error" chip
 * standing in for a real domain state (task section 25's own explicit
 * requirement). Wraps the EXISTING `.chip*` CSS classes (see
 * `globals.css`) rather than inventing new styling -- consolidation,
 * not replacement.
 *
 * Deliberately never color-only: every tone also renders a distinct
 * label string, satisfying "sufficient non-color-only status
 * distinction" (task section 32) without relying on a screen reader
 * announcing a CSS custom property.
 */
export type StatusTone = 'neutral' | 'good' | 'warn' | 'critical' | 'info';

export interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
}

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'chip',
  good: 'chip chip-good',
  warn: 'chip chip-warn',
  critical: 'chip chip-critical',
  // No distinct "info" CSS tone exists today -- reuses the neutral chip
  // shell rather than inventing a new color, a deliberate minimal-diff
  // choice (see F13_DESIGN_SYSTEM_CONSOLIDATION.md).
  info: 'chip',
};

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  return <span className={TONE_CLASS[tone]}>{label}</span>;
}

/**
 * The one place that decides which TONE a given domain status renders
 * as. Centralizing this is what prevents the same underlying state
 * from silently getting two different colors on two different pages
 * (task section 25). Never a domain DECISION -- purely a presentation
 * mapping over a status string the server already computed.
 */
export function toneForInterventionStatus(status: 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'): StatusTone {
  switch (status) {
    case 'ASSIGNED':
      return 'neutral';
    case 'IN_PROGRESS':
      return 'info';
    case 'COMPLETED':
      return 'good';
    case 'CANCELLED':
      return 'neutral';
    case 'EXPIRED':
      return 'warn';
  }
}

/**
 * F14 -- F9's per-dimension status (readiness.service.ts's
 * `DimensionStatus`). Deliberately never 'critical': a WEAK dimension
 * is real, actionable signal, not a platform failure (same discipline
 * as `toneForReadinessStatus`'s own INSUFFICIENT_EVIDENCE handling).
 */
export function toneForDimensionStatus(status: 'STRONG' | 'DEVELOPING' | 'WEAK' | 'INSUFFICIENT_EVIDENCE' | 'NOT_APPLICABLE' | string): StatusTone {
  switch (status) {
    case 'STRONG':
      return 'good';
    case 'DEVELOPING':
      return 'info';
    case 'WEAK':
      return 'warn';
    case 'INSUFFICIENT_EVIDENCE':
    case 'NOT_APPLICABLE':
    default:
      return 'neutral';
  }
}

export function toneForReadinessStatus(status: string): StatusTone {
  switch (status) {
    case 'FULL_MOCK_ELIGIBLE':
    case 'SIMULATION_READY':
      return 'good';
    case 'DEVELOPING':
      return 'info';
    case 'EARLY_PREPARATION':
      return 'warn';
    case 'INSUFFICIENT_EVIDENCE':
    case 'NO_ACTIVE_EXAM_PROFILE':
      // Deliberately 'neutral', never 'critical' -- insufficient
      // evidence is a fact about data, not a failure (INV-F13-11,
      // task section 13).
      return 'neutral';
    default:
      return 'neutral';
  }
}
