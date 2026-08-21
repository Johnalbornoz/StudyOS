'use client';

import { useEffect, useState } from 'react';
import { getMessages, Locale } from '@/lib/i18n/messages';

interface PendingRequest {
  parentId: string;
  parentName: string;
  requestedAt: string;
}

export default function ParentRequestsPanel({ locale }: { locale: Locale }) {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  const t = getMessages(locale);

  async function load() {
    const res = await fetch('/api/parent/requests');
    const body = await res.json();
    setRequests(body.data?.requests || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function respond(parentId: string, accept: boolean) {
    setRespondingTo(parentId);
    try {
      await fetch('/api/parent/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, accept }),
      });
      await load();
    } finally {
      setRespondingTo(null);
    }
  }

  if (loading || requests.length === 0) return null;

  return (
    <div className="card list-card" style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
        <p className="label" style={{ color: 'var(--text-muted)', margin: 0 }}>{t['parent.requestsTitle']}</p>
      </div>
      {requests.map((r) => (
        <div key={r.parentId} className="list-row">
          <div className="row-main">
            <div className="row-title">{r.parentName}</div>
            <div className="row-sub">{t['parent.requestBody']}</div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 13 }}
              disabled={respondingTo === r.parentId}
              onClick={() => respond(r.parentId, false)}
            >
              {t['parent.decline']}
            </button>
            <button
              className="btn btn-primary"
              style={{ fontSize: 13, height: 32 }}
              disabled={respondingTo === r.parentId}
              onClick={() => respond(r.parentId, true)}
            >
              {t['parent.accept']}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
