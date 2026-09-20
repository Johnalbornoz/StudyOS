/**
 * F13 -- Design System Consolidation. Renders one institutional/teacher
 * metric with enough context to avoid misleading interpretation (task
 * section 20): population, denominator (when one exists), and any
 * stated limitation -- never a bare, opaque number. Deliberately
 * generic over F12's own `MetricEnvelope` shape (never imports F12
 * server code -- INV-F13-01, this is presentation only, fed real
 * numbers already computed server-side).
 */
export interface MetricCardProps {
  label: string;
  value: string | number;
  populationDescription?: string;
  denominatorNote?: string;
  limitations?: string[];
  suppressed?: boolean;
  suppressedLabel?: string;
}

export function MetricCard({ label, value, populationDescription, denominatorNote, limitations, suppressed, suppressedLabel }: MetricCardProps) {
  if (suppressed) {
    return (
      <div className="card" style={{ padding: 'var(--space-4)' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>{suppressedLabel}</div>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 'var(--space-4)' }}>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginTop: 'var(--space-1)' }}>{value}</div>
      {populationDescription && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>{populationDescription}</div>}
      {denominatorNote && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{denominatorNote}</div>}
      {limitations && limitations.length > 0 && (
        <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: 16, fontSize: 11.5, color: 'var(--text-muted)' }}>
          {limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
