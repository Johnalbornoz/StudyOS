'use client';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import LearningSupportStatus from '../../LearningSupportStatus';
import ContinuationPanel from '@/app/dashboard/quiz/ContinuationPanel';
import { getMessages, Locale } from '@/lib/i18n/messages';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { Skeleton } from '@/components/ui/Skeleton';
import { SessionHeader } from '@/components/learning/SessionHeader';
import { classifySubmitFailure, submitFailureKey, type SubmitFailure } from '@/lib/experience/learning-session';
import { SafetyNotice, safetyFromBody, type SafetyNoticeData } from '@/components/safety/SafetyNotice';

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
  const [response, setResponse] = useState('');
  const [feedback, setFeedback] = useState<{ feedback: string; scorePercent: number } | null>(null);
  // Phase 1D: stamped once, right when the prompt becomes visible.
  const presentedAtRef = useRef<string | null>(null);
  // Phase 2B: minted server-side once per generated activity (never
  // regenerated on submit), round-tripped unchanged on every submit
  // attempt for THIS activity, including a network retry -- the
  // stable identity the evidence idempotency key is built from.
  const activityIdRef = useRef<string | null>(null);

  // UX-3: failures are visible and recoverable. A failed submit keeps the
  // learner's text and re-sends with the SAME activityId (the server's
  // evidence idempotency key), so a retry can never double-count.
  const [submitFailure, setSubmitFailure] = useState<SubmitFailure | null>(null);
  // Human Agency P0-4: fixed safety response from the server (no AI involved).
  const [safety, setSafety] = useState<SafetyNoticeData | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const t = getMessages(locale);

  useEffect(() => {
    async function load() {
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
      activityIdRef.current = body.data.activityId;
      setPhase('answering');
      // Phase 1D: the prompt just became visible/answerable.
      presentedAtRef.current = new Date().toISOString();
    }
    load().catch(() => setPhase('error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);

  async function submit() {
    if (!studentId || !response.trim()) return;
    // Phase 1D: captured before setPhase('submitting')/the fetch.
    const answerSubmittedAt = new Date().toISOString();
    setPhase('submitting');
    setSubmitFailure(null);
    setSafety(null);
    let res: Response;
    try {
    res = await fetch('/api/cognitive/explain/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Human Agency P0-3: the question and its rubric live on the server
        // (keyed by activityId); the browser sends only the answer.
        studentId,
        subjectId,
        conceptId,
        studentResponse: response,
        language: locale,
        remediationStepId,
        questionPresentedAt: presentedAtRef.current,
        answerSubmittedAt,
        activityId: activityIdRef.current,
      }),
    });
    } catch {
      setSubmitFailure(classifySubmitFailure({ thrown: true }));
      setPhase('answering');
      return;
    }
    const body = await res.json().catch(() => null);
    const safetyResponse = safetyFromBody(body);
    if (safetyResponse) {
      setSafety(safetyResponse);
      setPhase('answering');
      return;
    }
    if (!res.ok || !body?.data) {
      setSubmitFailure(classifySubmitFailure({ status: res.status, errorCode: body?.error ?? null }));
      setPhase('answering');
      return;
    }
    setFeedback({ feedback: body.data.rubric.feedback, scorePercent: body.data.scorePercent });
    setPhase('done');
  }

  const lsKind = remediationStepId ? 'reinforce' : 'check';
  if (phase === 'loading') {
    return (
      <div className="ls" data-kind={lsKind}>
        <div className="card ls-preparing" role="status" aria-live="polite">
          <span className="ls-kicker">{t['cognitive.explainTitle']}</span>
          <p className="ls-preparing-text">{t['xs.preparing']}</p>
          <Skeleton height={24} width="85%" />
          <Skeleton height={120} radius="var(--radius-md)" />
        </div>
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="ls" data-kind={lsKind}>
        <InlineAlert
          tone="error"
          title={t['practice.prepareFailedTitle']}
          body={t['practice.prepareFailedBody']}
          actions={
            <>
              <button type="button" className="btn btn-primary" onClick={() => { setPhase('loading'); setLoadAttempt((n) => n + 1); }}>
                {t['practice.prepareRetry']}
              </button>
              <Link href={subjectId && conceptId ? `/dashboard/subjects/${subjectId}/concepts/${conceptId}` : '/dashboard/today'} className="btn btn-secondary">
                {t['continuation.backToConcept']}
              </Link>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="ls" data-kind={lsKind}>
      <SessionHeader kind={lsKind} kindLabel={t['cognitive.explainTitle']} title={conceptLabel || t['cognitive.explainTitle']} />

      {/* Phase 6 Closeout A: Explain & Defend is always an independent
          reasoning demonstration -- no hints, no AI help. Fixed by the
          activity's identity, not derived from any learner state. */}
      <LearningSupportStatus assistanceMode="INDEPENDENT" context="EXPLAIN" t={t} />

      <section className="card ls-task" aria-labelledby="explain-prompt">
        <h2 id="explain-prompt" className="ls-question">{prompt}</h2>
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
              className="ui-input ls-textarea"
            />
            {safety && <SafetyNotice safety={safety} />}
            {submitFailure && (
              <InlineAlert tone="error" title={t['xs.submitFailedTitle']} body={t[submitFailureKey(submitFailure)]} />
            )}
            <div className="ls-actions">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={!response.trim() || phase === 'submitting'}
                aria-busy={phase === 'submitting'}
                onClick={submit}
              >
                {phase === 'submitting' ? t['quiz.submitting'] : submitFailure ? t['xs.retrySubmit'] : t['cognitive.submitAnswer']}
              </button>
            </div>
          </>
        ) : (
          feedback && (
            <div role="status" aria-live="polite" style={{ marginTop: 'var(--space-2)' }}>
              <div className="tabular" style={{ fontSize: 28, fontWeight: 650, marginBottom: 4 }}>{feedback.scorePercent}%</div>
              <p className="label" style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t['cognitive.feedbackTitle']}</p>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{feedback.feedback}</p>
              {/* LX-5R Issue 1 (extended): the Explain/Defend completion surface
                  is structurally identical to Transfer's -- same dead end, same
                  fix. It is only ever reached as a remediation sub-activity, so
                  the REINFORCE checkpoint carries the learner back into the
                  repair journey via the same canonical resolver. */}
              {studentId && subjectId && conceptId ? (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <ContinuationPanel
                    studentId={studentId}
                    subjectId={subjectId}
                    conceptId={conceptId}
                    locale={locale}
                    from={remediationStepId ? 'REINFORCE' : 'LEARN'}
                    variant="inline"
                  />
                </div>
              ) : (
                <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }}>
                  {t['cognitive.continueButton']}
                </Link>
              )}
            </div>
          )
        )}
      </section>
    </div>
  );
}
