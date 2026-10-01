'use client';

/**
 * Track A (A3/A5) -- publish one class assignment (a catalog topic) to every
 * active learner of the class who has that topic. POSTs to the scoped route,
 * which re-authorizes the teacher for this class and each learner.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fillMessage } from '@/lib/i18n/roles-messages';

export function ClassAssignmentComposer({
  classId,
  concepts,
  activeLearners,
  labels,
}: {
  classId: string;
  concepts: Array<{ canonicalConceptId: string; name: string; matchedLearners: number }>;
  activeLearners: number;
  labels: {
    title: string;
    body: string;
    concept: string;
    conceptOption: string;
    noConcepts: string;
    noLearners: string;
    instructions: string;
    due: string;
    publish: string;
    publishing: string;
    published: string;
    skipped: string;
    error: string;
  };
}) {
  const router = useRouter();
  const [conceptId, setConceptId] = useState(concepts[0]?.canonicalConceptId ?? '');
  const [instructions, setInstructions] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Array<{ text: string; error?: boolean }>>([]);

  async function publish() {
    if (!conceptId) return;
    setBusy(true);
    setMessages([]);
    const res = await fetch(`/api/teacher/classes/${classId}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canonicalConceptId: conceptId,
        instructions: instructions.trim() || null,
        dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : null,
      }),
    });
    if (!res.ok) {
      setMessages([{ text: labels.error, error: true }]);
    } else {
      const body = await res.json();
      const out = [{ text: fillMessage(labels.published, { n: body.data.assigned.length }) }];
      if (body.data.skipped.length > 0) out.push({ text: fillMessage(labels.skipped, { n: body.data.skipped.length }) });
      setMessages(out);
      setInstructions('');
      setDue('');
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <section className="card ta-card" aria-labelledby="compose-title">
      <h2 id="compose-title">{labels.title}</h2>
      <p className="ta-msg">{labels.body}</p>
      {activeLearners === 0 ? (
        <p className="ta-msg">{labels.noLearners}</p>
      ) : concepts.length === 0 ? (
        <p className="ta-msg">{labels.noConcepts}</p>
      ) : (
        <form
          className="ta-form"
          onSubmit={(e) => {
            e.preventDefault();
            publish();
          }}
        >
          <label htmlFor="compose-concept">{labels.concept}</label>
          <select id="compose-concept" value={conceptId} onChange={(e) => setConceptId(e.target.value)}>
            {concepts.map((c) => (
              <option key={c.canonicalConceptId} value={c.canonicalConceptId}>
                {fillMessage(labels.conceptOption, { name: c.name, n: c.matchedLearners, total: activeLearners })}
              </option>
            ))}
          </select>
          <label htmlFor="compose-instructions">{labels.instructions}</label>
          <textarea id="compose-instructions" maxLength={500} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <label htmlFor="compose-due">{labels.due}</label>
          <input id="compose-due" type="date" value={due} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDue(e.target.value)} />
          <div className="ta-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !conceptId}>
              {busy ? labels.publishing : labels.publish}
            </button>
          </div>
        </form>
      )}
      {messages.map((m, i) => (
        <p key={i} role={m.error ? 'alert' : 'status'} className={m.error ? 'ta-msg ta-msg-error' : 'ta-msg'}>
          {m.text}
        </p>
      ))}
    </section>
  );
}
