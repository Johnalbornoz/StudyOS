'use client';

/**
 * "Mis evaluaciones programadas" -- the Student's own subject Tests / Mocks of this subject (overnight 2026-10-16):
 * scheduled ones (startable early), the one in progress, and the recent completed / expired ones. Opening one goes
 * to the quiz page with ?subjectSessionId=..., where the server reports its lifecycle. Decides nothing itself.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getMessages, type Locale } from '@/lib/i18n/messages';

interface Item {
  quizId: string;
  kind: 'SUBJECT_CUMULATIVE_TEST' | 'SUBJECT_MOCK_EXAM';
  state: 'SCHEDULED_NOT_STARTED' | 'ACTIVE' | 'TIME_UP' | 'EXPIRED' | 'COMPLETED';
  scheduledDate: string | null;
  questionCount: number;
  timed: boolean;
  durationMinutes: number | null;
  scorePercent: number | null;
  passed: boolean | null;
}

export default function SubjectAssessmentsList({ subjectId, studentId, locale }: { subjectId: string; studentId: string; locale: Locale }) {
  const t = getMessages(locale);
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/subject-assessments?studentId=${encodeURIComponent(studentId)}&subjectId=${encodeURIComponent(subjectId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (!cancelled) setItems(b?.data?.items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [subjectId, studentId]);
  if (!items || items.length === 0) return null;
  const visible = items.slice(0, 10);
  return (
    <section className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-6)' }} data-testid="subject-assessments-list" aria-labelledby="subject-assessments-title">
      <h2 id="subject-assessments-title" style={{ fontSize: 15, margin: '0 0 8px' }}>{t['quiz.subject.myAssessments']}</h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {visible.map((i) => {
          const mode = i.kind === 'SUBJECT_MOCK_EXAM' ? 'exam_simulation' : 'cumulative_assessment';
          const stateKey = `quiz.subject.state.${i.state}` as const;
          return (
            <li key={i.quizId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 14 }}>
              <span>
                <strong>{i.kind === 'SUBJECT_MOCK_EXAM' ? t['quiz.modeExamSim'] : t['quiz.modeCumulative']}</strong>
                {' · '}{i.scheduledDate ?? t['quiz.subjectSetup.nowLabel']}
                {' · '}{t['quiz.subject.questionsCount'].replace('{n}', String(i.questionCount))}
                {i.timed && i.durationMinutes ? ` · ${t['quiz.subject.minutes'].replace('{n}', String(i.durationMinutes))}` : ''}
              </span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`chip ${i.state === 'COMPLETED' ? (i.passed ? 'chip-good' : 'chip-warn') : i.state === 'EXPIRED' ? 'chip-critical' : ''}`} data-state={i.state}>
                  {t[stateKey]}{i.state === 'COMPLETED' && i.scorePercent !== null ? ` · ${i.scorePercent}%` : ''}
                </span>
                {i.state !== 'EXPIRED' && (
                  <Link className="btn btn-ghost btn-sm" href={`/dashboard/quiz?subjectId=${subjectId}&mode=${mode}&subjectSessionId=${encodeURIComponent(i.quizId)}`}>
                    {i.state === 'SCHEDULED_NOT_STARTED' ? t['quiz.subject.startNow'] : t['quiz.subject.open']}
                  </Link>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
