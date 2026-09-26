'use client';

/**
 * F13 -- shows the actor's active workspace and, for a multi-workspace
 * actor, lets them switch (task section 7). Available/active workspace
 * are passed down from the server layout (already resolved via F1's
 * `resolveAvailableWorkspaces`/`getActiveWorkspace` for the SAME
 * request that decided which nav groups to render) -- this component
 * never re-derives or guesses either value client-side.
 *
 * Switching writes through the real F1 `POST /api/identity/workspace`
 * (which itself fails closed unless the requested workspace is
 * currently available -- INV-F1-13/14, unchanged) and then forces a
 * full server round-trip (`router.push` to that workspace's home route
 * + `router.refresh()`), so every server component in the tree
 * (including this layout's own nav-group resolution) re-fetches from
 * the database rather than a client-cached prior-role value
 * (INV-F13-02/03, task section 36: role switch must never show stale
 * data from the prior role).
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Check } from 'lucide-react';

export type WorkspaceOption = 'STUDENT' | 'PARENT' | 'TEACHER' | 'INSTITUTION' | 'ADMIN';

const HOME_HREF: Record<WorkspaceOption, string> = {
  STUDENT: '/dashboard/today',
  PARENT: '/dashboard/parent',
  TEACHER: '/dashboard/teacher',
  INSTITUTION: '/dashboard/institution',
  ADMIN: '/dashboard/admin/overview',
};

export default function WorkspaceSwitcher({
  available,
  active,
  labels,
  switcherLabel,
  errorLabel,
}: {
  available: WorkspaceOption[];
  active: WorkspaceOption;
  /** Localized label per workspace, resolved server-side (e.g. { STUDENT: 'Student', PARENT: 'Parent', ... }). */
  labels: Record<WorkspaceOption, string>;
  switcherLabel: string;
  errorLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  // A single-workspace actor sees a plain, non-interactive label --
  // still "shown clearly" (task section 7) without offering a switch
  // that would always fail (WORKSPACE_UNAVAILABLE) for anything else.
  if (available.length <= 1) {
    return (
      <div className="lx-workspace-indicator" aria-label={switcherLabel}>
        {labels[active]}
      </div>
    );
  }

  async function switchTo(workspace: WorkspaceOption) {
    setOpen(false);
    setError(false);
    try {
      const res = await fetch('/api/identity/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      startTransition(() => {
        router.push(HOME_HREF[workspace]);
        router.refresh();
      });
    } catch {
      setError(true);
    }
  }

  return (
    <div className="lx-workspace-switcher">
      <button
        type="button"
        className="lx-workspace-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={switcherLabel}
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
      >
        <span>{labels[active]}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <ul className="lx-workspace-menu" role="listbox" aria-label={switcherLabel}>
          {available.map((w) => (
            <li key={w}>
              <button
                type="button"
                role="option"
                aria-selected={w === active}
                className="lx-workspace-option"
                onClick={() => switchTo(w)}
              >
                {w === active && <Check size={14} strokeWidth={2.5} aria-hidden />}
                <span>{labels[w]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        // Kept deliberately terse and generic -- no internal error detail leaked (task section 27/40).
        <p role="alert" className="lx-workspace-error">
          {errorLabel}
        </p>
      )}
    </div>
  );
}
