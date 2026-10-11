'use client';

/**
 * L8-R1 -- exam-practice assignment for one learner of one class. The
 * teacher picks one of the options the server computed for THIS learner in
 * THIS class (the learner's own preparation, within the class subject); the
 * scoped route (`POST /api/teacher/interventions`) re-runs the full
 * authorization chain and refuses any target that is not one of them.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AssignExamPracticeLabels {
  title: string;
  body: string;
  option: string;
  none: string;
  instructions: string;
  submit: string;
  done: string;
  error: string;
  outOfScope: string;
}

export interface AssignExamPracticeOption {
  key: string;
  examName: string;
  label: string;
  target: Record<string, string>;
}

export function AssignExamPracticeForm({
  classId,
  studentId,
  options,
  labels,
}: {
  classId: string;
  studentId: string;
  options: AssignExamPracticeOption[];
  labels: AssignExamPracticeLabels;
}) {
  const router = useRouter();
  const [key, setKey] = useState(options[0]?.key ?? '');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function submit() {
    const chosen = options.find((o) => o.key === key);
    if (!chosen) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/teacher/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId,
          studentId,
          interventionType: 'EXAM_PRACTICE',
          target: chosen.target,
          instructions: instructions.trim() || undefined,
        }),
      });
      if (res.ok) {
        setMessage({ text: labels.done });
        setInstructions('');
        router.refresh();
      } else {
        const code = await res.json().then((b) => b?.error).catch(() => null);
        setMessage({ text: code === 'EXAM_TARGET_OUT_OF_SCOPE' ? labels.outOfScope : labels.error, error: true });
      }
    } catch {
      setMessage({ text: labels.error, error: true });
    }
    setBusy(false);
  }

  const byExam = options.reduce<Record<string, AssignExamPracticeOption[]>>((acc, o) => {
    (acc[o.examName] ??= []).push(o);
    return acc;
  }, {});

  return (
    <section className="card ta-card" aria-labelledby="assign-exam-title">
      <h2 id="assign-exam-title">{labels.title}</h2>
      <p className="ta-msg">{labels.body}</p>
      {options.length === 0 ? (
        <p className="ta-msg">{labels.none}</p>
      ) : (
        <form
          className="ta-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="assign-exam-option">{labels.option}</label>
          <select id="assign-exam-option" value={key} onChange={(e) => setKey(e.target.value)}>
            {Object.entries(byExam).map(([exam, items]) => (
              <optgroup key={exam} label={exam}>
                {items.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <label htmlFor="assign-exam-instructions">{labels.instructions}</label>
          <textarea id="assign-exam-instructions" maxLength={500} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          <div className="ta-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !key}>
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
