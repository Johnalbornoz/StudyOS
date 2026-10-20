'use client';

/**
 * Track A (A3) -- the Teacher's own institutional authorization: status per
 * institution and the request form. A request is always PENDING and grants
 * nothing until the institution approves AND assigns a class (server-side).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface MembershipRow {
  id: string;
  institutionId: string;
  institutionName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVOKED';
}

export function TeacherMembershipPanel({
  memberships,
  institutions,
  labels,
}: {
  memberships: MembershipRow[];
  institutions: Array<{ id: string; name: string }>;
  labels: {
    title: string;
    requestTitle: string;
    requestBody: string;
    select: string;
    submit: string;
    sent: string;
    again: string;
    none: string;
    error: string;
    status: Record<MembershipRow['status'], string>;
  };
}) {
  const router = useRouter();
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function request(institutionId: string) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/institutions/${institutionId}/membership`, { method: 'POST' });
    setMessage(res.ok ? { text: labels.sent } : { text: labels.error, error: true });
    setBusy(false);
    if (res.ok) {
      setSelected('');
      router.refresh();
    }
  }

  const requestable = institutions.filter((i) => !memberships.some((m) => m.institutionId === i.id));

  return (
    <section className="card ta-card" aria-labelledby="teacher-institutions">
      <h2 id="teacher-institutions">{labels.title}</h2>
      {memberships.length > 0 && (
        <ul className="role-list">
          {memberships.map((m) => (
            <li key={m.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
              <strong style={{ fontSize: 14 }}>{m.institutionName}</strong>
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <span className={m.status === 'APPROVED' ? 'chip chip-good' : m.status === 'PENDING' ? 'chip chip-warn' : 'chip chip-critical'}>
                  {labels.status[m.status]}
                </span>
                {(m.status === 'REJECTED' || m.status === 'REVOKED') && (
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => request(m.institutionId)}>
                    {labels.again}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="ta-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (selected) request(selected);
        }}
      >
        <label htmlFor="institution-select">{labels.requestTitle}</label>
        <p className="ta-msg">{labels.requestBody}</p>
        {requestable.length === 0 ? (
          <p className="ta-msg">{labels.none}</p>
        ) : (
          <div className="ta-row">
            <select id="institution-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">{labels.select}</option>
              {requestable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary" disabled={busy || !selected}>
              {labels.submit}
            </button>
          </div>
        )}
      </form>
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={message.error ? 'ta-msg ta-msg-error' : 'ta-msg'}>
          {message.text}
        </p>
      )}
    </section>
  );
}
