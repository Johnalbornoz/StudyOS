'use client';

/**
 * Track A -- Student plan actions. Every call goes to the learner's own
 * routes (server-resolved identity); the server decides everything
 * (reuse vs create, sources, validation). These components only post and
 * refresh.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Source = 'SELF_SELECTED' | 'CURRICULUM_RECOMMENDATION' | 'PREREQUISITE_RECOMMENDATION' | 'CLASS_PLAN' | 'INSTITUTION_CURRICULUM';

async function post(url: string, body?: unknown) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
}

export function AddToPlanButton({ canonicalConceptId, source = 'SELF_SELECTED', classId, labels }: { canonicalConceptId: string; source?: Source; classId?: string | null; labels: { add: string; adding: string; error: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <span className="ta-actions">
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(false);
          const res = await post('/api/student/plan', { canonicalConceptId, source, classId: classId ?? null });
          setBusy(false);
          if (res.ok) router.refresh();
          else setError(true);
        }}
      >
        {busy ? labels.adding : labels.add}
      </button>
      {error && (
        <span role="alert" className="ta-msg ta-msg-error">
          {labels.error}
        </span>
      )}
    </span>
  );
}

export function ArchiveToggle({ canonicalConceptId, archived, labels }: { canonicalConceptId: string; archived: boolean; labels: { archive: string; restore: string; error: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const res = await post(`/api/student/plan/${canonicalConceptId}/archive`, { archived: !archived });
        setBusy(false);
        if (res.ok) router.refresh();
      }}
    >
      {archived ? labels.restore : labels.archive}
    </button>
  );
}

export function ExamRecommendationActions({ recommendationId, labels }: { recommendationId: string; labels: { reinforce: string; add: string; dismiss: string; error: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const act = async (action: 'accept' | 'dismiss') => {
    setBusy(true);
    setError(false);
    const res = await post(`/api/student/recommendations/${recommendationId}/${action}`);
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(true);
  };
  return (
    <span className="ta-actions">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act('accept')}>
        {labels.reinforce}
      </button>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act('dismiss')}>
        {labels.dismiss}
      </button>
      {error && (
        <span role="alert" className="ta-msg ta-msg-error">
          {labels.error}
        </span>
      )}
    </span>
  );
}
