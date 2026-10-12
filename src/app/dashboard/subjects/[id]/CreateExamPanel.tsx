'use client';

/**
 * "Crear examen" on a Subject -- a partial exam over exactly the concepts the Student chooses.
 *
 * Subject -> choose concepts -> size and time available -> start now, or schedule for a date and time.
 * It needs no institution, programme or official exam. This component selects and links; it assembles
 * nothing: starting opens the assessment setup with this scope, and the server checks the scope again there
 * and at the start. A schedule is the Student's own independent record (any number, several per Subject); it is
 * saved by its own route, which checks the scope again. It has ONE path: when that runtime is not available the exam is not offered -- it never
 * falls back to another way of producing questions.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/lib/i18n/messages';
import { getAdHocExamMessages } from '@/lib/i18n/ad-hoc-exam-messages';
import { AD_HOC_EXAM_MAX_CONCEPTS, AD_HOC_EXAM_MINUTES, AD_HOC_EXAM_SIZES, AD_HOC_SCHEDULED_EVENT, adHocExamHref, scheduledInstantOfLocal, toggleGroup, type AdHocExamSize } from '@/lib/assessment-experience/ad-hoc-exam';
import type { SubjectHierarchy, HierarchyConcept } from '@/services/topic-hierarchy.service';

function GroupCheckbox({ id, label, conceptIds, selected, onToggle }: { id: string; label: string; conceptIds: string[]; selected: string[]; onToggle: (ids: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const count = conceptIds.filter((c) => selected.includes(c)).length;
  const all = conceptIds.length > 0 && count === conceptIds.length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all;
  }, [count, all]);
  return (
    <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600, fontSize: 14, minHeight: 32 }}>
      <input ref={ref} id={id} type="checkbox" checked={all} onChange={() => onToggle(conceptIds)} />
      <span>{label}</span>
      <span className="tabular" style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12.5 }}>{count}/{conceptIds.length}</span>
    </label>
  );
}

function ConceptCheckboxes({ concepts, selected, onToggle, prefix }: { concepts: HierarchyConcept[]; selected: string[]; onToggle: (ids: string[]) => void; prefix: string }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 0 var(--space-6)', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {concepts.map((c) => (
        <li key={c.id}>
          <label htmlFor={`${prefix}-${c.id}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13.5, minHeight: 30 }}>
            <input id={`${prefix}-${c.id}`} type="checkbox" checked={selected.includes(c.id)} onChange={() => onToggle([c.id])} />
            <span>{c.label}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export default function CreateExamPanel({
  subjectId,
  locale,
  hierarchy,
  canonicalAssessment,
}: {
  subjectId: string;
  locale: Locale;
  hierarchy: SubjectHierarchy;
  /** The server's assessment flag, read by the server page. Off: the exam is not available (it fails closed). */
  canonicalAssessment: boolean;
}) {
  const m = getAdHocExamMessages(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [depth, setDepth] = useState<AdHocExamSize>('BALANCED');
  const [minutes, setMinutes] = useState<number | null>(null);
  const [when, setWhen] = useState('');
  const [scheduling, setScheduling] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'FAILED' | 'INVALID_TIME'>('IDLE');

  const allConcepts = [...hierarchy.topics.flatMap((t) => t.subtopics.flatMap((s) => s.concepts)), ...hierarchy.unassigned];
  if (allConcepts.length === 0) return null;

  const toggle = (ids: string[]) => {
    setSelected((prev) => (ids.length === 1 ? (prev.includes(ids[0]) ? prev.filter((x) => x !== ids[0]) : [...prev, ids[0]]) : toggleGroup(prev, ids)));
  };
  const tooMany = selected.length > AD_HOC_EXAM_MAX_CONCEPTS;
  const canAct = canonicalAssessment && selected.length > 0 && !tooMany;

  function startNow() {
    if (!canAct) return;
    const href = adHocExamHref({ subjectId, conceptIds: selected, depth, minutes });
    if (href) router.push(href);
  }

  async function schedule() {
    if (!canAct) return;
    const scheduledAt = scheduledInstantOfLocal(when);
    if (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now()) return setScheduling('INVALID_TIME');
    setScheduling('SAVING');
    try {
      const res = await fetch('/api/assessments/ad-hoc/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // the moment carries its offset; the zone is the Student's own, as the browser reports it
        body: JSON.stringify({ subjectId, conceptIds: selected, depth, availableMinutes: minutes, scheduledAt, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) return setScheduling(body?.reason === 'INVALID_TIME' ? 'INVALID_TIME' : 'FAILED');
      setScheduling('SAVED');
      setWhen('');
      window.dispatchEvent(new Event(AD_HOC_SCHEDULED_EVENT));
    } catch {
      setScheduling('FAILED');
    }
  }

  if (!open) {
    return (
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-create-exam="open">
          {m['adhoc.cta']}
        </button>
      </div>
    );
  }

  return (
    <section className="card" aria-labelledby="create-exam-title" style={{ marginBottom: 'var(--space-6)' }} data-create-exam="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div>
          <h2 id="create-exam-title" style={{ fontSize: 17, margin: 0 }}>{m['adhoc.title']}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, margin: '6px 0 0' }}>{m['adhoc.lead']}</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>{m['adhoc.close']}</button>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', margin: 'var(--space-4) 0 var(--space-2)', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost" onClick={() => setSelected(allConcepts.map((c) => c.id))}>{m['adhoc.selectAll']}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setSelected([])}>{m['adhoc.clear']}</button>
      </div>

      <div style={{ maxHeight: 340, overflowY: 'auto', borderTop: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', padding: 'var(--space-3) 0' }}>
        {hierarchy.topics.map((topic) => {
          const topicIds = topic.subtopics.flatMap((s) => s.concepts.map((c) => c.id));
          if (topicIds.length === 0) return null;
          return (
            <fieldset key={topic.id} style={{ border: 0, margin: '0 0 var(--space-3)', padding: 0 }}>
              <legend style={{ padding: 0 }}>
                <GroupCheckbox id={`ce-topic-${topic.id}`} label={topic.name} conceptIds={topicIds} selected={selected} onToggle={toggle} />
              </legend>
              {topic.subtopics.filter((s) => s.concepts.length > 0).map((sub) => (
                <div key={sub.id} style={{ paddingLeft: 'var(--space-4)' }}>
                  {/* a Topic with one Subtopic of the same name would repeat itself */}
                  {!(topic.subtopics.length === 1 && sub.name === topic.name) && (
                    <GroupCheckbox id={`ce-sub-${sub.id}`} label={sub.name} conceptIds={sub.concepts.map((c) => c.id)} selected={selected} onToggle={toggle} />
                  )}
                  <ConceptCheckboxes concepts={sub.concepts} selected={selected} onToggle={toggle} prefix={`ce-${sub.id}`} />
                </div>
              ))}
            </fieldset>
          );
        })}
        {hierarchy.unassigned.length > 0 && (
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={{ padding: 0 }}>
              <GroupCheckbox id="ce-unassigned" label={m['adhoc.otherConcepts']} conceptIds={hierarchy.unassigned.map((c) => c.id)} selected={selected} onToggle={toggle} />
            </legend>
            <ConceptCheckboxes concepts={hierarchy.unassigned} selected={selected} onToggle={toggle} prefix="ce-un" />
          </fieldset>
        )}
      </div>

      <p role="status" aria-live="polite" className="tabular" style={{ fontSize: 13.5, margin: 'var(--space-3) 0', color: tooMany ? 'var(--error)' : 'var(--text-secondary)' }}>
        {tooMany ? m['adhoc.tooMany'] : selected.length === 0 ? m['adhoc.noneSelected'] : `${selected.length} ${m['adhoc.selected']}`}
      </p>

      <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {canonicalAssessment && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span className="label" style={{ color: 'var(--text-muted)' }}>{m['adhoc.size']}</span>
              <select value={depth} onChange={(e) => setDepth(e.target.value as AdHocExamSize)} style={{ height: 36, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', padding: '0 var(--space-3)', fontFamily: 'inherit', fontSize: 14, background: 'var(--bg-base)' }}>
                {AD_HOC_EXAM_SIZES.map((d) => <option key={d} value={d}>{m[`adhoc.size.${d}`]}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span className="label" style={{ color: 'var(--text-muted)' }}>{m['adhoc.time']}</span>
              <select value={minutes ?? ''} onChange={(e) => setMinutes(e.target.value ? Number(e.target.value) : null)} style={{ height: 36, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', padding: '0 var(--space-3)', fontFamily: 'inherit', fontSize: 14, background: 'var(--bg-base)' }}>
                <option value="">{m['adhoc.time.none']}</option>
                {AD_HOC_EXAM_MINUTES.map((v) => <option key={v} value={v}>{v} {m['adhoc.minutes']}</option>)}
              </select>
            </label>
          </>
        )}
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, flex: '1 1 220px' }}>{m['adhoc.difficulty']}</p>
      </div>

      {!canonicalAssessment && <p role="status" data-create-exam="unavailable" style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginTop: 'var(--space-3)' }}>{m['adhoc.unavailable']}</p>}

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" disabled={!canAct} onClick={startNow} data-create-exam="start">{m['adhoc.startNow']}</button>
      </div>

      {canonicalAssessment && (
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-default)', flexWrap: 'wrap', alignItems: 'flex-end' }} data-create-exam="schedule">
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span className="label" style={{ color: 'var(--text-muted)' }}>{m['adhoc.scheduleAt']}</span>
            <input type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); setScheduling('IDLE'); }} style={{ height: 36, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-default)', padding: '0 var(--space-3)', fontFamily: 'inherit', fontSize: 14, background: 'var(--bg-base)' }} />
          </label>
          <button type="button" className="btn btn-secondary" disabled={!canAct || !when || scheduling === 'SAVING'} aria-busy={scheduling === 'SAVING'} onClick={schedule}>{m['adhoc.schedule']}</button>
          <p role="status" aria-live="polite" style={{ fontSize: 13, margin: 0, flex: '1 1 200px', color: scheduling === 'FAILED' || scheduling === 'INVALID_TIME' ? 'var(--error)' : 'var(--text-secondary)' }}>
            {scheduling === 'SAVED' ? m['adhoc.scheduleSaved'] : scheduling === 'FAILED' ? m['adhoc.scheduleFailed'] : scheduling === 'INVALID_TIME' ? m['adhoc.scheduleInvalidTime'] : ''}
          </p>
        </div>
      )}
    </section>
  );
}
