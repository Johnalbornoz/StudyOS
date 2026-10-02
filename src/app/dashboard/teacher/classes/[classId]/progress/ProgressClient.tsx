'use client';

import { useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

/**
 * Track A -- client pieces of Class Progress Intelligence: dependent filters
 * (topic narrows concepts; everything is applied together through the URL,
 * so every component re-renders from the same filtered data) and the
 * "Asignar refuerzo" action (the existing class assignment flow, a task for
 * exactly the listed learners).
 */

function plural(template: string, n: number) {
  return template.replace(/\{n:([^|{}]*)\|([^{}]*)\}/g, (_m, one: string, other: string) => (n === 1 ? one : other)).replace(/\{n\}/g, String(n));
}

export function ProgressFilters({
  current,
  options,
  labels,
}: {
  current: { period: string; periodLabel: string | null; topic: string | null; concept: string | null; assignment: string | null; students: string[] };
  options: {
    topics: Array<{ key: string; label: string }>;
    concepts: Array<{ id: string; label: string; topicKey: string | null }>;
    assignments: Array<{ groupId: string; title: string }>;
    periods: string[];
    learners: Array<{ studentId: string; name: string }>;
  };
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [period, setPeriod] = useState(current.period);
  const [periodLabel, setPeriodLabel] = useState(current.periodLabel ?? '');
  const [topic, setTopic] = useState(current.topic ?? '');
  const [concept, setConcept] = useState(current.concept ?? '');
  const [assignment, setAssignment] = useState(current.assignment ?? '');
  const [students, setStudents] = useState<string[]>(current.students);
  const concepts = useMemo(() => options.concepts.filter((c) => !topic || c.topicKey === topic), [options.concepts, topic]);

  function apply(e?: React.FormEvent) {
    e?.preventDefault();
    const qs = new URLSearchParams({ period });
    if (period === 'period' && periodLabel) qs.set('periodLabel', periodLabel);
    if (topic) qs.set('topic', topic);
    if (concept && concepts.some((c) => c.id === concept)) qs.set('concept', concept);
    if (assignment) qs.set('assignment', assignment);
    if (students.length) qs.set('students', students.join(','));
    router.push(`${pathname}?${qs}`);
  }

  return (
    <form className="ta-form cpi-filters" onSubmit={apply} aria-label={labels.filters}>
      <label className="ta-field">
        <span>{labels.period}</span>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {['7d', '30d', 'period', 'all'].map((p) => (
            <option key={p} value={p}>
              {labels[`period.${p}`]}
            </option>
          ))}
        </select>
      </label>
      {period === 'period' && options.periods.length > 0 && (
        <label className="ta-field">
          <span>{labels.periodLabel}</span>
          <select value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)}>
            <option value="">—</option>
            {options.periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      )}
      {options.topics.length > 0 && (
        <label className="ta-field">
          <span>{labels.topic}</span>
          <select
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              setConcept('');
            }}
          >
            <option value="">{labels.all}</option>
            {options.topics.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="ta-field">
        <span>{labels.concept}</span>
        <select value={concept} onChange={(e) => setConcept(e.target.value)}>
          <option value="">{labels.all}</option>
          {concepts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {options.assignments.length > 0 && (
        <label className="ta-field">
          <span>{labels.assignment}</span>
          <select value={assignment} onChange={(e) => setAssignment(e.target.value)}>
            <option value="">{labels.all}</option>
            {options.assignments.map((a) => (
              <option key={a.groupId} value={a.groupId}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <details className="ta-field cpi-students-filter">
        <summary>
          {labels.students}: {students.length ? plural(labels.selected, students.length) : labels.all}
        </summary>
        <div className="ta-choices">
          {options.learners.map((l) => (
            <label key={l.studentId} className="ta-choice">
              <input type="checkbox" checked={students.includes(l.studentId)} onChange={(e) => setStudents((s) => (e.target.checked ? [...s, l.studentId] : s.filter((x) => x !== l.studentId)))} /> {l.name}
            </label>
          ))}
        </div>
      </details>
      <span className="ta-actions">
        <button type="submit" className="btn btn-primary">
          {labels.apply}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => router.push(pathname)}>
          {labels.clear}
        </button>
      </span>
    </form>
  );
}

export function ReinforceButton({ classId, conceptId, studentIds, title, labels }: { classId: string; conceptId: string; studentIds: string[]; title: string; labels: { action: string; busy: string; done: string; error: string } }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [requestId] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined));
  return (
    <span className="ta-actions">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={state === 'busy' || state === 'done' || studentIds.length === 0}
        onClick={async () => {
          setState('busy');
          try {
            const r = await fetch(`/api/teacher/classes/${classId}/assignments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ canonicalConceptId: conceptId, title, studentIds, requestId }),
            });
            if (!r.ok) throw new Error();
            setState('done');
            router.refresh();
          } catch {
            setState('error');
          }
        }}
      >
        {state === 'busy' ? labels.busy : labels.action}
      </button>
      {state === 'done' && <span className="ta-msg" role="status">{labels.done}</span>}
      {state === 'error' && <span className="ta-msg" role="alert">{labels.error}</span>}
    </span>
  );
}
