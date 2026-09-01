'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMessages, Locale } from '@/lib/i18n/messages';

export default function ExplainDefendPage() {
  const searchParams = useSearchParams();
  const subjectId = searchParams.get('subjectId') || '';
  const conceptId = searchParams.get('conceptId') || '';
  const conceptLabel = searchParams.get('conceptLabel') || '';
  const remediationStepId = searchParams.get('remediationStepId') || undefined;

  const [locale, setLocale] = useState<Locale>('es');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'answering' | 'submitting' | 'done' | 'error'>('loading');
  const [prompt, setPrompt] = useState('');
  const [expectedElements, setExpectedElements] = useState<string[]>([]);
  const [response, setResponse] = useState('');
  const [feedback, setFeedback] = useState<{ feedback: string; scorePercent: number } | null>(null);
  // Phase 1D: stamped once, right when the prompt becomes visible.
  const presentedAtRef = useRef<string | null>(null);

  const t = getMessages(locale);

  useEffect(() => {
    async function init() {
      const [meRes, langRes] = await Promise.all([fetch('/api/me'), fetch('/api/language')]);
      const me = await meRes.json();
      const lang = await langRes.json();
      if (lang.locale) setLocale(lang.locale);
      if (!me.studentId) {
        setPhase('error');
        return;
      }
      setStudentId(me.studentId);

      const res = await fetch('/api/cognitive/explain/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: me.studentId, subjectId, conceptId, conceptLabel, language: lang.locale || 'en' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPhase('error');
        return;
      }
      setPrompt(body.data.prompt);
      setExpectedElements(body.data.expectedElements || []);
      setPhase('answering');
      // Phase 1D: the prompt just became visible/answerable.
      presentedAtRef.current = new Date().toISOString();
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!studentId || !response.trim()) return;
    // Phase 1D: captured before setPhase('submitting')/the fetch.
    const answerSubmittedAt = new Date().toISOString();
    setPhase('submitting');
    const res = await fetch('/api/cognitive/explain/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        subjectId,
        conceptId,
        conceptLabel,
        prompt,
        expectedElements,
        studentResponse: response,
        language: locale,
        remediationStepId,
        questionPresentedAt: presentedAtRef.current,
        answerSubmittedAt,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      setPhase('error');
      return;
    }
    setFeedback({ feedback: body.data.rubric.feedback, scorePercent: body.data.scorePercent });
    setPhase('done');
  }

  if (phase === 'loading' || phase === 'error') {
    return (
      <div style={{ maxWidth: 560 }}>
        <p role="status" aria-live="polite" style={{ color: 'var(--text-muted)' }}>
          {phase === 'loading' ? t['cognitive.generating'] : t['common.error']}
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
        <Link href={`/dashboard/subjects/${subjectId}`} style={{ color: 'var(--text-muted)' }}>{conceptLabel}</Link>
      </div>
      <h1 style={{ marginBottom: 'var(--space-6)' }}>{t['cognitive.explainTitle']}</h1>

      <div className="card" style={{ padding: 'var(--space-6)' }}>
        <p id="explain-prompt" style={{ fontSize: 16, fontWeight: 600, marginBottom: 'var(--space-4)' }}>{prompt}</p>
        {phase !== 'done' ? (
          <>
            <label htmlFor="explain-response" className="sr-only">{t['cognitive.explainTitle']}</label>
            <textarea
              id="explain-response"
              aria-labelledby="explain-prompt"
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder={t['cognitive.explainPlaceholder']}
              rows={6}
              style={{
                width: '100%', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
                background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 14, resize: 'vertical',
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 'var(--space-4)' }}
              disabled={!response.trim() || phase === 'submitting'}
              onClick={submit}
            >
              {phase === 'submitting' ? t['cognitive.generating'] : t['cognitive.submitAnswer']}
            </button>
          </>
        ) : (
          feedback && (
            <div role="status" aria-live="polite" style={{ marginTop: 'var(--space-2)' }}>
              <div className="tabular" style={{ fontSize: 28, fontWeight: 650, marginBottom: 4 }}>{feedback.scorePercent}%</div>
              <p className="label" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t['cognitive.feedbackTitle']}</p>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{feedback.feedback}</p>
              <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }}>
                {t['cognitive.continueButton']}
              </Link>
            </div>
          )
        )}
      </div>
    </div>
  );
}
