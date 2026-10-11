'use client';

/**
 * L7 PA-1 -- the Student's own control over family access, inside the
 * dashboard: who can see my progress, remove that access, invite a family
 * member, cancel an invitation that has not been answered.
 *
 * It only calls the existing Student-side routes, which resolve the student
 * from the session; no student id is ever sent. An account that is not a
 * Student gets 403 from them and the card renders nothing.
 */
import { useCallback, useEffect, useState } from 'react';
import { fillMessage } from '@/lib/i18n/roles-messages';
import type { ParentAccessMessages } from '@/lib/i18n/parent-access-messages';
import { PARENT_ACCESS_ROUTES, formatSince, looksLikeEmail, openInvitations, type ParentWithAccess, type SentInvitation } from './parent-access';

type LoadState = 'loading' | 'ready' | 'error' | 'hidden';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export default function ParentAccessCard({ labels, locale }: { labels: ParentAccessMessages; locale: string }) {
  const [load, setLoad] = useState<LoadState>('loading');
  const [parents, setParents] = useState<ParentWithAccess[]>([]);
  const [sent, setSent] = useState<SentInvitation[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        fetch(PARENT_ACCESS_ROUTES.parents, { cache: 'no-store' }),
        fetch(PARENT_ACCESS_ROUTES.invitations, { cache: 'no-store' }),
      ]);
      if (p.status === 401 || p.status === 403 || s.status === 401 || s.status === 403) {
        setLoad('hidden');
        return;
      }
      if (!p.ok || !s.ok) {
        setLoad('error');
        return;
      }
      const [pBody, sBody] = await Promise.all([p.json(), s.json()]);
      setParents(pBody?.data?.parents ?? []);
      setSent(openInvitations(sBody?.data?.invitations ?? []));
      setLoad('ready');
    } catch {
      setLoad('error');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Runs one mutation, then reloads both lists so the card always shows server state. */
  async function act(request: () => Promise<Response>, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    let ok = false;
    try {
      const res = await request();
      ok = res.ok;
      if (ok) setNotice(done);
      else setError(res.status === 404 ? labels['pa.error.notFound'] : labels['pa.error.generic']);
    } catch {
      setError(labels['pa.error.generic']);
    }
    await refresh();
    setBusy(false);
    return ok;
  }

  async function invite() {
    const value = email.trim();
    if (!looksLikeEmail(value)) {
      setNotice(null);
      setError(labels['pa.invite.invalidEmail']);
      return;
    }
    const ok = await act(
      () => fetch(PARENT_ACCESS_ROUTES.invitations, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ email: value }) }),
      labels['pa.invite.sent']
    );
    if (ok) setEmail('');
  }

  async function revoke(parentId: string) {
    setConfirming(null);
    await act(
      () => fetch(PARENT_ACCESS_ROUTES.revoke, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ parentId }) }),
      labels['pa.revoked']
    );
  }

  async function cancelInvitation(invitationId: string) {
    await act(
      () => fetch(PARENT_ACCESS_ROUTES.invitations, { method: 'DELETE', headers: JSON_HEADERS, body: JSON.stringify({ invitationId }) }),
      labels['pa.sent.cancelled']
    );
  }

  if (load === 'hidden') return null;

  return (
    <section className="card acp-summary" aria-labelledby="pa-title" data-parent-access>
      <h2 id="pa-title">{labels['pa.title']}</h2>
      <p className="acp-hint">{labels['pa.body']}</p>

      {load === 'loading' && <p className="acp-hint">{labels['pa.loading']}</p>}

      {load === 'error' && (
        <div className="ta-actions">
          <p role="alert" className="role-alert role-alert-error">{labels['pa.loadError']}</p>
          <button type="button" className="btn btn-secondary" onClick={() => { setLoad('loading'); refresh(); }}>
            {labels['pa.retry']}
          </button>
        </div>
      )}

      {load === 'ready' && (
        <>
          {error && <p role="alert" className="role-alert role-alert-error">{error}</p>}
          {notice && <p role="status" className="role-alert">{notice}</p>}

          <h3 className="role-subheading">{labels['pa.access.title']}</h3>
          {parents.length === 0 ? (
            <p className="acp-hint">{labels['pa.access.none']}</p>
          ) : (
            <ul className="card list-card">
              {parents.map((p) => {
                const since = formatSince(p.since, locale);
                return (
                  <li key={p.parentId} className="list-row" style={{ flexWrap: 'wrap' }}>
                    <div className="row-main">
                      <div className="row-title">{p.name}</div>
                      {since && <div className="row-sub">{fillMessage(labels['pa.access.since'], { date: since })}</div>}
                    </div>
                    {confirming === p.parentId ? (
                      <div className="ta-actions" role="group" aria-label={fillMessage(labels['pa.revoke.confirm'], { name: p.name })}>
                        <p className="acp-hint">{fillMessage(labels['pa.revoke.confirm'], { name: p.name })}</p>
                        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => revoke(p.parentId)}>
                          {labels['pa.revoke.yes']}
                        </button>
                        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(null)}>
                          {labels['pa.revoke.no']}
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(p.parentId)}>
                        {labels['pa.revoke']}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <form
            className="role-inline-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              invite();
            }}
          >
            <label htmlFor="pa-invite-email">{labels['pa.invite.label']}</label>
            <div className="role-inline-row">
              <input
                id="pa-invite-email"
                type="email"
                autoComplete="off"
                aria-describedby="pa-invite-hint"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
                {labels['pa.invite.submit']}
              </button>
            </div>
            <p id="pa-invite-hint" className="ui-hint">{labels['pa.invite.hint']}</p>
          </form>

          {sent.length > 0 && (
            <>
              <h3 className="role-subheading">{labels['pa.sent.title']}</h3>
              <ul className="card list-card">
                {sent.map((inv) => (
                  <li key={inv.id} className="list-row" style={{ flexWrap: 'wrap' }}>
                    <div className="row-main">
                      <div className="row-title" style={{ overflowWrap: 'anywhere' }}>{inv.invitedEmail}</div>
                    </div>
                    <span className={inv.status === 'declined' ? 'chip chip-critical' : 'chip chip-warn'}>
                      {inv.status === 'declined' ? labels['pa.sent.declined'] : labels['pa.sent.pending']}
                    </span>
                    {inv.status === 'pending' && (
                      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => cancelInvitation(inv.id)}>
                        {labels['pa.sent.cancel']}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
