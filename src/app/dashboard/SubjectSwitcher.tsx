'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { BookOpen, Check, ChevronDown, Plus } from 'lucide-react';

/**
 * UX-5 closure -- the one subject selector used on Inicio, Aprender,
 * Progreso and the Tutor: one tap opens it, one tap picks a subject and
 * lands on that subject in Aprender. Plain links (no client state is
 * trusted); the destination page re-checks ownership server-side.
 */
export default function SubjectSwitcher({
  subjects,
  currentId,
  label,
  placeholder,
  addLabel,
  hrefFor = (id) => `/dashboard/learn?subjectId=${id}`,
}: {
  subjects: { id: string; name: string }[];
  currentId: string | null;
  /** Accessible name of the control, e.g. "Cambiar de materia". */
  label: string;
  /** Visible text when no subject is selected. */
  placeholder: string;
  addLabel: string;
  hrefFor?: (id: string) => string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute('open');
  const current = subjects.find((s) => s.id === currentId) ?? null;

  return (
    <details
      ref={ref}
      className="ss"
      onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
      onToggle={(e) => {
        // STUDENT E2E (mobile): open toward whichever side keeps the menu on
        // screen -- start-aligned by default (phones, where the trigger wraps
        // to the left), end-aligned only when that would overflow the right.
        const el = e.currentTarget;
        if (!el.open) return;
        const trigger = el.getBoundingClientRect();
        const menuWidth = Math.min(280, window.innerWidth - 32);
        el.dataset.align = trigger.left + menuWidth > window.innerWidth - 16 ? 'end' : 'start';
      }}
    >
      <summary className="ss-trigger" aria-label={`${label}: ${current?.name ?? placeholder}`}>
        <BookOpen size={16} strokeWidth={2} aria-hidden />
        <span className="ss-current">{current?.name ?? placeholder}</span>
        <ChevronDown size={16} strokeWidth={2} aria-hidden className="ss-chevron" />
      </summary>
      <div className="ss-menu">
        <ul>
          {subjects.map((s) => (
            <li key={s.id}>
              <Link href={hrefFor(s.id)} className="ss-item" aria-current={s.id === currentId ? 'true' : undefined} onClick={close}>
                <span>{s.name}</span>
                {s.id === currentId && <Check size={16} strokeWidth={2.2} aria-hidden />}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/dashboard/subjects/new" className="ss-item ss-add" onClick={close}>
          <Plus size={16} strokeWidth={2} aria-hidden />
          <span>{addLabel}</span>
        </Link>
      </div>
    </details>
  );
}
