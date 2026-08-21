'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMessages, LOCALES, LOCALE_NAMES, Locale } from '@/lib/i18n/messages';

type QuizMode = 'topic_practice' | 'quick_check' | 'cumulative_assessment' | 'exam_simulation';
type AnswerFormat = 'single_choice' | 'multi_choice' | 'text' | 'matching' | 'ordering' | 'classification';

interface VisualAid {
  kind: 'diagram' | 'chart';
  svg?: string;
  chartData?: { chartType: 'line' | 'bar'; labels: string[]; values: number[]; xLabel?: string; yLabel?: string };
  caption?: string;
}

interface Question {
  index: number;
  conceptId: string;
  question: string;
  type: string;
  answerFormat: AnswerFormat;
  options?: { id: string; text: string }[];
  matchingLeft?: string[];
  matchingRightShuffled?: string[];
  orderingItemsShuffled?: string[];
  classificationItems?: string[];
  classificationCategories?: string[];
  visualAid?: VisualAid;
  difficulty: number;
}

interface ReviewItem {
  questionIndex: number;
  conceptId: string;
  conceptLabel: string;
  type: string;
  question: string;
  visualAid?: VisualAid;
  studentAnswer: string;
  correctAnswer: string;
  correct: boolean;
  score: number;
  feedback: string;
  explanation: string;
}

const MODE_DEFAULT_MAX: Record<QuizMode, number> = {
  quick_check: 6,
  topic_practice: 20,
  cumulative_assessment: 20,
  exam_simulation: 20,
};

const RESULT_MESSAGE_KEY: Record<string, 'quiz.msgExcellent' | 'quiz.msgGood' | 'quiz.msgKeepGoing'> = {
  excellent: 'quiz.msgExcellent',
  good: 'quiz.msgGood',
  keep_going: 'quiz.msgKeepGoing',
};

function MiniChart({ data }: { data: NonNullable<VisualAid['chartData']> }) {
  const width = 420;
  const height = 200;
  const padding = 36;
  const max = Math.max(...data.values, 1);
  const min = Math.min(...data.values, 0);
  const range = max - min || 1;
  const step = (width - padding * 2) / Math.max(1, data.values.length - 1);

  const points = data.values.map((v, i) => {
    const x = padding + i * step;
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return { x, y };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', maxWidth: 420 }}>
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="var(--border-default)" strokeWidth={1} />
      <line x1={padding} y1={padding / 2} x2={padding} y2={height - padding} stroke="var(--border-default)" strokeWidth={1} />
      {data.chartType === 'bar'
        ? points.map((p, i) => (
            <rect
              key={i}
              x={p.x - step / 3}
              y={p.y}
              width={(step * 2) / 3}
              height={height - padding - p.y}
              fill="var(--brand)"
              opacity={0.75}
            />
          ))
        : (
            <polyline
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="var(--brand)"
              strokeWidth={2}
            />
          )}
      {data.chartType === 'line' && points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill="var(--brand)" />)}
      {data.labels.map((l, i) => (
        <text key={i} x={padding + i * step} y={height - padding + 14} fontSize={10} textAnchor="middle" fill="var(--text-muted)">
          {l}
        </text>
      ))}
    </svg>
  );
}

function VisualAidView({ aid }: { aid: VisualAid }) {
  return (
    <div style={{ margin: '0 0 var(--space-4)', padding: 'var(--space-3)', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
      {aid.kind === 'diagram' && aid.svg && (
        <div style={{ maxWidth: 320, margin: '0 auto' }} dangerouslySetInnerHTML={{ __html: aid.svg }} />
      )}
      {aid.kind === 'chart' && aid.chartData && <MiniChart data={aid.chartData} />}
      {aid.caption && (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', textAlign: 'center', margin: '6px 0 0' }}>{aid.caption}</p>
      )}
    </div>
  );
}

export default function QuizPage() {
  const searchParams = useSearchParams();
  const subjectId = searchParams.get('subjectId');
  const conceptId = searchParams.get('conceptId');
  const modeParam = (searchParams.get('mode') as QuizMode | null) || (conceptId ? 'topic_practice' : 'cumulative_assessment');

  const [locale, setLocale] = useState<Locale>('es');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [quizMode] = useState<QuizMode>(modeParam);
  const [maxQuestions, setMaxQuestions] = useState<number>(MODE_DEFAULT_MAX[modeParam]);

  const [quizId, setQuizId] = useState<string | null>(null);
  const [quizLanguage, setQuizLanguage] = useState<Locale>('en');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const [singleChoice, setSingleChoice] = useState<string | null>(null);
  const [multiChoice, setMultiChoice] = useState<string[]>([]);
  const [textAnswer, setTextAnswer] = useState('');
  const [matchingAnswer, setMatchingAnswer] = useState<Record<string, string>>({});
  const [orderingAnswer, setOrderingAnswer] = useState<string[]>([]);
  const [classificationAnswer, setClassificationAnswer] = useState<Record<string, string>>({});

  const [phase, setPhase] = useState<'setup' | 'loading' | 'quiz' | 'error'>('setup');
  const [switchingLanguage, setSwitchingLanguage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);
  const [reviewing, setReviewing] = useState(false);

  const t = getMessages(locale);

  useEffect(() => {
    async function init() {
      if (!subjectId) {
        setError('Missing subjectId in the URL');
        setPhase('error');
        return;
      }
      try {
        const [meRes, langRes] = await Promise.all([fetch('/api/me'), fetch('/api/language')]);
        const me = await meRes.json();
        const lang = await langRes.json();
        if (lang.locale) setLocale(lang.locale);
        if (!me.studentId) throw new Error('Could not identify the student');
        setStudentId(me.studentId);
      } catch (err: any) {
        setError(err.message);
        setPhase('error');
      }
    }
    init();
  }, [subjectId]);

  const generateQuiz = useCallback(
    async (sid: string, languageOverride?: Locale) => {
      setPhase('loading');
      setError(null);
      try {
        const genRes = await fetch('/api/quizzes/generate-and-take', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: sid,
            subjectId,
            conceptId: conceptId || undefined,
            quizMode,
            maxQuestions,
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
        setResults(null);
        setReviewing(false);
        setPhase('quiz');
      } catch (err: any) {
        setError(err.message);
        setPhase('error');
      }
    },
    [subjectId, conceptId, quizMode, maxQuestions]
  );

  useEffect(() => {
    const q = questions[current];
    if (!q) return;
    setSingleChoice(null);
    setMultiChoice([]);
    setTextAnswer('');
    setMatchingAnswer({});
    setOrderingAnswer(q.orderingItemsShuffled ? [...q.orderingItemsShuffled] : []);
    setClassificationAnswer({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, questions.length]);

  async function changeQuizLanguage(next: Locale) {
    if (!studentId || next === quizLanguage) return;
    setSwitchingLanguage(true);
    try {
      await generateQuiz(studentId, next);
    } finally {
      setSwitchingLanguage(false);
    }
  }

  function encodeCurrentAnswer(q: Question): string {
    switch (q.answerFormat) {
      case 'single_choice':
        return singleChoice || '';
      case 'multi_choice':
        return multiChoice.join(',');
      case 'text':
        return textAnswer;
      case 'matching':
        return JSON.stringify(matchingAnswer);
      case 'ordering':
        return JSON.stringify(orderingAnswer);
      case 'classification':
        return JSON.stringify(classificationAnswer);
    }
  }

  function canProceed(q: Question): boolean {
    switch (q.answerFormat) {
      case 'single_choice':
        return !!singleChoice;
      case 'multi_choice':
        return multiChoice.length > 0;
      case 'text':
        return textAnswer.trim().length > 0;
      case 'matching':
        return (q.matchingLeft || []).every((l) => !!matchingAnswer[l]);
      case 'ordering':
        return orderingAnswer.length > 0;
      case 'classification':
        return (q.classificationItems || []).every((it) => !!classificationAnswer[it]);
    }
  }

  function nextQuestion() {
    const q = questions[current];
    const encoded = encodeCurrentAnswer(q);
    const updatedAnswers = { ...answers, [current]: encoded };
    setAnswers(updatedAnswers);

    if (current + 1 < questions.length) {
      setCurrent(current + 1);
    } else {
      submitQuiz(updatedAnswers);
    }
  }

  function moveOrderingItem(index: number, direction: -1 | 1) {
    setOrderingAnswer((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submitQuiz(finalAnswers: Record<number, string>) {
    if (!studentId || !quizId) return;
    setSubmitting(true);
    setError(null);
    try {
      const answerList = Object.entries(finalAnswers).map(([idx, ans]) => ({
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

  const modeLabel = (mode: QuizMode) =>
    mode === 'quick_check'
      ? t['quiz.modeQuickCheck']
      : mode === 'cumulative_assessment'
      ? t['quiz.modeCumulative']
      : mode === 'exam_simulation'
      ? t['quiz.modeExamSim']
      : t['quiz.modeTopicPractice'];

  const modeDesc = (mode: QuizMode) =>
    mode === 'quick_check'
      ? t['quiz.modeQuickCheckDesc']
      : mode === 'cumulative_assessment'
      ? t['quiz.modeCumulativeDesc']
      : mode === 'exam_simulation'
      ? t['quiz.modeExamSimDesc']
      : t['quiz.modeTopicPracticeDesc'];

  if (phase === 'setup') {
    return (
      <div style={{ maxWidth: 520 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
          <Link href={`/dashboard/subjects/${subjectId}`} style={{ color: 'var(--text-muted)' }}>{t['nav.subjects']}</Link> / {t['quiz.breadcrumbQuiz']}
        </div>
        <div className="card" style={{ padding: 'var(--space-8)' }}>
          <p className="label" style={{ color: 'var(--brand-ink)' }}>{modeLabel(quizMode)}</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '6px 0 var(--space-6)' }}>{modeDesc(quizMode)}</p>

          <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
            {t['quiz.maxQuestionsLabel']}: <strong className="tabular">{maxQuestions}</strong>
          </label>
          <input
            type="range"
            min={1}
            max={20}
            value={maxQuestions}
            onChange={(e) => setMaxQuestions(Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '6px 0 0' }}>{t['quiz.maxQuestionsHint']}</p>

          <button
            className="btn btn-primary"
            style={{ marginTop: 'var(--space-6)' }}
            disabled={!studentId}
            onClick={() => studentId && generateQuiz(studentId)}
          >
            {t['quiz.startQuiz']}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'loading') {
    return <div className="card empty-state">{t['quiz.generating']}</div>;
  }

  if (phase === 'error') {
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
    const perConcept = results.perConceptResults || [];

    if (reviewing) {
      const review: ReviewItem[] = results.review || [];
      return (
        <div style={{ maxWidth: 680 }}>
          <h1>{t['quiz.reviewTitle']}</h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
            {review.map((r) => (
              <div key={r.questionIndex} className="card" style={{ padding: 'var(--space-6)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{r.conceptLabel}</span>
                  <span className={`chip ${r.correct ? 'chip-good' : 'chip-critical'}`}>
                    {r.correct ? t['quiz.correctBadge'] : t['quiz.incorrectBadge']}
                  </span>
                </div>
                <p style={{ fontSize: 16, fontWeight: 600, margin: '10px 0' }}>{r.question}</p>
                {r.visualAid && <VisualAidView aid={r.visualAid} />}
                <div style={{ fontSize: 14, marginBottom: 4 }}>
                  <strong>{t['quiz.yourAnswer']}:</strong> {r.studentAnswer || '—'}
                </div>
                {!r.correct && (
                  <div style={{ fontSize: 14, marginBottom: 4, color: 'var(--success)' }}>
                    <strong>{t['quiz.correctAnswerLabel']}:</strong> {r.correctAnswer}
                  </div>
                )}
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 8 }}>
                  <strong>{t['quiz.explanationLabel']}:</strong> {r.explanation}
                </p>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
            <button className="btn btn-secondary" onClick={() => setReviewing(false)}>{t['quiz.backToResults']}</button>
            <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary">{t['quiz.backToSubject']}</Link>
          </div>
        </div>
      );
    }

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

          {perConcept.length === 1 && results.mastery && (
            <p style={{ fontSize: 14, marginTop: 'var(--space-3)' }}>
              {t['quiz.masteryLabel']}: {results.mastery.previous}% → <strong>{results.mastery.current}%</strong>{' '}
              <span style={{ color: results.mastery.delta >= 0 ? 'var(--success)' : 'var(--error)' }}>
                ({results.mastery.delta >= 0 ? '+' : ''}{results.mastery.delta})
              </span>
            </p>
          )}

          {perConcept.length > 1 && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <p className="label" style={{ color: 'var(--text-muted)', marginBottom: 6 }}>{t['quiz.masteryLabel']}</p>
              {perConcept.map((p: any) => (
                <div key={p.conceptId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, marginBottom: 4 }}>
                  <span>{p.conceptLabel}</span>
                  <span className="tabular">
                    {p.previousMastery}% → {p.newMastery}%{' '}
                    <span style={{ color: p.delta >= 0 ? 'var(--success)' : 'var(--error)' }}>
                      ({p.delta >= 0 ? '+' : ''}{p.delta})
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-secondary)', fontSize: 14 }}>{messageText}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-6)' }}>
          <button className="btn btn-secondary" onClick={() => setReviewing(true)}>{t['quiz.reviewButton']}</button>
          <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary">{t['quiz.backToSubject']}</Link>
        </div>
      </div>
    );
  }

  const q = questions[current];
  if (!q) return null;

  return (
    <div style={{ maxWidth: 640 }}>
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
        <p style={{ fontSize: 20, fontWeight: 600, marginBottom: 'var(--space-4)', lineHeight: '28px' }}>{q.question}</p>
        {q.visualAid && <VisualAidView aid={q.visualAid} />}

        {(q.answerFormat === 'single_choice') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {(q.options || []).map((opt, i) => {
              const letter = String.fromCharCode(65 + i);
              const isSelected = singleChoice === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setSingleChoice(opt.id)}
                  disabled={switchingLanguage}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)', textAlign: 'left',
                    padding: '13px var(--space-4)', border: `1.5px solid ${isSelected ? 'var(--brand)' : 'var(--border-default)'}`,
                    borderRadius: 'var(--radius-sm)', background: isSelected ? 'var(--brand-subtle)' : 'var(--bg-subtle)',
                    cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, color: 'var(--text-primary)', width: '100%',
                  }}
                >
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%', border: '1.5px solid var(--border-default)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 650,
                    color: 'var(--text-muted)', flexShrink: 0,
                  }}>
                    {letter}
                  </span>
                  {opt.text}
                </button>
              );
            })}
          </div>
        )}

        {q.answerFormat === 'multi_choice' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 4px' }}>{t['quiz.selectAllThatApply']}</p>
            {(q.options || []).map((opt) => {
              const isSelected = multiChoice.includes(opt.id);
              return (
                <label
                  key={opt.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                    padding: '13px var(--space-4)', border: `1.5px solid ${isSelected ? 'var(--brand)' : 'var(--border-default)'}`,
                    borderRadius: 'var(--radius-sm)', background: isSelected ? 'var(--brand-subtle)' : 'var(--bg-subtle)',
                    cursor: 'pointer', fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() =>
                      setMultiChoice((prev) => (prev.includes(opt.id) ? prev.filter((id) => id !== opt.id) : [...prev, opt.id]))
                    }
                  />
                  {opt.text}
                </label>
              );
            })}
          </div>
        )}

        {q.answerFormat === 'text' && (
          <textarea
            value={textAnswer}
            onChange={(e) => setTextAnswer(e.target.value)}
            placeholder={t['quiz.typeAnswer']}
            rows={4}
            style={{
              width: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)',
              padding: 'var(--space-3)', fontFamily: 'inherit', fontSize: 14, resize: 'vertical',
            }}
          />
        )}

        {q.answerFormat === 'matching' && (
          <div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 8px' }}>{t['quiz.matchInstructions']}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {(q.matchingLeft || []).map((left) => (
                <div key={left} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <span style={{ flex: 1, fontSize: 14 }}>{left}</span>
                  <select
                    value={matchingAnswer[left] || ''}
                    onChange={(e) => setMatchingAnswer((prev) => ({ ...prev, [left]: e.target.value }))}
                    style={{ flex: 1, height: 36, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: 13.5 }}
                  >
                    <option value="" disabled>—</option>
                    {(q.matchingRightShuffled || []).map((right) => (
                      <option key={right} value={right}>{right}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {q.answerFormat === 'ordering' && (
          <div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 8px' }}>{t['quiz.orderInstructions']}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {orderingAnswer.map((item, i) => (
                <div key={item} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '10px var(--space-3)',
                  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-subtle)',
                }}>
                  <span className="tabular" style={{ fontWeight: 650, color: 'var(--text-muted)', width: 20 }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 14 }}>{item}</span>
                  <button className="btn btn-ghost" style={{ height: 28, width: 28, padding: 0 }} onClick={() => moveOrderingItem(i, -1)} disabled={i === 0}>↑</button>
                  <button className="btn btn-ghost" style={{ height: 28, width: 28, padding: 0 }} onClick={() => moveOrderingItem(i, 1)} disabled={i === orderingAnswer.length - 1}>↓</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {q.answerFormat === 'classification' && (
          <div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 8px' }}>{t['quiz.classifyInstructions']}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {(q.classificationItems || []).map((item) => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <span style={{ flex: 1, fontSize: 14 }}>{item}</span>
                  <select
                    value={classificationAnswer[item] || ''}
                    onChange={(e) => setClassificationAnswer((prev) => ({ ...prev, [item]: e.target.value }))}
                    style={{ flex: 1, height: 36, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', fontSize: 13.5 }}
                  >
                    <option value="" disabled>—</option>
                    {(q.classificationCategories || []).map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-6)' }}>
          <button onClick={nextQuestion} disabled={!canProceed(q) || submitting || switchingLanguage} className="btn btn-primary">
            {submitting ? t['quiz.submitting'] : current + 1 < questions.length ? t['quiz.next'] : t['quiz.viewResults']}
          </button>
        </div>
      </div>
    </div>
  );
}
