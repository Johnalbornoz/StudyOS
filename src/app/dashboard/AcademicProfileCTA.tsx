'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GraduationCap } from 'lucide-react';

const DISMISS_KEY = 'studyus.academicProfileCta.dismissed';

export default function AcademicProfileCTA({
  title,
  body,
  buttonLabel,
  dismissLabel,
}: {
  title: string;
  body: string;
  buttonLabel: string;
  dismissLabel: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  if (dismissed) return null;

  return (
    <div className="card" style={{ marginBottom: 'var(--space-8)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
      <div
        aria-hidden
        style={{
          flexShrink: 0, width: 40, height: 40, borderRadius: '50%', background: 'var(--brand-subtle)',
          color: 'var(--brand-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <GraduationCap size={20} strokeWidth={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 2 }}>{body}</div>
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ flexShrink: 0 }}
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
      >
        {dismissLabel}
      </button>
      <Link href="/dashboard/profile" className="btn btn-primary" style={{ flexShrink: 0 }}>
        {buttonLabel}
      </Link>
    </div>
  );
}
