'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AvailableExamOption } from '@/lib/assessment/exam-definition.service';

interface Labels {
  title: string;
  exam: string;
  date: string;
  purpose: string;
  programme: string;
  subject: string;
  optional: string;
  submit: string;
  submitting: string;
  unavailable: string;
  error: string;
}

export function CreateExamProfileForm({
  studentId,
  exams,
  labels,
}: {
  studentId: string;
  exams: AvailableExamOption[];
  labels: Labels;
}) {
  const router = useRouter();
  const [selection, setSelection] = useState('');
  const [examDate, setExamDate] = useState('');
  const [purpose, setPurpose] = useState('');
  const [programmeContext, setProgrammeContext] = useState('');
  const [subjectFocus, setSubjectFocus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const exam = exams.find((option) => option.examVersionId === selection);
    if (!exam || submitting) return;

    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/exam-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          examDefinitionId: exam.examDefinitionId,
          examVersionId: exam.examVersionId,
          examDate: examDate || undefined,
          purpose: purpose.trim() || undefined,
          programmeContext: programmeContext.trim() || undefined,
          subjectFocus: subjectFocus.trim() || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.data?.profile?.id) throw new Error(body?.message || labels.error);
      router.push(`/dashboard/exam-prep/${body.data.profile.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.error);
      setSubmitting(false);
    }
  }

  return (
    <section className="card" aria-labelledby="create-exam-profile-title" style={{ padding: 'var(--space-5)' }}>
      <h2 id="create-exam-profile-title" style={{ marginTop: 0 }}>{labels.title}</h2>
      {exams.length === 0 ? (
        <p role="status">{labels.unavailable}</p>
      ) : (
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <label>
            <span>{labels.exam}</span>
            <select required value={selection} onChange={(event) => setSelection(event.target.value)} style={{ display: 'block', width: '100%' }}>
              <option value="">—</option>
              {exams.map((exam) => (
                <option key={exam.examVersionId} value={exam.examVersionId}>
                  {exam.examDefinitionName} — {exam.versionLabel}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{labels.date} ({labels.optional})</span>
            <input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} style={{ display: 'block', width: '100%' }} />
          </label>
          <label>
            <span>{labels.purpose} ({labels.optional})</span>
            <input maxLength={200} value={purpose} onChange={(event) => setPurpose(event.target.value)} style={{ display: 'block', width: '100%' }} />
          </label>
          <label>
            <span>{labels.programme} ({labels.optional})</span>
            <input maxLength={200} value={programmeContext} onChange={(event) => setProgrammeContext(event.target.value)} style={{ display: 'block', width: '100%' }} />
          </label>
          <label>
            <span>{labels.subject} ({labels.optional})</span>
            <input maxLength={200} value={subjectFocus} onChange={(event) => setSubjectFocus(event.target.value)} style={{ display: 'block', width: '100%' }} />
          </label>
          {error ? <p role="alert" style={{ color: 'var(--color-danger, #b42318)' }}>{error}</p> : null}
          <button className="btn-primary" type="submit" disabled={!selection || submitting}>
            {submitting ? labels.submitting : labels.submit}
          </button>
        </form>
      )}
    </section>
  );
}
