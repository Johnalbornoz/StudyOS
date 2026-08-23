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

interface NavGroup {
  title?: string;
  items: NavItem[];
}

export default function SidebarNav({ groups, items }: { groups?: NavGroup[]; items?: NavItem[] }) {
  const pathname = usePathname();
  const resolvedGroups: NavGroup[] = groups ?? [{ items: items ?? [] }];

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {resolvedGroups.map((group, i) => (
        <div key={group.title ?? i} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {group.title && (
            <div
              style={{
                fontSize: 11, fontWeight: 650, color: 'var(--text-muted)', textTransform: 'uppercase',
                letterSpacing: '0.04em', padding: '0 var(--space-3)', margin: '0 0 4px',
              }}
            >
              {group.title}
            </div>
          )}
          {group.items.map(({ href, label, icon, badge }) => {
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
        </div>
      ))}
    </nav>
  );
}
