'use client';

/**
 * Track A -- the account page and first-time profile choice.
 *
 * Product amendment (2026-10-01): ONE canonical user, ONE primary persona
 * (STUDENT / PARENT / TEACHER); institution and StudyUs administration are
 * capabilities, not personas.
 *  - No persona yet: choose exactly ONE (the server refuses a second one,
 *    409 PERSONA_EXISTS). After choosing, the user goes straight into that
 *    persona's workspace / onboarding.
 *  - Persona held: never role selection again. The page is an account
 *    summary whose primary action is "Ir a mi espacio de {persona}" -- an
 *    approved Teacher is never stranded here -- plus capability shortcuts
 *    and, for a Teacher, the institutional authorization status.
 *  - Persona revoked by an administrator: explained; nothing self-service.
 *  - For a Student: who can see their progress (revocable) and parent
 *    invitations they sent.
 * Every action is re-authorized server-side; this page decides nothing.
 */
import { useCallback, useEffect, useState } from 'react';
import { getMessages, type Locale, type MessageKey } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import SignOutAction from '@/components/auth/SignOutAction';

type Workspace = 'STUDENT' | 'PARENT' | 'TEACHER' | 'INSTITUTION' | 'ADMIN';
type Role = 'STUDENT' | 'PARENT' | 'TEACHER' | 'INSTITUTION_ADMIN' | 'STUDYUS_ADMIN';
type Persona = 'STUDENT' | 'PARENT' | 'TEACHER';

const PERSONAS: Persona[] = ['STUDENT', 'PARENT', 'TEACHER'];
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

interface TeacherMembership {
  id: string;
  institutionName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
}

export default function RoleSelectPage() {
  const [locale, setLocale] = useState<Locale>('es');
  const [state, setState] = useState<IdentityState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [parents, setParents] = useState<ParentWithAccess[] | null>(null);
  const [sent, setSent] = useState<SentInvitation[]>([]);
  const [memberships, setMemberships] = useState<TeacherMembership[] | null>(null);
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
    if (state?.roles.includes('TEACHER')) {
      fetch('/api/teacher/my-memberships', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => setMemberships(b?.data?.memberships ?? []))
        .catch(() => setMemberships([]));
    }
  }, [state, loadFamily]);

  /** Opens a workspace the account holds (persona or capability) through the fail-closed API, then a full navigation. */
  async function open(workspace: Workspace) {
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

  async function choose(persona: Persona) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/identity/roles/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: persona }),
    });
    if (res.status === 409) {
      setError(t['account.error.personaExists']);
      await refresh();
      setBusy(false);
      return;
    }
    if (!res.ok) {
      setError(t['account.error.generic']);
      setBusy(false);
      return;
    }
    window.location.href = HOME_HREF[persona];
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

  const persona = PERSONAS.find((p) => state.roles.includes(p)) ?? null;
  const revokedPersona = persona ? null : PERSONAS.find((p) => state.revokedRoles.includes(p)) ?? null;
  const canChoose = !persona && !revokedPersona;
  const personaName = persona ? t[`role.${persona}.name` as MessageKey] : '';

  return (
    <main className="role-page">
      <header className="role-header">
        {/* REM-T1-01: Sign out is available before (and during) role selection. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <SignOutAction label={t['common.signOut']} />
        </div>
        <h1>{canChoose ? t['account.firstTitle'] : t['account.title']}</h1>
        <p className="role-muted">{persona ? fillMessage(t['account.subtitle'], { persona: personaName }) : canChoose ? t['account.firstBody'] : ''}</p>
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

      {persona && (
        <section aria-labelledby="persona" className="role-section">
          <div className="card role-card">
            <div className="role-card-main">
              <h2 id="persona" className="role-card-title">{personaName}</h2>
              <div className="role-muted">{t[`role.${persona}.desc` as MessageKey]}</div>
            </div>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => open(persona)}>
              {fillMessage(t['account.goToWorkspace'], { persona: personaName })}
            </button>
          </div>
        </section>
      )}

      {persona === 'TEACHER' && memberships && memberships.length > 0 && (
        <section aria-labelledby="teacher-status" className="role-section">
          <h2 id="teacher-status">{t['account.teacherStatusTitle']}</h2>
          <ul className="card list-card">
            {memberships.map((m) => (
              <li key={m.id} className="list-row" style={{ flexWrap: 'wrap' }}>
                <div className="row-main">
                  <div className="row-title">{m.institutionName}</div>
                </div>
                <span className={m.status === 'APPROVED' ? 'chip chip-good' : m.status === 'PENDING' ? 'chip chip-warn' : 'chip chip-critical'}>
                  {t[`teacherHome.membership.${m.status}` as MessageKey]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canChoose && (
        <section aria-label={t['account.firstTitle']} className="role-section">
          <p className="role-muted">{t['account.chooseNote']}</p>
          <ul className="role-list">
            {PERSONAS.map((p) => (
              <li key={p} className="card role-card">
                <div className="role-card-main">
                  <div className="role-card-title">{t[`role.${p}.name` as MessageKey]}</div>
                  <div className="role-muted">{t[`role.${p}.desc` as MessageKey]}</div>
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => choose(p)}>
                  {t['account.choose']}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {revokedPersona && (
        <section aria-labelledby="revoked" className="role-section">
          <div className="card role-card role-card-disabled">
            <div className="role-card-main">
              <h2 id="revoked" className="role-card-title">{t['account.revokedPersonaTitle']}</h2>
              <div className="role-muted">{t['account.revokedPersonaBody']}</div>
            </div>
          </div>
        </section>
      )}

      {(state.roles.includes('INSTITUTION_ADMIN') || state.roles.includes('STUDYUS_ADMIN')) && (
        <section aria-labelledby="capabilities" className="role-section">
          <h2 id="capabilities">{t['account.capabilitiesTitle']}</h2>
          <div className="ta-actions">
            {state.roles.includes('INSTITUTION_ADMIN') && (
              <button type="button" className={persona ? 'btn btn-secondary' : 'btn btn-primary'} disabled={busy} onClick={() => open('INSTITUTION')}>
                {t['account.goToInstitution']}
              </button>
            )}
            {state.roles.includes('STUDYUS_ADMIN') && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => open('ADMIN')}>
                {t['account.goToAdmin']}
              </button>
            )}
          </div>
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


    </main>
  );
}
