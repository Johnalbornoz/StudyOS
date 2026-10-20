'use client';

/**
 * Track A -- coordinators of one institution: who they are (name · email),
 * status, invited / accepted dates, and the actions the viewer may take.
 * `apiBase` is the Platform Admin route (`/api/admin/institutions/{id}`) or
 * the coordinator's own institution route (`/api/institutions/{id}`); the
 * server authorizes every action.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface CoordinatorView {
  kind: 'MEMBER' | 'INVITATION';
  id: string;
  name: string | null;
  email: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'EXPIRED' | 'REVOKED';
  invitedAt: string | null;
  acceptedAt: string | null;
  isSelf?: boolean;
}

export interface CoordinatorsLabels {
  title: string;
  body: string;
  empty: string;
  name: string;
  email: string;
  invite: string;
  inviting: string;
  status: Record<CoordinatorView['status'], string>;
  invitedOn: string;
  acceptedOn: string;
  remove: string;
  removeConfirm: string;
  withdraw: string;
  you: string;
  outcome: Record<'INVITED' | 'ALREADY_INVITED' | 'ASSIGNED_EXISTING' | 'ALREADY_COORDINATOR', string>;
  errors: Record<string, string>;
  error: string;
  copyLink: string;
  linkCopied: string;
  /** Track A: reactivate a removed (INACTIVE) coordinator of this institution. */
  reactivate?: string;
}

export function CoordinatorsPanel({ apiBase, coordinators, locale, labels, canManage = true }: { apiBase: string; coordinators: CoordinatorView[]; locale: string; labels: CoordinatorsLabels; canManage?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale) : null);

  async function post(url: string, body?: unknown) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  }

  async function invite() {
    setBusy(true);
    setMessage(null);
    setLink(null);
    const res = await post(`${apiBase}/coordinators`, { email: email.trim(), name: name.trim() || null });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      const outcome = json?.data?.outcome as keyof CoordinatorsLabels['outcome'];
      setMessage({ text: labels.outcome[outcome] ?? labels.outcome.INVITED });
      if (outcome === 'INVITED' && json?.data?.acceptPath) setLink(window.location.origin + json.data.acceptPath);
      setEmail('');
      setName('');
      router.refresh();
    } else setMessage({ text: labels.errors[json?.error] ?? labels.error, error: true });
  }

  async function act(url: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    const res = await post(url);
    const json = await res.json().catch(() => ({}));
    if (res.ok) router.refresh();
    else setMessage({ text: labels.errors[json?.error] ?? labels.error, error: true });
  }

  return (
    <section className="card ta-card" aria-labelledby="coordinators-title">
      <h2 id="coordinators-title">{labels.title}</h2>
      <p className="ta-msg">{labels.body}</p>
      {coordinators.length === 0 ? (
        <p className="ta-msg">{labels.empty}</p>
      ) : (
        <ul className="role-list">
          {coordinators.map((c) => (
            <li key={`${c.kind}-${c.id}`} className="ta-coordinator">
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <strong style={{ overflowWrap: 'anywhere' }}>
                  {c.name ?? c.email}
                  {c.isSelf ? ` (${labels.you})` : ''}
                </strong>
                {c.name && c.email && <span className="ta-msg" style={{ overflowWrap: 'anywhere' }}>{c.email}</span>}
                <span className="ta-msg">
                  {[c.invitedAt ? `${labels.invitedOn} ${date(c.invitedAt)}` : null, c.acceptedAt ? `${labels.acceptedOn} ${date(c.acceptedAt)}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="ta-actions">
                <span className={c.status === 'ACTIVE' ? 'chip chip-good' : c.status === 'PENDING' ? 'chip chip-warn' : 'chip'}>{labels.status[c.status]}</span>
                {canManage && c.kind === 'MEMBER' && c.status === 'ACTIVE' && !c.isSelf && (
                  <button type="button" className="btn btn-ghost" onClick={() => act(`${apiBase}/coordinators/${c.id}/remove`, labels.removeConfirm.replace('{name}', c.name ?? c.email ?? ''))}>
                    {labels.remove}
                  </button>
                )}
                {canManage && labels.reactivate && c.kind === 'MEMBER' && c.status === 'INACTIVE' && (
                  <button type="button" className="btn btn-ghost" onClick={() => act(`${apiBase}/coordinators/${c.id}/reactivate`)}>
                    {labels.reactivate}
                  </button>
                )}
                {canManage && c.kind === 'INVITATION' && c.status === 'PENDING' && (
                  <button type="button" className="btn btn-ghost" onClick={() => act(`${apiBase}/coordinator-invitations/${c.id}/revoke`)}>
                    {labels.withdraw}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form
          className="ta-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) invite();
          }}
        >
          <div className="ta-row">
            <span className="ta-field">
              <label htmlFor="coord-name">{labels.name}</label>
              <input id="coord-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </span>
            <span className="ta-field">
              <label htmlFor="coord-email">{labels.email}</label>
              <input id="coord-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </span>
          </div>
          <div className="ta-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
              {busy ? labels.inviting : labels.invite}
            </button>
          </div>
        </form>
      )}
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={message.error ? 'ta-msg ta-msg-error' : 'ta-msg'}>
          {message.text}
        </p>
      )}
      {link && (
        <p className="ta-msg">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              navigator.clipboard?.writeText(link).then(() => setMessage({ text: labels.linkCopied })).catch(() => {});
            }}
          >
            {labels.copyLink}
          </button>
        </p>
      )}
    </section>
  );
}
