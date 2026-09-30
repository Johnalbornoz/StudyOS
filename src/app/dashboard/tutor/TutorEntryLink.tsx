import { MessageCircle } from 'lucide-react';
import type { TutorEntryMode } from '@/lib/tutor/context-pack';

/**
 * UX-5 closure -- the one way a learning surface opens the Tutor WITH its
 * context (subject, concept, and the activity it was opened from). Only
 * rendered by surfaces where Tutor help is allowed; ids are lookup keys the
 * Tutor re-verifies server-side, and the integrity guard still decides
 * whether help is available.
 *
 * From inside an activity it opens a new tab so the activity (and its
 * answers) stay exactly where they are.
 */
export function tutorEntryHref(subjectId: string, conceptId: string, from: TutorEntryMode): string {
  const qs = new URLSearchParams({ subjectId, conceptId, from });
  return `/dashboard/tutor?${qs}`;
}

export default function TutorEntryLink({
  subjectId,
  conceptId,
  from,
  label,
  newTabNote,
  className = 'btn btn-ghost tt-entry',
}: {
  subjectId: string;
  conceptId: string;
  from: TutorEntryMode;
  label: string;
  /** When set, the link opens in a new tab and this is read to assistive tech. */
  newTabNote?: string;
  className?: string;
}) {
  return (
    <a
      href={tutorEntryHref(subjectId, conceptId, from)}
      className={className}
      {...(newTabNote ? { target: '_blank', rel: 'noopener' } : {})}
      data-tutor-from={from}
    >
      <MessageCircle size={16} strokeWidth={2} aria-hidden />
      <span>{label}</span>
      {newTabNote && <span className="sr-only"> ({newTabNote})</span>}
    </a>
  );
}
