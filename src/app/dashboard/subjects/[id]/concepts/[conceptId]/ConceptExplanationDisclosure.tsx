'use client';

/**
 * LX-3F -- the LEARN surface inside the Concept Mission.
 *
 * A keyboard-accessible disclosure that lazily loads the EXISTING
 * concept-explanation authority (`GET /api/concepts/[id]/explanation`
 * -> `getConceptExplanation`) and renders it with the EXISTING
 * `ConceptExplanationPanel`. It builds no new tutoring surface and
 * fetches nothing until the learner opens it (that endpoint generates +
 * caches AI content on a miss, so it must never fire on mission render).
 */

import { useId, useRef, useState } from 'react';
import type { Locale } from '@/lib/i18n/messages';
import { getMessages } from '@/lib/i18n/messages';
import { ConceptExplanationPanel, type ConceptExplanationData } from '@/app/dashboard/subjects/[id]/ConceptExplanationPanel';
import ContinuationPanel from '@/app/dashboard/quiz/ContinuationPanel';

export default function ConceptExplanationDisclosure({
  studentId,
  subjectId,
  conceptId,
  locale,
  expandLabel,
  collapseLabel,
  defaultOpen = false,
  emphasis = 'secondary',
}: {
  studentId: string;
  subjectId: string;
  conceptId: string;
  locale: Locale;
  expandLabel: string;
  collapseLabel: string;
  defaultOpen?: boolean;
  emphasis?: 'primary' | 'secondary';
}) {
  const t = getMessages(locale);
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [data, setData] = useState<ConceptExplanationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetchedRef = useRef(false);

  async function load() {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(
        `/api/concepts/${conceptId}/explanation?studentId=${studentId}&language=${locale}`,
      );
      const body = await res.json();
      if (res.ok && body?.data?.explanation) {
        setData(body.data.explanation as ConceptExplanationData);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void load();
  }

  return (
    <div>
      <button
        type="button"
        className={emphasis === 'primary' ? 'btn btn-primary' : 'btn btn-secondary'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        {open ? collapseLabel : expandLabel}
      </button>
      <div id={panelId} hidden={!open}>
        {open && (
          <ConceptExplanationPanel
            locale={locale}
            loading={loading}
            error={error}
            data={data ?? undefined}
            headerLabel={t['conceptMission.learnTitle']}
          />
        )}
        {/* LX-5C: the Learn experience no longer dead-ends. Once the
            explanation has actually rendered, a continuation checkpoint
            re-reads canonical truth and carries the learner forward.
            Reading is EXPERIENCE PROGRESS, not mastery evidence -- this
            writes nothing. */}
        {open && !loading && !error && data && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <ContinuationPanel
              studentId={studentId}
              subjectId={subjectId}
              conceptId={conceptId}
              locale={locale}
              from="LEARN"
              variant="inline"
            />
          </div>
        )}
      </div>
    </div>
  );
}
