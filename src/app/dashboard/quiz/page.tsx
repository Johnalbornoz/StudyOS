'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface Question {
  index: number;
  question: string;
  type: string;
  options?: string[];
  difficulty: number;
}

export default function QuizPage() {
  const searchParams = useSearchParams();
  const subjectId = searchParams.get('subjectId');
  const conceptId = searchParams.get('conceptId');

  const [studentId, setStudentId] = useState<string | null>(null);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<any>(null);

  useEffect(() => {
    async function init() {
      if (!subjectId || !conceptId) {
        setError('Falta subjectId o conceptId en la URL');
        setLoading(false);
        return;
      }
      try {
        const meRes = await fetch('/api/me');
        const me = await meRes.json();
        if (!me.studentId) throw new Error('No se pudo identificar al estudiante');
        setStudentId(me.studentId);

        const genRes = await fetch('/api/quizzes/generate-and-take', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: me.studentId, subjectId, conceptId }),
        });
        const genBody = await genRes.json();
        if (!genRes.ok) throw new Error(genBody.message || 'No se pudo generar el quiz');

        setQuizId(genBody.data.quizId);
        setQuestions(genBody.data.quiz.questions);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [subjectId, conceptId]);

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
      if (!res.ok) throw new Error(body.message || 'No se pudo calificar el quiz');
      setResults(body.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="card empty-state">Generando preguntas con IA…</div>;
  }

  if (error) {
    return (
      <div>
        <div className="card empty-state" style={{ color: 'var(--error)' }}>
          <strong>No se pudo cargar el quiz</strong>
          {error}
        </div>
        <Link href="/dashboard" className="btn btn-secondary" style={{ marginTop: 'var(--space-4)' }}>
          Volver al panel
        </Link>
      </div>
    );
  }

  if (results) {
    return (
      <div style={{ maxWidth: 620 }}>
        <h1>Resultados</h1>
        <div className="card" style={{ marginTop: 'var(--space-6)' }}>
          <div className="label" style={{ color: 'var(--text-muted)' }}>Puntaje</div>
          <div className="tabular" style={{ fontSize: 40, fontWeight: 650, margin: '4px 0' }}>
            {results.results.score}%
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {results.results.correctCount} de {results.results.totalQuestions} correctas
          </p>
          {results.mastery && (
            <p style={{ fontSize: 14, marginTop: 'var(--space-3)' }}>
              Dominio del concepto: {results.mastery.previous}% → <strong>{results.mastery.current}%</strong>{' '}
              <span style={{ color: results.mastery.delta >= 0 ? 'var(--success)' : 'var(--error)' }}>
                ({results.mastery.delta >= 0 ? '+' : ''}{results.mastery.delta})
              </span>
            </p>
          )}
          <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-secondary)', fontSize: 14 }}>{results.message}</p>
        </div>
        <Link href={`/dashboard/subjects/${subjectId}`} className="btn btn-primary" style={{ marginTop: 'var(--space-6)' }}>
          Volver a la materia
        </Link>
      </div>
    );
  }

  const q = questions[current];
  if (!q) return null;

  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 'var(--space-2)', display: 'flex', gap: 6 }}>
        <Link href={`/dashboard/subjects/${subjectId}`} style={{ color: 'var(--text-muted)' }}>Materia</Link> / Quiz
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

      <div className="card" style={{ padding: 'var(--space-8)' }}>
        <p style={{ fontSize: 20, fontWeight: 600, marginBottom: 'var(--space-6)', lineHeight: '28px' }}>{q.question}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {(q.options || []).map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSelected = selected === opt;
            return (
              <button
                key={i}
                onClick={() => selectOption(opt)}
                disabled={!!selected}
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
          <button onClick={nextQuestion} disabled={!selected || submitting} className="btn btn-primary">
            {submitting ? 'Enviando…' : current + 1 < questions.length ? 'Siguiente pregunta' : 'Ver resultados'}
          </button>
        </div>
      </div>
    </div>
  );
}
