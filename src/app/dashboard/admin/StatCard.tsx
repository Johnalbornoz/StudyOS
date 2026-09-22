export function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'default' | 'warn' | 'critical' }) {
  const color = tone === 'critical' ? 'var(--danger, #b91c1c)' : tone === 'warn' ? 'var(--warning-ink, #9a3412)' : 'var(--text-primary)';
  return (
    <div className="card" style={{ padding: 'var(--space-4)', minWidth: 140 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1.1 }} className="tabular">
        {value}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>{label}</div>
    </div>
  );
}
