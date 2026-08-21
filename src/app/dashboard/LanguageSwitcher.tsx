'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LOCALES, LOCALE_NAMES, Locale } from '@/lib/i18n/messages';

export default function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onChange(next: string) {
    setPending(true);
    await fetch('/api/language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: next }),
    });
    router.refresh();
    setPending(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label className="label" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
        {label}
      </label>
      <select
        value={locale}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        style={{
          height: 32,
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-default)',
          background: 'var(--bg-base)',
          color: 'var(--text-primary)',
          fontSize: 13,
          fontFamily: 'inherit',
          padding: '0 8px',
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
