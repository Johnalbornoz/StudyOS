'use client';

/**
 * F1 -- minimal role-selection / workspace-switch page.
 *
 * Deliberately outside `/dashboard` (whose layout unconditionally
 * assumes a Student identity via `getOrCreateStudentId`, per
 * F1_CURRENT_IDENTITY_ASSESSMENT.md §4) -- this page only talks to the
 * new `/api/identity/*` routes, so it works correctly for a caller
 * with zero roles yet. This is intentionally minimal (a functional
 * demonstration, not final UX): F13 owns workspace-switcher UX
 * consolidation. A user who already has a role sees their available
 * workspaces and can switch between them; a user with none sees the
 * 3 self-service role options only (never Institution Admin / StudyUS
 * Admin -- those are not rendered anywhere on this page).
 */
import { useEffect, useState } from 'react';

type Workspace = 'STUDENT' | 'PARENT' | 'TEACHER' | 'INSTITUTION' | 'ADMIN';
type SelfServiceRole = 'STUDENT' | 'PARENT' | 'TEACHER';

interface IdentityState {
  roles: string[];
  availableWorkspaces: Workspace[];
  activeWorkspace: Workspace | null;
}

const SELF_SERVICE_ROLES: SelfServiceRole[] = ['STUDENT', 'PARENT', 'TEACHER'];

export default function RoleSelectPage() {
  const [state, setState] = useState<IdentityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/identity/me');
    if (res.status === 401) {
      window.location.href = '/sign-in';
      return;
    }
    const body = await res.json();
    setState(body.data);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function selectRole(role: SelfServiceRole) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/identity/roles/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      setError('Could not assign that role.');
    } else {
      await refresh();
    }
    setBusy(false);
  }

  async function switchWorkspace(workspace: Workspace) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/identity/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
    });
    if (!res.ok) {
      setError('That workspace is not available to you.');
    } else {
      await refresh();
    }
    setBusy(false);
  }

  if (!state) return <div style={{ padding: 'var(--space-8)' }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}>
      <h1 style={{ fontSize: 20, marginBottom: 'var(--space-4)' }}>Your account</h1>

      {state.roles.length === 0 ? (
        <>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
            How will you use StudyUS?
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {SELF_SERVICE_ROLES.map((role) => (
              <button key={role} disabled={busy} onClick={() => selectRole(role)} className="card" style={{ padding: 'var(--space-3)', cursor: 'pointer' }}>
                {role === 'STUDENT' ? 'Student' : role === 'PARENT' ? 'Parent / Guardian / Coach' : 'Teacher'}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
            Roles: {state.roles.join(', ')}
          </p>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
            Active workspace: {state.activeWorkspace ?? '(none selected)'}
          </p>
          {state.availableWorkspaces.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {state.availableWorkspaces.map((ws) => (
                <button
                  key={ws}
                  disabled={busy || ws === state.activeWorkspace}
                  onClick={() => switchWorkspace(ws)}
                  className="card"
                  style={{ padding: 'var(--space-3)', cursor: 'pointer' }}
                >
                  Switch to {ws}
                </button>
              ))}
            </div>
          )}
          {state.availableWorkspaces.includes('STUDENT') && (
            <p style={{ marginTop: 'var(--space-4)' }}>
              <a href="/dashboard">Go to your dashboard →</a>
            </p>
          )}
        </>
      )}

      {error && <p style={{ color: 'var(--danger, red)', marginTop: 'var(--space-3)' }}>{error}</p>}
    </div>
  );
}
