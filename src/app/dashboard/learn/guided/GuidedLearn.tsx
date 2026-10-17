'use client';

/**
 * LEARN -- adaptive guided understanding (operator rule 2026-10-16).
 *
 *   explanation first (the canonical teach-first stages, TeachingIntro EXPLAIN/MODEL/GUIDE, when the
 *   teaching intent asks for them) -> question -> answer -> IMMEDIATE feedback (correct / almost / not yet,
 *   what did not work, the confusion, the key idea, another example) -> next ... -> close -> PRACTICE.
 *
 * PRESENTATION ONLY: the server grades, decides the close (bounded 4..7) and writes the evidence. This
 * component never sees an answer key and never decides whether LEARN is over.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import MathText from '@/components/MathText';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { SessionHeader } from '@/components/learning/SessionHeader';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { AccessRequiredNotice } from '@/components/ui/AccessRequiredNotice';
import { isEntitlementRequired } from '@/lib/lx/access-required';
import type { TeachingExperienceView } from '@/lib/lx/teaching-experience';
import TeachingIntro from '@/app/dashboard/quiz/TeachingIntro';

interface Interaction {
  index: number;
  type: string;
  answerFormat: string;
  question: string;
  options?: { id: string; text: string }[];
}
interface Feedback {
  verdict: 'CORRECT' | 'PARTIAL' | 'INCORRECT';
  whatWasWrong: string | null;
  misconception: string | null;
  reinforcement: string;
  extraContext: string | null;
  explanation: string | null;
}
interface TurnData {
  answeredCount: number;
  maxInteractions: number;
  correct: boolean;
  partial: boolean;
  feedback: Feedback;
  closed: boolean;
  closedBy: 'AI' | 'CAP' | null;
  nextInteraction: Interaction | null;
  weaknesses: string[] | null;
  closingMessage: string | null;
}

/** The loop's own phase; the teaching stage and failures are tracked separately below. */
type LoopPhase = 'question' | 'feedback' | 'closed';
type Failure = 'error' | 'notAuthorized' | 'locked' | 'access';

export default function GuidedLearn({
  studentId,
  subjectId,
  conceptId,
  conceptLabel,
  subjectName,
  locale,
  missionHref,
}: {
  studentId: string;
  subjectId: string;
  conceptId: string;
  conceptLabel: string;
  subjectName: string;
  locale: Locale;
  missionHref: string;
}) {
  const t = getMessages(locale);
  // 'pending' until the teaching intent answers; 'show' renders the teach-first stages; 'done' afterwards.
  const [teachingState, setTeachingState] = useState<'pending' | 'show' | 'done'>('pending');
  const [teaching, setTeaching] = useState<TeachingExperienceView | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loop, setLoop] = useState<LoopPhase>('question');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [maxInteractions, setMaxInteractions] = useState(7);
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [turn, setTurn] = useState<TurnData | null>(null);
  const [turnError, setTurnError] = useState(false);
  const started = useRef(false);

  const failureOf = useCallback((status: number, body: any): Failure => {
    if (isEntitlementRequired(status, body)) return 'access';
    if (status === 423) return 'locked';
    if (status === 403 && body?.error === 'LEARN_NOT_AUTHORIZED') return 'notAuthorized';
    return 'error';
  }, []);

  const start = useCallback(async () => {
    setFailure(null);
    try {
      const res = await fetch('/api/learning/guided-understanding/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, subjectId, conceptId, language: locale }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) return setFailure(failureOf(res.status, body));
      setSessionId(body.data.sessionId);
      setMaxInteractions(body.data.maxInteractions);
      setInteraction(body.data.interaction);
      setLoop('question');
    } catch {
      setFailure('error');
    }
  }, [studentId, subjectId, conceptId, locale, failureOf]);

  // Teaching intent and the first interaction are prepared in PARALLEL: the explanation never waits for the model.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void fetch(`/api/learning/teaching-intent?studentId=${studentId}&conceptId=${conceptId}&mode=canonical_learn_check`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        const view: TeachingExperienceView | null = b?.data?.teachingExperience ?? null;
        if (view && view.stages.some((s) => s === 'EXPLAIN' || s === 'MODEL' || s === 'GUIDE')) {
          setTeaching(view);
          setTeachingState('show');
        } else setTeachingState('done');
      })
      .catch(() => setTeachingState('done'));
    void start();
  }, [studentId, conceptId, start]);

  const submit = useCallback(async () => {
    if (!sessionId || !answer.trim() || submitting) return;
    setSubmitting(true);
    setTurnError(false);
    try {
      const res = await fetch('/api/learning/guided-understanding/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, sessionId, answer }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) {
        // 503: the next step could not be prepared -- the same answer can be retried.
        // 409: the session moved on elsewhere (another tab) or closed -- resync from the server.
        if (res.status === 503) setTurnError(true);
        else if (res.status === 409) {
          setAnswer('');
          setTurn(null);
          void start();
        } else setFailure(failureOf(res.status, body));
        return;
      }
      setTurn(body.data);
      setLoop('feedback');
    } catch {
      setTurnError(true);
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, answer, submitting, studentId, failureOf, start]);

  const next = () => {
    if (!turn) return;
    if (turn.closed || !turn.nextInteraction) return setLoop('closed');
    setInteraction(turn.nextInteraction);
    setAnswer('');
    setTurn(null);
    setLoop('question');
  };

  const inLoop = !failure && teachingState === 'done' && !!interaction;
  const shown = loop === 'feedback' && turn ? turn.answeredCount : interaction ? interaction.index + 1 : 0;
  const progress =
    inLoop && shown > 0 && loop !== 'closed'
      ? { current: shown, total: maxInteractions, text: t['lg.progress'].replace('{n}', String(shown)).replace('{max}', String(maxInteractions)), label: t['lg.progressLabel'] }
      : null;
  const header = (
    <SessionHeader kind="check" kindLabel={t['lg.kicker']} title={conceptLabel || t['lg.kicker']} context={subjectName} purpose={inLoop && loop === 'question' && shown === 1 ? t['lg.purpose'] : null} progress={progress} />
  );

  if (!failure && teachingState === 'show' && teaching) {
    return (
      <div className="ls" data-kind="check">
        {header}
        <TeachingIntro
          view={teaching}
          studentId={studentId}
          quizId={null}
          conceptId={conceptId}
          conceptLabel={conceptLabel}
          quizMode="canonical_learn_check"
          locale={locale}
          exitHref={missionHref}
          tutorSubjectId={subjectId}
          onDone={() => setTeachingState('done')}
        />
      </div>
    );
  }

  if (failure === 'access') {
    return (
      <div className="ls" data-kind="check">
        {header}
        <AccessRequiredNotice locale={locale} />
      </div>
    );
  }

  if (failure) {
    return (
      <div className="ls" data-kind="check">
        {header}
        <InlineAlert
          tone={failure === 'error' ? 'error' : 'info'}
          title={failure === 'notAuthorized' ? t['lg.notAuthorizedTitle'] : failure === 'locked' ? t['lg.lockedBody'] : t['lg.error']}
          body={failure === 'notAuthorized' ? t['lg.notAuthorizedBody'] : undefined}
          actions={
            <>
              {failure === 'error' && (
                <button type="button" className="btn btn-primary" onClick={() => void start()}>
                  {t['lg.retry']}
                </button>
              )}
              <Link href={missionHref} className="btn btn-secondary">
                {t['lg.backToConcept']}
              </Link>
            </>
          }
        />
      </div>
    );
  }

  if (inLoop && loop === 'closed' && turn) {
    return (
      <div className="ls ls-result" data-kind="check">
        {header}
        <div className="card ls-outcome" data-testid="learn-guided-closed">
          <h2 className="ls-outcome-title">{t['lg.closeTitle']}</h2>
          <p className="ls-outcome-body">{turn.closingMessage ?? (turn.closedBy === 'CAP' ? t['lg.closeBodyCap'] : t['lg.closeBodyAi'])}</p>
          {turn.weaknesses && turn.weaknesses.length > 0 && (
            <div>
              <p className="ls-panel-label">{t['lg.weaknessesTitle']}</p>
              <ul>
                {turn.weaknesses.map((w) => (
                  <li key={w}>
                    <MathText text={w} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link href={missionHref} className="btn btn-primary btn-lg">
            {t['lg.toPractice']}
          </Link>
        </div>
      </div>
    );
  }

  if (inLoop && interaction) {
    const answered = loop === 'feedback' && turn;
    const isChoice = interaction.answerFormat === 'single_choice' && (interaction.options?.length ?? 0) > 0;
    const fb = answered ? turn.feedback : null;
    return (
      <div className="ls" data-kind="check">
        {header}
        <div className="ls-question-row">
          <p className="ls-question">
            <MathText text={interaction.question} />
          </p>
        </div>
        {isChoice ? (
          <div role="radiogroup" aria-label={interaction.question} className="ls-options">
            {interaction.options!.map((opt, i) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={answer === opt.id}
                className="ls-option"
                disabled={!!answered || submitting}
                onClick={() => setAnswer(opt.id)}
              >
                <span className="ls-option-key" aria-hidden>
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="ls-option-text">
                  <MathText text={opt.text} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <textarea
            className="ui-input"
            rows={3}
            value={answer}
            placeholder={t['lg.answerPlaceholder']}
            disabled={!!answered || submitting}
            onChange={(e) => setAnswer(e.target.value)}
            aria-label={t['lg.answerPlaceholder']}
          />
        )}

        {!answered && (
          <div className="ls-row">
            <button type="button" className="btn btn-primary" disabled={!answer.trim() || submitting} onClick={() => void submit()}>
              {submitting ? t['lg.checking'] : t['lg.submit']}
            </button>
          </div>
        )}
        {turnError && !answered && (
          <InlineAlert tone="error" title={t['lg.error']} actions={<button type="button" className="btn btn-secondary" onClick={() => void submit()}>{t['lg.retry']}</button>} />
        )}

        {fb && (
          <div
            role="status"
            aria-live="polite"
            className="ls-feedback"
            data-testid="learn-guided-feedback"
            data-tone={fb.verdict === 'CORRECT' ? 'correct' : fb.verdict === 'PARTIAL' ? 'almost' : 'notyet'}
          >
            <p className="ls-feedback-title">{fb.verdict === 'CORRECT' ? t['lg.correct'] : fb.verdict === 'PARTIAL' ? t['lg.partial'] : t['lg.incorrect']}</p>
            {fb.whatWasWrong && (
              <p>
                <strong>{t['lg.whatWasWrong']}:</strong> <MathText text={fb.whatWasWrong} />
              </p>
            )}
            {fb.misconception && (
              <p>
                <strong>{t['lg.misconception']}:</strong> <MathText text={fb.misconception} />
              </p>
            )}
            {fb.reinforcement && (
              <p>
                <strong>{t['lg.reinforcement']}:</strong> <MathText text={fb.reinforcement} />
              </p>
            )}
            {fb.extraContext && (
              <p>
                <strong>{t['lg.extraContext']}:</strong> <MathText text={fb.extraContext} />
              </p>
            )}
            {fb.explanation && fb.explanation !== fb.reinforcement && (
              <p>
                <strong>{t['lg.explanation']}:</strong> <MathText text={fb.explanation} />
              </p>
            )}
            <div className="ls-row">
              <button type="button" className="btn btn-primary" onClick={next}>
                {turn!.closed ? t['lg.finish'] : t['lg.next']}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ls" data-kind="check">
      {header}
      <p className="ls-preparing-text" role="status" aria-live="polite">
        {t['lg.preparing']}
      </p>
    </div>
  );
}
