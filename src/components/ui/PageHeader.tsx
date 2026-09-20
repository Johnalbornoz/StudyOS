/**
 * F13 -- Design System Consolidation. One consistent page-title/
 * breadcrumb pattern (task section 30/33) for every new Teacher/
 * Institution surface -- semantic <h1>, so screen readers and the
 * document outline both get a real heading (task section 32).
 */
export function PageHeader({ title, subtitle, breadcrumb }: { title: string; subtitle?: string; breadcrumb?: React.ReactNode }) {
  return (
    <header style={{ marginBottom: 'var(--space-6)' }}>
      {breadcrumb && <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>{breadcrumb}</nav>}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{title}</h1>
      {subtitle && <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 'var(--space-1) 0 0' }}>{subtitle}</p>}
    </header>
  );
}
