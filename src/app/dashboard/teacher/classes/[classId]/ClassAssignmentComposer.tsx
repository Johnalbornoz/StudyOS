'use client';

/**
 * Track A -- create one assignment in a class: title, a topic of the
 * class's own subject, instructions, start and due dates, and recipients
 * (the whole class or selected learners). POSTs to the class-scoped route,
 * which re-authorizes the teacher for this class and each learner, checks
 * the topic belongs to the class's subject and every selected learner is
 * ACTIVE here (otherwise nothing is written and the reason is shown).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fillMessage } from '@/lib/i18n/roles-messages';

type ErrorCode = 'CLASS_SUBJECT_REQUIRED' | 'CONCEPT_NOT_IN_CLASS_SUBJECT' | 'RECIPIENT_NOT_IN_CLASS' | 'INVALID_DATES' | 'NO_LEARNERS_TO_ASSIGN';

export function ClassAssignmentComposer({
  classId,
  concepts,
  activeLearners,
  subjectLinked,
  preset,
  labels,
}: {
  classId: string;
  concepts: Array<{
    canonicalConceptId: string;
    name: string;
    matchedLearners: number;
  }>;
  activeLearners: Array<{ studentId: string; name: string }>;
  subjectLinked: boolean;
  /** From a learner's page: preselect the topic and that one learner (recipients then fixed to that learner). */
  preset?: { canonicalConceptId?: string; studentId?: string; title?: string };
  labels: {
    title: string;
    body: string;
    assignmentTitle: string;
    assignmentTitleHint: string;
    concept: string;
    conceptOption: string;
    noSubject: string;
    noConcepts: string;
    noLearners: string;
    instructions: string;
    start: string;
    due: string;
    recipients: string;
    wholeClass: string;
    selected: string;
    selectAtLeastOne: string;
    publish: string;
    publishing: string;
    published: string;
    skipped: string;
    error: string;
    errors: Record<ErrorCode, string>;
  };
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const initialConcept = concepts.find((c) => c.canonicalConceptId === preset?.canonicalConceptId)?.canonicalConceptId ?? concepts[0]?.canonicalConceptId ?? '';
  const [conceptId, setConceptId] = useState(initialConcept);
  const [title, setTitle] = useState(preset?.title ?? '');
  const [instructions, setInstructions] = useState('');
  const [start, setStart] = useState('');
  const [due, setDue] = useState('');
  const [mode, setMode] = useState<'ALL' | 'SELECTED'>(preset?.studentId ? 'SELECTED' : 'ALL');
  const [selected, setSelected] = useState<string[]>(preset?.studentId ? [preset.studentId] : []);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Array<{ text: string; error?: boolean }>>([]);
  const idp = preset?.studentId ? `-${preset.studentId.slice(0, 8)}` : '';

  async function publish() {
    if (!conceptId) return;
    if (mode === 'SELECTED' && selected.length === 0) {
      setMessages([{ text: labels.selectAtLeastOne, error: true }]);
      return;
    }
    setBusy(true);
    setMessages([]);
    const res = await fetch(`/api/teacher/classes/${classId}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canonicalConceptId: conceptId,
        title: title.trim() || null,
        instructions: instructions.trim() || null,
        startsAt: start ? new Date(`${start}T00:00:00`).toISOString() : null,
        dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : null,
        studentIds: mode === 'SELECTED' ? selected : null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessages([
        {
          text: labels.errors[body?.error as ErrorCode] ?? labels.error,
          error: true,
        },
      ]);
    } else {
      const out = [
        {
          text: fillMessage(labels.published, { n: body.data.assigned.length }),
        },
      ];
      if (body.data.skipped.length > 0)
        out.push({
          text: fillMessage(labels.skipped, { n: body.data.skipped.length }),
        });
      setMessages(out);
      setTitle('');
      setInstructions('');
      setStart('');
      setDue('');
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <section className="card ta-card" aria-labelledby={`compose-title${idp}`}>
      <h2 id={`compose-title${idp}`}>{labels.title}</h2>
      <p className="ta-msg">{labels.body}</p>
      {!subjectLinked ? (
        <p className="ta-msg">{labels.noSubject}</p>
      ) : activeLearners.length === 0 ? (
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
          <label htmlFor={`compose-title-input${idp}`}>{labels.assignmentTitle}</label>
          <input id={`compose-title-input${idp}`} value={title} maxLength={200} placeholder={labels.assignmentTitleHint} onChange={(e) => setTitle(e.target.value)} />
          <label htmlFor={`compose-concept${idp}`}>{labels.concept}</label>
          <select id={`compose-concept${idp}`} value={conceptId} onChange={(e) => setConceptId(e.target.value)}>
            {concepts.map((c) => (
              <option key={c.canonicalConceptId} value={c.canonicalConceptId}>
                {fillMessage(labels.conceptOption, {
                  name: c.name,
                  n: c.matchedLearners,
                  total: activeLearners.length,
                })}
              </option>
            ))}
          </select>
          <label htmlFor={`compose-instructions${idp}`}>{labels.instructions}</label>
          <textarea id={`compose-instructions${idp}`} maxLength={500} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <div className="ta-row">
            <span className="ta-field">
              <label htmlFor={`compose-start${idp}`}>{labels.start}</label>
              <input id={`compose-start${idp}`} type="date" value={start} min={today} onChange={(e) => setStart(e.target.value)} />
            </span>
            <span className="ta-field">
              <label htmlFor={`compose-due${idp}`}>{labels.due}</label>
              <input id={`compose-due${idp}`} type="date" value={due} min={start || today} onChange={(e) => setDue(e.target.value)} />
            </span>
          </div>
          {!preset?.studentId && (
            <fieldset className="ta-choices">
              <legend>{labels.recipients}</legend>
              <label className="ta-choice">
                <input type="radio" name={`recipients${idp}`} checked={mode === 'ALL'} onChange={() => setMode('ALL')} />
                {fillMessage(labels.wholeClass, { n: activeLearners.length })}
              </label>
              <label className="ta-choice">
                <input type="radio" name={`recipients${idp}`} checked={mode === 'SELECTED'} onChange={() => setMode('SELECTED')} />
                {labels.selected}
              </label>
              {mode === 'SELECTED' && (
                <div className="ta-choices-list">
                  {activeLearners.map((l) => (
                    <label key={l.studentId} className="ta-choice">
                      <input
                        type="checkbox"
                        checked={selected.includes(l.studentId)}
                        onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, l.studentId] : cur.filter((id) => id !== l.studentId)))}
                      />
                      {l.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
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
