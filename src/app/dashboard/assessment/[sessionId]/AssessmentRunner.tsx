'use client';

/**
 * B5-R / B5-D -- Active -> Completion -> Result -> Continuation of a canonical learning assessment.
 *
 * It stages the Student's answers, saves them as DRAFTS while they work (so leaving and coming back restores
 * them), submits them ONCE to the canonical completion route and renders the PostAssessmentState that comes
 * back through the B4 view contracts. It grades nothing, computes no score or mastery, attributes no concept
 * and chooses no next step: the result is `resultViewOf(state)` and the continuation is the return to where
 * the Learning Decision lives. A draft is not evidence.
 *
 * v1 product behaviour, on purpose: one submission, no hints, no per-question feedback.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MathText from '@/components/MathText';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { QuestionAnswerFields, type ClientQuestionForInput } from '@/components/quiz/QuestionAnswerFields';
import { AssessmentContinuation, AssessmentResult, AssessmentRunHeader } from '@/components/assessment/AssessmentExperience';
import { decodeClientAnswer, encodeClientAnswer } from '@/lib/quiz/client-answer-encoding';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { continuationViewOf } from '@/lib/assessment-experience/continuation';
import { resultViewOf, type AssessmentRunView } from '@/lib/assessment-experience/views';
import type { PostAssessmentState } from '@/lib/assessment-execution/post-assessment';

type RunQuestion = ClientQuestionForInput & { itemKey: string; question: string };

const isAnswered = (encoded: string) => encoded.trim().length > 0 && encoded !== '{}' && encoded !== '[]';
const DRAFT_DELAY_MS = 800;

export function AssessmentRunner({ sessionId, locale, title, run, questions, conceptLabels, savedAnswers }: { sessionId: string; locale: Locale; title: string; run: AssessmentRunView; questions: RunQuestion[]; conceptLabels: Record<string, string>; savedAnswers: Record<string, string> }) {
  const t = useMemo(() => getMessages(locale), [locale]);
  const restored = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const q of questions) {
      const value = savedAnswers[q.itemKey] ? decodeClientAnswer(q, savedAnswers[q.itemKey]) : undefined;
      if (value !== undefined) out[q.itemKey] = value;
    }
    return out;
  }, [questions, savedAnswers]);
  const [staged, setStaged] = useState<Record<string, unknown>>(restored);
  const [phase, setPhase] = useState<'ACTIVE' | 'SUBMITTING' | 'FAILED'>('ACTIVE');
  const [draft, setDraft] = useState<'IDLE' | 'SAVED' | 'FAILED'>('IDLE');
  const [state, setState] = useState<PostAssessmentState | null>(null);

  const stagedRef = useRef(staged);
  stagedRef.current = staged;
  const dirty = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const encodedOf = useCallback((q: RunQuestion, values: Record<string, unknown>) => (q.itemKey in values ? encodeClientAnswer(q, values[q.itemKey]) : ''), []);
  const answersUrl = `/api/assessments/learning/${encodeURIComponent(sessionId)}/answers`;

  /** Saves the answers that changed since the last save. Returns whether nothing is left unsaved. */
  const saveDrafts = useCallback(
    async (keepalive = false): Promise<boolean> => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const keys = [...dirty.current];
      if (keys.length === 0) return true;
      dirty.current = new Set();
      const answers = questions.filter((q) => keys.includes(q.itemKey)).map((q) => ({ itemKey: q.itemKey, answer: isAnswered(encodedOf(q, stagedRef.current)) ? encodedOf(q, stagedRef.current) : '' }));
      try {
        const res = await fetch(answersUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }), keepalive });
        if (!res.ok) throw new Error(String(res.status));
        setDraft('SAVED');
        return true;
      } catch {
        for (const k of keys) dirty.current.add(k);
        setDraft('FAILED');
        return false;
      }
    },
    [answersUrl, encodedOf, questions]
  );

  const change = (itemKey: string, value: unknown) => {
    setStaged((s) => ({ ...s, [itemKey]: value }));
    dirty.current.add(itemKey);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveDrafts(), DRAFT_DELAY_MS);
  };

  // leaving the page (tab hidden, navigation, reload) saves what is pending
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') void saveDrafts(true);
    };
    const leave = () => void saveDrafts(true);
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', leave);
      void saveDrafts(true);
    };
  }, [saveDrafts]);

  // when the result replaces the form, move focus to its heading so it is announced and keyboard order restarts there
  useEffect(() => {
    if (state) document.getElementById('ax-result-title')?.focus();
  }, [state]);

  const answered = questions.filter((q) => isAnswered(encodedOf(q, staged))).length;

  const submit = async () => {
    setPhase('SUBMITTING');
    try {
      await saveDrafts();
      const answers = questions.filter((q) => isAnswered(encodedOf(q, staged))).map((q) => ({ itemKey: q.itemKey, answer: encodedOf(q, staged) }));
      const res = await fetch(`/api/assessments/learning/${encodeURIComponent(sessionId)}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success || !body.data?.state) return setPhase('FAILED');
      setState(body.data.state as PostAssessmentState);
    } catch {
      setPhase('FAILED');
    }
  };

  if (state) {
    return (
      <AssessmentResult view={resultViewOf(state)} t={t} conceptLabels={conceptLabels}>
        <AssessmentContinuation view={continuationViewOf({ secondary: [{ kind: 'BACK_TO_PROGRESS', href: '/dashboard/knowledge' }] })} t={t} />
      </AssessmentResult>
    );
  }

  return (
    <>
      <AssessmentRunHeader view={{ ...run, progress: { answered, total: run.progress.total } }} t={t} title={title} helpLine={false} />
      <p className="ui-hint">{t['ax.run.oneSubmission']}</p>
      {Object.keys(restored).length > 0 && <InlineAlert tone="info" title={t['ax.run.restored']} />}
      <form
        className="ui-form"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ol className="ax-rows" style={{ listStyle: 'none', padding: 0 }}>
          {questions.map((q, i) => (
            <li key={q.itemKey} className="card">
              <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <legend className="ui-label">{fillMessage(t['ax.run.question'], { n: i + 1, total: questions.length })}</legend>
                <div style={{ margin: '8px 0 12px' }}><MathText text={q.question} /></div>
                <div className="ax-answers">
                  <QuestionAnswerFields question={q} staged={staged[q.itemKey]} onChange={(value) => change(q.itemKey, value)} textLabel={fillMessage(t['ax.run.question'], { n: i + 1, total: questions.length })} />
                </div>
              </fieldset>
            </li>
          ))}
        </ol>
        <p className="ui-hint" role="status" aria-live="polite" data-draft={draft}>{draft === 'SAVED' ? t['ax.run.saved'] : draft === 'FAILED' ? t['ax.run.saveFailed'] : ''}</p>
        {phase === 'FAILED' && <InlineAlert tone="error" title={t['ax.state.error']} />}
        <div className="xr-next-actions">
          <button type="submit" className="btn btn-primary btn-lg" disabled={phase === 'SUBMITTING'} aria-busy={phase === 'SUBMITTING'}>
            {phase === 'SUBMITTING' ? t['ax.state.loading'] : phase === 'FAILED' ? t['ax.state.retry'] : t['ax.run.submit']}
          </button>
        </div>
      </form>
    </>
  );
}
