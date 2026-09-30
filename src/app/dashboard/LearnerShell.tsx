'use client';

/**
 * LX-2E / LX-2F -- the authenticated learner shell.
 *
 * Owns the responsive chrome so no activity/route implements navigation
 * on its own:
 *   - desktop (>=1024px): fixed sidebar; secondary/account groups are
 *     collapsible disclosures (UX-2)
 *   - below 1024px: sticky top bar + slide-in drawer (Escape / backdrop
 *     to close, focus moved into the drawer on open and restored on
 *     close, body scroll locked while open). UX-2: when the nav marks
 *     `mobileTab` destinations (the Student nav does), a fixed bottom tab
 *     bar shows them plus "Más", which opens that same drawer -- one
 *     navigation system, two presentations.
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
import { usePathname, useSearchParams } from 'next/navigation';
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
  Menu,
  X,
  ChevronRight,
  MoreHorizontal,
  School,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Network,
} from 'lucide-react';
import type { LearnerNavGroup } from '@/lib/lx/learner-navigation';
import type { Locale } from '@/lib/i18n/messages';
import { ShellLocaleProvider } from './ShellLocale';

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
  '/dashboard/assignments/practice',
  '/dashboard/exam-prep/attempt',
] as const;

const ICONS: Record<string, ReactNode> = {
  CalendarDays: <CalendarDays size={16} strokeWidth={2} aria-hidden />,
  LayoutDashboard: <LayoutDashboard size={16} strokeWidth={2} aria-hidden />,
  Route: <Route size={16} strokeWidth={2} aria-hidden />,
  Network: <Network size={16} strokeWidth={2} aria-hidden />,
  BookOpen: <BookOpen size={16} strokeWidth={2} aria-hidden />,
  RotateCcw: <RotateCcw size={16} strokeWidth={2} aria-hidden />,
  ListChecks: <ListChecks size={16} strokeWidth={2} aria-hidden />,
  MessageCircle: <MessageCircle size={16} strokeWidth={2} aria-hidden />,
  Bell: <Bell size={16} strokeWidth={2} aria-hidden />,
  Users: <Users size={16} strokeWidth={2} aria-hidden />,
  CreditCard: <CreditCard size={16} strokeWidth={2} aria-hidden />,
  ShieldCheck: <ShieldCheck size={16} strokeWidth={2} aria-hidden />,
  GraduationCap: <GraduationCap size={16} strokeWidth={2} aria-hidden />,
  School: <School size={16} strokeWidth={2} aria-hidden />,
  Building2: <Building2 size={16} strokeWidth={2} aria-hidden />,
  ClipboardCheck: <ClipboardCheck size={16} strokeWidth={2} aria-hidden />,
  ClipboardList: <ClipboardList size={16} strokeWidth={2} aria-hidden />,
};

/** Larger glyphs for the bottom tab bar (touch-first). */
const TAB_ICONS: Record<string, ReactNode> = {
  CalendarDays: <CalendarDays size={22} strokeWidth={2} aria-hidden />,
  Route: <Route size={22} strokeWidth={2} aria-hidden />,
  BookOpen: <BookOpen size={22} strokeWidth={2} aria-hidden />,
  LayoutDashboard: <LayoutDashboard size={22} strokeWidth={2} aria-hidden />,
  ClipboardCheck: <ClipboardCheck size={22} strokeWidth={2} aria-hidden />,
};

/** Nav groups with labels already resolved (server passes plain strings). */
export interface ResolvedNavItem {
  key: string;
  href: string;
  label: string;
  iconKey: string;
  badge?: number;
  /** UX-2: shown in the compact bottom tab bar. */
  mobileTab?: boolean;
  /** UX-5 closure: detail routes highlighted as this destination. */
  activePrefixes?: string[];
}
export interface ResolvedNavGroup {
  kind: LearnerNavGroup['kind'];
  title?: string;
  items: ResolvedNavItem[];
}

function matchesHref(href: string, pathname: string): boolean {
  return href === '/dashboard' ? pathname === '/dashboard' : pathname === href || pathname.startsWith(href + '/');
}

function isActiveHref(item: { href: string; activePrefixes?: string[] }, pathname: string): boolean {
  return matchesHref(item.href, pathname) || (item.activePrefixes ?? []).some((p) => matchesHref(p, pathname));
}

function NavLink({ item, pathname, onNavigate }: { item: ResolvedNavItem; pathname: string; onNavigate?: () => void }) {
  const active = isActiveHref(item, pathname);
  return (
    <Link
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
}

function NavList({
  groups,
  onNavigate,
  pathname,
  label,
  expandAll = false,
}: {
  groups: ResolvedNavGroup[];
  onNavigate?: () => void;
  pathname: string;
  /** LX-3R: a localized, landmark-distinct label -- the sidebar and the drawer each pass their own. */
  label: string;
  /** UX-2: the drawer shows every group expanded (it IS the "more" menu). */
  expandAll?: boolean;
}) {
  return (
    <nav aria-label={label} style={{ display: 'flex', flexDirection: 'column' }}>
      {groups.map((group) => {
        // UX-2: the primary group is always visible; titled groups are
        // native <details> disclosures (keyboard + screen-reader support
        // for free), opened automatically when they hold the current page
        // so the active item is never hidden.
        if (!group.title) {
          return (
            <div key={group.kind}>
              {group.items.map((item) => (
                <NavLink key={item.key} item={item} pathname={pathname} onNavigate={onNavigate} />
              ))}
            </div>
          );
        }
        const holdsActive = group.items.some((i) => isActiveHref(i, pathname));
        const badgeTotal = group.items.reduce((sum, i) => sum + (i.badge ?? 0), 0);
        return (
          <details key={group.kind} className="lx-nav-group" open={expandAll || holdsActive}>
            <summary>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ChevronRight className="lx-nav-chevron" size={14} strokeWidth={2.2} aria-hidden />
                {group.title}
              </span>
              {badgeTotal > 0 && <span className="lx-nav-badge">{badgeTotal}</span>}
            </summary>
            {group.items.map((item) => (
              <NavLink key={item.key} item={item} pathname={pathname} onNavigate={onNavigate} />
            ))}
          </details>
        );
      })}
    </nav>
  );
}

/**
 * UX-2 -- compact bottom navigation (< 1024px). Only destinations the nav
 * config marks `mobileTab`, plus "Más", which opens the full drawer. The
 * "Más" button is the drawer trigger, so focus returns to it on close.
 */
function TabBar({
  tabs,
  pathname,
  label,
  moreLabel,
  moreBadge,
  open,
  onMore,
  moreRef,
}: {
  tabs: ResolvedNavItem[];
  pathname: string;
  label: string;
  moreLabel: string;
  moreBadge: number;
  open: boolean;
  onMore: () => void;
  moreRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <nav className="lx-tabbar" aria-label={label}>
      {tabs.map((tab) => {
        const active = isActiveHref(tab, pathname);
        return (
          <Link key={tab.key} href={tab.href} className={`lx-tab${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
            {TAB_ICONS[tab.iconKey] ?? null}
            <span className="lx-tab-label">{tab.label}</span>
            {!!tab.badge && <span className="lx-tab-badge">{tab.badge}</span>}
          </Link>
        );
      })}
      <button
        ref={moreRef}
        type="button"
        className="lx-tab"
        aria-expanded={open}
        aria-controls="lx-drawer"
        aria-haspopup="dialog"
        onClick={onMore}
      >
        <MoreHorizontal size={22} strokeWidth={2} aria-hidden />
        <span className="lx-tab-label">{moreLabel}</span>
        {moreBadge > 0 && <span className="lx-tab-badge">{moreBadge}</span>}
      </button>
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
        {/* LX-9 A5: a calm "N learning days this week" count, bounded to
            [0,7] and reset every Monday by construction -- deliberately
            NOT a flame/consecutive-streak visual, which reads as
            loss-aversion pressure precisely because it grows into a big
            number worth "protecting". A calendar glyph plus a small,
            neutral-toned count instead. */}
        {streak > 0 && (
          <div title={streakLabel} style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--text-muted)' }}>
            <CalendarDays size={14} strokeWidth={2.2} aria-hidden />
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
  workspaceSwitcher,
  banner,
  locale = 'es',
  tabBarLabel,
  notificationsLabel,
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
  /** F13 -- shows the actor's active workspace and lets a multi-workspace user switch (task section 7). Optional so Focus Mode / any future minimal-chrome caller is unaffected. Rendered in both the desktop sidebar and the mobile drawer, above the Footer, so it is never hidden on a small viewport (INV-F13-22). */
  workspaceSwitcher?: ReactNode;
  /** Onboarding/authorization rework (2026-09-21) -- an optional persistent, non-dismissable license-state notice (demo mode / no active license), rendered above page content. Never shown during Focus Mode so it cannot interrupt an in-progress activity; the server-side capability gate on the activity's own route is what actually blocks premium use, this is purely the visible cue. */
  banner?: ReactNode;
  /** UX-2: the server-resolved interface language, exposed to client-only route boundaries (error/loading). */
  locale?: Locale;
  /** UX-2: landmark label for the compact bottom navigation. */
  tabBarLabel?: string;
  /** UX-2: accessible label for the top-bar notifications shortcut. */
  notificationsLabel?: string;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  // LX-5R Issue 2: context-aware Focus Mode exit, resolved so a previous
  // activity's context can NEVER leak into a later one.
  //   1. Current route wins. quiz / transfer / explain carry subjectId +
  //      conceptId in their own URL -- derive Exit straight from that. It
  //      is by definition the activity the learner is in; nothing to go
  //      stale.
  //   2. Otherwise a path-scoped beacon (remediation shell, keyed by
  //      pathId) -- trusted ONLY while its `key` equals the live pathname.
  //   3. Otherwise the default (Today). Deep-link with no trustworthy
  //      origin, or sessionStorage unavailable, lands here -- never on
  //      stale context.
  // sessionStorage holds navigation context only, never pedagogical truth.
  const curSubjectId = searchParams.get('subjectId');
  const curConceptId = searchParams.get('conceptId');
  const [beaconExitHref, setBeaconExitHref] = useState<string | null>(null);
  useEffect(() => {
    if (curSubjectId && curConceptId) {
      setBeaconExitHref(null); // current route is authoritative; ignore any beacon
      return;
    }
    try {
      const raw = sessionStorage.getItem('lx.activityOrigin');
      if (raw) {
        const o = JSON.parse(raw);
        if (
          o &&
          o.key === pathname &&
          typeof o.subjectId === 'string' &&
          typeof o.conceptId === 'string'
        ) {
          setBeaconExitHref(`/dashboard/subjects/${o.subjectId}/concepts/${o.conceptId}`);
          return;
        }
      }
    } catch {
      /* private mode / malformed -- fall through to the default */
    }
    setBeaconExitHref(null);
  }, [pathname, curSubjectId, curConceptId]);

  const originExitHref =
    curSubjectId && curConceptId
      ? `/dashboard/subjects/${curSubjectId}/concepts/${curConceptId}`
      : beaconExitHref;

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
        <main className="lx-main lx-main--focus">
          <ShellLocaleProvider value={locale}>{children}</ShellLocaleProvider>
        </main>
      </div>
    );
  }

  // UX-2: compact navigation. Tabs come only from the nav config's own
  // `mobileTab` flags, so non-Student workspaces keep the hamburger.
  const allItems = groups.flatMap((g) => g.items);
  const tabs = allItems.filter((i) => i.mobileTab).slice(0, 4);
  const hasTabs = tabs.length > 0;
  const moreBadge = allItems.filter((i) => !i.mobileTab).reduce((sum, i) => sum + (i.badge ?? 0), 0);
  const notifications = allItems.find((i) => i.key === 'notifications');

  return (
    <div className={`lx-shell${hasTabs ? ' lx-shell--tabs' : ''}`} lang={locale}>
      {/* desktop sidebar */}
      <aside className="lx-sidebar">
        {logo}
        {workspaceSwitcher}
        <NavList groups={groups} pathname={pathname} label={navLabel} />
        <Footer displayName={displayName} streak={streak} streakLabel={streakLabel} localeSwitcher={localeSwitcher} />
      </aside>

      {/* mobile top bar */}
      <div className="lx-topbar">
        {!hasTabs && (
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
        )}
        {logo}
        <span className="lx-topbar-spacer" />
        {hasTabs && notifications && (
          <Link
            href={notifications.href}
            className="lx-topbar-action"
            aria-label={notifications.badge ? `${notificationsLabel ?? notifications.label} (${notifications.badge})` : notificationsLabel ?? notifications.label}
          >
            <Bell size={20} strokeWidth={2} aria-hidden />
            {!!notifications.badge && <span className="lx-topbar-dot" aria-hidden />}
          </Link>
        )}
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
            {workspaceSwitcher}
            <NavList groups={groups} pathname={pathname} onNavigate={() => setOpen(false)} expandAll label={menuLabel} />
            <Footer displayName={displayName} streak={streak} streakLabel={streakLabel} localeSwitcher={localeSwitcher} />
          </div>
        </>
      )}

      <main className="lx-main">
        {banner}
        <ShellLocaleProvider value={locale}>{children}</ShellLocaleProvider>
      </main>

      {hasTabs && (
        <TabBar
          tabs={tabs}
          pathname={pathname}
          label={tabBarLabel ?? navLabel}
          moreLabel={groups.find((g) => g.kind === 'SECONDARY')?.title ?? menuLabel}
          moreBadge={moreBadge}
          open={open}
          onMore={() => setOpen(true)}
          moreRef={menuBtnRef}
        />
      )}
    </div>
  );
}
