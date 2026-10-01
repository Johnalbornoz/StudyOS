'use client';

/**
 * Track A (A1) -- "Tu cuenta": the multi-role account page.
 *
 * One canonical user, N additive roles. This page shows them explicitly:
 *  - every ACTIVE role with its workspace, which one is active now, and
 *    "Abrir" (switch through the fail-closed POST /api/identity/workspace,
 *    then a full navigation so nothing from the prior role is reused);
 *  - "Añadir otro rol" for the self-service roles not yet held (STUDENT /
 *    PARENT / TEACHER -- the server's own Zod enum is the real allowlist);
 *    adding a role makes it the active workspace and opens it;
 *  - roles an administrator REVOKED, explained and never offered as
 *    addable (the server also answers 409 ROLE_REVOKED);
 *  - for a Student: who can see their progress (revocable) and parent
 *    invitations they sent.
 * Still deliberately outside /dashboard: the dashboard layout redirects a
 * zero-role account here. Every action is re-authorized server-side; this
 * page never decides access.
 */
import { useCallback, useEffect, useState } from 'react';
import { getMessages, type Locale } from '@/lib/i18n/messages';

type Workspace = 'STUDENT' | 'PARENT' | 'TEACHER' | 'INSTITUTION' | 'ADMIN';
type Role = 'STUDENT' | 'PARENT' | 'TEACHER' | 'INSTITUTION_ADMIN' | 'STUDYUS_ADMIN';
type SelfServiceRole = 'STUDENT' | 'PARENT' | 'TEACHER';

const SELF_SERVICE_ROLES: SelfServiceRole[] = ['STUDENT', 'PARENT', 'TEACHER'];
const ROLE_ORDER: Role[] = ['STUDENT', 'PARENT', 'TEACHER', 'INSTITUTION_ADMIN', 'STUDYUS_ADMIN'];
const WORKSPACE_OF: Record<Role, Workspace> = {
  STUDENT: 'STUDENT',
  PARENT: 'PARENT',
  TEACHER: 'TEACHER',
  INSTITUTION_ADMIN: 'INSTITUTION',
  STUDYUS_ADMIN: 'ADMIN',
};
const HOME_HREF: Record<Workspace, string> = {
  STUDENT: '/dashboard/today',
  PARENT: '/dashboard/parent',
  TEACHER: '/dashboard/teacher',
  INSTITUTION: '/dashboard/institution',
  ADMIN: '/dashboard/admin/overview',
};

interface IdentityState {
  roles: Role[];
  revokedRoles: Role[];
  availableWorkspaces: Workspace[];
  activeWorkspace: Workspace | null;
}

interface SentInvitation {
  id: string;
  invitedEmail: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
}

interface ParentWithAccess {
  parentId: string;
  name: string;
}

export default function RoleSelectPage() {
  const [locale, setLocale] = useState<Locale>('es');
  const [state, setState] = useState<IdentityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [parents, setParents] = useState<ParentWithAccess[] | null>(null);
  const [sent, setSent] = useState<SentInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const t = getMessages(locale);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/identity/me', { cache: 'no-store' });
    if (res.status === 401) {
      window.location.href = '/sign-in';
      return;
    }
    const body = await res.json();
    setState({ revokedRoles: [], ...body.data });
  }, []);

  const loadFamily = useCallback(async () => {
    const [p, s] = await Promise.all([
      fetch('/api/student/parents', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/student/parent-invitations', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ]);
    setParents(p?.data?.parents ?? []);
    setSent((s?.data?.invitations ?? []).filter((i: SentInvitation) => i.status !== 'accepted'));
  }, []);

  useEffect(() => {
    fetch('/api/language')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b?.locale && setLocale(b.locale))
      .catch(() => {});
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (state?.roles.includes('STUDENT')) loadFamily();
  }, [state, loadFamily]);

  async function openWorkspace(workspace: Workspace) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/identity/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace }),
    });
    if (!res.ok) {
      setError(t['account.error.workspace']);
      setBusy(false);
      return;
    }
    window.location.href = HOME_HREF[workspace];
  }

  async function addRole(role: SelfServiceRole) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/identity/roles/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (res.status === 409) {
      setError(t['account.error.revoked']);
      await refresh();
      setBusy(false);
      return;
    }
    if (!res.ok) {
      setError(t['account.error.generic']);
      setBusy(false);
      return;
    }
    window.location.href = HOME_HREF[WORKSPACE_OF[role]];
  }

  async function revokeParent(parentId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/parent/relationships/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId }),
    });
    if (res.ok) {
      setNotice(t['account.family.revoked']);
      await loadFamily();
    } else {
      setError(t['account.error.generic']);
    }
    setBusy(false);
  }

  async function invite() {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/student/parent-invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim() }),
    });
    if (res.ok) {
      setInviteEmail('');
      setNotice(t['account.family.inviteSent']);
      await loadFamily();
    } else {
      setError(t['account.error.generic']);
    }
    setBusy(false);
  }

  if (!state) {
    return (
      <main className="role-page">
        <p className="role-muted">{t['common.loading']}</p>
      </main>
    );
  }

  const heldRoles = ROLE_ORDER.filter((r) => state.roles.includes(r));
  const revoked = ROLE_ORDER.filter((r) => state.revokedRoles.includes(r) && !state.roles.includes(r));
  const rolesNotYetHeld = SELF_SERVICE_ROLES.filter((r) => !state.roles.includes(r) && !state.revokedRoles.includes(r));
  const firstTime = heldRoles.length === 0;

  return (
    <main className="role-page">
      <header className="role-header">
        <h1>{firstTime ? t['account.firstTitle'] : t['account.title']}</h1>
        <p className="role-muted">{firstTime ? t['account.firstBody'] : t['account.subtitle']}</p>
      </header>

      {error && (
        <p role="alert" className="role-alert role-alert-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="role-alert">
          {notice}
        </p>
      )}

      {!firstTime && (
        <section aria-labelledby="roles-held" className="role-section">
          <h2 id="roles-held">{t['account.yourRoles']}</h2>
          <ul className="role-list">
            {heldRoles.map((role) => {
              const ws = WORKSPACE_OF[role];
              const isActive = state.activeWorkspace === ws;
              return (
                <li key={role} className="card role-card">
                  <div className="role-card-main">
                    <div className="role-card-title">
                      {t[`role.${role}.name` as const]}
                      {isActive && <span className="chip chip-good">{t['account.activeNow']}</span>}
                    </div>
                    <div className="role-muted">{t[`role.${role}.desc` as const]}</div>
                  </div>
                  <button type="button" className={isActive ? 'btn btn-ghost' : 'btn btn-primary'} disabled={busy} onClick={() => openWorkspace(ws)}>
                    {t['account.open']}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {rolesNotYetHeld.length > 0 && (
        <section aria-labelledby="roles-add" className="role-section">
          {!firstTime && <h2 id="roles-add">{t['account.addTitle']}</h2>}
          {!firstTime && <p className="role-muted">{t['account.addBody']}</p>}
          <ul className="role-list">
            {rolesNotYetHeld.map((role) => (
              <li key={role} className="card role-card">
                <div className="role-card-main">
                  <div className="role-card-title">{t[`role.${role}.name` as const]}</div>
                  <div className="role-muted">{t[`role.${role}.desc` as const]}</div>
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => addRole(role)}>
                  {t['account.add']}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {revoked.length > 0 && (
        <section aria-labelledby="roles-revoked" className="role-section">
          <h2 id="roles-revoked">{t['account.revokedTitle']}</h2>
          <ul className="role-list">
            {revoked.map((role) => (
              <li key={role} className="card role-card role-card-disabled">
                <div className="role-card-main">
                  <div className="role-card-title">{t[`role.${role}.name` as const]}</div>
                  <div className="role-muted">{t['account.revokedBody']}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.roles.includes('STUDENT') && (
        <section aria-labelledby="family" className="role-section">
          <h2 id="family">{t['account.family.title']}</h2>
          <p className="role-muted">{t['account.family.body']}</p>
          {parents && parents.length === 0 && <p className="role-muted">{t['account.family.none']}</p>}
          {parents && parents.length > 0 && (
            <ul className="card list-card">
              {parents.map((p) => (
                <li key={p.parentId} className="list-row">
                  <div className="row-main">
                    <div className="row-title">{p.name}</div>
                  </div>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => revokeParent(p.parentId)}>
                    {t['account.family.revoke']}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="role-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              invite();
            }}
          >
            <label htmlFor="family-invite">{t['account.family.inviteLabel']}</label>
            <div className="role-inline-row">
              <input
                id="family-invite"
                type="email"
                autoComplete="off"
                placeholder="correo@ejemplo.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !inviteEmail.trim()}>
                {t['account.family.invite']}
              </button>
            </div>
          </form>
          {sent.length > 0 && (
            <>
              <h3 className="role-subheading">{t['account.family.sent']}</h3>
              <ul className="card list-card">
                {sent.map((inv) => (
                  <li key={inv.id} className="list-row">
                    <div className="row-main">
                      <div className="row-title">{inv.invitedEmail}</div>
                    </div>
                    <span className="chip">
                      {inv.status === 'declined' ? t['account.family.status.declined'] : t['account.family.status.pending']}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {!firstTime && state.activeWorkspace && (
        <p>
          <a href={HOME_HREF[state.activeWorkspace]}>{t['account.backToDashboard']}</a>
        </p>
      )}
    </main>
  );
}
