'use client';

/**
 * B5-R -- Active -> Completion -> Result -> Continuation of a canonical learning assessment.
 *
 * It stages the Student's answers, submits them ONCE to the canonical completion route and renders the
 * PostAssessmentState that comes back through the B4 view contracts. It grades nothing, computes no score
 * or mastery, attributes no concept and chooses no next step: the result is `resultViewOf(state)` and the
 * continuation is the return to where the Learning Decision lives.
 */
import { useMemo, useState } from 'react';
import MathText from '@/components/MathText';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { QuestionAnswerFields, type ClientQuestionForInput } from '@/components/quiz/QuestionAnswerFields';
import { AssessmentContinuation, AssessmentResult, AssessmentRunHeader } from '@/components/assessment/AssessmentExperience';
import { encodeClientAnswer } from '@/lib/quiz/client-answer-encoding';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { fillMessage } from '@/lib/i18n/roles-messages';
import { continuationViewOf } from '@/lib/assessment-experience/continuation';
import { resultViewOf, type AssessmentRunView } from '@/lib/assessment-experience/views';
import type { PostAssessmentState } from '@/lib/assessment-execution/post-assessment';

type RunQuestion = ClientQuestionForInput & { itemKey: string; question: string };

const isAnswered = (encoded: string) => encoded.trim().length > 0 && encoded !== '{}' && encoded !== '[]';

export function AssessmentRunner({ sessionId, locale, title, run, questions, conceptLabels }: { sessionId: string; locale: Locale; title: string; run: AssessmentRunView; questions: RunQuestion[]; conceptLabels: Record<string, string> }) {
  const t = useMemo(() => getMessages(locale), [locale]);
  const [staged, setStaged] = useState<Record<string, unknown>>({});
  const [phase, setPhase] = useState<'ACTIVE' | 'SUBMITTING' | 'FAILED'>('ACTIVE');
  const [state, setState] = useState<PostAssessmentState | null>(null);

  const encoded = (q: RunQuestion) => encodeClientAnswer(q, staged[q.itemKey]);
  const answered = questions.filter((q) => q.itemKey in staged && isAnswered(encoded(q))).length;

  const submit = async () => {
    setPhase('SUBMITTING');
    try {
      const answers = questions.filter((q) => q.itemKey in staged).map((q) => ({ itemKey: q.itemKey, answer: encoded(q) }));
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
      <form
        className="ui-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ol className="ax-rows" style={{ listStyle: 'none', padding: 0 }}>
          {questions.map((q, i) => (
            <li key={q.itemKey} className="card">
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="ui-label">{fillMessage(t['ax.run.question'], { n: i + 1, total: questions.length })}</legend>
                <div style={{ margin: '8px 0 12px' }}><MathText text={q.question} /></div>
                <QuestionAnswerFields question={q} staged={staged[q.itemKey]} onChange={(value) => setStaged((s) => ({ ...s, [q.itemKey]: value }))} />
              </fieldset>
            </li>
          ))}
        </ol>
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
