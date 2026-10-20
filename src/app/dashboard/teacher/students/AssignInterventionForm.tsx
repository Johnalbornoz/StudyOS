'use client';

/**
 * Track A (A3) -- individual practice assignment for one learner of one
 * class. The teacher picks one of THE LEARNER'S OWN concepts (no raw ids to
 * type); the scoped route (`POST /api/teacher/interventions`) re-runs the
 * full authorization chain (class access, ACTIVE enrollment, genuine
 * teacher relationship) and checks the concept belongs to this learner.
 * Exam assignments are deferred to the cross-track integration.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AssignInterventionLabels {
  title: string;
  body: string;
  concept: string;
  none: string;
  instructions: string;
  submit: string;
  done: string;
  error: string;
}

export function AssignInterventionForm({
  classId,
  studentId,
  concepts,
  labels,
}: {
  classId: string;
  studentId: string;
  concepts: Array<{ conceptId: string; label: string; subjectName: string }>;
  labels: AssignInterventionLabels;
}) {
  const router = useRouter();
  const [conceptId, setConceptId] = useState(concepts[0]?.conceptId ?? '');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function submit() {
    if (!conceptId) return;
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/teacher/interventions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId,
        studentId,
        interventionType: 'CONCEPT_REINFORCEMENT',
        target: { targetType: 'CONCEPT', conceptId },
        instructions: instructions.trim() || undefined,
      }),
    });
    setMessage(res.ok ? { text: labels.done } : { text: labels.error, error: true });
    setBusy(false);
    if (res.ok) {
      setInstructions('');
      router.refresh();
    }
  }

  const bySubject = concepts.reduce<Record<string, typeof concepts>>((acc, c) => {
    (acc[c.subjectName] ??= []).push(c);
    return acc;
  }, {});

  return (
    <section className="card ta-card" aria-labelledby="assign-title">
      <h2 id="assign-title">{labels.title}</h2>
      <p className="ta-msg">{labels.body}</p>
      {concepts.length === 0 ? (
        <p className="ta-msg">{labels.none}</p>
      ) : (
        <form
          className="ta-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="assign-concept">{labels.concept}</label>
          <select id="assign-concept" value={conceptId} onChange={(e) => setConceptId(e.target.value)}>
            {Object.entries(bySubject).map(([subject, items]) => (
              <optgroup key={subject} label={subject}>
                {items.map((c) => (
                  <option key={c.conceptId} value={c.conceptId}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <label htmlFor="assign-instructions">{labels.instructions}</label>
          <textarea id="assign-instructions" maxLength={500} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <div className="ta-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !conceptId}>
              {labels.submit}
            </button>
          </div>
        </form>
      )}
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={message.error ? 'ta-msg ta-msg-error' : 'ta-msg'}>
          {message.text}
        </p>
      )}
    </section>
  );
}
