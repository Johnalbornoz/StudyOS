'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMessages, Locale } from '@/lib/i18n/messages';

type TransferDistance = 'NEAR' | 'MID' | 'FAR';

export default function TransferPage() {
  const searchParams = useSearchParams();
  const subjectId = searchParams.get('subjectId') || '';
  const conceptId = searchParams.get('conceptId') || '';
  const conceptLabel = searchParams.get('conceptLabel') || '';
  const distance = (searchParams.get('distance') as TransferDistance) || 'NEAR';
  const remediationStepId = searchParams.get('remediationStepId') || undefined;

  const [locale, setLocale] = useState<Locale>('es');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'answering' | 'submitting' | 'done' | 'error'>('loading');
  const [context, setContext] = useState('');
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [result, setResult] = useState<{ result: 'correct' | 'partial' | 'incorrect'; feedback: string } | null>(null);
  // Phase 1D: stamped once, right when the prompt becomes visible.
  const presentedAtRef = useRef<string | null>(null);
  // Phase 2B: minted server-side once per generated activity (never
  // regenerated on submit), round-tripped unchanged on every submit
  // attempt for THIS activity, including a network retry -- the
  // stable identity the evidence idempotency key is built from.
  const activityIdRef = useRef<string | null>(null);

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

      const res = await fetch('/api/cognitive/transfer/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: me.studentId, conceptId, conceptLabel, distance, language: lang.locale || 'en' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPhase('error');
        return;
      }
      setContext(body.data.context);
      setPrompt(body.data.prompt);
      activityIdRef.current = body.data.activityId;
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
    const res = await fetch('/api/cognitive/transfer/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        subjectId,
        conceptId,
        conceptLabel,
        prompt,
        distance,
        studentResponse: response,
        language: locale,
        remediationStepId,
        questionPresentedAt: presentedAtRef.current,
        answerSubmittedAt,
        activityId: activityIdRef.current,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      setPhase('error');
      return;
    }
    setResult({ result: body.data.result, feedback: body.data.feedback });
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

  const resultLabel = result ? (result.result === 'correct' ? t['cognitive.resultCorrect'] : result.result === 'partial' ? t['cognitive.resultPartial'] : t['cognitive.resultIncorrect']) : '';
  const resultColor = result ? (result.result === 'correct' ? 'var(--brand)' : result.result === 'partial' ? 'var(--warning)' : 'var(--error)') : undefined;

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
        <Link href={`/dashboard/subjects/${subjectId}`} style={{ color: 'var(--text-muted)' }}>{conceptLabel}</Link>
      </div>
      <h1 style={{ marginBottom: 4 }}>{t['cognitive.transferTitle']}</h1>
      {context && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 'var(--space-6)' }}>
          {t['cognitive.transferContextLabel']}: {context}
        </p>
      )}

      <div className="card" style={{ padding: 'var(--space-6)' }}>
        <p id="transfer-prompt" style={{ fontSize: 16, fontWeight: 600, marginBottom: 'var(--space-4)' }}>{prompt}</p>
        {phase !== 'done' ? (
          <>
            <label htmlFor="transfer-response" className="sr-only">{t['cognitive.transferTitle']}</label>
            <textarea
              id="transfer-response"
              aria-labelledby="transfer-prompt"
              value={response}
              onChange={(e) => setResponse(e.target.value)}
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
          result && (
            <div role="status" aria-live="polite" style={{ marginTop: 'var(--space-2)' }}>
              <div style={{ fontSize: 20, fontWeight: 650, marginBottom: 4, color: resultColor }}>{resultLabel}</div>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{result.feedback}</p>
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
