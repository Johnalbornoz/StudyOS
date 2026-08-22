'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = ['unpaid', 'active', 'past_due', 'canceled'] as const;

export default function PaymentStatusEditor({
  studentId,
  currentStatus,
  statusLabels,
  saveLabel,
}: {
  studentId: string;
  currentStatus: string;
  statusLabels: Record<string, string>;
  saveLabel: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/students/${studentId}/subscription`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        style={{
          height: 36, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
          padding: '0 var(--space-3)', fontFamily: 'inherit', fontSize: 14, background: 'var(--bg-base)', color: 'var(--text-primary)',
        }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{statusLabels[s]}</option>
        ))}
      </select>
      <button className="btn btn-secondary" disabled={saving || status === currentStatus} onClick={save}>
        {saveLabel}
      </button>
    </div>
  );
}
