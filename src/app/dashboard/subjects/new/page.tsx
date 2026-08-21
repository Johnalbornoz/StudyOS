'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getMessages, LOCALES, LOCALE_NAMES, Locale } from '@/lib/i18n/messages';

export default function NewSubjectPage() {
  const [name, setName] = useState('');
  const [isLanguageSubject, setIsLanguageSubject] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState<Locale>('de');
  const [quizLanguageMode, setQuizLanguageMode] = useState<'match_interface' | 'fixed_english'>('match_interface');
  const [locale, setLocale] = useState<Locale>('es');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/language')
      .then((r) => r.json())
      .then((body) => body.locale && setLocale(body.locale))
      .catch(() => {});
  }, []);

  const t = getMessages(locale);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/subjects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          targetLanguage: isLanguageSubject ? targetLanguage : null,
          quizLanguageMode,
        }),
      });

      if (res.ok) {
        router.push('/dashboard');
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || t['common.error']);
      }
    } catch (err) {
      setError(t['common.error']);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <h1>{t['subjectNew.title']}</h1>
      <p style={{ color: 'var(--text-secondary)', margin: '8px 0 var(--space-8)', fontSize: 15 }}>
        {t['subjectNew.subtitle']}
      </p>

      <form onSubmit={handleSubmit} className="card">
        <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
          {t['subjectNew.nameLabel']}
        </label>
        <input
          type="text"
          placeholder={t['subjectNew.namePlaceholder']}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={{
            width: '100%',
            height: 44,
            padding: '0 var(--space-4)',
            marginBottom: 'var(--space-4)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-default)',
            fontSize: 14,
            fontFamily: 'inherit',
          }}
        />

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 'var(--space-4)', fontSize: 13.5, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isLanguageSubject}
            onChange={(e) => setIsLanguageSubject(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            {t['subjectNew.isLanguageLabel']}
            <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 12.5, marginTop: 2 }}>
              {t['subjectNew.isLanguageHelp']}
            </span>
          </span>
        </label>

        {isLanguageSubject ? (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
              {t['subjectNew.targetLanguageLabel']}
            </label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value as Locale)}
              style={{
                width: '100%', height: 40, borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)', fontSize: 14, fontFamily: 'inherit',
                padding: '0 var(--space-3)', background: 'var(--bg-base)', color: 'var(--text-primary)',
              }}
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
              {t['subjectNew.quizLanguageLabel']}
            </label>
            <select
              value={quizLanguageMode}
              onChange={(e) => setQuizLanguageMode(e.target.value as 'match_interface' | 'fixed_english')}
              style={{
                width: '100%', height: 40, borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)', fontSize: 14, fontFamily: 'inherit',
                padding: '0 var(--space-3)', background: 'var(--bg-base)', color: 'var(--text-primary)',
              }}
            >
              <option value="match_interface">{t['subjectNew.quizLanguageMatch']}</option>
              <option value="fixed_english">{t['subjectNew.quizLanguageFixed']}</option>
            </select>
          </div>
        )}

        <button type="submit" disabled={loading || !name} className="btn btn-primary">
          {loading ? t['common.creating'] : t['subjectNew.submit']}
        </button>
        {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 'var(--space-3)' }}>{error}</p>}
      </form>

      <Link href="/dashboard" className="btn btn-ghost" style={{ marginTop: 'var(--space-4)' }}>
        ← {t['common.back']}
      </Link>
    </div>
  );
}
