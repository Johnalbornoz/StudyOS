'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMessages, Locale } from '@/lib/i18n/messages';

export default function AddConceptTab({
  subjectId,
  studentId,
  locale,
}: {
  subjectId: string;
  studentId: string;
  locale: Locale;
}) {
  const t = getMessages(locale);
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; explanation: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (label.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/concepts/suggest?studentId=${studentId}&subjectId=${subjectId}&partial=${encodeURIComponent(label)}&language=${locale}`
        );
        const body = await res.json();
        if (res.ok) {
          setSuggestions(body.data.suggestions || []);
          setShowSuggestions(true);
        }
      } catch {
        // Autocomplete is a convenience -- fail silently
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [label, subjectId, studentId, locale]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || creating || generating) return;

    setShowSuggestions(false);
    setError(null);
    setResult(null);
    setCreating(true);

    try {
      const createRes = await fetch('/api/concepts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, subjectId, label: label.trim(), language: locale }),
      });
      const createBody = await createRes.json();
      if (!createRes.ok) throw new Error(createBody.error || t['common.error']);

      const conceptId = createBody.data.conceptId;
      setCreating(false);
      setGenerating(true);

      const explainRes = await fetch(`/api/concepts/${conceptId}/explanation?studentId=${studentId}&language=${locale}`);
      const explainBody = await explainRes.json();
      if (!explainRes.ok) throw new Error(explainBody.error || t['common.error']);

      setResult({ label: createBody.data.label, explanation: explainBody.data.explanation });
      setLabel('');
      router.refresh();
    } catch (err: any) {
      setError(err.message || t['subjectDetail.addConceptError']);
    } finally {
      setCreating(false);
      setGenerating(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 var(--space-4)' }}>
        {t['subjectDetail.addConceptBody']}
      </p>

      <form onSubmit={handleSubmit} style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder={t['subjectDetail.addConceptPlaceholder']}
              disabled={creating || generating}
              style={{
                width: '100%', height: 40, padding: '0 var(--space-3)',
                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
                fontSize: 14, fontFamily: 'inherit',
              }}
            />
            {showSuggestions && suggestions.length > 0 && (
              <div
                style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 4,
                  background: 'var(--bg-base)', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', overflow: 'hidden',
                }}
              >
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setLabel(s);
                      setShowSuggestions(false);
                    }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: 'var(--space-2) var(--space-3)',
                      fontSize: 13.5, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="submit" disabled={!label.trim() || creating || generating} className="btn btn-primary">
            {creating
              ? t['subjectDetail.addConceptCreating']
              : generating
                ? t['subjectDetail.addConceptGenerating']
                : t['subjectDetail.addConceptSubmit']}
          </button>
        </div>
      </form>

      {error && <p style={{ marginTop: 'var(--space-3)', fontSize: 13.5, color: 'var(--error)' }}>{error}</p>}

      {result && (
        <div
          className="card"
          style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', background: 'var(--bg-subtle)' }}
        >
          <h4 style={{ marginBottom: 8, fontSize: 14 }}>{result.label}</h4>
          <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{result.explanation}</div>
        </div>
      )}
    </div>
  );
}
