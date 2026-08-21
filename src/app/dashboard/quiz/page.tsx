'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMessages, LOCALES, LOCALE_NAMES, Locale } from '@/lib/i18n/messages';

interface Question {
  index: number;
  question: string;
  type: string;
  options?: string[];
  difficulty: number;
}

const RESULT_MESSAGE_KEY: Record<string, 'quiz.msgExcellent' | 'quiz.msgGood' | 'quiz.msgKeepGoing'> = {
  excellent: 'quiz.msgExcellent',
  good: 'quiz.msgGood',
  keep_going: 'quiz.msgKeepGoing',
};

export default function QuizPage() {
  const searchParams = useSearchParams();
  const subjectId = searchParams.get('subjectId');
  const conceptId = searchParams.get('conceptId');

  const [locale, setLocale] = useState<Locale>('es');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizLanguage, setQuizLanguage] = useState<Locale>('en');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingLanguage, setSwitchingLanguage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);

  const t = getMessages(locale);

  const generateQuiz = useCallback(
    async (sid: string, languageOverride?: Locale) => {
      const genRes = await fetch('/api/quizzes/generate-and-take', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: sid,
          subjectId,
          conceptId,
          ...(languageOverride ? { language: languageOverride } : {}),
        }),
      });
      const genBody = await genRes.json();
      if (!genRes.ok) throw new Error(genBody.message || 'Could not generate the quiz');

      setQuizId(genBody.data.quizId);
      setQuizLanguage(genBody.data.language);
      setQuestions(genBody.data.quiz.questions);
      setCurrent(0);
      setAnswers({});
      setSelected(null);
      setResults(null);
    },
    [subjectId, conceptId]
  );

  useEffect(() => {
    async function init() {
      if (!subjectId || !conceptId) {
        setError('Missing subjectId or conceptId in the URL');
        setLoading(false);
        return;
      }
      try {
        const [meRes, langRes] = await Promise.all([fetch('/api/me'), fetch('/api/language')]);
        const me = await meRes.json();
        const lang = await langRes.json();
        if (lang.locale) setLocale(lang.locale);
        if (!me.studentId) throw new Error('Could not identify the student');
        setStudentId(me.studentId);

        await generateQuiz(me.studentId);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, conceptId]);

  async function changeQuizLanguage(next: Locale) {
    if (!studentId || next === quizLanguage) return;
    setSwitchingLanguage(true);
    setError(null);
    try {
      await generateQuiz(studentId, next);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSwitchingLanguage(false);
    }
  }

  function selectOption(opt: string) {
    if (selected) return;
    setSelected(opt);
    setAnswers((prev) => ({ ...prev, [current]: opt }));
  }

  function nextQuestion() {
    setSelected(null);
    if (current + 1 < questions.length) {
      setCurrent(current + 1);
    } else {
      submitQuiz();
    }
  }

  async function submitQuiz() {
    if (!studentId || !quizId) return;
    setSubmitting(true);
    setError(null);
    try {
      const answerList = Object.entries(answers).map(([idx, ans]) => ({
        questionIndex: Number(idx),
        answer: ans,
      }));
      const res = await fetch('/api/quizzes/generate-and-take', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, quizId, answers: answerList }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || t['common.error']);
      setResults(body.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="card empty-state">{t['quiz.generating']}</div>;
  }

  if (error) {
    return (
      <div>
        <div className="card empty-state" style={{ color: 'var(--error)' }}>
          <strong>{t['quiz.loadError']}</strong>
          {error}
        </div>
        <Link href="/dashboard" className="btn btn-secondary" style={{ marginTop: 'var(--space-4)' }}>
          {t['quiz.backToDashboard']}
        </Link>
      </div>
    );
  }

  if (results) {
    const messageText = t[RESULT_MESSAGE_KEY[results.messageKey] || 'quiz.msgKeepGoing'];
    return (
      <div style={{ maxWidth: 620 }}>
        <h1>{t['quiz.results']}</h1>
        <div className="card" style={{ marginTop: 'var(--space-6)' }}>
          <div className="label" style={{ color: 'var(--text-muted)' }}>{t['quiz.score']}</div>
          <div className="tabular" style={{ fontSize: 40, fontWeight: 650, margin: '4px 0' }}>
            {results.results.score}%
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {results.results.correctCount} / {results.results.totalQuestions} {t['quiz.correctOf']}
          </p>
          {results.mastery && (
            <p style={{ fontSize: 14, marginTop: 'var(--space-3)' }}>
              {t['quiz.masteryLabel']}: {results.mastery.previous}% → <strong>{results.mastery.current}%</strong>{' '}
              <span style={{ color: results.mastery.delta >= 0 ? 'var(--success)' : 'var(--error)' }}>
                ({results.mastery.delta >= 0 ? '+' : ''}{results.mastery.delta})
              </span>
            </p>
          )}
          <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-secondary)', fontSize: 14 }}>{messageText}</p>
        </div>
        <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary" style={{ marginTop: 'var(--space-6)' }}>
          {t['quiz.backToSubject']}
        </Link>
      </div>
    );
  }

  const q = questions[current];
  if (!q) return null;

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 6 }}>
          <Link href={`/dashboard/subjects/${subjectId}`} style={{ color: 'var(--text-muted)' }}>{t['nav.subjects']}</Link> / {t['quiz.breadcrumbQuiz']}
        </div>

        <select
          value={quizLanguage}
          disabled={switchingLanguage}
          onChange={(e) => changeQuizLanguage(e.target.value as Locale)}
          title={t['quiz.languagePickerLabel']}
          style={{
            height: 30, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
            background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 12.5, fontFamily: 'inherit',
            padding: '0 8px',
          }}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        <span className="tabular" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {current + 1}/{questions.length}
        </span>
        <div style={{ flex: 1, height: 5, background: 'var(--border-default)', borderRadius: 999, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%', background: 'var(--brand)',
              width: `${((current + 1) / questions.length) * 100}%`,
              transition: 'width 250ms ease',
            }}
          />
        </div>
      </div>

      <div className="card" style={{ padding: 'var(--space-8)', opacity: switchingLanguage ? 0.5 : 1 }}>
        <p style={{ fontSize: 20, fontWeight: 600, marginBottom: 'var(--space-6)', lineHeight: '28px' }}>{q.question}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {(q.options || []).map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = selected === opt;
            return (
              <button
                key={i}
                onClick={() => selectOption(opt)}
                disabled={!!selected || switchingLanguage}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)', textAlign: 'left',
                  padding: '13px var(--space-4)', border: `1.5px solid ${isSelected ? 'var(--brand)' : 'var(--border-default)'}`,
                  borderRadius: 'var(--radius-sm)', background: isSelected ? 'var(--brand-subtle)' : 'var(--bg-subtle)',
                  cursor: selected ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 14, color: 'var(--text-primary)',
                  width: '100%',
                }}
              >
                <span
                  style={{
                    width: 24, height: 24, borderRadius: '50%', border: '1.5px solid var(--border-default)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 650,
                    color: 'var(--text-muted)', flexShrink: 0,
                  }}
                >
                  {letter}
                </span>
                {opt}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-6)' }}>
          <button onClick={nextQuestion} disabled={!selected || submitting || switchingLanguage} className="btn btn-primary">
            {submitting ? t['quiz.submitting'] : current + 1 < questions.length ? t['quiz.next'] : t['quiz.viewResults']}
          </button>
        </div>
      </div>
    </div>
  );
}
