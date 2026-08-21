'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getMessages, Locale } from '@/lib/i18n/messages';

export default function SubjectCard({
  id,
  name,
  status,
  studentId,
  locale,
}: {
  id: string;
  name: string;
  status: string;
  studentId: string;
  locale: Locale;
}) {
  const t = getMessages(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const archived = status === 'archived';

  async function toggleArchive() {
    setBusy(true);
    try {
      await fetch(`/api/subjects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, status: archived ? 'active' : 'archived' }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ opacity: archived ? 0.65 : 1 }}>
      <Link href={`/dashboard/subjects/${id}`} style={{ display: 'block' }}>
        <h3>{name}</h3>
        <span className={`chip ${archived ? 'chip-warn' : 'chip-good'}`} style={{ marginTop: 10 }}>
          {archived ? t['subjects.statusArchived'] : t['subjects.statusActive']}
        </span>
      </Link>
      <button
        className="btn btn-ghost"
        style={{ marginTop: 'var(--space-3)', fontSize: 12.5, padding: '4px 10px', height: 'auto' }}
        disabled={busy}
        onClick={toggleArchive}
      >
        {archived ? t['subjects.unarchiveAction'] : t['subjects.archiveAction']}
      </button>
    </div>
  );
}
