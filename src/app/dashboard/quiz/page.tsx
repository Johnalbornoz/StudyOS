'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMessages, LOCALES, LOCALE_NAMES, Locale } from '@/lib/i18n/messages';
import MathAnswerEditor from '@/components/MathAnswerEditor';
import MathText from '@/components/MathText';

type QuizMode = 'topic_practice' | 'quick_check' | 'cumulative_assessment' | 'exam_simulation' | 'diagnostic_check';
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
  calculatorAllowed?: boolean;
  askConfidence?: boolean;
}

type ConfidenceLevel = 'NOT_SURE' | 'SOMEWHAT_SURE' | 'VERY_SURE';

interface SubjectConcept {
  id: string;
  label: string;
  canonicalId: string;
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
  diagnostic_check: 3,
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
  const diagnosisId = searchParams.get('diagnosisId'); // only used for mode=diagnostic_check
  const remediationStepId = searchParams.get('remediationStepId'); // only used when launched from a Repair Path step
  const modeParam = (searchParams.get('mode') as QuizMode | null) || (conceptId ? 'topic_practice' : 'cumulative_assessment');

  const [locale, setLocale] = useState<Locale>('es');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [quizMode] = useState<QuizMode>(modeParam);
  const [maxQuestions, setMaxQuestions] = useState<number>(MODE_DEFAULT_MAX[modeParam]);
  const allowsTopicSelection = quizMode === 'cumulative_assessment' || quizMode === 'exam_simulation';
  const [subjectConcepts, setSubjectConcepts] = useState<SubjectConcept[]>([]);
  const [subjectName, setSubjectName] = useState('');
  // A SOLO-mode "Solo Check" on one concept (from Concept Detail) is just
  // cumulative_assessment/exam_simulation pre-scoped to a single concept --
  // no new quiz mode needed, reuses the existing manual-selection path.
  const [selectedConceptIds, setSelectedConceptIds] = useState<string[]>(
    quizMode === 'cumulative_assessment' && conceptId ? [conceptId] : []
  );

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
  const [confidences, setConfidences] = useState<Record<number, ConfidenceLevel>>({});
  const [confidenceSelected, setConfidenceSelected] = useState<ConfidenceLevel | null>(null);

  const [phase, setPhase] = useState<'setup' | 'loading' | 'quiz' | 'error'>('setup');
  const [switchingLanguage, setSwitchingLanguage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);
  const [reviewing, setReviewing] = useState(false);

  const [hints, setHints] = useState<Record<number, string[]>>({});
  const [hintsVisible, setHintsVisible] = useState(false);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintError, setHintError] = useState(false);

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

        const conceptsRes = await fetch(
          `/api/subjects/${subjectId}/concepts?studentId=${me.studentId}&language=${lang.locale || 'en'}`
        );
        const conceptsBody = await conceptsRes.json();
        if (conceptsRes.ok) {
          if (allowsTopicSelection) setSubjectConcepts(conceptsBody.data.concepts || []);
          setSubjectName(conceptsBody.data.subjectName || '');
        }
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
            conceptIds: selectedConceptIds.length > 0 ? selectedConceptIds : undefined,
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
    [subjectId, conceptId, quizMode, maxQuestions, selectedConceptIds]
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
    setConfidenceSelected(null);
    setHintsVisible(false);
    setHintError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, questions.length]);

  async function toggleHints() {
    if (hintsVisible) {
      setHintsVisible(false);
      return;
    }
    setHintsVisible(true);
    if ((hints[current] && hints[current].length > 0) || !studentId || !quizId) return;

    setHintLoading(true);
    setHintError(false);
    try {
      const res = await fetch('/api/quizzes/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, quizId, questionIndex: current, language: quizLanguage }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error();
      setHints((prev) => ({ ...prev, [current]: body.data.hints }));
    } catch {
      setHintError(true);
    } finally {
      setHintLoading(false);
    }
  }

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
    if (q.askConfidence && !confidenceSelected) return false;
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

    const updatedConfidences = confidenceSelected ? { ...confidences, [current]: confidenceSelected } : confidences;
    if (confidenceSelected) setConfidences(updatedConfidences);

    if (current + 1 < questions.length) {
      setCurrent(current + 1);
    } else {
      submitQuiz(updatedAnswers, updatedConfidences);
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

  async function submitQuiz(finalAnswers: Record<number, string>, finalConfidences: Record<number, ConfidenceLevel> = confidences) {
    if (!studentId || !quizId) return;
    setSubmitting(true);
    setError(null);
    try {
      const answerList = Object.entries(finalAnswers).map(([idx, ans]) => ({
        questionIndex: Number(idx),
        answer: ans,
        confidence: finalConfidences[Number(idx)],
      }));
      const res = await fetch('/api/quizzes/generate-and-take', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          quizId,
          answers: answerList,
          diagnosisId: diagnosisId || undefined,
          remediationStepId: remediationStepId || undefined,
        }),
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
      : mode === 'diagnostic_check'
      ? t['quiz.modeDiagnosticCheck']
      : t['quiz.modeTopicPractice'];

  const modeDesc = (mode: QuizMode) =>
    mode === 'quick_check'
      ? t['quiz.modeQuickCheckDesc']
      : mode === 'cumulative_assessment'
      ? t['quiz.modeCumulativeDesc']
      : mode === 'exam_simulation'
      ? t['quiz.modeExamSimDesc']
      : mode === 'diagnostic_check'
      ? t['quiz.modeDiagnosticCheckDesc']
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

          {allowsTopicSelection && subjectConcepts.length > 0 && (
            <div style={{ marginTop: 'var(--space-6)' }}>
              <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                {t['quiz.selectTopicsLabel']}
              </label>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 10px' }}>{t['quiz.selectTopicsHint']}</p>
              <div
                style={{
                  maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)',
                }}
              >
                {subjectConcepts.map((c) => {
                  const checked = selectedConceptIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                        fontSize: 13.5, cursor: 'pointer', borderRadius: 'var(--radius-sm)',
                        background: checked ? 'var(--brand-subtle)' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedConceptIds((prev) =>
                            checked ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                          )
                        }
                      />
                      {c.label}
                    </label>
                  );
                })}
              </div>
              {selectedConceptIds.length > 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--brand-ink)', margin: '8px 0 0' }}>
                  {selectedConceptIds.length} {t['quiz.selectTopicsCount']}
                </p>
              )}
            </div>
          )}

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
                  <strong>{t['quiz.yourAnswer']}:</strong> {r.studentAnswer ? <MathText text={r.studentAnswer} /> : '—'}
                </div>
                {!r.correct && (
                  <div style={{ fontSize: 14, marginBottom: 4, color: 'var(--success)' }}>
                    <strong>{t['quiz.correctAnswerLabel']}:</strong> <MathText text={r.correctAnswer} />
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

          {results.diagnosticOutcome && (
            <div
              style={{
                marginTop: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-sm)',
                background: results.diagnosticOutcome.outcome === 'CONFIRMED' ? 'var(--warning-subtle)' : 'var(--brand-subtle)',
              }}
            >
              <strong style={{ fontSize: 13.5 }}>
                {results.diagnosticOutcome.outcome === 'CONFIRMED'
                  ? t['quiz.diagnosticConfirmed']
                  : results.diagnosticOutcome.outcome === 'REJECTED'
                  ? t['quiz.diagnosticRejected']
                  : t['quiz.diagnosticInconclusive']}
              </strong>
            </div>
          )}

          {results.ibEstimate && (
            <div
              style={{
                marginTop: 'var(--space-3)', display: 'inline-flex', flexDirection: 'column', gap: 2,
                padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--brand-subtle)',
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--brand-ink)' }}>
                {results.ibEstimate.programme === 'DP'
                  ? `${t['ib.estimatedGrade']}: ${results.ibEstimate.grade}/7`
                  : `${t['ib.estimatedBand']}: ${results.ibEstimate.band}/8`}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t['ib.disclaimer']}</span>
            </div>
          )}

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
              color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-default)',
            }}
          >
            {t['quiz.difficultyLabel']}
            <span style={{ display: 'inline-flex', gap: 3 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <span
                  key={i}
                  aria-hidden
                  style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: i < q.difficulty ? 'var(--brand)' : 'var(--border-default)',
                  }}
                />
              ))}
            </span>
          </span>
          {typeof q.calculatorAllowed === 'boolean' && (
            <span
              title={q.calculatorAllowed ? t['quiz.calculatorAllowed'] : t['quiz.calculatorNotAllowed']}
              style={{
                position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 26, height: 26, borderRadius: 'var(--radius-full)',
                border: `1px solid ${q.calculatorAllowed ? 'var(--border-default)' : 'var(--error)'}`,
                fontSize: 14,
              }}
            >
              <span aria-hidden>🧮</span>
              {!q.calculatorAllowed && (
                <svg
                  aria-hidden
                  viewBox="0 0 26 26"
                  width={26}
                  height={26}
                  style={{ position: 'absolute', inset: 0 }}
                >
                  <circle cx="13" cy="13" r="11" fill="none" stroke="var(--error)" strokeWidth="2" />
                  <line x1="5" y1="21" x2="21" y2="5" stroke="var(--error)" strokeWidth="2" />
                </svg>
              )}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
          <p style={{ fontSize: 20, fontWeight: 600, marginBottom: 'var(--space-4)', lineHeight: '28px', flex: 1 }}>{q.question}</p>
          {quizMode !== 'cumulative_assessment' && quizMode !== 'exam_simulation' && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 13, flexShrink: 0 }}
              onClick={toggleHints}
            >
              {hintsVisible ? t['quiz.hintButtonHide'] : t['quiz.hintButton']}
            </button>
          )}
        </div>

        {hintsVisible && (
          <div
            style={{
              marginBottom: 'var(--space-5)', padding: 'var(--space-4)', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
            }}
          >
            {hintLoading ? (
              <p style={{ fontSize: 13.5, color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                {t['quiz.hintLoading']}
              </p>
            ) : hintError || (hints[current] && hints[current].length === 0) ? (
              <p style={{ fontSize: 13.5, color: 'var(--error)', margin: 0 }}>{t['quiz.hintError']}</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                {(hints[current] || []).map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {q.askConfidence && (
          <div
            role="radiogroup"
            aria-label={t['quiz.confidenceQuestion']}
            style={{
              marginBottom: 'var(--space-5)', padding: 'var(--space-4)', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
            }}
          >
            <p style={{ margin: '0 0 var(--space-3)', fontSize: 14, fontWeight: 600 }}>{t['quiz.confidenceQuestion']}</p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {(['NOT_SURE', 'SOMEWHAT_SURE', 'VERY_SURE'] as ConfidenceLevel[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={confidenceSelected === level}
                  onClick={() => setConfidenceSelected(level)}
                  className={`btn ${confidenceSelected === level ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: 13.5, flex: '1 1 auto', minWidth: 100 }}
                >
                  {level === 'NOT_SURE' ? t['quiz.confidenceLow'] : level === 'SOMEWHAT_SURE' ? t['quiz.confidenceMedium'] : t['quiz.confidenceHigh']}
                </button>
              ))}
            </div>
          </div>
        )}

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
          <MathAnswerEditor
            value={textAnswer}
            onChange={setTextAnswer}
            placeholder={t['quiz.typeAnswer']}
            subjectName={subjectName}
            studentId={studentId}
            locale={locale}
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
