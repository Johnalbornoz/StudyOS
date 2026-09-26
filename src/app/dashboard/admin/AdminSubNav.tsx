import Link from 'next/link';
import { ADMIN_SECTIONS, type AdminSection } from '@/lib/admin/sections';

/**
 * Professional Admin Console -- the differentiated navigation the
 * redesign requires. Mirrors the exact structural pattern already
 * established by `InstitutionSubNav` (a proven, consistent convention
 * in this codebase for "you are inside a distinct workspace") rather
 * than inventing a second navigation system or a separate dark-themed
 * shell -- reuses StudyUS's own design tokens throughout, just with
 * its own persistent header band so the console reads as its own
 * place, not a page bolted onto the student dashboard.
 */
export type { AdminSection };

export function AdminSubNav({ active }: { active: AdminSection }) {
  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--brand-ink, #1a2332)',
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Consola de administración
        </span>
      </div>
      <nav
        aria-label="Secciones de administración"
        style={{
          display: 'flex',
          gap: 'var(--space-1)',
          flexWrap: 'wrap',
          borderBottom: '2px solid var(--border-default)',
          paddingBottom: 0,
        }}
      >
        {ADMIN_SECTIONS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.key === active ? 'page' : undefined}
            style={{
              fontSize: 13.5,
              fontWeight: 650,
              padding: 'var(--space-2) var(--space-3)',
              color: item.key === active ? 'var(--brand-ink, #1a2332)' : 'var(--text-muted)',
              textDecoration: 'none',
              borderBottom: item.key === active ? '2px solid var(--brand-ink, #1a2332)' : '2px solid transparent',
              marginBottom: -2,
            }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
