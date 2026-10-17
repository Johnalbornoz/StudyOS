'use client';

/**
 * APPLY -- the adaptive transfer ladder (transfer-ladder-v1). One challenge at a time.
 *
 * Presentation only: every level, pass/fail and closing decision is the server's
 * (/api/learning/apply/start, /api/learning/apply/answer). The page never chooses a level and
 * never sees a model answer until the attempt ends. APPLY is independent: no hints, no Tutor (the
 * server session is INDEPENDENT; this page renders no assistance controls).
 */
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import LearningSupportStatus from '../../LearningSupportStatus';
import ContinuationPanel from '@/app/dashboard/quiz/ContinuationPanel';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { Skeleton } from '@/components/ui/Skeleton';
import { SessionHeader } from '@/components/learning/SessionHeader';
import { SafetyNotice, safetyFromBody, type SafetyNoticeData } from '@/components/safety/SafetyNotice';
import { AccessRequiredNotice } from '@/components/ui/AccessRequiredNotice';
import { isEntitlementRequired } from '@/lib/lx/access-required';
import { quizInstanceKey } from '@/lib/lx/continuation';

type Level = 'NEAR' | 'MID' | 'FAR';

interface ChallengeView { index: number; level: Level; context: string; prompt: string; taskId: string }
interface ResultView { index: number; level: Level; scorePercent: number; passed: boolean; countsTowardLevel: boolean }
interface Summary {
  highestLevelReached: Level | null;
  competency: 'LOW' | 'MEDIUM' | 'HIGH';
  applyCompleted: boolean;
  performance: Array<{ level: Level; attempted: number; passed: number; certifiedPassed: number; bestScorePercent: number | null }>;
  challenges: Array<{ index: number; level: Level; context: string; prompt: string; scorePercent: number; passed: boolean; countsTowardLevel: boolean; feedback: string; modelAnswer: string }>;
}
interface LadderView {
  sessionId: string;
  conceptId: string;
  subjectId: string;
  conceptLabel: string;
  challengeCount: number;
  currentLevel: Level;
  results: ResultView[];
  pending: ChallengeView | null;
  nextUnavailable: string | null;
  summary: Summary | null;
}

type Phase = 'loading' | 'answering' | 'submitting' | 'result' | 'summary' | 'nextUnavailable' | 'error' | 'access' | 'notAuthorized' | 'expired';

export default function ApplyPage() {
  const params = useParams<{ conceptId: string }>();
  const searchParams = useSearchParams();
  const conceptId = typeof params?.conceptId === 'string' ? params.conceptId : '';
  const subjectId = searchParams.get('subjectId') || '';
  // A continuation back onto this same page (e.g. APPLY again after a NEAR-only result) carries a
  // relaunch nonce; the key remounts a fresh instance, like the quiz page.
  return <ApplyActivity key={`${conceptId}|${quizInstanceKey(searchParams)}`} conceptId={conceptId} subjectId={subjectId} />;
}

function ApplyActivity({ conceptId, subjectId }: { conceptId: string; subjectId: string }) {

  const [locale, setLocale] = useState<Locale>('es');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [view, setView] = useState<LadderView | null>(null);
  const [lastResult, setLastResult] = useState<ResultView | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [safety, setSafety] = useState<SafetyNoticeData | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const t = getMessages(locale);
  const backHref = subjectId && conceptId ? `/dashboard/subjects/${subjectId}/concepts/${conceptId}` : '/dashboard/today';

  function applyView(next: LadderView) {
    setView(next);
    if (next.summary) setPhase('summary');
    else if (next.pending) setPhase('answering');
    else setPhase('nextUnavailable');
  }

  useEffect(() => {
    async function load() {
      const [meRes, langRes] = await Promise.all([fetch('/api/me'), fetch('/api/language')]);
      const me = await meRes.json();
      const lang = await langRes.json().catch(() => ({}));
      if (lang?.locale) setLocale(lang.locale);
      if (!me?.studentId || !conceptId || !subjectId) {
        setPhase('error');
        return;
      }
      setStudentId(me.studentId);
      const res = await fetch('/api/learning/apply/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: me.studentId, conceptId, subjectId, language: lang?.locale || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (isEntitlementRequired(res.status, body)) return setPhase('access');
      if (body?.error === 'TRANSFER_NOT_AUTHORIZED') return setPhase('notAuthorized');
      if (body?.error === 'APPLY_SESSION_EXPIRED') return setPhase('expired');
      if (!res.ok || !body?.data) return setPhase('error');
      setLastResult(null);
      applyView(body.data as LadderView);
    }
    load().catch(() => setPhase('error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);

  function reload() {
    setPhase('loading');
    setLoadAttempt((n) => n + 1);
  }

  async function submit() {
    if (!studentId || !view?.pending || !answer.trim()) return;
    setPhase('submitting');
    setSubmitError(null);
    setSafety(null);
    let res: Response;
    try {
      res = await fetch('/api/learning/apply/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, sessionId: view.sessionId, answer }),
      });
    } catch {
      setSubmitError(t['apply.gradingUnavailable']);
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
    if (body?.error === 'APPLY_SESSION_EXPIRED') return setPhase('expired');
    if (body?.error === 'APPLY_SESSION_CONFLICT') {
      setSubmitError(t['apply.conflict']);
      setPhase('answering');
      return;
    }
    if (!res.ok || !body?.data) {
      setSubmitError(t['apply.gradingUnavailable']);
      setPhase('answering');
      return;
    }
    const result = body.data.result as ResultView;
    const next = body.data.view as LadderView;
    setLastResult(result);
    setAnswer('');
    setView(next);
    setPhase(next.summary ? 'summary' : 'result');
  }

  const kindLabel = t['apply.kicker'];
  const title = view?.conceptLabel || t['apply.title'];

  if (phase === 'loading') {
    return (
      <div className="ls" data-kind="transfer">
        <div className="card ls-preparing" role="status" aria-live="polite">
          <span className="ls-kicker">{kindLabel}</span>
          <p className="ls-preparing-text">{t['apply.preparing']}</p>
          <Skeleton height={24} width="85%" />
          <Skeleton height={120} radius="var(--radius-md)" />
        </div>
      </div>
    );
  }
  if (phase === 'access') {
    return (
      <div className="ls" data-kind="transfer">
        <AccessRequiredNotice locale={locale} actions={<Link href={backHref} className="btn btn-ghost">{t['apply.backToConcept']}</Link>} />
      </div>
    );
  }
  if (phase === 'error' || phase === 'notAuthorized' || phase === 'expired') {
    const body = phase === 'notAuthorized' ? t['apply.notAuthorized'] : phase === 'expired' ? t['apply.expired'] : t['apply.loadFailed'];
    return (
      <div className="ls" data-kind="transfer">
        <InlineAlert
          tone={phase === 'error' ? 'error' : 'info'}
          title={t['apply.title']}
          body={body}
          actions={
            <>
              {phase !== 'notAuthorized' && (
                <button type="button" className="btn btn-primary" onClick={reload}>
                  {phase === 'expired' ? t['apply.startNew'] : t['apply.retry']}
                </button>
              )}
              <Link href={backHref} className="btn btn-secondary">{t['apply.backToConcept']}</Link>
            </>
          }
        />
      </div>
    );
  }

  const progress = view ? (
    <ol className="apply-progress" aria-label={t['apply.perLevel']} style={{ display: 'flex', gap: 'var(--space-2)', listStyle: 'none', padding: 0, margin: 'var(--space-2) 0', flexWrap: 'wrap' }}>
      {view.results.map((r) => (
        <li key={r.index} style={{ fontSize: 13, color: r.passed ? 'var(--brand)' : 'var(--text-secondary)' }}>
          {fillMessage(t['apply.challengeOf'], { n: r.index })} · {t[`apply.level.${r.level}`]} · {r.passed ? '✓' : '✗'}
        </li>
      ))}
    </ol>
  ) : null;

  if (phase === 'summary' && view?.summary) {
    const s = view.summary;
    return (
      <div className="ls" data-kind="transfer">
        <SessionHeader kind="transfer" kindLabel={kindLabel} title={title} purpose={t['apply.summaryTitle']} />
        {lastResult && <ChallengeResultLine t={t} result={lastResult} />}
        <section className="card ls-task" aria-labelledby="apply-summary">
          <h2 id="apply-summary" className="ls-question">{t['apply.summaryTitle']}</h2>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            {t['apply.highestLevel']}: <strong>{s.highestLevelReached ? t[`apply.level.${s.highestLevelReached}`] : t['apply.highestNone']}</strong>
          </p>
          <div role="status" style={{ marginTop: 'var(--space-2)' }}>
            <div style={{ fontSize: 20, fontWeight: 650, color: s.competency === 'LOW' ? 'var(--text-secondary)' : 'var(--brand)' }}>{t[`apply.competency.${s.competency}`]}</div>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{t[`apply.competencyBody.${s.competency}`]}</p>
          </div>
          <h3 style={{ fontSize: 15, marginTop: 'var(--space-4)' }}>{t['apply.perLevel']}</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {s.performance.map((p) => (
              <li key={p.level} style={{ fontSize: 14 }}>
                <strong>{t[`apply.level.${p.level}`]}</strong>:{' '}
                {p.attempted === 0 ? t['apply.notAttempted'] : fillMessage(t['apply.perLevelRow'], { passed: p.passed, attempted: p.attempted, best: p.bestScorePercent ?? 0 })}
              </li>
            ))}
          </ul>
          <h3 style={{ fontSize: 15, marginTop: 'var(--space-4)' }}>{t['apply.review']}</h3>
          {s.challenges.map((c) => (
            <details key={c.index} style={{ marginTop: 'var(--space-2)' }}>
              <summary style={{ fontSize: 14 }}>
                {fillMessage(t['apply.challengeOf'], { n: c.index })} · {t[`apply.level.${c.level}`]} · {c.context} · {fillMessage(c.passed ? t['apply.resultPassed'] : t['apply.resultNotPassed'], { score: c.scorePercent })}
              </summary>
              <p style={{ fontSize: 14 }}>{c.prompt}</p>
              {c.passed && !c.countsTowardLevel && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t['apply.notCounted']}</p>}
              {c.feedback && <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}><strong>{t['apply.feedback']}:</strong> {c.feedback}</p>}
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}><strong>{t['apply.modelAnswer']}:</strong> {c.modelAnswer}</p>
            </details>
          ))}
          <h3 style={{ fontSize: 15, marginTop: 'var(--space-4)' }}>{t['apply.nextStep']}</h3>
          {studentId ? (
            <ContinuationPanel studentId={studentId} subjectId={subjectId} conceptId={conceptId} locale={locale} from="TRANSFER" variant="inline" />
          ) : (
            <Link href={backHref} className="btn btn-primary">{t['apply.backToConcept']}</Link>
          )}
        </section>
      </div>
    );
  }

  if (phase === 'result' && lastResult) {
    return (
      <div className="ls" data-kind="transfer">
        <SessionHeader kind="transfer" kindLabel={kindLabel} title={title} purpose={t['apply.title']} />
        {progress}
        <section className="card ls-task" role="status" aria-live="polite">
          <ChallengeResultLine t={t} result={lastResult} />
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
            {!lastResult.passed ? t['apply.resultNotPassedNote'] : lastResult.countsTowardLevel ? t['apply.resultPassedNote'] : t['apply.resultUncertifiedNote']}
          </p>
          <div className="ls-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => view && applyView(view)}>{t['apply.next']}</button>
          </div>
        </section>
      </div>
    );
  }

  if (phase === 'nextUnavailable') {
    return (
      <div className="ls" data-kind="transfer">
        <SessionHeader kind="transfer" kindLabel={kindLabel} title={title} purpose={t['apply.title']} />
        {progress}
        <InlineAlert
          tone="error"
          title={t['apply.title']}
          body={view?.nextUnavailable === 'APPLY_CHALLENGE_NOT_NOVEL_ENOUGH' ? t['apply.notNovel'] : t['apply.nextUnavailable']}
          actions={<button type="button" className="btn btn-primary" onClick={reload}>{t['apply.retry']}</button>}
        />
      </div>
    );
  }

  const pending = view?.pending;
  if (!pending) return null;
  return (
    <div className="ls" data-kind="transfer">
      <SessionHeader
        kind="transfer"
        kindLabel={kindLabel}
        title={title}
        purpose={`${fillMessage(t['apply.challengeOf'], { n: pending.index })} · ${t[`apply.level.${pending.level}`]}`}
      />
      {pending.index === 1 && <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{t['apply.intro']}</p>}
      {/* APPLY is always an independent attempt: no hints, no AI help. */}
      <LearningSupportStatus assistanceMode="INDEPENDENT" context="SOLO" t={t} />
      {progress}
      <section className="card ls-task" aria-labelledby="apply-prompt">
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t['apply.contextLabel']}: {pending.context}</p>
        <h2 id="apply-prompt" className="ls-question">{pending.prompt}</h2>
        <label htmlFor="apply-answer" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t['apply.answerLabel']} — {t['apply.answerHint']}</label>
        <textarea id="apply-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} rows={6} className="ui-input ls-textarea" />
        {safety && <SafetyNotice safety={safety} />}
        {submitError && <InlineAlert tone="error" title={t['apply.title']} body={submitError} />}
        <div className="ls-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={!answer.trim() || phase === 'submitting'}
            aria-busy={phase === 'submitting'}
            onClick={submit}
          >
            {phase === 'submitting' ? t['apply.submitting'] : t['apply.submit']}
          </button>
        </div>
      </section>
    </div>
  );
}

function ChallengeResultLine({ t, result }: { t: ReturnType<typeof getMessages>; result: ResultView }) {
  return (
    <div style={{ fontSize: 18, fontWeight: 650, color: result.passed ? 'var(--brand)' : 'var(--text-secondary)' }}>
      {fillMessage(t['apply.challengeOf'], { n: result.index })} · {t[`apply.level.${result.level}`]} —{' '}
      {fillMessage(result.passed ? t['apply.resultPassed'] : t['apply.resultNotPassed'], { score: result.scorePercent })}
    </div>
  );
}
