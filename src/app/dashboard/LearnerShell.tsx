'use client';

/**
 * LX-2E / LX-2F -- the authenticated learner shell.
 *
 * Owns the responsive chrome so no activity/route implements navigation
 * on its own:
 *   - desktop (>=1024px): fixed sidebar
 *   - below 1024px: sticky top bar + slide-in drawer (Escape / backdrop
 *     to close, focus moved into the drawer on open and restored on
 *     close, body scroll locked while open)
 *
 * `chrome` is the structural seam for the LX-4 focus state:
 *   - 'full'    -> nav + drawer
 *   - 'minimal' -> slim bar with an Exit affordance, no nav
 *
 * LX-4K FOCUS MODE: during active learning the full learner navigation
 * disappears. Rather than a nested layout per activity, the shell
 * itself collapses to the minimal chrome whenever the current path is
 * an active-learning route (FOCUS_MODE_PREFIXES). No second navigation
 * system is built; Focus Mode owns presentation only.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import {
  CalendarDays,
  LayoutDashboard,
  Route,
  BookOpen,
  RotateCcw,
  ArrowLeft,
  ListChecks,
  MessageCircle,
  Bell,
  Users,
  CreditCard,
  ShieldCheck,
  GraduationCap,
  Flame,
  Menu,
  X,
} from 'lucide-react';
import type { LearnerNavGroup } from '@/lib/lx/learner-navigation';

/**
 * LX-4K -- routes that ARE an active learning activity. On these the
 * shell renders the minimal focus chrome (Exit + logo, no nav). Keep
 * this list tight: only surfaces where the learner is mid-activity.
 */
const FOCUS_MODE_PREFIXES = [
  '/dashboard/quiz',
  '/dashboard/remediation',
  '/dashboard/cognitive/explain',
  '/dashboard/cognitive/transfer',
] as const;

const ICONS: Record<string, ReactNode> = {
  CalendarDays: <CalendarDays size={16} strokeWidth={2} aria-hidden />,
  LayoutDashboard: <LayoutDashboard size={16} strokeWidth={2} aria-hidden />,
  Route: <Route size={16} strokeWidth={2} aria-hidden />,
  BookOpen: <BookOpen size={16} strokeWidth={2} aria-hidden />,
  RotateCcw: <RotateCcw size={16} strokeWidth={2} aria-hidden />,
  ListChecks: <ListChecks size={16} strokeWidth={2} aria-hidden />,
  MessageCircle: <MessageCircle size={16} strokeWidth={2} aria-hidden />,
  Bell: <Bell size={16} strokeWidth={2} aria-hidden />,
  Users: <Users size={16} strokeWidth={2} aria-hidden />,
  CreditCard: <CreditCard size={16} strokeWidth={2} aria-hidden />,
  ShieldCheck: <ShieldCheck size={16} strokeWidth={2} aria-hidden />,
  GraduationCap: <GraduationCap size={16} strokeWidth={2} aria-hidden />,
};

/** Nav groups with labels already resolved (server passes plain strings). */
export interface ResolvedNavItem {
  key: string;
  href: string;
  label: string;
  iconKey: string;
  badge?: number;
}
export interface ResolvedNavGroup {
  kind: LearnerNavGroup['kind'];
  title?: string;
  items: ResolvedNavItem[];
}

function NavList({
  groups,
  onNavigate,
  pathname,
  label,
}: {
  groups: ResolvedNavGroup[];
  onNavigate?: () => void;
  pathname: string;
  /** LX-3R: a localized, landmark-distinct label -- the sidebar and the drawer each pass their own. */
  label: string;
}) {
  return (
    <nav aria-label={label} style={{ display: 'flex', flexDirection: 'column' }}>
      {groups.map((group) => (
        <div key={group.kind}>
          {group.title && <div className="lx-nav-grouptitle">{group.title}</div>}
          {group.items.map((item) => {
            const active =
              item.href === '/dashboard' ? pathname === '/dashboard' : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`lx-navlink${active ? ' active' : ''}`}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  {ICONS[item.iconKey] ?? null}
                  {item.label}
                </span>
                {!!item.badge && <span className="lx-nav-badge">{item.badge}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Footer({ displayName, streak, streakLabel, localeSwitcher }: { displayName: string; streak: number; streakLabel: string; localeSwitcher: ReactNode }) {
  return (
    <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {localeSwitcher}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)',
        }}
      >
        <UserButton appearance={{ elements: { avatarBox: { width: 30, height: 30 } } }} />
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName}
        </div>
        {streak > 0 && (
          <div title={streakLabel} style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--warning)' }}>
            <Flame size={14} strokeWidth={2.2} aria-hidden fill="currentColor" />
            <span className="tabular">{streak}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LearnerShell({
  groups,
  displayName,
  streak,
  streakLabel,
  menuLabel,
  closeLabel,
  navLabel,
  exitLabel,
  exitHref = '/dashboard/today',
  localeSwitcher,
  chrome = 'full',
  children,
}: {
  groups: ResolvedNavGroup[];
  displayName: string;
  streak: number;
  streakLabel: string;
  menuLabel: string;
  closeLabel: string;
  /** LX-3R: localized landmark name for the persistent sidebar nav (distinct from the drawer's, which uses menuLabel). */
  navLabel: string;
  /** LX-4K: Focus Mode exit affordance label. */
  exitLabel: string;
  /** LX-4K: safe destination for the Focus Mode exit. Defaults to Today. */
  exitHref?: string;
  localeSwitcher: ReactNode;
  chrome?: 'full' | 'minimal';
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // LX-5J: context-aware Focus Mode exit. An activity page (quiz) records
  // the concept it was launched for in sessionStorage; if present, Exit
  // returns to that Concept Mission rather than a generic Today.
  // sessionStorage is navigation context only -- never pedagogical
  // truth, per-tab, cleared by the browser.
  const [originExitHref, setOriginExitHref] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('lx.activityOrigin');
      if (raw) {
        const o = JSON.parse(raw);
        if (o && typeof o.subjectId === 'string' && typeof o.conceptId === 'string') {
          setOriginExitHref(`/dashboard/subjects/${o.subjectId}/concepts/${o.conceptId}`);
          return;
        }
      }
    } catch {
      /* private mode / malformed -- fall through to the default */
    }
    setOriginExitHref(null);
  }, [pathname]);

  useEffect(() => {
    setOpen(false); // close the drawer on every route change
  }, [pathname]);

  // LX-2P: the drawer is aria-modal, so keyboard focus must be
  // contained while it is open (no interaction with background
  // content), returned to the trigger on close, and the body must not
  // scroll behind it.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';

    const drawer = drawerRef.current;
    const focusables = () =>
      Array.from(
        drawer?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // initial focus -> first focusable (the close button)
    (focusables()[0] ?? drawer)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // wrap, and pull focus back in if it ever escaped the drawer
      if (e.shiftKey) {
        if (active === first || !drawer?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !drawer?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey, true);
      menuBtnRef.current?.focus();
    };
  }, [open]);

  const logo = (
    <Link href="/dashboard/today" aria-label="StudyUS" style={{ display: 'inline-flex', padding: '0 var(--space-2)' }}>
      <Image src="/logo.png" alt="StudyUS" width={91} height={30} priority style={{ height: 30, width: 'auto' }} />
    </Link>
  );

  // LX-4K: collapse to the minimal chrome for any active-learning route.
  const inFocusMode = chrome === 'minimal' || FOCUS_MODE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (inFocusMode) {
    return (
      <div className="lx-shell lx-shell--focus">
        <div className="lx-focusbar">
          <Link href={originExitHref ?? exitHref} className="lx-exit" aria-label={exitLabel}>
            <ArrowLeft size={16} strokeWidth={2.2} aria-hidden />
            <span>{exitLabel}</span>
          </Link>
          {logo}
        </div>
        <main className="lx-main lx-main--focus">{children}</main>
      </div>
    );
  }

  return (
    <div className="lx-shell">
      {/* desktop sidebar */}
      <aside className="lx-sidebar">
        {logo}
        <NavList groups={groups} pathname={pathname} label={navLabel} />
        <Footer displayName={displayName} streak={streak} streakLabel={streakLabel} localeSwitcher={localeSwitcher} />
      </aside>

      {/* mobile top bar */}
      <div className="lx-topbar">
        <button
          ref={menuBtnRef}
          type="button"
          className="lx-menu-btn"
          aria-label={menuLabel}
          aria-expanded={open}
          aria-controls="lx-drawer"
          onClick={() => setOpen(true)}
        >
          <Menu size={20} strokeWidth={2} aria-hidden />
        </button>
        {logo}
      </div>

      {open && (
        <>
          <div className="lx-drawer-backdrop" onClick={() => setOpen(false)} aria-hidden />
          <div ref={drawerRef} id="lx-drawer" className="lx-drawer" role="dialog" aria-modal="true" aria-label={menuLabel} tabIndex={-1}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {logo}
              <button type="button" className="lx-menu-btn" aria-label={closeLabel} onClick={() => setOpen(false)}>
                <X size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <NavList groups={groups} pathname={pathname} onNavigate={() => setOpen(false)} label={menuLabel} />
            <Footer displayName={displayName} streak={streak} streakLabel={streakLabel} localeSwitcher={localeSwitcher} />
          </div>
        </>
      )}

      <main className="lx-main">{children}</main>
    </div>
  );
}
