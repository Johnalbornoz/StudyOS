'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

export default function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map(({ href, label, icon, badge }) => {
        const isActive = href === '/dashboard' ? pathname === '/dashboard' : pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`nav-link${isActive ? ' active' : ''}`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)',
              padding: '8px var(--space-3)', borderRadius: 'var(--radius-sm)',
              color: isActive ? 'var(--brand-ink)' : 'var(--text-secondary)', fontSize: 14, fontWeight: 500,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              {icon}
              {label}
            </span>
            {!!badge && (
              <span
                style={{
                  fontSize: 11, fontWeight: 650, background: 'var(--error-subtle)', color: 'var(--error)',
                  padding: '1px 7px', borderRadius: 'var(--radius-full)',
                }}
              >
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
