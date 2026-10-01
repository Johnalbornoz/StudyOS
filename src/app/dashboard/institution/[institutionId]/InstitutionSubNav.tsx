import Link from 'next/link';

/**
 * F13 -- Institution sub-navigation (task section 19/30). Keeps
 * breadcrumb-style context (Institution -> section) without a second
 * navigation system -- these links live inside the page content area,
 * the global shell's own nav still owns the top-level "Institution"
 * entry (task section 6).
 *
 * Track A: wraps instead of overflowing at phone widths (.ta-subnav), and
 * the requests label is localized by every caller (no hard-coded fallback
 * text shown to a non-Spanish reader).
 */
export function InstitutionSubNav({
  institutionId,
  active,
  labels,
}: {
  institutionId: string;
  active: 'overview' | 'grades' | 'classes' | 'teachers' | 'requests' | 'learners' | 'coverage' | 'readiness' | 'interventions' | 'attention';
  labels: {
    overview: string;
    grades: string;
    classes: string;
    teachers: string;
    requests?: string;
    learners: string;
    coverage: string;
    readiness: string;
    interventions: string;
    attention: string;
  };
}) {
  const base = `/dashboard/institution/${institutionId}`;
  const items: Array<{ key: typeof active; href: string; label: string }> = [
    { key: 'overview', href: base, label: labels.overview },
    { key: 'grades', href: `${base}/grades`, label: labels.grades },
    { key: 'classes', href: `${base}/classes`, label: labels.classes },
    { key: 'teachers', href: `${base}/teachers`, label: labels.teachers },
    ...(labels.requests ? [{ key: 'requests' as const, href: `${base}/requests`, label: labels.requests }] : []),
    { key: 'learners', href: `${base}/learners`, label: labels.learners },
    { key: 'coverage', href: `${base}/coverage`, label: labels.coverage },
    { key: 'readiness', href: `${base}/readiness`, label: labels.readiness },
    { key: 'interventions', href: `${base}/interventions`, label: labels.interventions },
    { key: 'attention', href: `${base}/attention`, label: labels.attention },
  ];
  return (
    <nav aria-label={labels.overview} className="ta-subnav">
      {items.map((item) => (
        <Link key={item.key} href={item.href} aria-current={item.key === active ? 'page' : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
