'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AvailableExamOption } from '@/lib/assessment/exam-definition.service';
import { InlineAlert } from '@/components/ui/InlineAlert';

interface Labels {
  title: string;
  lead: string;
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
    <section className="card ex-practice" aria-labelledby="create-exam-profile-title">
      <div>
        <h2 id="create-exam-profile-title" className="ex-practice-title">{labels.title}</h2>
        <p className="ui-intro-lead" style={{ marginTop: 'var(--space-1)' }}>{labels.lead}</p>
      </div>
      {exams.length === 0 ? (
        <InlineAlert tone="info" title={labels.unavailable} />
      ) : (
        <form onSubmit={onSubmit} className="ui-form">
          <div className="ui-form-grid">
            <label className="ui-field">
              <span className="ui-label">{labels.exam}</span>
              <select className="ui-select" required value={selection} onChange={(event) => setSelection(event.target.value)}>
                <option value="" disabled>—</option>
                {exams.map((exam) => (
                  <option key={exam.examVersionId} value={exam.examVersionId}>
                    {exam.examDefinitionName} — {exam.versionLabel}
                  </option>
                ))}
              </select>
            </label>
            <label className="ui-field">
              <span className="ui-label">{labels.date} <span className="ui-optional">({labels.optional})</span></span>
              <input className="ui-input" type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} />
            </label>
            <label className="ui-field">
              <span className="ui-label">{labels.purpose} <span className="ui-optional">({labels.optional})</span></span>
              <input className="ui-input" maxLength={200} value={purpose} onChange={(event) => setPurpose(event.target.value)} />
            </label>
            <label className="ui-field">
              <span className="ui-label">{labels.programme} <span className="ui-optional">({labels.optional})</span></span>
              <input className="ui-input" maxLength={200} value={programmeContext} onChange={(event) => setProgrammeContext(event.target.value)} />
            </label>
            <label className="ui-field">
              <span className="ui-label">{labels.subject} <span className="ui-optional">({labels.optional})</span></span>
              <input className="ui-input" maxLength={200} value={subjectFocus} onChange={(event) => setSubjectFocus(event.target.value)} />
            </label>
          </div>
          {error ? <InlineAlert tone="error" title={error} /> : null}
          <div className="ui-form-actions">
            <button className="btn btn-primary btn-lg" type="submit" disabled={!selection || submitting} aria-busy={submitting}>
              {submitting ? labels.submitting : labels.submit}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
