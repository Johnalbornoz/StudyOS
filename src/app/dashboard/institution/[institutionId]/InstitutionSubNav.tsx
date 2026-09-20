import Link from 'next/link';

/**
 * F13 -- Institution sub-navigation (task section 19/30). Keeps
 * breadcrumb-style context (Institution -> section) without a second
 * navigation system -- these links live inside the page content area,
 * the global shell's own nav still owns the top-level "Institution"
 * entry (task section 6).
 */
export function InstitutionSubNav({
  institutionId,
  active,
  labels,
}: {
  institutionId: string;
  active: 'overview' | 'learners' | 'interventions' | 'attention';
  labels: { overview: string; learners: string; interventions: string; attention: string };
}) {
  const base = `/dashboard/institution/${institutionId}`;
  const items: Array<{ key: typeof active; href: string; label: string }> = [
    { key: 'overview', href: base, label: labels.overview },
    { key: 'learners', href: `${base}/learners`, label: labels.learners },
    { key: 'interventions', href: `${base}/interventions`, label: labels.interventions },
    { key: 'attention', href: `${base}/attention`, label: labels.attention },
  ];
  return (
    <nav aria-label={labels.overview} style={{ display: 'flex', gap: 'var(--space-4)', borderBottom: '1px solid var(--border-default)', marginBottom: 'var(--space-6)', paddingBottom: 'var(--space-2)' }}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? 'page' : undefined}
          style={{
            fontSize: 13,
            fontWeight: 650,
            color: item.key === active ? 'var(--brand-ink)' : 'var(--text-muted)',
            textDecoration: 'none',
          }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
